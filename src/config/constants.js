/**
 * SensorGuard Constants & Enumerations
 */

export const COLLECTIONS = Object.freeze({
  SENSOR_READINGS: 'sensor_readings',
  SENSORS: 'sensors',
  INCIDENTS: 'incidents',
  AUDIT_LOGS: 'audit_logs',
});

export const TIMESERIES_CONFIG = Object.freeze({
  collectionName: COLLECTIONS.SENSOR_READINGS,
  timeField: 'timestamp',
  metaField: 'metadata',
  granularity: 'seconds',
  expireAfterSeconds: 30 * 24 * 60 * 60, // 30 days retention
});

export const SENSOR_TYPES = Object.freeze({
  TEMPERATURE: 'temperature',
  HUMIDITY: 'humidity',
  PRESSURE: 'pressure',
  VIBRATION: 'vibration',
  CO2: 'co2',
});

export const SENSOR_STATUS = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  MAINTENANCE: 'maintenance',
  ERROR: 'error',
});

export const INCIDENT_SEVERITY = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
});

export const INCIDENT_STATUS = Object.freeze({
  OPEN: 'open',
  ACKNOWLEDGED: 'acknowledged',
  RESOLVED: 'resolved',
});

export const QUEUES = Object.freeze({
  TELEMETRY_INGESTION: 'telemetry-ingestion',
  INCIDENT_DETECTION: 'incident-detection',
  NOTIFICATIONS: 'notifications',
});

export const SHUTDOWN_TIMEOUT_MS = 10000;
