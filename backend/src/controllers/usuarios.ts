import { Request, Response } from 'express';
import prisma from '../config/prisma';
import bcrypt from 'bcryptjs';

// Crear usuario
export const createUser = async (req: Request, res: Response) => {
  try {
    const { nombre, email, password, telefono, rol } = req.body;

    if (!nombre || !email || !password) {
      return res.status(400).json({ message: 'nombre, email y password son requeridos' });
    }

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
        rol: rol || undefined,
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

    const users = await prisma.user.findMany({
      where: rol ? { rol: rol as any } : undefined,
      include: {
        perfilBarbero: {
          include: {
            lugarTrabajo: true,
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

    const { nombre, email, password, telefono } = req.body;

    // Si viene nuevo email, verificar que no esté en uso por otro usuario
    if (email && email !== user.email) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return res.status(409).json({ message: 'El email ya está en uso' });
      }
    }

    // Si viene nueva password, hashearla
    const hashedPassword = password
      ? await bcrypt.hash(password, 10)
      : undefined;

    const updated = await prisma.user.update({
      where: { id },
      data: {
        nombre:   nombre   ?? undefined,
        email:    email    ?? undefined,
        password: hashedPassword,
        telefono: telefono ?? undefined
      },
    });

    const { password: _p, ...safe } = updated;
    return res.json(safe);
  } catch (error) {
    console.error('updateUser error', error);
    return res.status(500).json({ message: 'Error al editar usuario' });
  }
};

export default { createUser, getUsers, deleteUser, updateUser };
