import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
const names={api:'sensorguard-apm-qa-api-1',worker:'sensorguard-apm-qa-worker-1',redis:'sensorguard-apm-qa-redis-1'};
const docker=(args,opts={})=>execFileSync('docker',args,{encoding:'utf8',timeout:75000,stdio:['pipe','pipe','pipe'],...opts}).trim();
const ids=Object.fromEntries(Object.entries(names).map(([k,n])=>{const c=JSON.parse(docker(['inspect',n]))[0];assert.equal(c.Config.Labels['com.docker.compose.project'],'sensorguard-apm-qa');assert.equal(c.State.Status,'running');return[k,c.Id];}));
const run=code=>{
 const output=docker(['exec','-i',ids.api,'node','--input-type=module'],{input:`if(process.env.MONGODB_URI!=='mongodb://mongo:27029/sg_apm_qa')throw Error('QA only');${code}`});
 const result=output.split(/\r?\n/).filter(l=>l.startsWith('{')).map(l=>JSON.parse(l)).find(o=>!o.level);
 assert.ok(result,'Missing QA result');return result;
};
const eventId=randomUUID(),body={sensorId:'APM-QA-READ-ONLY',eventId,type:'temperature',unit:'C',value:25,timestamp:new Date().toISOString()};
try{
 docker(['stop','-t','70',ids.worker]);
 run(`const{MongoClient}=await import('mongodb');const c=new MongoClient(process.env.MONGODB_URI);await c.connect();await c.db().collection('sensors').updateOne({sensorId:'APM-QA-READ-ONLY'},{$setOnInsert:{name:'QA restart fixture',type:'temperature',unit:'C',status:'maintenance'}},{upsert:true});await c.close();console.log('{}');`);
 const accepted=run(`const r=await fetch('http://127.0.0.1:3000/api/v1/readings',{method:'POST',headers:{'content-type':'application/json','x-api-key':process.env.DEVICE_API_KEY},body:${JSON.stringify(JSON.stringify(body))}});console.log(JSON.stringify({...await r.json(),httpStatus:r.status}));`);assert.equal(accepted.httpStatus,202);
 docker(['restart','-t','20',ids.redis]);
 const waiting=run(`const{getTelemetryQueue,closeTelemetryQueue}=await import('./src/queues/telemetry.queue.js');const q=getTelemetryQueue();await q.waitUntilReady();const j=await q.getJob(${JSON.stringify(accepted.jobId)});console.log(JSON.stringify({eventId:j?.data.eventId,state:await j?.getState()}));await closeTelemetryQueue();`);assert.equal(waiting.eventId,eventId);assert.ok(['waiting','prioritized'].includes(waiting.state));
 docker(['start',ids.worker]);
 const stored=run(`const{MongoClient}=await import('mongodb');const c=new MongoClient(process.env.MONGODB_URI);await c.connect();let r;for(let n=0;n<60;n++){r=await c.db().collection('telemetry_events').findOne({_id:${JSON.stringify(eventId)},state:'stored',detectionPending:false});if(r)break;await new Promise(x=>setTimeout(x,500));}const count=await c.db().collection('sensor_readings').countDocuments({eventId:${JSON.stringify(eventId)}});console.log(JSON.stringify({stored:!!r,count}));await c.close();`);assert.deepEqual(stored,{stored:true,count:1});
 const result={success:true,queuedJobSurvivedRedisRestart:true,storedReadings:1,eventId};fs.writeFileSync('scratch/v1-redis-restart.json',JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));
}finally{docker(['start',ids.redis]);docker(['start',ids.worker]);}
