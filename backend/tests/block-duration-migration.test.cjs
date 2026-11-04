require('./security-env.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const url = process.env.SCHEDULE_TEST_DATABASE_URL;
if (url && !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw Error('Only local tests allowed');
if (url && new URL(url).pathname !== '/schedule_tests') throw Error('Only schedule_tests allowed');

test('transición conserva horarios, precios, servicios y snapshots; archiva duración legada', { skip: !url }, async () => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const suffix = `${Date.now()}-${process.pid}`;
  try {
    const owner = await prisma.user.create({ data: { nombre: 'Migración prueba', email: `migration-${suffix}@test.invalid`, password: 'unused', rol: 'barbero', aprobado: true } });
    const profile = await prisma.barberProfile.create({ data: { usuarioId: owner.id } });
    const serviceId = `migration-service-${suffix}`;
    await prisma.$executeRaw`INSERT INTO "Service" (id, "perfilBarberoId", nombre_servicio, precio, duracion_minutos)
      VALUES (${serviceId}, ${profile.id}, 'Servicio legado', 12000, 60)`;
    const data = { barberoId: profile.id, servicioId: serviceId, fecha_hora: new Date('2035-01-15T13:00:00Z'), estado: 'confirmada' };
    const legacy = await prisma.cita.create({ data });
    const frozen = await prisma.cita.create({ data: { ...data, fecha_hora: new Date('2035-01-16T13:00:00Z'), duracionReservada: 45, nombreServicioReservado: 'Nombre histórico', precioReservado: 11000 } });
    const unknown = await prisma.cita.create({ data: { barberoId: profile.id, fecha_hora: new Date('2035-01-17T13:00:00Z'), estado: 'cancelada' } });
    const sql = fs.readFileSync(require('node:path').join(__dirname, '../prisma/migrations/20261104000000_block_reservation_duration/migration.sql'), 'utf8');
    // Execute the exact migration statements in one isolated transaction.
    const statements = sql.replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(s => s && !['BEGIN', 'COMMIT'].includes(s));
    await prisma.$transaction(async tx => { for (const statement of statements) await tx.$executeRawUnsafe(statement); });
    assert.deepEqual(await prisma.cita.findUnique({ where: { id: legacy.id } }), { ...legacy, duracionReservada: 60 });
    assert.deepEqual(await prisma.cita.findUnique({ where: { id: frozen.id } }), frozen);
    assert.deepEqual(await prisma.cita.findUnique({ where: { id: unknown.id } }), unknown);
    const [archive] = await prisma.$queryRaw`SELECT nombre_servicio, precio, duracion_minutos FROM "Service" WHERE id = ${serviceId}`;
    assert.deepEqual(archive, { nombre_servicio: 'Servicio legado', precio: 12000, duracion_minutos: 60 });
    const service = await prisma.service.create({ data: { perfilBarberoId: profile.id, nombre_servicio: 'Servicio sin duración', precio: 12000 } });
    assert.equal('duracion_minutos' in service, false);
    assert.equal('duracionLegadaMinutos' in service, false);
  } finally { await prisma.$disconnect(); }
});
