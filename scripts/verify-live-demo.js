import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import mongoose from 'mongoose';
import { Queue, QueueEvents } from 'bullmq';
import { env } from '../src/config/env.js';
import { redisConnectionOptions, getRedisClient, disconnectRedis } from '../src/config/redis.js';
import { createApp } from '../src/app.js';
import { setTelemetryQueueInstance } from '../src/queues/telemetry.queue.js';
import { createTelemetryWorker } from '../src/worker.js';
import { createTelemetryStore, ensureTelemetryStorage } from '../src/services/telemetry.store.js';
import { createTelemetryProcessor } from '../src/services/telemetry.processor.js';
import { createDetector } from '../src/services/detection.service.js';
import { startSensorHealthWorker } from '../src/queues/sensor-health.worker.js';
import { createReadingCache, getCacheClient, closeReadingCache } from '../src/services/reading-cache.js';
import { profiles, reading } from '../simulator/sensor-profile.js';
import { publisher } from '../simulator/publisher.js';

const uri = new URL(env.MONGODB_URI);
assert.equal(env.NODE_ENV, 'development'); assert.equal(uri.protocol, 'mongodb:');
assert.equal(uri.hostname, '127.0.0.1'); assert.ok(['27017','27018'].includes(uri.port));
assert.equal(env.MONGODB_DB_NAME, 'sensorguard'); assert.equal(env.REDIS_HOST, '127.0.0.1');
assert.ok([6379,6380].includes(env.REDIS_PORT));
const runId = `LIVE-${Date.now()}-${randomUUID().slice(0,8)}`.toUpperCase();
const report = { runId, status: 'running', mongoPort: uri.port, redisPort: env.REDIS_PORT, checks: [] };
const names = ['sensors','sensor_readings','incidents','telemetry_events'];
const digest = value => createHash('sha256').update(value).digest('hex');
const envDigest = digest(await readFile(new URL('../.env', import.meta.url)));
const sensors = profiles(120, runId).map(s => ({ ...s, detectionSettings: { ...s.detectionSettings, offlineAfterSeconds: 120 } }));
let worker, server, queue, events, health, pub;
const file = new URL(`../demo-output/${runId}.json`, import.meta.url);
await mkdir(new URL('../demo-output/', import.meta.url), { recursive: true });
try {
  await mongoose.connect(env.MONGODB_URI, { dbName: env.MONGODB_DB_NAME, autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  const db = mongoose.connection.db;
  const counts = async () => Object.fromEntries(await Promise.all(names.map(async n => [n, await db.collection(n).countDocuments()])));
  report.before = await counts();
  const originals = new Map();
  for (const name of names) {
    const docs = new Map();
    for await (const d of db.collection(name).find()) docs.set(String(d._id), digest(JSON.stringify(d)));
    originals.set(name, docs);
  }
  await getRedisClient().ping(); await ensureTelemetryStorage(db);
  const prefix = runId.toLowerCase(); report.queuePrefix = prefix;
  queue = new Queue('telemetry-ingestion', { connection: redisConnectionOptions, prefix });
  setTelemetryQueueInstance(queue);
  events = new QueueEvents('telemetry-ingestion', { connection: redisConnectionOptions, prefix });
  const cacheClient = getCacheClient(true);
  if (cacheClient.status !== 'ready') await once(cacheClient, 'ready', { signal: AbortSignal.timeout(10000) });
  const processor = createTelemetryProcessor({ store: createTelemetryStore(db), cache: createReadingCache(cacheClient) });
  worker = createTelemetryWorker(processor, { prefix });
  await Promise.all([worker.waitUntilReady(), events.waitUntilReady()]);
  server = createApp().listen(0, '127.0.0.1'); await once(server, 'listening');
  pub = publisher({ url: `http://127.0.0.1:${server.address().port}`, apiKey: env.API_KEY, rate: 40 });
  report.ready = await pub.request('/ready');
  for (const sensor of sensors) await pub.register(sensor);
  const send = async (sensor, scenario = 'NORMAL', severity = 'critical', value) => {
    const r = reading(sensor, scenario, severity); if (value !== undefined) { r.value = value; r[sensor.type] = value; }
    const result = await pub.send(r); const job = await queue.getJob(result.jobId);
    assert.ok(job, 'API must return a queued job'); await job.waitUntilFinished(events, 15000); return r;
  };
  const incident = (s, key) => db.collection('incidents').findOne({ sensorId: s.sensorId, conditionKey: key });
  for (const sensor of sensors) await send(sensor);
  assert.equal(await db.collection('incidents').countDocuments({ sensorId: { $in: sensors.map(s => s.sensorId) } }), 0);
  report.checks.push('120 normal sensors: no incidents');
  const temp = sensors[0];
  await send(temp, 'HIGH_TEMPERATURE', 'high'); let a = await incident(temp, 'temperature_high'); assert.equal(a.severity, 'high');
  const ack = await pub.request(`/api/v1/alerts/${a.alertId}/acknowledge`, 'PATCH', { acknowledgedBy: 'simulator' }); assert.equal(ack.data.status, 'acknowledged');
  await send(temp, 'HIGH_TEMPERATURE'); a = await incident(temp, 'temperature_high'); assert.equal(a.severity, 'critical');
  await send(temp, 'HIGH_TEMPERATURE');
  assert.equal(await db.collection('incidents').countDocuments({ sensorId: temp.sensorId }), 1);
  await send(temp, 'NORMAL', 'critical', 29); assert.notEqual((await incident(temp, 'temperature_high')).status, 'resolved');
  await send(temp); await send(temp); assert.notEqual((await incident(temp, 'temperature_high')).status, 'resolved');
  await send(temp); assert.equal((await incident(temp, 'temperature_high')).status, 'resolved');
  report.checks.push('high -> acknowledge -> critical escalation; deduplication; hysteresis; three-reading recovery');
  for (const [sensor, scenario, key] of [[sensors[1],'HIGH_HUMIDITY','humidity_high'],[sensors[2],'HIGH_VIBRATION','vibration_high'],[sensors[3],'LOW_TEMPERATURE','temperature_low']]) {
    await send(sensor, scenario); const alert = await incident(sensor, key); assert.equal(alert.severity, 'critical');
    if (scenario === 'LOW_TEMPERATURE') {
      const resolved = await pub.request(`/api/v1/alerts/${alert.alertId}/resolve`, 'PATCH', { resolvedBy: 'simulator', resolutionNotes: 'Live API verification' }); assert.equal(resolved.data.status, 'resolved');
    }
    for (let i = 0; i < 3; i++) await send(sensor);
    assert.equal((await incident(sensor, key)).status, 'resolved');
  }
  report.checks.push('humidity/vibration/low temperature; automatic and API resolution');
  const offline = sensors[6];
  await pub.request(`/api/v1/sensors/${offline.sensorId}`, 'PATCH', { detectionSettings: { ...offline.detectionSettings, offlineAfterSeconds: 2 } });
  await send(offline);
  const detector = createDetector(db);
  // Use the existing scheduled worker, scoped to this run's disconnect sensor.
  // Never scan/mutate unrelated existing demo sensors during this verification.
  health = await startSensorHealthWorker({ checkHealth: () => detector.checkSensor(offline.sensorId) }, { prefix, interval: 250 });
  const deadline = Date.now() + 10000;
  while (!(await incident(offline, 'offline')) && Date.now() < deadline) await sleep(100);
  assert.equal((await incident(offline, 'offline'))?.status, 'open');
  await send(offline); assert.equal((await incident(offline, 'offline')).status, 'resolved');
  await health.queue.removeJobScheduler('sensor-health-periodic'); await health.close(); health = null;
  report.checks.push('scheduled offline detection and real-time reconnect recovery');
  // Graceful worker restart with actual queued telemetry.
  await worker.close(); worker = null;
  const result = await pub.send(reading(sensors[9]));
  worker = createTelemetryWorker(processor, { prefix }); await worker.waitUntilReady();
  await (await queue.getJob(result.jobId)).waitUntilFinished(events, 15000);
  report.checks.push('worker restart processes queued reading');
  for (const sensor of sensors) await pub.request(`/api/v1/sensors/${sensor.sensorId}`, 'PATCH', { status: 'maintenance' });
  report.demoSensorsFinalStatus = 'maintenance';
  const filter = { sensorId: { $in: sensors.map(s => s.sensorId) } };
  report.incidents = await db.collection('incidents').find(filter, { projection: { _id: 0, alertId: 1, sensorId: 1, severity: 1, status: 1, conditionKey: 1 } }).toArray();
  report.storedReadings = await db.collection('sensor_readings').countDocuments({ 'metadata.sensorId': filter.sensorId });
  assert.equal(report.storedReadings, pub.stats.accepted);
  report.queueCounts = await queue.getJobCounts(); assert.equal(report.queueCounts.failed, 0);
  report.after = await counts();
  for (const [name, docs] of originals) {
    for await (const d of db.collection(name).find()) if (docs.has(String(d._id))) { assert.equal(digest(JSON.stringify(d)), docs.get(String(d._id)), `Original ${name} changed`); docs.delete(String(d._id)); }
    assert.equal(docs.size, 0);
  }
  report.originalsUnchanged = true; assert.equal(digest(await readFile(new URL('../.env', import.meta.url))), envDigest); report.envUnchanged = true;
  report.status = 'complete';
} catch (error) { report.status = 'failed'; report.error = { name: error.name, message: error.message }; process.exitCode = 1; }
finally {
  if (health) { await health.queue.removeJobScheduler('sensor-health-periodic'); await health.close(); }
  if (server) await new Promise(resolve => server.close(resolve));
  await worker?.close(); await events?.close(); await queue?.close(); setTelemetryQueueInstance(null);
  closeReadingCache(); await disconnectRedis(); await mongoose.disconnect();
  report.stats = pub?.stats; report.finishedAt = new Date().toISOString();
  await writeFile(file, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
}
