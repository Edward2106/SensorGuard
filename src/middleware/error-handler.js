import { logger as obsLogger } from '../observability/logger.js';
import { env } from '../config/env.js';
import { AppError } from '../errors/app-errors.js';

/**
 * Centralized Express Error Handling Middleware
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const requestId = req.id || req.requestId || 'unknown';

  // Handle known application errors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.name,
      message: err.message,
      requestId,
      ...(err.details ? { details: err.details } : {}),
      timestamp: new Date().toISOString(),
    });
  }

  // Handle JSON parsing errors (Bad Request)
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      error: 'BadRequestError',
      message: 'Malformed JSON payload in request body',
      requestId,
      timestamp: new Date().toISOString(),
    });
  }

  // Handle Mongoose duplicate key error (11000)
  if (err.code === 11000) {
    const entries = Object.entries(err.keyValue || {}).map(([k, v]) => `${k} "${v}"`);
    const keyMsg = entries.length > 0 ? entries.join(', ') : 'Resource';
    return res.status(409).json({
      error: 'ConflictError',
      message: `Duplicate key violation: ${keyMsg} already exists`,
      requestId,
      details: err.keyValue,
      timestamp: new Date().toISOString(),
    });
  }

  // Handle Mongoose schema validation errors
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors || {}).map((e) => e.message);
    return res.status(422).json({
      error: 'ValidationError',
      message: 'Mongoose schema validation failed',
      requestId,
      details: errors,
      timestamp: new Date().toISOString(),
    });
  }

  // Handle Mongoose cast errors (invalid ObjectId)
  if (err.name === 'CastError') {
    return res.status(400).json({
      error: 'BadRequestError',
      message: `Invalid format for field "${err.path}": ${err.value}`,
      requestId,
      timestamp: new Date().toISOString(),
    });
  }

  // Fallback for unhandled unexpected errors (500)
  // eslint-disable-next-line no-console
  obsLogger.error('Unhandled request exception', err, { requestId });

  const statusCode = err.status || err.statusCode || 500;
  return res.status(statusCode).json({
    error: err.name || 'InternalServerError',
    message: env.IS_PROD ? 'An internal server error occurred' : err.message,
    requestId,
    timestamp: new Date().toISOString(),
  });
}

export default errorHandler;
