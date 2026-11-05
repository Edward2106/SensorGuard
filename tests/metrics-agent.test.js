import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { createMetrics } from '../src/observability/metrics.js';

test('configured Agent host receives real UDP metrics outside default loopback', { timeout: 8000 }, async () => {
  const previous = process.env.DD_AGENT_HOST;
  const server = dgram.createSocket('udp4');
  await new Promise(resolve => server.bind(0, '127.0.0.2', resolve));
  process.env.DD_AGENT_HOST = '127.0.0.2';
  const metrics = createMetrics({ enabled: true, port: server.address().port, environment: 'qa', service: 'sensorguard-worker' });
  try {
    const packet = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Configured Agent did not receive UDP')), 3000);
      server.once('message', data => { clearTimeout(timer); resolve(data.toString()); });
    });
    metrics.emit('telemetry.processed');
    assert.equal(await packet, 'sensorguard.telemetry.processed:1|c|#service:sensorguard-worker,env:qa');
  } finally {
    metrics.close(); server.close();
    if (previous === undefined) delete process.env.DD_AGENT_HOST;
    else process.env.DD_AGENT_HOST = previous;
  }
});
