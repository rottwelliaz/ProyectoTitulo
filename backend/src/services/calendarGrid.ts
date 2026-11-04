import { Temporal } from '@js-temporal/polyfill';
import { Prisma } from '@prisma/client';
import { businessDate, businessRange, businessTime, slotInstant } from './businessTime';
import { configurationValidation, defaultConfiguration } from './availability';

export type CalendarConfiguration = typeof defaultConfiguration;
export const timeMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export const minuteTime = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
export function gridMinutes(config: CalendarConfiguration) {
  const result: number[] = [];
  if (![30, 45, 60].includes(config.blockMinutes)) return result;
  for (let minute = timeMinutes(config.startTime); minute + config.blockMinutes <= timeMinutes(config.endTime); minute += config.blockMinutes) result.push(minute);
  return result;
}
export function rowEndMinute(minute: number, config: CalendarConfiguration) {
  return minute >= timeMinutes(config.startTime) && minute < timeMinutes(config.endTime)
    ? Math.min(minute + config.blockMinutes, timeMinutes(config.endTime)) : Math.min(minute + config.blockMinutes, 1440);
}
export async function calendarConfiguration(tx: Prisma.TransactionClient, barberId: number, day: string) {
  const date = Temporal.PlainDate.from(day);
  const monday = date.subtract({ days: date.dayOfWeek - 1 }).toString();
  const semana = await tx.agendaSemana.findUnique({ where: { barberoId_inicio: { barberoId: barberId, inicio: businessRange(monday).start } }, select: { configuracion: true } });
  const validation = configurationValidation.validate(semana?.configuracion);
  const configuration: CalendarConfiguration = semana && !validation.error && validation.value ? validation.value : defaultConfiguration;
  return { configuration, published: Boolean(semana) };
}
export function onGrid(start: Date, config: CalendarConfiguration) {
  const minute = timeMinutes(businessTime(start));
  return gridMinutes(config).includes(minute) && +slotInstant(businessDate(start), minuteTime(minute)) === +start;
}

// Only complete blocks belong to the grid. Ending exactly at closing is valid.
export function bookingBlockMinutes(start: Date, config: CalendarConfiguration): number | null {
  if (!onGrid(start, config)) return null;
  return timeMinutes(businessTime(start)) + config.blockMinutes <= timeMinutes(config.endTime)
    ? config.blockMinutes : null;
}

export function bookingInterval(start: Date, config: CalendarConfiguration) {
  const minutes = bookingBlockMinutes(start, config);
  return minutes ? { start, end: new Date(+start + minutes * 60_000), minutes } : null;
}
