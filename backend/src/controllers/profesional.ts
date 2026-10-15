import { Response } from 'express';
import Joi from 'joi';
import { Temporal } from '@js-temporal/polyfill';
import prisma from '../config/prisma';
import { AuthRequest } from '../middleware/auth';
import { businessRange, parseInstant } from '../services/businessTime';
import { ScheduleError, scheduleFailure, withSchedule } from '../services/schedule';
import { historicalAppointment } from '../services/reservationLifecycle';
import { availabilitySnapshot } from '../services/availability';

const failure = (res: Response, error: unknown) => {
  if (error instanceof RangeError) return res.status(400).json({ message: error.message });
  const known = scheduleFailure(error);
  if (known) return res.status(known.status).json({ message: known.message });
  console.error('professional panel', error);
  return res.status(500).json({ message: 'No se pudo completar la operación del panel profesional' });
};
const ownProfile = async (req: AuthRequest) => {
  if (req.user?.rol !== 'barbero') throw new ScheduleError(403, 'Solo el profesional puede acceder a su panel');
  const profile = await prisma.barberProfile.findUnique({ where: { usuarioId: req.user.id }, select: { id: true } });
  if (!profile) throw new ScheduleError(404, 'Perfil profesional no encontrado');
  return profile;
};
const profileValidation = Joi.object({
  biografia: Joi.string().trim().max(2000).allow('').required(),
  especialidades: Joi.array().items(Joi.string().trim().min(1).max(60)).unique().max(12).required(),
}).unknown(false);

export const updateProfessionalProfile = async (req: AuthRequest, res: Response) => {
  try {
    const profile = await ownProfile(req);
    const { error, value } = profileValidation.validate(req.body);
    if (error) return res.status(400).json({ message: 'Indica una biografía de hasta 2000 caracteres y hasta 12 especialidades únicas de 60 caracteres; no se permiten campos adicionales' });
    return res.json(await prisma.barberProfile.update({ where: { id: profile.id }, data: value,
      select: { id: true, biografia: true, especialidades: true } }));
  } catch (error) { return failure(res, error); }
};

// All periods use existing Santiago day boundaries, including DST transitions.
function period(query: AuthRequest['query']) {
  if (Object.keys(query).some(key => !['desde', 'hasta'].includes(key))) throw new RangeError('Solo se permiten desde y hasta; el profesional se obtiene de tu sesión');
  if (typeof query.desde !== 'string' || typeof query.hasta !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(query.desde) || !/^\d{4}-\d{2}-\d{2}$/.test(query.hasta)) throw new RangeError('Indica desde y hasta con formato YYYY-MM-DD');
  const days = Temporal.PlainDate.from(query.desde).until(Temporal.PlainDate.from(query.hasta)).days;
  if (days < 0 || days > 365) throw new RangeError('El período debe tener entre 1 y 366 días');
  return { start: businessRange(query.desde).start, end: businessRange(query.hasta).end };
}

export const getProfessionalCalendar = async (req: AuthRequest, res: Response) => {
  res.set('Cache-Control', 'no-store');
  try {
    const profile = await ownProfile(req), { start, end } = period(req.query);
    const result = await withSchedule(profile.id, async tx => {
      const duration = await tx.cita.aggregate({ where: { barberoId: profile.id }, _max: { duracionReservada: true } });
      const earliest = new Date(+start - (duration._max.duracionReservada ?? 1) * 60000);
      const citas = await tx.cita.findMany({ where: { barberoId: profile.id, OR: [
        { fecha_hora: { gte: earliest, lt: end } },
        { estado: 'disponible', fecha_hora: { lt: start }, disponibleHasta: { gt: start } },
      ] }, include: { cliente: { select: { id: true, nombre: true } } }, orderBy: { fecha_hora: 'asc' } });
      const bloqueos = await tx.agendaBloqueo.findMany({ where: { barberoId: profile.id, inicio: { lt: end }, fin: { gt: start } }, orderBy: { inicio: 'asc' } });
      // Explicit projection keeps payment proofs and private client data out of calendars.
      return { citas: citas.filter(c => +(c.disponibleHasta ?? new Date(+c.fecha_hora + (c.duracionReservada ?? 1) * 60000)) > +start).map(c => ({ id: c.id, fecha_hora: c.fecha_hora, disponibleHasta: c.disponibleHasta,
        duracionReservada: c.duracionReservada, estado: c.estado, cliente: c.cliente,
        servicio: historicalAppointment(c).servicio })), bloqueos, ...await availabilitySnapshot(tx, profile.id, start, end) };
    });
    return res.json(result);
  } catch (error) { return failure(res, error); }
};

export const getProfessionalStatistics = async (req: AuthRequest, res: Response) => {
  try {
    const profile = await ownProfile(req), { start, end } = period(req.query);
    const counts = await prisma.cita.groupBy({ by: ['estado'], where: { barberoId: profile.id,
      estado: { not: 'disponible' }, fecha_hora: { gte: start, lt: end } }, _count: { _all: true } });
    const estados: Record<string, number> = { pendiente: 0, confirmada: 0, cancelada: 0, rechazada: 0, finalizada: 0, inasistencia: 0 };
    for (const count of counts) estados[count.estado] = count._count._all;
    return res.json({ desde: req.query.desde, hasta: req.query.hasta, total: Object.values(estados).reduce((a, b) => a + b, 0), estados });
  } catch (error) { return failure(res, error); }
};

export const createProfessionalBlock = async (req: AuthRequest, res: Response) => {
  try {
    const profile = await ownProfile(req);
    const { inicio, fin, tipo } = req.body ?? {};
    if (Object.keys(req.body ?? {}).some(key => !['inicio', 'fin', 'tipo'].includes(key)) || !['bloqueado', 'descanso'].includes(tipo)) throw new RangeError('Indica inicio, fin y tipo de bloqueo válidos');
    const start = parseInstant(inicio), end = parseInstant(fin);
    if (+start <= Date.now() || end <= start || +end - +start > 86400000) throw new RangeError('El bloqueo debe ser futuro y durar como máximo 24 horas');
    const result = await withSchedule(profile.id, async tx => {
      // Published availability is retained underneath the block; the single
      // reservation interval validator enforces it for every booking endpoint.
      const existing = await tx.agendaBloqueo.findFirst({ where: { barberoId: profile.id, inicio: { lt: end }, fin: { gt: start } } });
      if (existing) throw new ScheduleError(409, 'Ya existe un bloqueo en ese intervalo');
      return tx.agendaBloqueo.create({ data: { barberoId: profile.id, inicio: start, fin: end, tipo } });
    });
    return res.status(201).json(result);
  } catch (error) { return failure(res, error); }
};

export const deleteProfessionalBlock = async (req: AuthRequest, res: Response) => {
  try {
    const profile = await ownProfile(req);
    await withSchedule(profile.id, async tx => {
      const block = await tx.agendaBloqueo.findUnique({ where: { id: req.params.id } });
      if (!block) throw new ScheduleError(404, 'Bloqueo no encontrado');
      if (block.barberoId !== profile.id) throw new ScheduleError(403, 'No puedes modificar bloqueos de otro profesional');
      await tx.agendaBloqueo.delete({ where: { id: block.id } });
    });
    return res.status(204).send();
  } catch (error) { return failure(res, error); }
};
