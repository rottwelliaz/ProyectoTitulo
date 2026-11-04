import { CitaEstado, Prisma } from '@prisma/client';
import prisma from '../config/prisma';

export class ScheduleError extends Error {
  constructor(public status: number, message: string, public conflictos?: string[]) { super(message); }
}

export const activeStates: CitaEstado[] = [CitaEstado.pendiente, CitaEstado.confirmada];
export const endOf = (start: Date, minutes: number) => new Date(start.getTime() + minutes * 60_000);
export const overlaps = (start: Date, end: Date, otherStart: Date, otherEnd: Date) =>
  start < otherEnd && otherStart < end;

// Shared projection: published windows remain in storage, but their occupied
// portions must never be presented as available in a professional calendar.
export function freeIntervals(windows: { fecha_hora: Date; disponibleHasta: Date | null }[], occupied: ScheduleIntervals['occupied'], blocked: ScheduleIntervals['blocked']) {
  const cuts = [...blocked, ...occupied.map(c => ({ inicio: c.fecha_hora, fin: durationOf(c) ? endOf(c.fecha_hora, durationOf(c)!) : new Date(8640000000000000) }))];
  const merged: { inicio: Date; fin: Date }[] = [];
  for (const window of [...windows].sort((a, b) => +a.fecha_hora - +b.fecha_hora)) {
    if (!window.disponibleHasta) continue;
    const last = merged[merged.length - 1];
    if (last && window.fecha_hora <= last.fin) last.fin = new Date(Math.max(+last.fin, +window.disponibleHasta));
    else merged.push({ inicio: window.fecha_hora, fin: window.disponibleHasta });
  }
  return merged.flatMap(window => {
    let parts = [window];
    for (const cut of cuts) parts = parts.flatMap(part => !overlaps(part.inicio, part.fin, cut.inicio, cut.fin) ? [part] : [
      ...(part.inicio < cut.inicio ? [{ inicio: part.inicio, fin: cut.inicio }] : []),
      ...(cut.fin < part.fin ? [{ inicio: cut.fin, fin: part.fin }] : []),
    ]);
    return parts;
  });
}

export function durationOf(appointment: {
  duracionReservada: number | null;
}): number | null {
  const duration = appointment.duracionReservada;
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

export interface ScheduleIntervals {
  windows: { fecha_hora: Date; disponibleHasta: Date | null }[];
  occupied: { fecha_hora: Date; duracionReservada: number | null }[];
  blocked: { inicio: Date; fin: Date }[];
}

export type IntervalIssue = 'duration' | 'blocked' | 'occupied' | 'unverified' | 'coverage';

// The public calendar and the final reservation use the same interval rules.
export function intervalIssue(start: Date, minutes: number, data: ScheduleIntervals): IntervalIssue | null {
  if (!Number.isInteger(minutes) || minutes <= 0) return 'duration';
  const end = endOf(start, minutes);
  if (data.blocked.some(block => overlaps(start, end, block.inicio, block.fin))) return 'blocked';
  for (const appointment of data.occupied) {
    if (appointment.fecha_hora >= end) continue;
    const duration = durationOf(appointment);
    if (duration === null) return 'unverified';
    if (overlaps(start, end, appointment.fecha_hora, endOf(appointment.fecha_hora, duration))) return 'occupied';
  }
  return covers(start, end, data.windows) ? null : 'coverage';
}

export async function validateInterval(tx: Prisma.TransactionClient, barberId: number, start: Date, minutes: number, excludeId?: string) {
  if (!Number.isInteger(minutes) || minutes <= 0) throw new ScheduleError(409, 'No se puede determinar la duración del bloque');
  const end = endOf(start, minutes);
  const blocked = await tx.agendaBloqueo.findFirst({ where: { barberoId: barberId, inicio: { lt: end }, fin: { gt: start } } });
  if (blocked) throw new ScheduleError(409, 'El horario coincide con un bloqueo o descanso del profesional');
  const occupied = await tx.cita.findMany({
    where: { barberoId: barberId, estado: { in: activeStates }, fecha_hora: { lt: end }, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    include: { servicio: true },
  });
  const windows = await tx.cita.findMany({
    where: { barberoId: barberId, estado: CitaEstado.disponible, fecha_hora: { lt: end }, disponibleHasta: { gt: start } },
    select: { fecha_hora: true, disponibleHasta: true },
  });
  const issue = intervalIssue(start, minutes, { windows, occupied, blocked: [] });
  if (issue) throw new ScheduleError(409, {
    duration: 'No se puede determinar la duración del bloque',
    blocked: 'El horario coincide con un bloqueo o descanso del profesional',
    unverified: 'Hay una reserva existente sin duración verificable; el profesional debe revisar su agenda',
    occupied: 'El horario se superpone con otra reserva del profesional',
    coverage: 'El bloque completo no cabe en la disponibilidad publicada o cruza un descanso/bloqueo',
  }[issue]);
}

export function scheduleFailure(error: unknown): { status: number; message: string } | null {
  if (error instanceof ScheduleError) return { status: error.status, message: error.message };
  if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2028'].includes(error.code)) {
    return { status: 409, message: 'La agenda está siendo modificada. Actualiza los horarios e inténtalo nuevamente.' };
  }
  return null;
}
