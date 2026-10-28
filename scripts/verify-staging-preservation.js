// Read-only comparison. Does not treat expected offline elapsed-time updates as immutable.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const baseline = JSON.parse(fs.readFileSync('scratch/hardening-staging-baseline.ejson'));
const body = `import mongoose from'mongoose';import{env}from'./src/config/env.js';await mongoose.connect(env.MONGODB_URI,{dbName:env.MONGODB_DB_NAME,autoIndex:false});const db=mongoose.connection.db;if(db.databaseName!=='sensorguard_staging')throw Error('Wrong database');const data={counts:{},documents:{},indexes:{},options:{}};for(const n of ${JSON.stringify(Object.keys(baseline.counts))}){data.counts[n]=await db.collection(n).countDocuments({},{maxTimeMS:2000});if(data.counts[n]>20000)throw Error('Snapshot budget');data.documents[n]=await db.collection(n).find({},{maxTimeMS:2000}).toArray();data.indexes[n]=await db.collection(n).indexes();data.options[n]=(await db.listCollections({name:n}).toArray())[0].options;}console.log(mongoose.mongo.BSON.EJSON.stringify(data));await mongoose.disconnect();`;
const raw = execFileSync('docker', ['exec','-i','sensorguard-phase8-staging-api-1','node','--input-type=module'], { input: body, encoding:'utf8', maxBuffer:10*1024*1024, stdio:['pipe','pipe','pipe'] });
const current = JSON.parse(raw);
const ordered = v => Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k,ordered(v[k])])) : v;
const same = (a,b) => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
const report = { at:new Date(), collections:{}, success:true };
for (const name of Object.keys(baseline.counts)) {
  const after = new Map(current.documents[name].map(d => [JSON.stringify(d._id), d]));
  const result = { before:baseline.counts[name], after:current.counts[name], missing:0, unexpectedChanges:[], operationalChanges:[], indexesUnchanged:same(baseline.indexes[name],current.indexes[name]), optionsUnchanged:same(baseline.options[name],current.options[name]) };
  for (const prior of baseline.documents[name]) {
    const next = after.get(JSON.stringify(prior._id)); if (!next) { result.missing++; continue; }
    const changed = [...new Set([...Object.keys(prior),...Object.keys(next)])].filter(k => !same(prior[k],next[k]));
    const allowed = name === 'sensors' ? ['detection','healthStatus'] : name === 'incidents' && prior.conditionKey === 'offline' ? ['updatedAt','observedAt','lastEventId','detectionRevision','readingValue'] : [];
    const unexpected = changed.filter(k => !allowed.includes(k));
    if (unexpected.length) result.unexpectedChanges.push({id:prior._id,fields:unexpected});
    if (changed.length) result.operationalChanges.push({id:prior._id,fields:changed,expectedOnly:!unexpected.length});
  }
  if (result.missing || result.unexpectedChanges.length || result.before !== result.after || !result.indexesUnchanged || !result.optionsUnchanged) report.success=false;
  report.collections[name]=result;
}
fs.writeFileSync('scratch/hardening-staging-preservation.json', JSON.stringify(report,null,2));
console.log(JSON.stringify({success:report.success,collections:Object.fromEntries(Object.entries(report.collections).map(([n,v]) => [n,{before:v.before,after:v.after,missing:v.missing,unexpectedChanges:v.unexpectedChanges.length,indexesUnchanged:v.indexesUnchanged,optionsUnchanged:v.optionsUnchanged}]))}));
if (!report.success) process.exitCode=1;
