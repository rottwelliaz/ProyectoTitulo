import { Temporal } from '@js-temporal/polyfill';
import { Prisma } from '@prisma/client';
import { BUSINESS_TIME_ZONE, businessDate, businessTime, slotInstant } from './businessTime';
import { calendarConfiguration, gridMinutes, timeMinutes, minuteTime, rowEndMinute, bookingInterval } from './calendarGrid';
import { activeStates, durationOf, endOf, intervalIssue, overlaps, type ScheduleIntervals } from './schedule';

interface CalendarCell {
  fecha: string;
  hora: string;
  fecha_hora: string | null;
  estado: 'available' | 'reserved' | 'unavailable';
  citaId?: string;
  motivo?: 'pasado' | 'bloqueado' | 'duracion' | 'sin_publicar' | 'agenda' | 'hora_invalida';
  ocupacion?: { inicio: string; fin: string; desde: number; hasta: number; tipo?: 'reserved' | 'bloqueado' | 'descanso' }[];
}

// Only explicitly selected scheduling fields enter this public projection.
// Never load customer identities, reservation IDs, payment proofs or bank data.
export async function publicAvailability(
  tx: Prisma.TransactionClient, barberId: number, start: Date, end: Date,
  services: { id: string }[], weekly: boolean,
) {
  if (weekly && Temporal.PlainDate.from(businessDate(start)).dayOfWeek !== 1) throw new RangeError('La semana debe comenzar el lunes');
  const contextEnd = end;
  const windows = await tx.cita.findMany({
    where: { barberoId: barberId, estado: 'disponible', fecha_hora: { lt: contextEnd }, disponibleHasta: { gt: start } },
    select: { id: true, fecha_hora: true, disponibleHasta: true }, orderBy: { fecha_hora: 'asc' },
  });
  const occupied = await tx.cita.findMany({
    where: { barberoId: barberId, estado: { in: activeStates }, fecha_hora: { lt: contextEnd } },
    select: { fecha_hora: true, duracionReservada: true },
  });
  const blocked = await tx.agendaBloqueo.findMany({
    where: { barberoId: barberId, inicio: { lt: contextEnd }, fin: { gt: start } }, select: { inicio: true, fin: true, tipo: true },
  });
  const intervals: ScheduleIntervals = { windows, occupied, blocked };
  const now = Date.now();
  const { configuration } = await calendarConfiguration(tx, barberId, businessDate(start));
  const dias = Array.from({ length: weekly ? 7 : 1 }, (_, index) => Temporal.PlainDate.from(businessDate(start)).add({ days: index }).toString());
  // Generate civil start times from the saved shift origin and row duration.
  // Availability and booking use the same complete block, regardless of service.
  const starts = new Map<number, typeof windows[number] & { slotId?: string }>();
  for (const day of dias) for (const minute of gridMinutes(configuration)) {
    let instant: Date;
    try { instant = slotInstant(day, minuteTime(minute)); } catch { continue; }
    const interval = bookingInterval(instant, configuration);
    if (+instant <= now || !interval) continue;
    const window = windows.find(w => +w.fecha_hora === +instant && w.disponibleHasta && instant < w.disponibleHasta)
      ?? windows.find(w => w.fecha_hora <= instant && w.disponibleHasta && instant < w.disponibleHasta);
    if (window) {
      starts.set(+instant, { ...window, fecha_hora: interval.start, disponibleHasta: interval.end,
        ...(+instant === +window.fecha_hora ? {} : { id: `${window.id}@${+instant}`, slotId: window.id }) });
    }
  }
  const candidates = [...starts.values()].sort((a, b) => +a.fecha_hora - +b.fecha_hora);
  const citas = candidates.filter(candidate => services.length > 0 &&
    intervalIssue(candidate.fecha_hora, configuration.blockMinutes, intervals) === null);
  if (!weekly) return { citas };

  const times = new Set(gridMinutes(configuration).map(minuteTime));
  const include = (instant: Date) => {
    if (instant >= start && instant < end) times.add(businessTime(instant));
  };
  candidates.forEach(window => include(window.fecha_hora));
  // Preserve irregular and cross-day appointments, even after a timetable change.
  occupied.forEach(appointment => {
    const duration = durationOf(appointment);
    if (duration && endOf(appointment.fecha_hora, duration) <= start) return;
    if (duration) for (const day of dias) {
      for (let minute = 0; minute < 1440; minute++) {
        if ((minute - timeMinutes(configuration.startTime)) % configuration.blockMinutes !== 0) continue;
        try {
          const instant = slotInstant(day, minuteTime(minute));
          if (overlaps(instant, endOf(instant, rowEndMinute(minute, configuration) - minute), appointment.fecha_hora, endOf(appointment.fecha_hora, duration))) include(instant);
        } catch { /* A nonexistent civil time is not a selectable start. */ }
      }
    } else include(appointment.fecha_hora);
  });
  const horas = [...times].sort();
  const available = new Map(citas.map(cita => [cita.fecha_hora.getTime(), cita]));
  const published = new Map(candidates.map(window => [window.fecha_hora.getTime(), window]));
  const horarios: CalendarCell[] = [];
  for (const fecha of dias) for (const hora of horas) {
    let instant: Date;
    try { instant = slotInstant(fecha, hora); }
    catch { horarios.push({ fecha, hora, fecha_hora: null, estado: 'unavailable', motivo: 'hora_invalida' }); continue; }
    const cell: CalendarCell = { fecha, hora, fecha_hora: instant.toISOString(), estado: 'unavailable' };
    const cellEnd = endOf(instant, rowEndMinute(timeMinutes(hora), configuration) - timeMinutes(hora));
    const cuts: NonNullable<CalendarCell['ocupacion']> = occupied.flatMap(appointment => {
      const duration = durationOf(appointment);
      if (!duration) return [];
      const occupiedEnd = endOf(appointment.fecha_hora, duration);
      if (!overlaps(instant, cellEnd, appointment.fecha_hora, occupiedEnd)) return [];
      return [{ inicio: appointment.fecha_hora.toISOString(), fin: occupiedEnd.toISOString(), desde: Math.max(0, (+appointment.fecha_hora - +instant) / (+cellEnd - +instant) * 100), hasta: Math.min(100, (+occupiedEnd - +instant) / (+cellEnd - +instant) * 100), tipo: 'reserved' as const }];
    });
    blocked.filter(block => overlaps(instant, cellEnd, block.inicio, block.fin)).forEach(block => cuts.push({ inicio: block.inicio.toISOString(), fin: block.fin.toISOString(), desde: Math.max(0, (+block.inicio - +instant) / (+cellEnd - +instant) * 100), hasta: Math.min(100, (+block.fin - +instant) / (+cellEnd - +instant) * 100), tipo: block.tipo === 'descanso' ? 'descanso' : 'bloqueado' }));
    if (cuts.some(cut => cut.desde > 0 || cut.hasta < 100)) cell.ocupacion = cuts;
    if (instant.getTime() <= now) cell.motivo = 'pasado';
    else if (available.has(instant.getTime())) {
      cell.estado = 'available'; cell.citaId = available.get(instant.getTime())!.id;
    }
    else if (occupied.some(appointment => {
      const duration = durationOf(appointment);
      return duration ? overlaps(instant, endOf(instant, rowEndMinute(timeMinutes(hora), configuration) - timeMinutes(hora)), appointment.fecha_hora, endOf(appointment.fecha_hora, duration)) : instant.getTime() === appointment.fecha_hora.getTime();
    })) cell.estado = 'reserved';
    else if (blocked.some(block => block.inicio <= instant && instant < block.fin)) cell.motivo = 'bloqueado';
    else {
      const candidate = published.get(instant.getTime());
      cell.motivo = !candidate ? 'sin_publicar' : intervalIssue(instant, configuration.blockMinutes, intervals) === 'unverified' ? 'agenda' : 'duracion';
    }
    horarios.push(cell);
  }
  return { citas, calendario: { dias, horas, horarios, configuracion: configuration, zonaHoraria: BUSINESS_TIME_ZONE, consultadoEn: new Date(now).toISOString() } };
}
