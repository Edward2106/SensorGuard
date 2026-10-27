import { logger as obsLogger } from '../observability/logger.js';
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { DETECTED_TYPES, thresholdObservation, validateDetectionConfig, DetectionConfigError } from './detection.rules.js';

const durable = { writeConcern: { w: 'majority' } };
const idFor = (sensorId, condition, eventId) => `ALT-AUTO-${createHash('sha256').update(JSON.stringify([sensorId, condition, eventId])).digest('hex')}`;
const enabled = sensor => !['maintenance', 'inactive'].includes(sensor.status);

export async function ensureDetectionStorage(db = mongoose.connection.db) {
  // Only automated active incidents participate; existing manually created alerts are untouched.
  await db.collection('incidents').createIndex({ sensorId: 1, conditionKey: 1 }, {
    name: 'uniq_active_detector_condition', unique: true,
    partialFilterExpression: { managedBy: 'detector', active: true },
  });
  await db.collection('sensors').createIndex({ 'detection.hasPending': 1 });
  await db.collection('telemetry_events').createIndex({ detectionPending: 1, state: 1, 'reading.timestamp': 1 });
}

export function createDetector(db = mongoose.connection.db, { clock = () => new Date() } = {}) {
  const sensors = db.collection('sensors');
  const incidents = db.collection('incidents');

  async function flush(sensor) {
    const state = sensor.detection;
    if (!state?.hasPending) return;
    for (const effect of state.pending) {
      const { incident, action, eventId, at, observedAt, severity, value, threshold, reason } = effect;
      const incidentId = new mongoose.Types.ObjectId(createHash('sha256').update(incident.alertId).digest('hex').slice(0, 24));
      if (action === 'open') {
        // _id is deterministic too: replay after an uncertain insert is safe even without autoIndex.
        try {
          await incidents.updateOne({ _id: incidentId }, { $setOnInsert: {
            _id: incidentId, ...incident, status: 'open', active: true, managedBy: 'detector',
            eventId, lastEventId: eventId, observedAt, severity, readingValue: value, threshold,
            createdAt: at, updatedAt: at, detectionRevision: state.revision,
            history: [{ action: 'opened', at, observedAt, eventId, severity, value, threshold }],
          } }, { upsert: true, ...durable });
        } catch (error) { if (error.code !== 11000) throw error;
          if (!await incidents.findOne({ _id: incidentId, alertId: incident.alertId })) throw error;
        }
      } else {
        const changes = { updatedAt: at, lastEventId: eventId, observedAt, detectionRevision: state.revision };
        if (action === 'resolve') Object.assign(changes, { status: 'resolved', active: false, resolvedAt: at, resolvedBy: 'system', resolutionNotes: reason, recoveryEventId: eventId });
        else Object.assign(changes, { severity, readingValue: value, threshold });
        const update = { $set: changes };
        if (action === 'resolve' || action === 'escalate') update.$push = { history: { action: action === 'resolve' ? reason : 'escalated', at, observedAt, eventId, severity } };
        await incidents.updateOne({ _id: incidentId, status: { $ne: 'resolved' }, detectionRevision: { $lt: state.revision } }, update, durable);
      }
    }
    // Clearing is revision-fenced; a stale flusher cannot erase another worker's pending actions.
    await sensors.updateOne({ _id: sensor._id, 'detection.revision': state.revision, 'detection.hasPending': true }, { $set: { 'detection.hasPending': false, 'detection.pending': [] } }, durable);
  }

  async function transition(sensorId, decide) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const sensor = await sensors.findOne({ sensorId });
      if (!sensor) return;
      if (sensor.detection?.hasPending) { await flush(sensor); continue; }
      const prior = sensor.detection || { revision: 0, conditions: {}, monitoringSince: clock() };
      const next = structuredClone(prior);
      next.conditions ||= {};
      next.pending = [];
      if (!decide(sensor, next)) return;
      next.revision = prior.revision + 1;
      next.hasPending = next.pending.length > 0;
      const filter = {
        _id: sensor._id, 'detection.revision': sensor.detection ? prior.revision : { $exists: false },
        lastSeen: sensor.lastSeen ?? null, status: sensor.status ?? null,
        type: sensor.type ?? null,
        thresholds: sensor.thresholds ?? null, detectionSettings: sensor.detectionSettings ?? null,
      };
      const set = { detection: next };
      if (next.healthStatus) set.healthStatus = next.healthStatus;
      const result = await sensors.updateOne(filter, { $set: set }, durable);
      if (result.modifiedCount) { await flush({ ...sensor, detection: next }); return; }
    }
    throw new Error('Detection contention; retry required');
  }

  function applyCondition(sensor, state, key, observation, eventId, observedAt, value, required = 1) {
    const at = clock();
    const current = state.conditions[key];
    if (observation.severity) {
      const severity = current?.severity === 'critical' ? 'critical' : observation.severity;
      const incident = current?.incident || { alertId: idFor(sensor.sensorId, key, eventId), sensorId: sensor.sensorId, conditionKey: key, type: key, title: `${sensor.sensorId}: ${key}` };
      state.conditions[key] = { incident, severity, goodReadings: 0 };
      state.pending.push({ incident, action: !current ? 'open' : severity !== current.severity ? 'escalate' : 'update', severity, eventId, at, observedAt, value, threshold: observation.threshold });
    } else if (current) {
      current.goodReadings = observation.recovered ? (current.goodReadings || 0) + 1 : 0;
      if (current.goodReadings >= required) {
        state.pending.push({ incident: current.incident, action: 'resolve', eventId, at, observedAt, reason: observation.reason || 'recovered' });
        delete state.conditions[key];
      }
    }
  }

  function healthDecision(sensor, state, now, eventId) {
    if (state.healthObservedAt && now < state.healthObservedAt) return;
    validateDetectionConfig(sensor);
    const timeout = (sensor.detectionSettings?.offlineAfterSeconds ?? env.SENSOR_OFFLINE_AFTER_SECONDS) * 1000;
    const lastSeen = sensor.lastSeen && new Date(sensor.lastSeen) <= new Date(+now + env.TELEMETRY_MAX_FUTURE_SECONDS * 1000) ? new Date(sensor.lastSeen) : null;
    const reference = lastSeen || sensor.createdAt || state.monitoringSince;
    const age = Math.max(0, +now - +new Date(reference));
    const offline = enabled(sensor) && age > timeout;
    // Reconnect inside half the timeout: delayed packets near the offline boundary cannot flap it.
    const recovered = !enabled(sensor) || (lastSeen && age <= timeout / 2);
    state.healthObservedAt = now;
    state.healthStatus = !enabled(sensor) ? 'unknown' : offline || (state.conditions.offline && !recovered) ? 'offline' : lastSeen ? 'online' : 'unknown';
    applyCondition(sensor, state, 'offline', {
      severity: offline ? 'high' : null, recovered,
      threshold: timeout / 1000, reason: enabled(sensor) ? 'reconnected' : 'monitoring_suspended',
    }, eventId, now, age / 1000);
  }

  return {
    async onReading(reading) {
      const timestamp = new Date(reading.timestamp);
      const now = clock();
      if (timestamp > new Date(+now + env.TELEMETRY_MAX_FUTURE_SECONDS * 1000)) return;
      await transition(reading.metadata.sensorId, (sensor, state) => {
        healthDecision(sensor, state, now, reading.eventId);
        // Live state is monotonic. Equal timestamp events use the first accepted observation.
        if (enabled(sensor) && DETECTED_TYPES.includes(sensor.type) && reading.metadata.type === sensor.type &&
            (!state.readingAt || timestamp > state.readingAt) && (!sensor.lastSeen || timestamp >= sensor.lastSeen)) {
          validateDetectionConfig(sensor);
          for (const direction of ['high', 'low']) {
            const observation = thresholdObservation(reading.value, sensor.thresholds, direction, sensor.detectionSettings);
            if (observation.configured) applyCondition(sensor, state, `${sensor.type}_${direction}`, observation, reading.eventId, timestamp, reading.value, sensor.detectionSettings?.recoveryReadings ?? env.DETECTION_RECOVERY_READINGS);
            else if (state.conditions[`${sensor.type}_${direction}`]) applyCondition(sensor, state, `${sensor.type}_${direction}`, { recovered: true, reason: 'rule_disabled' }, reading.eventId, timestamp, reading.value);
          }
          state.readingAt = timestamp;
          state.readingEventId = reading.eventId;
        }
        return true;
      });
    },
    async checkSensor(sensorId, now = clock()) {
      await transition(sensorId, (sensor, state) => {
        if (state.healthObservedAt && now < state.healthObservedAt) return false;
        healthDecision(sensor, state, now, `health-${sensorId}-${now.toISOString()}`);
        return true;
      });
    },
    async checkAll() {
      // Streaming cursor bounds memory; every sensor is revisited after scheduler restart.
      let failures = 0;
      for await (const sensor of sensors.find({}, { projection: { sensorId: 1 } })) {
        try { await this.checkSensor(sensor.sensorId); }
        catch (error) {
          if (!(error instanceof DetectionConfigError)) throw error;
          failures++; obsLogger.error('[Detection] Sensor configuration invalid', { sensorId: sensor.sensorId, error: error.name });
        }
      }
      if (failures) throw new Error(`Sensor-health scan failed for ${failures} sensors; retry required`);
    },
    async drainPending() {
      for await (const sensor of sensors.find({ 'detection.hasPending': true })) await flush(sensor);
    },
  };
}
