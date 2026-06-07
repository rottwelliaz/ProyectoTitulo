import { Request, Response } from 'express';
import prisma from '../config/prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'tu_clave_jwt_super_segura_cambiar_esto';
const JWT_EXPIRE = process.env.JWT_EXPIRE || '7d';

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

export default { login };
