// Full, read-only staging export; restore ONLY into a new, isolated QA database.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const source='sensorguard-phase8-staging-mongo-1',api='sensorguard-phase8-staging-api-1',qa='sensorguard-apm-qa-mongo-1',qaAPI='sensorguard-apm-qa-api-1',proxy='sensorguard-phase8-staging-proxy-1';
const docker=(args,options={})=>execFileSync('docker',args,{timeout:60000,maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe'],...options});
for(const [name,project] of [[source,'sensorguard-phase8-staging'],[api,'sensorguard-phase8-staging'],[proxy,'sensorguard-phase8-staging'],[qa,'sensorguard-apm-qa'],[qaAPI,'sensorguard-apm-qa']]){
 const c=JSON.parse(docker(['inspect',name]))[0];assert.equal(c.Config.Labels['com.docker.compose.project'],project);assert.equal(c.State.Status,'running');
}
const stamp=Date.now(),folder=path.resolve('backups','v1-'+stamp);fs.mkdirSync(folder,{recursive:true,mode:0o700});
if(process.platform==='win32')execFileSync('icacls',[folder,'/inheritance:r','/grant:r',os.userInfo().username+':(OI)(CI)F'],{stdio:'pipe'});
const sha=b=>createHash('sha256').update(b).digest('hex');
const save=(name,data)=>{const file=path.join(folder,name);fs.writeFileSync(file,data,{flag:'wx',mode:0o600});return{file,bytes:data.length,sha256:sha(data)};};
function snapshot(container,dbName){
 const code=`import{MongoClient,BSON}from'mongodb';import{createHash}from'node:crypto';const c=new MongoClient(process.env.MONGODB_URI,{promoteValues:false});await c.connect();try{const db=c.db(${JSON.stringify(dbName)}),out={};for(const col of (await db.listCollections().toArray()).filter(c=>!c.name.startsWith('system.')).sort((a,b)=>a.name.localeCompare(b.name))){const docs=await db.collection(col.name).find().sort({_id:1}).limit(10001).toArray();if(docs.length>10000)throw Error('Bounded verification limit');out[col.name]={count:docs.length,type:col.type,options:BSON.EJSON.stringify(col.options,{relaxed:false}),indexes:BSON.EJSON.stringify((await db.collection(col.name).indexes()).sort((a,b)=>a.name.localeCompare(b.name)),{relaxed:false}),sha256:createHash('sha256').update(BSON.EJSON.stringify(docs,{relaxed:false})).digest('hex')};}console.log(JSON.stringify(out));}finally{await c.close();}`;
 return JSON.parse(docker(['exec','-i',container,'node','--input-type=module'],{input:code}));
}
let before,archive,after,stable=false;
for(let attempt=0;attempt<3;attempt++){
 before=snapshot(api,'sensorguard_staging');
 archive=docker(['exec',source,'sh','-c','exec mongodump --host 127.0.0.1 --port 27017 --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db sensorguard_staging --archive --gzip --quiet']);
 after=snapshot(api,'sensorguard_staging');
 if(JSON.stringify(before)===JSON.stringify(after)){stable=true;break;}
 save('mongo-unstable-attempt-'+attempt+'.archive.gz',archive);
}
assert.ok(stable,'Source changed during bounded export; retry in a quiet window, backups retained');
const mongo=save('mongo-full.archive.gz',archive);
const target='sg_v1_restore_'+stamp;
const evalQA=code=>docker(['exec',qa,'mongosh','--quiet','--port','27029','--eval',code]);
const options=JSON.parse(evalQA('print(JSON.stringify(db.adminCommand({getCmdLineOpts:1}).parsed))'));
assert.equal(options.net.port,27029);assert.equal(options.storage.dbPath,'/scratch/phase9-mongo-9001');
assert.equal(String(evalQA(`print(db.adminCommand({listDatabases:1,nameOnly:true}).databases.some(d=>d.name==='${target}'))`)).trim(),'false');
evalQA('db.adminCommand({setParameter:1,ttlMonitorEnabled:false})');
try {
 docker(['exec','-i',qa,'mongorestore','--port=27029','--archive','--gzip','--nsInclude=sensorguard_staging.*','--nsFrom=sensorguard_staging.*','--nsTo='+target+'.*'],{input:archive});
 const restored=snapshot(qaAPI,target);assert.deepEqual(restored,before,'BSON documents, collection options or indexes differ');
 const ca=save('caddy-data.tar.gz',docker(['exec',proxy,'tar','-czf','-','-C','/data','caddy']));
 const config=save('Caddyfile',docker(['exec',proxy,'cat','/etc/caddy/Caddyfile']));
 const entries=String(execFileSync('tar',['-tzf',ca.file])).split(/\r?\n/).filter(Boolean);assert.ok(entries.every(n=>n.startsWith('caddy/')&&!n.split('/').includes('..')));
 execFileSync('tar',['-xzf',ca.file,'-C',folder]);
 const root=fs.readFileSync(path.join(folder,'caddy/pki/authorities/local/root.crt'));
 const sourceRoot=docker(['exec',proxy,'cat','/data/caddy/pki/authorities/local/root.crt']);assert.equal(sha(root),sha(sourceRoot));
 const report={success:true,sourceReadOnly:true,authIncluded:true,stableExportWindow:true,transactionalSnapshot:false,targetDatabase:target,mongo,ca,config,folder,rootCertificateSha256:sha(root),matchesPreviouslyVerifiedCA:true,collections:restored};
 fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
 fs.writeFileSync('scratch/v1-backup-restore.json',JSON.stringify(report,null,2),{flag:'wx'});
 console.log(JSON.stringify({success:true,authIncluded:true,targetDatabase:target,collections:Object.fromEntries(Object.entries(restored).map(([n,v])=>[n,v.count])),sha256:mongo.sha256}));
} finally {evalQA('db.adminCommand({setParameter:1,ttlMonitorEnabled:true})');}
