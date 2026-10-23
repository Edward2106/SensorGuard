import express from 'express';
import { env } from './config/env.js';
import { isMongoConnected } from './config/db.js';
import { isRedisConnected } from './config/redis.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { errorHandler } from './middleware/error-handler.js';
import apiV1Router from './routes/index.js';
import { logger, logContext } from './observability/logger.js';
import { metrics } from './observability/metrics.js';

export function createApp() {
  const app = express();

  // Attach unique Request ID & header to all incoming requests
  app.use(requestIdMiddleware);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use((req, res, next) => logContext.run({ requestId: String(req.id).replace(/[^\w-]/g,'').slice(0,128) }, () => {
    const start = performance.now();
    res.on('finish', () => {
      const durationMs = performance.now() - start;
      metrics.emit('api.requests'); if (res.statusCode >= 500) metrics.emit('api.errors');
      metrics.emit('api.duration_ms', durationMs);
      // No raw URL, query, headers or IoT payload; avoid one successful log per reading.
      if (res.statusCode >= 400 || !req.originalUrl.startsWith('/api/v1/readings')) logger.info('http.request', {
        requestId: String(req.id).replace(/[^\w-]/g,'').slice(0,128), method: req.method,
        route: req.route?.path || 'unmatched', statusCode: res.statusCode, durationMs,
      });
    });
    next();
  }));

  // Root endpoint
  app.get('/', (req, res) => {
    res.json({
      service: 'SensorGuard API',
      version: '1.0.0',
      status: 'operational',
      environment: env.NODE_ENV,
      timestamp: new Date().toISOString(),
    });
  });

  // Liveness probe (is process alive)
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // Readiness probe (are downstream services ready)
  app.get('/ready', async (req, res) => {
    const mongoReady = isMongoConnected();
    const redisReady = await isRedisConnected();

    const isReady = mongoReady && redisReady;
    const statusCode = isReady ? 200 : 503;

    res.status(statusCode).json({
      status: isReady ? 'ready' : 'degraded',
      services: {
        mongodb: mongoReady ? 'connected' : 'disconnected',
        redis: redisReady ? 'connected' : 'disconnected',
      },
      timestamp: new Date().toISOString(),
    });
  });

  // Mount API v1 Routes
  app.use('/api/v1', apiV1Router);

  // 404 Handler
  app.use((req, res) => {
    res.status(404).json({
      error: 'Not Found',
      message: `Route ${req.method} ${req.originalUrl} not found`,
      requestId: req.id,
    });
  });

  // Centralized Global Error Handler
  app.use(errorHandler);

  return app;
}

export default createApp;
