require('ts-node/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateTransition, assertReservationAccess, historicalAppointment } = require('../src/services/reservationLifecycle');
const now = new Date('2030-01-01T15:00:00Z');
const appointment = (estado, minutes = 60) => ({ estado, fecha_hora: new Date(+now + minutes * 60000), duracionReservada: 30, servicio: null });
const actor = rol => ({ id: 1, rol });

test('matriz completa de estados y roles: estados terminales no se reabren', () => {
  const states = ['disponible', 'pendiente', 'confirmada', 'cancelada', 'rechazada', 'finalizada', 'inasistencia'];
  for (const rol of ['cliente', 'barbero', 'admin', 'invalido']) {
    for (const from of states) for (const to of states) {
      const allowed = rol === 'cliente' ? to === 'cancelada' && ['pendiente', 'confirmada'].includes(from)
        : ['barbero', 'admin'].includes(rol) && (from === 'pendiente' && ['confirmada', 'rechazada', 'cancelada'].includes(to) || from === 'confirmada' && to === 'cancelada');
      const action = () => validateTransition(appointment(from), to, actor(rol), now);
      if (allowed) assert.doesNotThrow(action, `${rol}: ${from} -> ${to}`);
      else assert.throws(action, undefined, `${rol}: ${from} -> ${to}`);
    }
  }
});

test('ningún rol cancela citas pasadas o iniciadas; solo responsables finalizan al terminar', () => {
  for (const rol of ['cliente', 'barbero', 'admin']) {
    for (const minutes of [-60, 0]) assert.throws(() => validateTransition(appointment('confirmada', minutes), 'cancelada', actor(rol), now));
    for (const target of ['finalizada', 'inasistencia']) {
      for (const minutes of [60, 0, -29]) assert.throws(() => validateTransition(appointment('confirmada', minutes), target, actor(rol), now));
      const done = () => validateTransition(appointment('confirmada', -30), target, actor(rol), now);
      if (rol === 'cliente') assert.throws(done); else assert.doesNotThrow(done);
    }
  }
});

test('historial restringido al cliente, al profesional asignado y al administrador', () => {
  const cita = { clienteId: 10, barbero: { usuarioId: 20 } };
  for (const [id, rol] of [[10, 'cliente'], [20, 'barbero'], [30, 'admin']]) assert.doesNotThrow(() => assertReservationAccess(cita, { id, rol }));
  for (const [id, rol] of [[11, 'cliente'], [21, 'barbero'], [10, 'barbero'], [20, 'cliente']]) assert.throws(() => assertReservationAccess(cita, { id, rol }));
});

test('la respuesta histórica nunca usa nombre, precio o duración del catálogo editado', () => {
  const stored = { nombreServicioReservado: 'Corte original', precioReservado: 10000, duracionReservada: 30, servicioId: 's', servicio: { nombre_servicio: 'Otro', precio: 50000, duracion_minutos: 60 } };
  assert.deepEqual(historicalAppointment(stored).servicio, { id: 's', nombre_servicio: 'Corte original', precio: 10000, duracion_minutos: 30 });
  assert.equal(historicalAppointment({ ...stored, nombreServicioReservado: null }).servicio, null);
});
