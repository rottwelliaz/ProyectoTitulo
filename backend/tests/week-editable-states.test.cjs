require('./security-env.cjs');
require('ts-node/register');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const prisma = require('../src/config/prisma').default;
const { saveWeekAvailability } = require('../src/controllers/citas');
const { weekAvailabilityValidation, availabilitySnapshot } = require('../src/services/availability');
const { slotInstant } = require('../src/services/businessTime');

const at = minutes => slotInstant('2035-01-15', `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`).toISOString();
const payload = minutes => ({
  fechaInicio: '2035-01-15', revision: 'loaded-week', conservarReservas: false,
  configuracion: { startTime: '09:00', endTime: '13:00', blockMinutes: minutes },
  bloques: [{ inicio: at(540), fin: at(540 + minutes) }],
  bloqueos: [
    { inicio: at(540 + minutes), fin: at(540 + minutes * 2), tipo: 'bloqueado' },
    { inicio: at(540 + minutes * 2), fin: at(540 + minutes * 3), tipo: 'descanso' },
  ],
});
after(() => prisma.$disconnect());

for (const minutes of [30, 45, 60]) test(`acepta únicamente las colecciones de estados editables, bloques de ${minutes}`, () => {
  assert.equal(weekAvailabilityValidation.validate(payload(minutes)).error, undefined);
  // Legacy empty/sparse weeks and the optional block collection remain compatible.
  assert.equal(weekAvailabilityValidation.validate({ ...payload(minutes), bloques: [], bloqueos: [] }).error, undefined);
  const withoutBlocks = payload(minutes); delete withoutBlocks.bloqueos;
  assert.equal(weekAvailabilityValidation.validate(withoutBlocks).error, undefined);
});

test('HTTP: rechaza estados manipulados antes de consultar o escribir la base de datos', async () => {
  const original = prisma.barberProfile.findUnique;
  let databaseCalls = 0;
  prisma.barberProfile.findUnique = async () => { databaseCalls++; throw Error('Unexpected database access'); };
  const app = express(); app.use(express.json());
  app.put('/semana', (req, res) => { req.user = { id: 2, rol: 'barbero' }; return saveWeekAvailability(req, res); });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    for (const minutes of [30, 45, 60]) for (const status of ['unconfigured', 'Sin configurar', 'reserved', 'invalid']) {
      const valid = payload(minutes), window = valid.bloques[0], block = valid.bloqueos[0];
      for (const body of [
        { ...valid, status }, { ...valid, estado: status },
        { ...valid, bloques: [{ ...window, status }] },
        { ...valid, bloques: [{ ...window, estado: status }] },
        { ...valid, bloques: [{ ...window, tipo: status }] },
        { ...valid, bloqueos: [{ ...block, tipo: status }] },
        { ...valid, bloqueos: [{ ...block, status }] },
        { ...valid, bloqueos: [{ ...block, estado: status }] },
      ]) {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/semana`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        assert.equal(response.status, 400, JSON.stringify(body));
        assert.match((await response.json()).message, /sin estados ni campos adicionales/);
      }
    }
    assert.equal(databaseCalls, 0);
  } finally {
    prisma.barberProfile.findUnique = original;
    await new Promise(resolve => server.close(resolve));
  }
});

test('leer una semana antigua con huecos conserva configuración, bloqueos y citas sin escrituras', async () => {
  const week = { configuracion: payload(45).configuracion, revision: 7 };
  const appointments = [{ id: 'confirmed', estado: 'confirmada', fecha_hora: at(540), duracionReservada: 45 }];
  const blocks = [{ inicio: at(600), fin: at(630), tipo: 'descanso', origen: 'agenda' }];
  const before = JSON.stringify({ week, appointments, blocks });
  // Only read methods exist; any write would fail this compatibility check.
  const tx = {
    agendaSemana: { findUnique: async () => week },
    cita: { findMany: async () => appointments },
    agendaBloqueo: { findMany: async () => blocks },
  };
  const snapshot = await availabilitySnapshot(tx, 10, new Date(at(0)), new Date('2035-01-22T03:00:00Z'));
  assert.equal(snapshot.publicada, true);
  assert.deepEqual(snapshot.configuracion, week.configuracion);
  assert.equal(JSON.stringify({ week, appointments, blocks }), before);
});
