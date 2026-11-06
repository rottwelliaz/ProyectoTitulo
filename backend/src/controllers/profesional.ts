import { Response } from 'express';
import Joi from 'joi';
import { Temporal } from '@js-temporal/polyfill';
import prisma from '../config/prisma';
import { AuthRequest } from '../middleware/auth';
import { businessDate, businessRange, parseInstant, slotInstant } from '../services/businessTime';
import { ScheduleError, scheduleFailure, withSchedule, durationOf, endOf, freeIntervals, activeStates, overlaps } from '../services/schedule';
import { historicalAppointment } from '../services/reservationLifecycle';
import { availabilitySnapshot } from '../services/availability';
import { calendarConfiguration } from '../services/calendarGrid';

const failure = (res: Response, error: unknown) => {
  if (error instanceof RangeError) return res.status(400).json({ message: error.message });
  const known = scheduleFailure(error);
  if (known) return res.status(known.status).json({ message: known.message, ...(error instanceof ScheduleError && error.conflictos ? { conflictos: error.conflictos } : {}) });
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
      const citas = await tx.cita.findMany({ where: { barberoId: profile.id, OR: [
        { estado: { not: 'disponible' }, fecha_hora: { lt: end } },
        { fecha_hora: { gte: start, lt: end } },
        { estado: 'disponible', fecha_hora: { lt: start }, disponibleHasta: { gt: start } },
      ] }, include: { cliente: { select: { id: true, nombre: true } }, servicio: true }, orderBy: { fecha_hora: 'asc' } });
      const bloqueos = await tx.agendaBloqueo.findMany({ where: { barberoId: profile.id, inicio: { lt: end }, fin: { gt: start } }, orderBy: { inicio: 'asc' } });
      const firstDay = Temporal.PlainDate.from(businessDate(start));
      const firstMonday = firstDay.subtract({ days: firstDay.dayOfWeek - 1 }).toString();
      const weeks = await tx.agendaSemana.findMany({ where: { barberoId: profile.id, inicio: { gte: businessRange(firstMonday).start, lt: end } }, select: { inicio: true, configuracion: true } });
      const snapshot = await availabilitySnapshot(tx, profile.id, start, end);
      const applicable = weeks.find(week => businessDate(week.inicio) === firstMonday);
      // Explicit projection keeps payment proofs and private client data out of calendars.
      const visible = citas.filter(c => c.estado === 'disponible' ? c.disponibleHasta && c.disponibleHasta > start : durationOf(c) ? endOf(c.fecha_hora, durationOf(c)!) > start : c.fecha_hora >= start);
      return { configuraciones: Object.fromEntries(weeks.map(week => [businessDate(week.inicio), week.configuracion])),
        disponibilidad: freeIntervals(citas.filter(c => c.estado === 'disponible'), citas.filter(c => activeStates.includes(c.estado)), bloqueos),
        citas: visible.map(c => ({ id: c.id, fecha_hora: c.fecha_hora, disponibleHasta: c.disponibleHasta,
        fin: c.estado === 'disponible' ? c.disponibleHasta : durationOf(c) ? endOf(c.fecha_hora, durationOf(c)!) : null,
        duracionReservada: durationOf(c), estado: c.estado, cliente: c.cliente,
        servicio: historicalAppointment(c).servicio })), bloqueos, ...snapshot,
        configuracion: applicable?.configuracion ?? snapshot.configuracion, publicada: Boolean(applicable) };
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
    if (Object.keys(req.body ?? {}).some(key => !['inicio', 'fin', 'tipo', 'conservarReservas'].includes(key)) || !['bloqueado', 'descanso'].includes(tipo)) throw new RangeError('Indica inicio, fin y tipo de bloqueo válidos');
    const start = parseInstant(inicio), end = parseInstant(fin);
    if (+start <= Date.now() || end <= start || +end - +start > 86400000) throw new RangeError('El bloqueo debe ser futuro y durar como máximo 24 horas');
    const result = await withSchedule(profile.id, async tx => {
      if (+start <= Date.now()) throw new ScheduleError(409, 'El intervalo ya comenzó; actualiza la agenda');
      // Published availability is retained underneath the block; the single
      // reservation interval validator enforces it for every booking endpoint.
      const existing = await tx.agendaBloqueo.findFirst({ where: { barberoId: profile.id, inicio: { lt: end }, fin: { gt: start } } });
      if (existing) throw new ScheduleError(409, 'Ya existe un bloqueo en ese intervalo');
      const appointments = await tx.cita.findMany({ where: { barberoId: profile.id, estado: { in: activeStates }, fecha_hora: { lt: end } }, include: { servicio: true } });
      const conflicts = appointments.filter(c => !durationOf(c) || overlaps(start, end, c.fecha_hora, endOf(c.fecha_hora, durationOf(c)!))).map(c => c.id);
      if (conflicts.length) throw new ScheduleError(409, 'No puedes bloquear ni marcar como descanso un intervalo ocupado por una cita');
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
      if (+block.inicio <= Date.now()) throw new ScheduleError(409, 'No puedes retirar un descanso o bloqueo pasado o iniciado');
      const day = businessDate(block.inicio);
      const { published, configuration } = await calendarConfiguration(tx, profile.id, day);
      if (published && block.inicio >= slotInstant(day, configuration.startTime) && block.fin <= slotInstant(day, configuration.endTime)) {
        const windows = await tx.cita.findMany({ where: { barberoId: profile.id, estado: 'disponible', fecha_hora: { lt: block.fin }, disponibleHasta: { gt: block.inicio } } });
        const appointments = await tx.cita.findMany({ where: { barberoId: profile.id, estado: { in: activeStates }, fecha_hora: { lt: block.fin } } });
        const otherBlocks = await tx.agendaBloqueo.findMany({ where: { barberoId: profile.id, id: { not: block.id }, inicio: { lt: block.fin }, fin: { gt: block.inicio } } });
        const missing = freeIntervals([{ fecha_hora: block.inicio, disponibleHasta: block.fin }], appointments, [
          ...otherBlocks, ...windows.filter(w => w.disponibleHasta).map(w => ({ inicio: w.fecha_hora, fin: w.disponibleHasta! })),
        ]);
        if (missing.length) await tx.cita.createMany({ data: missing.map(part => ({ barberoId: profile.id, estado: 'disponible', fecha_hora: part.inicio, disponibleHasta: part.fin })) });
      }
      await tx.agendaBloqueo.delete({ where: { id: block.id } });
    });
    return res.status(204).send();
  } catch (error) { return failure(res, error); }
};
