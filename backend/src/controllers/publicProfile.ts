import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { publicProfileSelect } from '../services/publicProfile';

export async function getPublicProfile(req: Request, res: Response) {
  const id = Number(req.params.barberoId);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ message: 'Identificador de barbero inválido' });
  try {
    const profile = await prisma.barberProfile.findFirst({
      where: { id, usuario: { rol: 'barbero', aprobado: true, activo: true } },
      select: { ...publicProfileSelect, usuario: { select: { nombre: true, foto_perfil: true } } },
    });
    if (!profile) return res.status(404).json({ message: 'Este perfil no está disponible' });
    return res.json(profile);
  } catch {
    return res.status(500).json({ message: 'No se pudo cargar el perfil. Inténtalo nuevamente.' });
  }
}
