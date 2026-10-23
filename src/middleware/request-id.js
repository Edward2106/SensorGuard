import crypto from 'node:crypto';

/**
 * Middleware to ensure every request has a unique Request ID.
 * Respects incoming X-Request-Id header if provided.
 */
export function requestIdMiddleware(req, res, next) {
  const incomingId = req.headers['x-request-id'];
  const requestId = (typeof incomingId === 'string' && incomingId.trim().length > 0)
    ? incomingId.trim()
    : crypto.randomUUID();

  req.id = requestId;
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  next();
}

export default requestIdMiddleware;
