require('ts-node/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { availabilitySnapshot, configurationValidation } = require('../src/services/availability');

for (const minutes of [undefined, 30, 45, 60]) {
  test(`agenda: duración ${minutes ?? 'inicial 60'} sin escribir datos`, async () => {
    const configuration = { startTime: '09:00', endTime: '19:00', blockMinutes: minutes ?? 60 };
    const week = minutes === undefined ? null : { configuracion: configuration };
    const tx = {
      agendaSemana: { findUnique: async () => week },
      cita: { findMany: async () => [] },
      agendaBloqueo: { findMany: async () => [] },
    };
    const snapshot = await availabilitySnapshot(tx, 10, new Date('2035-01-15'), new Date('2035-01-22'));
    assert.deepEqual(snapshot.configuracion, configuration);
    assert.equal(snapshot.publicada, minutes !== undefined);
    assert.equal(configurationValidation.validate(configuration).error, undefined);
    if (week) assert.equal(snapshot.configuracion, week.configuracion);
  });
}
