import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { digest, hashPassword, verifyPassword, validPassword, sameSecret } from './password.js';
import { authStore } from './store.js';
import { env } from '../config/env.js';
import { logger } from '../observability/logger.js';

export const publicUser = user => ({ id: String(user._id), username: user.username, role: user.role, disabled: !!user.disabled });
const roles = ['ADMIN', 'OPERATOR', 'VIEWER'];
const validName = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{2,63}$/.test(value);
const fail = (res, status, message) => res.status(status).json({ message });
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(error => { logger.error('auth.storage_or_processing_failed', { name:error.name, code:error.code }); return fail(res, 503, 'Authentication service unavailable'); });
export function allowed(role, method, rawPath) {
  // Express routing is case-insensitive; authorize the same path the router will match.
  const path = String(rawPath).toLowerCase();
  if (role === 'DEVICE') return method === 'POST' && /^\/readings(?:\/batch)?\/?$/.test(path);
  if (!roles.includes(role) && role !== 'service') return false;
  if (method === 'GET') return true;
  if (/^\/recovery(?:\/|$)/.test(path)) return ['ADMIN','OPERATOR'].includes(role) && ((method === 'POST' && (/^\/recovery\/propose\/?$/.test(path) || /^\/recovery\/rec-[a-f0-9]{64}\/verify\/?$/.test(path))) || (method === 'PATCH' && /^\/recovery\/rec-[a-f0-9]{64}\/approve\/?$/.test(path)));
  if (/^\/readings(?:\/|$)/.test(path)) return role === 'service';
  if (role === 'ADMIN' || role === 'service') return true;
  return role === 'OPERATOR' && ((['PATCH','PUT'].includes(method) && /^\/sensors\/[^/]+\/?$/.test(path)) || (method === 'PATCH' && /^\/(alerts|incidents)\/[^/]+\/(acknowledge|resolve)\/?$/.test(path)));
}
export function createSecurity({ store = authStore, config = env, now = () => Date.now() } = {}) {
  const cookieName = config.IS_PROD ? '__Secure-sg_session' : 'sg_session';
  const cookieOptions = { httpOnly: true, secure: config.IS_PROD, sameSite: 'strict', path: '/api/v1' };
  const origins = config.AUTH_ORIGINS;
  const csrf = req => origins.includes(req.headers.origin) && req.headers['x-sensorguard-ui'] === '1' && req.is('application/json');
  const token = req => {
    const value = req.headers.cookie?.split(';').map(p => p.trim()).find(p => p.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
  };
  async function identify(req) {
    const raw = token(req); if (!raw) return null;
    const session = await store.session(digest(raw));
    if (!session || new Date(session.expiresAt).getTime() <= now()) return null;
    const user = await store.user(session.userId);
    return user && !user.disabled && user.version === session.version ? user : null;
  }
  const authenticate = wrap(async (req, res, next) => {
    // Presence of a cookie selects human auth; never fall back to a service key.
    const hasCookie = req.headers.cookie?.split(';').some(p => p.trim().startsWith(cookieName + '='));
    let role, user;
    if (hasCookie) {
      user = await identify(req);
      if (!user) return fail(res, 401, 'Session expired or invalid');
      role = user.role;
      if (req.method !== 'GET' && !csrf(req)) return fail(res, 403, 'Invalid request origin or CSRF headers');
    } else {
      const key = req.headers['x-api-key'] || req.headers.authorization?.match(/^(?:Bearer|ApiKey) (.+)$/)?.[1];
      if (sameSecret(key, config.DEVICE_API_KEY)) role = 'DEVICE';
      else if (config.LEGACY_API_KEY_ENABLED && sameSecret(key, config.API_KEY)) role = 'service';
      else return fail(res, 401, 'Authentication required');
    }
    const path = req.baseUrl.replace(/^\/api\/v1/, '') + req.path;
    if (!allowed(role, req.method, path)) return fail(res, 403, 'Permission denied');
    if (!user && !(await store.limit(`credential:${role}`, 6000, 60))) return fail(res, 429, 'Credential request limit exceeded');
    if (user && !(await store.limit(`session:${user._id}`, 600, 60))) return fail(res, 429, 'Too many requests');
    req.auth = { authenticated: true, role, userId: user && String(user._id), username: user?.username };
    return next();
  });
  const human = wrap(async (req, res, next) => {
    const user = await identify(req);
    if (!user) return fail(res, 401, 'Authentication required');
    if (!(await store.limit(`account:${user._id}`, 120, 60))) return fail(res, 429, 'Too many account requests');
    if (req.method !== 'GET' && !csrf(req)) return fail(res, 403, 'Invalid request origin or CSRF headers');
    req.user = user; next();
  });
  const admin = (req, res, next) => req.user.role === 'ADMIN' ? next() : fail(res, 403, 'Administrator role required');
  const router = Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  // Dummy work makes unknown users use the same password verification algorithm.
  const dummy = hashPassword(randomBytes(24).toString('hex'));
  router.post('/login', wrap(async (req, res) => {
    if (!csrf(req)) return fail(res, 403, 'Invalid request origin or CSRF headers');
    const { username, password } = req.body || {};
    if (!validName(username) || typeof password !== 'string' || Buffer.byteLength(password) > 256) return fail(res, 400, 'Invalid login input');
    if (!(await store.limit('login-global', 60, 60)) || !(await store.limit(`login-ip:${digest(req.ip || 'unknown')}`, 30, 900)) || !(await store.limit(`login-user:${digest(username)}`, 10, 900))) {
      res.set('Retry-After', '900'); return fail(res, 429, 'Too many login attempts; retry later');
    }
    const user = await store.findUser(username);
    const correct = await verifyPassword(password, user?.passwordHash || await dummy);
    if (!correct || !user || user.disabled) return fail(res, 401, 'Invalid username or password');
    const raw = randomBytes(32).toString('hex');
    // Successful re-login revokes the old session to prevent session fixation.
    const previous = token(req); if (previous) await store.revoke(digest(previous));
    await store.saveSession({ _id: digest(raw), userId: user._id, version: user.version, expiresAt: new Date(now() + config.SESSION_TTL_SECONDS * 1000) });
    res.cookie(cookieName, raw, { ...cookieOptions, maxAge: config.SESSION_TTL_SECONDS * 1000 });
    res.json({ data: publicUser(user) });
  }));
  router.get('/me', human, (req, res) => res.json({ data: publicUser(req.user) }));
  router.post('/logout', wrap(async (req, res) => {
    if (!csrf(req)) return fail(res, 403, 'Invalid request origin or CSRF headers');
    const raw = token(req); if (raw) await store.revoke(digest(raw));
    res.clearCookie(cookieName, cookieOptions); res.json({ success: true });
  }));
  router.get('/users', human, admin, wrap(async (req, res) => {
    const page = Number(req.query.page || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) return fail(res, 400, 'Invalid page');
    res.json({ data: (await store.users(page)).map(publicUser), page, limit: 50 });
  }));
  router.post('/users', human, admin, wrap(async (req, res) => {
    const { username, password, role } = req.body || {};
    if (!validName(username) || !validPassword(password) || !roles.includes(role) || Object.keys(req.body).some(k => !['username','password','role'].includes(k))) return fail(res, 400, 'Invalid user; password requires at least 16 characters');
    try { res.status(201).json({ data: publicUser(await store.createUser({ username, passwordHash: await hashPassword(password), role })) }); }
    catch (e) { if (e.code === 11000) return fail(res, 409, 'Username already exists'); throw e; }
  }));
  router.patch('/users/:id', human, admin, wrap(async (req, res) => {
    if (!/^[a-f0-9]{24}$/i.test(req.params.id) || req.params.id === String(req.user._id)) return fail(res, 400, 'Cannot modify own account here');
    const body = req.body || {}, keys = Object.keys(body);
    if (!keys.length || keys.some(k => !['role','disabled','password'].includes(k)) || ('role' in body && !roles.includes(body.role)) || ('disabled' in body && typeof body.disabled !== 'boolean') || ('password' in body && !validPassword(body.password))) return fail(res, 400, 'Invalid account changes');
    const values = { ...body }; if (values.password) { values.passwordHash = await hashPassword(values.password); delete values.password; }
    const user = await store.updateUser(req.params.id, values);
    if (!user) return fail(res, 404, 'User not found');
    res.json({ data: publicUser(user) });
  }));
  return { router, authenticate, identify };
}
export const security = createSecurity();
