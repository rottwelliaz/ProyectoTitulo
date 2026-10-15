require('./security-env.cjs');
require('ts-node/register');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');
const prisma = require('../src/config/prisma').default;
const authRouter = require('../src/routes/auth').default;
const citasRouter = require('../src/routes/citas').default;
const validPng = `data:image/png;base64,${fs.readFileSync(path.resolve(__dirname, '../../Frontend/tests/fixtures/profile.png')).toString('base64')}`;

const secret = process.env.JWT_SECRET;
const users = {
  1: { id: 1, rol: 'cliente', aprobado: true },
  2: { id: 2, rol: 'barbero', aprobado: true },
};
const token = id => jwt.sign({ id, rol: 'admin' }, secret, { expiresIn: '1h' });
const headers = id => ({ Authorization: `Bearer ${token(id)}`, 'Content-Type': 'application/json' });

const originals = {
  userFindUnique: prisma.user.findUnique,
  profileFindUnique: prisma.barberProfile.findUnique,
  profileUpdate: prisma.barberProfile.update,
  citaFindUnique: prisma.cita.findUnique,
  citaUpdateMany: prisma.cita.updateMany,
  citaCreate: prisma.cita.create,
  citaFindMany: prisma.cita.findMany,
  transaction: prisma.$transaction,
  queryRaw: prisma.$queryRaw,
  serviceFindUnique: prisma.service.findUnique,
};

let server;
let base;
let requiresProof = true;
let lastProfileUpdate;
let lastAppointmentUpdate;

before(async () => {
  prisma.$transaction = async action => action(prisma);
  prisma.$queryRaw = async () => [{ id: 10 }];
  prisma.agendaBloqueo.findFirst = async () => null;
  prisma.user.findUnique = async ({ where }) => users[where.id] || null;
  prisma.barberProfile.findUnique = async ({ where }) =>
    where.usuarioId === 2 || where.id === 10 ? { id: 10, usuarioId: 2, requiereComprobante: requiresProof, usuario: { id: 2, rol: 'barbero', aprobado: true, activo: true } } : null;
  prisma.barberProfile.update = async args => {
    lastProfileUpdate = args;
    requiresProof = args.data.requiereComprobante;
    return { id: 10, requiereComprobante: requiresProof };
  };
  prisma.cita.findUnique = async () => ({
    id: 'slot-1',
    barberoId: 10,
    estado: 'disponible',
    fecha_hora: new Date(Date.now() + 60 * 60 * 1000),
    disponibleHasta: new Date(Date.now() + 120 * 60 * 1000),
    barbero: { requiereComprobante: requiresProof, usuario: { rol: 'barbero', aprobado: true } },
  });
  prisma.cita.updateMany = async args => {
    lastAppointmentUpdate = args;
    return { count: 1 };
  };
  prisma.cita.create = async args => { lastAppointmentUpdate = args; return { id: 'booking-1', ...args.data }; };
  prisma.cita.findMany = async ({ where }) => where.estado === 'disponible'
    ? [{ fecha_hora: new Date(Date.now()), disponibleHasta: new Date(Date.now() + 180 * 60 * 1000) }]
    : [];
  prisma.service.findUnique = async () => ({ id: 'service-1', perfilBarberoId: 10, duracion_minutos: 30, nombre_servicio: 'Corte', precio: 10000, activo: true });

  const app = express();
  app.use(express.json({ limit: '6mb' }));
  app.use('/api/auth', authRouter);
  app.use('/api/citas', citasRouter);
  server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  requiresProof = true;
  lastProfileUpdate = null;
  lastAppointmentUpdate = null;
});

after(async () => {
  prisma.user.findUnique = originals.userFindUnique;
  prisma.barberProfile.findUnique = originals.profileFindUnique;
  prisma.barberProfile.update = originals.profileUpdate;
  prisma.cita.findUnique = originals.citaFindUnique;
  prisma.cita.updateMany = originals.citaUpdateMany;
  prisma.cita.create = originals.citaCreate;
  prisma.cita.findMany = originals.citaFindMany;
  prisma.$transaction = originals.transaction;
  prisma.$queryRaw = originals.queryRaw;
  prisma.service.findUnique = originals.serviceFindUnique;
  await new Promise(resolve => server.close(resolve));
  await prisma.$disconnect();
});

test('solo el barbero modifica su propia preferencia persistente', async () => {
  const clientResponse = await fetch(`${base}/api/auth/me/booking-settings`, {
    method: 'PUT', headers: headers(1), body: JSON.stringify({ requiereComprobante: false }),
  });
  assert.equal(clientResponse.status, 403);

  const invalidResponse = await fetch(`${base}/api/auth/me/booking-settings`, {
    method: 'PUT', headers: headers(2), body: JSON.stringify({ requiereComprobante: 'false' }),
  });
  assert.equal(invalidResponse.status, 400);

  const response = await fetch(`${base}/api/auth/me/booking-settings`, {
    method: 'PUT',
    headers: headers(2),
    body: JSON.stringify({ requiereComprobante: false, usuarioId: 999 }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: 10, requiereComprobante: false });
  assert.deepEqual(lastProfileUpdate.where, { id: 10 });
  assert.deepEqual(lastProfileUpdate.data, { requiereComprobante: false });
});

test('rechaza una reserva sin archivo cuando el barbero exige comprobante', async () => {
  requiresProof = true;
  const response = await fetch(`${base}/api/citas/slot-1/agendar`, {
    method: 'PATCH', headers: headers(1), body: JSON.stringify({ servicioId: 'service-1' }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /requiere un comprobante/i);
  assert.equal(lastAppointmentUpdate, null);
});

test('permite reservar sin archivo cuando el barbero desactiva el comprobante', async () => {
  requiresProof = false;
  const response = await fetch(`${base}/api/citas/slot-1/agendar`, {
    method: 'PATCH', headers: headers(1), body: JSON.stringify({ servicioId: 'service-1' }),
  });
  assert.equal(response.status, 200);
  assert.equal(lastAppointmentUpdate.data.comprobanteTransferencia, null);
  assert.equal(lastAppointmentUpdate.data.comprobanteNombre, null);
  assert.equal(lastAppointmentUpdate.data.estado, 'confirmada');
});

test('las nuevas reservas respetan inmediatamente un cambio de configuración', async () => {
  const settingResponse = await fetch(`${base}/api/auth/me/booking-settings`, {
    method: 'PUT', headers: headers(2), body: JSON.stringify({ requiereComprobante: false }),
  });
  assert.equal(settingResponse.status, 200);

  const bookingResponse = await fetch(`${base}/api/citas/slot-1/agendar`, {
    method: 'PATCH', headers: headers(1), body: JSON.stringify({ servicioId: 'service-1' }),
  });
  assert.equal(bookingResponse.status, 200);
  assert.equal(lastAppointmentUpdate.data.comprobanteTransferencia, null);
});

test('mantiene la validación de formato para un comprobante opcional enviado', async () => {
  requiresProof = false;
  const response = await fetch(`${base}/api/citas/slot-1/agendar`, {
    method: 'PATCH',
    headers: headers(1),
    body: JSON.stringify({ servicioId: 'service-1', comprobanteTransferencia: 'archivo-invalido' }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /imagen o PDF válido/i);
  assert.equal(lastAppointmentUpdate, null);
});

test('conserva el flujo existente cuando se adjunta un comprobante válido', async () => {
  requiresProof = true;
  const response = await fetch(`${base}/api/citas/slot-1/agendar`, {
    method: 'PATCH',
    headers: headers(1),
    body: JSON.stringify({
      servicioId: 'service-1',
      comprobanteTransferencia: validPng,
      comprobanteNombre: 'pago.png',
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(lastAppointmentUpdate.data.comprobanteNombre, 'pago.png');
  assert.match(lastAppointmentUpdate.data.comprobanteTransferencia, /^data:image\/png;base64,/);
});

test('rechaza comprobantes con base64 fingido o contenido que no es imagen', async () => {
  for (const comprobanteTransferencia of [
    'data:image/png;base64,AA==',
    'data:image/png;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64'),
    'data:application/pdf;base64,' + Buffer.from('<html>no es PDF</html>').toString('base64'),
  ]) {
    const response = await fetch(`${base}/api/citas/slot-1/agendar`, {
      method: 'PATCH', headers: headers(1),
      body: JSON.stringify({ servicioId: 'service-1', comprobanteTransferencia }),
    });
    assert.equal(response.status, 400);
    assert.equal(lastAppointmentUpdate, null);
  }
});
