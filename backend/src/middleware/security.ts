import { RequestHandler, ErrorRequestHandler } from 'express';
import { createHash } from 'crypto';
import cors from 'cors';
import { corsOrigins } from '../config/security';

// Per-process, bounded fixed windows. Do not trust arbitrary X-Forwarded-For.
// Multiple replicas need a shared gateway/store with equivalent limits.
export function rateLimit(limit: number, windowMs: number, key: (req: Parameters<RequestHandler>[0]) => string, now = Date.now): RequestHandler {
  const entries = new Map<string, { count: number; end: number }>();
  return (req, res, next) => {
    const time = now();
    for (const [id, entry] of entries) if (entry.end <= time) entries.delete(id); else break;
    const id = createHash('sha256').update(key(req)).digest('hex');
    let entry = entries.get(id);
    if (!entry || entry.end <= time) {
      if (entries.size >= 10000) {
        res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
        return res.status(429).json({ message: 'Demasiados intentos. Espera unos minutos e inténtalo nuevamente.' });
      }
      entry = { count: 0, end: time + windowMs }; entries.set(id, entry);
    }
    if (++entry.count > limit) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((entry.end - time) / 1000))));
      return res.status(429).json({ message: 'Demasiados intentos. Espera unos minutos e inténtalo nuevamente.' });
    }
    next();
  };
}
const ip = (req: Parameters<RequestHandler>[0]) => req.ip || req.socket.remoteAddress || 'unknown';
export const loginIpLimit = rateLimit(30, 15 * 60_000, ip);
export const loginAccountLimit = rateLimit(10, 15 * 60_000, req =>
  typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ip(req));
export const registrationLimit = rateLimit(20, 60 * 60_000, ip);
export const publicAvailabilityLimit = rateLimit(120, 60_000, ip);

export function restrictedCors(): RequestHandler {
  const origins = corsOrigins();
  const allowCors = cors({ origin: origins, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'], exposedHeaders: ['Retry-After'] });
  return (req, res, next) => {
    if (req.headers.origin && !origins.includes(req.headers.origin)) return res.status(403).json({ message: 'Origen no permitido' });
    return allowCors(req, res, next);
  };
}
export const safeErrors: ErrorRequestHandler = (error, _req, res, _next) => {
  const status = error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : 500;
  res.status(status).json({ message: status === 413 ? 'La solicitud es demasiado grande' : status === 400 ? 'El cuerpo JSON no es válido' : 'No se pudo procesar la solicitud' });
};
