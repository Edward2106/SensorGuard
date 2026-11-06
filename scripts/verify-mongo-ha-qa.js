// Host must stop rs1 ONLY after READY; this same client reconnects after election.
import { MongoClient } from 'mongodb';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
const client = new MongoClient('mongodb://rs1:27017,rs2:27017,rs3:27017/?replicaSet=sgQA', {serverSelectionTimeoutMS:45000,retryWrites:true});
await client.connect();
try {
  const hello = await client.db('admin').command({hello:1});
  assert.equal(hello.setName,'sgQA'); assert.equal(hello.hosts.length,3); assert.equal(hello.primary,'rs1:27017');
  const collection = client.db('sg_ha_qa_'+Date.now()).collection('durability');
  await collection.insertOne({_id:'before',value:42},{writeConcern:{w:'majority',wtimeoutMS:10000}});
  console.log('READY '+JSON.stringify({primary:hello.primary,database:collection.dbName}));
  await delay(10000);
  const start = Date.now();
  await collection.insertOne({_id:'after',value:43},{writeConcern:{w:'majority',wtimeoutMS:30000}});
  const elected = await client.db('admin').command({hello:1});
  assert.notEqual(elected.primary,hello.primary);
  assert.equal(await collection.countDocuments(),2);
  assert.equal((await collection.findOne({_id:'before'})).value,42);
  console.log(JSON.stringify({status:'PASS',database:collection.dbName,previousPrimary:hello.primary,newPrimary:elected.primary,majorityDocuments:2,reconnectWriteMs:Date.now()-start,sameClient:true}));
} finally {await client.close();}
