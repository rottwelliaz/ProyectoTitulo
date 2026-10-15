require('./security-env.cjs');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const databaseUrl = process.env.SCHEDULE_TEST_DATABASE_URL;
if (databaseUrl) {
  if (!new URL(databaseUrl).pathname.endsWith('/schedule_tests')) throw new Error('Use a disposable schedule_tests database');
  process.env.DATABASE_URL = databaseUrl;
}

describe('privacidad bancaria con PostgreSQL real', { skip: !databaseUrl }, () => {
  require('ts-node/register');
  const prisma = require('../src/config/prisma').default;
  const express = require('express');
  const jwt = require('jsonwebtoken');
  const bank = { bancoNombre: 'Titular Privado', bancoRut: '12345678-5', bancoNombreBanco: 'Banco Privado', bancoTipoCuenta: 'Cuenta Corriente', bancoNroCuenta: '987654321', bancoCorreo: 'privado@example.com' };
  const noBank = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!key.startsWith('banco'), `Campo bancario expuesto: ${key}`);
      noBank(child);
    }
  };
  let sequence = 0, server, base, client, admin;
  const user = rol => prisma.user.create({ data: { nombre: 'Privacidad', email: `privacy-${process.pid}-${Date.now()}-${sequence++}@test.invalid`, password: 'not-used', rol, aprobado: true } });
  const request = async (account, path, method = 'GET', data) => {
    const token = account ? jwt.sign({ id: account.id, nonce: sequence++ }, process.env.JWT_SECRET, { expiresIn: '1h' }) : null;
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
  };
  async function fixture(proof = true) {
    const owner = await user('barbero');
    const place = await prisma.lugarTrabajo.create({ data: { nombre_barberia: 'Barberia', direccion: 'Concepcion' } });
    const profile = await prisma.barberProfile.create({ data: { usuarioId: owner.id, lugarTrabajoId: place.id, requiereComprobante: proof, ...bank } });
    const service = await prisma.service.create({ data: { perfilBarberoId: profile.id, nombre_servicio: 'Corte', precio: 10000, duracion_minutos: 30 } });
    const slot = await prisma.cita.create({ data: { barberoId: profile.id, fecha_hora: new Date(Date.now() + 86400000), disponibleHasta: new Date(Date.now() + 90000000), estado: 'disponible' } });
    return { owner, profile, service, slot, place };
  }
  const pay = (account, f, data = { servicioId: f.service.id }) => request(account, `/citas/${f.slot.id}/pago`, 'POST', data);
  before(async () => {
    client = await user('cliente'); admin = await user('admin');
    const app = express(); app.use(express.json());
    for (const name of ['auth', 'citas', 'usuarios', 'servicios', 'lugartrabajo', 'conversations']) app.use('/' + name, require('../src/routes/' + name).default);
    server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); });

  test('listados públicos, de reserva y administrativos no exponen bancos anidados', async () => {
    const f = await fixture();
    for (const [account, path] of [
      [null, '/usuarios?rol=barbero'], [client, '/citas/barberos'], [admin, '/citas/barberos'],
      [admin, '/usuarios'], [admin, '/usuarios/admin/dashboard'], [admin, '/usuarios/barberos/pendientes'],
      [admin, '/servicios'], [admin, `/servicios/${f.service.id}`], [f.owner, '/servicios'],
      [admin, '/lugartrabajo'], [admin, `/lugartrabajo/${f.place.id}`], [f.owner, '/lugartrabajo'],
      [client, '/citas/cliente/mias'], [client, '/conversations'],
    ]) {
      const result = await request(account, path);
      assert.equal(result.status, 200, path + JSON.stringify(result.body)); noBank(result.body);
    }
    // Approval now resolves an explicit pending application, including legacy accounts.
    await prisma.user.update({ where: { id: f.owner.id }, data: { aprobado: false } });
    await prisma.solicitudProfesional.create({ data: { usuarioId: f.owner.id } });
    for (const [path, method, body] of [
      [`/usuarios/${f.owner.id}/aprobar-barbero`, 'PATCH', {}],
      [`/usuarios/${f.owner.id}`, 'PUT', { nombre: 'Nombre Nuevo' }],
    ]) {
      const result = await request(admin, path, method, body);
      assert.equal(result.status, 200, JSON.stringify(result.body)); noBank(result.body);
    }
    assert.equal((await prisma.barberProfile.findUnique({ where: { id: f.profile.id } })).bancoNroCuenta, bank.bancoNroCuenta);
  });

  test('pago exige cliente autenticado y devuelve solo el profesional del horario seleccionado', async () => {
    const f = await fixture();
    for (const [account, status] of [[null, 401], [admin, 403], [f.owner, 403]]) {
      const result = await pay(account, f); assert.equal(result.status, status); noBank(result.body);
    }
    const result = await pay(client, f);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(result.body, { citaId: f.slot.id, servicioId: f.service.id, barberoId: f.profile.id, ...bank });
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal((await request(client, '/citas/barberos')).body.some(row => 'bancoNroCuenta' in row), false);
  });

  test('sin comprobante, no aprobado, servicio ajeno, ocupado, pasado e incompleto no revelan bancos', async () => {
    const account = await user('cliente'); const f = await fixture(false); const other = await fixture();
    assert.equal((await pay(account, f)).status, 403);
    assert.equal((await request(account, `/citas/${f.slot.id}/agendar`, 'PATCH', { servicioId: f.service.id })).status, 200);
    assert.equal((await pay(account, f)).status, 409);
    assert.equal((await pay(account, other, { servicioId: f.service.id })).status, 404);
    assert.equal((await pay(account, other, { servicioId: [other.service.id] })).status, 400);
    assert.equal((await pay(account, other, { servicioId: other.service.id, barberoId: f.profile.id })).status, 400);
    await prisma.user.update({ where: { id: other.owner.id }, data: { aprobado: false } });
    const denied = await pay(account, other); assert.equal(denied.status, 403); noBank(denied.body);
    await prisma.user.update({ where: { id: other.owner.id }, data: { aprobado: true } });
    await prisma.barberProfile.update({ where: { id: other.profile.id }, data: { bancoCorreo: null } });
    const incomplete = await pay(account, other); assert.equal(incomplete.status, 409); noBank(incomplete.body);
    await prisma.cita.update({ where: { id: other.slot.id }, data: { fecha_hora: new Date(Date.now() - 1000) } });
    assert.equal((await pay(account, other)).status, 409);
  });

  test('renovar JWT o hacer consultas concurrentes no evade la cuota por cliente', async () => {
    const account = await user('cliente'); const fixtures = [];
    for (let i = 0; i < 4; i++) fixtures.push(await fixture());
    const results = await Promise.all(fixtures.map(f => pay(account, f)));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 200, 200, 429]);
    const blockedIndex = results.findIndex(r => r.status === 429);
    const again = await pay(account, fixtures[blockedIndex]);
    assert.equal(again.status, 429); noBank(again.body);
    assert.ok(Number(again.headers.get('retry-after')) > 0);
    assert.equal((await pay(await user('cliente'), fixtures[blockedIndex])).status, 200);
  });

  test('solo el propietario barbero lee y edita su cuenta; administradores no heredan privilegio bancario', async () => {
    const f = await fixture(); const other = await fixture();
    const payload = { nombre: 'Titular Nuevo', rut: '12345678-5', banco: 'Banco Nuevo', tipoCuenta: 'Cuenta Corriente', nroCuenta: '123456', correo: 'nuevo@example.com' };
    for (const account of [client, admin]) assert.equal((await request(account, '/auth/me/banking', 'PUT', payload)).status, 403);
    assert.equal((await request(f.owner, '/auth/me/banking', 'PUT', { ...payload, usuarioId: other.owner.id })).status, 400);
    const edited = await request(f.owner, '/auth/me/banking', 'PUT', payload);
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.bancoNroCuenta, payload.nroCuenta);
    assert.equal(edited.headers.get('cache-control'), 'no-store');
    const me = await request(f.owner, '/auth/me'); assert.equal(me.body.perfilBarbero.bancoNroCuenta, payload.nroCuenta);
    assert.equal((await prisma.barberProfile.findUnique({ where: { id: other.profile.id } })).bancoNroCuenta, bank.bancoNroCuenta);
    await prisma.user.update({ where: { id: f.owner.id }, data: { rol: 'admin' } });
    noBank((await request(f.owner, '/auth/me')).body);
    assert.equal((await prisma.barberProfile.findUnique({ where: { id: f.profile.id } })).bancoNroCuenta, payload.nroCuenta);
  });
});
