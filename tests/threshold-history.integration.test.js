import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { SensorService } from '../src/services/sensor.service.js';
import { Sensor } from '../src/models/sensor.model.js';
import { thresholdAt, HISTORY_LIMIT, configDigest } from '../src/services/threshold-history.js';
import { ensureTelemetryStorage, createTelemetryStore } from '../src/services/telemetry.store.js';
import { createRecoveryService } from '../src/services/recovery.service.js';
import { getAnalytics } from '../src/services/analytics.service.js';
const uri = process.env.PHASE9_TEST_MONGO_URI;
test('real MongoDB atomic threshold revisions, concurrency, late telemetry, legacy and recovery fencing', { skip: !uri }, async () => {
  assert.equal(uri, 'mongodb://127.0.0.1:27029');
  await mongoose.connect(uri, { dbName: 'sg_threshold_test_' + Date.now(), autoIndex: false });
  try {
    const db = mongoose.connection.db, cmd = await db.admin().command({ getCmdLineOpts: 1 });
    assert.equal(cmd.parsed.net.port, 27029); assert.match(cmd.parsed.storage.dbPath.replaceAll('\\', '/'), /\/scratch\/phase9-mongo-\d+$/);
    await ensureTelemetryStorage(db);
    const actor = { userId: 'fixture-op', role: 'OPERATOR' };
    const input = { sensorId: 'HISTORY-1', name: 'QA history', type: 'temperature', unit: 'C', status: 'active', thresholds: { warningHigh: 60, criticalHigh: 120 }, detectionSettings: { offlineAfterSeconds: 3600, hysteresis: 3, recoveryReadings: 3 } };
    const created = await SensorService.createSensor(input, actor);
    assert.equal(created.configurationRevision, 1); assert.equal(created.thresholdHistory, undefined);
    const original = await Sensor.findOne({ sensorId: input.sensorId }).select('+thresholdHistory').lean();
    const timestamp = new Date(+original.thresholdHistory[0].effectiveAt + 1);
    await new Promise(r => setTimeout(r, 20));
    await SensorService.updateSensor(input.sensorId, { unit: ' C ', thresholds: { warningHigh: 100, criticalHigh: 120, ignoredBySchema: 'not a threshold' }, thresholdHistory: [], configurationRevision: 999 }, actor);
    let sensor = await Sensor.findOne({ sensorId: input.sensorId }).select('+thresholdHistory').lean();
    assert.equal(sensor.configurationRevision, 2); assert.equal(sensor.thresholdHistory.length, 2);
    assert.deepEqual(sensor.thresholdHistory[1].config.thresholds, { warningHigh: 100, criticalHigh: 120 });
    assert.equal(sensor.thresholdHistory[1].config.unit, 'C');
    const store = createTelemetryStore(db);
    const data = { sensorId: input.sensorId, eventId: 'history-late', value: 75, timestamp: timestamp.toISOString(), enqueuedAt: new Date().toISOString(), type: 'temperature', unit: 'C' };
    const reading = (await store.persist(data)).reading; await store.updateSensor(reading); await store.detect(reading);
    const incident = await db.collection('incidents').findOne({ sensorId: input.sensorId, conditionKey: 'temperature_high' });
    assert.equal(incident.threshold, 60); assert.equal(incident.history[0].thresholdSnapshot.revision, 1);
    assert.equal(incident.history[0].thresholdSnapshot.status, 'AVAILABLE');
    const recovery = createRecoveryService(db, { analyze: async () => ({ data: { algorithmVersion: 'fixture' } }) });
    const workflow = await recovery.propose(incident.alertId, actor);
    await SensorService.updateSensor(input.sensorId, { thresholds: { warningHigh: 61, criticalHigh: 120 } }, actor);
    await SensorService.updateSensor(input.sensorId, { thresholds: { warningHigh: 100, criticalHigh: 120 } }, actor);
    await assert.rejects(recovery.approve(workflow._id, actor, true), { statusCode: 409 });
    await Promise.all(Array.from({ length: 6 }, (_, i) => SensorService.updateSensor(input.sensorId, { thresholds: { warningHigh: 70 + i, criticalHigh: 120 } }, actor)));
    sensor = await Sensor.findOne({ sensorId: input.sensorId }).select('+thresholdHistory').lean();
    assert.equal(sensor.configurationRevision, 10); assert.equal(sensor.thresholdHistory.length, 10);
    for (let i = 0; i < sensor.thresholdHistory.length; i++) {
      const { hash, ...entry } = sensor.thresholdHistory[i];
      assert.equal(hash, configDigest(entry));
      assert.equal(entry.revision, i + 1);
      if (i) { assert.equal(entry.previousHash, sensor.thresholdHistory[i - 1].hash); assert.ok(+entry.effectiveAt > +sensor.thresholdHistory[i - 1].effectiveAt); }
    }
    await SensorService.updateSensor(input.sensorId, { name: 'Metadata only' }, actor);
    assert.equal((await SensorService.getSensorById(input.sensorId)).configurationRevision, 10);
    await new Promise(r => setTimeout(r, 5));
    const analytics = await getAnalytics(db, { sensorId: input.sensorId, from: new Date(+timestamp - 1000).toISOString(), to: new Date().toISOString(), granularity: '1m' });
    assert.equal(analytics.data.summary.count, 1);
    assert.equal(analytics.data.series[0].historicalThreshold.status, 'MIXED_CONFIGURATIONS');
    assert.equal(analytics.data.historicalThresholds[0].status, 'HISTORICAL_THRESHOLD_UNAVAILABLE');
    await db.collection('sensors').insertOne({ ...input, sensorId: 'LEGACY-HISTORY' });
    await SensorService.updateSensor('LEGACY-HISTORY', { thresholds: { warningHigh: 80 } }, actor);
    const legacy = await db.collection('sensors').findOne({ sensorId: 'LEGACY-HISTORY' });
    assert.equal(legacy.configurationRevision, 1);
    assert.equal(thresholdAt(legacy, new Date(+legacy.thresholdHistory[0].effectiveAt - 1)).status, 'HISTORICAL_THRESHOLD_UNAVAILABLE');
    await db.collection('sensors').insertOne({ ...input, sensorId: 'HISTORY-FULL', configurationRevision: HISTORY_LIMIT, thresholdHistory: Array.from({ length: HISTORY_LIMIT }, () => ({ revision: 1 })) });
    await assert.rejects(SensorService.updateSensor('HISTORY-FULL', { thresholds: { warningHigh: 80 } }, actor), { statusCode: 409 });
    await SensorService.createSensor({ ...input, sensorId: 'HISTORY-RACE' }, actor);
    const duplicate = { ...data, sensorId: 'HISTORY-RACE', eventId: 'two-workers-same-event', timestamp: new Date().toISOString(), enqueuedAt: new Date().toISOString() };
    const stores = [createTelemetryStore(db), createTelemetryStore(db)];
    const attempts = await Promise.allSettled(stores.map(s => s.persist(duplicate)));
    assert.ok(attempts.some(r => r.status === 'fulfilled'));
    for (const attempt of attempts) if (attempt.status === 'rejected') assert.match(attempt.reason.message, /EVENT_WRITE_UNCERTAIN/);
    // A competing ledger lease deliberately requests a retry, just as BullMQ does.
    const persisted = await Promise.all(stores.map((s, i) => attempts[i].status === 'fulfilled' ? attempts[i].value : s.persist(duplicate)));
    await Promise.all(stores.map(async (s, i) => { await s.updateSensor(persisted[i].reading); await s.detect(persisted[i].reading); }));
    assert.equal(await db.collection('sensor_readings').countDocuments({ 'metadata.sensorId': 'HISTORY-RACE' }), 1);
    assert.equal(await db.collection('incidents').countDocuments({ sensorId: 'HISTORY-RACE', active: true }), 1);
    console.log('Retained threshold fixture ' + db.databaseName);
  } finally { await mongoose.disconnect(); }
});
