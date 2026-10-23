import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { env } from '../src/config/env.js';
import { profiles, reading, disconnected, SCENARIOS } from './sensor-profile.js';
import { publisher, localURL } from './publisher.js';
export function options(args) {
  const { values } = parseArgs({ args, options: Object.fromEntries(['url','sensors','rate','duration','scenario','severity','max-readings'].map(k => [k, { type: 'string' }]).concat([['help', { type: 'boolean' }]])) });
  if (values.help) return { help: true };
  const result = { url: localURL(values.url || 'http://127.0.0.1:3000'), sensors: Number(values.sensors || 120), rate: Number(values.rate || 20), duration: Number(values.duration || 30), maxReadings: Number(values['max-readings'] || 2400), scenario: values.scenario || 'NORMAL', severity: values.severity || 'critical' };
  for (const [key, max] of [['sensors',500],['rate',100],['duration',3600],['maxReadings',10000]]) if (!Number.isSafeInteger(result[key]) || result[key] < 1 || result[key] > max) throw new Error(`${key} must be 1..${max}`);
  if (!SCENARIOS.includes(result.scenario) || !['high','critical'].includes(result.severity)) throw new Error('Invalid scenario/severity');
  if (result.scenario.startsWith('SENSOR_') && result.duration < 45) throw new Error('Disconnect/recovery requires duration >= 45 seconds');
  result.offlineAfterSeconds = Math.max(10, Math.ceil(result.sensors / result.rate) + 5);
  if (result.scenario.startsWith('SENSOR_') && result.duration / 3 <= result.offlineAfterSeconds) throw new Error('Increase duration: each scenario third must exceed the offline timeout');
  return result;
}
export async function simulate(config, { signal, apiKey = env.API_KEY } = {}) {
  if (env.NODE_ENV !== 'development') throw new Error('Development only');
  const runId = `SIM-${Date.now()}-${randomUUID().slice(0,8)}`.toUpperCase();
  const pub = publisher({ ...config, apiKey, signal });
  const report = { runId, config, status: 'running', stats: pub.stats, ingestionMeaning: 'accepted means queued by REST, not confirmed stored' };
  try {
    const sensors = profiles(config.sensors, runId);
    for (const s of sensors) {
      s.detectionSettings.offlineAfterSeconds = config.offlineAfterSeconds;
      await pub.register(s);
    }
    const start = Date.now(); let sent = 0;
    while ((Date.now() - start) / 1000 < config.duration && sent < config.maxReadings) {
      signal?.throwIfAborted();
      const elapsed = (Date.now() - start) / 1000;
      if (disconnected(config.scenario, elapsed, config.duration) || (config.scenario === 'BURST_TRAFFIC' && Math.floor(elapsed) % 5 >= 2)) { await sleep(100, undefined, { signal }); continue; }
      await pub.send(reading(sensors[sent % sensors.length], config.scenario, config.severity)); sent++;
    }
    report.status = 'complete';
  } catch (error) { report.status = signal?.aborted ? 'interrupted' : 'failed'; report.error = error.name; }
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = options(process.argv.slice(2));
    if (config.help) console.log('npm run simulate -- --sensors 120 --rate 20 --duration 30 --max-readings 2400 --scenario NORMAL --severity critical --url http://127.0.0.1:3000\nScenarios: ' + SCENARIOS.join(', '));
    else {
      const controller = new AbortController(); const stop = () => controller.abort();
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      const report = await simulate(config, { signal: controller.signal }); console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.status === 'failed' ? 1 : report.status === 'interrupted' ? 130 : 0;
      process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
