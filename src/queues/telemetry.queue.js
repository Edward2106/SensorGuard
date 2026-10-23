import { logger as obsLogger } from '../observability/logger.js';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { Queue } from 'bullmq';
import { QUEUES } from '../config/constants.js';
import { redisConnectionOptions, isRedisConnected } from '../config/redis.js';
import { ServiceUnavailableError } from '../errors/app-errors.js';
import { metrics } from '../observability/metrics.js';

let telemetryQueueInstance = null;

async function withTimeout(operation, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new ServiceUnavailableError(message)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

/**
 * Get or initialize BullMQ telemetry queue instance
 */
export function getTelemetryQueue() {
  if (!telemetryQueueInstance) {
    telemetryQueueInstance = new Queue(QUEUES.TELEMETRY_INGESTION, {
      connection: { ...redisConnectionOptions, maxRetriesPerRequest: 1, enableOfflineQueue: false },
      defaultJobOptions: {
        attempts: env.TELEMETRY_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: env.TELEMETRY_BACKOFF_MS,
        },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });

    telemetryQueueInstance.on('error', (err) => {
      // eslint-disable-next-line no-console
      obsLogger.error('[TelemetryQueue] BullMQ Error:', err.message);
    });
  }

  return telemetryQueueInstance;
}

/**
 * Enqueue a single telemetry reading with connectivity & timeout guard.
 * Strictly guarantees that HTTP 202 is only possible if job was enqueued in Redis.
 */
export async function enqueueReading(readingPayload) {
  // Pre-check Redis connectivity to fail fast if offline
  const isConnected = await isRedisConnected();
  if (!isConnected) {
    throw new ServiceUnavailableError('Queue service unavailable: Redis is disconnected. Cannot accept telemetry.');
  }

  const queue = getTelemetryQueue();
  const jobData = {
    ...readingPayload,
    eventId: readingPayload.eventId ?? randomUUID(),
    enqueuedAt: new Date().toISOString(),
  };

  try {
    // Timeout guard in case Redis operation blocks
    const job = await withTimeout(queue.add('telemetry-reading', jobData), 3000, 'Enqueue operation timed out');
    if (!job || !job.id) {
      throw new ServiceUnavailableError('Failed to obtain job confirmation from telemetry queue');
    }

    metrics.emit('telemetry.received');
    return {
      jobId: String(job.id),
      status: 'queued',
      enqueuedAt: jobData.enqueuedAt,
    };
  } catch (error) {
    if (error instanceof ServiceUnavailableError) {
      throw error;
    }
    throw new ServiceUnavailableError(`Telemetry enqueue failed: ${error.message}`);
  }
}

/**
 * Enqueue a batch of telemetry readings with connectivity & timeout guard.
 */
export async function enqueueBatchReadings(readingsList) {
  const isConnected = await isRedisConnected();
  if (!isConnected) {
    throw new ServiceUnavailableError('Queue service unavailable: Redis is disconnected. Cannot accept batch telemetry.');
  }

  const queue = getTelemetryQueue();
  const now = new Date().toISOString();

  const bulkJobs = readingsList.map((reading, index) => ({
    name: 'telemetry-reading',
    data: {
      ...reading,
      eventId: reading.eventId ?? randomUUID(),
      batchIndex: index,
      enqueuedAt: now,
    },
  }));

  try {
    const jobs = await withTimeout(queue.addBulk(bulkJobs), 5000, 'Batch enqueue operation timed out');
    if (!Array.isArray(jobs) || jobs.length !== readingsList.length) {
      throw new ServiceUnavailableError('Batch enqueue failed to complete all items');
    }

    metrics.emit('telemetry.received', jobs.length);
    return {
      status: 'queued',
      count: jobs.length,
      jobIds: jobs.map((j) => String(j.id)),
      enqueuedAt: now,
    };
  } catch (error) {
    if (error instanceof ServiceUnavailableError) {
      throw error;
    }
    throw new ServiceUnavailableError(`Batch telemetry enqueue failed: ${error.message}`);
  }
}

/**
 * Gracefully close telemetry queue connection
 */
export async function closeTelemetryQueue() {
  if (telemetryQueueInstance) {
    try {
      await telemetryQueueInstance.close();
      telemetryQueueInstance = null;
      // eslint-disable-next-line no-console
      obsLogger.info('[TelemetryQueue] Closed queue connection');
    } catch (err) {
      // eslint-disable-next-line no-console
      obsLogger.error('[TelemetryQueue] Error closing queue:', err.message);
      telemetryQueueInstance = null;
    }
  }
}

/**
 * Allow injecting mock queue for testing
 */
export function setTelemetryQueueInstance(instance) {
  telemetryQueueInstance = instance;
}

export default {
  getTelemetryQueue,
  enqueueReading,
  enqueueBatchReadings,
  closeTelemetryQueue,
  setTelemetryQueueInstance,
};
