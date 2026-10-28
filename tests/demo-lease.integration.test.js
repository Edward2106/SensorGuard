import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { createDemoProcessor } from '../src/queues/demo.worker.js';
const uri = process.env.PHASE9_TEST_MONGO_URI;
test('zombie demo with expired/replaced lease sends no telemetry and cannot release successor lease', { skip: !uri }, async () => {
  assert.equal(uri, 'mongodb://127.0.0.1:27029');
  const c = new MongoClient(uri); await c.connect();
  try {
    const db = c.db('sg_demo_fence_test_' + Date.now());
    const cmd = await db.admin().command({ getCmdLineOpts: 1 });
    assert.equal(cmd.parsed.net.port, 27029); assert.match(cmd.parsed.storage.dbPath.replaceAll('\\', '/'), /\/scratch\/phase9-mongo-\d+$/);
    const successorExpiresAt = new Date(Date.now() + 300000);
    await db.collection('demo_control').insertOne({ _id: 'global', owner: 'successor', expiresAt: successorExpiresAt });
    await db.collection('demo_runs').insertOne({ _id: 'expired-job', sensorId: 'DEMO-EXPIRED', scenario: 'SERVER_OVERHEATING', state: 'QUEUED', createdAt: new Date(), deadline: new Date(Date.now() - 1000), timeline: [] });
    await assert.rejects(createDemoProcessor(db)({ data: { runId: 'expired-job' } }));
    assert.equal((await db.collection('demo_runs').findOne({ _id: 'expired-job' })).state, 'TIMED_OUT');
    const lock = await db.collection('demo_control').findOne({ _id: 'global' });
    assert.equal(lock.owner, 'successor'); assert.equal(+lock.expiresAt, +successorExpiresAt);
    for (const name of ['sensors', 'sensor_readings', 'incidents', 'telemetry_events']) assert.equal(await db.collection(name).countDocuments(), 0);
  } finally { await c.close(); }
});
