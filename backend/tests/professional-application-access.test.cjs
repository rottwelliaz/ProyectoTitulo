require('./security-env.cjs');
require('ts-node/register');
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const prisma = require('../src/config/prisma').default;
const router = require('../src/routes/usuarios').default;

// Real HTTP routing and authentication; persistence is isolated from existing accounts.
const originalFind = prisma.user.findUnique;
const originalTransaction = prisma.$transaction;
let server, base, users, applications, writes, transactions, transactionRole;
const token = id => jwt.sign({ id, rol: 'cliente' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const request = (id, body) => fetch(base + '/solicitud-profesional', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(id ? { Authorization: `Bearer ${token(id)}` } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

before(async () => {
  prisma.user.findUnique = async ({ where }) => users.find(user => user.id === where.id) || null;
  prisma.$transaction = async callback => {
    transactions++;
    return callback({
      $queryRaw: async () => [],
      user: {
        findUnique: async ({ where }) => {
          const user = users.find(user => user.id === where.id);
          return transactionRole ? { ...user, rol: transactionRole } : user;
        },
        update: async ({ where, data }) => { writes++; return Object.assign(users.find(user => user.id === where.id), data); },
      },
      solicitudProfesional: {
        findUnique: async ({ where }) => applications.get(where.usuarioId) || null,
        create: async ({ data }) => { writes++; const result = { ...data, estado: 'pendiente' }; applications.set(data.usuarioId, result); return result; },
      },
    });
  };
  const app = express(); app.use(express.json()); app.use(router);
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  base = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  users = [
    { id: 1, rol: 'cliente', aprobado: true, activo: true },
    { id: 2, rol: 'barbero', aprobado: false, activo: true },
    { id: 3, rol: 'barbero', aprobado: true, activo: true },
    { id: 4, rol: 'admin', aprobado: true, activo: true },
    { id: 5, rol: 'cliente', aprobado: true, activo: false },
  ];
  applications = new Map(); writes = 0; transactions = 0; transactionRole = null;
});

after(async () => {
  prisma.user.findUnique = originalFind;
  prisma.$transaction = originalTransaction;
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await prisma.$disconnect();
});

test('invitados y cuentas inexistentes no pueden solicitar un perfil profesional', async () => {
  assert.equal((await request(null)).status, 401);
  assert.equal((await request(999)).status, 401);
  assert.equal(transactions, 0);
});

test('barberos pendientes, aprobados y administradores reciben 403 aunque el JWT diga cliente', async () => {
  const initial = structuredClone(users);
  for (const id of [2, 3, 4]) assert.equal((await request(id)).status, 403);
  assert.equal(transactions, 0);
  assert.equal(writes, 0);
  assert.deepEqual(users, initial);
});

test('un cliente inactivo no puede enviar solicitudes', async () => {
  assert.equal((await request(5)).status, 403);
  assert.equal(writes, 0);
});

test('el cliente autorizado usa el proceso existente una sola vez', async () => {
  assert.equal((await request(1)).status, 201);
  assert.equal(applications.size, 1);
  assert.equal(applications.get(1).estado, 'pendiente');
  assert.equal((await request(1)).status, 403);
  assert.equal(applications.size, 1);
  assert.equal(writes, 2);
});

for (const estado of ['pendiente', 'aprobada', 'rechazada']) {
  test(`cliente con solicitud ${estado} recibe 409 sin duplicados ni cambios de rol`, async () => {
    applications.set(1, { usuarioId: 1, estado });
    assert.equal((await request(1)).status, 409);
    assert.equal(applications.size, 1);
    assert.equal(users[0].rol, 'cliente');
    assert.equal(writes, 0);
  });
}

test('el controlador vuelve a comprobar el rol dentro de la transacción', async () => {
  transactionRole = 'barbero';
  assert.equal((await request(1)).status, 403);
  assert.equal(transactions, 1);
  assert.equal(writes, 0);
});

test('el cuerpo no puede imponer roles, aprobación ni identidad de otra cuenta', async () => {
  for (const body of [{ rol: 'admin' }, { aprobado: true }, { usuarioId: 4 }]) assert.equal((await request(1, body)).status, 400);
  assert.equal(writes, 0);
});
