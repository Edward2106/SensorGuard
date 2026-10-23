import { logger as obsLogger } from '../observability/logger.js';
import Redis from 'ioredis';
import { env } from './env.js';

export const redisConnectionOptions = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
  db: env.REDIS_DB,
  tls: env.REDIS_TLS ? {} : undefined,
  maxRetriesPerRequest: null, // Critical requirement for BullMQ
  enableReadyCheck: true,
  retryStrategy(times) {
    const delay = Math.min(times * 100, 3000);
    return delay;
  },
};

let clientInstance = null;

export function getRedisClient() {
  if (!clientInstance) {
    clientInstance = new Redis(redisConnectionOptions);

    clientInstance.on('connect', () => {
      // eslint-disable-next-line no-console
      obsLogger.info(`[Redis] Connecting to ${env.REDIS_HOST}:${env.REDIS_PORT}`);
    });

    clientInstance.on('ready', () => {
      // eslint-disable-next-line no-console
      obsLogger.info('[Redis] Connection ready');
    });

    clientInstance.on('error', (err) => {
      // eslint-disable-next-line no-console
      obsLogger.error('[Redis] Connection error:', err.message);
    });

    clientInstance.on('close', () => {
      // eslint-disable-next-line no-console
      obsLogger.warn('[Redis] Connection closed');
    });

    clientInstance.on('reconnecting', (delay) => {
      // eslint-disable-next-line no-console
      obsLogger.info(`[Redis] Reconnecting in ${delay}ms`);
    });
  }

  return clientInstance;
}

export async function disconnectRedis() {
  if (clientInstance) {
    try {
      await clientInstance.quit();
      clientInstance = null;
      // eslint-disable-next-line no-console
      obsLogger.info('[Redis] Client disconnected gracefully');
    } catch (error) {
      // eslint-disable-next-line no-console
      obsLogger.error('[Redis] Error during disconnect:', error.message);
      if (clientInstance) {
        clientInstance.disconnect();
        clientInstance = null;
      }
    }
  }
}

export async function isRedisConnected() {
  if (!clientInstance || clientInstance.status !== 'ready') return false;
  let timer;
  try {
    const pong = await Promise.race([clientInstance.ping(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Redis probe timeout')), 1500);
    })]);
    return pong === 'PONG';
  } catch {
    return false;
  } finally { clearTimeout(timer); }
}

export default {
  redisConnectionOptions,
  getRedisClient,
  disconnectRedis,
  isRedisConnected,
};
