import { Router } from 'express';
import mongoose from 'mongoose';
import { getAnalytics } from '../services/analytics.service.js';
import { AppError } from '../errors/app-errors.js';

export function createAnalyticsRouter({ database = () => mongoose.connection.db, run = getAnalytics } = {}) {
  const router = Router();
  let active = 0;
  router.get('/series', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (active >= 4) {
      res.set('Retry-After', '1');
      return next(new AppError('Analytics busy; retry shortly', 429));
    }
    active++;
    try { res.json(await run(database(), req.query)); }
    catch (error) { next(error); }
    finally { active--; }
  });
  return router;
}
export default createAnalyticsRouter();
