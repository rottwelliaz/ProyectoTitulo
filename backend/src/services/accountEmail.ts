import { Prisma } from '@prisma/client';
import { ScheduleError } from './schedule';

// All API email writers share this lock, including edits. Existing accounts are
// preserved verbatim; new addresses cannot duplicate their case variants.
export async function reserveEmail(tx: Prisma.TransactionClient, email: string, excludeId?: number) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(410023)`;
  const existing = await tx.user.findFirst({ where: {
    email: { equals: email, mode: 'insensitive' }, ...(excludeId ? { id: { not: excludeId } } : {}),
  }, select: { id: true } });
  if (existing) throw new ScheduleError(409, 'El correo electrónico ya está registrado');
}
