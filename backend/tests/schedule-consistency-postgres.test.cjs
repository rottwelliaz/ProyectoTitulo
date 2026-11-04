require('./security-env.cjs');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const url = process.env.SCHEDULE_TEST_DATABASE_URL;
if (url) {
  if (new URL(url).pathname !== '/schedule_tests') throw Error('Only isolated schedule_tests is allowed');
  process.env.DATABASE_URL = url;
}
describe('organización y calendarios coherentes con PostgreSQL', { skip: !url }, () => {
  require('ts-node/register');
  const express = require('express'), jwt = require('jsonwebtoken');
  const prisma = require('../src/config/prisma').default;
  const { slotInstant } = require('../src/services/businessTime');
  let server, base, sequence = 0;
  const at = (time, day = '2035-01-15') => slotInstant(day, time).toISOString();
  const user = rol => prisma.user.create({ data: { nombre: 'Prueba agenda', email: `agenda-${Date.now()}-${process.pid}-${sequence++}@test.invalid`, password: 'unused', rol, aprobado: true } });
  const request = async (actor, path, method = 'GET', body) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(actor ? { Authorization: 'Bearer ' + jwt.sign({ id: actor.id }, process.env.JWT_SECRET, { expiresIn: '1h' }) } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const fixture = async () => {
    const owner = await user('barbero'), client = await user('cliente'), rival = await user('barbero');
    const profile = await prisma.barberProfile.create({ data: { usuarioId: owner.id, requiereComprobante: false } });
    const short = await prisma.service.create({ data: { perfilBarberoId: profile.id, nombre_servicio: 'Corte', precio: 10000 } });
    const long = await prisma.service.create({ data: { perfilBarberoId: profile.id, nombre_servicio: 'Corte y barba', precio: 15000 } });
    return { owner, client, rival, profile, short, long };
  };
  const agenda = (f, day = '2035-01-15', last = '2035-01-21') => request(f.owner, `/profesional/calendario?desde=${day}&hasta=${last}`);
  const publish = (f, revision, bloques, extra = {}) => request(f.owner, '/citas/disponibilidad/semana', 'PUT', { fechaInicio: '2035-01-15', revision, configuracion: { startTime: '09:00', endTime: '12:00', blockMinutes: 30 }, bloques, bloqueos: [], ...extra });
  const availability = (f, service = f.short) => request(f.client, `/citas/disponibilidad/${f.profile.id}?fecha=2035-01-15&vista=semana&servicioId=${service.id}`);
  const book = (f, id, service = f.short, extra = {}) => request(f.client, `/citas/${id}/agendar`, 'PATCH', { servicioId: service.id, ...extra });
  before(async () => {
    const app = express(); app.use(express.json());
    for (const name of ['profesional', 'citas', 'usuarios', 'servicios']) app.use('/' + name, require('../src/routes/' + name).default);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); }); base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); });

  test('semana sin configurar, publicación ordenada, persistencia y aislamiento entre semanas', async () => {
    const f = await fixture(); const initial = await agenda(f);
    assert.equal(initial.body.publicada, false); assert.equal(initial.body.configuracion.blockMinutes, 30);
    assert.equal((await availability(f)).body.citas.length, 0);
    const saved = await publish(f, initial.body.revision, [{ inicio: at('10:00'), fin: at('10:30') }, { inicio: at('09:00'), fin: at('09:30') }]);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const reload = await agenda(f);
    assert.equal(reload.body.publicada, true);
    assert.deepEqual(reload.body.citas.map(c => c.fecha_hora), [at('09:00'), at('10:00')]);
    assert.equal((await agenda(f, '2035-01-22', '2035-01-28')).body.citas.length, 0);
    assert.equal((await publish(f, initial.body.revision, [])).status, 409);
    for (const blocks of [
      [{ inicio: at('09:00'), fin: at('10:00') }, { inicio: at('09:30'), fin: at('10:30') }],
      [{ inicio: at('09:00'), fin: at('09:30') }, { inicio: at('09:00'), fin: at('09:30') }],
    ]) assert.equal((await publish(f, reload.body.revision, blocks)).status, 400);
    assert.equal((await agenda(f)).body.revision, reload.body.revision);
  });

  test('cada servicio ocupa exactamente un bloque de 30, 45 o 60; no bloquea el siguiente', async () => {
    for (const minutes of [30, 45, 60]) for (const serviceIndex of ['short', 'long']) {
      const f = await fixture(); const service = f[serviceIndex];
      await publish(f, (await agenda(f)).body.revision, [{ inicio: at('09:00'), fin: at('12:00') }], { configuracion: { startTime: '09:00', endTime: '12:00', blockMinutes: minutes } });
      const available = await availability(f, service);
      assert.deepEqual((await availability(f, f.short)).body.citas, (await availability(f, f.long)).body.citas);
      const slot = available.body.citas[0], reservation = await book(f, slot.id, service);
      assert.equal(reservation.status, 200); assert.equal(reservation.body.duracionReservada, minutes);
      const expectedEnd = new Date(+new Date(at('09:00')) + minutes * 60000).toISOString();
      assert.equal(slot.disponibleHasta, expectedEnd);
      const updated = await availability(f, service);
      assert.equal(updated.body.calendario.horarios.filter(c => c.fecha === '2035-01-15' && c.estado === 'reserved').length, 1);
      const professional = await agenda(f);
      assert.equal(professional.body.citas.filter(c => c.id === reservation.body.id).length, 1);
      assert.equal(professional.body.citas.find(c => c.id === reservation.body.id).fin, expectedEnd);
      assert.deepEqual(professional.body.disponibilidad, [{ inicio: expectedEnd, fin: at('12:00') }]);
      for (const [actor, endpoint] of [[f.client, '/citas/cliente/mias'], [f.owner, '/citas/mias'], [f.owner, '/citas/agenda-reservas?fechaInicio=2035-01-15']]) {
        const appointments = (await request(actor, endpoint)).body;
        assert.equal(appointments.filter(c => c.id === reservation.body.id).length, 1);
        assert.equal(appointments.find(c => c.id === reservation.body.id).fin, expectedEnd);
        assert.equal('duracion_minutos' in appointments.find(c => c.id === reservation.body.id).servicio, false);
      }
      assert.equal((await book(f, slot.id, service)).status, 409);
      const next = updated.body.citas[0];
      assert.ok(next.slotId); // A virtual half-hour start retains its stored window reference.
      const second = await book(f, next.slotId, service, { fecha_hora: next.fecha_hora });
      assert.equal(second.status, 200, JSON.stringify(second.body));
      assert.equal(second.body.fecha_hora, expectedEnd);
      assert.equal(await prisma.cita.count({ where: { barberoId: f.profile.id, estado: 'confirmada' } }), 2);
      assert.equal((await request(f.client, `/citas/cliente/${reservation.body.id}/cancelar`, 'PATCH')).status, 200);
      assert.equal((await availability(f)).body.citas[0].fecha_hora, at('09:00'));
    }
  });

  test('cancelación autorizada, historial y duración histórica; no recrea disponibilidad retirada', async () => {
    const f = await fixture(); await publish(f, (await agenda(f)).body.revision, [{ inicio: at('09:00'), fin: at('10:00') }]);
    const slot = (await availability(f)).body.citas[0]; const reservation = await book(f, slot.id);
    await prisma.service.update({ where: { id: f.short.id }, data: { nombre_servicio: 'Nombre actualizado' } });
    assert.equal((await agenda(f)).body.citas.find(c => c.id === reservation.body.id).fin, at('09:30'));
    assert.equal((await request(f.rival, `/citas/${reservation.body.id}/estado`, 'PATCH', { estado: 'cancelada' })).status, 403);
    const revision = (await agenda(f)).body.revision;
    const conflict = await publish(f, revision, []);
    assert.equal(conflict.status, 409); assert.equal(conflict.body.conflictos.length, 1);
    assert.equal((await publish(f, revision, [], { conservarReservas: true })).status, 200);
    assert.equal((await prisma.cita.findUnique({ where: { id: reservation.body.id } })).estado, 'confirmada');
    assert.equal((await request(f.owner, `/citas/${reservation.body.id}/estado`, 'PATCH', { estado: 'cancelada' })).status, 200);
    assert.equal((await request(f.owner, `/citas/${reservation.body.id}/estado`, 'PATCH', { estado: 'cancelada' })).status, 409);
    const clients = await request(f.client, '/citas/cliente/mias');
    assert.equal(clients.body.find(c => c.id === reservation.body.id).estado, 'cancelada');
    assert.equal((await availability(f)).body.citas.length, 0);
    assert.equal((await request(f.owner, `/citas/${reservation.body.id}/historial`)).body.length, 2);
  });

  test('bloqueo sobre cita activa exige confirmación explícita y conserva la cita', async () => {
    const f = await fixture(); await publish(f, (await agenda(f)).body.revision, [{ inicio: at('09:00'), fin: at('10:00') }]);
    const reservation = await book(f, (await availability(f)).body.citas[0].id);
    const body = { inicio: at('09:00'), fin: at('10:00'), tipo: 'descanso' };
    assert.equal((await request(f.owner, '/profesional/bloqueos', 'POST', body)).status, 409);
    assert.equal((await request(f.owner, '/profesional/bloqueos', 'POST', { ...body, conservarReservas: true })).status, 201);
    assert.equal((await request(f.owner, `/citas/${reservation.body.id}/estado`, 'PATCH', { estado: 'cancelada' })).status, 200);
    assert.equal((await availability(f)).body.citas.length, 0);
    assert.equal((await agenda(f)).body.disponibilidad.length, 0);
  });

  test('reservas históricas con snapshot y cruces de medianoche mantienen el intervalo', async () => {
    const f = await fixture();
    await prisma.cita.create({ data: { barberoId: f.profile.id, clienteId: f.client.id, servicioId: f.long.id, fecha_hora: new Date(at('23:30', '2035-01-14')), duracionReservada: 60, estado: 'confirmada' } });
    const response = await agenda(f, '2035-01-15', '2035-01-15');
    assert.equal(response.status, 200); assert.equal(response.body.citas[0].duracionReservada, 60);
    assert.equal(response.body.citas[0].fin, at('00:30'));
    assert.equal(response.body.citas[0].servicio.nombre_servicio, f.long.nombre_servicio);
  });

  test('configuraciones 30, 45 y 60 se guardan y producen los mismos inicios en disponibilidad diaria y semanal', async () => {
    const f = await fixture();
    for (const [minutes, times] of [
      [30, ['08:30','09:00','09:30','10:00','10:30','11:00','11:30','12:00']],
      [45, ['08:30','09:15','10:00','10:45','11:30']],
      [60, ['08:30','09:30','10:30','11:30']],
    ]) {
      const config = { startTime: '08:30', endTime: '12:30', blockMinutes: minutes };
      const response = await publish(f, (await agenda(f)).body.revision, [{ inicio: at('08:30'), fin: at('12:30') }], { configuracion: config });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.deepEqual((await agenda(f)).body.configuracion, config);
      const professionalDay = await agenda(f, '2035-01-16', '2035-01-16');
      assert.deepEqual(professionalDay.body.configuraciones['2035-01-15'], config);
      assert.deepEqual(professionalDay.body.configuracion, config);
      const weekly = await availability(f);
      assert.deepEqual(weekly.body.calendario.configuracion, config);
      assert.deepEqual(weekly.body.calendario.horas, times);
      const expected = times.map(time => at(time));
      assert.deepEqual(weekly.body.citas.map(c => c.fecha_hora), expected);
      const daily = await request(f.client, `/citas/disponibilidad/${f.profile.id}?fecha=2035-01-15&servicioId=${f.short.id}`);
      assert.deepEqual(daily.body.citas, weekly.body.citas);
      assert.equal(new Set(weekly.body.citas.map(c => c.fecha_hora)).size, expected.length);
    }
  });

  test('grilla de 45 valida pago y reserva de cualquier servicio; cambiar configuración conserva citas', async () => {
    for (const duration of [30, 60]) {
      const f = await fixture(), service = duration === 30 ? f.short : f.long;
      await publish(f, (await agenda(f)).body.revision, [{ inicio: at('08:30'), fin: at('12:30') }], { configuracion: { startTime: '08:30', endTime: '12:30', blockMinutes: 45 } });
      const slot = (await availability(f, service)).body.citas.find(c => c.fecha_hora === at('09:15'));
      assert.ok(slot?.slotId);
      await prisma.barberProfile.update({ where: { id: f.profile.id }, data: { requiereComprobante: true, bancoNombre: 'Titular', bancoRut: '11111111-1', bancoNombreBanco: 'Banco', bancoTipoCuenta: 'Vista', bancoNroCuenta: '123456', bancoCorreo: 'test@test.invalid' } });
      const payment = await request(f.client, `/citas/${slot.slotId}/pago`, 'POST', { servicioId: service.id, fecha_hora: at('09:15') });
      assert.equal(payment.status, 200, JSON.stringify(payment.body));
      assert.equal((await request(f.client, `/citas/${slot.slotId}/pago`, 'POST', { servicioId: service.id, fecha_hora: at('09:30') })).status, 409);
      await prisma.barberProfile.update({ where: { id: f.profile.id }, data: { requiereComprobante: false } });
      const reservation = await book(f, slot.slotId, service, { fecha_hora: at('09:15') });
      assert.equal(reservation.status, 200, JSON.stringify(reservation.body));
      const expectedEnd = at('10:00');
      assert.equal(reservation.body.duracionReservada, 45);
      assert.equal((await agenda(f)).body.citas.find(c => c.id === reservation.body.id).fin, expectedEnd);
      assert.equal((await book(f, slot.slotId, service, { fecha_hora: at('09:15') })).status, 409);
      const starts = (await availability(f, service)).body.citas;
      assert.ok(starts.every(c => c.fecha_hora < at('09:15') || c.fecha_hora >= expectedEnd));
      const before = await prisma.cita.findUnique({ where: { id: reservation.body.id } });
      for (const blockMinutes of [30, 60]) {
        const revision = (await agenda(f)).body.revision;
        assert.equal((await publish(f, revision, [{ inicio: at('08:30'), fin: at('12:30') }], { configuracion: { startTime: '08:30', endTime: '12:30', blockMinutes } })).status, 200);
        assert.deepEqual(await prisma.cita.findUnique({ where: { id: reservation.body.id } }), before);
        assert.equal((await agenda(f)).body.citas.find(c => c.id === reservation.body.id).fin, expectedEnd);
      }
    }
  });

  test('un descanso parcial impide reservar el bloque completo para cualquier servicio', async () => {
    const f = await fixture();
    await publish(f, (await agenda(f)).body.revision, [{ inicio: at('09:00'), fin: at('12:00') }], { configuracion: { startTime: '09:00', endTime: '12:00', blockMinutes: 60 } });
    await request(f.owner, '/profesional/bloqueos', 'POST', { inicio: at('09:45'), fin: at('10:00'), tipo: 'descanso' });
    const response = await availability(f);
    const cell = response.body.calendario.horarios.find(c => c.fecha === '2035-01-15' && c.hora === '09:00');
    assert.equal(cell.estado, 'unavailable');
    assert.deepEqual(cell.ocupacion, [{ inicio: at('09:45'), fin: at('10:00'), desde: 75, hasta: 100, tipo: 'descanso' }]);
    const long = await availability(f, f.long);
    assert.equal(long.body.calendario.horarios.find(c => c.fecha === '2035-01-15' && c.hora === '09:00').estado, 'unavailable');
  });

  test('rechaza duraciones del cliente, inicios fuera de grilla, cierre incompleto y ventanas insuficientes', async () => {
    const f = await fixture();
    await publish(f, (await agenda(f)).body.revision, [{ inicio: at('09:00'), fin: at('12:30') }], { configuracion: { startTime: '09:00', endTime: '12:30', blockMinutes: 60 } });
    const slot = (await availability(f)).body.citas[0];
    for (const key of ['duracion_min', 'duracion_minutos', 'duracionReservada', 'fin', 'fin_hora']) {
      assert.equal((await book(f, slot.id, f.short, { [key]: 30 })).status, 400);
    }
    for (const time of ['08:30', '09:15', '12:00', '12:30']) {
      assert.equal((await book(f, slot.id, f.short, { fecha_hora: at(time) })).status, 409);
    }
    assert.equal(await prisma.cita.count({ where: { barberoId: f.profile.id, estado: 'confirmada' } }), 0);
    assert.ok(!(await availability(f)).body.citas.some(c => c.fecha_hora === at('12:00')));
    await publish(f, (await agenda(f)).body.revision, [{ inicio: at('09:00'), fin: at('09:30') }], { configuracion: { startTime: '09:00', endTime: '12:30', blockMinutes: 45 } });
    assert.equal((await availability(f)).body.citas.length, 0);
    const window = await prisma.cita.findFirst({ where: { barberoId: f.profile.id, estado: 'disponible' } });
    assert.equal((await book(f, window.id)).status, 409);
  });

  test('servicios no aceptan duración y nuevas reservas usan la configuración actual sin tocar las previas', async () => {
    const f = await fixture();
    assert.equal((await request(f.owner, '/servicios', 'POST', { nombre_servicio: 'Servicio nuevo', precio: 12000 })).status, 201);
    for (const method of ['POST', 'PUT']) {
      const path = method === 'POST' ? '/servicios' : `/servicios/${f.short.id}`;
      assert.equal((await request(f.owner, path, method, { nombre_servicio: 'Servicio nuevo', precio: 12000, duracion_minutos: 60 })).status, 400);
    }
    await publish(f, (await agenda(f)).body.revision, [{ inicio: at('09:00'), fin: at('12:00') }]);
    const first = await book(f, (await availability(f)).body.citas[0].id);
    const frozen = await prisma.cita.findUnique({ where: { id: first.body.id } });
    for (const blockMinutes of [45, 60]) {
      await publish(f, (await agenda(f)).body.revision, [{ inicio: at('09:00'), fin: at('12:00') }], { configuracion: { startTime: '09:00', endTime: '12:00', blockMinutes } });
      assert.deepEqual(await prisma.cita.findUnique({ where: { id: first.body.id } }), frozen);
      const slot = (await availability(f)).body.citas[0];
      const next = await book(f, slot.slotId || slot.id, f.long, { fecha_hora: slot.fecha_hora });
      assert.equal(next.status, 200, JSON.stringify(next.body));
      assert.equal(next.body.duracionReservada, blockMinutes);
      assert.equal((await request(f.client, `/citas/cliente/${next.body.id}/cancelar`, 'PATCH')).status, 200);
    }
  });
});
