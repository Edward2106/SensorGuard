import { logger as obsLogger } from './observability/logger.js';
import http from 'node:http';
import { closeReadingCache, getCacheClient } from './services/reading-cache.js';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectMongo, disconnectMongo } from './config/db.js';
import { getRedisClient, disconnectRedis } from './config/redis.js';
import { SHUTDOWN_TIMEOUT_MS } from './config/constants.js';
import { closeTelemetryQueue } from './queues/telemetry.queue.js';

let server = null;
let isShuttingDown = false;

async function gracefulShutdown(signal, exitCode = 0) {
  if (isShuttingDown) {
    // eslint-disable-next-line no-console
    obsLogger.warn('[Shutdown] Already in progress, ignoring duplicate signal...');
    return;
  }
  isShuttingDown = true;
  // eslint-disable-next-line no-console
  obsLogger.info(`[Shutdown] Received ${signal}. Starting graceful shutdown...`);

  // Force shutdown timer in case of deadlock
  const forceTimer = setTimeout(() => {
    // eslint-disable-next-line no-console
    obsLogger.error(`[Shutdown] Timeout of ${SHUTDOWN_TIMEOUT_MS}ms exceeded. Forcing exit.`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceTimer.unref();

  try {
    if (server) {
      await new Promise((resolve) => {
        server.close((err) => {
          if (err) {
            // eslint-disable-next-line no-console
            obsLogger.error('[Shutdown] Error closing HTTP server:', err.message);
          } else {
            // eslint-disable-next-line no-console
            obsLogger.info('[Shutdown] HTTP server closed');
          }
          resolve();
        });
      });
    }

    await closeTelemetryQueue();
    closeReadingCache();
    await disconnectMongo();
    await disconnectRedis();

    // eslint-disable-next-line no-console
    obsLogger.info('[Shutdown] All connections closed. Clean exit.');
    await obsLogger.flush();
    process.exit(exitCode);
  } catch (error) {
    // eslint-disable-next-line no-console
    obsLogger.error('[Shutdown] Error during shutdown:', error);
    process.exit(1);
  }
}

async function bootstrap() {
  // eslint-disable-next-line no-console
  obsLogger.info(`[SensorGuard] Initializing in ${env.NODE_ENV} mode...`);

  // Connect downstream services (non-fatal in dev mode if services not yet up)
  try {
    await connectMongo();
  } catch (error) {
    // eslint-disable-next-line no-console
    obsLogger.warn('MongoDB initial connection deferred', error);
  }

  try {
    const redis = getRedisClient();
    await redis.ping().catch((err) => {
      // eslint-disable-next-line no-console
      obsLogger.warn('Redis ping deferred', err);
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    obsLogger.warn('Redis initialization deferred', error);
  }

  const app = createApp();
  getCacheClient(true);
  server = http.createServer(app);

  server.listen(env.PORT, env.HOST, () => {
    // eslint-disable-next-line no-console
    obsLogger.info(`[SensorGuard API] Listening on http://${env.HOST}:${env.PORT}`);
    // eslint-disable-next-line no-console
    obsLogger.info(`[SensorGuard API] Health check available at http://${env.HOST}:${env.PORT}/health`);
  });

  // Process termination signals
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM', 0));
  process.on('SIGINT', () => gracefulShutdown('SIGINT', 0));

  process.on('uncaughtException', (err) => {
    // eslint-disable-next-line no-console
    obsLogger.error('[Fatal] Uncaught Exception:', err);
    gracefulShutdown('uncaughtException', 1);
  });

  process.on('unhandledRejection', (reason) => {
    // eslint-disable-next-line no-console
    obsLogger.error('[Fatal] Unhandled Rejection:', reason);
    gracefulShutdown('unhandledRejection', 1);
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  obsLogger.error('[Bootstrap] Fatal startup error:', err);
  process.exit(1);
});
