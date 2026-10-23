import { UnrecoverableError } from 'bullmq';
import { performance } from 'node:perf_hooks';
import { validateTelemetry } from './telemetry.validation.js';
import { metrics as telemetryMetrics } from '../observability/metrics.js';
import { logger as defaultLogger } from '../observability/logger.js';

export function createTelemetryProcessor({ store, cache, metrics = { processed: 0, duplicates: 0, failed: 0, cacheFailures: 0, totalMs: 0 }, logger = defaultLogger }) {
  const processor = async (job) => {
    const start = performance.now();
    try {
      try { validateTelemetry(job.data); } catch (error) { throw new UnrecoverableError(error.message); }
      const data = { ...job.data, sensorId: job.data.sensorId.trim().toUpperCase(), eventId: job.data.eventId || `legacy-job-${job.id}`, timestamp: job.data.timestamp || job.data.enqueuedAt };
      if (!data.timestamp || !job.id && !job.data.eventId) throw new UnrecoverableError('Missing stable timestamp or event identity');
      try { validateTelemetry(data); } catch (error) { throw new UnrecoverableError(error.message); }
      data.timestamp = new Date(data.timestamp).toISOString();
      const result = await store.persist(data);
      await store.updateSensor(result.reading);
      if (store.detect) {
        const detectionStart = performance.now();
        try { await store.detect(result.reading); }
        finally { telemetryMetrics.emit('detection.duration_ms', performance.now() - detectionStart); }
      }
      // Refill from Mongo's latest, not this job: cache expiry must not make delayed events current.
      try { await cache.put(await store.latest(data.sensorId)); }
      catch { metrics.cacheFailures++; logger.warn('[Telemetry] Cache refresh failed; MongoDB fallback remains available'); }
      metrics.processed++;
      telemetryMetrics.emit('telemetry.processed');
      if (result.duplicate) metrics.duplicates++;
      return { eventId: data.eventId, duplicate: result.duplicate };
    } catch (error) { metrics.failed++; telemetryMetrics.emit('telemetry.failed'); throw error; }
    finally { const elapsed = performance.now() - start; metrics.totalMs += elapsed; telemetryMetrics.emit('worker.duration_ms', elapsed); }
  };
  processor.metrics = metrics;
  return processor;
}
