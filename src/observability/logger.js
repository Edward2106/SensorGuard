import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, appendFile, stat, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const logContext = new AsyncLocalStorage();
const fields = new Set(['requestId','traceId','spanId','method','route','statusCode','durationMs','name','code','attemptsMade','jobId','eventId','sensorId','error']);
export function redact(value) {
  let s = String(value).replace(/[\r\n]/g, ' ');
  for (const [key, secret] of Object.entries(process.env)) if (/KEY|TOKEN|PASSWORD|SECRET|MONGODB_URI/i.test(key) && secret?.length >= 4) s = s.split(secret).join('[REDACTED]');
  return s.replace(/(?:mongodb(?:\+srv)?|redis|https?):\/\/[^\s]+/gi, '[URL]')
    .replace(/(authorization|password|api[_-]?key|token|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]').slice(0, 2000);
}
export function createLogger({ directory = process.env.SENSORGUARD_LOG_DIR || path.resolve('logs'), maxBytes = 5 * 1024 * 1024, backups = 3, stdout = line => process.stdout.write(line), trace = () => {
  const tracer = require.cache[require.resolve('dd-trace')]?.exports;
  const span = tracer?.scope?.().active(); const carrier = {};
  if (span) tracer.inject(span.context(), 'log', carrier);
  return carrier.dd;
}, service = () => process.env.DD_SERVICE || (process.argv[1]?.endsWith('worker.js') ? 'sensorguard-worker' : 'sensorguard-api') } = {}) {
  let tail = Promise.resolve(), pending = 0;
  const stats = { dropped: 0, writeErrors: 0 };
  function emit(level, message, ...data) {
    try {
      const name = typeof service === 'function' ? service() : service;
      const safeService = ['sensorguard-api','sensorguard-worker'].includes(name) ? name : 'sensorguard-api';
      const dd = trace() || {};
      const record = { timestamp: new Date().toISOString(), level, service: safeService, env: process.env.DD_ENV || process.env.NODE_ENV || 'development', message: redact(message), ...logContext.getStore() };
      for (const obj of data) if (obj && typeof obj === 'object') {
        if (obj instanceof Error) { record.error = obj.name; continue; }
        for (const [key, value] of Object.entries(obj)) if (fields.has(key)) record[key] = value instanceof Error ? value.name : typeof value === 'number' ? value : redact(typeof value === 'object' ? value?.name || 'Error' : value);
      }
      if (dd.trace_id) { record.dd = dd; record.traceId = dd.trace_id; record.spanId = dd.span_id; }
      const line = JSON.stringify(record) + '\n';
      stdout(line);
      if (!directory) return;
      if (pending >= 1000) { stats.dropped++; return; }
      pending++;
      tail = tail.then(async () => {
        await mkdir(directory, { recursive: true });
        const file = path.join(directory, `${safeService}-${process.pid}.log`);
        const size = await stat(file).then(s => s.size).catch(() => 0);
        if (size + Buffer.byteLength(line) > maxBytes && size > 0) {
          await unlink(`${file}.${backups}`).catch(e => { if (e.code !== 'ENOENT') throw e; });
          for (let i = backups - 1; i >= 1; i--) await rename(`${file}.${i}`,`${file}.${i+1}`).catch(e => { if (e.code !== 'ENOENT') throw e; });
          await rename(file,`${file}.1`);
        }
        await appendFile(file,line);
      }).catch(() => { stats.writeErrors++; }).finally(() => { pending--; });
    } catch { stats.writeErrors++; }
  }
  return { info: (...args) => emit('info',...args), warn: (...args) => emit('warn',...args), error: (...args) => emit('error',...args), debug: (...args) => { if (process.env.LOG_LEVEL === 'debug') emit('debug',...args); }, flush: () => tail, stats };
}
export const logger = createLogger();
