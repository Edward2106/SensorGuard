import { Router } from 'express';
import { SensorController } from '../controllers/sensor.controller.js';
import { ReadingController } from '../controllers/reading.controller.js';
import {
  validateCreateSensor,
  validateUpdateSensor,
  validateReadingQuery,
} from '../middleware/validate.js';

const router = Router();

// Stats must be registered before :sensorId to prevent collision
router.get('/stats', SensorController.getSensorStats);

router.post('/', validateCreateSensor, SensorController.createSensor);
router.get('/', SensorController.getSensors);

router.get('/:sensorId', SensorController.getSensorById);
router.put('/:sensorId', validateUpdateSensor, SensorController.updateSensor);
router.patch('/:sensorId', validateUpdateSensor, SensorController.updateSensor);
router.delete('/:sensorId', SensorController.deleteSensor);

// Sensor readings subroutes
router.get('/:sensorId/readings', validateReadingQuery, ReadingController.getSensorReadings);
router.get('/:sensorId/readings/latest', ReadingController.getLatestReading);

export default router;
