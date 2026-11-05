import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureTelemetryStorage } from '../src/services/telemetry.store.js';

const metadata = { type: 'timeseries', options: { timeseries: { timeField: 'timestamp', metaField: 'metadata' } } };
function fixture(sequence, createError) {
  const state = { reads: 0, indexes: 0, creates: 0 };
  const db = {
    listCollections: () => ({ next: async () => sequence[Math.min(state.reads++, sequence.length - 1)] }),
    createCollection: async () => { state.creates++; if (createError) throw createError; },
    collection: () => ({ createIndex: async () => { state.indexes++; } }),
  };
  return { db, state };
}

test('startup tolerates delayed time-series metadata after concurrent NamespaceExists', async () => {
  const { db, state } = fixture([null, null, null, metadata], Object.assign(new Error('Concurrent create'), { code: 48 }));
  await ensureTelemetryStorage(db);
  assert.equal(state.creates, 1);
  assert.ok(state.indexes > 0);
});

test('metadata timeout fails closed without indexing an unknown collection', { timeout: 5000 }, async () => {
  const { db, state } = fixture([null]);
  await assert.rejects(ensureTelemetryStorage(db), /metadata unavailable/);
  assert.equal(state.indexes, 0);
  assert.ok(state.reads <= 21);
});

test('concurrent creation never bypasses incompatible-schema or non-conflict errors', async () => {
  const wrong = fixture([null, { type: 'collection' }], Object.assign(new Error('Concurrent create'), { code: 48 }));
  await assert.rejects(ensureTelemetryStorage(wrong.db), /Incompatible/);
  assert.equal(wrong.state.indexes, 0);
  const denied = fixture([null], Object.assign(new Error('Denied'), { code: 13 }));
  await assert.rejects(ensureTelemetryStorage(denied.db), /Denied/);
  assert.equal(denied.state.indexes, 0);
});
