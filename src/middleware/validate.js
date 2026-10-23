import { ValidationError } from '../errors/app-errors.js';
import { validateTelemetry } from '../services/telemetry.validation.js';
import { validateDetectionConfig } from '../services/detection.rules.js';
import {
  SENSOR_TYPES,
  SENSOR_STATUS,
  INCIDENT_SEVERITY,
  INCIDENT_STATUS,
} from '../config/constants.js';

const VALID_SENSOR_TYPES = Object.values(SENSOR_TYPES);
const VALID_SENSOR_STATUSES = Object.values(SENSOR_STATUS);
const VALID_INCIDENT_SEVERITIES = Object.values(INCIDENT_SEVERITY);
const VALID_INCIDENT_STATUSES = Object.values(INCIDENT_STATUS);

function isValidDate(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return !Number.isNaN(d.getTime());
}

/**
 * Validate Sensor Creation payload
 */
export function validateCreateSensor(req, res, next) {
  try { validateDetectionConfig(req.body); } catch (error) { return next(new ValidationError(error.message)); }
  const { sensorId, name, type, unit, status, thresholds, samplingIntervalSeconds, location } = req.body || {};
  const errors = [];

  if (!sensorId || typeof sensorId !== 'string' || sensorId.trim().length < 3) {
    errors.push('sensorId is required and must be a string with at least 3 characters');
  }

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    errors.push('name is required and must be at least 2 characters');
  }

  if (!type || !VALID_SENSOR_TYPES.includes(type)) {
    errors.push(`type is required and must be one of: ${VALID_SENSOR_TYPES.join(', ')}`);
  }

  if (!unit || typeof unit !== 'string' || unit.trim().length === 0) {
    errors.push('unit is required and must be a non-empty string');
  }

  if (status && !VALID_SENSOR_STATUSES.includes(status)) {
    errors.push(`status must be one of: ${VALID_SENSOR_STATUSES.join(', ')}`);
  }

  if (samplingIntervalSeconds !== undefined) {
    if (typeof samplingIntervalSeconds !== 'number' || samplingIntervalSeconds <= 0) {
      errors.push('samplingIntervalSeconds must be a positive number');
    }
  }

  if (thresholds !== undefined) {
    if (typeof thresholds !== 'object' || thresholds === null || Array.isArray(thresholds)) {
      errors.push('thresholds must be an object');
    } else {
      ['warningLow', 'warningHigh', 'criticalLow', 'criticalHigh'].forEach((prop) => {
        if (thresholds[prop] !== undefined && typeof thresholds[prop] !== 'number') {
          errors.push(`thresholds.${prop} must be a number if provided`);
        }
      });
    }
  }

  if (location !== undefined && (typeof location !== 'object' || location === null || Array.isArray(location))) {
    errors.push('location must be an object');
  }

  if (errors.length > 0) {
    return next(new ValidationError('Sensor validation failed', errors));
  }

  return next();
}

/**
 * Validate Sensor Update payload
 */
export function validateUpdateSensor(req, res, next) {
  try { validateDetectionConfig(req.body); } catch (error) { return next(new ValidationError(error.message)); }
  const { name, type, unit, status, thresholds, samplingIntervalSeconds, location } = req.body || {};
  const errors = [];

  if (name !== undefined && (typeof name !== 'string' || name.trim().length < 2)) {
    errors.push('name must be at least 2 characters');
  }

  if (type !== undefined && !VALID_SENSOR_TYPES.includes(type)) {
    errors.push(`type must be one of: ${VALID_SENSOR_TYPES.join(', ')}`);
  }

  if (unit !== undefined && (typeof unit !== 'string' || unit.trim().length === 0)) {
    errors.push('unit must be a non-empty string');
  }

  if (status !== undefined && !VALID_SENSOR_STATUSES.includes(status)) {
    errors.push(`status must be one of: ${VALID_SENSOR_STATUSES.join(', ')}`);
  }

  if (samplingIntervalSeconds !== undefined) {
    if (typeof samplingIntervalSeconds !== 'number' || samplingIntervalSeconds <= 0) {
      errors.push('samplingIntervalSeconds must be a positive number');
    }
  }

  if (thresholds !== undefined) {
    if (typeof thresholds !== 'object' || thresholds === null || Array.isArray(thresholds)) {
      errors.push('thresholds must be an object');
    } else {
      ['warningLow', 'warningHigh', 'criticalLow', 'criticalHigh'].forEach((prop) => {
        if (thresholds[prop] !== undefined && typeof thresholds[prop] !== 'number') {
          errors.push(`thresholds.${prop} must be a number if provided`);
        }
      });
    }
  }

  if (location !== undefined && (typeof location !== 'object' || location === null || Array.isArray(location))) {
    errors.push('location must be an object');
  }

  if (errors.length > 0) {
    return next(new ValidationError('Sensor update validation failed', errors));
  }

  return next();
}

/**
 * Validate single IoT reading ingestion
 */
export function validateReadingIngest(req, res, next) {
  try { validateTelemetry(req.body); } catch (error) { return next(new ValidationError('Reading ingestion validation failed', [error.message])); }
  const { sensorId, value, timestamp, type, batteryLevel, signalStrength } = req.body || {};
  const errors = [];

  if (!sensorId || typeof sensorId !== 'string' || sensorId.trim().length === 0) {
    errors.push('sensorId is required and must be a string');
  }

  if (value === undefined || typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    errors.push('value is required and must be a finite number');
  }

  if (timestamp !== undefined && !isValidDate(timestamp)) {
    errors.push('timestamp must be a valid ISO 8601 date string if provided');
  }

  if (type !== undefined && !VALID_SENSOR_TYPES.includes(type)) {
    errors.push(`type must be one of: ${VALID_SENSOR_TYPES.join(', ')}`);
  }

  if (batteryLevel !== undefined && (typeof batteryLevel !== 'number' || batteryLevel < 0 || batteryLevel > 100)) {
    errors.push('batteryLevel must be a number between 0 and 100');
  }

  if (signalStrength !== undefined && typeof signalStrength !== 'number') {
    errors.push('signalStrength must be a number');
  }

  if (errors.length > 0) {
    return next(new ValidationError('Reading ingestion validation failed', errors));
  }

  return next();
}

/**
 * Validate batch IoT reading ingestion
 */
export function validateBatchReadingIngest(req, res, next) {
  const { readings } = req.body || {};
  const errors = [];

  if (!readings || !Array.isArray(readings)) {
    return next(new ValidationError('Batch readings must contain an array in the "readings" property'));
  }

  if (readings.length === 0) {
    return next(new ValidationError('Batch readings array cannot be empty'));
  }

  if (readings.length > 1000) {
    return next(new ValidationError('Batch readings cannot exceed 1000 items per request'));
  }

  for (let i = 0; i < readings.length; i += 1) {
    const item = readings[i];
    try { validateTelemetry(item); } catch (error) { errors.push(`Reading at index ${i}: ${error.message}`); }
    if (!item || typeof item !== 'object') {
      errors.push(`Reading at index ${i} is not a valid object`);
      break;
    }
    if (!item.sensorId || typeof item.sensorId !== 'string') {
      errors.push(`Reading at index ${i} requires a valid sensorId string`);
    }
    if (item.value === undefined || typeof item.value !== 'number' || !Number.isFinite(item.value)) {
      errors.push(`Reading at index ${i} requires a valid finite number for value`);
    }
    if (item.timestamp !== undefined && !isValidDate(item.timestamp)) {
      errors.push(`Reading at index ${i} has invalid timestamp`);
    }

    if (errors.length >= 5) {
      errors.push('... and more validation errors');
      break;
    }
  }

  if (errors.length > 0) {
    return next(new ValidationError('Batch readings validation failed', errors));
  }

  return next();
}

/**
 * Validate Reading History Query parameters
 */
export function validateReadingQuery(req, res, next) {
  const { startTime, from, endTime, to, limit, page, type } = req.query;
  const errors = [];

  const startVal = startTime || from;
  const endVal = endTime || to;

  if (startVal && !isValidDate(startVal)) {
    errors.push('startTime / from must be a valid date');
  }

  if (endVal && !isValidDate(endVal)) {
    errors.push('endTime / to must be a valid date');
  }

  if (startVal && endVal && new Date(startVal) > new Date(endVal)) {
    errors.push('startTime must be less than or equal to endTime');
  }

  if (limit !== undefined) {
    const parsedLimit = Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
      errors.push('limit must be an integer between 1 and 1000');
    }
  }

  if (page !== undefined) {
    const parsedPage = Number(page);
    if (!Number.isInteger(parsedPage) || parsedPage < 1) {
      errors.push('page must be an integer greater than or equal to 1');
    }
  }

  if (type && !VALID_SENSOR_TYPES.includes(type)) {
    errors.push(`type filter must be one of: ${VALID_SENSOR_TYPES.join(', ')}`);
  }

  if (errors.length > 0) {
    return next(new ValidationError('Query parameter validation failed', errors));
  }

  return next();
}

/**
 * Validate Alert Creation payload
 */
export function validateCreateAlert(req, res, next) {
  const { sensorId, type, severity, title, status, description, readingValue, threshold } = req.body || {};
  const errors = [];

  if (!sensorId || typeof sensorId !== 'string' || sensorId.trim().length === 0) {
    errors.push('sensorId is required');
  }

  if (!type || typeof type !== 'string' || type.trim().length === 0) {
    errors.push('type is required');
  }

  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    errors.push('title is required');
  }

  if (severity && !VALID_INCIDENT_SEVERITIES.includes(severity)) {
    errors.push(`severity must be one of: ${VALID_INCIDENT_SEVERITIES.join(', ')}`);
  }

  if (status && !VALID_INCIDENT_STATUSES.includes(status)) {
    errors.push(`status must be one of: ${VALID_INCIDENT_STATUSES.join(', ')}`);
  }

  if (readingValue !== undefined && typeof readingValue !== 'number') {
    errors.push('readingValue must be a number');
  }

  if (threshold !== undefined && typeof threshold !== 'number') {
    errors.push('threshold must be a number');
  }

  if (errors.length > 0) {
    return next(new ValidationError('Alert validation failed', errors));
  }

  return next();
}

export default {
  validateCreateSensor,
  validateUpdateSensor,
  validateReadingIngest,
  validateBatchReadingIngest,
  validateReadingQuery,
  validateCreateAlert,
};
