import mongoose from 'mongoose';
import crypto from 'node:crypto';
import {
  COLLECTIONS,
  INCIDENT_SEVERITY,
  INCIDENT_STATUS,
} from '../config/constants.js';

const AlertSchema = new mongoose.Schema(
  {
    eventId: String,
    lastEventId: String,
    recoveryEventId: String,
    observedAt: Date,
    managedBy: String,
    conditionKey: String,
    active: Boolean,
    detectionRevision: Number,
    history: [mongoose.Schema.Types.Mixed],
    alertId: {
      type: String,
      unique: true,
      index: true,
      default: () => `ALT-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    },
    sensorId: {
      type: String,
      required: [true, 'sensorId is required'],
      index: true,
      trim: true,
    },
    type: {
      type: String,
      required: [true, 'type is required'],
      trim: true,
    },
    severity: {
      type: String,
      enum: {
        values: Object.values(INCIDENT_SEVERITY),
        message: '{VALUE} is not a valid incident severity',
      },
      default: INCIDENT_SEVERITY.MEDIUM,
      index: true,
    },
    status: {
      type: String,
      enum: {
        values: Object.values(INCIDENT_STATUS),
        message: '{VALUE} is not a valid incident status',
      },
      default: INCIDENT_STATUS.OPEN,
      index: true,
    },
    title: {
      type: String,
      required: [true, 'title is required'],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    readingValue: {
      type: Number,
    },
    threshold: {
      type: Number,
    },
    acknowledgedAt: {
      type: Date,
    },
    acknowledgedBy: {
      type: String,
      trim: true,
    },
    resolvedAt: {
      type: Date,
    },
    resolvedBy: {
      type: String,
      trim: true,
    },
    resolutionNotes: {
      type: String,
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    collection: COLLECTIONS.INCIDENTS,
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

// Indexes matching scripts/create-indexes.js
AlertSchema.index({ sensorId: 1, status: 1, createdAt: -1 });
AlertSchema.index({ severity: 1, status: 1 });
AlertSchema.index({ createdAt: -1 });

export const Alert = mongoose.models.Alert || mongoose.model('Alert', AlertSchema);
export default Alert;
