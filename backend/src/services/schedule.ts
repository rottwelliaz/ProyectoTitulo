import { CitaEstado, Prisma } from '@prisma/client';
import prisma from '../config/prisma';

export class ScheduleError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const activeStates = [CitaEstado.pendiente, CitaEstado.confirmada];
export const endOf = (start: Date, minutes: number) => new Date(start.getTime() + minutes * 60_000);
export const overlaps = (start: Date, end: Date, otherStart: Date, otherEnd: Date) =>
  start < otherEnd && otherStart < end;

export function durationOf(appointment: {
  duracionReservada: number | null;
  servicio: { duracion_minutos: number } | null;
}): number | null {
  const duration = appointment.duracionReservada ?? appointment.servicio?.duracion_minutos;
  return Number.isInteger(duration) && Number(duration) > 0 ? Number(duration) : null;
}

// A database row lock coordinates every API instance, not only this Node process.
// READ COMMITTED ensures reads after a lock wait see the preceding commit.
export async function withSchedule<T>(barberId: number, action: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async tx => {
    const profiles = await tx.$queryRaw<{ id: number }[]>`
      SELECT "id" FROM "BarberProfile" WHERE "id" = ${barberId} FOR UPDATE`;
    if (!profiles.length) throw new ScheduleError(404, 'Perfil de barbero no encontrado');
    return action(tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 20_000 });
}

export function covers(start: Date, end: Date, windows: { fecha_hora: Date; disponibleHasta: Date | null }[]) {
  let cursor = start.getTime();
  for (const window of [...windows].sort((a, b) => a.fecha_hora.getTime() - b.fecha_hora.getTime())) {
    if (!window.disponibleHasta || window.disponibleHasta.getTime() <= cursor) continue;
    if (window.fecha_hora.getTime() > cursor) break;
    cursor = Math.max(cursor, window.disponibleHasta.getTime());
    if (cursor >= end.getTime()) return true;
  }
  return false;
}

export async function validateInterval(tx: Prisma.TransactionClient, barberId: number, start: Date, minutes: number, excludeId?: string) {
  if (!Number.isInteger(minutes) || minutes <= 0) throw new ScheduleError(409, 'No se puede determinar la duración del servicio');
  const end = endOf(start, minutes);
  const blocked = await tx.agendaBloqueo.findFirst({ where: { barberoId: barberId, inicio: { lt: end }, fin: { gt: start } } });
  if (blocked) throw new ScheduleError(409, 'El horario coincide con un bloqueo o descanso del profesional');
  const occupied = await tx.cita.findMany({
    where: { barberoId: barberId, estado: { in: activeStates }, fecha_hora: { lt: end }, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    include: { servicio: true },
  });
  for (const appointment of occupied) {
    const duration = durationOf(appointment);
    // An orphaned legacy reservation must be reviewed, never treated as a free interval.
    if (duration === null) throw new ScheduleError(409, 'Hay una reserva existente sin duración verificable; el profesional debe revisar su agenda');
    if (overlaps(start, end, appointment.fecha_hora, endOf(appointment.fecha_hora, duration))) {
      throw new ScheduleError(409, 'El horario se superpone con otra reserva del profesional');
    }
  }
  const windows = await tx.cita.findMany({
    where: { barberoId: barberId, estado: CitaEstado.disponible, fecha_hora: { lt: end }, disponibleHasta: { gt: start } },
    select: { fecha_hora: true, disponibleHasta: true },
  });
  if (!covers(start, end, windows)) {
    throw new ScheduleError(409, 'El servicio completo no cabe en la disponibilidad publicada o cruza un descanso/bloqueo');
  }
}

export function scheduleFailure(error: unknown): { status: number; message: string } | null {
  if (error instanceof ScheduleError) return { status: error.status, message: error.message };
  if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2028'].includes(error.code)) {
    return { status: 409, message: 'La agenda está siendo modificada. Actualiza los horarios e inténtalo nuevamente.' };
  }
  return null;
}
