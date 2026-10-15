import { Temporal } from '@js-temporal/polyfill';

export const BUSINESS_TIME_ZONE = 'America/Santiago';

// Date-only inputs are civil dates in Santiago. Instants must include an offset.
export function parseInstant(value: unknown): Date {
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new RangeError('La fecha y hora debe incluir Z o un desplazamiento UTC explícito');
  }
  return new Date(Temporal.Instant.from(value).epochMilliseconds);
}

export function businessDate(value: Date): string {
  return Temporal.Instant.fromEpochMilliseconds(value.getTime()).toZonedDateTimeISO(BUSINESS_TIME_ZONE).toPlainDate().toString();
}

export function businessRange(value: unknown, days = 1): { start: Date; end: Date } {
  if (typeof value !== 'string') throw new RangeError('Indica una fecha válida');
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = Temporal.PlainDate.from(dateOnly ? value : businessDate(parseInstant(value)));
  // Omitting plainTime selects the first real instant of the day, including a
  // Santiago spring transition where 00:00 does not exist.
  const start = new Date(date.toZonedDateTime(BUSINESS_TIME_ZONE).epochMilliseconds);
  const end = new Date(date.add({ days }).toZonedDateTime(BUSINESS_TIME_ZONE).epochMilliseconds);
  if (!dateOnly && parseInstant(value).getTime() !== start.getTime()) {
    throw new RangeError('El inicio debe coincidir con el comienzo del día en America/Santiago');
  }
  return { start, end };
}

export function checkRangeEnd(value: unknown, expected: Date) {
  if (value === undefined) return;
  const actual = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? businessRange(value).start : parseInstant(value);
  if (actual.getTime() !== expected.getTime()) throw new RangeError('El fin no coincide con el período de America/Santiago');
}
