// Paired old/new service comparison on the EXACT retained history fixture, read-only.
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { getAnalytics } from '../src/services/analytics.service.js';
const previous = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.match(previous.database, /^sg_phase9_bench_\d+$/);
assert.equal(process.env.PHASE9_TEST_MONGO_URI, 'mongodb://127.0.0.1:27029');
const client = new MongoClient(process.env.PHASE9_TEST_MONGO_URI); await client.connect();
try {
  const db = client.db(previous.database), cmd = await db.admin().command({ getCmdLineOpts: 1 });
  assert.equal(cmd.parsed.net.port, 27029); assert.match(cmd.parsed.storage.dbPath.replaceAll('\\', '/'), /\/scratch\/phase9-mongo-\d+$/);
  assert.equal(await db.collection('sensor_readings').countDocuments(), 240000);
  assert.equal((await db.collection('sensors').findOne({ sensorId: 'BENCH-0' })).thresholdHistory.length, 256);
  const query = { sensorId: 'BENCH-0', from: '2026-01-01T00:00:00.000Z', to: new Date(Date.parse('2026-01-01') + 60000000).toISOString(), granularity: '1m' };
  // The retained pre-optimization module lives in scratch; rewrite its local imports
  // in-memory into a separate ignored module, never edit or overwrite the evidence.
  const oldPath = 'scratch/hardening-analytics-before-sweep.js';
  const oldBytes = fs.readFileSync(oldPath);
  const oldModulePath = 'scratch/hardening-analytics-before-sweep-runnable.mjs';
  const oldSource = oldBytes.toString().replace("'../errors/app-errors.js'", "'../src/errors/app-errors.js'").replace("'./threshold-history.js'", "'../src/services/threshold-history.js'");
  fs.writeFileSync(oldModulePath, oldSource, { flag: 'wx' });
  const old = (await import(pathToFileURL(path.resolve(oldModulePath)))).getAnalytics;
  assert.deepEqual(await old(db, query), await getAnalytics(db, query));
  const collect = async fn => { for (let i = 0; i < 5; i++) await fn(db, query); const samplesMs = []; for (let i = 0; i < 50; i++) { const start = performance.now(); await fn(db, query); samplesMs.push(performance.now() - start); } const a = [...samplesMs].sort((x,y) => x-y); return { samplesMs, p50: (a[24]+a[25])/2, p95: a[47], p99: a[49] }; };
  const report = { at: new Date(), database: db.databaseName, readings: 240000, historyRevisions: 256, buckets: 1000,
    beforeSourceSha256: createHash('sha256').update(oldBytes).digest('hex'), afterSourceSha256: createHash('sha256').update(fs.readFileSync('src/services/analytics.service.js')).digest('hex'),
    before: await collect(old), after: await collect(getAnalytics), exactResponseEqual: true,
    notes: 'Same fixture/indexes/query; 5 warmups+50 samples for old then new; p99=max, order/cache noise remain; no production SLA.' };
  const file = 'scratch/hardening-history-benchmark-' + Date.now() + '.json';
  fs.writeFileSync(file, JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ file, before: report.before, after: report.after, exactResponseEqual: true }));
} finally { await client.close(); }
