require('./security-env.cjs');
const { describe, test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const url = process.env.SCHEDULE_TEST_DATABASE_URL;
if (url) {
  if (new URL(url).pathname !== '/schedule_tests') throw Error('Only isolated schedule_tests is allowed');
  process.env.DATABASE_URL = url;
}
describe('bloqueo preventivo de configuración semanal', { skip: !url }, () => {
  require('ts-node/register');
  const express = require('express'), jwt = require('jsonwebtoken');
  const { Temporal } = require('@js-temporal/polyfill');
  const prisma = require('../src/config/prisma').default;
  const { businessRange, slotInstant } = require('../src/services/businessTime');
  const { lockedWeekMessage } = require('../src/services/availability');
  const config = { startTime: '09:00', endTime: '19:00', blockMinutes: 30 };
  const baseNow = +slotInstant('2035-01-15', '08:00');
  const at = (time, day = '2035-01-15') => slotInstant(day, time);
  let server, base, sequence = 0;
  const user = rol => prisma.user.create({ data: { nombre: 'Simulado', email: `week-lock-${process.pid}-${sequence++}@test.invalid`, password: 'unused', rol, aprobado: true } });
  async function request(actor, path, method = 'GET', body) {
    const response = await fetch(base + path, { method, headers: { Authorization: 'Bearer ' + jwt.sign({ id: actor.id }, process.env.JWT_SECRET, { expiresIn: '1h' }), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json().catch(() => null) };
  }
  const plus = (day, days) => Temporal.PlainDate.from(day).add({ days }).toString();
  function freeGrid(settings, week) {
    const minute = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    const result = [];
    for (let i = 0; i < 7; i++) for (let time = minute(settings.startTime); time + settings.blockMinutes <= minute(settings.endTime); time += settings.blockMinutes) {
      const start = slotInstant(plus(week, i), `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(time % 60).padStart(2, '0')}`);
      if (+start > Date.now()) result.push({ inicio: start.toISOString(), fin: new Date(+start + settings.blockMinutes * 60000).toISOString() });
    }
    return result;
  }
  async function fixture(settings = config, week = '2035-01-15', published = true) {
    const owner = await user('barbero'), client = await user('cliente');
    const profile = await prisma.barberProfile.create({ data: { usuarioId: owner.id, requiereComprobante: false } });
    const service = await prisma.service.create({ data: { perfilBarberoId: profile.id, nombre_servicio: 'Corte', precio: 10000 } });
    if (published) {
      await prisma.agendaSemana.create({ data: { barberoId: profile.id, inicio: businessRange(week).start, configuracion: settings } });
      // Include real historical rows when the fixture is a past week.
      const clock = Date.now; Date.now = () => +businessRange(week).start - 1;
      const windows = freeGrid(settings, week); Date.now = clock;
      await prisma.cita.createMany({ data: windows.map(w => ({ barberoId: profile.id, fecha_hora: new Date(w.inicio), disponibleHasta: new Date(w.fin), estado: 'disponible' })) });
    }
    return { owner, client, profile, service, week };
  }
  const agenda = f => request(f.owner, `/profesional/calendario?desde=${f.week}&hasta=${plus(f.week, 6)}`);
  const rows = f => prisma.cita.findMany({ where: { barberoId: f.profile.id }, orderBy: { id: 'asc' } });
  const blocks = f => prisma.agendaBloqueo.findMany({ where: { barberoId: f.profile.id }, orderBy: { id: 'asc' } });
  async function payload(f, settings = config) {
    const current = (await agenda(f)).body;
    return { fechaInicio: f.week, revision: current.revision, configuracion: settings, bloques: freeGrid(settings, f.week), bloqueos: [] };
  }
  const save = (f, body) => request(f.owner, '/citas/disponibilidad/semana', 'PUT', body);
  const reservation = (f, state = 'confirmada', day = f.week) => prisma.cita.create({ data: { barberoId: f.profile.id, clienteId: f.client.id, servicioId: f.service.id, estado: state, fecha_hora: at('10:30', day), duracionReservada: 30, nombreServicioReservado: 'Corte original' } });
  before(async () => {
    mock.timers.enable({ apis: ['Date'], now: baseNow });
    const app = express(); app.use(express.json());
    for (const name of ['citas', 'profesional', 'auth']) app.use('/' + name, require('../src/routes/' + name).default);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); }); base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { mock.timers.reset(); if (server) await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); });

  test('semana nueva permite configurar y recuperar la configuración guardada', async () => {
    const f = await fixture(config, '2035-01-15', false);
    assert.equal((await agenda(f)).body.configuracionBloqueada, false);
    const response = await save(f, await payload(f, { ...config, startTime: '10:00', endTime: '18:00', blockMinutes: 45 }));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const loaded = (await agenda(f)).body;
    assert.deepEqual(loaded.configuracion, { startTime: '10:00', endTime: '18:00', blockMinutes: 45 });
    assert.equal(loaded.configuracionBloqueada, false);
  });

  for (const [from, to] of [[30, 45], [45, 60], [60, 30]]) test(`solo disponibilidad: ${from} a ${to}, sin residuos ni superposiciones`, async () => {
    const f = await fixture({ ...config, blockMinutes: from }), body = await payload(f, { ...config, startTime: '10:00', endTime: '18:00', blockMinutes: to });
    assert.equal((await save(f, body)).status, 200);
    const stored = (await rows(f)).sort((a, b) => a.fecha_hora - b.fecha_hora);
    assert.deepEqual(stored.map(c => [c.fecha_hora.toISOString(), c.disponibleHasta.toISOString()]), body.bloques.map(b => [b.inicio, b.fin]));
    assert.equal(stored.some((c, i) => i > 0 && c.fecha_hora < stored[i - 1].disponibleHasta), false);
  });

  for (const estado of ['pendiente', 'confirmada']) for (const change of [{ blockMinutes: 60 }, { startTime: '10:00' }, { endTime: '18:00' }]) test(`${estado}: rechaza ${Object.keys(change)[0]} sin cambios parciales ni bypass`, async () => {
    const f = await fixture(), appointment = await reservation(f, estado), before = await rows(f), initial = (await agenda(f)).body;
    assert.equal(initial.configuracionBloqueada, true);
    const body = { ...await payload(f, { ...config, ...change }), conservarReservas: true };
    const response = await save(f, body);
    assert.equal(response.status, 409); assert.equal(response.body.message, lockedWeekMessage);
    assert.deepEqual(await rows(f), before);
    const loaded = (await agenda(f)).body; assert.equal(loaded.revision, initial.revision); assert.deepEqual(loaded.configuracion, config);
    assert.deepEqual(await prisma.cita.findUnique({ where: { id: appointment.id } }), appointment);
  });

  for (const tipo of ['descanso', 'bloqueado']) test(`${tipo}: bloquea configuración, permite edición individual y se desbloquea al guardar su retiro`, async () => {
    const f = await fixture(), window = { inicio: at('12:00').toISOString(), fin: at('12:30').toISOString() };
    const body = await payload(f); body.bloques = body.bloques.filter(b => b.inicio !== window.inicio); body.bloqueos = [{ ...window, tipo }];
    assert.equal((await save(f, body)).status, 200);
    assert.equal((await agenda(f)).body.configuracionBloqueada, true);
    assert.equal((await save(f, await payload(f, { ...config, blockMinutes: 60 }))).status, 409);
    assert.equal((await save(f, await payload(f))).status, 200);
    assert.equal((await agenda(f)).body.configuracionBloqueada, false);
    assert.equal((await blocks(f)).length, 0);
    assert.equal(await prisma.cita.count({ where: { barberoId: f.profile.id, fecha_hora: at('12:00'), disponibleHasta: at('12:30'), estado: 'disponible' } }), 1);
    assert.equal((await save(f, await payload(f, { ...config, blockMinutes: 60 }))).status, 200);
  });

  for (const tipo of ['descanso', 'bloqueado']) test(`retirar ${tipo} manual recupera disponibilidad y no elimina registros ajenos`, async () => {
    const f = await fixture();
    const window = await prisma.cita.findFirst({ where: { barberoId: f.profile.id, fecha_hora: at('12:00') } });
    await prisma.cita.delete({ where: { id: window.id } });
    const block = await prisma.agendaBloqueo.create({ data: { barberoId: f.profile.id, inicio: window.fecha_hora, fin: window.disponibleHasta, tipo, origen: 'manual' } });
    assert.equal((await save(f, await payload(f, { ...config, endTime: '18:00' }))).status, 409);
    assert.equal((await request(f.owner, '/profesional/bloqueos/' + block.id, 'DELETE')).status, 204);
    assert.equal((await agenda(f)).body.configuracionBloqueada, false);
    const available = await request(f.client, `/citas/disponibilidad/${f.profile.id}?fecha=${f.week}&servicioId=${f.service.id}`);
    assert.equal(available.body.citas.some(c => c.fecha_hora === at('12:00').toISOString()), true);
  });

  test('las citas canceladas futuras permiten cambios; las iniciadas protegen el historial', async t => {
    const f = await fixture(), cancelled = await reservation(f, 'cancelada');
    assert.equal((await agenda(f)).body.configuracionBloqueada, false);
    assert.equal((await save(f, await payload(f, { ...config, blockMinutes: 60 }))).status, 200);
    assert.deepEqual(await prisma.cita.findUnique({ where: { id: cancelled.id } }), cancelled);
    mock.timers.setTime(+at('14:20', '2035-01-17')); t.after(() => mock.timers.setTime(baseNow));
    assert.equal((await agenda(f)).body.motivoConfiguracion, 'historial');
    const before = await rows(f);
    assert.equal((await save(f, await payload(f, config))).status, 409);
    assert.deepEqual(await rows(f), before);
  });

  test('semana en curso permite edición individual futura sin reescribir historial', async t => {
    const f = await fixture(), old = await reservation(f, 'cancelada');
    const historicalBlock = await prisma.agendaBloqueo.create({ data: { barberoId: f.profile.id, inicio: at('12:00', '2035-01-16'), fin: at('12:30', '2035-01-16'), tipo: 'descanso', origen: 'agenda' } });
    mock.timers.setTime(+at('14:20', '2035-01-17')); t.after(() => mock.timers.setTime(baseNow));
    const history = (await rows(f)).filter(c => +c.fecha_hora <= Date.now());
    const body = await payload(f), window = { inicio: at('12:00', '2035-01-18').toISOString(), fin: at('12:30', '2035-01-18').toISOString() };
    body.bloques = body.bloques.filter(b => b.inicio !== window.inicio); body.bloqueos = [{ ...window, tipo: 'bloqueado' }];
    const response = await save(f, body); assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual((await rows(f)).filter(c => +c.fecha_hora <= Date.now()), history);
    assert.deepEqual(await prisma.agendaBloqueo.findUnique({ where: { id: historicalBlock.id } }), historicalBlock);
    assert.deepEqual(await prisma.cita.findUnique({ where: { id: old.id } }), old);
    assert.equal((await request(f.owner, '/profesional/bloqueos/' + historicalBlock.id, 'DELETE')).status, 409);
    const row = history.find(c => c.estado === 'disponible');
    assert.equal((await request(f.owner, '/citas/' + row.id, 'DELETE')).status, 409);
  });

  test('semana pasada rechaza incluso un guardado sin cambiar la configuración', async () => {
    const f = await fixture(config, '2035-01-08'), before = await rows(f);
    assert.equal((await agenda(f)).body.configuracionBloqueada, true);
    assert.equal((await save(f, await payload(f))).status, 409); assert.deepEqual(await rows(f), before);
  });

  test('la restricción es independiente por semana y por profesional', async () => {
    const protectedWeek = await fixture(), other = await fixture(), later = { ...protectedWeek, week: '2035-01-22' };
    await reservation(protectedWeek);
    const before = await rows(protectedWeek);
    assert.equal((await agenda(later)).body.configuracionBloqueada, false);
    assert.equal((await save(later, await payload(later, { ...config, blockMinutes: 45 }))).status, 200);
    assert.deepEqual((await rows(protectedWeek)).filter(c => c.fecha_hora < at('00:00', later.week)), before);
    assert.equal((await save(other, await payload(other, { ...config, blockMinutes: 60 }))).status, 200);
    assert.equal((await agenda(protectedWeek)).body.configuracion.blockMinutes, 30);
    assert.equal((await save(other, { ...await payload(other), barberoId: protectedWeek.profile.id })).status, 400);
  });

  test('una reserva concurrente bajo el mismo bloqueo impide la escritura de configuración', async () => {
    const f = await fixture(), body = await payload(f, { ...config, blockMinutes: 60 });
    const { withSchedule } = require('../src/services/schedule');
    let acquired, release;
    const ready = new Promise(resolve => { acquired = resolve; }), hold = new Promise(resolve => { release = resolve; });
    const booking = withSchedule(f.profile.id, async tx => {
      const appointment = await tx.cita.create({ data: { barberoId: f.profile.id, clienteId: f.client.id, servicioId: f.service.id, estado: 'confirmada', fecha_hora: at('10:30'), duracionReservada: 30 } });
      acquired(); await hold; return appointment;
    });
    await ready; const pending = save(f, body); release(); const appointment = await booking;
    const response = await pending; assert.equal(response.status, 409); assert.equal(response.body.message, lockedWeekMessage);
    assert.deepEqual((await agenda(f)).body.configuracion, config);
    assert.deepEqual(await prisma.cita.findUnique({ where: { id: appointment.id } }), appointment);
  });

  test('ni conservarReservas permite convertir una cita en descanso o bloqueo', async () => {
    const f = await fixture(); await reservation(f);
    const before = await rows(f), body = await payload(f), interval = { inicio: at('10:30').toISOString(), fin: at('11:00').toISOString() };
    body.bloques = body.bloques.filter(b => b.inicio !== interval.inicio); body.bloqueos = [{ ...interval, tipo: 'descanso' }]; body.conservarReservas = true;
    assert.equal((await save(f, body)).status, 409); assert.deepEqual(await rows(f), before);
  });

  test('el endpoint individual tampoco permite bloquear una reserva ni usar conservarReservas como excepción', async () => {
    const f = await fixture(); await reservation(f); const before = await rows(f);
    const response = await request(f.owner, '/profesional/bloqueos', 'POST', { inicio: at('10:30').toISOString(), fin: at('11:00').toISOString(), tipo: 'bloqueado', conservarReservas: true });
    assert.equal(response.status, 409); assert.deepEqual(await rows(f), before); assert.deepEqual(await blocks(f), []);
  });

  test('navegador y PostgreSQL: edición individual, cancelación, desbloqueo y nueva duración persistida', { skip: !process.env.WEEK_SETTINGS_FRONTEND_URL }, async () => {
    const { chromium } = require('../../Frontend/node_modules/playwright-core');
    const { expect } = require('../../Frontend/node_modules/@playwright/test');
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const f = await fixture(), appointment = await reservation(f);
      const page = await browser.newPage(); await page.clock.setFixedTime(new Date(baseNow));
      await page.addInitScript(token => localStorage.setItem('token', token), jwt.sign({ id: f.owner.id }, process.env.JWT_SECRET, { expiresIn: '1h' }));
      await page.route('**/api/**', async route => {
        const target = new URL(route.request().url()), endpoint = target.pathname.replace(/^\/api/, '');
        if (!/^\/(auth|citas|profesional)\//.test(endpoint)) return route.fulfill({ json: [] });
        return route.fulfill({ response: await route.fetch({ url: base + endpoint + target.search }) });
      });
      await page.goto(process.env.WEEK_SETTINGS_FRONTEND_URL + '/perfil-profesional#organizacion');
      const calendar = page.locator('#disponibilidad-profesional'), duration = calendar.getByLabel('Duración de cada bloque', { exact: true });
      await expect(calendar.getByRole('button', { name: 'Habilitar semana', exact: true })).toBeEnabled();
      await expect(duration).toBeDisabled(); await expect(duration).toHaveValue('30');
      const first = calendar.locator('.barber-slot').first();
      await first.click(); await page.getByRole('button', { name: 'Descanso', exact: true }).click();
      await calendar.getByRole('button', { name: 'Guardar horarios', exact: true }).click();
      await expect(calendar.locator('.calendar-pending-message')).toHaveCount(0);
      assert.deepEqual(await prisma.cita.findUnique({ where: { id: appointment.id } }), appointment);
      await first.click(); await page.getByRole('button', { name: 'Disponible', exact: true }).click();
      await calendar.getByRole('button', { name: 'Guardar horarios', exact: true }).click();
      await expect(calendar.locator('.calendar-pending-message')).toHaveCount(0);
      await expect(duration).toBeDisabled(); assert.equal((await blocks(f)).length, 0);
      assert.equal((await request(f.client, '/citas/cliente/' + appointment.id + '/cancelar', 'PATCH')).status, 200);
      const cancelled = await prisma.cita.findUnique({ where: { id: appointment.id } });
      await calendar.getByRole('button', { name: 'Recargar semana', exact: true }).click();
      await expect(duration).toBeEnabled(); await duration.selectOption('60');
      await calendar.getByRole('button', { name: 'Guardar horarios', exact: true }).click();
      await expect(calendar.locator('.calendar-pending-message')).toHaveCount(0);
      await page.reload(); await expect(duration).toHaveValue('60'); await expect(duration).toBeEnabled();
      assert.deepEqual(await prisma.cita.findUnique({ where: { id: appointment.id } }), cancelled);
      assert.equal((await rows(f)).filter(c => c.estado === 'disponible').every(c => +c.disponibleHasta - +c.fecha_hora === 3600000), true);
      const available = await request(f.client, `/citas/disponibilidad/${f.profile.id}?fecha=${f.week}&servicioId=${f.service.id}`);
      const last = available.body.citas.at(-1);
      assert.equal(last.fecha_hora, at('18:00').toISOString()); assert.equal(last.disponibleHasta, at('19:00').toISOString());
      const booked = await request(f.client, '/citas/' + (last.slotId || last.id) + '/agendar', 'PATCH', { servicioId: f.service.id, fecha_hora: last.fecha_hora, fin_hora: last.disponibleHasta });
      assert.equal(booked.status, 200, JSON.stringify(booked.body)); assert.equal(booked.body.duracionReservada, 60);
    } finally { await browser.close(); }
  });
});
