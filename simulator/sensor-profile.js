import { randomUUID } from 'node:crypto';
import { SAMPLE_SENSORS } from '../scripts/seed-sensors.js';
export const SCENARIOS = ['NORMAL', 'HIGH_TEMPERATURE', 'LOW_TEMPERATURE', 'HIGH_HUMIDITY', 'HIGH_VIBRATION', 'SENSOR_DISCONNECT', 'SENSOR_RECOVERY', 'BURST_TRAFFIC'];
export function profiles(count, runId) {
  return Array.from({ length: count }, (_, i) => {
    const type = ['temperature', 'humidity', 'vibration'][i % 3];
    const template = SAMPLE_SENSORS.find(s => s.type === type && (type !== 'temperature' || s.sensorId === 'SEN-TEMP-002'));
    return { sensorId: `${runId}-${i + 1}`, name: `Simulated ${type} ${i + 1}`, type, unit: template.unit,
      status: 'active', thresholds: { ...template.thresholds, ...(type === 'temperature' ? { warningLow: 10, criticalLow: 5 } : {}) },
      detectionSettings: { hysteresis: 2, recoveryReadings: 3, offlineAfterSeconds: 10 },
      location: { facility: 'SIMULATED SensorGuard', zone: runId }, metadata: { simulated: true, runId } };
  });
}
export function reading(sensor, scenario = 'NORMAL', severity = 'critical') {
  if (!SCENARIOS.includes(scenario)) throw new Error('Unknown scenario');
  const values = { temperature: 24, humidity: 45, vibration: 1.5 };
  const applies = scenario.endsWith(sensor.type.toUpperCase());
  if (applies) {
    const low = scenario.startsWith('LOW_');
    const t = sensor.thresholds;
    values[sensor.type] = low ? (severity === 'high' ? (t.warningLow + t.criticalLow) / 2 : t.criticalLow - 3)
      : (severity === 'high' ? (t.warningHigh + t.criticalHigh) / 2 : t.criticalHigh + 3);
  }
  return { sensorId: sensor.sensorId, eventId: randomUUID(), timestamp: new Date().toISOString(),
    type: sensor.type, unit: sensor.unit, value: values[sensor.type], ...values };
}
export function disconnected(scenario, elapsed, duration) {
  return scenario === 'SENSOR_DISCONNECT' ? elapsed >= duration / 3
    : scenario === 'SENSOR_RECOVERY' && elapsed >= duration / 3 && elapsed < duration * 2 / 3;
}
