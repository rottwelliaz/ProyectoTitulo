import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import Joi from 'joi';

export const defaultConfiguration = { startTime: '09:00', endTime: '19:00', blockMinutes: 60 };
export const configurationValidation = Joi.object({
  startTime: Joi.string().pattern(/^(0[6-9]|1\d|2[01]):(00|30)$/).required(),
  endTime: Joi.string().pattern(/^(0[6-9]|1\d|2[01]):(00|30)$|^22:00$/).required(),
  blockMinutes: Joi.number().strict().valid(30, 45, 60).required(),
}).unknown(false).custom((value, helpers) => value.startTime < value.endTime ? value : helpers.error('any.invalid'));

export const lockedWeekMessage = 'La semana seleccionada ya contiene citas, descansos o bloqueos. Para proteger la planificación existente, no se pueden cambiar las horas de entrada, cierre ni la duración de los bloques.';
export const historicalWeekMessage = 'Esta semana contiene intervalos históricos o ya iniciados. Sus horarios generales están protegidos para no modificar el pasado.';

export function weekConfigurationProtection(start: Date, end: Date, citas: {
  fecha_hora: Date; estado: string; disponibleHasta?: Date | null; duracionReservada?: number | null;
}[], bloqueos: { inicio: Date; fin: Date }[], now = Date.now()): 'historial' | 'programacion' | null {
  const inWeek = citas.filter(c => +c.fecha_hora < +end && (+c.fecha_hora >= +start ||
    (c.estado === 'disponible' && c.disponibleHasta && +c.disponibleHasta > +start) ||
    (['pendiente', 'confirmada'].includes(c.estado) && (!c.duracionReservada || +c.fecha_hora + c.duracionReservada * 60_000 > +start))));
  const blocks = bloqueos.filter(b => b.inicio < end && b.fin > start);
  if (+end <= now || inWeek.some(c => +c.fecha_hora <= now) || blocks.some(b => +b.inicio <= now)) return 'historial';
  if (blocks.length || inWeek.some(c => ['pendiente', 'confirmada'].includes(c.estado))) return 'programacion';
  return null;
}

// A block's state is determined by its collection, never by a client-supplied
// status/estado. Reject extra fields rather than silently publishing an invalid
// state as availability. Missing legacy intervals remain untouched on reads.
export const weekAvailabilityValidation = Joi.object({
  fechaInicio: Joi.any(),
  fechaFin: Joi.any(),
  revision: Joi.any(),
  configuracion: Joi.any(),
  conservarReservas: Joi.any(),
  bloques: Joi.array().max(1008).items(Joi.object({
    inicio: Joi.string().required(), fin: Joi.string().required(),
  }).unknown(false)).required(),
  bloqueos: Joi.array().max(1008).items(Joi.object({
    inicio: Joi.string().required(), fin: Joi.string().required(),
    tipo: Joi.string().valid('bloqueado', 'descanso').required(),
  }).unknown(false)),
}).unknown(false);

// Called under the same profile row lock as reservations/publication. The digest
// detects edits from any endpoint/device, including new reservations and blocks.
export async function availabilitySnapshot(tx: Prisma.TransactionClient, barberoId: number, start: Date, end: Date) {
  const semana = await tx.agendaSemana.findUnique({ where: { barberoId_inicio: { barberoId, inicio: start } } });
  const citas = await tx.cita.findMany({ where: { barberoId, fecha_hora: { lt: end }, OR: [
    { fecha_hora: { gte: start } }, { disponibleHasta: { gt: start } }, { estado: { in: ['pendiente', 'confirmada'] } },
  ] }, select: { id: true, fecha_actualizacion: true, estado: true, fecha_hora: true, disponibleHasta: true, duracionReservada: true }, orderBy: { id: 'asc' } });
  const bloqueos = await tx.agendaBloqueo.findMany({ where: { barberoId, inicio: { lt: end }, fin: { gt: start } }, orderBy: { id: 'asc' } });
  const protection = weekConfigurationProtection(start, end, citas, bloqueos);
  return {
    revision: createHash('sha256').update(JSON.stringify({ semana, citas, bloqueos })).digest('hex'),
    configuracion: semana?.configuracion ?? defaultConfiguration,
    publicada: Boolean(semana),
    configuracionBloqueada: protection !== null,
    motivoConfiguracion: protection,
  };
}
