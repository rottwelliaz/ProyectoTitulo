require('./security-env.cjs');
// Run ONLY against a disposable database. No production URL fallback is allowed.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const databaseUrl = process.env.SCHEDULE_TEST_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (!url.pathname.endsWith('/schedule_tests')) throw new Error('Use a disposable schedule_tests database');
  process.env.DATABASE_URL = databaseUrl;
}

describe('reservas con transacciones PostgreSQL reales', { skip: !databaseUrl }, () => {
  require('ts-node/register');
  const express = require('express');
  const jwt = require('jsonwebtoken');
  const prisma = require('../src/config/prisma').default;
  const { PrismaClient } = require('@prisma/client');
  const citas = require('../src/routes/citas').default;
  const servicesRouter = require('../src/routes/servicios').default;
  const { withSchedule } = require('../src/services/schedule');
  const { businessRange } = require('../src/services/businessTime');
  const independent = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const at = minutes => new Date(Date.UTC(new Date().getUTCFullYear() + 1, 0, 11, 10, minutes));
  let server, base, clients;
  const request = async (userId, path, method = 'GET', data) => {
    if (path.endsWith('/disponibilidad/semana') && method === 'PUT') {
      const { availabilitySnapshot } = require('../src/services/availability');
      const profile = await prisma.barberProfile.findUnique({ where: { usuarioId: userId } });
      const { start, end } = businessRange(data.fechaInicio, 7);
      const snapshot = await withSchedule(profile.id, tx => availabilitySnapshot(tx, profile.id, start, end));
      data = { ...data, revision: snapshot.revision, configuracion: snapshot.configuracion };
    }
    const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const response = await fetch(base + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  let sequence = 0;
  const user = role => prisma.user.create({ data: { nombre: 'Prueba', email: `${process.pid}-${Date.now()}-${sequence++}@interval.test`, password: 'not-used', rol: role, aprobado: true } });
  async function fixture(windows = [[0, 180], [30, 180], [60, 180]]) {
    const owner = await user('barbero');
    const profile = await prisma.barberProfile.create({ data: { usuarioId: owner.id, requiereComprobante: false } });
    const service = await prisma.service.create({ data: { perfilBarberoId: profile.id, nombre_servicio: 'Corte', precio: 10000, duracion_minutos: 60 } });
    const slots = [];
    for (const [start, end] of windows) slots.push(await prisma.cita.create({ data: { barberoId: profile.id, estado: 'disponible', fecha_hora: at(start), disponibleHasta: end === null ? null : at(end) } }));
    return { owner, profile, service, slots };
  }
  const book = (f, slot = 0, client = 0, extra = {}) => request(clients[client].id, `/api/citas/${f.slots[slot].id}/agendar`, 'PATCH', { servicioId: f.service.id, ...extra });
  const existing = (f, start, minutes, estado = 'confirmada', snapshot = minutes) => prisma.cita.create({ data: {
    barberoId: f.profile.id, clienteId: clients[0].id, servicioId: f.service.id, fecha_hora: at(start), duracionReservada: snapshot, estado,
  } });

  before(async () => {
    clients = [await user('cliente'), await user('cliente')];
    const app = express(); app.use(express.json()); app.use('/api/citas', citas); app.use('/api/servicios', servicesRouter);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await Promise.all([prisma.$disconnect(), independent.$disconnect()]);
  });

  for (const [label, start, minutes] of [['igual', 0, 60], ['contenido', 15, 15], ['envolvente', -15, 90], ['parcial anterior', -30, 60], ['parcial posterior', 30, 60]]) {
    test(`rechaza solapamiento ${label} y conserva la reserva anterior`, async () => {
      const f = await fixture(); const old = await existing(f, start, minutes);
      const result = await book(f);
      assert.equal(result.status, 409, JSON.stringify(result.body));
      assert.match(result.body.message, /superpone/);
      assert.deepEqual(await prisma.cita.findUnique({ where: { id: old.id } }), old);
    });
  }
  test('acepta reservas consecutivas y conserva duración al editar el servicio', async () => {
    const f = await fixture();
    const first = await book(f); assert.equal(first.status, 200);
    assert.equal((await book(f, 2, 1)).status, 200);
    assert.equal((await request(f.owner.id, `/api/servicios/${f.service.id}`, 'PUT', { duracion_minutos: 30 })).status, 200);
    assert.equal((await prisma.cita.findUnique({ where: { id: first.body.id } })).duracionReservada, 60);
    assert.equal((await book(f, 1)).status, 409);
    assert.equal((await request(f.owner.id, `/api/servicios/${f.service.id}`, 'DELETE')).status, 204);
    assert.equal((await prisma.service.findUnique({ where: { id: f.service.id } })).activo, false);
    assert.equal((await prisma.cita.findUnique({ where: { id: first.body.id } })).duracionReservada, 60);
  });
  test('pendientes ocupan el intervalo, canceladas no', async () => {
    const f = await fixture(); const old = await existing(f, 0, 60, 'pendiente');
    assert.equal((await book(f)).status, 409);
    assert.equal((await request(clients[0].id, `/api/citas/cliente/${old.id}/cancelar`, 'PATCH')).status, 200);
    assert.equal((await book(f)).status, 200);
  });
  test('bloques consecutivos permiten el servicio; descanso y cierre lo impiden', async () => {
    assert.equal((await book(await fixture([[0, 30], [30, 60]]))).status, 200);
    assert.equal((await book(await fixture([[0, 30], [45, 120]]))).status, 409);
    assert.equal((await book(await fixture([[0, 45]]))).status, 409);
    assert.equal((await book(await fixture([[0, null]]))).status, 409);
  });
  for (const slot of [0, 1]) {
    test(`solicitudes simultáneas ${slot ? 'con inicios distintos' : 'al mismo bloque'}: solo una reserva`, async () => {
      const f = await fixture();
      // Queue both HTTP requests behind an independent connection's actual row lock.
      let release, locked;
      const ready = new Promise(resolve => { locked = resolve; });
      const gate = new Promise(resolve => { release = resolve; });
      const holder = independent.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "BarberProfile" WHERE "id" = ${f.profile.id} FOR UPDATE`;
        locked(); await gate;
      }, { timeout: 10000 });
      await ready;
      let settled = 0;
      const requests = [book(f, 0, 0), book(f, slot, 1)].map(p => p.finally(() => { settled++; }));
      try {
        await new Promise(resolve => setTimeout(resolve, 150));
        assert.equal(settled, 0, 'Requests must wait for the PostgreSQL row lock');
      } finally { release(); }
      await holder;
      const results = await Promise.all(requests);
      assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
      assert.equal(await prisma.cita.count({ where: { barberoId: f.profile.id, estado: 'confirmada' } }), 1);
    });
  }
  test('barberos diferentes pueden reservar simultáneamente el mismo horario', async () => {
    const a = await fixture(), b = await fixture();
    assert.deepEqual((await Promise.all([book(a), book(b)])).map(r => r.status), [200, 200]);
  });
  test('mover una reserva vuelve a validar disponibilidad y conflictos', async () => {
    const f = await fixture(); const first = await book(f); await book(f, 2, 1);
    assert.equal((await request(f.owner.id, `/api/citas/${first.body.id}`, 'PUT', { fecha_hora: at(30).toISOString() })).status, 409);
    assert.equal((await request(f.owner.id, `/api/citas/${first.body.id}`, 'PUT', { fecha_hora: at(240).toISOString() })).status, 409);
    assert.equal((await request(f.owner.id, `/api/citas/${first.body.id}`, 'DELETE')).status, 409);
    assert.equal((await request(f.owner.id, `/api/citas/${first.body.id}/estado`, 'PATCH', { estado: 'finalizada' })).status, 409);
  });
  test('publicar descansos conserva citas y cancelar no reabre bloques retirados', async () => {
    const f = await fixture(); const booked = await book(f);
    const saved = await request(f.owner.id, '/api/citas/disponibilidad/semana', 'PUT', { fechaInicio: at(0).toISOString().slice(0, 10), bloques: [] });
    assert.equal(saved.status, 200);
    assert.equal((await prisma.cita.findUnique({ where: { id: booked.body.id } })).estado, 'confirmada');
    assert.equal((await request(clients[0].id, `/api/citas/cliente/${booked.body.id}/cancelar`, 'PATCH')).status, 200);
    assert.equal(await prisma.cita.count({ where: { barberoId: f.profile.id, estado: 'disponible' } }), 0);
  });
  test('consulta disponibilidad según duración y excluye todos los inicios solapados', async () => {
    const f = await fixture(); await book(f);
    const result = await request(clients[0].id, `/api/citas/disponibilidad/${f.profile.id}?fecha=${at(0).toISOString().slice(0, 10)}&servicioId=${f.service.id}`);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.citas.map(c => c.id), [f.slots[2].id]);
  });
  test('duración heredada se congela antes de editar servicio; una reserva huérfana bloquea por seguridad', async () => {
    const f = await fixture(); const legacy = await existing(f, 0, 60, 'confirmada', null);
    assert.equal((await request(f.owner.id, `/api/servicios/${f.service.id}`, 'PUT', { duracion_minutos: 30 })).status, 200);
    assert.equal((await prisma.cita.findUnique({ where: { id: legacy.id } })).duracionReservada, 60);
    await prisma.cita.create({ data: { barberoId: f.profile.id, clienteId: clients[0].id, fecha_hora: at(75), estado: 'confirmada' } });
    assert.equal((await book(f, 2)).status, 409);
  });
  test('comprobante opcional y obligatorio conservan su comportamiento con persistencia real', async () => {
    const f = await fixture();
    await prisma.barberProfile.update({ where: { id: f.profile.id }, data: { requiereComprobante: true } });
    assert.equal((await book(f)).status, 400);
    const result = await book(f, 0, 0, { comprobanteTransferencia: 'data:image/png;base64,AA==', comprobanteNombre: 'pago.png' });
    assert.equal(result.status, 200); assert.equal(result.body.comprobanteNombre, 'pago.png');
    await prisma.barberProfile.update({ where: { id: f.profile.id }, data: { requiereComprobante: false } });
    assert.equal((await book(f, 2, 1)).status, 200);
  });
  test('rollback libera el bloqueo y revierte cambios', async () => {
    const f = await fixture();
    await assert.rejects(withSchedule(f.profile.id, async tx => {
      await tx.cita.deleteMany({ where: { barberoId: f.profile.id, estado: 'disponible' } });
      throw new Error('rollback test');
    }), /rollback test/);
    assert.equal((await book(f)).status, 200);
  });

  for (const day of ['2026-01-15', '2026-07-15', '2026-04-04', '2026-09-06']) {
    test(`consulta diaria Santiago incluye la noche y excluye medianoche siguiente: ${day}`, async () => {
      const f = await fixture([]);
      const { start, end } = businessRange(day);
      const starts = [new Date(start.getTime() - 60000), start, new Date(end.getTime() - 60000), end];
      const slots = [];
      for (const date of starts) slots.push(await prisma.cita.create({ data: {
        barberoId: f.profile.id, fecha_hora: date, disponibleHasta: new Date(date.getTime() + 3600000), estado: 'disponible',
      } }));
      const now = Date.now;
      Date.now = () => new Date('2020-01-01T00:00:00Z').getTime();
      try {
        const result = await request(clients[0].id, `/api/citas/disponibilidad/${f.profile.id}?fecha=${day}&servicioId=${f.service.id}`);
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.deepEqual(result.body.citas.map(c => c.id), [slots[1].id, slots[2].id]);
        assert.equal((await request(clients[0].id, `/api/citas/disponibilidad/${f.profile.id}?fecha=${day}&desde=${day}T00:00:00Z`)).status, 400);
        assert.deepEqual(await prisma.cita.findUnique({ where: { id: slots[2].id } }), slots[2]);
      } finally { Date.now = now; }
    });
  }

  for (const day of ['2026-03-30', '2026-08-31']) {
    test(`consulta y publicación semanal respetan cambio de hora: ${day}`, async () => {
      const f = await fixture([]);
      const { start, end } = businessRange(day, 7);
      const dates = [new Date(start.getTime() - 60000), start, new Date(end.getTime() - 60000), end];
      const appointments = [];
      for (const date of dates) appointments.push(await prisma.cita.create({ data: {
        barberoId: f.profile.id, fecha_hora: date, estado: 'confirmada', servicioId: f.service.id, duracionReservada: 60,
      } }));
      const result = await request(f.owner.id, `/api/citas/agenda-reservas?fechaInicio=${day}`);
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.map(c => c.id), [appointments[2].id, appointments[1].id]);
      const now = Date.now;
      Date.now = () => new Date('2020-01-01T00:00:00Z').getTime();
      try {
        const lastHour = { inicio: new Date(end.getTime() - 3600000).toISOString(), fin: end.toISOString() };
        const saved = await request(f.owner.id, '/api/citas/disponibilidad/semana', 'PUT', { fechaInicio: day, bloques: [lastHour] });
        assert.equal(saved.status, 200, JSON.stringify(saved.body));
        assert.equal(saved.body.citas[0].fecha_hora, lastHour.inicio);
        assert.equal(saved.body.citas[0].disponibleHasta, lastHour.fin);
        assert.deepEqual(await prisma.cita.findUnique({ where: { id: appointments[2].id } }), appointments[2]);
      } finally { Date.now = now; }
    });
  }

  test('PostgreSQL conserva los instantes Prisma aunque cambie TimeZone de la sesión', async () => {
    const f = await fixture();
    const old = await existing(f, 0, 60);
    for (const zone of ['UTC', 'America/Santiago', 'Asia/Tokyo']) {
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT set_config('TimeZone', ${zone}, true)`;
        assert.deepEqual(await tx.cita.findUnique({ where: { id: old.id } }), old);
        const rows = await tx.$queryRaw`SELECT "fecha_hora"::text AS stored, pg_typeof("fecha_hora")::text AS type FROM "Cita" WHERE id = ${old.id}`;
        assert.equal(rows[0].type, 'timestamp without time zone');
        assert.equal(rows[0].stored, old.fecha_hora.toISOString().replace('T', ' ').replace('.000Z', ''));
      });
    }
  });
});
