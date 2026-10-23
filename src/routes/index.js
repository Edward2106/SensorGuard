import { Router } from 'express';
import sensorRoutes from './sensor.routes.js';
import readingRoutes from './reading.routes.js';
import alertRoutes from './alert.routes.js';
import { authenticateApiKey } from '../middleware/auth.js';
import { isMongoConnected } from '../config/db.js';
import { isRedisConnected } from '../config/redis.js';

const apiRouter = Router();

// API Metadata / Discovery
apiRouter.get('/', (req, res) => {
  res.json({
    service: 'SensorGuard REST API',
    version: '1.0.0',
    documentation: '/api/v1/docs',
    endpoints: {
      sensors: '/api/v1/sensors',
      readings: '/api/v1/readings',
      alerts: '/api/v1/alerts',
      incidents: '/api/v1/incidents',
      health: '/api/v1/health',
      ready: '/api/v1/ready',
    },
    timestamp: new Date().toISOString(),
  });
});

// Public health probes on API v1 prefix
apiRouter.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

apiRouter.get('/ready', async (req, res) => {
  const mongoReady = isMongoConnected();
  const redisReady = await isRedisConnected();
  const isReady = mongoReady && redisReady;

  res.status(isReady ? 200 : 503).json({
    status: isReady ? 'ready' : 'degraded',
    services: {
      mongodb: mongoReady ? 'connected' : 'disconnected',
      redis: redisReady ? 'connected' : 'disconnected',
    },
    timestamp: new Date().toISOString(),
  });
});

// Protect resource routes with API Key Authentication
apiRouter.use('/sensors', authenticateApiKey, sensorRoutes);
apiRouter.use('/readings', authenticateApiKey, readingRoutes);
apiRouter.use('/alerts', authenticateApiKey, alertRoutes);
apiRouter.use('/incidents', authenticateApiKey, alertRoutes); // Alias incidents to alerts

export default apiRouter;
