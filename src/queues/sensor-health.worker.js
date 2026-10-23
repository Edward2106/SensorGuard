import { logger as obsLogger } from '../observability/logger.js';
import { Queue, Worker } from 'bullmq';
import { env } from '../config/env.js';
import { redisConnectionOptions } from '../config/redis.js';

export async function startSensorHealthWorker(store, { prefix, interval = env.SENSOR_HEALTH_INTERVAL_MS } = {}) {
  const options = { connection: redisConnectionOptions, ...(prefix ? { prefix } : {}) };
  const queue = new Queue('sensor-health', options);
  const worker = new Worker('sensor-health', () => store.checkHealth(), { ...options, concurrency: 1 });
  queue.on('error', error => obsLogger.error('[SensorHealth Queue]', { name: error.name, code: error.code }));
  worker.on('error', error => obsLogger.error('[SensorHealth Worker]', { name: error.name, code: error.code }));
  worker.on('failed', (job, error) => obsLogger.error('[SensorHealth] Scan failed; durable work retained', { jobId: job?.id, error: error.name, code: error.code }));
  try {
    await queue.upsertJobScheduler('sensor-health-periodic', { every: interval }, {
      name: 'check-sensors', data: {}, opts: { attempts: env.TELEMETRY_ATTEMPTS, backoff: { type: 'exponential', delay: env.TELEMETRY_BACKOFF_MS }, removeOnComplete: 100, removeOnFail: 1000 },
    });
    await worker.waitUntilReady();
  } catch (error) { await worker.close(); await queue.close(); throw error; }
  return { queue, worker, async close() { await worker.close(); await queue.close(); } };
}
