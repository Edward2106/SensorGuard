import { logger as obsLogger } from '../observability/logger.js';
import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { UnrecoverableError } from 'bullmq';
import { TIMESERIES_CONFIG } from '../config/constants.js';
import { env } from '../config/env.js';
import { createDetector, ensureDetectionStorage } from './detection.service.js';
import { DetectionConfigError } from './detection.rules.js';

const durable = { writeConcern: { w: 'majority' } };
export async function ensureTelemetryStorage(db = mongoose.connection.db) {
  const c = TIMESERIES_CONFIG;
  let existing = await db.listCollections({ name: c.collectionName }).next();
  if (!existing) {
    try {
      await db.createCollection(c.collectionName, { timeseries: { timeField: c.timeField, metaField: c.metaField, granularity: c.granularity }, expireAfterSeconds: c.expireAfterSeconds });
    } catch (error) { if (error.code !== 48) throw error; }
    existing = await db.listCollections({ name: c.collectionName }).next();
  }
  if (existing.type !== 'timeseries' || existing.options?.timeseries?.timeField !== c.timeField || existing.options?.timeseries?.metaField !== c.metaField) throw new Error('Incompatible sensor_readings collection; explicit migration required');
  await db.collection('telemetry_events').createIndex({ state: 1, updatedAt: 1 });
  await db.collection(c.collectionName).createIndex({ 'metadata.sensorId': 1, eventId: 1 });
  await ensureDetectionStorage(db);
}

export function createTelemetryStore(db = mongoose.connection.db) {
  const events = db.collection('telemetry_events');
  const readings = db.collection('sensor_readings');
  const sensors = db.collection('sensors');
  const detector = createDetector(db);
  const store = {
    async persist(data) {
      const sensor = await sensors.findOne({ sensorId: data.sensorId });
      if (!sensor) throw new UnrecoverableError('Unknown sensor');
      const reading = { eventId: data.eventId, timestamp: new Date(data.timestamp), metadata: { sensorId: data.sensorId, type: data.type || sensor.type, location: data.location || sensor.location }, value: data.value, unit: data.unit || sensor.unit, status: 'ok' };
      if (sensor.metadata?.simulated === true) Object.assign(reading.metadata, { simulated: true, demoRunId: sensor.metadata.demoRunId });
      for (const key of ['temperature', 'humidity', 'vibration', 'batteryLevel', 'signalStrength']) if (data[key] !== undefined) reading[key] = data[key];
      // Fingerprint client-owned values, excluding mutable sensor enrichment and queue metadata.
      const identity = { sensorId: data.sensorId, timestamp: data.timestampGenerated ? undefined : data.timestamp, value: data.value };
      for (const key of ['type', 'unit', 'temperature', 'humidity', 'vibration', 'batteryLevel', 'signalStrength']) if (data[key] !== undefined) identity[key] = data[key];
      const hash = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
      try {
        await events.updateOne({ _id: data.eventId }, { $setOnInsert: { hash, reading, state: 'pending', detectionPending: true, receivedAt: data.enqueuedAt && Number.isFinite(Date.parse(data.enqueuedAt)) ? new Date(data.enqueuedAt) : null, updatedAt: new Date() } }, { upsert: true, ...durable });
      } catch (error) { if (error.code !== 11000) throw error; }
      const event = await events.findOne({ _id: data.eventId }, { readConcern: { level: 'majority' } });
      if (event.hash !== hash) throw new UnrecoverableError('eventId conflicts with an existing payload');
      if (event.state === 'stored') return { reading: event.reading, duplicate: true };
      const claim = await events.updateOne({ _id: data.eventId, state: 'pending' }, { $set: { state: 'inserting', updatedAt: new Date() } }, durable);
      if (claim.modifiedCount === 1) {
        // Never repeat this insert after an uncertain outcome. Time Series has no unique event index.
        await readings.insertOne(event.reading, durable);
      } else {
        const found = await readings.findOne({ eventId: data.eventId, 'metadata.sensorId': data.sensorId }, { readConcern: { level: 'majority' } });
        if (!found) throw new Error('EVENT_WRITE_UNCERTAIN: retry reconciliation; if exhausted inspect telemetry_events before manual recovery');
      }
      await events.updateOne({ _id: data.eventId }, { $set: { state: 'stored', updatedAt: new Date() } }, durable);
      return { reading: event.reading, duplicate: claim.modifiedCount !== 1 };
    },
    async updateSensor(reading) {
      if (+new Date(reading.timestamp) > Date.now() + env.TELEMETRY_MAX_FUTURE_SECONDS * 1000) return;
      await sensors.updateOne({ sensorId: reading.metadata.sensorId, $or: [{ lastSeen: { $lt: reading.timestamp } }, { lastSeen: null }] }, [{ $set: { lastSeen: reading.timestamp, lastSeenEventId: { $literal: reading.eventId }, updatedAt: '$$NOW', status: { $cond: [{ $in: ['$status', ['maintenance', 'inactive']] }, '$status', 'active'] } } }], durable);
    },
    async detect(reading) {
      await detector.onReading(reading);
      await events.updateOne({ _id: reading.eventId, state: 'stored' }, { $set: { detectionPending: false, detectedAt: new Date() } }, durable);
    },
    async checkHealth() {
      await detector.drainPending();
      // Retry durable detection work even after the original BullMQ job exhausts its attempts.
      for await (const event of events.find({ state: 'stored', detectionPending: true }).sort({ 'reading.timestamp': 1 }).limit(500)) {
        try {
          await store.updateSensor(event.reading);
          await store.detect(event.reading);
        } catch (error) {
          if (!(error instanceof DetectionConfigError)) throw error;
          obsLogger.error('[Detection] Pending event needs configuration repair', { eventId: event._id, sensorId: event.reading.metadata.sensorId });
        }
      }
      await detector.checkAll();
    },
    latest(sensorId) { return readings.findOne({ 'metadata.sensorId': sensorId }, { sort: { timestamp: -1 } }); },
  };
  return store;
}
