import { Request, Response } from 'express';
import prisma from '../config/prisma';
import bcrypt from 'bcryptjs';
import { AuthRequest } from '../middleware/auth';
import { createUserValidation, updateUserValidation } from '../validations/usuarios';

// Crear usuario
export const createUser = async (req: Request, res: Response) => {
  try {
    const { error, value } = createUserValidation.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const { nombre, email, password, telefono, rol } = value;
    const selectedRole = rol === 'barbero' ? 'barbero' : 'cliente';

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ message: 'El email ya está registrado' });
    }

    const hashed = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        nombre,
        email,
        password: hashed,
        telefono: telefono || null,
        rol: selectedRole,
        aprobado: selectedRole === 'cliente',
      },
    });

    // No devolver password
    // @ts-ignore
    const { password: _p, ...safe } = user;

    return res.status(201).json(safe);
  } catch (error) {
    console.error('createUser error', error);
    return res.status(500).json({ message: 'Error al crear usuario' });
  }
};

// Obtener usuarios, opcionalmente filtrados por rol
export const getUsers = async (req: Request, res: Response) => {
  try {
    const rol = typeof req.query.rol === 'string' ? req.query.rol : undefined;
    const rolesPermitidos = ['cliente', 'barbero', 'admin'];

    if (rol && !rolesPermitidos.includes(rol)) {
      return res.status(400).json({ message: 'Rol invalido' });
    }

    const where =
      rol === 'barbero'
        ? { rol: rol as any, aprobado: true }
        : rol
          ? { rol: rol as any }
          : undefined;

    const users = await prisma.user.findMany({
      where,
      include: {
        perfilBarbero: {
          include: {
            lugarTrabajo: true,
            servicios: {
              orderBy: { nombre_servicio: 'asc' },
            },
          },
        },
      },
      orderBy: {
        nombre: 'asc',
      },
    });

    const safe = users.map((u) => {
      // @ts-ignore
      const { password: _p, ...rest } = u;
      return rest;
    });
    return res.json(safe);
  } catch (error) {
    console.error('getUsers error', error);
    return res.status(500).json({ message: 'Error al obtener usuarios' });
  }
};

export const getPendingBarbers = async (_req: AuthRequest, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      where: {
        rol: 'barbero',
        aprobado: false,
      },
      select: {
        id: true,
        nombre: true,
        email: true,
        telefono: true,
        rol: true,
        aprobado: true,
        fecha_creacion: true,
      },
      orderBy: {
        fecha_creacion: 'asc',
      },
    });

    return res.json(users);
  } catch (error) {
    console.error('getPendingBarbers error', error);
    return res.status(500).json({ message: 'Error al obtener barberos pendientes' });
  }
};

export const approveBarber = async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);

    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'ID invalido' });
    }

    const user = await prisma.user.findUnique({
      where: { id },
      include: { perfilBarbero: true },
    });

    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    if (user.rol !== 'barbero') {
      return res.status(400).json({ message: 'Solo se pueden aprobar usuarios con rol barbero' });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        aprobado: true,
        perfilBarbero: user.perfilBarbero
          ? undefined
          : {
              create: {
                biografia: 'Perfil creado al aprobar cuenta de barbero',
              },
            },
      },
      select: {
        id: true,
        nombre: true,
        email: true,
        telefono: true,
        rol: true,
        aprobado: true,
        fecha_creacion: true,
        perfilBarbero: true,
      },
    });

    return res.json(updated);
  } catch (error) {
    console.error('approveBarber error', error);
    return res.status(500).json({ message: 'Error al aprobar barbero' });
  }
};

export const getAdminDashboard = async (_req: AuthRequest, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        nombre: true,
        email: true,
        telefono: true,
        rol: true,
        aprobado: true,
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
                duracion_minutos: true,
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
    const barberosPendientes = barberos.filter((user) => !user.aprobado);

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
    console.error('getAdminDashboard error', error);
    return res.status(500).json({ message: 'Error al obtener dashboard admin' });
  }
};

// Eliminar usuario por id
export const deleteUser = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'ID inválido' });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

    await prisma.user.delete({ where: { id } });
    return res.status(204).send();
  } catch (error) {
    console.error('deleteUser error', error);
    return res.status(500).json({ message: 'Error al eliminar usuario' });
  }
};
export const updateUser = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    if (Number.isNaN(id)) {
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

    const { nombre, email, password, telefono, rol, aprobado } = value;
    const rolesPermitidos = ['cliente', 'barbero', 'admin'];

    // Si viene nuevo email, verificar que no esté en uso por otro usuario
    if (email && email !== user.email) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return res.status(409).json({ message: 'El email ya está en uso' });
      }
    }

    if (rol && !rolesPermitidos.includes(rol)) {
      return res.status(400).json({ message: 'Rol invalido' });
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

    const updated = await prisma.user.update({
      where: { id },
      data: {
        nombre:   nombre   ?? undefined,
        email:    email    ?? undefined,
        password: hashedPassword,
        telefono: telefono ?? undefined,
        rol:      rol      ?? undefined,
        aprobado: nextApproved,
        perfilBarbero:
          nextRole === 'barbero'
            ? {
                upsert: {
                  update: {},
                  create: {
                    biografia: 'Perfil creado por administrador',
                  },
                },
              }
            : undefined,
      },
      include: {
        perfilBarbero: {
          include: {
            lugarTrabajo: true,
          },
        },
      },
    });

    const { password: _p, ...safe } = updated;
    return res.json(safe);
  } catch (error) {
    console.error('updateUser error', error);
    return res.status(500).json({ message: 'Error al editar usuario' });
  }
};

export default {
  createUser,
  getUsers,
  getPendingBarbers,
  approveBarber,
  getAdminDashboard,
  deleteUser,
  updateUser,
};
