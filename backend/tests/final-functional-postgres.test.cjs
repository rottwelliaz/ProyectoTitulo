require('./security-env.cjs');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const databaseUrl = process.env.SCHEDULE_TEST_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (url.pathname !== '/schedule_tests' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw Error('Use only a local disposable schedule_tests database');
  }
  process.env.DATABASE_URL = databaseUrl;
}

describe('auditoría final: cuentas, administración y mensajería con PostgreSQL', { skip: !databaseUrl }, () => {
  require('ts-node/register');
  const express = require('express');
  const bcrypt = require('bcryptjs');
  const prisma = require('../src/config/prisma').default;
  const password = 'Audit-test-password-2026';
  let server, base, sequence = 0;
  const email = () => `final-${process.pid}-${Date.now()}-${sequence++}@test.invalid`;
  const request = async (token, route, method = 'GET', body) => {
    const response = await fetch(base + route, { method, headers: {
      'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  async function account(rol) {
    const user = await prisma.user.create({ data: { nombre: 'Auditoría Final', email: email(),
      password: await bcrypt.hash(password, 10), rol, aprobado: true } });
    const login = await request(null, '/auth/login', 'POST', { email: user.email, password });
    assert.equal(login.status, 200);
    return { ...user, token: login.body.token };
  }
  before(async () => {
    const app = express(); app.use(express.json());
    for (const name of ['usuarios', 'auth', 'conversations', 'citas', 'profesional', 'lugartrabajo']) {
      app.use('/api/' + name, require('../src/routes/' + name).default);
    }
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}/api`;
  });
  after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); });

  test('registro, login real de los tres roles y cambio de contraseña persistente', async () => {
    const address = email();
    const registration = await request(null, '/usuarios', 'POST', { nombre: 'Cliente Auditoría',
      email: address, password, telefono: '912345678', rol: 'cliente' });
    assert.equal(registration.status, 201);
    assert.equal('password' in registration.body, false);
    const login = await request(null, '/auth/login', 'POST', { email: address, password });
    assert.equal(login.status, 200);
    assert.equal((await request(login.body.token, '/auth/me')).body.id, registration.body.id);
    const nextPassword = password + '-changed';
    assert.equal((await request(login.body.token, '/auth/me', 'PUT', { password: nextPassword })).status, 200);
    assert.equal((await request(null, '/auth/login', 'POST', { email: address, password })).status, 401);
    assert.equal((await request(null, '/auth/login', 'POST', { email: address, password: nextPassword })).status, 200);
    for (const role of ['barbero', 'admin']) {
      const user = await account(role);
      assert.equal((await request(user.token, '/auth/me')).body.rol, role);
    }
  });

  test('dashboard: totales coinciden con PostgreSQL y los otros roles no acceden', async () => {
    const admin = await account('admin'), client = await account('cliente'), barber = await account('barbero');
    const dashboard = await request(admin.token, '/usuarios/admin/dashboard');
    assert.equal(dashboard.status, 200);
    const counts = await prisma.user.groupBy({ by: ['rol'], _count: { _all: true } });
    const count = role => counts.find(row => row.rol === role)?._count._all || 0;
    assert.deepEqual(dashboard.body.stats, {
      totalUsuarios: await prisma.user.count(), clientes: count('cliente'), barberos: count('barbero'), admins: count('admin'),
      barberosAprobados: await prisma.user.count({ where: { rol: 'barbero', aprobado: true } }),
      barberosPendientes: await prisma.solicitudProfesional.count({ where: { estado: 'pendiente' } }),
    });
    for (const [token, status] of [[null, 401], [client.token, 403], [barber.token, 403]]) {
      assert.equal((await request(token, '/usuarios/admin/dashboard')).status, status);
    }
  });

  test('mensajería: apertura idempotente, envío, lectura, respuesta y aislamiento', async () => {
    const client = await account('cliente'), barber = await account('barbero');
    const outsider = await account('cliente'), admin = await account('admin');
    const opened = await request(client.token, '/conversations', 'POST', { barberId: barber.id });
    assert.equal(opened.status, 200);
    const id = opened.body.id, route = `/conversations/${id}/messages`;
    assert.equal((await request(client.token, '/conversations', 'POST', { barberId: barber.id })).body.id, id);
    assert.equal(await prisma.conversation.count({ where: { clientId: client.id, barberId: barber.id } }), 1);
    const message = await request(client.token, route, 'POST', { content: '  Hola <b>barbero</b>  ' });
    assert.equal(message.status, 201); assert.equal(message.body.content, 'Hola <b>barbero</b>');
    assert.equal(message.body.read, false);
    assert.equal((await request(outsider.token, route)).status, 404);
    assert.equal((await request(outsider.token, route, 'POST', { content: 'intruso' })).status, 404);
    assert.equal((await request(admin.token, route)).status, 403);
    assert.equal((await request(barber.token, route)).body[0].read, true);
    assert.equal((await prisma.message.findUnique({ where: { id: message.body.id } })).read, true);
    assert.equal((await request(barber.token, route, 'POST', { content: 'Confirmado' })).status, 201);
    const list = await request(client.token, '/conversations');
    assert.equal(list.body[0].lastMessage.content, 'Confirmado');
    assert.equal(list.body[0].otherUser.id, barber.id);
    assert.equal((await request(client.token, route, 'POST', { content: '  ' })).status, 400);
    assert.equal((await request(client.token, route, 'POST', { content: 'a'.repeat(2001) })).status, 400);
    assert.equal(await prisma.message.count({ where: { conversationId: id } }), 2);
  });

  test('lugar de trabajo: CRUD propio y entradas inválidas devuelven 400 sin errores internos', async () => {
    const barber = await account('barbero'), admin = await account('admin');
    const profile = await prisma.barberProfile.create({ data: { usuarioId: barber.id } });
    for (const value of [42, {}, [], null]) {
      assert.equal((await request(barber.token, '/lugartrabajo', 'POST', { nombre_barberia: value, direccion: 'Concepción' })).status, 400);
    }
    for (const id of ['1.5', 'Infinity', '0', '-1', '9007199254740993']) {
      assert.equal((await request(admin.token, '/lugartrabajo', 'POST', { nombre_barberia: 'Local', direccion: 'Concepción', perfilBarberoId: id })).status, 400);
      for (const method of ['GET', 'PUT', 'DELETE']) {
        assert.equal((await request(barber.token, '/lugartrabajo/' + id, method, method === 'PUT' ? { direccion: 'Otra' } : undefined)).status, 400);
      }
    }
    const created = await request(barber.token, '/lugartrabajo', 'POST', { nombre_barberia: 'Local Auditoría', direccion: 'Concepción' });
    assert.equal(created.status, 201);
    const route = '/lugartrabajo/' + created.body.id;
    assert.equal((await request(barber.token, route)).status, 200);
    assert.equal((await request(barber.token, route, 'PUT', { direccion: 'Dirección Actualizada' })).status, 200);
    assert.equal((await request(barber.token, route)).body.direccion, 'Dirección Actualizada');
    assert.equal((await request(barber.token, route, 'DELETE')).status, 204);
    assert.equal((await prisma.barberProfile.findUnique({ where: { id: profile.id } })).lugarTrabajoId, null);
  });

  test('navegador real: registro, login, edición, mensaje escapado y cierre de sesión', {
    skip: !process.env.CALENDAR_TEST_FRONTEND_URL, timeout: 60000,
  }, async () => {
    const { chromium, expect } = require('../../Frontend/node_modules/@playwright/test');
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
      const page = await browser.newPage(), address = email(), barber = await account('barbero');
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        const response = await route.fetch({ url: base.replace(/\/api$/, '') + url.pathname + url.search });
        await route.fulfill({ response });
      });
      await page.goto(process.env.CALENDAR_TEST_FRONTEND_URL + '/registro');
      await page.locator('[name=nombre]').fill('Cliente Navegador');
      await page.locator('[name=email]').fill(address);
      await page.locator('[name=password]').fill(password);
      await page.locator('[name=telefono]').fill('912345678');
      await page.locator('#register-button').click();
      await expect(page).toHaveURL(/\/login\/?$/);
      await page.locator('[name=email]').fill(address);
      await page.locator('[name=password]').fill(password);
      await page.locator('button[type=submit]').click();
      await expect(page).toHaveURL(/\/home\/?$/);
      await page.goto(process.env.CALENDAR_TEST_FRONTEND_URL + '/perfil');
      await page.locator('#edit-profile-button').click();
      await page.locator('#profile-input-nombre').fill('Nombre Persistido');
      await page.getByRole('button', { name: 'Guardar cambios' }).click();
      await expect.poll(async () => (await prisma.user.findUnique({ where: { email: address } })).nombre).toBe('Nombre Persistido');
      await page.reload();
      await expect(page.locator('#profile-input-nombre')).toHaveValue('Nombre Persistido');
      await page.goto(process.env.CALENDAR_TEST_FRONTEND_URL + '/mensajes?barbero=' + barber.id);
      const content = '<img src=x onerror="window.auditInjection=1"> mensaje';
      await page.locator('#message-input').fill(content);
      await page.locator('#send-message').click();
      await expect(page.locator('#messages-history')).toContainText(content);
      assert.equal(await page.locator('#messages-history img').count(), 0);
      assert.equal(await page.evaluate(() => window.auditInjection), undefined);
      assert.equal(await prisma.message.count({ where: { content, sender: { email: address } } }), 1);
      await page.goto(process.env.CALENDAR_TEST_FRONTEND_URL + '/home');
      await page.locator('[data-session-trigger]').click();
      await page.locator('[data-session-logout]').click();
      await expect(page).toHaveURL(/\/login\/?$/);
      assert.equal(await page.evaluate(() => localStorage.getItem('token')), null);
      assert.equal(await page.evaluate(() => localStorage.getItem('user')), null);
    } finally { await browser.close(); }
  });
});
