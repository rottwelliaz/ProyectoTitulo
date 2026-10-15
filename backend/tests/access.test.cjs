require('./security-env.cjs');
require('ts-node/register');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma').default;
const { authenticate, authorizeRoles } = require('../src/middleware/auth');
const usersRouter = require('../src/routes/usuarios').default;
const authRouter = require('../src/routes/auth').default;

const secret = process.env.JWT_SECRET;
const users = [
  { id: 1, rol: 'cliente', aprobado: true },
  { id: 2, rol: 'barbero', aprobado: true },
  { id: 3, rol: 'admin', aprobado: true },
  { id: 4, rol: 'barbero', aprobado: false },
].map(user => ({ ...user, email: `${user.id}@test.example`, password: bcrypt.hashSync('test-password', 4) }));
const originalFindUnique = prisma.user.findUnique;
const originalFindMany = prisma.user.findMany;
let server, base;
const token = (id, options = {}) => jwt.sign({ id, rol: 'admin' }, secret, { expiresIn: '1h', ...options });
const headers = id => ({ Authorization: `Bearer ${token(id)}` });

before(async () => {
  // Real HTTP routes, JWT and password validation; only persistence is stubbed.
  prisma.user.findUnique = async ({ where }) => users.find(user => where.id === user.id || where.email === user.email) || null;
  prisma.user.findMany = async ({ where }) => users.filter(user => (!where?.rol || user.rol === where.rol) && (where?.aprobado === undefined || user.aprobado === where.aprobado));
  const app = express();
  app.use(express.json());
  app.use('/api/usuarios', usersRouter);
  app.use('/api/auth', authRouter);
  for (const role of ['cliente', 'barbero', 'admin']) {
    app.get(`/private/${role}`, authenticate, authorizeRoles(role), (req, res) => res.json(req.user));
  }
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  prisma.user.findUnique = originalFindUnique;
  prisma.user.findMany = originalFindMany;
  await new Promise(resolve => server.close(resolve));
  await prisma.$disconnect();
});

test('JWT ausente, alterado, vencido o de usuario eliminado es rechazado', async () => {
  for (const auth of [undefined, 'invalid', token(1, { expiresIn: -1 }), token(999)]) {
    const response = await fetch(`${base}/api/auth/me`, { headers: auth ? { Authorization: `Bearer ${auth}` } : {} });
    assert.equal(response.status, 401);
  }
});

test('Los tres roles se validan contra la base de datos, no el rol del JWT', async () => {
  for (const user of users.slice(0, 3)) {
    for (const role of ['cliente', 'barbero', 'admin']) {
      const response = await fetch(`${base}/private/${role}`, { headers: headers(user.id) });
      assert.equal(response.status, user.rol === role ? 200 : 403);
    }
  }
});

test('Un solicitante anterior puede consultar su perfil como cliente pero no acceder a funciones profesionales', async () => {
  const me = await fetch(`${base}/api/auth/me`, { headers: headers(4) });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).rol, 'cliente');
  assert.equal((await fetch(`${base}/private/barbero`, { headers: headers(4) })).status, 403);
  assert.equal((await fetch(`${base}/private/admin`, { headers: headers(4) })).status, 403);
});

test('El catálogo público conserva solo barberos aprobados; otros listados exigen administrador', async () => {
  const response = await fetch(`${base}/api/usuarios?rol=barbero`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).map(user => user.id), [2]);
  for (const query of ['', '?rol=cliente', '?rol=admin']) {
    assert.equal((await fetch(`${base}/api/usuarios${query}`)).status, 401);
    assert.equal((await fetch(`${base}/api/usuarios${query}`, { headers: headers(1) })).status, 403);
    assert.equal((await fetch(`${base}/api/usuarios${query}`, { headers: headers(3) })).status, 200);
  }
});

test('Login valida contraseña, rol y aprobación, y emite un token utilizable', async () => {
  for (const user of users) {
    const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email, password: 'test-password' }) });
    assert.equal(response.status, 200);
    {
      const data = await response.json();
      assert.equal(data.user.rol, user.aprobado ? user.rol : 'cliente');
      assert.equal(data.user.password, undefined);
      assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${data.token}` } })).status, 200);
    }
  }
  const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: users[0].email, password: 'incorrecta' }) });
  assert.equal(response.status, 401);
});
