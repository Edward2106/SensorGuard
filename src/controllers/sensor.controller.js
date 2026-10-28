import { SensorService } from '../services/sensor.service.js';
import { Sensor } from '../models/sensor.model.js';
import { NotFoundError, BadRequestError } from '../errors/app-errors.js';

export class SensorController {
  static async thresholdHistory(req, res, next) {
    try {
      if (Object.keys(req.query).length) throw new BadRequestError('Threshold history has a fixed maximum of 256 revisions');
      const sensor = await Sensor.findOne({ sensorId: req.params.sensorId.toUpperCase() }).select('+thresholdHistory').maxTimeMS(1000).lean();
      if (!sensor) throw new NotFoundError('Sensor not found');
      res.json({ data: { sensorId: sensor.sensorId, revision: sensor.configurationRevision ?? null,
        history: sensor.thresholdHistory || [], status: sensor.thresholdHistory?.length ? 'AVAILABLE' : 'HISTORICAL_THRESHOLD_UNAVAILABLE' },
        meta: { limit: 256, semantics: 'Server-assigned effectiveAt, recordedAt and actor; no legacy backfill; append-only via authorized configuration API' } });
    } catch (error) { next(error); }
  }
  static async createSensor(req, res, next) {
    try {
      const result = await SensorService.createSensor(req.body, req.auth);
      return res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      return next(error);
    }
  }

  static async getSensors(req, res, next) {
    try {
      const { status, type, facility, zone, search, page, limit } = req.query;
      const result = await SensorService.getSensors(
        { status, type, facility, zone, search },
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

  static async getSensorById(req, res, next) {
    try {
      const { sensorId } = req.params;
      const result = await SensorService.getSensorById(sensorId);
      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      return next(error);
    }
  }

  static async updateSensor(req, res, next) {
    try {
      const { sensorId } = req.params;
      const result = await SensorService.updateSensor(sensorId, req.body, req.auth);
      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      return next(error);
    }
  }

  static async deleteSensor(req, res, next) {
    try {
      const { sensorId } = req.params;
      const result = await SensorService.deleteSensor(sensorId);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }

  static async getSensorStats(req, res, next) {
    try {
      const stats = await SensorService.getSensorStats();
      return res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      return next(error);
    }
  }
}

export default SensorController;
