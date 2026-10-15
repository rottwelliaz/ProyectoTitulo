import { Temporal } from '@js-temporal/polyfill';

export const BUSINESS_TIME_ZONE = 'America/Santiago';
// Calendar state contains civil YYYY-MM-DD strings, never device-local Dates.
export const businessDate = (instant: Date | string = new Date()) =>
  Temporal.Instant.from(instant instanceof Date ? instant.toISOString() : instant)
    .toZonedDateTimeISO(BUSINESS_TIME_ZONE).toPlainDate().toString();
export const addDays = (day: string, days: number) => Temporal.PlainDate.from(day).add({ days }).toString();
export const addWeeks = (day: string, weeks: number) => addDays(day, weeks * 7);
export const startOfWeek = (day: string) => addDays(day, 1 - Temporal.PlainDate.from(day).dayOfWeek);
export const dayStart = (day: string) => new Date(Temporal.PlainDate.from(day).toZonedDateTime(BUSINESS_TIME_ZONE).epochMilliseconds);
export const formatDay = (day: string, options: Intl.DateTimeFormatOptions) =>
  Temporal.PlainDate.from(day).toLocaleString('es-CL', options);
export const formatInstant = (instant: string | Date, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('es-CL', { ...options, timeZone: BUSINESS_TIME_ZONE }).format(new Date(instant));
export const businessTime = (instant: string | Date) => formatInstant(instant, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// Never silently shift a nonexistent/repeated wall-clock time. If nighttime
// publication is added to the UI, it must let the professional resolve it.
export function slotInstant(day: string, minutes: number): Date {
  const date = Temporal.PlainDate.from(day);
  const time = Temporal.PlainTime.from({ hour: Math.floor(minutes / 60), minute: minutes % 60 }, { overflow: 'reject' });
  return new Date(date.toPlainDateTime(time).toZonedDateTime(BUSINESS_TIME_ZONE, { disambiguation: 'reject' }).epochMilliseconds);
}
