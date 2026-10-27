import {test} from 'node:test';import assert from 'node:assert/strict';import mongoose from 'mongoose';import express from 'express';
import {getAnalytics,parseAnalyticsQuery,buildAnalyticsPipeline} from '../src/services/analytics.service.js';
import {createAnalyticsRouter} from '../src/routes/analytics.routes.js';import{createSecurity}from'../src/security/auth.js';import{digest}from'../src/security/password.js';
import{thresholdObservation}from'../src/services/detection.rules.js';import{ensureDetectionStorage,createDetector}from'../src/services/detection.service.js';import{AlertService}from'../src/services/alert.service.js';
const uri=process.env.PHASE9_TEST_MONGO_URI;
test('real MongoDB Time Series analytics and Phase8 regression', {skip:!uri,timeout:120000}, async t=>{
 assert.equal(uri,'mongodb://127.0.0.1:27029');
 const dbName='sg_phase9_test_'+Date.now();await mongoose.connect(uri,{dbName,autoIndex:false,serverSelectionTimeoutMS:3000});const db=mongoose.connection.db;
 const cmd=await db.admin().command({getCmdLineOpts:1});assert.equal(cmd.parsed.net.port,27029);assert.match(cmd.parsed.storage.dbPath.replaceAll('\\','/'),/\/scratch\/phase9-mongo-\d+$/);
 let server;
 try{
  await db.createCollection('sensor_readings',{timeseries:{timeField:'timestamp',metaField:'metadata',granularity:'seconds'}});
  await db.collection('sensor_readings').createIndex({'metadata.sensorId':1,timestamp:-1});
  const sensor={sensorId:'S-1',type:'temperature',unit:'C',thresholds:{warningHigh:60,criticalHigh:90}};
  await db.collection('sensors').insertMany([sensor,{...sensor,sensorId:'EMPTY'},{...sensor,sensorId:'FLAT'}]);
  const start=Date.parse('2026-01-01T00:00:00.000Z'), values=[10,12,11,70,13,12,11,10];
  const rows=values.flatMap((value,i)=>[value-1,value+1].map((v,j)=>({timestamp:new Date(start+i*60000+j*1000),metadata:{sensorId:'S-1',type:'temperature'},unit:'C',value:v})));
  rows.push({timestamp:new Date(start-1),metadata:{sensorId:'S-1',type:'temperature'},unit:'C',value:9999},{timestamp:new Date(start),metadata:{sensorId:'OTHER',type:'temperature'},unit:'C',value:9999},{timestamp:new Date(start),metadata:{sensorId:'S-1',type:'humidity'},unit:'%',value:9999});
  await db.collection('sensor_readings').insertMany(rows.reverse());
  await db.collection('sensor_readings').insertMany(Array.from({length:5},(_,i)=>({timestamp:new Date(start+i*60000),metadata:{sensorId:'FLAT',type:'temperature'},unit:'C',value:10})));
  const query={sensorId:'S-1',from:new Date(start).toISOString(),to:new Date(start+8*60000).toISOString(),granularity:'1m',window:'3',alpha:'0.5'};
  await t.test('ordered buckets, population stats, causal Z-score and EWMA match independent expected numbers',async()=>{
   const r=await getAnalytics(db,query),b=r.data.series;assert.deepEqual(b.map(b=>b.avg),values);assert.equal(b[0].count,2);assert.equal(b[0].stdDev,1);assert.equal(b[0].movingAverage,null);assert.equal(b[0].ewmaBaseline,null);assert.equal(b[2].zScore,null);
   assert.equal(b[3].movingAverage,11);assert.equal(b[3].baselineStdDev,1);assert.equal(b[3].zScore,59);assert.equal(b[3].ewmaBaseline,11);assert.equal(b[3].anomaly,true);assert.equal(b[4].ewmaBaseline,40.5);assert.equal(r.data.summary.count,16);
  });
  await t.test('future data cannot change historical baselines; exclusive end and query start isolation',async()=>{
   const full=await getAnalytics(db,query);const prefix=await getAnalytics(db,{...query,to:new Date(start+4*60000).toISOString()});assert.deepEqual(full.data.series.slice(0,4),prefix.data.series);
   const suffix=await getAnalytics(db,{...query,from:new Date(start+4*60000).toISOString()});assert.equal(suffix.data.series[0].ewmaBaseline,null);assert.equal(suffix.data.series[0].baselineCount,0);
  });
  await t.test('low outliers use negative Z-scores without changing earlier results',async()=>{
   await db.collection('sensor_readings').insertOne({timestamp:new Date(start+8*60000),metadata:{sensorId:'S-1',type:'temperature'},unit:'C',value:-40});
   const low=await getAnalytics(db,{...query,from:new Date(start+5*60000).toISOString(),to:new Date(start+9*60000).toISOString()});
   assert.equal(low.data.series[3].zScore,-51);assert.equal(low.data.series[3].anomaly,true);
  });
  await t.test('empty, zero variance, partial buckets and real gaps remain honest',async()=>{
   const empty=await getAnalytics(db,{...query,sensorId:'EMPTY'});assert.deepEqual(empty.data.series,[]);assert.equal(empty.meta.missingBuckets,8);assert.equal(empty.data.summary.count,0);
   const flat=await getAnalytics(db,{...query,sensorId:'FLAT'});assert.equal(flat.meta.missingBuckets,3);assert.equal(flat.data.series[4].zScore,null);assert.equal(flat.data.series[4].anomaly,false);
   const partial=await getAnalytics(db,{...query,from:new Date(start+500).toISOString(),to:new Date(start+61000).toISOString()});assert.equal(partial.data.series[0].partial,true);assert.equal(partial.data.series[1].partial,true);assert.equal(partial.data.summary.count,2);
  });
  await t.test('range caps, unknown sensors, and granularity boundaries',async()=>{
   await assert.rejects(getAnalytics(db,{...query,sensorId:'MISSING'}),{statusCode:404});await assert.rejects(getAnalytics(db,{...query,to:'2026-03-01T00:00:00Z'}),{statusCode:400});
   const five=await getAnalytics(db,{...query,granularity:'5m'});assert.equal(five.data.series.length,2);assert.equal(five.data.series[0].count,10);
  });
  await t.test('single reading and duplicate timestamps have deterministic bucket statistics',async()=>{
   await db.collection('sensors').insertOne({...sensor,_id:new mongoose.Types.ObjectId(),sensorId:'DUPLICATE'});
   const row={timestamp:new Date(start),metadata:{sensorId:'DUPLICATE',type:'temperature'},unit:'C',value:10};
   await db.collection('sensor_readings').insertOne({...row});
   const single=await getAnalytics(db,{...query,sensorId:'DUPLICATE'});
   assert.equal(single.data.summary.count,1);assert.equal(single.data.summary.stdDev,0);assert.equal(single.data.series[0].zScore,null);assert.equal(single.data.series[0].ewma,10);assert.equal(single.data.series[0].ewmaBaseline,null);
   await db.collection('sensor_readings').insertOne({...row,value:14});
   const duplicate=await getAnalytics(db,{...query,sensorId:'DUPLICATE'});
   assert.equal(duplicate.data.series.length,1);assert.equal(duplicate.data.series[0].count,2);assert.equal(duplicate.data.series[0].avg,12);assert.equal(duplicate.data.series[0].stdDev,2);
  });
  await t.test('100001 matching readings fail closed instead of returning a truncated aggregate',async()=>{
   await db.collection('sensors').insertOne({...sensor,_id:new mongoose.Types.ObjectId(),sensorId:'OVERFLOW'});
   for(let offset=0;offset<100001;offset+=5000)await db.collection('sensor_readings').insertMany(Array.from({length:Math.min(5000,100001-offset)},(_,j)=>({timestamp:new Date(start+(offset+j)*10),metadata:{sensorId:'OVERFLOW',type:'temperature'},unit:'C',value:25})));
   await assert.rejects(getAnalytics(db,{...query,sensorId:'OVERFLOW',to:new Date(start+1200000).toISOString()}),{statusCode:400});
  });
  await t.test('authenticated HTTP endpoint uses actual aggregation, with viewer allowed and device denied',async()=>{
   const raw='a'.repeat(64);const security=createSecurity({config:{IS_PROD:false,AUTH_ORIGINS:[],SESSION_TTL_SECONDS:60,DEVICE_API_KEY:'fixture-device',LEGACY_API_KEY_ENABLED:false},store:{session:async key=>key===digest(raw)?{userId:'v',version:0,expiresAt:new Date(Date.now()+60000)}:null,user:async()=>({_id:'v',username:'viewer',role:'VIEWER',disabled:false,version:0}),limit:async()=>true}});
   const app=express();app.use('/api/v1/analytics',security.authenticate,createAnalyticsRouter({database:()=>db}));app.use((err,req,res,next)=>res.status(err.statusCode||500).json({message:err.message}));
   server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}/api/v1/analytics/series?`+new URLSearchParams(query);
   assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers:{'X-API-Key':'fixture-device'}})).status,403);const result=await fetch(url,{headers:{Cookie:'sg_session='+raw}});assert.equal(result.status,200);assert.equal((await result.json()).data.series[3].zScore,59);
  });
  await t.test('Phase8 hysteresis and automatic/manual incident lifecycle still work',async()=>{
   assert.equal(thresholdObservation(59,{warningHigh:60},'high',{hysteresis:3}).recovered,false);await ensureDetectionStorage(db);
   const s={sensorId:'LIFECYCLE',type:'temperature',unit:'C',status:'active',thresholds:{warningHigh:60,criticalHigh:90},detectionSettings:{hysteresis:3,recoveryReadings:3}};await db.collection('sensors').insertOne(s);
   const detector=createDetector(db);let n=0;const observe=value=>detector.onReading({eventId:'life-'+(++n),timestamp:new Date(Date.now()+n),metadata:{sensorId:s.sensorId,type:'temperature'},value,unit:'C'});
   await observe(95);let incident=await db.collection('incidents').findOne({sensorId:s.sensorId,status:'open'});assert.ok(incident);await AlertService.acknowledgeAlert(incident.alertId,'qa');await observe(59);assert.equal((await db.collection('incidents').findOne({alertId:incident.alertId})).status,'acknowledged');
   for(let i=0;i<3;i++)await observe(25);assert.equal((await db.collection('incidents').findOne({alertId:incident.alertId})).status,'resolved');await observe(95);incident=await db.collection('incidents').findOne({sensorId:s.sensorId,status:'open'});await AlertService.resolveAlert(incident.alertId,'qa');assert.equal((await db.collection('incidents').findOne({alertId:incident.alertId})).status,'resolved');
  });
 }finally{if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();console.log('Retained isolated fixtures in '+dbName);}
});



