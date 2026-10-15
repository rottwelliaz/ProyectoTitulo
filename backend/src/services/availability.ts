import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import Joi from 'joi';

export const defaultConfiguration = { startTime: '09:00', endTime: '19:00', blockMinutes: 60 };
export const configurationValidation = Joi.object({
  startTime: Joi.string().pattern(/^(0[6-9]|1\d|2[01]):(00|30)$/).required(),
  endTime: Joi.string().pattern(/^(0[6-9]|1\d|2[01]):(00|30)$|^22:00$/).required(),
  blockMinutes: Joi.number().strict().valid(10, 15, 20, 30, 45, 60).required(),
}).unknown(false).custom((value, helpers) => value.startTime < value.endTime ? value : helpers.error('any.invalid'));

// Called under the same profile row lock as reservations/publication. The digest
// detects edits from any endpoint/device, including new reservations and blocks.
export async function availabilitySnapshot(tx: Prisma.TransactionClient, barberoId: number, start: Date, end: Date) {
  const semana = await tx.agendaSemana.findUnique({ where: { barberoId_inicio: { barberoId, inicio: start } } });
  const citas = await tx.cita.findMany({ where: { barberoId, fecha_hora: { lt: end }, OR: [
    { fecha_hora: { gte: start } }, { disponibleHasta: { gt: start } }, { estado: { in: ['pendiente', 'confirmada'] } },
  ] }, select: { id: true, fecha_actualizacion: true, estado: true, fecha_hora: true, disponibleHasta: true, duracionReservada: true }, orderBy: { id: 'asc' } });
  const bloqueos = await tx.agendaBloqueo.findMany({ where: { barberoId, inicio: { lt: end }, fin: { gt: start } }, orderBy: { id: 'asc' } });
  return {
    revision: createHash('sha256').update(JSON.stringify({ semana, citas, bloqueos })).digest('hex'),
    configuracion: semana?.configuracion ?? defaultConfiguration,
    publicada: Boolean(semana),
  };
}
