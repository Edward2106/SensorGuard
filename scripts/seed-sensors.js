import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { COLLECTIONS, SENSOR_TYPES, SENSOR_STATUS } from '../src/config/constants.js';

export const SAMPLE_SENSORS = [
  {
    sensorId: 'SEN-TEMP-001',
    name: 'Cold Storage Ambient Temperature',
    type: SENSOR_TYPES.TEMPERATURE,
    unit: '°C',
    status: SENSOR_STATUS.ACTIVE,
    location: {
      facility: 'Hanoi Logistics Hub',
      zone: 'Cold-Storage-A',
      rack: 'Rack-04',
      coordinates: { lat: 21.0285, lng: 105.8542 },
    },
    thresholds: {
      warningLow: -20,
      warningHigh: -15,
      criticalLow: -25,
      criticalHigh: -10,
    },
    samplingIntervalSeconds: 5,
  },
  {
    sensorId: 'SEN-TEMP-002',
    name: 'Server Room 1 Exhaust Temperature',
    type: SENSOR_TYPES.TEMPERATURE,
    unit: '°C',
    status: SENSOR_STATUS.ACTIVE,
    location: {
      facility: 'Data Center South',
      zone: 'Server-Room-1',
      rack: 'Row-B-Rack-08',
      coordinates: { lat: 10.7769, lng: 106.7009 },
    },
    thresholds: {
      warningHigh: 30,
      criticalHigh: 38,
    },
    samplingIntervalSeconds: 3,
  },
  {
    sensorId: 'SEN-HUM-001',
    name: 'Pharmaceutical Packaging Humidity',
    type: SENSOR_TYPES.HUMIDITY,
    unit: '%',
    status: SENSOR_STATUS.ACTIVE,
    location: {
      facility: 'Pharma Plant Alpha',
      zone: 'Packaging-Cleanroom-B',
      coordinates: { lat: 20.9712, lng: 105.8344 },
    },
    thresholds: {
      warningLow: 35,
      warningHigh: 55,
      criticalLow: 25,
      criticalHigh: 65,
    },
    samplingIntervalSeconds: 5,
  },
  {
    sensorId: 'SEN-PRES-001',
    name: 'Natural Gas Pipeline Inflow Pressure',
    type: SENSOR_TYPES.PRESSURE,
    unit: 'bar',
    status: SENSOR_STATUS.ACTIVE,
    location: {
      facility: 'Pipeline Station Delta',
      zone: 'Inflow-Section-4',
      valve: 'V-104',
      coordinates: { lat: 10.346, lng: 107.0843 },
    },
    thresholds: {
      warningLow: 40,
      warningHigh: 75,
      criticalLow: 30,
      criticalHigh: 85,
    },
    samplingIntervalSeconds: 2,
  },
  {
    sensorId: 'SEN-VIB-001',
    name: 'Turbine Bearing Vibration Monitor',
    type: SENSOR_TYPES.VIBRATION,
    unit: 'mm/s',
    status: SENSOR_STATUS.ACTIVE,
    location: {
      facility: 'Thermal Power Plant 2',
      zone: 'Turbine-Hall-1',
      unit: 'Turbine-Alpha',
      coordinates: { lat: 21.0543, lng: 106.312 },
    },
    thresholds: {
      warningHigh: 4.5,
      criticalHigh: 7.0,
    },
    samplingIntervalSeconds: 1,
  },
  {
    sensorId: 'SEN-CO2-001',
    name: 'Control Room Indoor Air Quality',
    type: SENSOR_TYPES.CO2,
    unit: 'ppm',
    status: SENSOR_STATUS.ACTIVE,
    location: {
      facility: 'Data Center South',
      zone: 'Central-Control-Room',
      coordinates: { lat: 10.7769, lng: 106.7009 },
    },
    thresholds: {
      warningHigh: 1000,
      criticalHigh: 1600,
    },
    samplingIntervalSeconds: 10,
  },
];

// Insert-only seeding: existing sensor documents are never overwritten.
export async function seedSensorDocuments(db, sensors = SAMPLE_SENSORS) {
  const now = new Date();
  return db.collection(COLLECTIONS.SENSORS).bulkWrite(sensors.map(sensor => ({
    updateOne: {
      filter: { sensorId: sensor.sensorId },
      update: { $setOnInsert: { ...sensor, createdAt: now, updatedAt: now } },
      upsert: true,
    },
  })));
}

async function seedSensors() {
  // eslint-disable-next-line no-console
  console.log('[Script] Seeding sample IoT sensors...');

  try {
    await connectMongo();
    const db = mongoose.connection.db;
    const result = await seedSensorDocuments(db);
    // eslint-disable-next-line no-console
    console.log(
      `[Script] Seeded sensors successfully. Matched: ${result.matchedCount}, Upserted: ${result.upsertedCount}, Modified: ${result.modifiedCount}`
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[Script] Failed to seed sensors:', error.message);
    process.exitCode = 1;
  } finally {
    await disconnectMongo();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) seedSensors();
