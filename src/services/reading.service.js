import { logger as obsLogger } from '../observability/logger.js';
import { Reading } from '../models/reading.model.js';
import { createReadingCache, getCacheClient } from './reading-cache.js';
import { Sensor } from '../models/sensor.model.js';
import { NotFoundError, BadRequestError } from '../errors/app-errors.js';
import { enqueueReading, enqueueBatchReadings } from '../queues/telemetry.queue.js';

export class ReadingService {
  /**
   * Ingest a single IoT telemetry reading.
   * Validates target sensor and enqueues to BullMQ for asynchronous stream processing.
   * Does NOT fake processing or insert into DB directly.
   */
  static async ingestReading(readingData) {
    const sensorId = readingData.sensorId.toUpperCase();

    // Verify target sensor exists
    const sensor = await Sensor.findOne({ sensorId }).lean();
    if (!sensor) {
      throw new NotFoundError(`Sensor with ID "${sensorId}" not found`);
    }

    if (sensor.status === 'inactive') {
      throw new BadRequestError(`Cannot ingest telemetry: Sensor "${sensorId}" is currently inactive`);
    }

    const payload = {
      eventId: readingData.eventId,
      timestampGenerated: readingData.timestamp === undefined,
      temperature: readingData.temperature,
      humidity: readingData.humidity,
      vibration: readingData.vibration,
      sensorId,
      value: readingData.value,
      type: readingData.type || sensor.type,
      unit: readingData.unit || sensor.unit,
      timestamp: readingData.timestamp ? new Date(readingData.timestamp).toISOString() : new Date().toISOString(),
      batteryLevel: readingData.batteryLevel,
      signalStrength: readingData.signalStrength,
      location: sensor.location,
    };

    // Enqueue to BullMQ. If Redis is down, this will throw and NOT return 202.
    const queueResult = await enqueueReading(payload);

    return {
      status: 'queued',
      jobId: queueResult.jobId,
      sensorId: payload.sensorId,
      timestamp: payload.timestamp,
      enqueuedAt: queueResult.enqueuedAt,
    };
  }

  /**
   * Ingest a batch of IoT telemetry readings.
   */
  static async ingestBatchReadings(readingsList) {
    if (!Array.isArray(readingsList) || readingsList.length === 0) {
      throw new BadRequestError('Batch readings must be a non-empty array');
    }

    // Normalize sensorIds and timestamps
    const normalizedList = readingsList.map((item) => ({
      ...item,
      timestampGenerated: item.timestamp === undefined,
      sensorId: item.sensorId.toUpperCase(),
      timestamp: item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString(),
    }));

    // Enqueue bulk to BullMQ
    const queueResult = await enqueueBatchReadings(normalizedList);

    return {
      status: 'queued',
      count: queueResult.count,
      jobIds: queueResult.jobIds,
      enqueuedAt: queueResult.enqueuedAt,
    };
  }

  /**
   * Query historical time-series readings from MongoDB
   */
  static async queryReadings(filters = {}, options = {}) {
    const query = {};

    if (filters.sensorId) {
      query['metadata.sensorId'] = filters.sensorId.toUpperCase();
    }

    if (filters.type) {
      query['metadata.type'] = filters.type;
    }

    if (filters.status) {
      query.status = filters.status;
    }

    // Time range filter
    const startTime = filters.startTime || filters.from;
    const endTime = filters.endTime || filters.to;

    if (startTime || endTime) {
      query.timestamp = {};
      if (startTime) {
        query.timestamp.$gte = new Date(startTime);
      }
      if (endTime) {
        query.timestamp.$lte = new Date(endTime);
      }
    }

    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(1000, Math.max(1, Number(options.limit) || 50));
    const skip = (page - 1) * limit;

    const [total, readings] = await Promise.all([
      Reading.countDocuments(query),
      Reading.find(query)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return {
      data: readings,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Get latest reading for a specific sensor
   */
  static async getLatestReading(sensorId) {
    const formattedId = sensorId.toUpperCase();
    const cache = createReadingCache(getCacheClient());
    try { const cached = await cache.get(formattedId); if (cached) return cached; }
    catch { obsLogger.warn('[Readings] Cache unavailable; reading MongoDB'); }
    const reading = await Reading.findOne({ 'metadata.sensorId': formattedId })
      .sort({ timestamp: -1 })
      .lean();

    if (!reading) {
      throw new NotFoundError(`No readings recorded for sensor "${formattedId}"`);
    }

    try { await cache.put(reading); } catch { obsLogger.warn('[Readings] Cache refill failed'); }
    return reading;
  }
}

export default ReadingService;
