require('./security-env.cjs');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const url = process.env.SCHEDULE_TEST_DATABASE_URL;
if (url) {
  if (new URL(url).pathname !== '/schedule_tests') throw Error('Only disposable schedule_tests is allowed');
  process.env.DATABASE_URL = url;
}
describe('panel profesional con HTTP y PostgreSQL reales', { skip: !url }, () => {
  require('ts-node/register');
  const express = require('express'), jwt = require('jsonwebtoken'), sharp = require('sharp');
  const prisma = require('../src/config/prisma').default;
  const { businessRange } = require('../src/services/businessTime');
  let server, base, sequence = 0, client, admin;
  const user = rol => prisma.user.create({ data: { nombre: 'Panel', rol, aprobado: true, email: `panel-${process.pid}-${Date.now()}-${sequence++}@test.invalid`, password: 'unused' } });
  const fixture = async () => {
    const owner = await user('barbero');
    const profile = await prisma.barberProfile.create({ data: { usuarioId: owner.id, requiereComprobante: false } });
    return { owner, profile };
  };
  const request = async (account, path, method = 'GET', data) => {
    if (path.endsWith('/disponibilidad/semana') && method === 'PUT') {
      const { availabilitySnapshot } = require('../src/services/availability');
      const { withSchedule } = require('../src/services/schedule');
      const profile = await prisma.barberProfile.findUnique({ where: { usuarioId: account.id } });
      const { start, end } = businessRange(data.fechaInicio, 7);
      const snapshot = await withSchedule(profile.id, tx => availabilitySnapshot(tx, profile.id, start, end));
      data = { ...data, revision: snapshot.revision, configuracion: snapshot.configuracion };
    }
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(account ? { Authorization: 'Bearer ' + jwt.sign({ id: account.id, rol: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' }) } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const serviceData = { nombre_servicio: 'Corte clásico', descripcion: 'Servicio profesional', precio: 12000, duracion_minutos: 30 };
  const seed = (f, estado, date) => prisma.cita.create({ data: { barberoId: f.profile.id, clienteId: client.id, estado, fecha_hora: date, duracionReservada: 30, nombreServicioReservado: 'Histórico', precioReservado: 10000 } });
  before(async () => {
    client = await user('cliente'); admin = await user('admin');
    const app = express(); app.use(express.json({ limit: '6mb' }));
    for (const name of ['profesional', 'servicios', 'citas', 'auth', 'lugartrabajo']) app.use('/' + name, require('../src/routes/' + name).default);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); }); base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); });

  test('servicios: lista completa, edición, activación y retiro preservan historia y propiedad', async () => {
    const f = await fixture(), other = await fixture(); let service;
    for (let i = 0; i < 7; i++) { const r = await request(f.owner, '/servicios', 'POST', serviceData); assert.equal(r.status, 201, JSON.stringify(r.body)); service = r.body; }
    assert.equal((await request(f.owner, '/servicios')).body.length, 7);
    for (const method of ['PUT', 'DELETE']) assert.equal((await request(other.owner, `/servicios/${service.id}`, method, method === 'PUT' ? serviceData : undefined)).status, 403);
    for (const data of [{ precio: -1 }, { duracion_minutos: 0 }, { perfilBarberoId: other.profile.id }, { nombre_servicio: 'x'.repeat(81) }]) assert.equal((await request(f.owner, `/servicios/${service.id}`, 'PUT', data)).status, 400);
    const old = await prisma.cita.create({ data: { barberoId: f.profile.id, clienteId: client.id, servicioId: service.id, fecha_hora: new Date('2026-01-01T14:00:00Z'), estado: 'finalizada', duracionReservada: 30, nombreServicioReservado: service.nombre_servicio, precioReservado: 12000 } });
    assert.equal((await request(f.owner, `/servicios/${service.id}`, 'PUT', { nombre_servicio: 'Corte nuevo', descripcion: 'Nueva descripción', precio: 15000, duracion_minutos: 45, activo: false })).status, 200);
    assert.equal((await request(f.owner, '/servicios')).body.find(s => s.id === service.id).activo, false);
    assert.equal((await request(f.owner, `/servicios/${service.id}`, 'PUT', { activo: true })).body.activo, true);
    assert.equal((await request(f.owner, `/servicios/${service.id}`, 'DELETE')).status, 204);
    assert.equal((await prisma.service.findUnique({ where: { id: service.id } })).activo, false);
    assert.deepEqual(await prisma.cita.findUnique({ where: { id: old.id } }), old);
  });

  test('perfil: biografía y especialidades persisten y no admiten asignación de otro propietario', async () => {
    const f = await fixture(), other = await fixture();
    const profile = { biografia: 'Cortes clásicos, barba y atención personalizada.', especialidades: ['Corte clásico', 'Barba'] };
    assert.equal((await request(f.owner, '/profesional/perfil', 'PUT', profile)).status, 200);
    const loaded = (await request(f.owner, '/auth/me')).body.perfilBarbero;
    assert.equal(loaded.biografia, profile.biografia); assert.deepEqual(loaded.especialidades, profile.especialidades);
    assert.equal((await prisma.barberProfile.findUnique({ where: { id: other.profile.id } })).biografia, null);
    for (const data of [{ ...profile, usuarioId: other.owner.id }, { ...profile, biografia: 'x'.repeat(2001) }, { ...profile, especialidades: ['Barba', 'Barba'] }, { ...profile, especialidades: ['x'.repeat(61)] }]) assert.equal((await request(f.owner, '/profesional/perfil', 'PUT', data)).status, 400);
    assert.equal((await request(f.owner, '/profesional/perfil', 'PUT', { biografia: '', especialidades: [] })).status, 200);
  });

  test('fotografía normalizada y lugar de trabajo sobreviven a nuevas consultas', async () => {
    const f = await fixture();
    const bytes = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#336699' } }).png().toBuffer();
    const photo = await request(f.owner, '/auth/me/photo', 'PUT', { foto_perfil: 'data:image/png;base64,' + bytes.toString('base64') });
    assert.equal(photo.status, 200, JSON.stringify(photo.body));
    const me = await request(f.owner, '/auth/me');
    assert.equal(me.body.foto_perfil, photo.body.foto_perfil); assert.equal(me.body.perfilBarbero.foto_perfil, photo.body.foto_perfil);
    const place = await request(f.owner, '/lugartrabajo', 'POST', { nombre_barberia: 'Barbería Panel', direccion: 'Avenida Central 123' });
    assert.equal(place.status, 201, JSON.stringify(place.body));
    assert.equal((await request(f.owner, `/lugartrabajo/${place.body.id}`, 'PUT', { nombre_barberia: 'Barbería Nueva', direccion: 'Avenida Central 456' })).status, 200);
    assert.equal((await request(f.owner, '/auth/me')).body.perfilBarbero.lugarTrabajo.direccion, 'Avenida Central 456');
  });

  test('estadísticas SQL por período y estado, cero sin datos, aislamiento y fechas Santiago', async () => {
    const f = await fixture(), other = await fixture(); const { start, end } = businessRange('2026-09-06');
    for (const state of ['pendiente', 'confirmada', 'finalizada', 'cancelada', 'rechazada', 'inasistencia']) await seed(f, state, start);
    await seed(f, 'finalizada', new Date(+start - 1)); await seed(f, 'finalizada', end); await seed(other, 'finalizada', start);
    await prisma.cita.create({ data: { barberoId: f.profile.id, fecha_hora: start, estado: 'disponible', disponibleHasta: new Date(+start + 3600000) } });
    const stats = await request(f.owner, '/profesional/estadisticas?desde=2026-09-06&hasta=2026-09-06');
    assert.equal(stats.status, 200); assert.equal(stats.body.total, 6); assert.deepEqual(Object.values(stats.body.estados), [1, 1, 1, 1, 1, 1]);
    assert.equal((await request(f.owner, '/profesional/estadisticas?desde=2034-01-01&hasta=2034-01-01')).body.total, 0);
    for (const query of ['desde=2026-10-01&hasta=2026-09-01', 'desde=2026-02-30&hasta=2026-03-01', 'desde=2026-01-01&hasta=2028-01-01', `desde=2026-09-06&hasta=2026-09-06&barberoId=${other.profile.id}`]) assert.equal((await request(f.owner, '/profesional/estadisticas?' + query)).status, 400);
  });

  test('calendario: períodos diario/semanal/mensual usan los mismos datos, sin comprobantes ni bancos', async () => {
    const f = await fixture(), other = await fixture(); const at = new Date('2026-09-06T15:00:00Z');
    const own = await seed(f, 'cancelada', at), foreign = await seed(other, 'confirmada', at);
    const overnight = await seed(f, 'finalizada', new Date(+businessRange('2026-09-06').start - 15 * 60000));
    for (const [from, to] of [['2026-09-06', '2026-09-06'], ['2026-08-31', '2026-09-06'], ['2026-09-01', '2026-09-30']]) {
      const r = await request(f.owner, `/profesional/calendario?desde=${from}&hasta=${to}`); assert.equal(r.status, 200);
      assert.ok(r.body.citas.some(c => c.id === own.id)); assert.ok(r.body.citas.some(c => c.id === overnight.id));
      assert.ok(!r.body.citas.some(c => c.id === foreign.id));
      assert.ok(!JSON.stringify(r.body).match(/comprobante|banco|password|telefono/));
    }
  });

  test('bloqueos persistentes impiden nuevas reservas y no eliminan citas; solo su dueño los retira', async () => {
    const f = await fixture(), other = await fixture(); const start = new Date('2035-01-15T15:00:00Z'), end = new Date(+start + 3600000);
    const service = (await request(f.owner, '/servicios', 'POST', serviceData)).body;
    const slot = await prisma.cita.create({ data: { barberoId: f.profile.id, fecha_hora: start, disponibleHasta: end } });
    const block = await request(f.owner, '/profesional/bloqueos', 'POST', { inicio: start.toISOString(), fin: end.toISOString(), tipo: 'descanso' }); assert.equal(block.status, 201);
    const book = () => request(client, `/citas/${slot.id}/agendar`, 'PATCH', { servicioId: service.id });
    assert.equal((await book()).status, 409);
    assert.equal((await request(other.owner, `/profesional/bloqueos/${block.body.id}`, 'DELETE')).status, 403);
    assert.equal((await request(f.owner, '/profesional/calendario?desde=2035-01-15&hasta=2035-01-15')).body.bloqueos[0].id, block.body.id);
    assert.equal((await request(f.owner, `/profesional/bloqueos/${block.body.id}`, 'DELETE')).status, 204);
    const reservation = await book(); assert.equal(reservation.status, 200);
    assert.equal((await request(f.owner, '/profesional/bloqueos', 'POST', { inicio: start.toISOString(), fin: end.toISOString(), tipo: 'bloqueado' })).status, 201);
    assert.equal((await prisma.cita.findUnique({ where: { id: reservation.body.id } })).estado, 'confirmada');
  });

  test('publicación semanal conserva descansos en PostgreSQL y no retira bloqueos manuales', async () => {
    const f = await fixture(); const a = '2035-01-15T15:00:00Z', b = '2035-01-15T15:30:00Z', c = '2035-01-15T16:00:00Z';
    const manual = await request(f.owner, '/profesional/bloqueos', 'POST', { inicio: '2035-01-15T17:00:00Z', fin: '2035-01-15T18:00:00Z', tipo: 'bloqueado' });
    const payload = { fechaInicio: '2035-01-15', bloques: [{ inicio: a, fin: b }], bloqueos: [{ inicio: b, fin: c, tipo: 'descanso' }] };
    assert.equal((await request(f.owner, '/citas/disponibilidad/semana', 'PUT', payload)).status, 200);
    const loaded = (await request(f.owner, '/profesional/calendario?desde=2035-01-15&hasta=2035-01-21')).body;
    assert.equal(loaded.bloqueos.length, 2); assert.ok(loaded.bloqueos.some(b => b.origen === 'agenda' && b.tipo === 'descanso'));
    assert.equal((await request(f.owner, '/citas/disponibilidad/semana', 'PUT', { ...payload, bloqueos: [] })).status, 200);
    assert.ok(await prisma.agendaBloqueo.findUnique({ where: { id: manual.body.id } }));
    assert.equal((await request(f.owner, '/citas/disponibilidad/semana', 'PUT', { ...payload, bloqueos: [{ inicio: a, fin: c, tipo: 'descanso' }] })).status, 400);
  });

  test('ningún cliente, administrador ni invitado accede al panel privado de otro rol', async () => {
    for (const account of [null, client, admin]) {
      const expected = account ? 403 : 401;
      for (const endpoint of ['estadisticas', 'calendario']) assert.equal((await request(account, `/profesional/${endpoint}?desde=2026-01-01&hasta=2026-01-31`)).status, expected);
      assert.equal((await request(account, '/profesional/perfil', 'PUT', { biografia: '', especialidades: [] })).status, expected);
    }
  });
});
