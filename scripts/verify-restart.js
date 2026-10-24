import{randomUUID}from'node:crypto';import{readFileSync,writeFileSync}from'node:fs';import{setTimeout as delay}from'node:timers/promises';import mongoose from'mongoose';import{env}from'../src/config/env.js';import{connectMongo,disconnectMongo}from'../src/config/db.js';
if(env.PORT!==3001||env.MONGODB_URI!=='mongodb://127.0.0.1:27028/sensorguard_staging'||env.REDIS_PORT!==6391)throw Error('Isolated target required');
const file='scratch/restart-event.json';const body=process.argv[2]==='enqueue'?{eventId:randomUUID(),sensorId:'QA-MVLUI0SL',value:25,type:'temperature',unit:'C',timestamp:new Date().toISOString()}:JSON.parse(readFileSync(file));
await connectMongo();
try{
 if(process.argv[2]==='enqueue'){const r=await fetch('http://127.0.0.1:3001/api/v1/readings',{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':env.DEVICE_API_KEY},body:JSON.stringify(body)});if(r.status!==202)throw Error('Enqueue failed');writeFileSync(file,JSON.stringify(body),{flag:'wx'});console.log('Queued isolated event while worker stopped');}
 else{let found;for(let i=0;i<40;i++){found=await mongoose.connection.db.collection('telemetry_events').findOne({_id:body.eventId,state:'stored',detectionPending:false});if(found)break;await delay(500);}if(!found)throw Error('Event not recovered');const count=await mongoose.connection.db.collection('sensor_readings').countDocuments({eventId:body.eventId});if(count!==1)throw Error('Unexpected duplicate');console.log(JSON.stringify({workerRestartRecovery:true,storedReadings:count}));}
}finally{await disconnectMongo();}
