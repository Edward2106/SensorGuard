import { AppError, BadRequestError, NotFoundError } from '../errors/app-errors.js';
import { getAnalytics } from './analytics.service.js';
export const RCA_VERSION = 'rules-rca/1.0.0';
const strength = (pattern,evidence,hypotheses,actions,level='moderate') => ({pattern,evidence,hypotheses,evidenceStrength:level,recommendedActions:actions});
export function classifyPatterns({incident,series,summary,threshold,type}) {
 const results=[],n=series.length,last=series.at(-1),means=series.map(b=>b.avg);
 if(incident.type==='offline'||incident.conditionKey==='offline') results.push(strength('SENSOR_DISCONNECTION',[{condition:'Incident detector observed reporting deadline exceeded',observedAt:incident.observedAt}],['Device, power, network or collector interruption; readings cannot distinguish them'],['Check device power and network; compare collector logs'],'strong'));
 if(!n) {results.push(strength('MISSING_TELEMETRY',[{observedBuckets:0}],['No matching retained telemetry in the preceding hour; retention, missing ingestion or unit changes may explain this'],['Check retention, ingestion ledger and device configuration'],'weak'));return results;}
 const z=last.zScore;
 const gaps=series.slice(1).filter((b,i)=>+new Date(b.timestamp)-+new Date(series[i].timestamp)>60000).length;
 if(gaps)results.push(strength('MISSING_TELEMETRY',[{observedBucketGaps:gaps}],['No measurements in some UTC minute buckets; sampling cadence and ingestion loss cannot be distinguished'],['Compare sampling configuration and ingestion ledger'],'weak'));
 if(z!==null && Math.abs(z)>=3) results.push(strength('SUDDEN_SPIKE',[{bucket:last.timestamp,zScore:z,priorMean:last.movingAverage,priorStdDev:last.baselineStdDev,value:last.avg}],['Abrupt process change or sensor transient; physical cause is unproven'],['Compare adjacent sensors and inspect the device'],'strong'));
 let sustained=0;for(let i=n-1;i>=0&&Number.isFinite(threshold)&&means[i]>threshold;i--)sustained++;
 if(type==='temperature'&&sustained>=3)results.push(strength('SUSTAINED_OVERHEATING',[{consecutiveObservedBuckets:sustained,incidentThreshold:threshold}],['Heat load or cooling impairment are hypotheses, not established causes'],['Inspect cooling, workload and independent temperature readings'],'strong'));
 if(type==='vibration'&&incident.type.includes('vibration'))results.push(strength('ABNORMAL_VIBRATION',[{incidentValue:incident.readingValue,incidentThreshold:threshold}],['Mechanical imbalance, mounting or sensor placement may contribute'],['Inspect mounting and compare vibration with operating load'],'moderate'));
 const recent=means.slice(-12),deltas=recent.slice(1).map((x,i)=>x-recent[i]);
 const rising=deltas.filter(x=>x>0).length;
 if(n>=6 && (z===null||Math.abs(z)<3) && summary.slopePerHour>0 && rising>=Math.ceil(deltas.length*.7) && last.baselineStdDev>0 && recent.at(-1)-recent[0]>=2*last.baselineStdDev)results.push(strength('GRADUAL_DEGRADATION',[{slopePerHour:summary.slopePerHour,risingIntervals:rising,intervals:deltas.length}],['Progressive process drift or sensor calibration drift'],['Compare against independent instrumentation and maintenance history']));
 let crossings=0;for(let i=2;i<deltas.length;i++)if(deltas[i]*deltas[i-1]<0)crossings++;
 if(recent.length>=6&&crossings>=4)results.push(strength('REPEATED_OSCILLATION',[{directionReversals:crossings,observedBuckets:recent.length}],['Control cycling, changing load or measurement noise'],['Inspect sampling and process control; do not tune thresholds without review'],'weak'));
 const scale=Math.max(Math.abs(summary.avg||0),1);
 if(n>=6 && summary.stdDev/scale>.2)results.push(strength('NOISY_SENSOR_READINGS',[{populationStdDev:summary.stdDev,relativeSpread:summary.stdDev/scale}],['Process variation and sensor noise are indistinguishable without reference measurements'],['Compare a calibrated reference sensor'],'weak'));
 if(!results.length)results.push(strength('INSUFFICIENT_EVIDENCE',[{observedBuckets:n,readings:summary.count}],['Available pre-incident observations do not identify a supported pattern'],['Collect additional contextual evidence'],'weak'));
 return results;
}
let activeAnalyses=0;
export async function analyzeIncident(db,alertId) {
 if(activeAnalyses>=2)throw new AppError('Incident analysis busy; retry shortly',429);
 activeAnalyses++;try{return await analyzeCore(db,alertId);}finally{activeAnalyses--;}
}
async function analyzeCore(db,alertId) {
 if(typeof alertId!=='string'||! /^[A-Za-z0-9_.-]{1,160}$/.test(alertId))throw new BadRequestError('Invalid incident ID');
 const incident=await db.collection('incidents').findOne({alertId},{maxTimeMS:1000});if(!incident)throw new NotFoundError('Incident not found');
 // The original trigger is stable; updated observedAt/lastEventId may describe later health checks.
 const opened=incident.history?.find(h=>h.action==='opened');
 const trigger=opened?.observedAt ?? incident.createdAt;
 const cutoff=new Date(trigger);if(!Number.isFinite(+cutoff)||+cutoff>Date.now())throw new BadRequestError('Incident has no valid historical trigger timestamp');
 const analytics=await getAnalytics(db,{sensorId:incident.sensorId,from:new Date(+cutoff-3600000).toISOString(),to:new Date(+cutoff+1).toISOString(),granularity:'1m',window:'12',alpha:'0.2'});
 const {series,summary,sensor}=analytics.data;
 const original=incident.eventId?await db.collection('telemetry_events').findOne({_id:incident.eventId,state:'stored'},{projection:{reading:1},maxTimeMS:1000}):null;
 const atTrigger={...incident,severity:opened?.severity??'unknown',observedAt:cutoff,readingValue:original?.reading?.value??opened?.value,threshold:opened?.threshold};
 const history=(incident.history||[]).filter(h=>+new Date(h.at)<=+cutoff).slice(-50).map(({action,at,observedAt,severity})=>({action,at,observedAt,severity}));
 return {data:{incidentId:alertId,sensorId:incident.sensorId,timestamp:cutoff,generatedAt:new Date(),algorithmVersion:RCA_VERSION,severity:atTrigger.severity,patterns:classifyPatterns({incident:atTrigger,series,summary,threshold:atTrigger.threshold,type:sensor.type}),observedEvidence:{summary,series,incidentThreshold:atTrigger.threshold??null,thresholdUnit:incident.type==='offline'?'s':original?.reading?.unit||'unknown',incidentHistory:history,deviceHealthAtIncident:'unavailable'},limitations:['Hypotheses are not proven physical causes; this is deterministic statistics/rules, not AI/ML.','Event-time reconstruction: late arrivals may change results; ingestion-time as-of history is not available.','Historical threshold versioning is unavailable. An opening threshold records the detector configuration at processing time; it is not guaranteed effective at the reading event time. Legacy incidents may lack even this snapshot.','Missing buckets are not zero; baseline excludes the current bucket; minimum three prior buckets and nonzero variance required.','Current sensor type/unit filter may exclude readings from older configurations; at most one hour, 100000 readings.','Incident severity may have escalated after its original trigger; historical severity is limited to retained history.']}};
}
