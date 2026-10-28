import { Sensor } from '../models/sensor.model.js';
import { NotFoundError, ConflictError, ValidationError } from '../errors/app-errors.js';
import { validateDetectionConfig } from './detection.rules.js';
import { literalPattern } from '../security/query.js';
import { HISTORY_LIMIT, thresholdConfig, configDigest, historyEntry, sealEntry } from './threshold-history.js';

const editable = ['name', 'type', 'unit', 'status', 'location', 'thresholds', 'samplingIntervalSeconds', 'metadata', 'detectionSettings'];
const editableData = data => Object.fromEntries(editable.filter(key => data[key] !== undefined).map(key => [key, data[key]]));

export class SensorService {
  /**
   * Create a new sensor
   */
  static async createSensor(data, actor) {
    try { validateDetectionConfig(data); } catch (error) { throw new ValidationError(error.message); }
    const existing = await Sensor.findOne({ sensorId: data.sensorId.toUpperCase() });
    if (existing) {
      throw new ConflictError(`Sensor with ID "${data.sensorId.toUpperCase()}" already exists`);
    }

    const sensor = new Sensor({
      ...editableData(data),
      sensorId: data.sensorId.toUpperCase(),
    });

    sensor.configurationRevision = 1;
    sensor.thresholdHistory = [sealEntry(historyEntry({}, sensor.toObject(), actor))];
    await sensor.save();
    const result = sensor.toJSON(); delete result.thresholdHistory;
    return result;
  }

  /**
   * Get paginated list of sensors with optional filters
   */
  static async getSensors(filters = {}, pagination = {}) {
    const query = {};

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.type) {
      query.type = filters.type;
    }

    if (filters.facility) {
      query['location.facility'] = new RegExp(literalPattern(filters.facility), 'i');
    }

    if (filters.zone) {
      query['location.zone'] = filters.zone;
    }

    if (filters.search) {
      const searchRegex = new RegExp(literalPattern(filters.search), 'i');
      query.$or = [{ name: searchRegex }, { sensorId: searchRegex }];
    }

    const page = Math.max(1, Number(pagination.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(pagination.limit) || 20));
    const skip = (page - 1) * limit;

    const [total, sensors] = await Promise.all([
      Sensor.countDocuments(query),
      Sensor.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return {
      data: sensors,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Get sensor by unique sensorId
   */
  static async getSensorById(sensorId) {
    const sensor = await Sensor.findOne({ sensorId: sensorId.toUpperCase() }).lean();
    if (!sensor) {
      throw new NotFoundError(`Sensor with ID "${sensorId}" not found`);
    }
    return sensor;
  }

  /**
   * Update sensor metadata, thresholds, status, location
   */
  static async updateSensor(sensorId, updateData, actor) {
    // Disallow modifying sensorId
    try { validateDetectionConfig(updateData); } catch (error) { throw new ValidationError(error.message); }
    const safeUpdates = editableData(updateData);
    delete safeUpdates.sensorId;
    delete safeUpdates._id;
    delete safeUpdates.createdAt;

    for (let attempt = 0; attempt < 10; attempt++) {
      const prior = await Sensor.findOne({ sensorId: sensorId.toUpperCase() }).select('+thresholdHistory').lean();
      if (!prior) throw new NotFoundError(`Sensor with ID "${sensorId}" not found`);
      const next = { ...prior, ...safeUpdates };
      const changed = configDigest(thresholdConfig(prior)) !== configDigest(thresholdConfig(next));
      const update = { $set: safeUpdates };
      if (changed) {
        if ((prior.thresholdHistory?.length || 0) >= HISTORY_LIMIT) throw new ConflictError('Threshold history capacity reached; archive planning required, history was not truncated');
        const entry = sealEntry(historyEntry(prior, next, actor));
        update.$set.configurationRevision = entry.revision;
        update.$push = { thresholdHistory: entry };
      }
      const filter = { _id: prior._id,
        configurationRevision: prior.configurationRevision ?? { $exists: false },
        // Fence legacy/direct writers too; metadata edits never overwrite detector state.
        type: prior.type, unit: prior.unit, thresholds: prior.thresholds ?? null,
        detectionSettings: prior.detectionSettings ?? null,
      };
      const sensor = await Sensor.findOneAndUpdate(filter, update,
        { new: true, runValidators: true, writeConcern: { w: 'majority' } }).lean();
      if (sensor) { delete sensor.thresholdHistory; return sensor; }
    }
    throw new ConflictError('Concurrent sensor configuration changes; retry');
  }

  /**
   * Delete sensor by sensorId
   */
  static async deleteSensor(sensorId) {
    const result = await Sensor.findOneAndDelete({ sensorId: sensorId.toUpperCase() }).lean();
    if (!result) {
      throw new NotFoundError(`Sensor with ID "${sensorId}" not found`);
    }
    return {
      success: true,
      message: `Sensor "${sensorId.toUpperCase()}" deleted successfully`,
    };
  }

  /**
   * Get sensor statistics summary
   */
  static async getSensorStats() {
    const [total, byStatus, byType, byHealth] = await Promise.all([
      Sensor.countDocuments(),
      Sensor.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Sensor.aggregate([
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]),
      Sensor.aggregate([
        { $group: { _id: '$healthStatus', count: { $sum: 1 } } },
      ]),
    ]);

    const statusCounts = {};
    byStatus.forEach((item) => {
      statusCounts[item._id] = item.count;
    });

    const typeCounts = {};
    byType.forEach((item) => {
      typeCounts[item._id] = item.count;
    });

    const healthCounts = {};
    byHealth.forEach((item) => {
      healthCounts[item._id || 'unknown'] = item.count;
    });

    return {
      total,
      byStatus: statusCounts,
      byType: typeCounts,
      byHealth: healthCounts,
      timestamp: new Date().toISOString(),
    };
  }
}

export default SensorService;
