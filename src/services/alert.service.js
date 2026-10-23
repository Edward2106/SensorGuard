import { Alert } from '../models/alert.model.js';
import { NotFoundError, BadRequestError } from '../errors/app-errors.js';
import { INCIDENT_STATUS } from '../config/constants.js';

export class AlertService {
  /**
   * Create an alert / incident
   */
  static async createAlert(data) {
    const alert = new Alert({
      ...Object.fromEntries(['type', 'severity', 'status', 'title', 'description', 'readingValue', 'threshold', 'metadata'].filter(key => data[key] !== undefined).map(key => [key, data[key]])),
      sensorId: data.sensorId.toUpperCase(),
    });

    await alert.save();
    return alert.toJSON();
  }

  /**
   * Get paginated list of alerts with filters
   */
  static async getAlerts(filters = {}, pagination = {}) {
    const query = {};

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.severity) {
      query.severity = filters.severity;
    }

    if (filters.sensorId) {
      query.sensorId = filters.sensorId.toUpperCase();
    }

    if (filters.type) {
      query.type = filters.type;
    }

    // Time range filter
    const startTime = filters.startTime || filters.from;
    const endTime = filters.endTime || filters.to;

    if (startTime || endTime) {
      query.createdAt = {};
      if (startTime) {
        query.createdAt.$gte = new Date(startTime);
      }
      if (endTime) {
        query.createdAt.$lte = new Date(endTime);
      }
    }

    const page = Math.max(1, Number(pagination.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(pagination.limit) || 20));
    const skip = (page - 1) * limit;

    const [total, alerts] = await Promise.all([
      Alert.countDocuments(query),
      Alert.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return {
      data: alerts,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Get alert by alertId or _id
   */
  static async getAlertById(alertId) {
    const query = alertId.startsWith('ALT-')
      ? { alertId }
      : { $or: [{ alertId }, { _id: alertId }] };

    const alert = await Alert.findOne(query).lean();
    if (!alert) {
      throw new NotFoundError(`Alert with ID "${alertId}" not found`);
    }

    return alert;
  }

  /**
   * Acknowledge an open alert
   */
  static async acknowledgeAlert(alertId, acknowledgedBy = 'operator') {
    const query = alertId.startsWith('ALT-')
      ? { alertId }
      : { $or: [{ alertId }, { _id: alertId }] };

    const now = new Date();
    const updated = await Alert.findOneAndUpdate({ $and: [query, { status: INCIDENT_STATUS.OPEN }] }, {
      $set: { status: INCIDENT_STATUS.ACKNOWLEDGED, acknowledgedAt: now, acknowledgedBy },
      $push: { history: { action: 'acknowledged', at: now, by: acknowledgedBy } },
    }, { new: true });
    if (updated) return updated.toJSON();
    const existing = await Alert.findOne(query);
    if (!existing) throw new NotFoundError(`Alert with ID "${alertId}" not found`);
    if (existing.status === INCIDENT_STATUS.RESOLVED) throw new BadRequestError(`Cannot acknowledge alert "${alertId}" because it is already resolved`);
    return existing.toJSON();
  }

  /**
   * Resolve an alert
   */
  static async resolveAlert(alertId, resolvedBy = 'operator', resolutionNotes = '') {
    const query = alertId.startsWith('ALT-')
      ? { alertId }
      : { $or: [{ alertId }, { _id: alertId }] };

    const now = new Date();
    const changes = { status: INCIDENT_STATUS.RESOLVED, active: false, resolvedAt: now, resolvedBy };
    if (resolutionNotes) changes.resolutionNotes = resolutionNotes;
    const updated = await Alert.findOneAndUpdate({ $and: [query, { status: { $ne: INCIDENT_STATUS.RESOLVED } }] }, {
      $set: changes, $push: { history: { action: 'resolved', at: now, by: resolvedBy, notes: resolutionNotes } },
    }, { new: true });
    if (updated) return updated.toJSON();
    const existing = await Alert.findOne(query);
    if (!existing) throw new NotFoundError(`Alert with ID "${alertId}" not found`);
    return existing.toJSON();
  }

  /**
   * Get alert statistics summary
   */
  static async getAlertStats() {
    const [total, byStatus, bySeverity] = await Promise.all([
      Alert.countDocuments(),
      Alert.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Alert.aggregate([
        { $group: { _id: '$severity', count: { $sum: 1 } } },
      ]),
    ]);

    const statusCounts = {};
    byStatus.forEach((item) => {
      statusCounts[item._id] = item.count;
    });

    const severityCounts = {};
    bySeverity.forEach((item) => {
      severityCounts[item._id] = item.count;
    });

    return {
      total,
      byStatus: statusCounts,
      bySeverity: severityCounts,
      timestamp: new Date().toISOString(),
    };
  }
}

export default AlertService;
