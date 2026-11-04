require('./security-env.cjs');
require('ts-node/register');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/config/prisma').default;
const { getDisponibilidad } = require('../src/controllers/citas');
const { slotInstant } = require('../src/services/businessTime');

const originals = [];
const stub = (target, key, implementation) => {
  const original = target[key];
  originals.push(() => { target[key] = original; });
  target[key] = implementation;
};
after(async () => { originals.reverse().forEach(restore => restore()); await prisma.$disconnect(); });

test('consulta semanal sin servicio conserva los mismos bloques y aislamiento por barbero', async () => {
  let minutes = 30;
  stub(prisma, '$transaction', async action => action(prisma));
  stub(prisma, '$queryRaw', async () => [{ id: 10 }]);
  stub(prisma.barberProfile, 'findUnique', async ({ where }) => ({ id: where.id, usuario: { rol: 'barbero', aprobado: true, activo: true } }));
  stub(prisma.service, 'findMany', async ({ where }) => [{ id: `cut-${where.perfilBarberoId}`, nombre_servicio: 'Corte', precio: 10000 }]);
  stub(prisma.agendaSemana, 'findUnique', async () => ({ configuracion: { startTime: '09:00', endTime: '12:00', blockMinutes: minutes } }));
  stub(prisma.agendaBloqueo, 'findMany', async ({ where }) => {
    assert.ok([10, 20].includes(where.barberoId));
    return [];
  });
  stub(prisma.cita, 'findMany', async ({ where }) => {
    assert.ok([10, 20].includes(where.barberoId));
    return where.estado === 'disponible' ? [{ id: `window-${where.barberoId}`, fecha_hora: slotInstant('2035-01-15', '09:00'), disponibleHasta: slotInstant('2035-01-15', '12:00') }] : [];
  });
  const request = async (barberId, serviceId) => {
    const response = { statusCode: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; },
      status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await getDisponibilidad({ params: { barberoId: String(barberId) }, query: { fecha: '2035-01-15', vista: 'semana', ...(serviceId ? { servicioId: serviceId } : {}) } }, response);
    return response;
  };
  for (minutes of [30, 45, 60]) {
    const before = await request(10);
    const selected = await request(10, 'cut-10');
    assert.equal(before.statusCode, 200, JSON.stringify(before.body));
    assert.equal(before.headers['Cache-Control'], 'no-store');
    assert.deepEqual(before.body.citas, selected.body.citas);
    assert.equal(before.body.calendario.configuracion.blockMinutes, minutes);
    const last = before.body.citas.at(-1);
    assert.equal(+new Date(last.disponibleHasta), +slotInstant('2035-01-15', '12:00'));
    for (const slot of before.body.citas) assert.equal(+new Date(slot.disponibleHasta) - +new Date(slot.fecha_hora), minutes * 60000);
    const other = await request(20);
    assert.equal(other.statusCode, 200);
    assert.ok(other.body.citas.every(slot => (slot.slotId || slot.id) === 'window-20'));
    assert.equal((await request(10, 'cut-20')).statusCode, 404);
  }
});
