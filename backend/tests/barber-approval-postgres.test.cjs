require('./security-env.cjs');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const databaseUrl = process.env.SCHEDULE_TEST_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (url.pathname !== '/schedule_tests' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw Error('Only local disposable schedule_tests is allowed');
  process.env.DATABASE_URL = databaseUrl;
}

describe('registro y resolución segura de barberos con PostgreSQL real', { skip: !databaseUrl }, () => {
  require('ts-node/register');
  const express = require('express'), jwt = require('jsonwebtoken'), bcrypt = require('bcryptjs');
  const prisma = require('../src/config/prisma').default;
  const password = 'Barber-test-password-2026';
  let server, base, admin, client, sequence = 0;
  const email = () => `approval-${process.pid}-${Date.now()}-${sequence++}@test.invalid`;
  const token = user => jwt.sign({ id: user.id, rol: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const request = async (user, path, method = 'GET', body, headers = {}) => {
    const response = await fetch(base + path, { method, headers: {
      'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${typeof user === 'string' ? user : token(user)}` } : {}), ...headers,
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const register = async (rol = 'barbero', address = email()) => {
    // Each fixture represents a distinct registering client; production limits stay enabled.
    const response = await request(null, '/usuarios', 'POST', { nombre: 'Solicitud Prueba', email: address, password, telefono: '912345678', rol }, { 'X-Forwarded-For': `127.90.0.${++sequence % 250 + 1}` });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return response.body;
  };
  const resolve = (user, action = 'rechazar') => request(admin, `/usuarios/${user.id}/${action}-barbero`, 'PATCH');
  const application = user => prisma.solicitudProfesional.findUnique({ where: { usuarioId: user.id } });
  before(async () => {
    admin = await prisma.user.create({ data: { nombre: 'Admin Prueba', email: email(), password: bcrypt.hashSync(password, 4), rol: 'admin' } });
    const app = express(); app.set('trust proxy', 'loopback'); app.use(express.json());
    for (const name of ['usuarios', 'auth', 'servicios', 'citas', 'profesional', 'conversations', 'lugartrabajo']) app.use('/' + name, require('../src/routes/' + name).default);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
    client = await register('cliente');
  });
  after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); });

  test('cliente se guarda como cliente aprobado, inicia sesión y no crea solicitud', async () => {
    const stored = await prisma.user.findUnique({ where: { id: client.id } });
    assert.equal(stored.rol, 'cliente'); assert.equal(stored.aprobado, true); assert.equal(await application(client), null);
    assert.equal((await request(null, '/auth/login', 'POST', { email: client.email, password })).status, 200);
  });
  test('registro público no permite admin, aprobación ni campos adicionales', async () => {
    for (const extra of [{ rol: 'admin' }, { aprobado: true }, { activo: false }]) {
      const r = await request(null, '/usuarios', 'POST', { nombre: 'Solicitud Prueba', email: email(), password, telefono: '912345678', ...extra });
      assert.equal(r.status, 400);
    }
  });
  test('barbero nace pendiente; listado y dashboard excluyen clientes incluso con solicitud antigua', async () => {
    const pending = await register();
    const stored = await prisma.user.findUnique({ where: { id: pending.id } });
    assert.equal(stored.rol, 'barbero'); assert.equal(stored.aprobado, false); assert.equal((await application(pending)).estado, 'pendiente');
    const legacyClient = await register('cliente');
    await prisma.solicitudProfesional.create({ data: { usuarioId: legacyClient.id } });
    for (const users of [(await request(admin, '/usuarios/barberos/pendientes')).body, (await request(admin, '/usuarios/admin/dashboard')).body.barberosPendientes]) {
      assert.ok(users.some(user => user.id === pending.id));
      assert.ok(users.every(user => user.rol === 'barbero' && !user.aprobado && user.solicitudProfesional.estado === 'pendiente'));
      assert.ok(!users.some(user => [legacyClient.id, client.id].includes(user.id)));
    }
    assert.equal((await resolve(legacyClient)).status, 409);
    assert.equal((await resolve(legacyClient, 'aprobar')).status, 409);
    assert.equal((await request(admin, `/usuarios/${legacyClient.id}`, 'PUT', { rol: 'barbero', aprobado: true })).status, 409);
    assert.equal((await request(admin, `/usuarios/${legacyClient.id}`, 'PUT', { rol: 'barbero', aprobado: false })).status, 200);
    assert.equal((await application(legacyClient)).estado, 'pendiente');
    assert.ok((await request(admin, '/usuarios/barberos/pendientes')).body.some(user => user.id === legacyClient.id));
  });
  test('login y JWT conservan rol; pendiente no puede usar funciones profesionales ni hacerse pasar por cliente', async () => {
    const pending = await register();
    const login = await request(null, '/auth/login', 'POST', { email: pending.email, password });
    assert.equal(login.status, 200); assert.equal(login.body.user.rol, 'barbero'); assert.equal(login.body.user.aprobado, false);
    assert.equal((await request(login.body.token, '/auth/me')).body.rol, 'barbero');
    for (const [path, method, data] of [
      ['/profesional/estadisticas', 'GET'], ['/servicios', 'POST', {}], ['/lugartrabajo', 'POST', {}],
      ['/citas/cliente/mias', 'GET'], ['/conversations', 'GET'], ['/auth/me/banking', 'PUT', {}], ['/auth/me/booking-settings', 'PUT', { requiereComprobante: false }],
    ]) assert.equal((await request(pending, path, method, data)).status, 403, path);
  });
  test('aprobar conserva usuario y rol, habilita acceso con el mismo JWT y sale de pendientes', async () => {
    const pending = await register(), oldToken = token(pending);
    const count = await prisma.user.count();
    const result = await resolve(pending, 'aprobar');
    assert.equal(result.status, 200); assert.equal(result.body.id, pending.id); assert.equal(result.body.rol, 'barbero'); assert.equal(result.body.aprobado, true);
    assert.equal(await prisma.user.count(), count); assert.equal((await application(pending)).estado, 'aprobada');
    assert.equal(await prisma.barberProfile.count({ where: { usuarioId: pending.id } }), 1);
    assert.equal((await request(oldToken, '/profesional/estadisticas?desde=2035-01-01&hasta=2035-01-07')).status, 200);
    assert.ok(!(await request(admin, '/usuarios/barberos/pendientes')).body.some(user => user.id === pending.id));
    assert.equal((await resolve(pending)).status, 409); assert.equal((await resolve(pending, 'aprobar')).status, 409);
    assert.ok(await prisma.user.findUnique({ where: { id: pending.id } }));
  });
  test('rechazo elimina PostgreSQL, invalida JWT y credenciales y libera el correo', async () => {
    const pending = await register(), oldToken = token(pending), app = await application(pending);
    assert.equal((await resolve(pending)).status, 200);
    assert.equal(await prisma.user.findUnique({ where: { id: pending.id } }), null);
    assert.equal(await prisma.solicitudProfesional.findUnique({ where: { id: app.id } }), null);
    assert.equal((await request(oldToken, '/auth/me')).status, 401);
    assert.equal((await request(null, '/auth/login', 'POST', { email: pending.email, password })).status, 401);
    assert.ok(!(await request(admin, '/usuarios/barberos/pendientes')).body.some(user => user.id === pending.id));
    assert.notEqual((await register('barbero', pending.email)).id, pending.id);
  });
  test('elimina solo configuración exclusiva; conserva lugar de trabajo compartido y datos de otro barbero', async () => {
    for (const shared of [false, true]) {
      const pending = await register();
      const place = await prisma.lugarTrabajo.create({ data: { nombre_barberia: 'Lugar de prueba' } });
      const profile = await prisma.barberProfile.create({ data: { usuarioId: pending.id, lugarTrabajoId: place.id } });
      let other;
      if (shared) { other = await register(); await prisma.barberProfile.create({ data: { usuarioId: other.id, lugarTrabajoId: place.id } }); }
      const service = await prisma.service.create({ data: { perfilBarberoId: profile.id, nombre_servicio: 'Corte prueba', precio: 10000 } });
      await prisma.agendaBloqueo.create({ data: { barberoId: profile.id, inicio: new Date('2035-01-01'), fin: new Date('2035-01-02') } });
      await prisma.agendaSemana.create({ data: { barberoId: profile.id, inicio: new Date('2035-01-01'), configuracion: {} } });
      assert.equal((await resolve(pending)).status, 200);
      assert.equal(await prisma.barberProfile.findUnique({ where: { id: profile.id } }), null);
      assert.equal(await prisma.service.findUnique({ where: { id: service.id } }), null);
      assert.equal(await prisma.agendaBloqueo.count({ where: { barberoId: profile.id } }), 0);
      assert.equal(await prisma.agendaSemana.count({ where: { barberoId: profile.id } }), 0);
      assert.equal(Boolean(await prisma.lugarTrabajo.findUnique({ where: { id: place.id } })), shared);
      if (other) assert.ok(await prisma.barberProfile.findUnique({ where: { usuarioId: other.id } }));
    }
  });
  test('rechazo no permite eliminar clientes, admins, solicitudes resueltas o barberos sin solicitud', async () => {
    const noRequest = await prisma.user.create({ data: { nombre: 'Barbero Prueba', email: email(), password: 'hash', rol: 'barbero', aprobado: false } });
    const resolved = await register(); await prisma.solicitudProfesional.update({ where: { usuarioId: resolved.id }, data: { estado: 'rechazada', fechaResolucion: new Date(), motivoRechazo: 'Resultado anterior', revisorId: admin.id } });
    const alreadyApproved = await register(); await prisma.user.update({ where: { id: alreadyApproved.id }, data: { aprobado: true } });
    for (const user of [client, admin, noRequest, resolved, alreadyApproved]) {
      assert.equal((await resolve(user)).status, 409); assert.ok(await prisma.user.findUnique({ where: { id: user.id } }));
    }
    assert.equal((await request(admin, '/usuarios/invalid/rechazar-barbero', 'PATCH')).status, 400);
    assert.equal((await request(admin, '/usuarios/2147483647/rechazar-barbero', 'PATCH')).status, 404);
  });
  test('aprobación y rechazo exigen administrador autenticado aunque JWT diga admin', async () => {
    const pending = await register();
    for (const actor of [null, client, pending]) for (const action of ['aprobar', 'rechazar']) {
      assert.equal((await request(actor, `/usuarios/${pending.id}/${action}-barbero`, 'PATCH')).status, actor ? 403 : 401);
    }
    assert.ok(await prisma.user.findUnique({ where: { id: pending.id } }));
  });
  test('mensajes históricos bloquean rechazo sin cascadas ni cambios parciales', async () => {
    const pending = await register();
    const conversation = await prisma.conversation.create({ data: { clientId: client.id, barberId: pending.id, messages: { create: { senderId: client.id, content: 'Historial conservado' } } }, include: { messages: true } });
    const result = await resolve(pending); assert.equal(result.status, 409); assert.match(result.body.message, /históricos/);
    assert.equal((await application(pending)).estado, 'pendiente'); assert.ok(await prisma.user.findUnique({ where: { id: pending.id } }));
    assert.ok(await prisma.message.findUnique({ where: { id: conversation.messages[0].id } }));
  });
  test('citas y servicios referenciados bloquean rechazo y preservan toda la configuración', async () => {
    const pending = await register();
    const profile = await prisma.barberProfile.create({ data: { usuarioId: pending.id } });
    const service = await prisma.service.create({ data: { perfilBarberoId: profile.id, nombre_servicio: 'Corte', precio: 10000 } });
    const cita = await prisma.cita.create({ data: { barberoId: profile.id, servicioId: service.id, clienteId: client.id, estado: 'confirmada', fecha_hora: new Date('2035-01-01') } });
    assert.equal((await resolve(pending)).status, 409);
    assert.ok(await prisma.cita.findUnique({ where: { id: cita.id } })); assert.ok(await prisma.service.findUnique({ where: { id: service.id } }));
    assert.equal((await application(pending)).estado, 'pendiente');
  });
  test('solicitar desde perfil también deja rol barbero pendiente de manera atómica', async () => {
    const user = await register('cliente');
    assert.equal((await request(user, '/usuarios/solicitud-profesional', 'POST')).status, 201);
    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(stored.rol, 'barbero'); assert.equal(stored.aprobado, false); assert.equal((await application(user)).estado, 'pendiente');
    assert.equal((await resolve(user, 'aprobar')).status, 200);
  });
  test('un fallo al eliminar el usuario revierte también solicitud, perfil y servicios', async () => {
    const pending = await register();
    const profile = await prisma.barberProfile.create({ data: { usuarioId: pending.id } });
    const service = await prisma.service.create({ data: { perfilBarberoId: profile.id, nombre_servicio: 'Corte', precio: 10000 } });
    let failId = pending.id;
    prisma.$use(async (params, next) => {
      if (params.model === 'User' && params.action === 'delete' && params.args.where.id === failId) throw Error('Controlled persistence failure');
      return next(params);
    });
    const log = console.error;
    try {
      console.error = () => {};
      assert.equal((await resolve(pending)).status, 500);
      assert.ok(await prisma.user.findUnique({ where: { id: pending.id } }));
      assert.equal((await application(pending)).estado, 'pendiente');
      assert.ok(await prisma.barberProfile.findUnique({ where: { id: profile.id } }));
      assert.ok(await prisma.service.findUnique({ where: { id: service.id } }));
    } finally { failId = null; console.error = log; }
  });
  test('aprobación y rechazo concurrentes resuelven una sola vez sin eliminar aprobados', async () => {
    const pending = await register();
    const results = await Promise.all([resolve(pending, 'aprobar'), resolve(pending)]);
    assert.equal(results.filter(r => r.status === 200).length, 1);
    assert.ok(results.every(r => [200, 404, 409].includes(r.status)));
    const stored = await prisma.user.findUnique({ where: { id: pending.id } });
    if (results[0].status === 200) { assert.equal(stored.rol, 'barbero'); assert.equal(stored.aprobado, true); }
    else { assert.equal(stored, null); assert.equal(await application(pending), null); }
  });
  test('navegador, API y PostgreSQL: registro barbero, cancelación, rechazo, nuevo registro y aprobación', {
    skip: !process.env.CALENDAR_TEST_FRONTEND_URL, timeout: 90000,
  }, async () => {
    const { chromium, expect } = require('../../Frontend/node_modules/@playwright/test');
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const applicantPage = await browser.newPage(), adminPage = await browser.newPage();
    const address = email(), frontend = process.env.CALENDAR_TEST_FRONTEND_URL;
    try {
      for (const page of [applicantPage, adminPage]) await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        // The browser represents a separate client from the many HTTP fixtures above.
        const response = await route.fetch({ url: base + url.pathname.replace(/^\/api/, '') + url.search, headers: { ...route.request().headers(), 'X-Forwarded-For': '127.91.0.1' } });
        await route.fulfill({ response });
      });
      const signup = async () => {
        await applicantPage.goto(frontend + '/registro');
        for (const [name, value] of Object.entries({ nombre: 'Barbero Navegador', email: address, password, telefono: '912345678' })) await applicantPage.locator(`[name=${name}]`).fill(value);
        await applicantPage.locator('label').filter({ has: applicantPage.locator('[name=rol][value=barbero]') }).click();
        await applicantPage.locator('#register-button').click();
        await expect(applicantPage.locator('.cbc-notification')).toContainText('Tu cuenta de barbero está pendiente de aprobación.');
        await expect(applicantPage).toHaveURL(/\/login\/?$/);
        const stored = await prisma.user.findUnique({ where: { email: address } });
        assert.equal(stored.rol, 'barbero'); assert.equal(stored.aprobado, false);
        await applicantPage.locator('[name=email]').fill(address); await applicantPage.locator('[name=password]').fill(password);
        await applicantPage.locator('#login-button').click();
        await expect(applicantPage).toHaveURL(/\/perfil\/?$/);
        await expect(applicantPage.locator('#profile-role')).toHaveText('barbero');
        return stored;
      };
      const first = await signup();
      await adminPage.goto(frontend + '/login');
      await adminPage.locator('[name=email]').fill(admin.email); await adminPage.locator('[name=password]').fill(password);
      await adminPage.locator('#login-button').click(); await expect(adminPage).toHaveURL(/\/admin\/?$/);
      await adminPage.locator('[data-admin-tab=pendientes]').click();
      const firstCard = adminPage.locator(`#admin-pendientes-list [data-user-id="${first.id}"]`);
      await expect(firstCard).toContainText('Rol: barbero');
      await firstCard.getByRole('button', { name: 'Rechazar', exact: true }).click();
      await adminPage.getByRole('button', { name: 'Cancelar', exact: true }).click();
      assert.ok(await prisma.user.findUnique({ where: { id: first.id } }));
      await firstCard.getByRole('button', { name: 'Rechazar', exact: true }).click();
      await adminPage.getByRole('button', { name: 'Sí, rechazar y eliminar', exact: true }).click();
      await expect.poll(() => prisma.user.findUnique({ where: { id: first.id } })).toBe(null);
      await expect(firstCard).toHaveCount(0);
      await applicantPage.reload(); await expect(applicantPage).toHaveURL(/\/login/);
      const second = await signup(); assert.notEqual(first.id, second.id);
      await adminPage.reload(); await adminPage.locator('[data-admin-tab=pendientes]').click();
      await adminPage.locator(`#admin-pendientes-list [data-user-id="${second.id}"]`).getByRole('button', { name: 'Aprobar', exact: true }).click();
      await expect(adminPage.locator('.cbc-notification')).toContainText('El barbero ha sido aprobado correctamente.');
      assert.equal((await prisma.user.findUnique({ where: { id: second.id } })).aprobado, true);
      await applicantPage.goto(frontend + '/perfil-profesional');
      await expect(applicantPage.locator('html')).toHaveAttribute('data-auth-state', 'ready');
      await expect(applicantPage).toHaveURL(/\/perfil-profesional\/?$/);
    } finally {
      for (const page of [applicantPage, adminPage]) await page.unrouteAll({ behavior: 'wait' });
      await browser.close();
    }
  });
});
