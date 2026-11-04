import { Response } from 'express';
import prisma from '../config/prisma';
import { AuthRequest } from '../middleware/auth';
import { ScheduleError, scheduleFailure } from '../services/schedule';

const failure = (res: Response, error: unknown) => {
  const known = scheduleFailure(error);
  if (known) return res.status(known.status).json({ message: known.message });
  if ((error as { code?: string }).code === 'P2002') return res.status(409).json({ message: 'Ya tienes una solicitud profesional registrada' });
  if ((error as { code?: string }).code === 'P2003') return res.status(409).json({ message: 'La cuenta tiene dependencias que impiden eliminarla de forma segura. No se realizó ningún cambio.' });
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
      await tx.user.update({ where: { id: user.id }, data: { rol: 'barbero', aprobado: false } });
      return tx.solicitudProfesional.create({ data: { usuarioId: user.id } });
    });
    return res.status(201).json(result);
  } catch (error) { return failure(res, error); }
};

export const resolveApplication = (approved: boolean) => async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.rol !== 'admin') throw new ScheduleError(403, 'Solo un administrador puede resolver solicitudes');
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new ScheduleError(400, 'ID inválido');
    const motivo = typeof req.body?.motivoRechazo === 'string' ? req.body.motivoRechazo.trim() : '';
    if (Object.keys(req.body ?? {}).some(key => key !== 'motivoRechazo') || motivo.length > 1000) throw new ScheduleError(400, 'Datos de resolución inválidos');
    const result = await prisma.$transaction(async tx => {
      // Account lock serializes approval, rejection and administrative edits.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id } });
      if (!user) throw new ScheduleError(404, 'Usuario no encontrado');
      if (!user.activo) throw new ScheduleError(409, 'Reactiva la cuenta antes de resolver su solicitud');
      const application = await tx.solicitudProfesional.findUnique({ where: { usuarioId: id } });
      if (user.rol !== 'barbero' || user.aprobado || !application || application.estado !== 'pendiente') throw new ScheduleError(409, 'La cuenta debe ser de barbero y tener una solicitud pendiente sin aprobar');
      if (!approved) {
        // Never rely on cascading User relations: conversations/messages are history too.
        const history = await tx.user.findUnique({ where: { id }, select: { _count: { select: {
          citas: true, cambiosCita: true, conversacionesCliente: true, conversacionesBarbero: true,
          mensajesEnviados: true, solicitudesResueltas: true,
        } } } });
        if (!history || Object.values(history._count).some(count => count > 0)) {
          throw new ScheduleError(409, 'La cuenta tiene reservas, mensajes u otros datos históricos. No se puede eliminar de forma segura; no se realizó ningún cambio.');
        }
        await tx.$queryRaw`SELECT "id" FROM "BarberProfile" WHERE "usuarioId" = ${id} FOR UPDATE`;
        const profile = await tx.barberProfile.findUnique({ where: { usuarioId: id }, include: {
          _count: { select: { citas: true } }, servicios: { select: { _count: { select: { citas: true } } } },
        } });
        if (profile) {
          if (profile._count.citas || profile.servicios.some(service => service._count.citas)) {
            throw new ScheduleError(409, 'El perfil tiene citas asociadas. No se puede eliminar de forma segura; no se realizó ningún cambio.');
          }
          // Only configuration owned exclusively by this pending profile is removed.
          await tx.service.deleteMany({ where: { perfilBarberoId: profile.id } });
          await tx.agendaBloqueo.deleteMany({ where: { barberoId: profile.id } });
          await tx.agendaSemana.deleteMany({ where: { barberoId: profile.id } });
          if (profile.lugarTrabajoId) {
            await tx.$queryRaw`SELECT "id" FROM "LugarTrabajo" WHERE "id" = ${profile.lugarTrabajoId} FOR UPDATE`;
          }
          await tx.barberProfile.delete({ where: { id: profile.id } });
          if (profile.lugarTrabajoId && await tx.barberProfile.count({ where: { lugarTrabajoId: profile.lugarTrabajoId } }) === 0) {
            await tx.lugarTrabajo.delete({ where: { id: profile.lugarTrabajoId } });
          }
        }
        await tx.solicitudProfesional.delete({ where: { id: application.id } });
        await tx.user.delete({ where: { id } });
        return { id, message: 'La solicitud fue rechazada y la cuenta eliminada correctamente.' };
      }
      await tx.solicitudProfesional.update({ where: { id: application.id }, data: {
        estado: 'aprobada', motivoRechazo: null,
        fechaResolucion: new Date(), revisorId: req.user!.id,
      } });
      return tx.user.update({ where: { id }, data: { aprobado: true,
        perfilBarbero: { upsert: { create: { foto_perfil: user.foto_perfil },
          update: user.foto_perfil ? { foto_perfil: user.foto_perfil } : {} } },
      }, select: { id: true, nombre: true, rol: true, aprobado: true, solicitudProfesional: true } });
    });
    return res.json(result);
  } catch (error) { return failure(res, error); }
};
