import { Request, Response } from 'express';
import prisma from '../config/prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AuthRequest } from '../middleware/auth';

const JWT_SECRET = process.env.JWT_SECRET || 'tu_clave_jwt_super_segura_cambiar_esto';
const JWT_EXPIRE = process.env.JWT_EXPIRE || '2h';

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email y password son requeridos' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ message: 'Credenciales inválidas' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: 'Credenciales inválidas' });

    const token = jwt.sign({ id: user.id, rol: user.rol } as any, JWT_SECRET as any, { expiresIn: JWT_EXPIRE } as any);

    // @ts-ignore
    const { password: _p, ...safe } = user;

    return res.json({ token, user: safe });
  } catch (error) {
    console.error('login error', error);
    return res.status(500).json({ message: 'Error en login' });
  }
};

export const getMe = async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id:             true,
        nombre:         true,
        email:          true,
        telefono:       true,
        rol:            true,
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
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    return res.json(user);
  } catch (error) {
    console.error('getMe error', error);
    return res.status(500).json({ message: 'Error al obtener perfil' });
  }
};

export const updateMe = async (req: AuthRequest, res: Response) => {
  try {
    const { nombre, email, password, telefono } = req.body;

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    if (email && email !== user.email) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return res.status(409).json({ message: 'El email ya está en uso' });
      }
    }

    const hashedPassword = password ? await bcrypt.hash(password, 10) : undefined;

    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        nombre:   nombre   ?? undefined,
        email:    email    ?? undefined,
        password: hashedPassword,
        telefono: telefono ?? undefined,
      },
      select: {
        id:             true,
        nombre:         true,
        email:          true,
        telefono:       true,
        rol:            true,
        fecha_creacion: true,
      },
    });

    return res.json(updated);
  } catch (error) {
    console.error('updateMe error', error);
    return res.status(500).json({ message: 'Error al actualizar perfil' });
  }
};
export default { login, getMe, updateMe };
