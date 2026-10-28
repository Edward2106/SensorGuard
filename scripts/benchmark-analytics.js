// Creates a NEW test database on a verified dedicated MongoDB; never touches staging/development.
import {MongoClient} from 'mongodb';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {buildAnalyticsPipeline,parseAnalyticsQuery,getAnalytics} from '../src/services/analytics.service.js';
const uri=process.env.PHASE9_TEST_MONGO_URI;
if(uri!=='mongodb://127.0.0.1:27029')throw Error('PHASE9_TEST_MONGO_URI must name dedicated localhost27029');
const client=new MongoClient(uri,{serverSelectionTimeoutMS:3000});await client.connect();
const database='sg_phase9_bench_'+Date.now(),db=client.db(database);
const report={at:new Date().toISOString(),database,sensors:4,readingsPerSensor:60000,totalReadings:240000,repetitions:50,warmups:5,limits:{maxTimeMS:2500,allowDiskUse:false}};
try{
 const cmd=await db.admin().command({getCmdLineOpts:1});assert.equal(cmd.parsed.net.port,27029);assert.match(cmd.parsed.storage.dbPath.replaceAll('\\','/'),/\/scratch\/phase9-mongo-\d+$/);
 report.mongoVersion=(await db.admin().command({buildInfo:1})).version;
 await db.createCollection('sensor_readings',{timeseries:{timeField:'timestamp',metaField:'metadata',granularity:'seconds'}});
 const collection=db.collection('sensor_readings'),start=Date.parse('2026-01-01T00:00:00.000Z');
 for(let s=0;s<4;s++)for(let offset=0;offset<60000;offset+=5000){await collection.insertMany(Array.from({length:5000},(_,j)=>{const i=offset+j;return{timestamp:new Date(start+i*1000),metadata:{sensorId:'BENCH-'+s,type:'temperature'},unit:'C',value:25+Math.sin(i/30)*2+(i%10007===0?40:0)};}));}
 const sensor={type:'temperature',unit:'C'},query=parseAnalyticsQuery({sensorId:'BENCH-0',from:new Date(start).toISOString(),to:new Date(start+60000000).toISOString(),granularity:'1m'});
 const pipeline=buildAnalyticsPipeline(query,sensor),options={maxTimeMS:2500,allowDiskUse:false};
 const explain=async()=>{const result=await collection.aggregate(pipeline,options).explain('executionStats');const cursor=result.stages?.find(s=>s.$cursor)?.$cursor;return{executionStats:cursor?.executionStats,winningPlan:cursor?.queryPlanner?.winningPlan,stageMemory:result.stages?.filter(s=>s.$facet).map(s=>({nReturned:s.nReturned,executionTimeMillisEstimate:s.executionTimeMillisEstimate})),raw:result};};
 const measure=async()=>{for(let i=0;i<report.warmups;i++)await collection.aggregate(pipeline,options).toArray();const ms=[];let value;for(let i=0;i<report.repetitions;i++){const t=performance.now();[value]=await collection.aggregate(pipeline,options).toArray();ms.push(performance.now()-t);}const sorted=[...ms].sort((a,b)=>a-b);return{samplesMs:ms,medianMs:(sorted[24]+sorted[25])/2,p95Ms:sorted[47],p99Ms:sorted[49],resultBuckets:value.series.length,readings:value.input[0].count};};
 report.beforeIndexes=await collection.indexes();report.before=await measure();report.beforeExplain=await explain();
 const t=performance.now();await collection.createIndex({'metadata.sensorId':1,timestamp:-1},{name:'phase9_sensor_time'});report.indexBuildMs=performance.now()-t;
 report.afterIndexes=await collection.indexes();report.after=await measure();report.afterExplain=await explain();
 assert.equal(report.before.readings,60000);assert.equal(report.after.readings,60000);assert.equal(report.before.resultBuckets,1000);assert.equal(report.after.resultBuckets,1000);
 // Paired bounded insert workload on separate empty Time Series collections, never the read dataset.
 const plain=await db.createCollection('write_plain',{timeseries:{timeField:'timestamp',metaField:'metadata',granularity:'seconds'}});
 const indexed=await db.createCollection('write_indexed',{timeseries:{timeField:'timestamp',metaField:'metadata',granularity:'seconds'}});
 await indexed.createIndex({'metadata.sensorId':1,timestamp:-1});
 const samples={plain:[],indexed:[]};
 for(let batch=0;batch<25;batch++)for(const name of (batch%2?['indexed','plain']:['plain','indexed'])){
  const rows=Array.from({length:1000},(_,i)=>({timestamp:new Date(start+(batch*1000+i)*1000),metadata:{sensorId:'WRITE-'+(i%4),type:'temperature'},unit:'C',value:25+Math.sin(i)}));
  const began=performance.now();await (name==='plain'?plain:indexed).insertMany(rows);if(batch>=5)samples[name].push(performance.now()-began);
 }
 const stats=values=>{const a=[...values].sort((a,b)=>a-b);return{samplesMs:values,medianMs:(a[9]+a[10])/2,p95Ms:a[18],p99Ms:a[19]};};
 report.writeCost={batchSize:1000,warmupBatches:5,measuredBatches:20,plain:stats(samples.plain),indexed:stats(samples.indexed)};
 // Feature-cost probe, not an old-code/new-code speedup claim: same indexed readings,
 // vary only retained history size. Includes Mongo fetch + bounded JS annotation.
 const apiQuery={sensorId:'BENCH-0',from:new Date(start).toISOString(),to:new Date(start+60000000).toISOString(),granularity:'1m'};
 await db.collection('sensors').insertOne({sensorId:'BENCH-0',type:'temperature',unit:'C',thresholds:{warningHigh:60}});
 const measureService=async()=>{for(let i=0;i<5;i++)await getAnalytics(db,apiQuery);const samplesMs=[];let result;for(let i=0;i<50;i++){const at=performance.now();result=await getAnalytics(db,apiQuery);samplesMs.push(performance.now()-at);}assert.equal(result.data.summary.count,60000);const a=[...samplesMs].sort((x,y)=>x-y);return{samplesMs,medianMs:(a[24]+a[25])/2,p95Ms:a[47],p99Ms:a[49],readings:result.data.summary.count,buckets:result.data.series.length};};
 const noHistory=await measureService();
 const history=Array.from({length:256},(_,i)=>({revision:i+1,effectiveAt:new Date(start+i*60000000/256),recordedAt:new Date(start+i*60000000/256),config:{type:'temperature',unit:'C',thresholds:{warningHigh:60+i%2},detectionSettings:{}},hash:'synthetic-benchmark-only'}));
 await db.collection('sensors').updateOne({sensorId:'BENCH-0'},{$set:{configurationRevision:256,thresholdHistory:history}});
 report.historyAnnotationCost={noHistory,maxHistory:await measureService(),note:'Same indexed read dataset; only sensor history 0 vs256 changed, synthetic benchmark revisions. Not prior-code/new-code comparison or SLA.'};
 report.notes='Same immutable read dataset, five warmups and 50 sequential samples per phase; unhinted optimizer. p95/p99 nearest rank (p99 is max with n=50). Read phases not randomized; cache/order/system noise remain. Write benchmark alternates order, separate fresh collections, 5 warmup +20 measured 1000-row batches each; p99 is maximum. Local default write concern, not production durability/throughput. No cold-cache or production capacity claim.';
 await mkdir('scratch',{recursive:true});const file='scratch/phase9-benchmark-'+Date.now()+'.json';await writeFile(file,JSON.stringify(report,null,2),{flag:'wx'});
 console.log(JSON.stringify({file,database,mongoVersion:report.mongoVersion,totalReadings:report.totalReadings,before:report.before,after:report.after,beforeDocsExamined:report.beforeExplain.executionStats?.totalDocsExamined,afterDocsExamined:report.afterExplain.executionStats?.totalDocsExamined,indexBuildMs:report.indexBuildMs,writeCost:report.writeCost},null,2));
}finally{await client.close();}
