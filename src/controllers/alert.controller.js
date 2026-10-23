import { AlertService } from '../services/alert.service.js';

export class AlertController {
  static async createAlert(req, res, next) {
    try {
      const result = await AlertService.createAlert(req.body);
      return res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      return next(error);
    }
  }

  static async getAlerts(req, res, next) {
    try {
      const { status, severity, sensorId, type, from, startTime, to, endTime, page, limit } = req.query;
      const result = await AlertService.getAlerts(
        { status, severity, sensorId, type, from, startTime, to, endTime },
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

  static async getAlertById(req, res, next) {
    try {
      const { alertId } = req.params;
      const result = await AlertService.getAlertById(alertId);
      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      return next(error);
    }
  }

  static async acknowledgeAlert(req, res, next) {
    try {
      const { alertId } = req.params;
      const { acknowledgedBy } = req.body || {};
      const result = await AlertService.acknowledgeAlert(alertId, acknowledgedBy);
      return res.status(200).json({
        success: true,
        message: 'Alert acknowledged successfully',
        data: result,
      });
    } catch (error) {
      return next(error);
    }
  }

  static async resolveAlert(req, res, next) {
    try {
      const { alertId } = req.params;
      const { resolvedBy, resolutionNotes } = req.body || {};
      const result = await AlertService.resolveAlert(alertId, resolvedBy, resolutionNotes);
      return res.status(200).json({
        success: true,
        message: 'Alert resolved successfully',
        data: result,
      });
    } catch (error) {
      return next(error);
    }
  }

  static async getAlertStats(req, res, next) {
    try {
      const stats = await AlertService.getAlertStats();
      return res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      return next(error);
    }
  }
}

export default AlertController;
