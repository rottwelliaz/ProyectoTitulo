import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('El seed demo no está permitido en producción');
  const seedPassword = process.env.SEED_DEMO_PASSWORD;
  if (!seedPassword || seedPassword.trim().length < 12 || Buffer.byteLength(seedPassword) > 72) throw new Error('Configura SEED_DEMO_PASSWORD con 12 caracteres como mínimo y hasta 72 bytes');
  // Demo accounts must never be inserted into a database with existing app data.
  const [databaseState] = await prisma.$queryRaw<{ occupied: boolean }[]>`
    SELECT (
      EXISTS (SELECT 1 FROM "User") OR
      EXISTS (SELECT 1 FROM "BarberProfile") OR
      EXISTS (SELECT 1 FROM "LugarTrabajo") OR
      EXISTS (SELECT 1 FROM "Service") OR
      EXISTS (SELECT 1 FROM "Cita") OR
      EXISTS (SELECT 1 FROM "CitaCambioEstado") OR
      EXISTS (SELECT 1 FROM "Conversation") OR
      EXISTS (SELECT 1 FROM "Message") OR
      EXISTS (SELECT 1 FROM "SolicitudProfesional") OR
      EXISTS (SELECT 1 FROM "AgendaSemana") OR
      EXISTS (SELECT 1 FROM "AgendaBloqueo")
    ) AS occupied
  `;
  if (databaseState.occupied) throw new Error('El seed demo requiere una base sin datos; no se modificaron datos existentes');
  const passwordHash = await bcrypt.hash(seedPassword, 10);

  const cliente = await prisma.user.upsert({
    where: { email: 'cliente@demo.com' },
    update: {},
    create: {
      nombre: 'Cliente Demo',
      email: 'cliente@demo.com',
      password: passwordHash,
      telefono: '555111111',
      rol: UserRole.cliente,
      aprobado: true,
    },
  });

  const barbero = await prisma.user.upsert({
    where: { email: 'barbero@demo.com' },
    update: {},
    create: {
      nombre: 'Barbero Demo',
      email: 'barbero@demo.com',
      password: passwordHash,
      telefono: '555222222',
      rol: UserRole.barbero,
      aprobado: true,
    },
  });

  const lugarTrabajo =
    (await prisma.lugarTrabajo.findFirst({
      where: {
        nombre_barberia: 'Barberia Demo',
        direccion: 'Calle Principal 123',
      },
    })) ??
    (await prisma.lugarTrabajo.create({
      data: {
        nombre_barberia: 'Barberia Demo',
        direccion: 'Calle Principal 123',
      },
    }));

  await prisma.barberProfile.upsert({
    where: { usuarioId: barbero.id },
    update: {},
    create: {
      usuarioId: barbero.id,
      biografia: 'Perfil creado por seed',
      foto_perfil: null,
      lugarTrabajoId: lugarTrabajo.id,
    },
  });

  const admin = await prisma.user.upsert({
    where: { email: 'admin@demo.com' },
    update: {},
    create: {
      nombre: 'Admin Demo',
      email: 'admin@demo.com',
      password: passwordHash,
      telefono: '555333333',
      rol: UserRole.admin,
      aprobado: true,
    },
  });

  const admin1 = await prisma.user.upsert({
    where: { email: 'admin1@demo.com' },
    update: {},
    create: {
      nombre: 'Martin Palermo',
      email: 'admin1@demo.com',
      password: passwordHash,
      telefono: '945108855',
      rol: UserRole.admin,
      aprobado: true,
    },
  });

  console.log('Seed completado');
  console.log({
    cliente: { email: cliente.email, rol: cliente.rol },
    barbero: { email: barbero.email, rol: barbero.rol },
    admin: { email: admin.email, rol: admin.rol },
    admin1: { email: admin1.email, rol: admin1.rol },
  });
}

main()
  .catch((error) => {
    console.error('Seed error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
