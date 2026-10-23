import { env } from '../config/env.js';

export class DetectionConfigError extends Error {
  constructor(message) { super(message); this.name = 'DetectionConfigError'; }
}

export const DETECTED_TYPES = ['temperature', 'humidity', 'vibration'];
export function validateDetectionConfig({ thresholds, detectionSettings } = {}) {
  if (thresholds !== undefined) {
    if (!thresholds || typeof thresholds !== 'object' || Array.isArray(thresholds)) throw new DetectionConfigError('thresholds must be an object');
    for (const key of ['criticalLow', 'warningLow', 'warningHigh', 'criticalHigh']) {
      if (thresholds[key] !== undefined && !Number.isFinite(thresholds[key])) throw new DetectionConfigError(`thresholds.${key} must be finite`);
    }
    const ordered = ['criticalLow', 'warningLow', 'warningHigh', 'criticalHigh'].filter(key => thresholds[key] !== undefined);
    for (let i = 1; i < ordered.length; i++) if (thresholds[ordered[i - 1]] >= thresholds[ordered[i]]) throw new DetectionConfigError('Thresholds must be strictly ordered: criticalLow < warningLow < warningHigh < criticalHigh');
  }
  if (detectionSettings !== undefined) {
    if (!detectionSettings || typeof detectionSettings !== 'object' || Array.isArray(detectionSettings)) throw new DetectionConfigError('detectionSettings must be an object');
    for (const [key, value] of Object.entries(detectionSettings)) {
      if (!['hysteresis', 'recoveryReadings', 'offlineAfterSeconds'].includes(key)) throw new DetectionConfigError(`Unknown detection setting: ${key}`);
      if (!Number.isFinite(value) || value < (key === 'hysteresis' ? 0 : 1) || (key !== 'hysteresis' && !Number.isSafeInteger(value))) throw new DetectionConfigError(`Invalid detectionSettings.${key}`);
      if (key === 'recoveryReadings' && value > 100) throw new DetectionConfigError('recoveryReadings must be at most 100');
    }
  }
}

export function thresholdObservation(value, thresholds = {}, direction, settings = {}) {
  const suffix = direction === 'high' ? 'High' : 'Low';
  const warning = thresholds[`warning${suffix}`];
  const critical = thresholds[`critical${suffix}`];
  const boundary = warning ?? critical;
  if (boundary === undefined) return { configured: false };
  const violates = bound => bound !== undefined && (direction === 'high' ? value > bound : value < bound);
  const severity = violates(critical) ? 'critical' : violates(warning) ? 'high' : null;
  const margin = settings.hysteresis ?? Math.abs(boundary) * env.DETECTION_HYSTERESIS_PERCENT / 100;
  return {
    configured: true, severity, threshold: severity === 'critical' ? critical : boundary,
    recovered: direction === 'high' ? value <= boundary - margin : value >= boundary + margin,
  };
}
