require('./security-env.cjs');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const url = process.env.SCHEDULE_TEST_DATABASE_URL;
if (url) {
  if (new URL(url).pathname !== '/schedule_tests') throw Error('Use only disposable schedule_tests');
  process.env.DATABASE_URL = url;
}
describe('ciclo e historial de reservas por HTTP y PostgreSQL', { skip: !url }, () => {
  require('ts-node/register');
  const express = require('express');
  const jwt = require('jsonwebtoken');
  const prisma = require('../src/config/prisma').default;
  const { PrismaClient } = require('@prisma/client');
  const independent = new PrismaClient();
  let server, base, client, stranger, admin, sequence = 0;
  const user = (rol, extra = {}) => prisma.user.create({ data: { nombre: 'Historial', email: `lifecycle-${process.pid}-${Date.now()}-${sequence++}@test.invalid`, password: 'unused', rol, ...extra } });
  const request = async (account, path, method = 'GET', body) => {
    const token = account && jwt.sign({ id: account.id, rol: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const state = (account, id, estado) => request(account, `/citas/${id}/estado`, 'PATCH', { estado });
  async function fixture() {
    const owner = await user('barbero');
    const profile = await prisma.barberProfile.create({ data: { usuarioId: owner.id, requiereComprobante: false } });
    const service = await prisma.service.create({ data: { perfilBarberoId: profile.id, nombre_servicio: 'Corte original', precio: 10000, duracion_minutos: 30 } });
    const start = new Date(Date.now() + 86400000);
    const slot = await prisma.cita.create({ data: { barberoId: profile.id, fecha_hora: start, disponibleHasta: new Date(+start + 3600000) } });
    return { owner, profile, service, slot };
  }
  const book = f => request(client, `/citas/${f.slot.id}/agendar`, 'PATCH', { servicioId: f.service.id });
  const seed = (f, estado = 'pendiente', minutes = 60) => prisma.cita.create({ data: {
    clienteId: client.id, barberoId: f.profile.id, servicioId: f.service.id, fecha_hora: new Date(Date.now() + minutes * 60000), estado,
    nombreServicioReservado: f.service.nombre_servicio, precioReservado: 10000, duracionReservada: 30,
  } });
  before(async () => {
    client = await user('cliente'); stranger = await user('cliente'); admin = await user('admin');
    const app = express(); app.use(express.json());
    for (const name of ['citas', 'servicios', 'usuarios']) app.use('/' + name, require('../src/routes/' + name).default);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { if (server) await new Promise(r => server.close(r)); await prisma.$disconnect(); await independent.$disconnect(); });

  test('profesionales pendientes, rechazados/no aprobados, desactivados y sin rol no reciben reservas HTTP', async () => {
    const f = await fixture();
    for (const data of [{ aprobado: false }, { aprobado: false, activo: false }, { aprobado: true, activo: false }, { activo: true, rol: 'cliente' }]) {
      await prisma.user.update({ where: { id: f.owner.id }, data });
      const r = await book(f); assert.equal(r.status, 409, JSON.stringify(r.body));
      assert.equal(await prisma.cita.count({ where: { barberoId: f.profile.id, estado: { not: 'disponible' } } }), 0);
    }
    await prisma.user.update({ where: { id: f.owner.id }, data: { rol: 'barbero', aprobado: true, activo: true } });
    assert.equal((await book(f)).status, 200);
    assert.equal((await request(client, '/citas/disponibilidad/2147483647?fecha=2030-01-01')).status, 404);
  });

  test('confirmar, rechazar y cancelar pendientes; finalizar e inasistencia conservan historial', async () => {
    const f = await fixture();
    for (const target of ['confirmada', 'rechazada', 'cancelada']) {
      const a = await seed(f);
      assert.equal((await state(f.owner, a.id, target)).status, 200);
      const audit = await request(client, `/citas/${a.id}/historial`);
      assert.equal(audit.status, 200); assert.equal(audit.body.length, 1);
      assert.equal(audit.body[0].estadoAnterior, 'pendiente'); assert.equal(audit.body[0].estadoNuevo, target);
      assert.equal(audit.body[0].responsableId, f.owner.id); assert.ok(audit.body[0].fecha);
    }
    for (const target of ['finalizada', 'inasistencia']) {
      const a = await seed(f, 'confirmada', -60);
      assert.equal((await state(admin, a.id, target)).status, 200);
      assert.equal((await state(admin, a.id, 'cancelada')).status, 409);
      for (const [account, path] of [[client, '/citas/cliente/mias'], [f.owner, '/citas/mias']]) {
        assert.ok((await request(account, path)).body.some(c => c.id === a.id && c.estado === target));
      }
    }
  });

  test('administrador no confirma un profesional no aprobado o inactivo; servicios retirados no se reservan', async () => {
    const f = await fixture(), a = await seed(f);
    for (const data of [{ aprobado: false }, { aprobado: true, activo: false }]) {
      await prisma.user.update({ where: { id: f.owner.id }, data });
      assert.equal((await state(admin, a.id, 'confirmada')).status, 409);
      assert.equal((await request(client, `/citas/disponibilidad/${f.profile.id}?fecha=${f.slot.fecha_hora.toISOString().slice(0, 10)}`)).status, 409);
    }
    await prisma.user.update({ where: { id: f.owner.id }, data: { activo: true } });
    assert.equal((await request(f.owner, `/servicios/${f.service.id}`, 'DELETE')).status, 204);
    assert.equal((await book(f)).status, 404);
    assert.equal((await prisma.cita.findUnique({ where: { id: a.id } })).estado, 'pendiente');
  });

  test('rechazo libera el intervalo publicado, pero nunca recrea disponibilidad retirada', async () => {
    const f = await fixture();
    const a = await prisma.cita.create({ data: { barberoId: f.profile.id, clienteId: client.id, servicioId: f.service.id,
      fecha_hora: f.slot.fecha_hora, estado: 'pendiente', duracionReservada: 30, nombreServicioReservado: 'Corte original', precioReservado: 10000 } });
    assert.equal((await book(f)).status, 409);
    assert.equal((await state(f.owner, a.id, 'rechazada')).status, 200);
    assert.equal((await book(f)).status, 200);
    assert.equal((await prisma.cita.findUnique({ where: { id: a.id } })).estado, 'rechazada');
    assert.equal(await prisma.cita.count({ where: { barberoId: f.profile.id, estado: 'disponible' } }), 1);
  });

  test('una desactivación concurrente se relee antes de crear la reserva', async () => {
    const f = await fixture();
    let locked, release;
    const ready = new Promise(r => locked = r), gate = new Promise(r => release = r);
    const holder = independent.$transaction(async tx => {
      await tx.user.update({ where: { id: f.owner.id }, data: { activo: false } });
      locked(); await gate;
    }, { timeout: 10000 });
    await ready;
    let completed = false;
    const pending = book(f).finally(() => completed = true);
    try { await new Promise(r => setTimeout(r, 150)); assert.equal(completed, false); } finally { release(); }
    await holder;
    assert.equal((await pending).status, 409);
    assert.equal(await prisma.cita.count({ where: { barberoId: f.profile.id, estado: { not: 'disponible' } } }), 0);
  });

  test('HTTP impide cambios inválidos, cancelar el pasado, finalizar el futuro y reprogramar el pasado', async () => {
    const f = await fixture(); const past = await seed(f, 'confirmada', -60), future = await seed(f, 'confirmada');
    for (const account of [client, f.owner, admin]) assert.equal((await state(account, past.id, 'cancelada')).status, 409);
    for (const target of ['finalizada', 'inasistencia', 'rechazada', 'confirmada']) assert.equal((await state(f.owner, future.id, target)).status, 409);
    assert.equal((await state(f.owner, future.id, 'disponible')).status, 400);
    assert.equal((await state(f.owner, f.slot.id, 'cancelada')).status, 409);
    const next = new Date(Date.now() + 86400000); next.setUTCMinutes(0, 0, 0);
    assert.equal((await request(f.owner, `/citas/${past.id}`, 'PUT', { fecha_hora: next.toISOString() })).status, 409);
    assert.equal((await request(client, `/citas/cliente/${future.id}/cancelar`, 'PATCH', { estado: 'finalizada' })).body.estado, 'cancelada');
  });

  test('roles y propiedad protegen estados e historial; JWT no concede rol administrador', async () => {
    const f = await fixture(), other = await fixture(), a = await seed(f);
    for (const account of [stranger, other.owner]) {
      assert.equal((await state(account, a.id, 'cancelada')).status, 403);
      assert.equal((await request(account, `/citas/${a.id}/historial`)).status, 403);
    }
    assert.equal((await state(null, a.id, 'cancelada')).status, 401);
    for (const target of ['confirmada', 'rechazada', 'finalizada', 'inasistencia']) assert.equal((await state(client, a.id, target)).status, 403);
    for (const account of [client, f.owner, admin]) assert.equal((await request(account, `/citas/${a.id}/historial`)).status, 200);
    assert.equal((await state(admin, a.id, 'confirmada')).status, 200);
  });

  test('nombre, precio, duración, participantes y fechas sobreviven a editar/desactivar servicio y usuario', async () => {
    const f = await fixture(), booked = await book(f); assert.equal(booked.status, 200);
    const id = booked.body.id, created = booked.body.fecha_creacion;
    assert.equal((await request(f.owner, `/servicios/${f.service.id}`, 'PUT', { nombre_servicio: 'Nuevo corte', precio: 20000, duracion_minutos: 60 })).status, 200);
    assert.equal((await request(f.owner, `/servicios/${f.service.id}`, 'DELETE')).status, 204);
    const history = (await request(client, '/citas/cliente/mias')).body.find(c => c.id === id);
    assert.deepEqual(history.servicio, { id: f.service.id, nombre_servicio: 'Corte original', precio: 10000, duracion_minutos: 30 });
    assert.equal(history.fecha_creacion, created);
    assert.equal((await request(f.owner, `/citas/${id}`, 'DELETE')).status, 409);
    assert.equal((await request(admin, `/usuarios/${f.owner.id}`, 'DELETE')).status, 204);
    assert.equal((await request(f.owner, '/citas/mias')).status, 403);
    assert.equal((await prisma.user.findUnique({ where: { id: f.owner.id } })).activo, false);
    assert.equal((await prisma.cita.findUnique({ where: { id } })).clienteId, client.id);
    assert.equal((await state(client, id, 'cancelada')).status, 200);
    const row = await prisma.cita.findUnique({ where: { id } });
    assert.equal(row.fecha_creacion.toISOString(), created); assert.ok(row.fecha_actualizacion > row.fecha_creacion);
    const audit = (await request(admin, `/citas/${id}/historial`)).body;
    assert.deepEqual(audit.map(c => [c.estadoAnterior, c.estadoNuevo, c.responsableId]), [[null, 'confirmada', client.id], ['confirmada', 'cancelada', client.id]]);
  });

  test('SQL impide borrar reservas o sobrescribir snapshots; sí permite retirar disponibilidad vacía', async () => {
    const f = await fixture(), a = await seed(f);
    await assert.rejects(prisma.cita.delete({ where: { id: a.id } }));
    await assert.rejects(prisma.cita.update({ where: { id: a.id }, data: { precioReservado: 1 } }));
    await assert.rejects(prisma.cita.update({ where: { id: a.id }, data: { estado: 'disponible' } }));
    await assert.rejects(prisma.user.delete({ where: { id: client.id } }));
    await prisma.cita.delete({ where: { id: f.slot.id } });
    assert.equal((await prisma.cita.findUnique({ where: { id: a.id } })).precioReservado, 10000);
  });

  test('dos estados terminales simultáneos: un éxito, un conflicto y un solo evento', async () => {
    const f = await fixture(), a = await seed(f, 'confirmada', -60);
    let release, locked;
    const ready = new Promise(r => locked = r), gate = new Promise(r => release = r);
    const holder = independent.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "BarberProfile" WHERE "id" = ${f.profile.id} FOR UPDATE`;
      locked(); await gate;
    }, { timeout: 10000 });
    await ready;
    let completed = 0;
    const requests = ['finalizada', 'inasistencia'].map(target => state(f.owner, a.id, target).finally(() => completed++));
    try { await new Promise(r => setTimeout(r, 150)); assert.equal(completed, 0); } finally { release(); }
    await holder;
    assert.deepEqual((await Promise.all(requests)).map(r => r.status).sort(), [200, 409]);
    assert.equal(await prisma.citaCambioEstado.count({ where: { citaId: a.id } }), 1);
  });

  test('fallo del registro de auditoría revierte el cambio de estado', async () => {
    const f = await fixture(), a = await seed(f);
    const { withSchedule } = require('../src/services/schedule');
    await assert.rejects(withSchedule(f.profile.id, async tx => {
      await tx.cita.update({ where: { id: a.id }, data: { estado: 'cancelada' } });
      await tx.citaCambioEstado.create({ data: { citaId: a.id, estadoAnterior: 'pendiente', estadoNuevo: 'cancelada', responsableId: 2147483647 } });
    }));
    assert.equal((await prisma.cita.findUnique({ where: { id: a.id } })).estado, 'pendiente');
    assert.equal(await prisma.citaCambioEstado.count({ where: { citaId: a.id } }), 0);
  });
});
