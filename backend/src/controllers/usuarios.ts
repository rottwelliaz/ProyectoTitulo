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

// Obtener todos los usuarios
export const getUsers = async (_req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany();
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

export default { createUser, getUsers, deleteUser };
