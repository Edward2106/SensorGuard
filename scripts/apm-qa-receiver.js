// Offline protocol test sink, NOT a Datadog Agent or a Cloud delivery verifier.
import http from 'node:http';
import { pathToFileURL } from 'node:url';
// BullMQ's locked MessagePack dependency; no additional package is installed.
import { unpack } from 'msgpackr';

export function createReceiver({ upstream } = {}) {
  if (upstream && upstream !== 'http://agent:8126') throw new Error('Only the isolated QA Agent is allowed');
  const ids = new Set(), spanIds = new Set(), services = {};
  const graph = new Map();
  let forwarded = 0, forwardErrors = 0, errorSpans = 0;
  let requests = 0, rejected = 0;
  const rejectionReasons = {};
  const summary = () => {
    const shared = new Map(); let producerConsumerEdges = 0;
    for (const s of graph.values()) {
      const set = shared.get(s.trace) || new Set(); set.add(s.service); shared.set(s.trace,set);
      const parent = graph.get(s.parent);
      if (s.name === 'bullmq.processJob' && parent && parent.trace === s.trace && parent.service !== s.service) producerConsumerEdges++;
    }
    return { traceRequests: requests, uniqueTraces: ids.size, uniqueSpans: spanIds.size, rejected, rejectionReasons, services, forwarded, forwardErrors, errorSpans, crossServiceTraces: [...shared.values()].filter(s=>s.size>1).length, producerConsumerEdges };
  };
  return http.createServer(async (req, res) => {
    const reply = (code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.method === 'GET' && req.url === '/summary') return reply(200, summary());
    if (req.method === 'GET' && req.url === '/info') return reply(200, { endpoints: ['/v0.4/traces'], client_drop_p0s: false });
    if (req.method !== 'PUT' || req.url !== '/v0.4/traces') return reply(404, {});
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 2 * 1024 * 1024) throw new Error('Payload limit'); chunks.push(chunk); }
      const body = Buffer.concat(chunks);
      const traces = unpack(body);
      if (!Array.isArray(traces) || !traces.length) throw new Error('Invalid traces');
      const spans = traces.flat();
      if (spanIds.size + spans.length > (upstream ? 50000 : 10000)) throw new Error('Span limit');
      for (const s of spans) {
        if (!s || !['sensorguard-api', 'sensorguard-worker'].includes(s.service)) throw new Error('Service');
        if (s.meta?.env !== 'qa') throw new Error('Environment');
        if (!s.trace_id || !s.span_id) throw new Error('Identifiers');
        if (!(typeof s.duration === 'bigint' ? s.duration >= 0n : Number.isFinite(s.duration) && s.duration >= 0)) throw new Error('Duration');
      }
      for (const s of spans) {
        // v0.4 carries the low 64-bit ID on every span; high bits may be root-only.
        const trace = String(s.trace_id);
        const id = `${trace}:${s.span_id}`;
        if (spanIds.has(id)) continue;
        ids.add(trace); spanIds.add(id);
        graph.set(String(s.span_id), { trace, parent: String(s.parent_id), service: s.service, name: s.name });
        if (s.error) errorSpans++;
        const service = services[s.service] ||= { spans: 0, operations: {}, environments: ['qa'] };
        service.spans++;
        // No tags, resource names, URLs, payloads, SQL or credentials are retained.
        const name = String(s.name).slice(0, 80);
        service.operations[name] = (service.operations[name] || 0) + 1;
      }
      if (upstream) {
        try {
          const response = await fetch(upstream + '/v0.4/traces', { method: 'PUT', headers: { 'content-type': 'application/msgpack', 'x-datadog-trace-count': String(traces.length) }, body, signal: AbortSignal.timeout(5000) });
          await response.arrayBuffer(); if (!response.ok) throw new Error('Agent rejected'); forwarded++;
        } catch { forwardErrors++; return reply(502, {error:'QA Agent unavailable'}); }
      }
      requests++;
      reply(200, { rate_by_service: {} });
    } catch (error) { rejected++; const reason = ['Span limit','Service','Environment','Identifiers','Duration','Payload limit','Invalid traces'].includes(error.message) ? error.message : 'MessagePack decode'; rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1; reply(400, { error: 'Invalid or oversized QA trace payload' }); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const upstream = process.env.APM_QA_FORWARD_TO_AGENT === 'true' ? 'http://agent:8126' : undefined;
  const server = createReceiver({ upstream });
  server.listen(8126, '0.0.0.0', () => console.log(JSON.stringify({ event: 'qa.receiver.ready', forwarding: !!upstream })));
  process.on('SIGTERM', () => server.close());
}
