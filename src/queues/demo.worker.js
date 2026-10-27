import{Queue,Worker}from'bullmq';import mongoose from'mongoose';import{randomUUID}from'node:crypto';import{setTimeout as delay}from'node:timers/promises';
import{env}from'../config/env.js';import{redisConnectionOptions}from'../config/redis.js';import{SensorService}from'../services/sensor.service.js';import{createRecoveryService}from'../services/recovery.service.js';import{analyzeIncident}from'../services/incident-analysis.service.js';import{BadRequestError,ConflictError,NotFoundError,ForbiddenError}from'../errors/app-errors.js';import{logger}from'../observability/logger.js';
export const DEMO_SCENARIOS=['SERVER_OVERHEATING','PUMP_VIBRATION','CONNECTION_LOSS'];
let queue;let stopping=false;const getQueue=()=>queue||=new Queue('verified-demo-runs',{connection:{...redisConnectionOptions,maxRetriesPerRequest:1,enableOfflineQueue:false}});
const terminal=['VERIFIED','FAILED','TIMED_OUT'];const write={writeConcern:{w:'majority'}};
export async function startDemo(db,scenario,actor){
 if(actor?.role!=='ADMIN'||!actor.userId)throw new ForbiddenError('ADMIN required to allocate isolated demo sensors');if(!DEMO_SCENARIOS.includes(scenario))throw new BadRequestError('Unknown demo scenario');
 const runs=db.collection('demo_runs'),control=db.collection('demo_control'),now=new Date(),id=randomUUID();
 try{await control.updateOne({_id:'global',expiresAt:{$lte:now}},{$set:{owner:id,expiresAt:new Date(+now+300000)}},{upsert:true,...write});}catch(e){if(e.code===11000)throw new ConflictError('Another bounded demo holds the global lease');throw e;}
 const run={_id:id,scenario,state:'QUEUED',createdAt:now,deadline:new Date(+now+300000),createdBy:{userId:actor.userId,username:actor.username,role:actor.role},sensorId:'DEMO-'+id.toUpperCase(),simulation:true,timeline:[{state:'QUEUED',at:now}]};await runs.insertOne(run,write);
 try{await getQueue().add('scenario',{runId:id},{jobId:id,attempts:1,removeOnComplete:100,removeOnFail:100});}catch{await runs.updateOne({_id:id},{$set:{state:'FAILED',error:'Demo queue unavailable'}},write);await control.updateOne({_id:'global',owner:id},{$set:{expiresAt:new Date()}},write);throw new ConflictError('Demo queue unavailable; no telemetry sent');}return run;
}
export async function readDemo(db,id){if(typeof id!=='string'||! /^[a-f0-9-]{36}$/.test(id))throw new BadRequestError('Invalid demo ID');const r=await db.collection('demo_runs').findOne({_id:id},{maxTimeMS:1000,projection:{createdBy:0}});if(!r)throw new NotFoundError('Demo not found');return r;}
export function createDemoProcessor(db){return async job=>{
 const runs=db.collection('demo_runs'),id=job.data.runId;let run=await runs.findOne({_id:id});if(!run||terminal.includes(run.state))return;
 const mark=async(state,extra={})=>{await runs.updateOne({_id:id},{$set:{state,...(terminal.includes(state)?{finishedAt:new Date()}:{}),...extra},$push:{timeline:{$each:[{state,at:new Date()}],$slice:-60}}},write);run=await runs.findOne({_id:id});};
 const guard=async()=>{if(stopping)throw new Error('Demo cancelled safely by worker shutdown');const lock=await db.collection('demo_control').findOne({_id:'global',owner:id,expiresAt:{$gt:new Date()}},{maxTimeMS:1000});if(!lock||Date.now()>+run.deadline)throw new Error('Demo lease expired');};
 const wait=async check=>{while(Date.now()<+run.deadline){await guard();const r=await check();if(r)return r;await delay(1000);}throw new Error('Demo deadline exceeded');};
 const vib=run.scenario==='PUMP_VIBRATION',offline=run.scenario==='CONNECTION_LOSS',normal=vib?2:25;
 let origin=process.env.DEMO_API_ORIGIN||(env.IS_PROD?'http://api:3000':'http://127.0.0.1:3000'),validOrigin=false;
 try{const u=new URL(origin);validOrigin=u.protocol==='http:'&&['api','127.0.0.1','localhost'].includes(u.hostname)&&!u.username&&!u.password&&u.port==='3000'&&u.pathname==='/'&&!u.search&&!u.hash;origin=u.origin;}catch{/* The normal failure path below records FAILED and releases the owned lease. */}
 async function publish(step,value,at){await guard();const eventId=id+'-'+step;const body={sensorId:run.sensorId,eventId,value,timestamp:new Date(at).toISOString(),type:vib?'vibration':'temperature',unit:vib?'mm/s':'C'};
  const existing=await db.collection('telemetry_events').findOne({_id:eventId,state:'stored',detectionPending:false});if(!existing){const response=await fetch(origin+'/api/v1/readings',{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':env.DEVICE_API_KEY},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});if(response.status!==202)throw new Error('Telemetry API rejected demo: HTTP'+response.status);await wait(()=>db.collection('telemetry_events').findOne({_id:eventId,state:'stored',detectionPending:false}));}
  await runs.updateOne({_id:id},{$addToSet:{eventIds:eventId}},write);
 }
 try{
  if(!validOrigin)throw new Error('Demo requires private API origin on port3000');
  await guard();let sensor=await db.collection('sensors').findOne({sensorId:run.sensorId});if(!sensor)await SensorService.createSensor({sensorId:run.sensorId,name:'SIMULATED '+run.scenario,type:vib?'vibration':'temperature',unit:vib?'mm/s':'C',thresholds:{warningHigh:vib?5:60,criticalHigh:vib?10:90},detectionSettings:{hysteresis:vib?1:3,recoveryReadings:3,offlineAfterSeconds:offline?15:3600},metadata:{demoRunId:id,simulated:true}});else if(sensor.metadata?.demoRunId!==id)throw new Error('Demo sensor ownership conflict');
  await mark('BASELINE');const base=+run.createdAt;
  if(offline)await publish('baseline',normal,base);else for(let i=0;i<5;i++)await publish('baseline-'+i,normal+[0,1,-1,0,1][i],base-(5-i)*60000);
  if(!offline){await publish('anomaly',vib?20:95,base);await mark('ANOMALY_SENT');}else await mark('AWAITING_DISCONNECTION');
  const incident=await wait(()=>db.collection('incidents').findOne({sensorId:run.sensorId,status:{$in:['open','acknowledged']}}));await mark('INCIDENT_DETECTED',{incidentId:incident.alertId});
  const analysis=await analyzeIncident(db,incident.alertId);await mark('ANALYZED',{patterns:analysis.data.patterns.map(p=>p.pattern)});const recovery=createRecoveryService(db);const workflow=await recovery.propose(incident.alertId,run.createdBy);await mark('AWAITING_APPROVAL',{workflowId:workflow._id});
  const approved=await wait(async()=>{const w=await recovery.get(workflow._id);return w.state==='VERIFYING_RECOVERY'&&w;});
  await mark('VERIFYING_RECOVERY');let safePlan=run.safePlan;if(!safePlan){safePlan=[1,2,3].map(i=>new Date(Math.max(Date.now(),+approved.approvedAt)+i*1000));await runs.updateOne({_id:id,safePlan:{$exists:false}},{$set:{safePlan}},write);run=await runs.findOne({_id:id});safePlan=run.safePlan;}
  for(let i=0;i<3;i++){while(Date.now()<+safePlan[i]){await guard();await delay(250);}await publish('recovery-'+i,normal,safePlan[i]);}
  const result=await recovery.verify(workflow._id,{role:'OPERATOR',userId:'system-demo-verifier',username:'system-demo-verifier'});await mark(result.state==='VERIFIED'?'VERIFIED':'FAILED',{result:{state:result.state,evidence:result.result?.eventIds||[],reason:result.result?.reason||'Recovery not proven'}});
 }catch(error){await mark(Date.now()>+run.deadline?'TIMED_OUT':'FAILED',{error:error.message});throw error;}
 finally{await db.collection('sensors').updateOne({sensorId:run.sensorId,'metadata.demoRunId':id},{$set:{status:'maintenance'}},write);await db.collection('demo_control').updateOne({_id:'global',owner:id},{$set:{expiresAt:new Date()}},write);}
};}
export function startDemoWorker(){stopping=false;const worker=new Worker('verified-demo-runs',createDemoProcessor(mongoose.connection.db),{connection:redisConnectionOptions,concurrency:1,maxStalledCount:1});worker.on('error',e=>logger.error('demo.worker_error',{name:e.name,code:e.code}));worker.on('failed',job=>logger.warn('demo.failed',{runId:job?.data?.runId}));const close=worker.close.bind(worker);worker.close=async()=>{stopping=true;return close();};return worker;}
export async function closeDemoQueue(){if(queue){await queue.close();queue=null;}}
