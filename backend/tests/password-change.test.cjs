require('./security-env.cjs');
require('ts-node/register');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const databaseUrl = process.env.PASSWORD_TEST_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/password_change_tests_[a-z0-9_]+$/.test(url.pathname)) {
    throw Error('Password tests require a local, disposable password_change_tests_* database');
  }
  process.env.DATABASE_URL = databaseUrl;
}
const prisma = require('../src/config/prisma').default;
const originals = { findUnique: prisma.user.findUnique, findMany: prisma.user.findMany, updateMany: prisma.user.updateMany };
const accounts = new Map();
let base, server, sequence = 0;
const oldPassword = 'Clave actual de prueba 2026';
const newPassword = 'Nueva clave de prueba 2026';
const payload = (patch = {}) => ({ currentPassword: oldPassword, newPassword, confirmPassword: newPassword, ...patch });
const signed = id => jwt.sign({ id, rol: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const ipFor = id => `127.21.${Math.floor(id / 250) % 250}.${id % 250 + 1}`;
async function account(rol = 'cliente', password = oldPassword) {
  const id = ++sequence;
  const data = { nombre: 'Cliente Prueba', email: `password-${process.pid}-${Date.now()}-${id}@test.invalid`,
    telefono: '912345678', foto_perfil: null, rol, aprobado: true, activo: true, password: await bcrypt.hash(password, 4) };
  const user = databaseUrl ? await prisma.user.create({ data }) : { ...data, id, fecha_creacion: new Date() };
  accounts.set(user.id, user);
  return user;
}
async function stored(user) { return databaseUrl ? prisma.user.findUnique({ where: { id: user.id } }) : { ...accounts.get(user.id) }; }
function profile(user) { const { password, fecha_actualizacion, ...rest } = user; return rest; }
async function request(user, path = '/api/auth/me/password', data = payload(), options = {}) {
  const response = await fetch(base + path, { method: 'PUT', headers: {
    'Content-Type': 'application/json', 'X-Forwarded-For': options.ip || ipFor(user?.id || 249),
    ...(user ? { Authorization: `Bearer ${signed(user.id)}` } : {}), ...options.headers,
  }, body: JSON.stringify(data) });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function login(user, password) {
  const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ipFor(user.id) },
    body: JSON.stringify({ email: user.email, password }) });
  return { status: response.status, body: await response.json() };
}

before(async () => {
  if (!databaseUrl) {
    prisma.user.findUnique = async ({ where }) => {
      const user = [...accounts.values()].find(user => user.id === where.id || user.email === where.email);
      return user ? { ...user } : null;
    };
    prisma.user.findMany = async () => [];
    prisma.user.updateMany = async ({ where, data }) => {
      const user = accounts.get(where.id);
      if (!user || user.password !== where.password) return { count: 0 };
      Object.assign(user, data); return { count: 1 };
    };
  }
  const app = express();
  // Only this local test server trusts loopback so individual test IPs can exercise both limits.
  app.set('trust proxy', 'loopback');
  app.use(express.json());
  app.use('/api/auth', require('../src/routes/auth').default);
  app.use('/api/usuarios', require('../src/routes/usuarios').default);
  if (databaseUrl) app.use('/api/citas', require('../src/routes/citas').default);
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  Object.assign(prisma.user, originals);
  if (databaseUrl) await prisma.user.deleteMany({ where: { id: { in: [...accounts.keys()] } } });
  await prisma.$disconnect();
});

for (const role of ['cliente', 'barbero', 'admin']) {
test(`${role}: cambio válido, bcrypt 10, login nuevo, rechazo de clave anterior y perfil intacto`, async () => {
  const user = await account(role), other = await account();
  const before = await stored(user), otherBefore = await stored(other);
  const changed = await request(user);
  assert.equal(changed.status, 200);
  const after = await stored(user);
  assert.notEqual(after.password, before.password);
  assert.equal(bcrypt.getRounds(after.password), 10);
  assert.ok(await bcrypt.compare(newPassword, after.password));
  assert.deepEqual(profile(after), profile(before));
  assert.deepEqual(await stored(other), otherBefore);
  const loggedIn = await login(user, newPassword);
  assert.equal(loggedIn.status, 200);
  assert.equal(jwt.verify(loggedIn.body.token, process.env.JWT_SECRET).id, user.id);
  assert.equal(loggedIn.body.user.password, undefined);
  assert.equal((await login(user, oldPassword)).status, 401);
  assert.equal(changed.headers.get('cache-control'), 'no-store');
  for (const secret of [oldPassword, newPassword, before.password, after.password]) {
    assert.ok(!JSON.stringify(changed.body).includes(secret), 'Response must not contain credentials');
  }
});

test(`${role}: contraseña actual incorrecta no cambia datos ni invalida la sesión`, async () => {
  const user = await account(role), before = await stored(user);
  const response = await request(user, undefined, payload({ currentPassword: 'Credencial incorrecta de prueba' }));
  assert.equal(response.status, 400);
  assert.match(response.body.message, /actual es incorrecta/);
  assert.deepEqual(await stored(user), before);
  assert.equal((await login(user, oldPassword)).status, 200);
});

test(`${role}: confirmación diferente y reutilización de contraseña se rechazan`, async () => {
  for (const patch of [{ confirmPassword: 'Otra confirmación de prueba' }, { newPassword: oldPassword, confirmPassword: oldPassword }]) {
    const user = await account(role), before = await stored(user);
    const response = await request(user, undefined, payload(patch));
    assert.equal(response.status, 400);
    assert.match(response.body.message, /no coinciden|diferente de la actual/);
    assert.deepEqual(await stored(user), before);
  }
});
}

test('reglas existentes, campos obligatorios, tipos y límite UTF-8 se comprueban en servidor', async () => {
  for (const patch of [
    { newPassword: 'corta', confirmPassword: 'corta' },
    { newPassword: ' '.repeat(12), confirmPassword: ' '.repeat(12) },
    { newPassword: 'á'.repeat(37), confirmPassword: 'á'.repeat(37) },
    { newPassword: 'x'.repeat(73), confirmPassword: 'x'.repeat(73) },
    { currentPassword: '' }, { currentPassword: 123 }, { newPassword: 123 }, { confirmPassword: '' },
    { currentPassword: undefined }, { newPassword: undefined }, { confirmPassword: undefined },
  ]) {
    const user = await account(), before = await stored(user);
    assert.equal((await request(user, undefined, payload(patch))).status, 400);
    assert.deepEqual(await stored(user), before);
  }
});

test('credenciales antiguas cortas siguen siendo válidas para comprobar la contraseña actual', async () => {
  const user = await account('cliente', 'legacy');
  const before = await stored(user);
  assert.equal((await login(user, 'legacy')).status, 200);
  assert.deepEqual(await stored(user), before);
  assert.equal((await request(user, undefined, payload({ currentPassword: 'legacy' }))).status, 200);
  assert.equal((await login(user, newPassword)).status, 200);
});

for (const length of [7, 8, 9]) {
test(`cambio de contraseña: ${length} caracteres`, async () => {
  const user = await account(), before = await stored(user);
  const next = 'x'.repeat(length);
  const response = await request(user, undefined, payload({ newPassword: next, confirmPassword: next }));
  assert.equal(response.status, length < 8 ? 400 : 200);
  if (length < 8) {
    assert.equal(response.body.message, 'La contraseña debe tener al menos 8 caracteres');
    assert.deepEqual(await stored(user), before);
  } else {
    const after = await stored(user);
    assert.equal(bcrypt.getRounds(after.password), 10);
    assert.ok(await bcrypt.compare(next, after.password));
    assert.equal((await login(user, next)).status, 200);
  }
});
}

test('JWT ausente, falso o vencido impide la operación', async () => {
  const user = await account(), before = await stored(user);
  assert.equal((await request(null)).status, 401);
  for (const token of ['invalid', jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: -1 })]) {
    assert.equal((await request(user, undefined, payload(), { headers: { Authorization: 'Bearer ' + token } })).status, 401);
  }
  assert.deepEqual(await stored(user), before);
});

test('IDs o datos adicionales no permiten cambiar cuentas ajenas ni otros datos del perfil', async () => {
  const user = await account(), other = await account(), before = await stored(other);
  for (const patch of [{ id: other.id }, { userId: other.id }, { nombre: 'Nombre Alterado' }, { rol: 'admin' }]) {
    assert.equal((await request(user, undefined, payload(patch))).status, 400);
  }
  assert.equal((await request(user, `/api/usuarios/${other.id}`, { password: newPassword })).status, 403);
  assert.deepEqual(await stored(other), before);
});

test('actualización general del perfil no acepta contraseñas para ningún rol', async () => {
  for (const rol of ['cliente', 'barbero', 'admin']) {
    const user = await account(rol), before = await stored(user);
    assert.equal((await request(user, '/api/auth/me', { password: newPassword })).status, 400);
    assert.deepEqual(await stored(user), before);
  }
});

for (const role of ['cliente', 'barbero', 'admin']) {
test(`${role}: límite por cuenta rechaza intentos repetidos incluso desde otra IP`, async () => {
  const user = await account(role), before = await stored(user);
  for (let i = 0; i < 10; i++) assert.equal((await request(user, undefined, payload({ currentPassword: 'Credencial errónea de prueba' }))).status, 400);
  const blocked = await request(user, undefined, payload(), { ip: '127.99.1.1' });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.deepEqual(await stored(user), before);
  assert.equal((await request(await account())).status, 200);
});
}

test('límite por IP se comparte entre cuentas sin escribir sus contraseñas', async () => {
  const users = await Promise.all(['cliente', 'barbero', 'admin', 'cliente'].map(role => account(role)));
  for (let i = 0; i < 30; i++) {
    const response = await request(users[i % 4], undefined, payload({ currentPassword: 'Credencial errónea de prueba' }), { ip: '127.99.2.2' });
    assert.equal(response.status, 400);
  }
  assert.equal((await request(users[3], undefined, payload(), { ip: '127.99.2.2' })).status, 429);
});

test('dos cambios simultáneos no sobrescriben una contraseña ya actualizada', async () => {
  const user = await account();
  const responses = await Promise.all([request(user), request(user)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal((await login(user, newPassword)).status, 200);
});

test('error inesperado no expone claves ni hashes en respuesta o logs', async () => {
  const user = await account(), update = prisma.user.updateMany, log = console.error;
  const logs = [];
  try {
    prisma.user.updateMany = async () => { throw Error('Private persistence failure'); };
    console.error = (...args) => logs.push(args);
    const response = await request(user);
    assert.equal(response.status, 500);
    assert.deepEqual(logs, [['changePassword failed']]);
    for (const secret of [oldPassword, newPassword, user.password]) assert.ok(!JSON.stringify(response.body).includes(secret));
  } finally { prisma.user.updateMany = update; console.error = log; }
});

for (const role of ['cliente', 'barbero', 'admin']) {
test(`${role} cambia desde Mi Perfil y vuelve a iniciar sesión en el navegador con PostgreSQL real`, {
  skip: !databaseUrl || !process.env.PASSWORD_TEST_FRONTEND_URL,
}, async () => {
  const { chromium } = require('../../Frontend/node_modules/@playwright/test');
  const user = await account(role), before = await stored(user);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: base + url.pathname + url.search });
      await route.fulfill({ response });
    });
    const { expect } = require('../../Frontend/node_modules/@playwright/test');
    await page.goto(process.env.PASSWORD_TEST_FRONTEND_URL + '/login?redirect=%2Fperfil');
    await page.locator('[name=email]').fill(user.email);
    await page.locator('[name=password]').fill(oldPassword);
    await page.locator('#login-button').click();
    await expect(page).toHaveURL(/\/perfil$/);
    await page.getByLabel('Contraseña actual', { exact: true }).fill(oldPassword);
    await page.getByLabel('Nueva contraseña', { exact: true }).fill(newPassword);
    await page.getByLabel('Confirmar nueva contraseña', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: 'Guardar nueva contraseña' }).click();
    await expect(page.locator('#password-change-message')).toContainText('actualizada correctamente');
    assert.deepEqual(profile(await stored(user)), profile(before));
    await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto(process.env.PASSWORD_TEST_FRONTEND_URL + '/login?redirect=%2Fperfil');
    await page.locator('[name=email]').fill(user.email);
    await page.locator('[name=password]').fill(oldPassword);
    await page.locator('#login-button').click();
    await expect(page.locator('#login-message')).toContainText('Credenciales inválidas');
    await page.locator('[name=password]').fill(newPassword);
    await page.locator('#login-button').click();
    await expect(page).toHaveURL(/\/perfil$/);
    await expect(page.locator('[data-session-name]')).toHaveText(user.nombre);
    await expect(page.locator('[data-session-role]')).toHaveText({ cliente: 'Cliente', barbero: 'Barbero', admin: 'Administrador' }[role]);
  } finally {
    await page.unrouteAll({ behavior: 'wait' });
    await browser.close();
  }
});
}
