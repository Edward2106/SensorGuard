import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pack } from 'msgpackr';
import { createReceiver } from '../scripts/apm-qa-receiver.js';

test('QA capture proxy cannot forward to Cloud or an arbitrary host', () => {
  assert.throws(()=>createReceiver({upstream:'https://trace.agent.us5.datadoghq.com'}), /isolated QA Agent/);
});

test('offline receiver validates protocol, deduplicates spans and discards sensitive tags', async () => {
  const server = createReceiver(); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    // Protocol fixture for this unit test only; never used as live APM evidence.
    const span = { trace_id: 1n, span_id: 2n, service: 'sensorguard-api', name: 'express.request', duration: 1n, meta: { env: 'qa', secret: 'DO-NOT-RETAIN' } };
    const send = body => fetch(origin + '/v0.4/traces', { method: 'PUT', body });
    assert.equal((await send(pack([[{...span, duration: 1}]]))).status, 200);
    assert.equal((await send(pack([[span]]))).status, 200);
    assert.equal((await send(pack([[{...span, service: 'production'}]]))).status, 400);
    assert.equal((await send(Buffer.from('invalid'))).status, 400);
    const summary = await (await fetch(origin + '/summary')).json();
    assert.equal(summary.uniqueTraces, 1); assert.equal(summary.uniqueSpans, 1); assert.equal(summary.rejected, 2);
    assert.ok(!JSON.stringify(summary).includes('DO-NOT-RETAIN'));
  } finally { await new Promise(r => server.close(r)); }
});
