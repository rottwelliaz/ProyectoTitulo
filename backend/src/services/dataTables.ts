import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { ScheduleError } from './schedule';

export const isDataTable = (req: Request) => req.query.datatable === '1';

// Only explicit server-owned names become Prisma order fields. Never use a
// client-supplied object, property path, regex, user id or role as a query.
export function dataTableParams(req: Request, orders: Record<string, object>, defaultOrder: string) {
  const integer = (value: unknown, fallback: number, max: number) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new ScheduleError(400, 'Paginación inválida');
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number > max) throw new ScheduleError(400, 'Paginación inválida');
    return number;
  };
  const draw = integer(req.query.draw, 0, 2147483647);
  const start = integer(req.query.start, 0, 2147483647);
  const length = integer(req.query.length, 10, 50);
  if (![10, 25, 50].includes(length)) throw new ScheduleError(400, 'Tamaño de página inválido');
  const search = (req.query.search as { value?: unknown } | undefined)?.value ?? req.query['search[value]'] ?? '';
  if (typeof search !== 'string' || search.length > 150) throw new ScheduleError(400, 'Búsqueda inválida (máximo 150 caracteres)');
  const order = (req.query.order as unknown as { name?: unknown; dir?: unknown }[] | undefined)?.[0];
  const name = order?.name ?? req.query['order[0][name]'] ?? defaultOrder;
  const dir = order?.dir ?? req.query['order[0][dir]'] ?? 'desc';
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(orders, name) || typeof dir !== 'string' || !['asc', 'desc'].includes(dir)) {
    throw new ScheduleError(400, 'Ordenamiento inválido');
  }
  // The map defines the entire nested Prisma sort shape, including relations.
  const withDirection = (value: object): object => Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, typeof item === 'object' ? withDirection(item) : dir]));
  return { draw, start, length, search: search.trim(), orderBy: [withDirection(orders[name]), { id: 'asc' }] };
}

export async function dataTablePage<T>(params: ReturnType<typeof dataTableParams>, queries: {
  count: (tx: Prisma.TransactionClient, filtered: boolean) => Promise<number>;
  rows: (tx: Prisma.TransactionClient, skip: number, take: number) => Promise<T[]>;
}) {
  return prisma.$transaction(async tx => {
    const recordsTotal = await queries.count(tx, false);
    const recordsFiltered = params.search ? await queries.count(tx, true) : recordsTotal;
    // Deleting the last row of a page returns the previous available page.
    const start = recordsFiltered ? Math.min(params.start, Math.floor((recordsFiltered - 1) / params.length) * params.length) : 0;
    const data = recordsFiltered ? await queries.rows(tx, start, params.length) : [];
    return { draw: params.draw, recordsTotal, recordsFiltered, data, start };
  }, { isolationLevel: 'RepeatableRead' });
}
