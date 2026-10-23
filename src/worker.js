import { logger as obsLogger } from './observability/logger.js';
import { Worker } from 'bullmq';
import mongoose from 'mongoose';
import { startGaugeCollector } from './observability/metrics.js';
import { getTelemetryQueue, closeTelemetryQueue } from './queues/telemetry.queue.js';
import { pathToFileURL } from 'node:url';
import { env } from './config/env.js';
import { QUEUES } from './config/constants.js';
import { connectMongo, disconnectMongo } from './config/db.js';
import { redisConnectionOptions } from './config/redis.js';
import { ensureTelemetryStorage, createTelemetryStore } from './services/telemetry.store.js';
import { createReadingCache, getCacheClient, closeReadingCache } from './services/reading-cache.js';
import { createTelemetryProcessor } from './services/telemetry.processor.js';
import { startSensorHealthWorker } from './queues/sensor-health.worker.js';

export function createTelemetryWorker(processor, options = {}) {
  const worker = new Worker(QUEUES.TELEMETRY_INGESTION, processor, {
    connection: redisConnectionOptions, concurrency: env.WORKER_CONCURRENCY,
    maxStalledCount: 2, ...options,
  });
  worker.on('error', (error) => obsLogger.error('[Worker] Connection/worker error', { name: error.name, code: error.code }));
  worker.on('failed', (job, error) => obsLogger.error('[Worker] Job failed', { jobId: job?.id, eventId: job?.data?.eventId, sensorId: job?.data?.sensorId, attemptsMade: job?.attemptsMade, error: error.name, code: error.code }));
  worker.on('stalled', (jobId) => obsLogger.warn('[Worker] Stalled job scheduled for recovery', { jobId }));
  return worker;
}

export function createShutdown({ worker, health, closeMongo = disconnectMongo, closeCache = closeReadingCache }) {
  let closing;
  return () => closing ||= (async () => {
    await Promise.all([worker.close(), health?.close()]);
    closeCache();
    await closeMongo();
  })();
}

export async function startWorker() {
  await connectMongo();
  await ensureTelemetryStorage();
  const store = createTelemetryStore();
  const processor = createTelemetryProcessor({ store, cache: createReadingCache(getCacheClient(true)) });
  const worker = createTelemetryWorker(processor);
  let health;
  try { health = await startSensorHealthWorker(store); }
  catch (error) { await worker.close(); throw error; }
  const close = createShutdown({ worker, health });
  const gauges = startGaugeCollector({ db: mongoose.connection.db,
    queue: process.env.SENSORGUARD_METRICS_ENABLED === 'true' && process.env.SENSORGUARD_GAUGES_ENABLED === 'true' ? getTelemetryQueue() : null });
  let stopping = false;
  const shutdown = async (signal, exitCode = 0) => {
    if (stopping) return;
    stopping = true;
    obsLogger.info('[Worker] Draining active jobs', { signal });
    const timer = setTimeout(() => {
      obsLogger.error('[Worker] Drain deadline exceeded; exiting with failure. Active jobs require stalled-job recovery and ledger reconciliation.');
      process.exit(1);
    }, env.WORKER_SHUTDOWN_TIMEOUT_MS);
    try { gauges.close(); await close(); await closeTelemetryQueue(); await obsLogger.flush(); process.exitCode = exitCode; }
    catch { process.exitCode = 1; }
    finally { clearTimeout(timer); }
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('uncaughtException', () => shutdown('uncaughtException', 1));
  process.once('unhandledRejection', () => shutdown('unhandledRejection', 1));
  await worker.waitUntilReady();
  obsLogger.info('[Worker] Consuming telemetry-ingestion', { concurrency: env.WORKER_CONCURRENCY });
  return worker;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startWorker().catch(async (error) => {
    obsLogger.error('[Worker] Startup failed', { name: error.name, code: error.code });
    closeReadingCache();
    await disconnectMongo();
    process.exitCode = 1;
  });
}
