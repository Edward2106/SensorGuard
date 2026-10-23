import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve project root for .env loading
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../');

dotenv.config({ path: path.join(projectRoot, '.env') });

function parseNumber(value, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid numeric environment variable value: "${value}"`);
  }
  return parsed;
}

function positiveInteger(name, fallback) {
  const value = parseNumber(process.env[name], fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(name + ' must be a positive integer');
  return value;
}

function nonnegativeNumber(name, fallback) {
  const value = parseNumber(process.env[name], fallback);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and nonnegative`);
  return value;
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  return value.toLowerCase() === 'true' || value === '1';
}

function validateEnv() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isTest = nodeEnv === 'test';

  const mongodbUri = process.env.MONGODB_URI;
  if (!mongodbUri && !isTest) {
    // eslint-disable-next-line no-console
    console.warn(
      '[WARN] MONGODB_URI is not set. Database connection will fail unless provided.'
    );
  }

  return Object.freeze({
    NODE_ENV: nodeEnv,
    IS_PROD: nodeEnv === 'production',
    IS_DEV: nodeEnv === 'development',
    IS_TEST: isTest,
    PORT: parseNumber(process.env.PORT, 3000),
    HOST: process.env.HOST || '0.0.0.0',
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',

    // MongoDB
    MONGODB_URI: mongodbUri || 'mongodb://127.0.0.1:27017/sensorguard',
    MONGODB_DB_NAME: process.env.MONGODB_DB_NAME || 'sensorguard',
    MONGODB_MAX_POOL_SIZE: parseNumber(process.env.MONGODB_MAX_POOL_SIZE, 50),
    MONGODB_MIN_POOL_SIZE: parseNumber(process.env.MONGODB_MIN_POOL_SIZE, 5),

    // Redis
    REDIS_HOST: process.env.REDIS_HOST || '127.0.0.1',
    REDIS_PORT: parseNumber(process.env.REDIS_PORT, 6379),
    REDIS_PASSWORD: process.env.REDIS_PASSWORD || undefined,
    REDIS_DB: parseNumber(process.env.REDIS_DB, 0),
    REDIS_TLS: parseBoolean(process.env.REDIS_TLS, false),

    WORKER_CONCURRENCY: positiveInteger('WORKER_CONCURRENCY', 8),
    TELEMETRY_ATTEMPTS: positiveInteger('TELEMETRY_ATTEMPTS', 5),
    TELEMETRY_BACKOFF_MS: positiveInteger('TELEMETRY_BACKOFF_MS', 1000),
    READING_CACHE_TTL_SECONDS: positiveInteger('READING_CACHE_TTL_SECONDS', 300),
    WORKER_SHUTDOWN_TIMEOUT_MS: positiveInteger('WORKER_SHUTDOWN_TIMEOUT_MS', 60000),
    SENSOR_HEALTH_INTERVAL_MS: positiveInteger('SENSOR_HEALTH_INTERVAL_MS', 30000),
    SENSOR_OFFLINE_AFTER_SECONDS: positiveInteger('SENSOR_OFFLINE_AFTER_SECONDS', 120),
    DETECTION_RECOVERY_READINGS: positiveInteger('DETECTION_RECOVERY_READINGS', 3),
    DETECTION_HYSTERESIS_PERCENT: nonnegativeNumber('DETECTION_HYSTERESIS_PERCENT', 5),
    TELEMETRY_MAX_FUTURE_SECONDS: positiveInteger('TELEMETRY_MAX_FUTURE_SECONDS', 300),
    // Authentication
    API_KEY: process.env.API_KEY || 'sensorguard-secret-api-key',
  });
}

export const env = validateEnv();
export default env;
