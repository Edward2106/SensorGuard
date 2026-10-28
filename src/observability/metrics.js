import dgram from 'node:dgram';
import { env } from '../config/env.js';
export const METRICS = Object.freeze({
  'sensors.online':'g', 'sensors.offline':'g', 'telemetry.received':'c', 'telemetry.processed':'c', 'telemetry.failed':'c',
  'queue.waiting':'g', 'queue.failed':'g', 'worker.duration_ms':'h', 'incidents.open':'g', 'incidents.critical':'g',
  'detection.duration_ms':'h', 'api.requests':'c', 'api.errors':'c', 'api.duration_ms':'h',
  'recovery.proposed':'c', 'recovery.approved':'c', 'recovery.verified':'c', 'recovery.failed':'c', 'recovery.timed_out':'c',
  'demo.created':'c', 'demo.verified':'c', 'demo.failed':'c', 'demo.timed_out':'c', 'worker.heartbeat':'c',
});
export function createMetrics({ enabled = process.env.SENSORGUARD_METRICS_ENABLED === 'true', recoveryEnabled = process.env.SENSORGUARD_RECOVERY_METRICS_ENABLED === 'true', workflowEnabled = process.env.SENSORGUARD_WORKFLOW_METRICS_ENABLED === 'true', port = Number(process.env.DD_DOGSTATSD_PORT || 8125), host = '127.0.0.1', service = process.env.DD_SERVICE || (process.argv[1]?.endsWith('worker.js') ? 'sensorguard-worker' : 'sensorguard-api'), environment = process.env.DD_ENV || env.NODE_ENV, socketFactory = () => dgram.createSocket('udp4') } = {}) {
  let socket; const stats = { sent:0, dropped:0, errors:0 }; let pending = 0;
  const clean = s => String(s).replace(/[^a-zA-Z0-9_.-]/g,'_').slice(0,60);
  function emit(name, value = 1) {
    if (!enabled || !METRICS[name] || !Number.isFinite(value) || value < 0) return;
    if (name.startsWith('recovery.') && !recoveryEnabled) return;
    if ((name.startsWith('demo.') || name === 'worker.heartbeat') && !workflowEnabled) return;
    try {
      if (!socket) { socket = socketFactory(); socket.on('error', () => { stats.errors++; }); socket.unref(); }
      if (pending >= 128) { stats.dropped++; return; }
      pending++;
      const packet = Buffer.from(`sensorguard.${name}:${value}|${METRICS[name]}|#service:${clean(service)},env:${clean(environment)}`);
      socket.send(packet, port, host, err => { pending--; if (err) stats.errors++; else stats.sent++; });
    } catch { pending = Math.max(0,pending-1); stats.errors++; }
  }
  return { emit, stats, close() { try { socket?.close(); } catch {} socket = undefined; } };
}
export const metrics = createMetrics();

// One designated worker owns global gauges. Other worker replicas leave this off.
export function startGaugeCollector({ db, queue, emit = metrics.emit, interval = 30000, enabled = process.env.SENSORGUARD_METRICS_ENABLED === 'true' && process.env.SENSORGUARD_GAUGES_ENABLED === 'true' }) {
  let busy = false, stopped = false;
  async function collect() {
    if (busy || stopped) return; busy = true;
    try {
      const sensors = db.collection('sensors'), incidents = db.collection('incidents');
      const opts = { maxTimeMS: 2000 };
      const [online,offline,open,critical,counts] = await Promise.all([
        sensors.countDocuments({status:{$nin:['maintenance','inactive']},healthStatus:'online'},opts),
        sensors.countDocuments({status:{$nin:['maintenance','inactive']},healthStatus:'offline'},opts),
        incidents.countDocuments({status:{$in:['open','acknowledged']}},opts),
        incidents.countDocuments({status:{$in:['open','acknowledged']},severity:'critical'},opts),
        queue.getJobCounts('waiting','prioritized','failed'),
      ]);
      if (!stopped) for (const [key,value] of Object.entries({ 'sensors.online':online,'sensors.offline':offline,'incidents.open':open,'incidents.critical':critical,'queue.waiting':counts.waiting + counts.prioritized,'queue.failed':counts.failed })) emit(key,value);
    } catch { /* Observability must never fail ingestion or emit false zeroes. */ }
    finally { busy = false; }
  }
  const timer = enabled ? setInterval(collect,interval) : null; timer?.unref();
  if (enabled) void collect();
  return { collect, close() { stopped = true; if (timer) clearInterval(timer); } };
}
