import mongoose from 'mongoose';
import {
  COLLECTIONS,
  TIMESERIES_CONFIG,
  SENSOR_TYPES,
} from '../config/constants.js';

const ReadingMetadataSchema = new mongoose.Schema(
  {
    sensorId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    type: {
      type: String,
      enum: Object.values(SENSOR_TYPES),
      index: true,
    },
    location: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  { _id: false }
);

const ReadingSchema = new mongoose.Schema(
  {
    eventId: { type: String },
    temperature: { type: Number },
    humidity: { type: Number },
    vibration: { type: Number },
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    metadata: {
      type: ReadingMetadataSchema,
      required: true,
    },
    value: {
      type: Number,
      required: true,
    },
    unit: {
      type: String,
      trim: true,
    },
    batteryLevel: {
      type: Number,
      min: 0,
      max: 100,
    },
    signalStrength: {
      type: Number,
    },
    status: {
      type: String,
      default: 'ok',
    },
  },
  {
    collection: COLLECTIONS.SENSOR_READINGS,
    timeseries: {
      timeField: TIMESERIES_CONFIG.timeField,
      metaField: TIMESERIES_CONFIG.metaField,
      granularity: TIMESERIES_CONFIG.granularity,
    },
    versionKey: false,
    toJSON: {
      transform(doc, ret) {
        delete ret._id;
        return ret;
      },
    },
  }
);

// Indexes defined in scripts/create-indexes.js:
ReadingSchema.index({ 'metadata.sensorId': 1, timestamp: -1 });
ReadingSchema.index({ 'metadata.type': 1, timestamp: -1 });

export const Reading = mongoose.models.Reading || mongoose.model('Reading', ReadingSchema);
export default Reading;
