import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thresholdAt, thresholdSegments, historyEntry, sealEntry, configDigest, UNAVAILABLE } from '../src/services/threshold-history.js';
const config = { type: 'temperature', unit: 'C', thresholds: { warningHigh: 60 }, detectionSettings: {} };
test('threshold lookup is causal; before first revision is never inferred from previous/current values', () => {
  const first = sealEntry(historyEntry({}, config, { userId: 'op', role: 'OPERATOR' }, new Date('2026-01-01')));
  const sensor = { ...config, configurationRevision: 1, thresholdHistory: [first] };
  const next = sealEntry(historyEntry(sensor, { ...config, thresholds: { warningHigh: 100 } }, { userId: 'admin', role: 'ADMIN' }, new Date('2026-01-02')));
  sensor.thresholdHistory.push(next);
  assert.equal(thresholdAt(sensor, '2025-12-31').status, UNAVAILABLE);
  assert.equal(thresholdAt(sensor, '2026-01-01T23:59:59Z').config.thresholds.warningHigh, 60);
  assert.equal(thresholdAt(sensor, '2026-01-02').revision, 2);
  assert.equal(next.previousHash, first.hash);
  assert.notEqual(configDigest({ at: new Date(0) }), configDigest({ at: new Date(1) }));
  assert.deepEqual(thresholdSegments(sensor, new Date('2025-12-31'), new Date('2026-01-03')).map(s => s.status), [UNAVAILABLE, 'AVAILABLE', 'AVAILABLE']);
});
test('monotonic effective boundaries and legacy previous values do not manufacture old history', () => {
  const legacy = { ...config };
  const first = historyEntry(legacy, config, null, new Date(100));
  assert.equal(first.revision, 1); assert.deepEqual(first.previous.thresholds, { warningHigh: 60 });
  const second = historyEntry({ ...legacy, configurationRevision: 1, thresholdHistory: [first] }, config, null, new Date(100));
  assert.equal(+second.effectiveAt, 101); assert.equal(+second.recordedAt, 100);
  assert.equal(thresholdAt({ ...legacy, thresholdHistory: [first] }, new Date(99)).status, UNAVAILABLE);
});
