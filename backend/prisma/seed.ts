import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('123456', 10);

  const cliente = await prisma.user.upsert({
    where: { email: 'cliente@demo.com' },
    update: {
      nombre: 'Cliente Demo',
      password: passwordHash,
      telefono: '555111111',
      rol: UserRole.cliente,
    },
    create: {
      nombre: 'Cliente Demo',
      email: 'cliente@demo.com',
      password: passwordHash,
      telefono: '555111111',
      rol: UserRole.cliente,
    },
  });

  const barbero = await prisma.user.upsert({
    where: { email: 'barbero@demo.com' },
    update: {
      nombre: 'Barbero Demo',
      password: passwordHash,
      telefono: '555222222',
      rol: UserRole.barbero,
    },
    create: {
      nombre: 'Barbero Demo',
      email: 'barbero@demo.com',
      password: passwordHash,
      telefono: '555222222',
      rol: UserRole.barbero,
    },
  });

  await prisma.barberProfile.upsert({
    where: { usuarioId: barbero.id },
    update: {
      nombre_barberia: 'Barberia Demo',
      biografia: 'Perfil creado por seed',
      direccion: 'Calle Principal 123',
      foto_perfil: null,
    },
    create: {
      usuarioId: barbero.id,
      nombre_barberia: 'Barberia Demo',
      biografia: 'Perfil creado por seed',
      direccion: 'Calle Principal 123',
      foto_perfil: null,
    },
  });

  const admin = await prisma.user.upsert({
    where: { email: 'admin@demo.com' },
    update: {
      nombre: 'Admin Demo',
      password: passwordHash,
      telefono: '555333333',
      rol: UserRole.admin,
    },
    create: {
      nombre: 'Admin Demo',
      email: 'admin@demo.com',
      password: passwordHash,
      telefono: '555333333',
      rol: UserRole.admin,
    },
  });

  console.log('Seed completado');
  console.log({
    cliente: { email: cliente.email, rol: cliente.rol },
    barbero: { email: barbero.email, rol: barbero.rol },
    admin: { email: admin.email, rol: admin.rol },
    password: '123456',
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
