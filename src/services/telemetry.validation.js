import { SENSOR_TYPES } from '../config/constants.js';

export function validateTelemetry(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Reading must be an object');
  if (typeof data.sensorId !== 'string' || !data.sensorId.trim()) throw new Error('sensorId is required');
  if (!Number.isFinite(data.value)) throw new Error('value must be finite');
  if (data.eventId !== undefined && (typeof data.eventId !== 'string' || !data.eventId.trim() || data.eventId.length > 200)) throw new Error('eventId must be a non-empty string of at most 200 characters');
  if (data.timestamp !== undefined) {
    if (typeof data.timestamp !== 'string' || !/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d))?$/.test(data.timestamp) || !Number.isFinite(Date.parse(data.timestamp))) throw new Error('timestamp must be an ISO date with timezone');
    const calendar = data.timestamp.slice(0, 10);
    if (new Date(`${calendar}T00:00:00Z`).toISOString().slice(0, 10) !== calendar) throw new Error('timestamp has invalid calendar date');
  }
  if (data.type !== undefined && !Object.values(SENSOR_TYPES).includes(data.type)) throw new Error('Invalid sensor type');
  for (const field of ['temperature', 'humidity', 'vibration', 'batteryLevel', 'signalStrength']) {
    if (data[field] !== undefined && !Number.isFinite(data[field])) throw new Error(`${field} must be finite`);
  }
  if (data.batteryLevel !== undefined && (data.batteryLevel < 0 || data.batteryLevel > 100)) throw new Error('Invalid batteryLevel');
  if (data.unit !== undefined && typeof data.unit !== 'string') throw new Error('unit must be a string');
}
