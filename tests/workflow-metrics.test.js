import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { createMetrics } from '../src/observability/metrics.js';
import { startHeartbeat } from '../src/services/worker-heartbeat.js';
test('global enablement alone cannot enable new demo or heartbeat metric series', () => {
  const m = createMetrics({ enabled: true, workflowEnabled: false, socketFactory: () => { throw Error('Unexpected metric transport'); } });
  for (const name of ['demo.created', 'demo.verified', 'demo.failed', 'demo.timed_out', 'worker.heartbeat']) m.emit(name);
  assert.deepEqual(m.stats, { sent: 0, dropped: 0, errors: 0 }); m.close();
});
test('opt-in workflow metrics reach loopback UDP with only bounded service/environment tags', { timeout: 8000 }, async () => {
  const server = dgram.createSocket('udp4'); await new Promise(r => server.bind(0, '127.0.0.1', r));
  const m = createMetrics({ enabled: true, workflowEnabled: true, port: server.address().port, environment: 'test', service: 'sensorguard-worker' });
  try {
    const received = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('UDP timeout')), 3000); server.once('message', b => { clearTimeout(timer); resolve(b.toString()); }); });
    m.emit('demo.verified'); assert.equal(await received, 'sensorguard.demo.verified:1|c|#service:sensorguard-worker,env:test');
  } finally { m.close(); server.close(); }
});
test('heartbeat metric observes successful Redis write, never a failed write', async () => {
  for (const failed of [false, true]) {
    let calls = 0;
    const chain = { set() { return this; }, zadd() { return this; }, zremrangebyscore() { return this; }, exec: async () => [[failed ? Error('offline') : null, 'OK']] };
    const client = { on() {}, multi: () => chain, set: async () => {}, disconnect() {} };
    const heartbeat = startHeartbeat({ isRunning: () => true, isPaused: () => false }, { client, onHeartbeat: () => calls++ });
    await new Promise(r => setImmediate(r)); await heartbeat.close();
    assert.equal(calls, failed ? 0 : 1);
  }
});
