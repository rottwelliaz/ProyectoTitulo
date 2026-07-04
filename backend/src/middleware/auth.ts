import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma';

const JWT_SECRET = process.env.JWT_SECRET || 'tu_clave_jwt_super_segura_cambiar_esto';

export interface AuthRequest extends Request {
  user?: { id: number; rol: string };
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ message: 'Token no proporcionado' });
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    // Verificar que el usuario exista
    const userId = typeof payload.id === 'string' ? Number(payload.id) : payload.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(401).json({ message: 'Usuario no encontrado' });
    if (user.rol === 'barbero' && !user.aprobado) {
      return res.status(403).json({ message: 'Cuenta de barbero pendiente de aprobacion' });
    }
    req.user = { id: user.id, rol: user.rol };
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

export default { authenticate, authorizeRoles };
