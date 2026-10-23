import { ReadingService } from '../services/reading.service.js';

export class ReadingController {
  /**
   * Ingest single IoT telemetry reading.
   * Responds with HTTP 202 Accepted ONLY after job is enqueued in BullMQ.
   */
  static async ingestReading(req, res, next) {
    try {
      const result = await ReadingService.ingestReading(req.body);
      return res.status(202).json({
        success: true,
        message: 'Telemetry reading accepted and queued for processing',
        ...result,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Ingest batch of IoT telemetry readings.
   * Responds with HTTP 202 Accepted ONLY after all jobs are enqueued in BullMQ.
   */
  static async ingestBatchReadings(req, res, next) {
    try {
      const { readings } = req.body;
      const result = await ReadingService.ingestBatchReadings(readings);
      return res.status(202).json({
        success: true,
        message: 'Batch telemetry readings accepted and queued for processing',
        ...result,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Query historical time-series readings with filters and pagination.
   */
  static async getReadings(req, res, next) {
    try {
      const { sensorId, type, status, from, startTime, to, endTime, page, limit } = req.query;
      const result = await ReadingService.queryReadings(
        { sensorId, type, status, from, startTime, to, endTime },
        { page, limit }
      );
      return res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Query reading history for a specific sensor.
   */
  static async getSensorReadings(req, res, next) {
    try {
      const { sensorId } = req.params;
      const { type, status, from, startTime, to, endTime, page, limit } = req.query;
      const result = await ReadingService.queryReadings(
        { sensorId, type, status, from, startTime, to, endTime },
        { page, limit }
      );
      return res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Get latest reading for a specific sensor.
   */
  static async getLatestReading(req, res, next) {
    try {
      const { sensorId } = req.params;
      const reading = await ReadingService.getLatestReading(sensorId);
      return res.status(200).json({
        success: true,
        data: reading,
      });
    } catch (error) {
      return next(error);
    }
  }
}

export default ReadingController;
