import { Response } from 'express';
import prisma from '../config/prisma';
import { AuthRequest } from '../middleware/auth';
import { ScheduleError, scheduleFailure } from '../services/schedule';

const failure = (res: Response, error: unknown) => {
  const known = scheduleFailure(error);
  if (known) return res.status(known.status).json({ message: known.message });
  if ((error as { code?: string }).code === 'P2002') return res.status(409).json({ message: 'Ya tienes una solicitud profesional registrada' });
  console.error('solicitud profesional', error);
  return res.status(500).json({ message: 'No se pudo guardar la solicitud profesional' });
};

export const getMyApplication = async (req: AuthRequest, res: Response) => {
  res.set('Cache-Control', 'no-store');
  try { return res.json(await prisma.solicitudProfesional.findUnique({ where: { usuarioId: req.user!.id } })); }
  catch (error) { return failure(res, error); }
};

export const requestProfessional = async (req: AuthRequest, res: Response) => {
  try {
    if (Object.keys(req.body ?? {}).length) throw new ScheduleError(400, 'La solicitud se crea con los datos de tu cuenta');
    const result = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${req.user!.id} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: req.user!.id } });
      if (!user?.activo || user.rol !== 'cliente') throw new ScheduleError(403, 'Solo una cuenta de cliente activa puede solicitar un perfil profesional');
      if (await tx.solicitudProfesional.findUnique({ where: { usuarioId: user.id } })) throw new ScheduleError(409, 'Ya tienes una solicitud profesional registrada; consulta su resultado');
      return tx.solicitudProfesional.create({ data: { usuarioId: user.id } });
    });
    return res.status(201).json(result);
  } catch (error) { return failure(res, error); }
};

export const resolveApplication = (approved: boolean) => async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new ScheduleError(400, 'ID inválido');
    const motivo = typeof req.body?.motivoRechazo === 'string' ? req.body.motivoRechazo.trim() : '';
    if (Object.keys(req.body ?? {}).some(key => key !== 'motivoRechazo') || (!approved && (!motivo || motivo.length > 1000))) throw new ScheduleError(400, 'Indica un motivo de rechazo de entre 1 y 1000 caracteres');
    const result = await prisma.$transaction(async tx => {
      // Account lock serializes approval, rejection and administrative edits.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id } });
      if (!user) throw new ScheduleError(404, 'Usuario no encontrado');
      if (!user.activo) throw new ScheduleError(409, 'Reactiva la cuenta antes de resolver su solicitud');
      const application = await tx.solicitudProfesional.findUnique({ where: { usuarioId: id } });
      if (!application || application.estado !== 'pendiente') throw new ScheduleError(409, 'No hay una solicitud pendiente; el resultado anterior se conserva');
      if (!['cliente', 'barbero'].includes(user.rol)) throw new ScheduleError(409, 'El rol actual no permite resolver esta solicitud');
      await tx.solicitudProfesional.update({ where: { id: application.id }, data: {
        estado: approved ? 'aprobada' : 'rechazada', motivoRechazo: approved ? null : motivo,
        fechaResolucion: new Date(), revisorId: req.user!.id,
      } });
      return tx.user.update({ where: { id }, data: { rol: approved ? 'barbero' : 'cliente', aprobado: true,
        ...(approved ? { perfilBarbero: { upsert: { create: { foto_perfil: user.foto_perfil },
          update: user.foto_perfil ? { foto_perfil: user.foto_perfil } : {} } } } : {}),
      }, select: { id: true, nombre: true, rol: true, aprobado: true, solicitudProfesional: true } });
    });
    return res.json(result);
  } catch (error) { return failure(res, error); }
};
