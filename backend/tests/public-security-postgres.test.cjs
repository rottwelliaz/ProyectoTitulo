require('./security-env.cjs');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const url = process.env.SCHEDULE_TEST_DATABASE_URL;
if (url) {
  if (new URL(url).pathname !== '/schedule_tests') throw Error('Only disposable schedule_tests is allowed');
  process.env.DATABASE_URL = url;
}
describe('Grupo 5: perfiles, validaciones y autorización con PostgreSQL real', { skip: !url }, () => {
  require('ts-node/register');
  const express = require('express'), jwt = require('jsonwebtoken'), bcrypt = require('bcryptjs');
  const prisma = require('../src/config/prisma').default;
  let server, base, sequence = 0, owner, other, client, admin, profile, service, slot, place;
  const email = () => `g5-${process.pid}-${Date.now()}-${sequence++}@test.invalid`;
  const user = (rol, extra = {}) => prisma.user.create({ data: { nombre: 'Usuario Prueba', email: email(), telefono: '912345678', password: bcrypt.hashSync('123456', 4), rol, ...extra } });
  const request = async (account, path, method = 'GET', data) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(account ? { Authorization: 'Bearer ' + jwt.sign({ id: account.id, rol: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' }) } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
  };
  const noPrivate = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!/^(banco|password|email|telefono|cliente|comprobante|fecha_creacion|fecha_actualizacion)/.test(key), `Expuesto: ${key}`);
      noPrivate(child);
    }
  };
  before(async () => {
    owner = await user('barbero'); other = await user('barbero'); client = await user('cliente'); admin = await user('admin');
    place = await prisma.lugarTrabajo.create({ data: { nombre_barberia: 'Club Centro', direccion: 'Concepción' } });
    profile = await prisma.barberProfile.create({ data: { usuarioId: owner.id, biografia: 'Biografía profesional', especialidades: ['Fade', 'Barba'], lugarTrabajoId: place.id, bancoRut: 'PRIVADO', bancoNroCuenta: 'PRIVADO', requiereComprobante: false } });
    await prisma.barberProfile.create({ data: { usuarioId: other.id } });
    service = await prisma.service.create({ data: { perfilBarberoId: profile.id, nombre_servicio: 'Corte', precio: 10000, duracion_minutos: 30 } });
    await prisma.service.create({ data: { perfilBarberoId: profile.id, nombre_servicio: 'Oculto', precio: 1, duracion_minutos: 30, activo: false } });
    slot = await prisma.cita.create({ data: { barberoId: profile.id, fecha_hora: new Date('2035-01-15T15:00:00Z'), disponibleHasta: new Date('2035-01-15T16:00:00Z') } });
    const app = express(); app.use(express.json());
    for (const route of ['auth', 'usuarios', 'citas', 'servicios', 'lugartrabajo', 'conversations', 'profesional']) app.use('/' + route, require('../src/routes/' + route).default);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); }); base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); });
  test('perfil y catálogo anónimos exponen solo datos profesionales y servicios activos', async () => {
    const r = await request(null, `/usuarios/barberos/${profile.id}/perfil`);
    assert.equal(r.status, 200); noPrivate(r.body); assert.deepEqual(r.body.especialidades, ['Fade', 'Barba']);
    assert.equal(r.body.usuario.nombre, owner.nombre); assert.equal(r.body.lugarTrabajo.direccion, 'Concepción');
    assert.deepEqual(r.body.servicios.map(s => s.id), [service.id]); assert.equal(r.body.servicios[0].precio, 10000);
    const catalog = await request(null, '/usuarios?rol=barbero'); assert.equal(catalog.status, 200); noPrivate(catalog.body);
    assert.equal((await request(null, '/usuarios/barberos/invalid/perfil')).status, 400);
    assert.equal((await request(null, '/usuarios/barberos/2147483647/perfil')).status, 404);
    for (const patch of [{ activo: false }, { aprobado: false }, { rol: 'cliente' }]) {
      await prisma.user.update({ where: { id: owner.id }, data: patch });
      assert.equal((await request(null, `/usuarios/barberos/${profile.id}/perfil`)).status, 404);
      await prisma.user.update({ where: { id: owner.id }, data: { activo: true, aprobado: true, rol: 'barbero' } });
    }
  });
  test('disponibilidad pública respeta servicio, bloqueos y reservas, sin clientes ni comprobantes', async () => {
    const path = `/usuarios/barberos/${profile.id}/disponibilidad?fecha=2035-01-15&servicioId=${service.id}`;
    const free = await request(null, path); assert.equal(free.status, 200); noPrivate(free.body);
    assert.equal(free.headers.get('cache-control'), 'no-store'); assert.deepEqual(free.body.citas.map(c => c.id), [slot.id]);
    assert.equal((await request(null, path.replace(service.id, 'ajeno'))).status, 404);
    assert.equal((await request(null, path.replace('2035-01-15', 'no-fecha'))).status, 400);
    const block = await prisma.agendaBloqueo.create({ data: { barberoId: profile.id, inicio: new Date('2035-01-15T15:00:00Z'), fin: new Date('2035-01-15T15:30:00Z') } });
    assert.equal((await request(null, path)).body.citas.length, 0);
    await prisma.agendaBloqueo.update({ where: { id: block.id }, data: { inicio: new Date('2035-01-16T15:00:00Z'), fin: new Date('2035-01-16T15:30:00Z') } });
    await prisma.cita.create({ data: { barberoId: profile.id, clienteId: client.id, servicioId: service.id, fecha_hora: slot.fecha_hora, duracionReservada: 30, estado: 'confirmada', comprobanteTransferencia: 'PRIVADO' } });
    const occupied = await request(null, path); noPrivate(occupied.body); assert.equal(occupied.body.citas.length, 0);
  });
  test('solicitudes directas no eluden registro, duplicados ni permisos de rol', async () => {
    const payload = { nombre: 'Cliente Nuevo', email: email(), password: 'una clave nueva', telefono: '912345678' };
    for (const patch of [{ email: 'invalido' }, { password: '123' }, { telefono: '' }, { nombre: '' }, { rol: 'admin' }, { aprobado: true }]) {
      assert.equal((await request(null, '/usuarios', 'POST', { ...payload, ...patch })).status, 400);
    }
    const created = await request(null, '/usuarios', 'POST', { ...payload, rol: 'barbero' });
    assert.equal(created.status, 201); assert.equal(created.body.rol, 'cliente'); assert.equal(created.body.password, undefined);
    assert.equal((await request(null, '/usuarios', 'POST', { ...payload, email: payload.email.toUpperCase() })).status, 409);
    const stored = await prisma.user.findUnique({ where: { id: created.body.id } });
    assert.ok(await bcrypt.compare(payload.password, stored.password)); assert.equal(bcrypt.getRounds(stored.password), 10);
    const raceEmail = email();
    const results = await Promise.all([raceEmail, raceEmail.toUpperCase()].map(address => request(null, '/usuarios', 'POST', { ...payload, email: address })));
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    assert.equal((await request(created.body, '/profesional/estadisticas')).status, 403);
  });
  test('cuentas existentes ingresan con contraseña anterior; cambios nuevos y correo único se validan', async () => {
    const r = await request(null, '/auth/login', 'POST', { email: client.email.toUpperCase(), password: '123456' });
    assert.equal(r.status, 200); assert.equal(r.body.user.password, undefined); assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(jwt.verify(r.body.token, process.env.JWT_SECRET).id, client.id);
    assert.equal((await request(client, '/auth/me', 'PUT', { nombre: 'Nombre Nuevo' })).status, 200);
    assert.equal((await request(client, '/auth/me', 'PUT', { password: 'corta' })).status, 400);
    assert.equal((await request(admin, `/usuarios/${client.id}`, 'PUT', { password: 'corta' })).status, 400);
    assert.equal((await request(client, '/auth/me', 'PUT', { email: owner.email.toUpperCase() })).status, 409);
    assert.equal((await request(admin, `/usuarios/${client.id}`, 'PUT', { email: owner.email.toUpperCase() })).status, 409);
    assert.equal((await request(client, '/auth/me', 'PUT', { password: 'contraseña nueva' })).status, 200);
    assert.ok(await bcrypt.compare('contraseña nueva', (await prisma.user.findUnique({ where: { id: client.id } })).password));
    await prisma.user.update({ where: { id: client.id }, data: { activo: false } });
    assert.equal((await request(client, '/auth/me')).status, 403);
    assert.equal((await request(null, '/auth/login', 'POST', { email: client.email, password: 'contraseña nueva' })).status, 403);
    await prisma.user.update({ where: { id: client.id }, data: { activo: true } });
  });
  test('endpoints privados y escrituras ajenas quedan protegidos aunque JWT declare admin', async () => {
    for (const path of ['/auth/me', '/usuarios', '/usuarios/admin/dashboard', '/servicios', '/lugartrabajo', '/conversations', '/citas/cliente/mias', '/profesional/estadisticas']) assert.equal((await request(null, path)).status, 401, path);
    for (const [account, path, method, body] of [
      [client, `/usuarios/${owner.id}`, 'PUT', { rol: 'admin' }],
      [client, '/auth/me', 'PUT', { rol: 'admin' }],
      [other, `/servicios/${service.id}`, 'PUT', { precio: 1 }],
      [other, `/lugartrabajo/${place.id}`, 'PUT', { direccion: 'Ajena' }],
      [other, `/citas/${slot.id}`, 'DELETE', undefined],
    ]) assert.ok([400, 403].includes((await request(account, path, method, body)).status), path);
    assert.equal((await request(null, `/citas/${slot.id}/agendar`, 'PATCH', { servicioId: service.id })).status, 401);
    assert.equal((await prisma.service.findUnique({ where: { id: service.id } })).precio, 10000);
    assert.equal((await prisma.lugarTrabajo.findUnique({ where: { id: place.id } })).direccion, 'Concepción');
  });
  test('unicidad se conserva al competir registro y edición de correo', async () => {
    const address = email();
    const results = await Promise.all([
      request(client, '/auth/me', 'PUT', { email: address.toUpperCase() }),
      request(null, '/usuarios', 'POST', { nombre: 'Cuenta Nueva', email: address, password: 'contraseña nueva', telefono: '912345678' }),
    ]);
    assert.equal(results.filter(r => r.status === 409).length, 1);
    assert.equal(results.filter(r => [200, 201].includes(r.status)).length, 1);
    assert.equal(await prisma.user.count({ where: { email: { equals: address, mode: 'insensitive' } } }), 1);
  });
  test('login real limita intentos por cuenta y devuelve Retry-After sin filtrar usuarios', async () => {
    const address = email();
    for (let i = 0; i < 10; i++) {
      const r = await request(null, '/auth/login', 'POST', { email: i % 2 ? address.toUpperCase() : address, password: 'incorrecta' });
      assert.equal(r.status, 401); assert.deepEqual(r.body, { message: 'Credenciales inválidas' });
    }
    const blocked = await request(null, '/auth/login', 'POST', { email: address, password: 'incorrecta' });
    assert.equal(blocked.status, 429); assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    assert.equal(blocked.body.token, undefined);
  });
});
