// Run inside the isolated QA API container with DD_TRACE_ENABLED=false.
import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
assert.equal(process.env.MONGODB_URI, 'mongodb://mongo:27029/sg_apm_qa');
assert.equal(process.env.DD_TRACE_ENABLED, 'false');
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
try {
  const db = client.db('sg_apm_qa');
  // A metadata-only QA fixture; never insert synthetic readings or incidents.
  await db.collection('sensors').updateOne({ sensorId: 'APM-QA-READ-ONLY' }, { $setOnInsert: {
    sensorId: 'APM-QA-READ-ONLY', name: 'Offline APM QA fixture', type: 'temperature', unit: 'C', status: 'maintenance', createdAt: new Date(), updatedAt: new Date(),
  } }, { upsert: true });
  const headers = { 'x-api-key': process.env.API_KEY };
  const before = await (await fetch('http://receiver:8126/summary')).json();
  const beforeExpress = before.services?.['sensorguard-api']?.operations?.['express.request'] || 0;
  const results = [];
  for (let i = 0; i < 3; i++) for (const path of ['/health', '/ready', '/api/v1/sensors?limit=5', '/api/v1/workers']) {
    const res = await fetch(`http://api:3000${path}`, { headers, signal: AbortSignal.timeout(5000) });
    await res.arrayBuffer(); assert.equal(res.status, 200, path); results.push({ path, status: res.status });
  }
  let summary;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    summary = await (await fetch('http://receiver:8126/summary')).json();
    if ((summary.services?.['sensorguard-api']?.operations?.['express.request'] || 0) - beforeExpress >= results.length && summary.services?.['sensorguard-worker']?.spans > 0) break;
  }
  assert.ok(summary.services?.['sensorguard-api']?.operations?.['express.request'] - beforeExpress >= results.length, 'Automatic Express instrumentation for all 12 GETs');
  assert.ok(summary.services?.['sensorguard-worker']?.spans > 0, 'Worker spans received');
  assert.equal(summary.rejected, 0);
  console.log(JSON.stringify({ status: 'PASS', instrumentation: 'VERIFIED', localReceiver: 'VERIFIED', cloud: 'NOT_ATTEMPTED', http: results, expressRequestIncrease: summary.services['sensorguard-api'].operations['express.request'] - beforeExpress, receiver: summary }, null, 2));
} finally { await client.close(); }
