import { Router } from 'express';
import { ReadingController } from '../controllers/reading.controller.js';
import {
  validateReadingIngest,
  validateBatchReadingIngest,
  validateReadingQuery,
} from '../middleware/validate.js';

const router = Router();

router.post('/', validateReadingIngest, ReadingController.ingestReading);
router.post('/batch', validateBatchReadingIngest, ReadingController.ingestBatchReadings);
router.get('/', validateReadingQuery, ReadingController.getReadings);

export default router;
