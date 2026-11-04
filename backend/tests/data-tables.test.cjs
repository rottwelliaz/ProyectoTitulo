require('./security-env.cjs');
require('ts-node/register');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const qs = require('qs');
const prisma = require('../src/config/prisma').default;
const { dataTableParams, dataTablePage } = require('../src/services/dataTables');
const { appointmentPage, userPage, pendingWhere } = require('../src/services/paginatedLists');
const { getClientAppointments, getMyAppointments } = require('../src/controllers/citas');
const { getServices } = require('../src/controllers/servicios');
const { getAdminDashboard, getPendingBarbers } = require('../src/controllers/usuarios');

const originalTransaction = prisma.$transaction;
const originalProfile = prisma.barberProfile.findUnique;
const originalServices = prisma.service.findMany;
after(async () => { prisma.$transaction = originalTransaction; prisma.barberProfile.findUnique = originalProfile; prisma.service.findMany = originalServices; await prisma.$disconnect(); });
const req = (query = '', role = 'cliente') => ({ user: { id: 17, rol: role }, query: qs.parse('datatable=1&' + query) });
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const params = query => dataTableParams(req(query), { fecha_hora: { fecha_hora: 'desc' }, nombre: { nombre: 'asc' } }, 'fecha_hora');

function database(total = 35, filtered = total) {
  const calls = [];
  const delegate = {
    async count(query) { calls.push(['count', query]); return calls.filter(([name]) => name === 'count').length === 1 ? total : filtered; },
    async findMany(query) {
      calls.push(['rows', query]);
      return Array.from({ length: Math.min(query.take, filtered - query.skip) }, (_, i) => ({ id: query.skip + i, nombreServicioReservado: 'Corte histórico', precioReservado: 10000, duracionReservada: 30, servicioId: 's1' }));
    },
  };
  prisma.$transaction = async (operation, options) => {
    assert.equal(options.isolationLevel, 'RepeatableRead');
    return operation({ cita: delegate, service: delegate, user: delegate });
  };
  return calls;
}

test('protocolo: valida enteros, límites, búsqueda y campos de orden permitidos', () => {
  assert.equal(params('').length, 10);
  assert.equal(params('draw=8&start=20&length=25').draw, 8);
  assert.equal(params('length=50').length, 50);
  assert.deepEqual(params('order[0][name]=nombre&order[0][dir]=asc').orderBy, [{ nombre: 'asc' }, { id: 'asc' }]);
  for (const query of ['start=-1', 'start=1.5', 'start[]=10', 'start=9007199254740992', 'length=-1', 'length=1000', 'length=0', 'length=11', 'draw=<script>', 'order[0][name]=password', 'order[0][name]=__proto__', 'order[0][dir]=DROP', 'order[0][dir][]=asc', 'order[0][name][]=nombre', 'search[value][contains]=x', 'search[value]=' + 'x'.repeat(151)]) {
    assert.throws(() => params(query), error => error.status === 400, query);
  }
});

for (const total of [0, 7, 10, 11, 35]) test(`Prisma: ${total} registros, todas las páginas accesibles y sin duplicados`, async () => {
  const ids = [];
  for (let start = 0; start < Math.max(total, 1); start += 10) {
    const calls = database(total);
    const page = await userPage(req('start=' + start), { rol: 'cliente' });
    assert.equal(page.recordsTotal, total); assert.equal(page.recordsFiltered, total); assert.equal(page.start, start);
    assert.equal(page.data.length, Math.min(10, total - start)); ids.push(...page.data.map(row => row.id));
    assert.equal(calls.length, total ? 2 : 1); // One count, one bounded read; empty lists need no read.
    if (total) { assert.equal(calls[1][1].take, 10); assert.equal(calls[1][1].skip, start); }
  }
  assert.equal(new Set(ids).size, total);
});

test('búsqueda y orden se aplican antes de take/skip, con total original y filtrado', async () => {
  const calls = database(35, 11);
  const page = await userPage(req('start=10&search[value]=Ana&order[0][name]=email&order[0][dir]=asc'), { rol: 'cliente' });
  assert.equal(page.recordsTotal, 35); assert.equal(page.recordsFiltered, 11); assert.equal(page.data.length, 1);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1][1].where.AND[0], { rol: 'cliente' });
  assert.deepEqual(calls[1][1].where.AND[1].OR[0], { nombre: { contains: 'Ana', mode: 'insensitive' } });
  assert.deepEqual(calls[2][1].orderBy, [{ email: 'asc' }, { id: 'asc' }]);
  assert.equal(calls[2][1].select.password, undefined);
  assert.equal(calls[2][1].select.perfilBarbero.select.servicios.take, undefined);
});

test('último registro eliminado: devuelve página anterior en la misma consulta', async () => {
  const calls = database(10);
  const page = await userPage(req('start=10'), { rol: 'cliente' });
  assert.equal(page.start, 0); assert.equal(page.data.length, 10); assert.equal(calls[1][1].skip, 0); assert.equal(calls.length, 2);
  database(0); const empty = await userPage(req('start=30'), {}); assert.equal(empty.start, 0);
});

test('cliente: datos y ambos contadores siempre limitados al usuario autenticado', async () => {
  const calls = database(); const res = response();
  await getClientAppointments(req('clienteId=999&barberoId=999&search[value]=Corte'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls[0][1].where.clienteId, 17);
  assert.equal(calls[1][1].where.AND[0].clienteId, 17);
  assert.equal(calls[2][1].where.AND[0].clienteId, 17);
  assert.equal(res.body.data[0].servicio.nombre_servicio, 'Corte histórico');
});

test('cliente: todas incluye anteriores; historial y próximas conservan el propietario en filas y totales', async () => {
  let calls = database();
  await appointmentPage(req(''), { clienteId: 17 }, true);
  assert.equal(calls[0][1].where.AND, undefined);
  for (const vista of ['historial', 'proximas']) {
    calls = database(20, 11);
    const result = await appointmentPage(req(`vista=${vista}&start=10&search[value]=Corte`), { clienteId: 17 }, true);
    assert.equal(result.recordsTotal, 20); assert.equal(result.recordsFiltered, 11); assert.equal(result.data.length, 1);
    const owner = calls[0][1].where;
    assert.equal(owner.clienteId, 17);
    assert.deepEqual(calls[1][1].where.AND[0], owner);
    assert.deepEqual(calls[2][1].where.AND[0], owner);
    if (vista === 'historial') assert.ok(owner.AND[0].OR[0].fecha_hora.lt instanceof Date);
    else assert.ok(owner.AND[0].NOT.OR[0].fecha_hora.lt instanceof Date);
  }
  await assert.rejects(() => appointmentPage(req('vista=otra'), { clienteId: 17 }, true), error => error.status === 400);
  await assert.rejects(() => appointmentPage(req('vista[]=historial'), { clienteId: 17 }, true), error => error.status === 400);
});

test('barbero: propietario del perfil y categorías no aceptan ids externos', async () => {
  prisma.barberProfile.findUnique = async query => { assert.deepEqual(query.where, { usuarioId: 17 }); return { id: 5 }; };
  let calls = database(); const res = response();
  await getMyAppointments(req('vista=historial&barberoId=999', 'barbero'), res);
  assert.equal(res.statusCode, 200); assert.equal(calls[0][1].where.barberoId, 5);
  assert.ok(calls[0][1].where.AND[0].OR);
  calls = database(); await appointmentPage(req('vista=reservas', 'barbero'), { barberoId: 5 }, false);
  assert.ok(calls[0][1].where.AND[0].NOT.OR);
});

test('administración: roles y pendientes se filtran en Prisma; solicitudes resueltas excluidas', async () => {
  for (const [table, rol] of [['clientes', 'cliente'], ['barberos', 'barbero'], ['admins', 'admin']]) {
    const calls = database(); const res = response(); await getAdminDashboard(req('table=' + table, 'admin'), res);
    assert.equal(res.statusCode, 200); assert.equal(calls[0][1].where.rol, rol);
  }
  const calls = database(); const res = response(); await getPendingBarbers(req('', 'admin'), res);
  assert.deepEqual(calls[0][1].where, pendingWhere);
  assert.equal(calls[0][1].where.solicitudProfesional.is.estado, 'pendiente');
});

test('servicios devuelve el listado completo y conserva el acceso al perfil propio', async () => {
  const rows = Array.from({ length: 35 }, (_, id) => ({ id: String(id), nombre_servicio: 'Corte' }));
  const calls = [];
  prisma.service.findMany = async query => { calls.push(query); return rows; };
  prisma.barberProfile.findUnique = async query => { assert.deepEqual(query.where, { usuarioId: 17 }); return { id: 5 }; };
  for (const role of ['admin', 'barbero']) {
    const res = response(); await getServices(req('start=30&length=10&perfilBarberoId=999', role), res);
    assert.equal(res.statusCode, 200); assert.deepEqual(res.body, rows);
    const query = calls.at(-1); assert.equal(query.skip, undefined); assert.equal(query.take, undefined);
    if (role === 'barbero') assert.deepEqual(query.where, { perfilBarberoId: 5 });
  }
});

test('errores de parámetros devuelven HTTP 400, sin ejecutar consultas de listado', async () => {
  const calls = database(); const res = response();
  await getClientAppointments(req('length=1000'), res); assert.equal(res.statusCode, 400); assert.equal(calls.length, 0);
  const invalid = response(); await getAdminDashboard(req('table=password', 'admin'), invalid); assert.equal(invalid.statusCode, 400);
  const array = response(); await getAdminDashboard(req('table[]=clientes', 'admin'), array); assert.equal(array.statusCode, 400);
  await assert.rejects(() => appointmentPage(req('vista[]=historial'), { barberoId: 5 }, false), error => error.status === 400);
});

test('contrato genérico omite conteo adicional cuando no hay búsqueda', async () => {
  const calls = database();
  await dataTablePage(params(''), { count: tx => tx.user.count({}), rows: (tx, skip, take) => tx.user.findMany({ skip, take }) });
  assert.equal(calls.filter(([type]) => type === 'count').length, 1);
});
