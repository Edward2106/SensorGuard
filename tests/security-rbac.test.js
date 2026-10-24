// Focused RBAC / session / CSRF regression tests. Uses an in-memory auth store only:
// no MongoDB, Redis or development data is touched.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express, { Router } from 'express';
import { createSecurity, allowed } from '../src/security/auth.js';
import { hashPassword, digest } from '../src/security/password.js';
import { permitted } from '../frontend/server/boundary.mjs';

const password = 'isolated-fixture-password-456';
const passwordHash = await hashPassword(password);
const ADMIN_ID = 'a'.repeat(24), VIEWER_ID = 'b'.repeat(24);
const DEVICE_KEY = 'device-'.padEnd(40, 'd'), SERVICE_KEY = 'service-'.padEnd(40, 's');
const ORIGIN = 'http://127.0.0.1:5173';
const users = new Map(), sessions = new Map(), counts = new Map();
let clock = Date.now();
const store = {
  findUser: async username => [...users.values()].find(u => u.username === username),
  user: async id => users.get(String(id)),
  users: async () => [...users.values()],
  createUser: async value => { const u = { ...value, _id: 'c'.repeat(24), version: 0, disabled: false }; users.set(u._id, u); return u; },
  updateUser: async (id, value) => { const u = users.get(id); if (!u) return null; Object.assign(u, value, { version: u.version + 1 }); return u; },
  session: async id => sessions.get(id),
  saveSession: async value => sessions.set(value._id, value),
  revoke: async id => sessions.delete(id),
  limit: async (id, max) => { const n = (counts.get(id) || 0) + 1; counts.set(id, n); return n <= max; },
};
const baseConfig = { IS_PROD: false, AUTH_ORIGINS: [ORIGIN], SESSION_TTL_SECONDS: 60, DEVICE_API_KEY: DEVICE_KEY, API_KEY: SERVICE_KEY };

// Mirror the real mount structure of src/routes/index.js with stub resource handlers.
async function startApp(config) {
  const security = createSecurity({ store, now: () => clock, config });
  const api = Router();
  api.use('/auth', security.router);
  api.get('/workers', security.authenticate, (req, res) => res.json({ reached: true, role: req.auth.role }));
  for (const r of ['sensors', 'readings', 'alerts', 'incidents']) api.use('/' + r, security.authenticate, (req, res) => res.json({ reached: true, role: req.auth.role }));
  const app = express(); app.use(express.json()); app.use('/api/v1', api);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  return { server, base: `http://127.0.0.1:${server.address().port}/api/v1` };
}
const dev = await startApp({ ...baseConfig, LEGACY_API_KEY_ENABLED: true });
const prod = await startApp({ ...baseConfig, IS_PROD: true, LEGACY_API_KEY_ENABLED: false });
after(() => Promise.all([dev, prod].map(({ server }) => new Promise(r => server.close(r)))));

const ui = { 'Content-Type': 'application/json', 'X-SensorGuard-UI': '1', Origin: ORIGIN };
const call = (path, method = 'GET', body, extra = {}, base = dev.base) =>
  fetch(base + path, { method, headers: { ...ui, ...extra }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
async function login(username, base = dev.base) {
  const r = await call('/auth/login', 'POST', { username, password }, {}, base);
  assert.equal(r.status, 200);
  return r.headers.get('set-cookie').split(';')[0];
}
const asRole = async role => { users.get(VIEWER_ID).role = role; return login('viewer1'); };

beforeEach(() => {
  users.clear(); sessions.clear(); counts.clear(); clock = Date.now();
  users.set(ADMIN_ID, { _id: ADMIN_ID, username: 'boss', passwordHash, role: 'ADMIN', disabled: false, version: 0 });
  users.set(VIEWER_ID, { _id: VIEWER_ID, username: 'viewer1', passwordHash, role: 'VIEWER', disabled: false, version: 0 });
});

test('mixed-case paths cannot bypass the human-ingestion ban (regression)', async () => {
  for (const role of ['ADMIN', 'OPERATOR', 'VIEWER']) {
    const Cookie = await asRole(role);
    for (const path of ['/readings', '/READINGS', '/Readings/batch', '/rEaDiNgS/'])
      assert.equal((await call(path, 'POST', {}, { Cookie })).status, 403, `${role} POST ${path}`);
  }
  // Percent-encoded paths are not routed to the ingestion handler at all.
  const Cookie = await login('boss');
  const enc = await call('/r%65adings', 'POST', {}, { Cookie });
  assert.notEqual(enc.status, 200);
});

test('case normalisation keeps legitimate access consistent', async () => {
  assert.equal((await call('/READINGS', 'POST', {}, { 'X-API-Key': DEVICE_KEY })).status, 200);
  const Cookie = await asRole('OPERATOR');
  assert.equal((await call('/SENSORS/abc', 'PATCH', {}, { Cookie })).status, 200);
  assert.equal((await call('/SENSORS', 'POST', {}, { Cookie })).status, 403);
  assert.equal((await call('/Sensors/abc', 'DELETE', {}, { Cookie })).status, 403);
});

test('backend permission matrix', () => {
  const matrix = [
    // role, method, path, expected
    ['VIEWER', 'GET', '/sensors', true], ['VIEWER', 'PATCH', '/sensors/x', false], ['VIEWER', 'PATCH', '/alerts/x/acknowledge', false], ['VIEWER', 'POST', '/readings', false], ['VIEWER', 'HEAD', '/sensors', false],
    ['OPERATOR', 'PATCH', '/sensors/x', true], ['OPERATOR', 'PUT', '/sensors/x', true], ['OPERATOR', 'PATCH', '/incidents/x/resolve', true], ['OPERATOR', 'POST', '/sensors', false], ['OPERATOR', 'DELETE', '/sensors/x', false], ['OPERATOR', 'POST', '/alerts', false], ['OPERATOR', 'POST', '/readings/batch', false], ['OPERATOR', 'PATCH', '/sensors/x/readings', false],
    ['ADMIN', 'POST', '/sensors', true], ['ADMIN', 'DELETE', '/sensors/x', true], ['ADMIN', 'POST', '/readings', false], ['ADMIN', 'POST', '/READINGS/BATCH', false],
    ['DEVICE', 'POST', '/readings', true], ['DEVICE', 'POST', '/readings/batch', true], ['DEVICE', 'GET', '/readings', false], ['DEVICE', 'GET', '/sensors', false], ['DEVICE', 'GET', '/workers', false], ['DEVICE', 'PATCH', '/sensors/x', false], ['DEVICE', 'POST', '/alerts', false],
    ['service', 'POST', '/readings', true], ['admin', 'GET', '/sensors', false], [undefined, 'GET', '/sensors', false],
  ];
  for (const [role, method, path, expected] of matrix) assert.equal(allowed(role, method, path), expected, `${role} ${method} ${path}`);
});

test('account management is ADMIN-only on the backend', async () => {
  for (const role of ['VIEWER', 'OPERATOR']) {
    const Cookie = await asRole(role);
    assert.equal((await call('/auth/users', 'GET', undefined, { Cookie })).status, 403);
    assert.equal((await call('/auth/users', 'POST', { username: 'x-user', password, role: 'ADMIN' }, { Cookie })).status, 403);
    assert.equal((await call('/auth/users/' + ADMIN_ID, 'PATCH', { disabled: true }, { Cookie })).status, 403);
  }
  assert.equal(users.get(ADMIN_ID).disabled, false);
});

test('admin disabling or re-roling an account revokes its live session', async () => {
  const admin = await login('boss');
  let viewer = await login('viewer1');
  assert.equal((await call('/auth/me', 'GET', undefined, { Cookie: viewer })).status, 200);
  assert.equal((await call('/auth/users/' + VIEWER_ID, 'PATCH', { disabled: true }, { Cookie: admin })).status, 200);
  assert.equal((await call('/sensors', 'GET', undefined, { Cookie: viewer })).status, 401);
  assert.equal((await call('/auth/login', 'POST', { username: 'viewer1', password })).status, 401);
  assert.equal((await call('/auth/users/' + VIEWER_ID, 'PATCH', { disabled: false }, { Cookie: admin })).status, 200);
  assert.equal((await call('/auth/me', 'GET', undefined, { Cookie: viewer })).status, 401, 're-enable must not revive old session');
  viewer = await login('viewer1');
  assert.equal((await call('/auth/users/' + VIEWER_ID, 'PATCH', { role: 'OPERATOR' }, { Cookie: admin })).status, 200);
  assert.equal((await call('/auth/me', 'GET', undefined, { Cookie: viewer })).status, 401);
  assert.equal((await call('/auth/users/' + VIEWER_ID, 'PATCH', { password: 'another-strong-password-1' }, { Cookie: admin })).status, 200);
});

test('logout requires CSRF headers, revokes server-side and clears the cookie', async () => {
  const Cookie = await login('viewer1');
  assert.equal((await call('/auth/logout', 'POST', {}, { Cookie, Origin: 'https://evil.test' })).status, 403);
  assert.equal((await call('/auth/me', 'GET', undefined, { Cookie })).status, 200, 'forged logout must not act');
  const out = await call('/auth/logout', 'POST', {}, { Cookie });
  assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie'), /sg_session=;.*Expires=Thu, 01 Jan 1970/);
  assert.equal(sessions.size, 0);
  assert.equal((await call('/auth/me', 'GET', undefined, { Cookie })).status, 401);
});

test('re-login revokes the presented session (fixation) and expiry is exact', async () => {
  const first = await login('viewer1');
  const r = await call('/auth/login', 'POST', { username: 'viewer1', password }, { Cookie: first });
  assert.equal(r.status, 200);
  assert.equal((await call('/auth/me', 'GET', undefined, { Cookie: first })).status, 401);
  const second = r.headers.get('set-cookie').split(';')[0];
  clock += 59_999; assert.equal((await call('/auth/me', 'GET', undefined, { Cookie: second })).status, 200);
  clock += 1; assert.equal((await call('/auth/me', 'GET', undefined, { Cookie: second })).status, 401);
});

test('invalid/forged cookies never fall back to API keys', async () => {
  for (const Cookie of ['sg_session=' + 'f'.repeat(64), 'sg_session=not-hex', 'sg_session='])
    assert.equal((await call('/sensors', 'GET', undefined, { Cookie, 'X-API-Key': SERVICE_KEY })).status, 401, Cookie);
  // Session ids are stored hashed, so a leaked DB row cannot be replayed as a cookie.
  await login('viewer1');
  const [storedId] = sessions.keys();
  assert.equal((await call('/auth/me', 'GET', undefined, { Cookie: 'sg_session=' + storedId })).status, 401);
  assert.equal(storedId.length, digest('x').length);
});

test('CSRF: rejects simple-request content types and missing custom header', async () => {
  const Cookie = await login('boss');
  const form = await fetch(dev.base + '/sensors/x', { method: 'PATCH', headers: { Cookie, Origin: ORIGIN, 'X-SensorGuard-UI': '1', 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(form.status, 403);
  const noHeader = await fetch(dev.base + '/auth/users', { method: 'POST', headers: { Cookie, Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'csrf-user', password, role: 'ADMIN' }) });
  assert.equal(noHeader.status, 403);
  assert.equal(users.has('c'.repeat(24)), false);
});

test('CORS: no cross-origin read grants are emitted', async () => {
  const Cookie = await login('viewer1');
  const pre = await fetch(dev.base + '/sensors', { method: 'OPTIONS', headers: { Origin: 'https://evil.test', 'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'x-sensorguard-ui,content-type' } });
  const get = await call('/sensors', 'GET', undefined, { Cookie, Origin: 'https://evil.test' });
  for (const r of [pre, get]) {
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    assert.equal(r.headers.get('access-control-allow-credentials'), null);
  }
});

test('production cookie attributes', async () => {
  const r = await call('/auth/login', 'POST', { username: 'viewer1', password }, {}, prod.base);
  const c = r.headers.get('set-cookie');
  assert.match(c, /^__Secure-sg_session=[a-f0-9]{64};/);
  for (const attr of [/HttpOnly/, /Secure/, /SameSite=Strict/, /Path=\/api\/v1/, /Max-Age=60/]) assert.match(c, attr);
  assert.equal((await r.json()).data.passwordHash, undefined);
});

test('device and service credentials are separated from user auth', async () => {
  assert.equal((await call('/auth/me', 'GET', undefined, { 'X-API-Key': DEVICE_KEY })).status, 401);
  assert.equal((await call('/auth/users', 'GET', undefined, { 'X-API-Key': SERVICE_KEY })).status, 401);
  assert.equal((await call('/readings', 'GET', undefined, { Authorization: 'Bearer ' + DEVICE_KEY })).status, 403);
  assert.equal((await call('/workers', 'GET', undefined, { 'X-API-Key': DEVICE_KEY })).status, 403);
  // Legacy master key is rejected when disabled (production default).
  assert.equal((await call('/sensors', 'GET', undefined, { 'X-API-Key': SERVICE_KEY }, prod.base)).status, 401);
  assert.equal((await call('/readings', 'POST', {}, { 'X-API-Key': DEVICE_KEY }, prod.base)).status, 200);
});

test('per-session rate limit and input validation', async () => {
  const Cookie = await login('boss');
  counts.set('session:' + ADMIN_ID, 600);
  assert.equal((await call('/sensors', 'GET', undefined, { Cookie })).status, 429);
  for (const body of [{ username: { $ne: null }, password }, { username: 'boss', password: 'x'.repeat(257) }, { username: 'boss' }, { username: 'BOSS!', password }])
    assert.equal((await call('/auth/login', 'POST', body)).status, 400, JSON.stringify(body).slice(0, 60));
  for (const body of [{ username: 'new-user', password, role: 'ADMIN', disabled: false }, { username: 'new-user', password: 'short', role: 'VIEWER' }, { username: 'new-user', password, role: 'ROOT' }])
    assert.equal((await call('/auth/users', 'POST', body, { Cookie })).status, 400);
  for (const [id, body] of [[VIEWER_ID, { role: 'SUPERADMIN' }], [VIEWER_ID, { version: 0 }], [VIEWER_ID, { disabled: 'true' }], ['not-an-id', { disabled: true }], [ADMIN_ID, { role: 'VIEWER' }]])
    assert.equal((await call('/auth/users/' + id, 'PATCH', body, { Cookie })).status, 400);
});

test('local gateway boundary rejects mixed-case and foreign-host requests', () => {
  const req = (url, method = 'GET', extra = {}) => ({ url, method, headers: { host: '127.0.0.1:5173', 'x-sensorguard-ui': '1', origin: ORIGIN, 'content-type': 'application/json', ...extra } });
  assert.equal(permitted(req('/api/v1/sensors')), true);
  assert.equal(permitted(req('/api/v1/READINGS', 'POST')), false);
  assert.equal(permitted(req('/api/v1/readings', 'POST')), false);
  assert.equal(permitted(req('/api/v1/sensors', 'GET', { host: 'evil.test:5173' })), false);
  assert.equal(permitted(req('/api/v1/sensors', 'POST', { 'sec-fetch-site': 'cross-site' })), false);
});
