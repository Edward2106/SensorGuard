import { Router } from 'express';
import { AlertController } from '../controllers/alert.controller.js';
import { validateCreateAlert } from '../middleware/validate.js';
import { incidentAnalysis } from '../controllers/incident-analysis.controller.js';

const router = Router();

// Stats must precede :alertId
router.get('/stats', AlertController.getAlertStats);

router.post('/', validateCreateAlert, AlertController.createAlert);
router.get('/', AlertController.getAlerts);

router.get('/:alertId', AlertController.getAlertById);
router.get('/:alertId/analysis', incidentAnalysis);
router.patch('/:alertId/acknowledge', AlertController.acknowledgeAlert);
router.patch('/:alertId/resolve', AlertController.resolveAlert);

export default router;
