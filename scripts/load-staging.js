import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir,writeFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { connectMongo,disconnectMongo } from '../src/config/db.js';
import { getTelemetryQueue,closeTelemetryQueue } from '../src/queues/telemetry.queue.js';
import { heartbeatClient } from '../src/services/worker-heartbeat.js';
const sensorId=process.argv[2],duration=Number(process.argv[3]||10);
if(process.env.SG_ISOLATED_TEST!=='true'||env.MONGODB_URI!=='mongodb://127.0.0.1:27028/sensorguard_staging'||env.REDIS_HOST!=='127.0.0.1'||env.REDIS_PORT!==6391||env.PORT!==3001||!/^QA-[A-Z0-9]+$/.test(sensorId||'')||!Number.isInteger(duration)||duration<1||duration>30)throw new Error('Refusing unsafe benchmark target/options');
const percentile=(a,p)=>a.length?[...a].sort((a,b)=>a-b)[Math.min(a.length-1,Math.floor(a.length*p))]:null;
let redis;const report={at:new Date().toISOString(),duration,sensorId,scenarios:[]};
try{
 await connectMongo();const db=mongoose.connection.db;
 const options=await db.admin().command({getCmdLineOpts:1});assert.equal(options.parsed.net.port,27028);assert.match(options.parsed.storage.dbPath.replaceAll('\\','/'),/\/scratch\/phase8-mongo$/);
 assert.ok(await db.collection('sensors').findOne({sensorId,status:'maintenance'}));
 redis=heartbeatClient();await new Promise((r,j)=>{redis.once('ready',r);redis.once('error',j);});const queue=getTelemetryQueue();
 const before=await queue.getJobCounts('waiting','active');assert.equal(before.waiting+before.active,0);
 for(const rate of [20,50,100]){
  const start=Date.now(),latencies=[],running=new Set();let accepted=0,failed=0,skipped=0,peakBacklog=0;
  const sampler=setInterval(()=>void queue.getJobCounts('waiting','active').then(c=>{peakBacklog=Math.max(peakBacklog,c.waiting+c.active);}).catch(()=>{}),500);
  for(let i=0;i<rate*duration;i++){
   await delay(Math.max(0,start+i*1000/rate-Date.now()));
   if(running.size>=20){skipped++;continue;}
   const task=(async()=>{const t=performance.now();try{const r=await fetch('http://127.0.0.1:3001/api/v1/readings',{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':env.DEVICE_API_KEY},body:JSON.stringify({sensorId,eventId:randomUUID(),value:25,type:'temperature',unit:'C',timestamp:new Date().toISOString()}),signal:AbortSignal.timeout(5000)});await r.arrayBuffer();if(r.status===202)accepted++;else failed++;}catch{failed++;}finally{latencies.push(performance.now()-t);}})();
   running.add(task);task.finally(()=>running.delete(task));
  }
  await Promise.all(running);const sendSeconds=(Date.now()-start)/1000;let final;
  for(let i=0;i<120;i++){final=await queue.getJobCounts('waiting','active','failed','delayed');if(!final.waiting&&!final.active&&!final.delayed)break;await delay(500);}
  clearInterval(sampler);
  const jobs=(await queue.getJobs(['completed'],0,999)).filter(j=>j.timestamp>=start);
  const processing=jobs.map(j=>j.finishedOn-j.processedOn).filter(Number.isFinite);
  report.scenarios.push({targetRps:rate,accepted,failed,skipped,actualRps:accepted/sendSeconds,errorRate:failed/(accepted+failed||1),p50Ms:percentile(latencies,.5),p95Ms:percentile(latencies,.95),p99Ms:percentile(latencies,.99),peakBacklog,queueAfter:final,workerP95Ms:percentile(processing,.95),workerSampleCount:processing.length,redisMemory:(await redis.info('memory')).split('\r\n').filter(s=>s.startsWith('used_memory:')||s.startsWith('used_memory_peak:'))});
  if(final.waiting||final.active||final.failed||final.delayed)throw new Error('Stop: workload did not drain cleanly');
 }
 report.mongo=await db.command({dbStats:1});report.readings=await db.collection('sensor_readings').countDocuments({'metadata.sensorId':sensorId});
 report.success=true;
}catch(error){report.success=false;report.error=error.message;process.exitCode=1;}
finally{redis?.disconnect();await closeTelemetryQueue();await disconnectMongo();await mkdir('scratch',{recursive:true});const file='scratch/load-'+Date.now()+'.json';await writeFile(file,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({file,...report},null,2));}

