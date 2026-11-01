import { Temporal } from '@js-temporal/polyfill';
import { Prisma } from '@prisma/client';
import { configurationValidation, defaultConfiguration } from './availability';
import { BUSINESS_TIME_ZONE, businessDate, businessTime, slotInstant } from './businessTime';
import { activeStates, durationOf, endOf, intervalIssue, type ScheduleIntervals } from './schedule';

interface CalendarCell {
  fecha: string;
  hora: string;
  fecha_hora: string | null;
  estado: 'available' | 'reserved' | 'unavailable';
  citaId?: string;
  motivo?: 'pasado' | 'bloqueado' | 'duracion' | 'sin_publicar' | 'agenda' | 'hora_invalida';
}

// Only explicitly selected scheduling fields enter this public projection.
// Never load customer identities, reservation IDs, payment proofs or bank data.
export async function publicAvailability(
  tx: Prisma.TransactionClient, barberId: number, start: Date, end: Date,
  services: { duracion_minutos: number }[], weekly: boolean,
) {
  if (weekly && Temporal.PlainDate.from(businessDate(start)).dayOfWeek !== 1) throw new RangeError('La semana debe comenzar el lunes');
  // A service beginning near midnight can extend into the next day/week.
  // Load that context as well, without exposing starts outside the requested period.
  const maxDuration = services.reduce((max, service) => Number.isInteger(service.duracion_minutos) && service.duracion_minutos > max ? service.duracion_minutos : max, 0);
  const contextEnd = endOf(end, maxDuration);
  const windows = await tx.cita.findMany({
    where: { barberoId: barberId, estado: 'disponible', fecha_hora: { lt: contextEnd }, disponibleHasta: { gt: start } },
    select: { id: true, fecha_hora: true, disponibleHasta: true }, orderBy: { fecha_hora: 'asc' },
  });
  const occupied = await tx.cita.findMany({
    where: { barberoId: barberId, estado: { in: activeStates }, fecha_hora: { lt: contextEnd } },
    select: { fecha_hora: true, duracionReservada: true, servicio: { select: { duracion_minutos: true } } },
  });
  const blocked = await tx.agendaBloqueo.findMany({
    where: { barberoId: barberId, inicio: { lt: contextEnd }, fin: { gt: start } }, select: { inicio: true, fin: true },
  });
  const intervals: ScheduleIntervals = { windows, occupied, blocked };
  const now = Date.now();
  const candidates = windows.filter(window => window.fecha_hora >= start && window.fecha_hora < end && window.fecha_hora.getTime() > now);
  const citas = candidates.filter(candidate => services.some(service =>
    intervalIssue(candidate.fecha_hora, service.duracion_minutos, intervals) === null));
  if (!weekly) return { citas };

  const semana = await tx.agendaSemana.findUnique({
    where: { barberoId_inicio: { barberoId: barberId, inicio: start } }, select: { configuracion: true },
  });
  const validation = configurationValidation.validate(semana?.configuracion);
  const configuration: typeof defaultConfiguration = semana && validation.value && !validation.error ? validation.value : defaultConfiguration;
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const format = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  const times = new Set<string>();
  for (let minute = minutes(configuration.startTime); minute < minutes(configuration.endTime); minute += configuration.blockMinutes) times.add(format(minute));
  const include = (instant: Date) => {
    if (instant >= start && instant < end) times.add(businessTime(instant));
  };
  windows.forEach(window => { if (window.fecha_hora >= start) include(window.fecha_hora); });
  // Preserve irregular and cross-day appointments, even after a timetable change.
  occupied.forEach(appointment => {
    const duration = durationOf(appointment);
    if (duration && endOf(appointment.fecha_hora, duration) <= start) return;
    include(appointment.fecha_hora);
    if (duration && businessTime(endOf(appointment.fecha_hora, duration)) < configuration.endTime) include(endOf(appointment.fecha_hora, duration));
  });
  blocked.forEach(block => {
    if (businessTime(block.inicio) >= configuration.startTime && businessTime(block.inicio) < configuration.endTime) include(block.inicio);
    if (businessTime(block.fin) >= configuration.startTime && businessTime(block.fin) < configuration.endTime) include(block.fin);
  });
  const dias = Array.from({ length: 7 }, (_, index) => Temporal.PlainDate.from(businessDate(start)).add({ days: index }).toString());
  const horas = [...times].sort();
  const available = new Map(citas.map(cita => [cita.fecha_hora.getTime(), cita]));
  const published = new Map(windows.map(window => [window.fecha_hora.getTime(), window]));
  const horarios: CalendarCell[] = [];
  for (const fecha of dias) for (const hora of horas) {
    let instant: Date;
    try { instant = slotInstant(fecha, hora); }
    catch { horarios.push({ fecha, hora, fecha_hora: null, estado: 'unavailable', motivo: 'hora_invalida' }); continue; }
    const cell: CalendarCell = { fecha, hora, fecha_hora: instant.toISOString(), estado: 'unavailable' };
    if (instant.getTime() <= now) cell.motivo = 'pasado';
    else if (occupied.some(appointment => {
      const duration = durationOf(appointment);
      return appointment.fecha_hora <= instant && (duration ? instant < endOf(appointment.fecha_hora, duration) : instant.getTime() === appointment.fecha_hora.getTime());
    })) cell.estado = 'reserved';
    else if (blocked.some(block => block.inicio <= instant && instant < block.fin)) cell.motivo = 'bloqueado';
    else if (available.has(instant.getTime())) {
      cell.estado = 'available'; cell.citaId = available.get(instant.getTime())!.id;
    } else {
      const candidate = published.get(instant.getTime());
      cell.motivo = !candidate ? 'sin_publicar' : services.some(service => intervalIssue(instant, service.duracion_minutos, intervals) === 'unverified') ? 'agenda' : 'duracion';
    }
    horarios.push(cell);
  }
  return { citas, calendario: { dias, horas, horarios, zonaHoraria: BUSINESS_TIME_ZONE, consultadoEn: new Date(now).toISOString() } };
}
