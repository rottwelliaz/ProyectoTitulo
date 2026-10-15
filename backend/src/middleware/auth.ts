import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma';
import { jwtSettings } from '../config/security';


export interface AuthRequest extends Request {
  user?: { id: number; rol: string };
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ message: 'Token no proporcionado' });
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, jwtSettings().secret, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || !Number.isSafeInteger(payload.exp)) return res.status(401).json({ message: 'Token inválido' });
    // Verificar que el usuario exista
    const userId = typeof payload.id === 'string' ? Number(payload.id) : payload.id;
    if (!Number.isSafeInteger(userId) || userId <= 0) return res.status(401).json({ message: 'Token inválido' });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, rol: true, aprobado: true, activo: true } });
    if (!user) return res.status(401).json({ message: 'Usuario no encontrado' });
    if (user.activo === false) return res.status(403).json({ message: 'La cuenta está deshabilitada' });
    req.user = { id: user.id, rol: user.rol === 'barbero' && !user.aprobado ? 'cliente' : user.rol };
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Token inválido' });
  }
};
export const authorizeRoles = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ message: 'No autenticado' });
    if (!roles.includes(req.user.rol)) return res.status(403).json({ message: 'No autorizado' });
    next();
  };
};
