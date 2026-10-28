// Host-side, finite failure injection. Only the named, isolated hardening QA stack.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
const names = { api: 'sensorguard-hardening-api-qa', worker: 'sensorguard-hardening-worker-qa', redis: 'sensorguard-intelligence-redis-qa', mongo: 'sensorguard-phase9-mongo7-qa' };
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 45000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const inspected = JSON.parse(docker(['inspect', ...Object.values(names)]));
const ids = Object.fromEntries(Object.entries(names).map(([key, name]) => {
  const c = inspected.find(c => c.Name === '/' + name);
  if (!c || c.State.Status !== 'running') throw Error('Expected running QA container: ' + name);
  if (['api', 'worker'].includes(key) && c.Config.Labels?.['com.docker.compose.project'] !== 'sensorguard-hardening-qa') throw Error('Wrong Compose project');
  return [key, c.Id];
}));
const execute = body => execFileSync('docker', ['exec', '-i', ids.api, 'node', '--input-type=module'], {
  input: `import mongoose from'mongoose';if(!process.env.MONGODB_DB_NAME.startsWith('sg_intelligence_qa_')||new URL(process.env.MONGODB_URI).hostname!=='sensorguard-phase9-mongo7-qa'||process.env.REDIS_HOST!=='sensorguard-intelligence-redis-qa')throw Error('QA only');await mongoose.connect(process.env.MONGODB_URI,{dbName:process.env.MONGODB_DB_NAME,autoIndex:false});const qaOpts=await mongoose.connection.db.admin().command({getCmdLineOpts:1});if(qaOpts.parsed.net.port!==27029||!new RegExp('^/scratch/phase9-mongo-[0-9]+$').test(qaOpts.parsed.storage.dbPath))throw Error('Wrong QA Mongo topology');${body};await mongoose.disconnect();`,
  encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'],
}).trim();
const accounts = JSON.parse(execute(`const{authStore}=await import('./src/security/store.js');const{hashPassword}=await import('./src/security/password.js');const{randomBytes}=await import('node:crypto');const a=[];for(const role of ['ADMIN','OPERATOR']){const username='fault-'+Date.now().toString(36)+'-'+role.toLowerCase(),password=randomBytes(24).toString('base64url');const u=await authStore.createUser({username,passwordHash:await hashPassword(password),role});a.push({id:String(u._id),username,password,role});}console.log(JSON.stringify(a))`));
const cookies = {}, report = { at: new Date(), scope: 'Dedicated hardening QA only; no reset/delete/flush', checks: [] };
async function call(path, role = 'ADMIN', method = 'GET', body) {
  const r = await fetch('http://127.0.0.1:3003' + path, { method,
    headers: { Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json', 'X-SensorGuard-UI': '1', ...(cookies[role] ? { Cookie: cookies[role] } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body || {}), signal: AbortSignal.timeout(10000) });
  return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
async function wait(check, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await check(); if (result) return result; await delay(500); }
  throw Error('Finite QA wait expired');
}
const ready = status => wait(async () => { try { return (await call('/ready')).status === status; } catch { return false; } });
const demo = id => call('/api/v1/demos/' + id).then(r => r.data.data);
const waitDemo = (id, state, timeout) => wait(async () => { const r = await demo(id); if (r.state === state) return r; if (['FAILED','TIMED_OUT'].includes(r.state) && state !== r.state) throw Error('Unexpected demo state ' + r.state); }, timeout);
try {
  for (const a of accounts) { const r = await call('/api/v1/auth/login', a.role, 'POST', { username: a.username, password: a.password }); assert.equal(r.status, 200); cookies[a.role] = r.cookie; }
  await ready(200);
  docker(['restart', '-t', '20', ids.api]); await ready(200);
  assert.equal((await call('/api/v1/sensors?limit=1')).status, 200);
  report.checks.push({ name: 'API restart, session persistence', pass: true });
  try {
    docker(['stop', '-t', '20', ids.redis]); await ready(503);
    const result = JSON.parse(execute(`const db=mongoose.connection.db,s=await db.collection('sensors').findOne({'metadata.simulated':true});const before=await db.collection('sensor_readings').countDocuments();const response=await fetch('http://127.0.0.1:3000/api/v1/readings',{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':process.env.DEVICE_API_KEY},body:JSON.stringify({sensorId:s.sensorId,eventId:'fault-'+Date.now(),type:s.type,unit:s.unit,value:25,timestamp:new Date().toISOString()})});console.log(JSON.stringify({status:response.status,before,after:await db.collection('sensor_readings').countDocuments()}))`));
    assert.equal(result.status, 503); assert.equal(result.before, result.after);
    report.checks.push({ name: 'Redis disconnect', readiness: 503, ingestion: 503, preservedReadings: true });
  } finally { docker(['start', ids.redis]); } await ready(200);
  try {
    docker(['stop', '-t', '30', ids.mongo]); await ready(503);
    assert.equal((await call('/api/v1/sensors?limit=1')).status, 503);
    report.checks.push({ name: 'MongoDB disconnect', readiness: 503, authenticatedRead: 503 });
  } finally { docker(['start', ids.mongo]); } await ready(200);
  // Actual concurrent HTTP requests: exactly one acquires the global demo lease.
  const starts = await Promise.all(Array.from({ length: 3 }, () => call('/api/v1/demos', 'ADMIN', 'POST', { scenario: 'SERVER_OVERHEATING' })));
  assert.deepEqual(starts.map(r => r.status).sort(), [202,409,409]);
  const id = starts.find(r => r.status === 202).data.data._id;
  await waitDemo(id, 'AWAITING_APPROVAL');
  docker(['kill', '--signal', 'KILL', ids.worker]);
  await delay(32000);
  const stale = (await call('/api/v1/workers')).data.data;
  assert.notEqual(stale.status, 'online');
  report.checks.push({ name: 'Worker SIGKILL, stale heartbeat', status: stale.status });
  docker(['start', ids.worker]);
  const resumed = await wait(async () => { const r = await demo(id); return r.state === 'AWAITING_APPROVAL' && r.timeline.filter(e => e.state === 'BASELINE').length >= 2 && r; }, 130000);
  const approvals = await Promise.all([1,2].map(() => call('/api/v1/recovery/' + resumed.workflowId + '/approve', 'OPERATOR', 'PATCH', { confirmSimulation: true })));
  assert.ok(approvals.every(r => r.status === 200));
  const verified = await waitDemo(id, 'VERIFIED', 60000);
  const count = JSON.parse(execute(`console.log(JSON.stringify(await mongoose.connection.db.collection('sensor_readings').countDocuments({'metadata.sensorId':${JSON.stringify(verified.sensorId)}})))`));
  assert.equal(count, 9);
  report.checks.push({ name: 'Concurrent demos, restarted worker/BullMQ replay, concurrent approval', state: verified.state, readings: count, baselineAttempts: resumed.timeline.filter(e => e.state === 'BASELINE').length });
  const started = await call('/api/v1/demos', 'ADMIN', 'POST', { scenario: 'PUMP_VIBRATION' }); assert.equal(started.status, 202);
  const manual = await waitDemo(started.data.data._id, 'AWAITING_APPROVAL');
  assert.equal((await call('/api/v1/alerts/' + manual.incidentId + '/acknowledge', 'OPERATOR', 'PATCH')).status, 200);
  assert.equal((await call('/api/v1/recovery/' + manual.workflowId + '/approve', 'OPERATOR', 'PATCH', { confirmSimulation: true })).status, 200);
  assert.equal((await call('/api/v1/alerts/' + manual.incidentId + '/resolve', 'OPERATOR', 'PATCH', { resolutionNotes: 'Isolated QA: manual resolve must not prove recovery' })).status, 200);
  await waitDemo(manual._id, 'FAILED', 60000);
  const verifications = await Promise.all([1,2].map(() => call('/api/v1/recovery/' + manual.workflowId + '/verify', 'OPERATOR', 'POST')));
  assert.ok(verifications.every(r => r.data.data.state !== 'VERIFIED'));
  const manualEnd = await wait(async () => { const r = await call('/api/v1/recovery/' + manual.workflowId); return ['FAILED','TIMED_OUT'].includes(r.data.data.state) && r.data.data; });
  report.checks.push({ name: 'Acknowledge/manual resolve and concurrent verification cannot prove recovery', demo: 'FAILED', workflow: manualEnd.state, falseSuccess: false });
  const sensorId='QA-TIMEOUT-'+Date.now();
  assert.equal((await call('/api/v1/sensors','ADMIN','POST',{sensorId,name:'Isolated real timeout',type:'temperature',unit:'C',thresholds:{warningHigh:60,criticalHigh:90},detectionSettings:{offlineAfterSeconds:3600,hysteresis:3,recoveryReadings:3},metadata:{simulated:true}})).status,201);
  const accepted=JSON.parse(execute(`const response=await fetch('http://127.0.0.1:3000/api/v1/readings',{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':process.env.DEVICE_API_KEY},body:JSON.stringify({sensorId:${JSON.stringify(sensorId)},eventId:'timeout-'+Date.now(),type:'temperature',unit:'C',value:95,timestamp:new Date().toISOString()})});console.log(JSON.stringify({status:response.status}))`));assert.equal(accepted.status,202);
  const timeoutIncident=await wait(async()=>{const r=await call('/api/v1/alerts?sensorId='+sensorId+'&status=open&limit=10');return r.data.data?.find(i=>i.sensorId===sensorId);});
  const proposed=await call('/api/v1/recovery/propose','OPERATOR','POST',{incidentId:timeoutIncident.alertId});assert.equal(proposed.status,201);const timeoutId=proposed.data.data._id;
  assert.equal((await call('/api/v1/recovery/'+timeoutId+'/approve','OPERATOR','PATCH',{confirmSimulation:true})).status,200);
  const timed=await wait(async()=>{const r=await call('/api/v1/recovery/'+timeoutId);return r.data.data.state==='TIMED_OUT'&&r.data.data;},140000);
  assert.equal(timed.result.eventIds.length,0);report.checks.push({name:'Real 120-second scheduled timeout without new evidence',state:timed.state,falseSuccess:false});
  assert.equal((await call('/api/v1/sensors/'+sensorId,'ADMIN','PATCH',{status:'maintenance'})).status,200);
  report.success = true;
} catch (e) { report.success = false; report.error = e.message; process.exitCode = 1; }
finally {
  for (const key of ['mongo','redis','worker','api']) { try { docker(['start', ids[key]]); } catch { report.restoreFailed = true; } }
  try { await ready(200); execute(`const{authStore}=await import('./src/security/store.js');for(const id of ${JSON.stringify(accounts.map(a => a.id))})await authStore.updateUser(id,{disabled:true})`); report.temporaryQAUsersDisabled = accounts.length; } catch { report.cleanupRequiresReview = true; }
  writeFileSync('scratch/hardening-reliability.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
}
