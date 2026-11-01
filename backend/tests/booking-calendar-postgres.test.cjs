require('./security-env.cjs');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const databaseUrl = process.env.SCHEDULE_TEST_DATABASE_URL;
if (databaseUrl) {
  if (new URL(databaseUrl).pathname !== '/schedule_tests') throw Error('Only the isolated schedule_tests database is allowed');
  process.env.DATABASE_URL = databaseUrl;
}

describe('calendario público semanal con PostgreSQL real', { skip: !databaseUrl }, () => {
  require('ts-node/register');
  const express = require('express'), jwt = require('jsonwebtoken');
  const prisma = require('../src/config/prisma').default;
  const { businessDate, businessRange, slotInstant } = require('../src/services/businessTime');
  let server, base, sequence = 0;
  const day = '2035-01-15'; // Monday, in America/Santiago.
  const at = (time, date = day) => slotInstant(date, time);
  const account = rol => prisma.user.create({ data: {
    nombre: `Calendario ${process.pid} ${sequence++}`, email: `calendar-${process.pid}-${Date.now()}-${sequence++}@test.invalid`,
    telefono: '912345678', password: 'unused', aprobado: true, rol,
  } });
  async function fixture(proof = false, dates = [day, '2035-01-16']) {
    const owner = await account('barbero'), client = await account('cliente'), rival = await account('cliente');
    const place = await prisma.lugarTrabajo.create({ data: { nombre_barberia: 'Club prueba', direccion: 'Centro' } });
    const profile = await prisma.barberProfile.create({ data: {
      usuarioId: owner.id, lugarTrabajoId: place.id, requiereComprobante: proof,
      bancoNombre: 'Titular prueba', bancoRut: '11111111-1', bancoNombreBanco: 'Banco prueba',
      bancoTipoCuenta: 'Corriente', bancoNroCuenta: '123456', bancoCorreo: 'banco@test.invalid',
    } });
    const service = await prisma.service.create({ data: { perfilBarberoId: profile.id, nombre_servicio: 'Corte calendario', precio: 10000, duracion_minutos: 60 } });
    const slots = [];
    for (const date of dates) for (const time of ['09:00','09:30','10:00','10:30','11:00','11:30']) {
      slots.push(await prisma.cita.create({ data: { barberoId: profile.id, fecha_hora: at(time, date), disponibleHasta: new Date(at(time, date).getTime() + 30 * 60000) } }));
    }
    await prisma.agendaSemana.create({ data: { barberoId: profile.id, inicio: businessRange(dates[0]).start, configuracion: { startTime: '09:00', endTime: '12:00', blockMinutes: 30 } } });
    return { owner, client, rival, profile, service, slots };
  }
  const request = async (account, path, method = 'GET', data) => {
    const response = await fetch(base + path, { method,
      headers: { 'Content-Type': 'application/json', ...(account ? { Authorization: 'Bearer ' + jwt.sign({ id: account.id }, process.env.JWT_SECRET, { expiresIn: '1h' }) } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
  };
  const calendar = (f, date = day) => request(null, `/api/usuarios/barberos/${f.profile.id}/disponibilidad?fecha=${date}&vista=semana&servicioId=${f.service.id}`);
  const book = (f, index = 0, client = f.client) => request(client, `/api/citas/${f.slots[index].id}/agendar`, 'PATCH', { servicioId: f.service.id });
  const cell = (response, time, date = day) => response.body.calendario.horarios.find(c => c.fecha === date && c.hora === time);
  before(async () => {
    const app = express(); app.use(express.json({ limit: '6mb' }));
    for (const name of ['citas', 'usuarios', 'auth']) app.use('/api/' + name, require('../src/routes/' + name).default);
    server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); });

  test('estados reales, duración completa, descansos, cierre y privacidad estricta', async () => {
    const f = await fixture();
    const reserved = await prisma.cita.create({ data: {
      barberoId: f.profile.id, clienteId: f.client.id, servicioId: f.service.id,
      fecha_hora: at('10:00'), duracionReservada: 30, estado: 'confirmada', comprobanteTransferencia: 'COMPROBANTE_PRIVADO',
    } });
    await prisma.agendaBloqueo.create({ data: { barberoId: f.profile.id, inicio: at('11:00'), fin: at('11:30') } });
    const response = await calendar(f);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(cell(response, '09:00').estado, 'available');
    assert.equal(cell(response, '09:30').estado, 'unavailable'); // 60 minutes overlap 10:00.
    assert.equal(cell(response, '10:00').estado, 'reserved');
    assert.equal(cell(response, '10:00').citaId, undefined);
    assert.equal(cell(response, '10:30').motivo, 'duracion'); // Crosses the break.
    assert.equal(cell(response, '11:00').motivo, 'bloqueado');
    assert.equal(cell(response, '11:30').estado, 'unavailable'); // Extends past closing.
    assert.equal(cell(response, '09:00', '2035-01-17').motivo, 'sin_publicar');
    assert.ok(!response.body.calendario.horas.includes('12:00'));
    for (const value of [reserved.id, f.client.email, f.client.nombre, f.client.telefono, 'COMPROBANTE_PRIVADO', 'clienteId', 'comprobante', 'banco']) assert.ok(!JSON.stringify(response.body).includes(value), value);
    for (const entry of response.body.calendario.horarios) assert.ok(Object.keys(entry).every(key => ['fecha','hora','fecha_hora','estado','citaId','motivo'].includes(key)));
    const daily = await request(null, `/api/usuarios/barberos/${f.profile.id}/disponibilidad?fecha=${day}&servicioId=${f.service.id}`);
    assert.deepEqual(daily.body.citas, response.body.citas.filter(c => c.fecha_hora < at('00:00', '2035-01-16').toISOString()));
    assert.equal(daily.body.calendario, undefined);
    await prisma.service.update({ where: { id: f.service.id }, data: { duracion_minutos: 30 } });
    assert.equal(cell(await calendar(f), '09:30').estado, 'available');
  });

  test('cancelación libera solo la disponibilidad publicada; retirar o bloquear nunca la recrea', async () => {
    const f = await fixture();
    const reservation = await book(f); assert.equal(reservation.status, 200);
    assert.equal(cell(await calendar(f), '09:00').estado, 'reserved');
    assert.equal((await request(f.client, `/api/citas/cliente/${reservation.body.id}/cancelar`, 'PATCH')).status, 200);
    assert.equal(cell(await calendar(f), '09:00').estado, 'available');
    await prisma.agendaBloqueo.create({ data: { barberoId: f.profile.id, inicio: at('09:00'), fin: at('10:00') } });
    assert.equal(cell(await calendar(f), '09:00').estado, 'unavailable');
    assert.equal((await book(f)).status, 409);
  });

  test('dos clientes que consultaron libre: solo una reserva simultánea, incluso con inicios diferentes', async () => {
    for (const secondIndex of [0, 1]) {
      const f = await fixture();
      assert.equal(cell(await calendar(f), '09:00').estado, 'available');
      const results = await Promise.all([book(f), book(f, secondIndex, f.rival)]);
      assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
      assert.equal(await prisma.cita.count({ where: { barberoId: f.profile.id, estado: 'confirmada' } }), 1);
      const updated = await calendar(f);
      assert.equal(updated.body.calendario.horarios.filter(c => c.fecha === day && c.estado === 'reserved').length, 2);
    }
  });

  test('intervalos cruzando días y reservas heredadas sin duración no se ofrecen como libres', async () => {
    const f = await fixture();
    await prisma.cita.create({ data: { barberoId: f.profile.id, fecha_hora: at('23:30', '2035-01-14'), duracionReservada: 600, estado: 'pendiente' } });
    assert.equal(cell(await calendar(f), '09:00').estado, 'reserved');
    await prisma.cita.create({ data: { barberoId: f.profile.id, fecha_hora: at('10:00'), estado: 'confirmada' } });
    assert.equal(cell(await calendar(f), '11:00').estado, 'unavailable');
  });

  test('un servicio al final del día o semana también valida los intervalos del período siguiente', async () => {
    const f = await fixture();
    const first = await prisma.cita.create({ data: { barberoId: f.profile.id, fecha_hora: at('23:30', '2035-01-21'), disponibleHasta: at('00:00', '2035-01-22') } });
    await prisma.cita.create({ data: { barberoId: f.profile.id, fecha_hora: at('00:00', '2035-01-22'), disponibleHasta: at('00:30', '2035-01-22') } });
    assert.equal(cell(await calendar(f), '23:30', '2035-01-21').estado, 'available');
    const occupied = await prisma.cita.create({ data: { barberoId: f.profile.id, fecha_hora: at('00:00', '2035-01-22'), estado: 'confirmada', duracionReservada: 30 } });
    assert.equal(cell(await calendar(f), '23:30', '2035-01-21').estado, 'unavailable');
    assert.equal((await request(f.client, `/api/citas/${first.id}/agendar`, 'PATCH', { servicioId: f.service.id })).status, 409);
    await prisma.cita.update({ where: { id: occupied.id }, data: { estado: 'cancelada' } });
    await prisma.agendaBloqueo.create({ data: { barberoId: f.profile.id, inicio: at('00:00', '2035-01-22'), fin: at('00:15', '2035-01-22') } });
    assert.equal(cell(await calendar(f), '23:30', '2035-01-21').estado, 'unavailable');
    const daily = await request(null, `/api/usuarios/barberos/${f.profile.id}/disponibilidad?fecha=2035-01-21&servicioId=${f.service.id}`);
    assert.equal(daily.body.citas.length, 0);
  });

  test('semanas de 167 y 169 horas usan fechas civiles de Chile; pasados quedan deshabilitados', async () => {
    const f = await fixture();
    const originalNow = Date.now;
    Date.now = () => new Date('2020-01-01T00:00:00Z').getTime();
    try {
      for (const [date, hours] of [['2026-08-31',167], ['2026-03-30',169]]) {
        const { start, end } = businessRange(date, 7);
        assert.equal((end - start) / 3600000, hours);
        const r = await calendar(f, date); assert.equal(r.status, 200);
        assert.equal(r.body.calendario.dias[0], date); assert.equal(r.body.calendario.dias.length, 7);
      }
    } finally { Date.now = originalNow; }
    const past = await calendar(f, '2020-01-06');
    assert.ok(past.body.calendario.horarios.every(c => c.estado === 'unavailable' && c.motivo === 'pasado'));
    assert.equal((await calendar(f, '2035-01-16')).status, 400);
    assert.equal((await calendar(f, 'no-fecha')).status, 400);
    assert.equal((await request(null, `/api/citas/disponibilidad/${f.profile.id}?fecha=${day}&vista=semana&servicioId=${f.service.id}`)).status, 401);
    const invalid = await request(null, `/api/usuarios/barberos/${f.profile.id}/disponibilidad?fecha=${day}&vista=semana&servicioId=ajeno`);
    assert.equal(invalid.status, 404);
  });

  test('contrato civil y límites explícitos coinciden en ambas rutas, cambios de mes, año y horario', async () => {
    const originalNow = Date.now;
    Date.now = () => new Date('2020-01-01T00:00:00Z').getTime();
    try {
      for (const date of ['2026-10-26', '2026-11-02', '2026-10-19', '2026-12-28', '2027-01-04', '2026-03-30', '2026-08-31']) {
        const f = await fixture(false, [date]);
        const reservation = await prisma.cita.create({ data: {
          barberoId: f.profile.id, clienteId: f.client.id, servicioId: f.service.id,
          fecha_hora: at('10:00', date), duracionReservada: 30, estado: 'confirmada',
        } });
        await prisma.agendaBloqueo.create({ data: { barberoId: f.profile.id, inicio: at('11:00', date), fin: at('11:30', date) } });
        const before = await prisma.cita.findMany({ where: { barberoId: f.profile.id }, orderBy: { id: 'asc' } });
        const { start, end } = businessRange(date, 7);
        const params = new URLSearchParams({ fecha: date, vista: 'semana', servicioId: f.service.id });
        const publicPath = `/api/usuarios/barberos/${f.profile.id}/disponibilidad`;
        const clientPath = `/api/citas/disponibilidad/${f.profile.id}`;
        const civil = await request(f.client, `${clientPath}?${params}`);
        assert.equal(civil.status, 200, JSON.stringify(civil.body));
        assert.equal(civil.body.calendario.zonaHoraria, 'America/Santiago');
        assert.equal(civil.body.calendario.dias[0], date);
        assert.equal(civil.body.calendario.dias.at(-1), businessDate(new Date(end - 1)));
        assert.equal(cell(civil, '09:00', date).estado, 'available');
        assert.equal(cell(civil, '09:00', date).fecha_hora, at('09:00', date).toISOString());
        assert.equal(cell(civil, '10:00', date).estado, 'reserved');
        assert.equal(cell(civil, '11:00', date).motivo, 'bloqueado');
        assert.equal(cell(civil, '11:00', date).citaId, undefined);
        for (const [path, account] of [[publicPath, null], [clientPath, f.client]]) {
          params.set('desde', start.toISOString()); params.set('hasta', end.toISOString());
          const explicit = await request(account, `${path}?${params}`);
          assert.equal(explicit.status, 200, JSON.stringify(explicit.body));
          assert.deepEqual(explicit.body, civil.body);
          // A daily end, UTC midnight or a fixed 168-hour DST week must still fail.
          const wrongEnds = [businessRange(date).end.toISOString(), date + 'T00:00:00Z', new Date(end.getTime() + 3600000).toISOString()];
          if ((end - start) / 3600000 !== 168) wrongEnds.push(new Date(start.getTime() + 168 * 3600000).toISOString());
          for (const wrongEnd of wrongEnds) {
            params.set('hasta', wrongEnd);
            assert.equal((await request(account, `${path}?${params}`)).status, 400);
          }
          params.set('hasta', end.toISOString());
          params.set('desde', date + 'T00:00:00Z');
          assert.equal((await request(account, `${path}?${params}`)).status, 400);
          params.set('desde', start.toISOString());
        }
        params.set('vista', 'invalida');
        assert.equal((await request(null, `${publicPath}?${params}`)).status, 400);
        assert.deepEqual(await prisma.cita.findMany({ where: { barberoId: f.profile.id }, orderBy: { id: 'asc' } }), before);
        assert.equal((await prisma.cita.findUnique({ where: { id: reservation.id } })).estado, 'confirmada');
      }
    } finally { Date.now = originalNow; }
  });

  test('flujo del navegador con API y PostgreSQL reales, comprobante y conflicto entre clientes', { skip: !process.env.CALENDAR_TEST_FRONTEND_URL, timeout: 90000 }, async () => {
    const { chromium } = require('../../Frontend/node_modules/@playwright/test');
    const browser = await chromium.launch({ channel: 'chrome' });
    const f = await fixture();
    const open = async (account, profile = f) => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await page.clock.setFixedTime(new Date('2035-01-15T11:00:00Z'));
      await page.addInitScript(token => localStorage.setItem('token', token), jwt.sign({ id: account.id }, process.env.JWT_SECRET, { expiresIn: '1h' }));
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        const response = await route.fetch({ url: base + url.pathname + url.search });
        await route.fulfill({ response });
      });
      await page.goto(process.env.CALENDAR_TEST_FRONTEND_URL + '/booking?barbero=' + profile.profile.id);
      await page.locator('.booking-service-card').click();
      await page.getByRole('button', { name: /^lunes, 15 de enero, 09:00: Disponible/ }).click();
      return page;
    };
    try {
      const first = await open(f.client), second = await open(f.rival);
      await Promise.all([first.getByRole('button', { name: 'Reservar ahora', exact: true }).click(), second.getByRole('button', { name: 'Reservar ahora', exact: true }).click()]);
      await first.waitForFunction(() => document.querySelector('.booking-alert.is-success') || document.querySelector('.booking-alert.is-error'));
      await second.waitForFunction(() => document.querySelector('.booking-alert.is-success') || document.querySelector('.booking-alert.is-error'));
      assert.equal(await first.locator('.booking-alert.is-success').count() + await second.locator('.booking-alert.is-success').count(), 1);
      assert.equal(await prisma.cita.count({ where: { barberoId: f.profile.id, estado: 'confirmada' } }), 1);
      const loser = await first.locator('.booking-alert.is-error').count() ? first : second;
      assert.match(await loser.locator('.booking-alert.is-error').textContent(), /dejó de estar disponible/);
      await loser.getByRole('button', { name: /^lunes, 15 de enero, 09:00: Reservado/ }).waitFor();
      assert.equal(await loser.locator('.booking-summary').count(), 0);
      const payment = await fixture(true), page = await open(payment.client, payment);
      await page.getByRole('button', { name: 'Continuar al pago' }).click();
      await page.locator('.booking-proof-field input').setInputFiles(require('node:path').resolve(__dirname, '../../Frontend/src/assets/logotesis.png'));
      await page.getByRole('button', { name: 'Reservar con comprobante' }).click();
      await page.locator('.booking-alert.is-success').waitFor();
      const saved = await prisma.cita.findFirst({ where: { barberoId: payment.profile.id, estado: 'confirmada' } });
      assert.equal(saved.duracionReservada, 60); assert.ok(saved.comprobanteTransferencia);
    } finally { await browser.close(); }
  });
});
