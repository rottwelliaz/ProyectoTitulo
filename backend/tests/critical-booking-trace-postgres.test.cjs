require('./security-env.cjs');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const url = process.env.SCHEDULE_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (target.pathname !== '/schedule_tests' || !['localhost', '127.0.0.1'].includes(target.hostname)) throw Error('Only local schedule_tests allowed');
  process.env.DATABASE_URL = url;
}

describe('trazabilidad real de intervalos, cierre y selección obsoleta', { skip: !url }, () => {
  require('ts-node/register');
  const express = require('express'), jwt = require('jsonwebtoken');
  const prisma = require('../src/config/prisma').default;
  const { slotInstant } = require('../src/services/businessTime');
  const day = '2035-01-15';
  const at = time => slotInstant(day, time).toISOString();
  let server, base, sequence = 0;
  const traces = [], received = [];
  const request = async (actor, endpoint, method = 'GET', data) => {
    const r = await fetch(base + '/api' + endpoint, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt.sign({ id: actor.id }, process.env.JWT_SECRET, { expiresIn: '1h' }) }, ...(data ? { body: JSON.stringify(data) } : {}) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const fixture = async (minutes, startTime = '09:00') => {
    const user = rol => prisma.user.create({ data: { nombre: 'Prueba intervalos', email: `critical-${process.pid}-${Date.now()}-${sequence++}@test.invalid`, rol, aprobado: true, password: 'unused' } });
    const owner = await user('barbero'), client = await user('cliente');
    const place = await prisma.lugarTrabajo.create({ data: { nombre_barberia: 'Local de prueba', direccion: 'Centro' } });
    const profile = await prisma.barberProfile.create({ data: { usuarioId: owner.id, lugarTrabajoId: place.id, requiereComprobante: false } });
    const service = await prisma.service.create({ data: { perfilBarberoId: profile.id, nombre_servicio: 'Corte prueba', precio: 12000 } });
    return { owner, client, profile, service, configuration: { startTime, endTime: '19:00', blockMinutes: minutes } };
  };
  const calendar = f => request(f.owner, `/profesional/calendario?desde=${day}&hasta=2035-01-21`);
  const publish = async f => request(f.owner, '/citas/disponibilidad/semana', 'PUT', { fechaInicio: day, revision: (await calendar(f)).body.revision, configuracion: f.configuration, bloques: [{ inicio: at(f.configuration.startTime), fin: at('19:00') }], bloqueos: [] });
  const availability = f => request(f.client, `/citas/disponibilidad/${f.profile.id}?fecha=${day}&vista=semana&servicioId=${f.service.id}`);
  const book = (f, slot, end = slot.disponibleHasta) => request(f.client, `/citas/${slot.slotId || slot.id}/agendar`, 'PATCH', { servicioId: f.service.id, fecha_hora: slot.fecha_hora, fin_hora: end });
  before(async () => {
    const app = express(); app.use(express.json({ limit: '6mb' }));
    app.use((req, _res, next) => { if (req.path.endsWith('/agendar')) received.push({ path: req.path, payload: req.body }); next(); });
    for (const name of ['auth', 'citas', 'profesional', 'usuarios', 'servicios', 'lugartrabajo']) app.use('/api/' + name, require('../src/routes/' + name).default);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    fs.writeFileSync(path.resolve(__dirname, '../../quality-artifacts/critical-booking-trace.json'), JSON.stringify(traces, null, 2));
    if (server) await new Promise(resolve => server.close(resolve));
    await prisma.$disconnect();
  });

  for (const [minutes, lastTime, endTime] of [[30, '18:30', '19:00'], [45, '18:00', '18:45'], [60, '18:00', '19:00']]) {
    test(`${minutes}: último bloque, igualdad con cierre, descanso previo, ocupado y pasado`, async () => {
      const f = await fixture(minutes);
      assert.equal((await publish(f)).status, 200);
      const restStart = new Date(+new Date(at(lastTime)) - 15 * 60000).toISOString();
      assert.equal((await request(f.owner, '/profesional/bloqueos', 'POST', { inicio: restStart, fin: at(lastTime), tipo: 'descanso' })).status, 201);
      const free = (await availability(f)).body;
      const slot = free.citas.find(c => c.fecha_hora === at(lastTime));
      assert.ok(slot, 'El último bloque completo debe estar disponible después del descanso');
      assert.equal(slot.disponibleHasta, at(endTime));
      assert.ok(!free.calendario.horas.includes('19:00'));
      if (minutes === 45) assert.ok(!free.calendario.horas.includes('18:45'), 'No generar fila parcial 18:45–19:00');
      const result = await book(f, slot);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.fin, at(endTime));
      assert.equal(result.body.duracionReservada, minutes);
      assert.equal((await book(f, slot)).status, 409);
      assert.equal((await availability(f)).body.calendario.horarios.find(c => c.fecha === day && c.hora === lastTime).estado, 'reserved');
      assert.equal((await request(f.client, `/citas/cliente/${result.body.id}/cancelar`, 'PATCH')).status, 200);
      assert.ok((await availability(f)).body.citas.some(c => c.fecha_hora === at(lastTime)));
      assert.equal((await request(f.owner, '/profesional/bloqueos', 'POST', { inicio: at(lastTime), fin: at(endTime), tipo: 'bloqueado' })).status, 201);
      assert.ok(!(await availability(f)).body.citas.some(c => c.fecha_hora === at(lastTime)));
      assert.equal((await book(f, slot)).status, 409);
      const originalNow = Date.now;
      Date.now = () => +new Date('2035-01-16T23:00:00Z');
      try { assert.equal((await availability(f)).body.calendario.horarios.find(c => c.fecha === day && c.hora === lastTime).motivo, 'pasado'); }
      finally { Date.now = originalNow; }
    });
  }

  test('un cambio 30→60 rechaza la selección previa en pago y reserva, sin crear cita', async () => {
    const f = await fixture(30); await publish(f);
    const selected = (await availability(f)).body.citas.find(c => c.fecha_hora === at('10:00'));
    f.configuration.blockMinutes = 60;
    await prisma.agendaSemana.updateMany({ where: { barberoId: f.profile.id }, data: { configuracion: f.configuration } });
    for (const [endpoint, method] of [['pago', 'POST'], ['agendar', 'PATCH']]) {
      const result = await request(f.client, `/citas/${selected.slotId || selected.id}/${endpoint}`, method, { servicioId: f.service.id, fecha_hora: selected.fecha_hora, fin_hora: selected.disponibleHasta });
      assert.equal(result.status, 409); assert.match(result.body.message, /cambió/);
    }
    assert.equal(await prisma.cita.count({ where: { barberoId: f.profile.id, estado: 'confirmada' } }), 0);
    const current = (await availability(f)).body.citas.find(c => c.fecha_hora === at('10:00'));
    const correct = await book(f, current);
    assert.equal(correct.status, 200); assert.equal(correct.body.fin, at('11:00'));
  });

  for (const [minutes, startTime, chosen, finalTime, lastTime] of [
    [30, '09:00', '10:30', '11:00', '18:30'],
    [45, '09:00', '10:30', '11:15', '18:00'],
    [60, '09:00', '10:00', '11:00', '18:00'],
    [60, '08:30', '10:30', '11:30', '17:30'],
  ]) test(`navegador→Organización→HTTP→PostgreSQL→Mis citas→calendario: ${minutes}, entrada ${startTime}`, { skip: !process.env.CALENDAR_TEST_FRONTEND_URL, timeout: 90000 }, async () => {
    const { chromium, expect } = require('../../Frontend/node_modules/@playwright/test');
    const browser = await chromium.launch({ channel: 'chrome' });
    const f = await fixture(minutes, startTime), payloads = [];
    const open = async actor => {
      const page = await browser.newPage();
      await page.clock.setFixedTime(new Date(at('08:00')));
      await page.addInitScript(token => localStorage.setItem('token', token), jwt.sign({ id: actor.id }, process.env.JWT_SECRET, { expiresIn: '1h' }));
      await page.route('**/api/**', async route => {
        const u = new URL(route.request().url());
        if (u.pathname.endsWith('/agendar')) payloads.push(route.request().postDataJSON());
        const response = await route.fetch({ url: base + u.pathname + u.search });
        await route.fulfill({ response });
      });
      return page;
    };
    try {
      const professional = await open(f.owner);
      await professional.goto(process.env.CALENDAR_TEST_FRONTEND_URL + '/perfil-profesional');
      await professional.locator('.pro-nav-link[href="#organizacion"]').click();
      const editor = professional.locator('#disponibilidad-profesional');
      await editor.getByLabel('Hora de entrada', { exact: true }).selectOption(startTime);
      await editor.getByLabel('Hora de cierre', { exact: true }).selectOption('19:00');
      await editor.getByLabel('Duración de cada bloque', { exact: true }).selectOption(String(minutes));
      await editor.getByRole('button', { name: 'Habilitar semana', exact: true }).click();
      await editor.getByRole('button', { name: 'Guardar horarios', exact: true }).click();
      await expect(editor.locator('.barber-slot.is-pending')).toHaveCount(0);
      await expect(editor.getByText('Agenda guardada y disponible para las reservas de clientes.')).toBeVisible();
      const savedWeek = await prisma.agendaSemana.findFirst({ where: { barberoId: f.profile.id } });
      assert.deepEqual(savedWeek.configuracion, f.configuration);
      assert.equal((await availability(f)).body.citas.filter(c => c.fecha_hora.startsWith('2035-01-15')).at(-1).fecha_hora, at(lastTime));
      const customer = await open(f.client);
      await customer.goto(process.env.CALENDAR_TEST_FRONTEND_URL + '/booking?barbero=' + f.profile.id);
      await customer.locator('.booking-service-card').click();
      await expect(customer.getByRole('button', { name: new RegExp(`lunes, 15 de enero, ${lastTime}: Disponible`) })).toBeEnabled();
      await customer.getByRole('button', { name: new RegExp(`lunes, 15 de enero, ${chosen}: Disponible`) }).click();
      await expect(customer.locator('.booking-summary')).toContainText(`${chosen}–${finalTime}`);
      const responsePromise = customer.waitForResponse(r => r.url().endsWith('/agendar') && r.request().method() === 'PATCH');
      await customer.getByRole('button', { name: 'Reservar ahora', exact: true }).click();
      const response = await responsePromise, result = await response.json();
      assert.equal(response.status(), 200, JSON.stringify(result));
      assert.deepEqual(payloads, [{ servicioId: f.service.id, fecha_hora: at(chosen), fin_hora: at(finalTime), comprobanteTransferencia: null, comprobanteNombre: null }]);
      assert.deepEqual(received.at(-1).payload, payloads[0]);
      const backendReceived = received.at(-1).payload;
      assert.equal(result.fecha_hora, at(chosen)); assert.equal(result.fin, at(finalTime)); assert.equal(result.duracionReservada, minutes);
      const [stored] = await prisma.$queryRaw`SELECT id, fecha_hora AS inicio, "duracionReservada" AS minutos, fecha_hora + "duracionReservada" * interval '1 minute' AS fin FROM "Cita" WHERE id = ${result.id}`;
      assert.equal(stored.inicio.toISOString(), at(chosen)); assert.equal(stored.fin.toISOString(), at(finalTime)); assert.equal(stored.minutos, minutes);
      assert.equal(await prisma.cita.count({ where: { barberoId: f.profile.id, estado: 'confirmada' } }), 1);
      const next = (await availability(f)).body.citas.find(c => c.fecha_hora === at(finalTime));
      assert.ok(next, 'La reserva no ocupa el siguiente bloque');
      await customer.goto(process.env.CALENDAR_TEST_FRONTEND_URL + '/mis-citas');
      await expect(customer.locator('.client-appointment-item')).toHaveCount(1);
      await expect(customer.locator('.client-appointment-date strong')).toHaveText(`${chosen}–${finalTime}`);
      await professional.reload();
      await professional.locator('.pro-nav-link[href="#mis-citas"]').click();
      const event = professional.locator('.professional-calendar-grid .is-confirmada');
      await expect(event).toHaveCount(1); await expect(event.locator('time')).toHaveText(`${chosen}–${finalTime}`);
      const clientText = await customer.locator('.client-appointment-date strong').textContent();
      const professionalText = await event.locator('time').textContent();
      // Exercise the terminal block through the real client UI as well.
      await customer.goto(process.env.CALENDAR_TEST_FRONTEND_URL + '/booking?barbero=' + f.profile.id);
      await customer.locator('.booking-service-card').click();
      await customer.getByRole('button', { name: new RegExp(`lunes, 15 de enero, ${lastTime}: Disponible`) }).click();
      const lastResponsePromise = customer.waitForResponse(r => r.url().endsWith('/agendar') && r.request().method() === 'PATCH');
      await customer.getByRole('button', { name: 'Reservar ahora', exact: true }).click();
      const lastResponse = await lastResponsePromise, last = await lastResponse.json();
      assert.equal(lastResponse.status(), 200, JSON.stringify(last)); assert.equal(last.duracionReservada, minutes);
      const lastStored = await prisma.cita.findUnique({ where: { id: last.id } });
      assert.equal(lastStored.fecha_hora.toISOString(), at(lastTime)); assert.equal(lastStored.duracionReservada, minutes);
      traces.push({ minutes, configuration: savedWeek.configuracion, frontendRequest: payloads[0], backendReceived,
        response: { id: result.id, inicio: result.fecha_hora, fin: result.fin, duracionReservada: result.duracionReservada }, postgres: stored,
        clientText, professionalText, nextAvailable: next.fecha_hora, terminalReservation: { inicio: last.fecha_hora, fin: last.fin, minutos: lastStored.duracionReservada } });
    } finally { await browser.close(); }
  });
});
