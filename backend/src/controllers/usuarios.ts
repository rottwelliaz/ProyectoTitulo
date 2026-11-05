import { isDataTable } from '../services/dataTables';
import { pendingWhere, userPage } from '../services/paginatedLists';
import { Request, Response } from 'express';
import type { UserRole } from '@prisma/client';
import prisma from '../config/prisma';
import bcrypt from 'bcryptjs';
import { AuthRequest } from '../middleware/auth';
import { createUserValidation, updateUserValidation } from '../validations/usuarios';
import { ScheduleError, scheduleFailure } from '../services/schedule';
import { resolveApplication } from './solicitudes';
import { professionalSelect } from '../services/professionalPrivacy';
import { reserveEmail } from '../services/accountEmail';
import { publicUserSelect } from '../services/publicProfile';
import { removeAccount } from '../services/removeAccount';

// Crear usuario
export const createUser = async (req: Request, res: Response) => {
  try {
    const { error, value } = createUserValidation.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const { nombre, email, password, telefono, rol } = value;
    const selectedRole = rol === 'barbero' ? 'barbero' : 'cliente';

    const hashed = await bcrypt.hash(password, 10);

    const user = await prisma.$transaction(async tx => {
      await reserveEmail(tx, email);
      return tx.user.create({
      data: {
        nombre,
        email,
        password: hashed,
        telefono: telefono || null,
        rol: selectedRole,
        aprobado: selectedRole !== 'barbero',
        ...(selectedRole === 'barbero' ? { solicitudProfesional: { create: {} } } : {}),
      },
      });
    });

    const { password: _p, ...safe } = user;

    return res.status(201).json(safe);
  } catch (error) {
    const known = scheduleFailure(error);
    if (known) return res.status(known.status).json({ message: known.message });
    if ((error as { code?: string }).code === 'P2002') return res.status(409).json({ message: 'El email ya está registrado' });
    console.error('createUser failed');
    return res.status(500).json({ message: 'Error al crear usuario' });
  }
};
// Obtener usuarios, opcionalmente filtrados por rol
export const getUsers = async (req: Request, res: Response) => {
  try {
    const rol = typeof req.query.rol === 'string' ? req.query.rol : undefined;
    const rolesPermitidos = ['cliente', 'barbero', 'admin'];

    if (rol && !rolesPermitidos.includes(rol)) {
      return res.status(400).json({ message: 'Rol inválido' });
    }

    const where =
      rol === 'barbero'
        ? { rol: rol as UserRole, aprobado: true, activo: true }
        : rol
          ? { rol: rol as UserRole }
          : undefined;

    const users = await prisma.user.findMany({
      where,
      select: rol === 'barbero' ? publicUserSelect : {
        id: true,
        nombre: true,
        email: true,
        telefono: true,
        rol: true,
        aprobado: true,
        activo: true,
        fecha_creacion: true,
        perfilBarbero: {
          select: {
            id: true,
            biografia: true,
            foto_perfil: true,
            lugarTrabajo: true,
            servicios: {
              where: { activo: true },
              orderBy: { nombre_servicio: 'asc' },
            },
          },
        },
      },
      orderBy: {
        nombre: 'asc',
      },
    });

    return res.json(users);
  } catch (error) {
    console.error('getUsers error', error);
    return res.status(500).json({ message: 'Error al obtener usuarios' });
  }
};

export const getPendingBarbers = async (req: AuthRequest, res: Response) => {
  try {
    if (isDataTable(req)) return res.json(await userPage(req, pendingWhere));
    return res.json(await prisma.user.findMany({ where: { rol: 'barbero', aprobado: false, solicitudProfesional: { is: { estado: 'pendiente' } } },
      select: { id: true, nombre: true, email: true, telefono: true, rol: true, aprobado: true, activo: true, fecha_creacion: true, solicitudProfesional: true },
      orderBy: { fecha_creacion: 'asc' } }));
  } catch (error) { const failure = scheduleFailure(error); return res.status(failure?.status ?? 500).json({ message: failure?.message ?? 'No se pudieron cargar las solicitudes' }); }
};
export const approveBarber = resolveApplication(true);
export const rejectBarber = resolveApplication(false);

export const getAdminDashboard = async (req: AuthRequest, res: Response) => {
  try {
    if (isDataTable(req)) {
      const table = req.query.table;
      if (typeof table !== 'string' || !['clientes', 'barberos', 'admins', 'pendientes'].includes(table)) throw new ScheduleError(400, 'Listado inválido');
      const where = table === 'pendientes' ? pendingWhere : { rol: ({ clientes: 'cliente', barberos: 'barbero', admins: 'admin' } as const)[table as 'clientes' | 'barberos' | 'admins'] };
      return res.json(await userPage(req, where));
    }
    if (req.query.summary === '1') {
      const [clients, barbers, admins, approved, pending] = await prisma.$transaction([
        prisma.user.count({ where: { rol: 'cliente' } }),
        prisma.user.count({ where: { rol: 'barbero' } }),
        prisma.user.count({ where: { rol: 'admin' } }),
        prisma.user.count({ where: { rol: 'barbero', aprobado: true } }),
        prisma.user.count({ where: pendingWhere }),
      ]);
      return res.json({ stats: { totalUsuarios: clients + barbers + admins, clientes: clients, barberos: barbers, admins, barberosAprobados: approved, barberosPendientes: pending } });
    }
    const users = await prisma.user.findMany({
      select: {
        id: true,
        nombre: true,
        email: true,
        telefono: true,
        rol: true,
        aprobado: true,
        activo: true,
        solicitudProfesional: true,
        fecha_creacion: true,
        perfilBarbero: {
          select: {
            id: true,
            biografia: true,
            foto_perfil: true,
            lugarTrabajo: {
              select: {
                id: true,
                nombre_barberia: true,
                direccion: true,
              },
            },
            servicios: {
              select: {
                id: true,
                nombre_servicio: true,
                precio: true,
              },
              orderBy: { nombre_servicio: 'asc' },
            },
            _count: {
              select: {
                citas: true,
                servicios: true,
              },
            },
          },
        },
        _count: {
          select: {
            citas: true,
          },
        },
      },
      orderBy: [
        { rol: 'asc' },
        { nombre: 'asc' },
      ],
    });

    const clientes = users.filter((user) => user.rol === 'cliente');
    const barberos = users.filter((user) => user.rol === 'barbero');
    const admins = users.filter((user) => user.rol === 'admin');
    const barberosPendientes = barberos.filter((user) => !user.aprobado && user.solicitudProfesional?.estado === 'pendiente');

    return res.json({
      stats: {
        totalUsuarios: users.length,
        clientes: clientes.length,
        barberos: barberos.length,
        barberosAprobados: barberos.filter((user) => user.aprobado).length,
        barberosPendientes: barberosPendientes.length,
        admins: admins.length,
      },
      clientes,
      barberos,
      admins,
      barberosPendientes,
    });
  } catch (error) {
    const failure = scheduleFailure(error);
    if (failure) return res.status(failure.status).json({ message: failure.message });
    console.error('getAdminDashboard error', error);
    return res.status(500).json({ message: 'Error al obtener dashboard admin' });
  }
};

// Administrative deletion removes the account and its owned data atomically.
export const deleteUser = async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ message: 'ID inválido' });
    }

    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(410022)`;
      // Booking locks the profile before the user; keep the same lock order.
      await tx.$queryRaw`SELECT "id" FROM "BarberProfile" WHERE "usuarioId" = ${id} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id } });
      if (!current) throw new ScheduleError(404, 'Usuario no encontrado');
      if (id === req.user!.id) throw new ScheduleError(409, 'No puedes eliminar tu propia cuenta administrativa');
      if (current.rol === 'admin' && current.activo && await tx.user.count({ where: { rol: 'admin', activo: true } }) <= 1) throw new ScheduleError(409, 'Debe permanecer al menos un administrador activo');
      await removeAccount(tx, id);
    }, { maxWait: 10_000, timeout: 20_000 });
    return res.status(204).send();
  } catch (error) {
    const known = scheduleFailure(error);
    if (known) return res.status(known.status).json({ message: known.message });
    console.error('deleteUser error', error);
    return res.status(500).json({ message: 'No se pudo eliminar la cuenta. No se realizó ningún cambio.' });
  }
};
export const updateUser = async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ message: 'ID inválido' });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    const { error, value } = updateUserValidation.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const { nombre, email, password, telefono, rol, aprobado, activo } = value;
    const rolesPermitidos = ['cliente', 'barbero', 'admin'];

    if (rol && !rolesPermitidos.includes(rol)) {
      return res.status(400).json({ message: 'Rol inválido' });
    }

    // Si viene nueva password, hashearla
    const hashedPassword = password
      ? await bcrypt.hash(password, 10)
      : undefined;

    const nextRole = rol || user.rol;
    const nextApproved =
      typeof aprobado === 'boolean'
        ? aprobado
        : nextRole === 'barbero'
          ? user.aprobado
          : true;

    const updated = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(410022)`;
      if (email && email !== user.email) await reserveEmail(tx, email, id);
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id }, include: { solicitudProfesional: true } });
      if (!current) throw new ScheduleError(404, 'Usuario no encontrado');
      if (current.rol !== user.rol || current.aprobado !== user.aprobado || current.activo !== user.activo) throw new ScheduleError(409, 'La cuenta cambió; actualiza el panel antes de editar');
      if (id === req.user!.id && (nextRole !== 'admin' || activo === false)) throw new ScheduleError(409, 'No puedes retirar tu propio acceso administrativo');
      if (current.rol === 'admin' && current.activo && (nextRole !== 'admin' || activo === false) && await tx.user.count({ where: { rol: 'admin', activo: true } }) <= 1) throw new ScheduleError(409, 'Debe permanecer al menos un administrador activo');
      // An admin may explicitly repair an old client-labelled application in the editor.
      // Approval/rejection themselves never convert client accounts.
      const repairPendingRole = current.rol === 'cliente' && current.solicitudProfesional?.estado === 'pendiente' && nextRole === 'barbero' && !nextApproved;
      if (current.solicitudProfesional?.estado === 'pendiente' && !repairPendingRole && (nextRole !== current.rol || nextApproved !== current.aprobado)) throw new ScheduleError(409, 'Resuelve la solicitud con Aprobar o Rechazar antes de cambiar el rol');
      if (nextRole === 'barbero' && !current.solicitudProfesional && (current.rol !== 'barbero' || !nextApproved)) {
        await tx.solicitudProfesional.create({ data: { usuarioId: id, estado: nextApproved ? 'aprobada' : 'pendiente',
          fechaResolucion: nextApproved ? new Date() : null, revisorId: nextApproved ? req.user!.id : null } });
      }
      return tx.user.update({
      where: { id },
      data: {
        nombre:   nombre   ?? undefined,
        email:    email    ?? undefined,
        password: hashedPassword,
        telefono: telefono === undefined ? undefined : telefono || null,
        rol:      rol      ?? undefined,
        aprobado: nextApproved,
        activo: activo ?? undefined,
        perfilBarbero:
          nextRole === 'barbero'
            ? {
                upsert: {
                  update: {},
                  create: {
                    biografia: 'Perfil creado por administrador',
                    foto_perfil: current.foto_perfil,
                  },
                },
              }
            : undefined,
      },
      include: {
        perfilBarbero: {
          select: {
            ...professionalSelect,
            lugarTrabajo: true,
          },
        },
      },
    });

    });
    const { password: _p, ...safe } = updated;
    return res.json(safe);
  } catch (error) {
    const known = scheduleFailure(error);
    if (known) return res.status(known.status).json({ message: known.message });
    if ((error as { code?: string }).code === 'P2002') return res.status(409).json({ message: 'El email ya está en uso' });
    console.error('updateUser failed');
    return res.status(500).json({ message: 'Error al editar usuario' });
  }
};
