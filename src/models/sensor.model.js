import mongoose from 'mongoose';
import {
  COLLECTIONS,
  SENSOR_TYPES,
  SENSOR_STATUS,
} from '../config/constants.js';

const SensorSchema = new mongoose.Schema(
  {
    configurationRevision: { type: Number },
    thresholdHistory: { type: [mongoose.Schema.Types.Mixed], default: undefined, select: false },
    lastSeen: { type: Date },
    lastSeenEventId: { type: String },
    healthStatus: { type: String, enum: ['unknown', 'online', 'offline'], default: 'unknown' },
    detection: { type: mongoose.Schema.Types.Mixed, select: false },
    detectionSettings: {
      hysteresis: { type: Number, min: 0 },
      recoveryReadings: { type: Number, min: 1, max: 100 },
      offlineAfterSeconds: { type: Number, min: 1 },
    },
    sensorId: {
      type: String,
      required: [true, 'sensorId is required'],
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'name is required'],
      trim: true,
    },
    type: {
      type: String,
      required: [true, 'type is required'],
      enum: {
        values: Object.values(SENSOR_TYPES),
        message: '{VALUE} is not a valid sensor type',
      },
      index: true,
    },
    unit: {
      type: String,
      required: [true, 'unit is required'],
      trim: true,
    },
    status: {
      type: String,
      enum: {
        values: Object.values(SENSOR_STATUS),
        message: '{VALUE} is not a valid sensor status',
      },
      default: SENSOR_STATUS.ACTIVE,
      index: true,
    },
    location: {
      facility: { type: String, trim: true },
      zone: { type: String, trim: true, index: true },
      rack: { type: String, trim: true },
      valve: { type: String, trim: true },
      unit: { type: String, trim: true },
      coordinates: {
        lat: { type: Number },
        lng: { type: Number },
      },
    },
    thresholds: {
      warningLow: { type: Number },
      warningHigh: { type: Number },
      criticalLow: { type: Number },
      criticalHigh: { type: Number },
    },
    samplingIntervalSeconds: {
      type: Number,
      default: 5,
      min: 1,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    collection: COLLECTIONS.SENSORS,
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(doc, ret) {
        delete ret._id;
        return ret;
      },
    },
  }
);

export const Sensor = mongoose.models.Sensor || mongoose.model('Sensor', SensorSchema);
export default Sensor;
