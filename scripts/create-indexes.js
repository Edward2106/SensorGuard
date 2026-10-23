import mongoose from 'mongoose';
import { ensureDetectionStorage } from '../src/services/detection.service.js';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { COLLECTIONS } from '../src/config/constants.js';

async function createIndexes() {
  // eslint-disable-next-line no-console
  console.log('[Script] Creating database indexes...');

  try {
    await connectMongo();
    const db = mongoose.connection.db;
    await ensureDetectionStorage(db);

    // 1. Indexes on Time Series collection: sensor_readings
    // eslint-disable-next-line no-console
    console.log(`[Script] Ensuring indexes on "${COLLECTIONS.SENSOR_READINGS}"...`);
    const readingsCol = db.collection(COLLECTIONS.SENSOR_READINGS);
    await readingsCol.createIndex(
      { 'metadata.sensorId': 1, timestamp: -1 },
      { name: 'idx_sensor_readings_sensorId_time' }
    );
    await readingsCol.createIndex(
      { 'metadata.type': 1, timestamp: -1 },
      { name: 'idx_sensor_readings_type_time' }
    );

    // 2. Indexes on regular collection: sensors
    // eslint-disable-next-line no-console
    console.log(`[Script] Ensuring indexes on "${COLLECTIONS.SENSORS}"...`);
    const sensorsCol = db.collection(COLLECTIONS.SENSORS);
    await sensorsCol.createIndex(
      { sensorId: 1 },
      { unique: true, name: 'uniq_sensors_sensorId' }
    );
    await sensorsCol.createIndex(
      { status: 1 },
      { name: 'idx_sensors_status' }
    );
    await sensorsCol.createIndex(
      { type: 1 },
      { name: 'idx_sensors_type' }
    );
    await sensorsCol.createIndex(
      { 'location.zone': 1 },
      { name: 'idx_sensors_location_zone' }
    );

    // 3. Indexes on regular collection: incidents
    // eslint-disable-next-line no-console
    console.log(`[Script] Ensuring indexes on "${COLLECTIONS.INCIDENTS}"...`);
    const incidentsCol = db.collection(COLLECTIONS.INCIDENTS);
    await incidentsCol.createIndex(
      { sensorId: 1, status: 1, createdAt: -1 },
      { name: 'idx_incidents_sensor_status_time' }
    );
    await incidentsCol.createIndex(
      { severity: 1, status: 1 },
      { name: 'idx_incidents_severity_status' }
    );
    await incidentsCol.createIndex(
      { createdAt: -1 },
      { name: 'idx_incidents_createdAt' }
    );

    // eslint-disable-next-line no-console
    console.log('[Script] All indexes created/verified successfully.');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[Script] Failed to create indexes:', error.message);
    process.exitCode = 1;
  } finally {
    await disconnectMongo();
  }
}

createIndexes();
