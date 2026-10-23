import { env } from '../config/env.js';
import { UnauthorizedError } from '../errors/app-errors.js';

/**
 * Authentication middleware for SensorGuard API.
 * Validates request against configured API_KEY via:
 * 1. X-API-Key header
 * 2. Authorization: Bearer <token>
 */
export function authenticateApiKey(req, res, next) {
  // Extract key from X-API-Key or Authorization header
  let apiKey = req.headers['x-api-key'];

  if (!apiKey && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && (parts[0] === 'Bearer' || parts[0] === 'ApiKey')) {
      apiKey = parts[1];
    }
  }

  if (!apiKey) {
    return next(new UnauthorizedError('Missing authentication API key. Provide via X-API-Key or Authorization: Bearer <key>'));
  }

  // Constant-time check or standard comparison
  if (apiKey !== env.API_KEY) {
    return next(new UnauthorizedError('Invalid API key provided'));
  }

  // Attach identity context
  req.auth = {
    authenticated: true,
    role: 'service',
  };

  return next();
}

export default authenticateApiKey;
