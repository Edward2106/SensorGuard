import { setTimeout as sleep } from 'node:timers/promises';
export function localURL(value) {
  const u = new URL(value);
  if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('Simulator requires a plain localhost HTTP origin');
  return u.origin;
}
export function publisher({ url, apiKey, rate = 20, signal, fetchImpl = fetch }) {
  const origin = localURL(url);
  if (!Number.isFinite(rate) || rate < 1 || rate > 100) throw new Error('Rate must be 1..100 requests/second');
  let next = 0;
  const stats = { requests: 0, accepted: 0, failed: 0, uncertain: 0, sensorsCreated: 0 };
  async function request(path, method = 'GET', data) {
    await sleep(Math.max(0, next - Date.now()), undefined, { signal });
    signal?.throwIfAborted(); next = Date.now() + 1000 / rate;
    stats.requests++;
    const telemetry = path === '/api/v1/readings';
    let response;
    try {
      response = await fetchImpl(origin + path, { method, headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
        body: data === undefined ? undefined : JSON.stringify(data), redirect: 'error',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) });
      if (!response.ok) { if (telemetry) stats.failed++; throw new Error(`HTTP ${response.status} at ${path}`); }
      const body = await response.json();
      if (telemetry) { if (response.status !== 202) throw new Error('Expected enqueue acknowledgement'); stats.accepted++; }
      if (method === 'POST' && path === '/api/v1/sensors') stats.sensorsCreated++;
      return body;
    } catch (error) { if (telemetry && (!response || response.ok)) stats.uncertain++; throw error; }
  }
  return { stats, request, send: value => request('/api/v1/readings', 'POST', value), register: value => request('/api/v1/sensors', 'POST', value) };
}
