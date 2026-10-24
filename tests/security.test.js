import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createSecurity, allowed } from '../src/security/auth.js';
import { hashPassword, verifyPassword, digest } from '../src/security/password.js';
import { redact } from '../src/observability/logger.js';
const password = 'isolated-fixture-password-123';
const passwordHash = await hashPassword(password);
const users = new Map(), sessions = new Map(), counts = new Map();
let clock = Date.now(), unavailable = false;
const store = {
 findUser: async username => [...users.values()].find(u=>u.username===username),
 user: async id => users.get(String(id)),
 users: async () => [...users.values()],
 createUser: async value => { const u={...value,_id:'c'.repeat(24),version:0,disabled:false};users.set(u._id,u);return u; },
 updateUser: async (id,value) => {const u=users.get(id);if(!u)return null;Object.assign(u,value,{version:u.version+1});return u;},
 session: async id => {if(unavailable)throw new Error('offline');return sessions.get(id);},
 saveSession: async value => sessions.set(value._id,value),
 revoke: async id => sessions.delete(id),
 limit: async (id,max) => {const n=(counts.get(id)||0)+1;counts.set(id,n);return n<=max;},
};
const security=createSecurity({store,now:()=>clock,config:{IS_PROD:false,AUTH_ORIGINS:['http://127.0.0.1:5173'],SESSION_TTL_SECONDS:60,LEGACY_API_KEY_ENABLED:true,API_KEY:'test-service',DEVICE_API_KEY:'test-device'}});
const app=express();app.use(express.json());app.use('/api/v1/auth',security.router);
for(const resource of ['sensors','readings','alerts','incidents'])app.use('/api/v1/'+resource,security.authenticate,(req,res)=>res.json({role:req.auth.role}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}/api/v1`;
const headers={'Content-Type':'application/json','X-SensorGuard-UI':'1',Origin:'http://127.0.0.1:5173'};
const request=(path,method='GET',body,extra={})=>fetch(base+path,{method,headers:{...headers,...extra},body:body===undefined?undefined:JSON.stringify(body)});
async function login(role='VIEWER') { users.get('a'.repeat(24)).role=role;const r=await request('/auth/login','POST',{username:'tester',password});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]; }
beforeEach(()=>{users.clear();sessions.clear();counts.clear();unavailable=false;clock=Date.now();users.set('a'.repeat(24),{_id:'a'.repeat(24),username:'tester',passwordHash,role:'VIEWER',disabled:false,version:0});});
after(()=>new Promise(r=>server.close(r)));
test('scrypt uses random salts and rejects wrong passwords',async()=>{assert.notEqual(await hashPassword(password),passwordHash);assert.equal(await verifyPassword(password,passwordHash),true);assert.equal(await verifyPassword('wrong',passwordHash),false);});
test('rejects missing and invalid auth',async()=>{assert.equal((await request('/sensors')).status,401);assert.equal((await request('/sensors','GET',undefined,{'X-API-Key':'wrong'})).status,401);});
test('login cookie is HttpOnly SameSite Strict; stored token is hashed; logout revokes',async()=>{const r=await request('/auth/login','POST',{username:'tester',password});const c=r.headers.get('set-cookie');assert.match(c,/HttpOnly/);assert.match(c,/SameSite=Strict/i);assert.match(c,/Path=\/api\/v1/);const Cookie=c.split(';')[0];assert.ok(sessions.has(digest(Cookie.split('=')[1])));const me=await request('/auth/me','GET',undefined,{Cookie});assert.equal(me.status,200);assert.equal(JSON.stringify(await me.json()).includes('passwordHash'),false);assert.equal((await request('/auth/logout','POST',{}, {Cookie})).status,200);assert.equal((await request('/sensors','GET',undefined,{Cookie})).status,401);});
test('expiry enforced before TTL cleanup',async()=>{const Cookie=await login();clock+=61000;assert.equal((await request('/sensors','GET',undefined,{Cookie})).status,401);});
test('disabled users and changed versions invalidate sessions immediately',async()=>{const Cookie=await login();users.get('a'.repeat(24)).disabled=true;assert.equal((await request('/sensors','GET',undefined,{Cookie})).status,401);users.get('a'.repeat(24)).disabled=false;users.get('a'.repeat(24)).version++;assert.equal((await request('/sensors','GET',undefined,{Cookie})).status,401);});
test('viewer reads but cannot mutate',async()=>{const Cookie=await login();assert.equal((await request('/sensors','GET',undefined,{Cookie})).status,200);for(const method of ['POST','PATCH','DELETE'])assert.equal((await request('/sensors/id',method,{}, {Cookie})).status,403);});
test('operator can edit sensors and incidents but not register/delete sensors or manage users',async()=>{const Cookie=await login('OPERATOR');for(const path of ['/sensors/id','/alerts/id/resolve','/incidents/id/acknowledge'])assert.equal((await request(path,'PATCH',{}, {Cookie})).status,200);assert.equal((await request('/sensors','POST',{}, {Cookie})).status,403);assert.equal((await request('/sensors/id','DELETE',{}, {Cookie})).status,403);assert.equal((await request('/auth/users','GET',undefined,{Cookie})).status,403);});
test('admin manages accounts, validates input and cannot disable self',async()=>{const Cookie=await login('ADMIN');assert.equal((await request('/auth/users','POST',{username:'new-user',password,role:'VIEWER'}, {Cookie})).status,201);assert.equal((await request('/auth/users/'+'c'.repeat(24),'PATCH',{disabled:true}, {Cookie})).status,200);assert.equal((await request('/auth/users/'+'a'.repeat(24),'PATCH',{disabled:true}, {Cookie})).status,400);assert.equal((await request('/auth/users','POST',{username:{$ne:null},password,role:'ADMIN'}, {Cookie})).status,400);});
test('CSRF rejects missing/cross origins and missing custom headers on login and mutations',async()=>{const Cookie=await login('ADMIN');for(const extra of [{Origin:'https://evil.test'},{Origin:''},{'X-SensorGuard-UI':''}]){assert.equal((await request('/sensors/id','PATCH',{}, {Cookie,...extra})).status,403);assert.equal((await request('/auth/login','POST',{username:'tester',password},extra)).status,403);}});
test('device key scoped to telemetry; human cannot ingest; legacy service remains explicit',async()=>{assert.equal((await request('/readings','POST',{}, {'X-API-Key':'test-device'})).status,200);assert.equal((await request('/sensors','GET',undefined,{'X-API-Key':'test-device'})).status,403);assert.equal((await request('/sensors','GET',undefined,{'X-API-Key':'test-service'})).status,200);const Cookie=await login('ADMIN');assert.equal((await request('/readings','POST',{}, {Cookie})).status,403);});
test('login rate limit and invalid credentials',async()=>{for(let i=0;i<10;i++)assert.equal((await request('/auth/login','POST',{username:'tester',password:'wrong'})).status,401);assert.equal((await request('/auth/login','POST',{username:'tester',password})).status,429);});
test('failed auth storage fails closed, never falls back to master key',async()=>{const Cookie=await login();unavailable=true;assert.equal((await request('/sensors','GET',undefined,{Cookie,'X-API-Key':'test-service'})).status,503);});
test('permission matrix denies unknown roles and malformed device paths',()=>{assert.equal(allowed('UNKNOWN','GET','/sensors'),false);assert.equal(allowed('DEVICE','POST','/readings/other'),false);assert.equal(allowed('OPERATOR','POST','/alerts'),false);});
test('logger redacts credential patterns',()=>{assert.doesNotMatch(redact('password=sample-secret Bearer abcdef'),/sample-secret|abcdef/);});
