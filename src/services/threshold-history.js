import { createHash } from 'node:crypto';
export const HISTORY_LIMIT = 256;
export const UNAVAILABLE = 'HISTORICAL_THRESHOLD_UNAVAILABLE';
// Explicit fields only: caller cannot supply revisions, actors or effective timestamps.
export function thresholdConfig(sensor) {
  const pick = (source, names) => Object.fromEntries(names.filter(k => source?.[k] !== undefined).map(k => [k, source[k]]));
  return { type: sensor.type, unit: typeof sensor.unit === 'string' ? sensor.unit.trim() : sensor.unit,
    thresholds: pick(sensor.thresholds, ['warningLow','warningHigh','criticalLow','criticalHigh']),
    detectionSettings: pick(sensor.detectionSettings, ['hysteresis','recoveryReadings','offlineAfterSeconds']) };
}
export function configDigest(config) {
  const canonical = value => value instanceof Date ? value.toISOString() : value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
  return createHash('sha256').update(JSON.stringify(canonical(config))).digest('hex');
}
export function historyEntry(sensor, next, actor, now = new Date()) {
  const history = sensor.thresholdHistory || [];
  const previous = history.at(-1);
  // A single server owns timestamps; monotonically increasing even within one millisecond.
  const effectiveAt = new Date(Math.max(+now, previous ? +new Date(previous.effectiveAt) + 1 : 0));
  return { revision: (sensor.configurationRevision || 0) + 1,
    effectiveAt, recordedAt: new Date(now),
    actor: { id: String(actor?.userId || 'system'), role: actor?.role || 'SYSTEM' },
    previous: sensor.type ? thresholdConfig(sensor) : null,
    config: thresholdConfig(next), previousHash: previous?.hash || null,
    semantics: 'Server-assigned event-time boundary; visible atomically with configuration; no client backdating',
  };
}
export function sealEntry(entry) {
  return { ...entry, hash: configDigest(entry) };
}
export function thresholdAt(sensor, eventTime) {
  const at = +new Date(eventTime);
  const entry = (sensor.thresholdHistory || []).findLast(e => +new Date(e.effectiveAt) <= at);
  if (!entry) return { status: UNAVAILABLE };
  return { status: 'AVAILABLE', revision: entry.revision, effectiveAt: entry.effectiveAt,
    recordedAt: entry.recordedAt, config: entry.config, hash: entry.hash };
}
export function thresholdSegments(sensor, from, to) {
  const changes = (sensor.thresholdHistory || []).filter(e => +new Date(e.effectiveAt) > +from && +new Date(e.effectiveAt) < +to);
  const boundaries = [new Date(from), ...changes.map(e => new Date(e.effectiveAt)), new Date(to)];
  return boundaries.slice(0, -1).map((start, i) => ({ from: start, to: boundaries[i + 1], ...thresholdAt(sensor, start) }));
}
