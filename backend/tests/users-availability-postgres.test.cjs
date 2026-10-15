require('./security-env.cjs');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const url = process.env.SCHEDULE_TEST_DATABASE_URL;
if (url) {
  if (new URL(url).pathname !== '/schedule_tests') throw Error('Only disposable schedule_tests is allowed');
  process.env.DATABASE_URL = url;
}
describe('Grupo 4: persistencia y permisos con PostgreSQL y HTTP', { skip: !url }, () => {
  require('ts-node/register');
  const express = require('express'), jwt = require('jsonwebtoken'), sharp = require('sharp');
  const { PrismaClient } = require('@prisma/client');
  const prisma = require('../src/config/prisma').default, independent = new PrismaClient();
  let server, base, sequence = 0, admin;
  const user = (rol = 'cliente') => prisma.user.create({ data: { nombre: 'Grupo Cuatro', rol, aprobado: true, email: `g4-${process.pid}-${Date.now()}-${sequence++}@test.invalid`, password: 'unused' } });
  const request = async (account, path, method = 'GET', data) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(account ? { Authorization: 'Bearer ' + jwt.sign({ id: account.id, rol: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' }) } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const fixture = async () => {
    const owner = await user('barbero');
    const profile = await prisma.barberProfile.create({ data: { usuarioId: owner.id, requiereComprobante: false } });
    const service = await prisma.service.create({ data: { perfilBarberoId: profile.id, nombre_servicio: 'Corte', precio: 10000, duracion_minutos: 30 } });
    return { owner, profile, service };
  };
  const calendarPath = '/profesional/calendario?desde=2035-01-15&hasta=2035-01-21';
  const configuration = { startTime: '10:00', endTime: '18:00', blockMinutes: 30 };
  const window = { inicio: '2035-01-15T15:00:00Z', fin: '2035-01-15T16:00:00Z' };
  const week = revision => ({ fechaInicio: '2035-01-15', revision, configuracion: configuration, bloques: [window], bloqueos: [{ inicio: '2035-01-15T16:00:00Z', fin: '2035-01-15T16:30:00Z', tipo: 'descanso' }] });
  before(async () => {
    admin = await user('admin');
    const app = express(); app.use(express.json({ limit: '6mb' }));
    for (const name of ['usuarios', 'auth', 'profesional', 'citas', 'servicios']) app.use('/' + name, require('../src/routes/' + name).default);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); }); base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await Promise.all([prisma.$disconnect(), independent.$disconnect()]); });

  test('solicitudes duplicadas concurrentes, rechazo con motivo y resultado inmutable', async () => {
    const client = await user();
    const results = await Promise.all([request(client, '/usuarios/solicitud-profesional', 'POST'), request(client, '/usuarios/solicitud-profesional', 'POST')]);
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    assert.equal((await request(client, '/usuarios/solicitud-profesional')).body.estado, 'pendiente');
    assert.equal((await request(client, '/profesional/calendario?desde=2035-01-15&hasta=2035-01-21')).status, 403);
    assert.equal((await request(admin, `/usuarios/${client.id}/rechazar-barbero`, 'PATCH', { motivoRechazo: '  ' })).status, 400);
    assert.equal((await request(admin, `/usuarios/${client.id}`, 'PUT', { rol: 'barbero' })).status, 409);
    assert.equal((await request(admin, `/usuarios/${client.id}/rechazar-barbero`, 'PATCH', { motivoRechazo: 'Antecedentes incompletos' })).status, 200);
    const loaded = (await request(client, '/usuarios/solicitud-profesional')).body;
    assert.equal(loaded.estado, 'rechazada'); assert.equal(loaded.motivoRechazo, 'Antecedentes incompletos'); assert.equal(loaded.revisorId, admin.id); assert.ok(loaded.fechaResolucion);
    assert.equal((await request(client, '/auth/me')).body.rol, 'cliente');
    assert.equal((await request(client, '/usuarios/solicitud-profesional', 'POST')).status, 409);
    assert.equal((await request(admin, `/usuarios/${client.id}/aprobar-barbero`, 'PATCH')).status, 409);
    assert.equal((await independent.solicitudProfesional.findUnique({ where: { usuarioId: client.id } })).motivoRechazo, loaded.motivoRechazo);
  });
  test('aprobación atómica, listado administrativo y acceso profesional solo después de aprobar', async () => {
    const client = await user(); await request(client, '/usuarios/solicitud-profesional', 'POST');
    const pending = await request(admin, '/usuarios/barberos/pendientes'); assert.ok(pending.body.some(u => u.id === client.id));
    assert.ok((await request(admin, '/usuarios/admin/dashboard')).body.barberosPendientes.some(u => u.id === client.id));
    const outcomes = await Promise.all([request(admin, `/usuarios/${client.id}/aprobar-barbero`, 'PATCH'), request(admin, `/usuarios/${client.id}/rechazar-barbero`, 'PATCH', { motivoRechazo: 'Revisión' })]);
    assert.deepEqual(outcomes.map(r => r.status).sort(), [200, 409]);
    const application = (await request(client, '/usuarios/solicitud-profesional')).body;
    const me = (await request(client, '/auth/me')).body;
    assert.equal(me.rol, application.estado === 'aprobada' ? 'barbero' : 'cliente');
    if (application.estado === 'aprobada') { assert.ok(me.perfilBarbero.id); assert.equal((await request(client, calendarPath)).status, 200); }
    const another = await user(); await request(another, '/usuarios/solicitud-profesional', 'POST');
    await prisma.user.update({ where: { id: another.id }, data: { foto_perfil: 'foto-actual-del-cliente' } });
    await prisma.barberProfile.create({ data: { usuarioId: another.id, foto_perfil: 'foto-antigua', bancoNroCuenta: 'conservar' } });
    assert.equal((await request(admin, `/usuarios/${another.id}/aprobar-barbero`, 'PATCH')).status, 200);
    assert.equal((await request(another, calendarPath)).status, 200);
    const profile = await independent.barberProfile.findUnique({ where: { usuarioId: another.id } });
    assert.equal(profile.foto_perfil, 'foto-actual-del-cliente'); assert.equal(profile.bancoNroCuenta, 'conservar');
    assert.equal((await independent.solicitudProfesional.findUnique({ where: { usuarioId: another.id } })).estado, 'aprobada');
  });
  test('registro como barbero crea cliente y solicitud, sin habilitar funciones profesionales', async () => {
    const result = await request(null, '/usuarios', 'POST', { nombre: 'Nuevo Cliente', email: `new-${Date.now()}@test.invalid`, password: 'test-password', telefono: '912345678', rol: 'barbero' });
    assert.equal(result.status, 201); assert.equal(result.body.rol, 'cliente');
    assert.equal((await request(result.body, '/usuarios/solicitud-profesional')).body.estado, 'pendiente');
    assert.equal((await request(result.body, calendarPath)).status, 403);
  });
  test('asignación administrativa de rol mantiene las solicitudes pendientes y registra aprobación directa', async () => {
    const pending = await user(), approved = await user();
    assert.equal((await request(admin, `/usuarios/${pending.id}`, 'PUT', { rol: 'barbero', aprobado: false })).status, 200);
    assert.equal((await request(pending, '/usuarios/solicitud-profesional')).body.estado, 'pendiente');
    assert.equal((await request(pending, calendarPath)).status, 403);
    assert.equal((await request(admin, `/usuarios/${pending.id}/aprobar-barbero`, 'PATCH')).status, 200);
    assert.equal((await request(pending, calendarPath)).status, 200);
    assert.equal((await request(admin, `/usuarios/${approved.id}`, 'PUT', { rol: 'barbero', aprobado: true })).status, 200);
    assert.equal((await request(approved, '/usuarios/solicitud-profesional')).body.estado, 'aprobada');
  });
  test('teléfono: agregar, modificar, omitir, borrar con null/vacío; foto real y errores sin falso éxito', async () => {
    const client = await user();
    for (const telefono of ['912345678', '987654321', null, '912345678', '']) {
      const saved = await request(client, '/auth/me', 'PUT', { telefono }); assert.equal(saved.status, 200);
      assert.equal((await independent.user.findUnique({ where: { id: client.id } })).telefono, telefono || null);
      assert.equal((await request(client, '/auth/me')).body.telefono, telefono || null);
    }
    await request(client, '/auth/me', 'PUT', { telefono: '912345678' });
    await request(client, '/auth/me', 'PUT', { nombre: 'Otro Nombre' });
    assert.equal((await request(client, '/auth/me')).body.telefono, '912345678');
    assert.equal((await request(client, '/auth/me', 'PUT', { telefono: 'bad' })).status, 400);
    assert.equal((await request(client, '/auth/me', 'PUT', { rol: 'admin' })).status, 400);
    const bytes = await sharp({ create: { width: 30, height: 30, channels: 3, background: '#123456' } }).png().toBuffer();
    const photo = await request(client, '/auth/me/photo', 'PUT', { foto_perfil: 'data:image/png;base64,' + bytes.toString('base64') }); assert.equal(photo.status, 200);
    assert.equal((await request(client, '/auth/me', 'PUT', { nombre: 'Otro Nombre' })).body.foto_perfil, photo.body.foto_perfil);
    assert.equal((await independent.user.findUnique({ where: { id: client.id } })).foto_perfil, photo.body.foto_perfil);
    assert.equal((await request(client, '/auth/me/photo', 'PUT', { foto_perfil: 'invalid' })).status, 400);
    assert.equal((await request(client, '/auth/me')).body.foto_perfil, photo.body.foto_perfil);
    assert.equal((await request(admin, `/usuarios/${client.id}`, 'PUT', { telefono: null })).status, 200);
    assert.equal((await request(client, '/auth/me')).body.telefono, null);
  });
  test('configuración y descansos en otra conexión; publicación vacía explícita y protección contra dos dispositivos', async () => {
    const f = await fixture(), other = await fixture();
    const first = (await request(f.owner, calendarPath)).body;
    assert.equal((await request(f.owner, '/citas/disponibilidad/semana', 'PUT', week(undefined))).status, 428);
    const competing = await Promise.all([request(f.owner, '/citas/disponibilidad/semana', 'PUT', week(first.revision)), request(f.owner, '/citas/disponibilidad/semana', 'PUT', week(first.revision))]);
    assert.deepEqual(competing.map(r => r.status).sort(), [200, 409]);
    const second = (await request(f.owner, calendarPath)).body;
    assert.deepEqual(second.configuracion, configuration); assert.ok(second.publicada); assert.equal(second.bloqueos.length, 1);
    assert.deepEqual((await independent.agendaSemana.findFirst({ where: { barberoId: f.profile.id } })).configuracion, configuration);
    assert.equal((await request(other.owner, calendarPath)).body.publicada, false);
    assert.equal((await request(f.owner, '/citas/disponibilidad/semana', 'PUT', { ...week(second.revision), configuracion: { ...configuration, blockMinutes: 0 } })).status, 400);
    assert.equal((await request(f.owner, '/citas/disponibilidad/semana', 'PUT', { ...week(second.revision), bloques: [], bloqueos: [] })).status, 200);
    const empty = (await request(f.owner, calendarPath)).body;
    assert.ok(empty.publicada); assert.equal(empty.citas.length, 0); assert.equal(empty.bloqueos.length, 0);
  });
  test('reserva concurrente invalida borrador; republicar y bloquear conserva citas e impide reservas bloqueadas', async () => {
    const f = await fixture(), client = await user(), secondClient = await user();
    let snapshot = (await request(f.owner, calendarPath)).body;
    assert.equal((await request(f.owner, '/citas/disponibilidad/semana', 'PUT', week(snapshot.revision))).status, 200);
    snapshot = (await request(f.owner, calendarPath)).body;
    const slot = snapshot.citas.find(c => c.estado === 'disponible');
    const booking = await request(client, `/citas/${slot.id}/agendar`, 'PATCH', { servicioId: f.service.id }); assert.equal(booking.status, 200);
    assert.equal((await request(f.owner, '/citas/disponibilidad/semana', 'PUT', week(snapshot.revision))).status, 409);
    snapshot = (await request(f.owner, calendarPath)).body;
    const old = await independent.cita.findUnique({ where: { id: booking.body.id } });
    assert.equal((await request(f.owner, '/citas/disponibilidad/semana', 'PUT', { ...week(snapshot.revision), bloques: [], bloqueos: [{ ...window, tipo: 'bloqueado' }] })).status, 200);
    assert.deepEqual(await independent.cita.findUnique({ where: { id: old.id } }), old);
    // An individual available window cannot bypass the persistent block.
    const underneath = await prisma.cita.create({ data: { barberoId: f.profile.id, fecha_hora: new Date('2035-01-15T15:30:00Z'), disponibleHasta: new Date(window.fin) } });
    assert.equal((await request(secondClient, `/citas/${underneath.id}/agendar`, 'PATCH', { servicioId: f.service.id })).status, 409);
  });
  test('desactivación/reactivación preservan dependencias y revocan acceso; roles y propio acceso protegidos', async () => {
    const f = await fixture(), client = await user();
    const cita = await prisma.cita.create({ data: { barberoId: f.profile.id, clienteId: client.id, servicioId: f.service.id, estado: 'finalizada', fecha_hora: new Date('2025-01-01T15:00:00Z'), duracionReservada: 30 } });
    assert.equal((await request(admin, `/usuarios/${f.owner.id}`, 'DELETE')).status, 204);
    assert.deepEqual(await independent.cita.findUnique({ where: { id: cita.id } }), cita);
    assert.ok(await independent.barberProfile.findUnique({ where: { id: f.profile.id } }));
    assert.equal((await request(f.owner, '/auth/me')).status, 403);
    assert.ok(!(await request(null, '/usuarios?rol=barbero')).body.some(u => u.id === f.owner.id));
    assert.equal((await request(admin, `/usuarios/${f.owner.id}`, 'PUT', { activo: true })).status, 200);
    assert.equal((await request(f.owner, '/auth/me')).status, 200);
    assert.equal((await request(admin, `/usuarios/${admin.id}`, 'DELETE')).status, 409);
    assert.equal((await request(admin, `/usuarios/${admin.id}`, 'PUT', { rol: 'cliente' })).status, 409);
    assert.equal((await request(admin, `/usuarios/${client.id}`, 'PUT', { rol: 'admin' })).status, 200);
    assert.equal((await request(client, '/usuarios/admin/dashboard')).status, 200);
  });
  test('todas las operaciones administrativas rechazan invitados/clientes/barberos; solicitudes no filtran datos de terceros', async () => {
    const client = await user(), f = await fixture();
    for (const actor of [null, client, f.owner]) for (const [path, method, data] of [
      ['/usuarios/admin/dashboard', 'GET'], ['/usuarios/barberos/pendientes', 'GET'], [`/usuarios/${client.id}/aprobar-barbero`, 'PATCH'],
      [`/usuarios/${client.id}/rechazar-barbero`, 'PATCH', { motivoRechazo: 'No' }], [`/usuarios/${client.id}`, 'DELETE'], [`/usuarios/${client.id}`, 'PUT', { rol: 'admin' }],
    ]) assert.equal((await request(actor, path, method, data)).status, actor ? 403 : 401);
    assert.equal((await request(client, '/usuarios/solicitud-profesional', 'POST', { usuarioId: admin.id })).status, 400);
    assert.equal((await request(client, '/usuarios/solicitud-profesional')).body, null);
    assert.ok(!(await request(null, '/usuarios?rol=barbero')).body.some(u => Object.hasOwn(u, 'solicitudProfesional')));
  });
});
