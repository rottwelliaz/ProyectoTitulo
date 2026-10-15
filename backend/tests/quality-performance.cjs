// Sequential local pilot sample, no production URL and no concurrent load.
require('./security-env.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../quality-artifacts/database.local.json')));
const url = new URL(config.url);
if (!['localhost', '127.0.0.1'].includes(url.hostname) || !/^\/g6_quality_\d+$/.test(url.pathname)) throw Error('Only the isolated quality database is allowed');
process.env.DATABASE_URL = url.href;
require('ts-node/register');
const { PrismaClient } = require('@prisma/client'), express = require('express'), bcrypt = require('bcryptjs');
const prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
require.cache[require.resolve('../src/config/prisma')] = { id: require.resolve('../src/config/prisma'), filename: require.resolve('../src/config/prisma'), loaded: true, exports: { __esModule: true, default: prisma, prisma } };
let queries = [];
prisma.$on('query', event => queries.push({ sql: event.query, ms: event.duration }));
async function main() {
  const password = 'Quality test password 2030';
  const hash = await bcrypt.hash(password, 10);
  let customer = await prisma.user.findUnique({ where: { email: 'quality-client@test.invalid' } });
  if (!customer) {
    customer = await prisma.user.create({ data: { nombre: 'Cliente de prueba', email: 'quality-client@test.invalid', password: hash } });
    for (let i = 0; i < 12; i++) {
      const barber = await prisma.user.create({ data: { nombre: `Barbero de prueba ${i}`, email: `quality-barber-${i}@test.invalid`, password: hash, rol: 'barbero', perfilBarbero: { create: { requiereComprobante: false, lugarTrabajo: { create: { nombre_barberia: 'Local de prueba', direccion: 'Dirección ficticia' } }, servicios: { create: { nombre_servicio: 'Corte de prueba', precio: 10000, duracion_minutos: 30 } } } } }, include: { perfilBarbero: { include: { servicios: true } } } });
      const profile = barber.perfilBarbero;
      await prisma.cita.createMany({ data: Array.from({ length: 100 }, (_, j) => ({ barberoId: profile.id, clienteId: customer.id, servicioId: profile.servicios[0].id, fecha_hora: new Date(Date.UTC(2025, 0, 1 + j, 15)), duracionReservada: 30, nombreServicioReservado: 'Corte histórico', precioReservado: 10000, estado: 'finalizada' })) });
      await prisma.cita.createMany({ data: Array.from({ length: 20 }, (_, j) => ({ barberoId: profile.id, fecha_hora: new Date(Date.UTC(2035, 0, 15, 12, j * 30)), disponibleHasta: new Date(Date.UTC(2035, 0, 15, 12, (j + 1) * 30)) })) });
    }
  }
  const profile = await prisma.barberProfile.findFirst({ include: { servicios: true, usuario: true }, orderBy: { id: 'asc' } });
  const app = express(); app.use(express.json({ limit: '6mb' }));
  for (const route of ['auth', 'usuarios', 'citas', 'servicios', 'profesional']) app.use('/api/' + route, require('../src/routes/' + route).default);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const measurements = {};
  async function request(name, route, { token, method = 'GET', body } = {}) {
    queries = []; const start = performance.now();
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text(), ms = performance.now() - start;
    assert.ok(response.ok, `${name}: HTTP ${response.status}: ${text.slice(0, 180)}`);
    (measurements[name] ??= []).push({ ms, bytes: Buffer.byteLength(text), status: response.status, sqlCount: queries.length, sqlMs: queries.reduce((a,q) => a+q.ms, 0) });
    return JSON.parse(text);
  }
  try {
    let token;
    for (let i = 0; i < 10; i++) token = (await request('Autenticación', '/auth/login', { method: 'POST', body: { email: customer.email, password } })).token;
    for (let i = 0; i < 10; i++) {
      await request('Catálogo', '/usuarios?rol=barbero');
      await request('Perfil público', `/usuarios/barberos/${profile.id}/perfil`);
      await request('Perfil propio', '/auth/me', { token });
      await request('Disponibilidad', `/citas/disponibilidad/${profile.id}?fecha=2035-01-15&servicioId=${profile.servicios[0].id}`, { token });
      const slot = await prisma.cita.create({ data: { barberoId: profile.id, fecha_hora: new Date(Date.UTC(2036, 0, 1 + i, 15)), disponibleHasta: new Date(Date.UTC(2036, 0, 1 + i, 16)) } });
      // Repeated benchmark runs use fresh dates/slots, with a separate barber to avoid collisions.
      const existing = await prisma.cita.count({ where: { barberoId: profile.id, clienteId: customer.id, fecha_hora: slot.fecha_hora } });
      if (existing) { await prisma.cita.update({ where: { id: slot.id }, data: { fecha_hora: new Date(+slot.fecha_hora + existing * 86400000 * 365), disponibleHasta: new Date(+slot.disponibleHasta + existing * 86400000 * 365) } }); }
      await request('Crear reserva', `/citas/${slot.id}/agendar`, { token, method: 'PATCH', body: { servicioId: profile.servicios[0].id } });
      await request('Consultar reservas', '/citas/cliente/mias', { token });
    }
    const summary = Object.fromEntries(Object.entries(measurements).map(([key, rows]) => { const ordered = rows.map(r => r.ms).sort((a,b) => a-b); return [key, { n: rows.length, coldMs: rows[0].ms, medianMs: ordered[Math.floor(ordered.length/2)], p95Ms: ordered[Math.ceil(ordered.length*.95)-1], maxMs: Math.max(...ordered), maxBytes: Math.max(...rows.map(r=>r.bytes)), maxSqlQueries: Math.max(...rows.map(r=>r.sqlCount)), under3Seconds: rows.every(r=>r.ms<3000) }]; }));
    const plans = await prisma.$queryRawUnsafe('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM "Cita" WHERE "clienteId" = $1 ORDER BY fecha_hora', customer.id);
    const output = { environment: { node: process.version, database: url.pathname, barbers: 12, historicalReservations: 1200, availabilityWindows: 240, sequential: true, transport: 'HTTP loopback, Express routes + auth middleware + Prisma + PostgreSQL; no TLS/proxy' }, summary, measurements, plans };
    const file = path.resolve(__dirname, '../../quality-artifacts/performance-' + (process.env.QUALITY_RUN || 'baseline') + '.json');
    fs.writeFileSync(file, JSON.stringify(output, null, 2)); console.log(JSON.stringify(summary, null, 2));
  } finally { await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; prisma.$disconnect(); });
