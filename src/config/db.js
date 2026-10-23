import { logger as obsLogger } from '../observability/logger.js';
import mongoose from 'mongoose';
import { env } from './env.js';

let isConnected = false;

export async function connectMongo() {
  if (isConnected || mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  const options = {
    dbName: env.MONGODB_DB_NAME,
    maxPoolSize: env.MONGODB_MAX_POOL_SIZE,
    minPoolSize: env.MONGODB_MIN_POOL_SIZE,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    autoIndex: env.IS_DEV, // Build indexes automatically only in dev
  };

  mongoose.connection.on('connected', () => {
    isConnected = true;
    // eslint-disable-next-line no-console
    obsLogger.info(`[MongoDB] Connected successfully to ${env.MONGODB_DB_NAME}`);
  });

  mongoose.connection.on('error', (err) => {
    // eslint-disable-next-line no-console
    obsLogger.error('[MongoDB] Connection error:', err.message);
  });

  mongoose.connection.on('disconnected', () => {
    isConnected = false;
    // eslint-disable-next-line no-console
    obsLogger.warn('[MongoDB] Disconnected from server');
  });

  mongoose.connection.on('reconnected', () => {
    isConnected = true;
    // eslint-disable-next-line no-console
    obsLogger.info('[MongoDB] Reconnected');
  });

  try {
    await mongoose.connect(env.MONGODB_URI, options);
    isConnected = true;
    return mongoose.connection;
  } catch (error) {
    isConnected = false;
    // eslint-disable-next-line no-console
    obsLogger.error('[MongoDB] Initial connection failed:', error.message);
    throw error;
  }
}

export async function disconnectMongo() {
  if (mongoose.connection.readyState !== 0) {
    try {
      await mongoose.connection.close(false);
      isConnected = false;
      // eslint-disable-next-line no-console
      obsLogger.info('[MongoDB] Connection closed gracefully');
    } catch (error) {
      // eslint-disable-next-line no-console
      obsLogger.error('[MongoDB] Error during disconnect:', error.message);
      throw error;
    }
  }
}

export function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

export default {
  connectMongo,
  disconnectMongo,
  isMongoConnected,
};
