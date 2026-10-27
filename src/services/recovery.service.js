import{metrics}from'../observability/metrics.js';
import {createHash,randomUUID}from'node:crypto';
import{BadRequestError,NotFoundError,ConflictError,ForbiddenError}from'../errors/app-errors.js';
import{analyzeIncident}from'./incident-analysis.service.js';
import{thresholdObservation}from'./detection.rules.js';
const terminal=['VERIFIED','FAILED','TIMED_OUT'];const durable={writeConcern:{w:'majority'}};
export const recoveryId=incidentId=>{if(typeof incidentId!=='string'||! /^[A-Za-z0-9_.-]{1,160}$/.test(incidentId))throw new BadRequestError('Valid incidentId required');return 'REC-'+createHash('sha256').update(incidentId).digest('hex');};
const configOf=s=>({type:s.type,unit:s.unit,thresholds:s.thresholds||{},detectionSettings:s.detectionSettings||{},status:s.status});
const fingerprint=s=>createHash('sha256').update(JSON.stringify(configOf(s))).digest('hex');
const audit=(state,actor,at,details={})=>({state,actor:actor.username||actor.userId||'system',at,...details});
const authorize=actor=>{if(!['ADMIN','OPERATOR'].includes(actor?.role)||!actor.userId)throw new ForbiddenError('Human ADMIN or OPERATOR required');};
export function verificationDecision(events,workflow,incident,now){
 let good=[],badIds=[],last=-Infinity;const seen=new Set();
 for(const e of events){const r=e.reading;if(seen.has(e._id)||+r.timestamp<=last)continue;seen.add(e._id);last=+r.timestamp;
  if(!Number.isFinite(+new Date(e.receivedAt))||!e.receivedAt||+e.receivedAt<=+workflow.approvedAt||+r.timestamp<=+workflow.approvedAt||+r.timestamp>+workflow.deadline||+r.timestamp>now||e.detectionPending!==false||e.state!=='stored')continue;
  const t=workflow.snapshot.thresholds;const settings=workflow.snapshot.detectionSettings;
  const safe=Number.isFinite(r.value)&&r.metadata.type===workflow.snapshot.type&&r.unit===workflow.snapshot.unit&&['high','low'].every(direction=>{const o=thresholdObservation(r.value,t,direction,settings);return !o.configured||o.recovered;});
  if(safe){good.push(String(e._id));badIds=[];}else{good=[];badIds.push(String(e._id));}
  if(badIds.length>=3)return{state:'FAILED',reason:'Three consecutive post-action readings remained unsafe',eventIds:badIds.slice(-3)};
  if(good.length>=3 && incident.status==='resolved' && incident.resolvedBy==='system' && good.includes(incident.recoveryEventId))return{state:'VERIFIED',reason:'Three distinct new safe readings and detector-confirmed recovery',eventIds:good.slice(-3)};
 }
 return now>+workflow.deadline?{state:'TIMED_OUT',reason:'Recovery not proven before deadline',eventIds:good.slice(-3),safeStreak:good.length}:{state:'VERIFYING_RECOVERY'};
}
export function createRecoveryService(db,{clock=()=>new Date(),analyze=analyzeIncident}={}){
 const collection=db.collection('recovery_workflows');
 async function get(id){if(typeof id!=='string'||!/^REC-[a-f0-9]{64}$/.test(id))throw new BadRequestError('Invalid recovery ID');const w=await collection.findOne({_id:id},{maxTimeMS:1000});if(!w)throw new NotFoundError('Recovery workflow not found');return w;}
 return{
  get,
  async propose(incidentId,actor){authorize(actor);const id=recoveryId(incidentId),existing=await collection.findOne({_id:id},{maxTimeMS:1000});if(existing)return existing;
   const analysis=await analyze(db,incidentId);const incident=await db.collection('incidents').findOne({alertId:incidentId},{maxTimeMS:1000});if(incident.status==='resolved')throw new ConflictError('Incident is already resolved');
   const sensor=await db.collection('sensors').findOne({sensorId:incident.sensorId},{maxTimeMS:1000});if(!sensor)throw new NotFoundError('Sensor not found');const now=clock();
   const w={_id:id,incidentId,sensorId:sensor.sensorId,state:'ACTION_PROPOSED',version:0,correlationId:randomUUID(),createdAt:now,algorithmVersion:analysis.data.algorithmVersion,snapshot:configOf(sensor),configFingerprint:fingerprint(sensor),action:'SIMULATED_INSPECTION_ONLY',limitations:['No hardware command or physical remediation is performed. Verification requires new telemetry and automatic detector recovery.'],audit:[audit('DETECTED',actor,now),audit('ANALYZED',actor,now),audit('ACTION_PROPOSED',actor,now)]};
   try{await collection.insertOne(w,durable);metrics.emit('recovery.proposed');}catch(e){if(e.code!==11000)throw e;}return get(id);
  },
  async approve(id,actor,confirmed){authorize(actor);if(confirmed!==true)throw new BadRequestError('Explicit confirmSimulation:true required');const w=await get(id);if(w.state!=='ACTION_PROPOSED')return w;
   const sensor=await db.collection('sensors').findOne({sensorId:w.sensorId},{maxTimeMS:1000});if(!sensor||['maintenance','inactive'].includes(sensor.status)||fingerprint(sensor)!==w.configFingerprint)throw new ConflictError('Sensor configuration changed or monitoring is disabled; no action approved');
   const incident=await db.collection('incidents').findOne({alertId:w.incidentId},{maxTimeMS:1000});if(incident?.status==='resolved')throw new ConflictError('Incident already resolved');const now=clock(),deadline=new Date(+now+120000);
   const change=await collection.updateOne({_id:id,state:'ACTION_PROPOSED',version:w.version},{$set:{state:'VERIFYING_RECOVERY',approvedAt:now,approvedBy:{userId:actor.userId,username:actor.username,role:actor.role},deadline},$inc:{version:1},$push:{audit:{$each:[audit('USER_APPROVED',actor,now),audit('SIMULATED_REMEDIATION',actor,now,{description:'Recorded simulation only; no device command'}),audit('VERIFYING_RECOVERY',actor,now)]}}},durable);if(change.modifiedCount===1)metrics.emit('recovery.approved');return get(id);
  },
  async verify(id,actor){authorize(actor);const w=await get(id);if(w.state!=='VERIFYING_RECOVERY')return w;
   const now=clock(),sensor=await db.collection('sensors').findOne({sensorId:w.sensorId},{maxTimeMS:1000});let decision;
   if(!sensor||fingerprint(sensor)!==w.configFingerprint)decision={state:'FAILED',reason:'Sensor configuration changed during verification',eventIds:[]};
   else{const events=await db.collection('telemetry_events').find({'reading.metadata.sensorId':w.sensorId,state:'stored',detectionPending:false,receivedAt:{$gt:w.approvedAt},'reading.timestamp':{$gt:w.approvedAt,$lte:new Date(Math.min(+now,+w.deadline))}},{maxTimeMS:2500}).sort({'reading.timestamp':1,_id:1}).limit(501).toArray();
    if(events.length>500)decision={state:'FAILED',reason:'Verification evidence limit exceeded',eventIds:[]};else{const incident=await db.collection('incidents').findOne({alertId:w.incidentId},{maxTimeMS:1000});decision=verificationDecision(events,w,incident||{},+now);}}
   if(decision.state===w.state)return w;
   const change=await collection.updateOne({_id:id,state:w.state,version:w.version},{$set:{state:decision.state,result:decision,finishedAt:now},$inc:{version:1},$push:{audit:audit(decision.state,actor,now,{reason:decision.reason,eventIds:decision.eventIds})}},durable);if(change.modifiedCount===1)metrics.emit('recovery.'+decision.state.toLowerCase());return get(id);
  },
 };
}
export {terminal as RECOVERY_TERMINAL_STATES};
