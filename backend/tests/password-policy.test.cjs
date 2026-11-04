require('./security-env.cjs');
require('ts-node/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma').default;

test('registro y edición administrativa validan 7, 8 y 9 caracteres antes de guardar con bcrypt', async () => {
  const originals = { findUnique: prisma.user.findUnique, transaction: prisma.$transaction };
  const legacyHash = await bcrypt.hash('legacy', 4);
  const accounts = new Map([
    [1, { id: 1, nombre: 'Admin Prueba', email: 'admin@test.invalid', rol: 'admin', aprobado: true, activo: true, password: legacyHash }],
    [2, { id: 2, nombre: 'Cliente Prueba', email: 'cliente@test.invalid', rol: 'cliente', aprobado: true, activo: true, password: legacyHash }],
  ]);
  let writes = 0;
  const tx = {
    $executeRaw: async () => 0,
    $queryRaw: async () => [],
    user: {
      findFirst: async () => null,
      findUnique: async ({ where }) => ({ ...accounts.get(where.id) }),
      create: async ({ data }) => {
        writes++;
        const user = { ...data, id: accounts.size + 1, activo: true };
        accounts.set(user.id, user);
        return { ...user };
      },
      update: async ({ where, data }) => {
        writes++;
        const user = accounts.get(where.id);
        Object.assign(user, Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)));
        return { ...user };
      },
    },
  };
  let server;
  try {
    prisma.user.findUnique = async ({ where }) => {
      const user = accounts.get(where.id);
      return user ? { ...user } : null;
    };
    prisma.$transaction = async action => action(tx);
    const app = express();
    app.use(express.json());
    app.use('/api/usuarios', require('../src/routes/usuarios').default);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}/api/usuarios`;
    const token = jwt.sign({ id: 1, rol: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const send = async (path, method, body) => {
      const response = await fetch(base + path, { method, headers: {
        'Content-Type': 'application/json', ...(method === 'PUT' ? { Authorization: `Bearer ${token}` } : {}),
      }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };

    for (const rol of ['cliente', 'barbero']) for (const length of [7, 8, 9]) {
      const password = 'x'.repeat(length), beforeWrites = writes;
      const response = await send('', 'POST', { nombre: 'Cuenta Prueba', email: `${rol}-${length}@test.invalid`, telefono: '912345678', rol, password });
      assert.equal(response.status, length < 8 ? 400 : 201, `${rol}: ${length} caracteres`);
      if (length < 8) {
        assert.equal(response.body.message, 'La contraseña debe tener al menos 8 caracteres');
        assert.equal(writes, beforeWrites);
      } else {
        const saved = accounts.get(response.body.id);
        assert.equal(saved.rol, rol);
        assert.equal(bcrypt.getRounds(saved.password), 10);
        assert.ok(await bcrypt.compare(password, saved.password));
        assert.equal(response.body.password, undefined);
      }
    }

    for (const length of [7, 8, 9]) {
      const password = 'y'.repeat(length), before = { ...accounts.get(2) }, beforeWrites = writes;
      const response = await send('/2', 'PUT', { password });
      assert.equal(response.status, length < 8 ? 400 : 200, `edición: ${length} caracteres`);
      if (length < 8) {
        assert.equal(response.body.message, 'La contraseña debe tener al menos 8 caracteres');
        assert.equal(writes, beforeWrites);
        assert.deepEqual(accounts.get(2), before);
      } else {
        const saved = accounts.get(2);
        assert.equal(bcrypt.getRounds(saved.password), 10);
        assert.ok(await bcrypt.compare(password, saved.password));
        assert.deepEqual({ ...saved, password: before.password }, before);
        assert.equal(response.body.password, undefined);
      }
    }
    const before = accounts.get(2).password;
    assert.equal((await send('/2', 'PUT', { nombre: 'Nombre Editado' })).status, 200);
    assert.equal(accounts.get(2).password, before, 'Omitir la contraseña conserva el hash');
    assert.equal(accounts.get(1).password, legacyHash, 'La cuenta existente no cambia');
  } finally {
    prisma.user.findUnique = originals.findUnique;
    prisma.$transaction = originals.transaction;
    if (server) await new Promise(resolve => server.close(resolve));
    await prisma.$disconnect();
  }
});
