require('./security-env.cjs');
require('ts-node/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { jwtSettings, corsOrigins } = require('../src/config/security');
const { rateLimit, restrictedCors, safeErrors } = require('../src/middleware/security');
const { createUserValidation, updateProfileValidation, updateUserValidation } = require('../src/validations/usuarios');
const { authenticate } = require('../src/middleware/auth');
const valid = { nombre: 'María Pérez', email: ' MARIA@Example.com ', password: 'una clave larga', telefono: '912345678' };

test('registro: formato, obligatorios, tipos, privilegios y límite bcrypt UTF-8', () => {
  assert.equal(createUserValidation.validate(valid).value.email, 'maria@example.com');
  for (const field of ['nombre', 'email', 'password', 'telefono']) {
    const value = { ...valid }; delete value[field];
    assert.ok(createUserValidation.validate(value).error, field);
  }
  for (const patch of [{ nombre: '   ' }, { email: 'no-es-correo' }, { email: 'a@' }, { email: {} }, { password: 123456789012 },
    { password: '123456' }, { password: ' '.repeat(12) }, { password: 'á'.repeat(37) }, { password: 'a'.repeat(73) },
    { telefono: '' }, { telefono: null }, { telefono: '123' }, { rol: 'admin' }, { aprobado: true }, { activo: true }]) {
    assert.ok(createUserValidation.validate({ ...valid, ...patch }).error, JSON.stringify(patch));
  }
  assert.equal(createUserValidation.validate({ ...valid, password: 'á'.repeat(36) }).error, undefined);
  for (const schema of [updateProfileValidation, updateUserValidation]) {
    assert.equal(schema.validate({ nombre: 'Nombre Nuevo' }).error, undefined);
    assert.ok(schema.validate({ password: 'corta' }).error);
    assert.ok(schema.validate({ email: 'incorrecto' }).error);
  }
  assert.ok(updateProfileValidation.validate({ rol: 'admin' }).error);
});

test('JWT y CORS fallan sin configuración segura', () => {
  const old = { ...process.env };
  try {
    for (const key of [undefined, '', 'short', 'tu_clave_jwt_super_segura_cambiar_esto']) {
      if (key === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = key;
      assert.throws(jwtSettings);
    }
    process.env.JWT_SECRET = old.JWT_SECRET;
    for (const duration of ['1000', '0h', '-1h', 'forever']) { process.env.JWT_EXPIRE = duration; assert.throws(jwtSettings); }
    process.env.NODE_ENV = 'production'; delete process.env.CORS_ORIGIN; assert.throws(corsOrigins);
    for (const origin of ['*', 'https://club.example/path', 'null']) { process.env.CORS_ORIGIN = origin; assert.throws(corsOrigins); }
  } finally {
    for (const key of ['JWT_SECRET', 'JWT_EXPIRE', 'CORS_ORIGIN', 'NODE_ENV']) {
      if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key];
    }
  }
});

async function serve(app, action) {
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try { await action(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
test('JWT rechaza algoritmo alternativo, sin expiración, id inválido y firma incorrecta antes de consultar BD', async () => {
  const app = express(); app.get('/', authenticate, (_req, res) => res.json({ ok: true }));
  const secret = process.env.JWT_SECRET;
  await serve(app, async base => {
    const tokens = [jwt.sign({ id: 1 }, secret), jwt.sign({ id: 1 }, secret, { algorithm: 'HS384', expiresIn: '1h' }),
      jwt.sign({ id: -1 }, secret, { expiresIn: '1h' }), jwt.sign({ id: {} }, secret, { expiresIn: '1h' }),
      jwt.sign({ id: 1 }, secret + 'wrong', { expiresIn: '1h' }), jwt.sign({ id: 1 }, secret, { expiresIn: -1 })];
    for (const token of tokens) assert.equal((await fetch(base, { headers: { Authorization: `Bearer ${token}` } })).status, 401);
  });
});
test('límite concurrente no se evade cambiando JWT, casing de cuenta o X-Forwarded-For; expira', async () => {
  let now = 1000;
  const app = express(); app.use(express.json());
  app.post('/account', rateLimit(2, 10000, req => req.body.email.trim().toLowerCase(), () => now), (_req, res) => res.sendStatus(401));
  app.post('/ip', rateLimit(2, 10000, req => req.ip, () => now), (_req, res) => res.sendStatus(401));
  await serve(app, async base => {
    const request = (path, i) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${i}`, 'X-Forwarded-For': `10.0.0.${i}` }, body: JSON.stringify({ email: i % 2 ? ' TEST@example.com ' : 'test@EXAMPLE.com' }) });
    for (const path of ['/account', '/ip']) {
      const results = await Promise.all([0, 1, 2, 3].map(i => request(path, i)));
      assert.deepEqual(results.map(r => r.status).sort(), [401, 401, 429, 429]);
      assert.ok(Number(results.find(r => r.status === 429).headers.get('retry-after')) > 0);
    }
    now += 10001; assert.equal((await request('/account', 4)).status, 401);
  });
});
test('CORS permite solo orígenes exactos, y errores JSON no exponen cuerpo ni stack', async () => {
  const old = process.env.CORS_ORIGIN; process.env.CORS_ORIGIN = 'https://club.example';
  const app = express(); app.use(restrictedCors(), express.json());
  app.post('/', (_req, res) => res.json({ ok: true })); app.use(safeErrors);
  if (old === undefined) delete process.env.CORS_ORIGIN; else process.env.CORS_ORIGIN = old;
  await serve(app, async base => {
    const allowed = await fetch(base, { method: 'OPTIONS', headers: { Origin: 'https://club.example', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(allowed.status, 204); assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://club.example');
    for (const origin of ['https://evil.example', 'https://club.example.evil', 'null']) assert.equal((await fetch(base, { method: 'POST', headers: { Origin: origin } })).status, 403);
    assert.equal((await fetch(base, { method: 'POST' })).status, 200);
    const bad = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password":"PRIVATE"' });
    assert.equal(bad.status, 400); assert.doesNotMatch(await bad.text(), /PRIVATE|stack|SyntaxError/);
  });
});
