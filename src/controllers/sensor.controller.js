import { SensorService } from '../services/sensor.service.js';

export class SensorController {
  static async createSensor(req, res, next) {
    try {
      const result = await SensorService.createSensor(req.body);
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
      const result = await SensorService.updateSensor(sensorId, req.body);
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
