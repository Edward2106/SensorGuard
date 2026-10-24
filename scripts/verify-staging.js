import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { authStore, initializeAuth } from '../src/security/store.js';
import { hashPassword } from '../src/security/password.js';
import { getTelemetryQueue, closeTelemetryQueue } from '../src/queues/telemetry.queue.js';
const local=process.env.SG_ISOLATED_TEST==='true'&&env.MONGODB_URI==='mongodb://127.0.0.1:27028/sensorguard_staging'&&env.REDIS_HOST==='127.0.0.1'&&env.REDIS_PORT===6391&&env.PORT===3001;
if(env.MONGODB_DB_NAME!=='sensorguard_staging'||(!local&&(new URL(env.MONGODB_URI).hostname!=='mongo'||env.REDIS_HOST!=='redis'||!env.IS_PROD)))throw new Error('Refusing non-isolated staging target');
const run=Date.now().toString(36), sensorId='QA-'+run.toUpperCase(), password=randomBytes(24).toString('base64url');
const accounts=[],checks=[], report={run,sensorId,checks};
const origin=local?'http://127.0.0.1:5173':'https://localhost:8443', base=local?'http://127.0.0.1:3001/api/v1':'http://127.0.0.1:3000/api/v1';
async function call(path,{method='GET',body,cookie,device=false}={}){
 const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json','X-SensorGuard-UI':'1',Origin:origin,...(cookie?{Cookie:cookie}:{}),...(device?{'X-API-Key':env.DEVICE_API_KEY}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
}
async function wait(check,label,seconds=30){const deadline=Date.now()+seconds*1000;while(Date.now()<deadline){const value=await check();if(value)return value;await delay(250);}throw new Error('Timeout: '+label);}
async function counts(db){return Object.fromEntries(await Promise.all(['sensors','sensor_readings','incidents','telemetry_events'].map(async name=>[name,await db.collection(name).countDocuments()])));}
try{
 await connectMongo();await initializeAuth();const db=mongoose.connection.db;report.before=await counts(db);
 const cookies={};for(const role of ['ADMIN','OPERATOR','VIEWER']){const username=`qa-${run}-${role.toLowerCase()}`;const u=await authStore.createUser({username,passwordHash:await hashPassword(password),role});accounts.push(u._id);const login=await call('/auth/login',{method:'POST',body:{username,password}});assert.equal(login.status,200);cookies[role]=login.cookie;}
 checks.push('login all roles with MongoDB-backed sessions');
 assert.equal((await call('/sensors')).status,401);assert.equal((await call('/sensors',{device:true})).status,403);
 assert.equal((await call('/sensors',{cookie:cookies.VIEWER})).status,200);
 assert.equal((await call('/sensors',{method:'POST',body:{},cookie:cookies.VIEWER})).status,403);checks.push('missing authentication, device scope, viewer mutation denial');
 const payload={sensorId,name:'Isolated acceptance sensor',type:'temperature',unit:'C',thresholds:{warningLow:5,criticalLow:0,warningHigh:60,criticalHigh:90},detectionSettings:{hysteresis:3,recoveryReadings:3,offlineAfterSeconds:3600}};
 assert.equal((await call('/sensors',{method:'POST',body:payload,cookie:cookies.ADMIN})).status,201);
 assert.equal((await call('/sensors/'+sensorId,{method:'PATCH',body:{name:'Edited QA sensor'},cookie:cookies.OPERATOR})).status,200);checks.push('sensor create/read/update');
 let sequence=0;async function reading(value,eventId=randomUUID(),timestamp=new Date().toISOString()){const body={sensorId,eventId,value,timestamp,type:'temperature',unit:'C'};assert.equal((await call('/readings',{method:'POST',body,device:true})).status,202);sequence++;await wait(()=>db.collection('telemetry_events').findOne({_id:eventId,state:'stored',detectionPending:false}),'telemetry processed');return body;}
 await reading(25);assert.equal(await db.collection('incidents').countDocuments({sensorId}),0);checks.push('normal telemetry through API/BullMQ/Time Series');
 const duplicate=await reading(65);const incident=await wait(()=>db.collection('incidents').findOne({sensorId,severity:'high',status:'open'}),'high incident');
 assert.equal((await call('/readings',{method:'POST',body:duplicate,device:true})).status,202);await delay(700);assert.equal(await db.collection('sensor_readings').countDocuments({eventId:duplicate.eventId}),1);assert.equal(await db.collection('incidents').countDocuments({sensorId}),1);checks.push('high incident and duplicate event idempotency');
 await reading(95);assert.ok(await db.collection('incidents').findOne({sensorId,severity:'critical'}));checks.push('critical severity escalation');
 assert.equal((await call('/alerts/'+incident.alertId+'/acknowledge',{method:'PATCH',body:{acknowledgedBy:'spoofed'},cookie:cookies.OPERATOR})).status,200);
 const ack=await db.collection('incidents').findOne({alertId:incident.alertId});assert.notEqual(ack.acknowledgedBy,'spoofed');checks.push('acknowledge uses authenticated identity');
 await reading(59);assert.notEqual((await db.collection('incidents').findOne({alertId:incident.alertId})).status,'resolved');
 for(let i=0;i<3;i++)await reading(25);
 assert.equal((await db.collection('incidents').findOne({alertId:incident.alertId})).status,'resolved');checks.push('hysteresis and consecutive-reading auto recovery');
 await reading(95);const next=await wait(()=>db.collection('incidents').findOne({sensorId,status:'open'}),'new incident');
 assert.equal((await call('/alerts/'+next.alertId+'/resolve',{method:'PATCH',body:{resolutionNotes:'Isolated acceptance check'},cookie:cookies.OPERATOR})).status,200);checks.push('manual resolve');
 await call('/sensors/'+sensorId,{method:'PATCH',body:{status:'maintenance'},cookie:cookies.ADMIN});
 const workers=await wait(async()=>{const r=await call('/workers',{cookie:cookies.VIEWER});return r.data?.data?.status==='online'&&r.data.data;},'worker heartbeat');report.workers=workers;checks.push('independent live worker heartbeat');
 const ts=await db.listCollections({name:'sensor_readings'}).next();assert.equal(ts.type,'timeseries');report.timeSeries=ts.options;report.indexes=await db.collection('sensor_readings').indexes();
 const plan=await db.collection('sensor_readings').find({'metadata.sensorId':sensorId,timestamp:{$gte:new Date(Date.now()-3600000)}}).sort({timestamp:-1}).limit(200).explain('executionStats');report.queryExecution=plan.executionStats||plan.stages;
 report.after=await counts(db);report.uniqueReadings=sequence;
 assert.equal((await call('/auth/logout',{method:'POST',body:{},cookie:cookies.VIEWER})).status,200);assert.equal((await call('/sensors',{cookie:cookies.VIEWER})).status,401);checks.push('logout invalidates session');
 report.queue=await getTelemetryQueue().getJobCounts('waiting','active','failed');report.success=true;
}catch(error){report.success=false;report.error=error.message;process.exitCode=1;}
finally{for(const id of accounts)await authStore.updateUser(id,{disabled:true});await closeTelemetryQueue();await disconnectMongo();console.log(JSON.stringify(report,null,2));}

