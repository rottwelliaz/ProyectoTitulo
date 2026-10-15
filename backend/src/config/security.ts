import { SignOptions } from 'jsonwebtoken';

export function jwtSettings() {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32 || /tu_clave|your_secret|cambiar_esto/i.test(secret)) {
    throw new Error('Configura JWT_SECRET con una clave aleatoria de al menos 32 bytes');
  }
  const lifetime = process.env.JWT_EXPIRE || '2h';
  if (!/^[1-9]\d*(s|m|h|d)$/.test(lifetime)) throw new Error('JWT_EXPIRE debe indicar una duración positiva con unidad s, m, h o d');
  return { secret, expiresIn: lifetime as SignOptions['expiresIn'] };
}

export function corsOrigins() {
  const configured = process.env.CORS_ORIGIN;
  if (!configured && process.env.NODE_ENV === 'production') throw new Error('Configura CORS_ORIGIN en producción');
  const origins = (configured || 'http://localhost:3000,http://127.0.0.1:3000').split(',').map(value => value.trim());
  for (const origin of origins) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) throw new Error('CORS_ORIGIN debe contener orígenes HTTP(S) exactos separados por coma');
  }
  return origins;
}
