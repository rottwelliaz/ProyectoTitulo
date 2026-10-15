import { Cita, CitaEstado, Prisma } from '@prisma/client';
import { ScheduleError, durationOf, endOf } from './schedule';

export type Actor = { id: number; rol: string };

export async function requireBookableProfessional(tx: Prisma.TransactionClient, barberId: number) {
  // Coordinate with account approval/deactivation, including direct administrative updates.
  await tx.$queryRaw`SELECT u."id" FROM "User" u
    JOIN "BarberProfile" p ON p."usuarioId" = u."id"
    WHERE p."id" = ${barberId} FOR SHARE OF u`;
  const profile = await tx.barberProfile.findUnique({
    where: { id: barberId },
    include: { usuario: { select: { id: true, rol: true, aprobado: true, activo: true } } },
  });
  if (!profile) throw new ScheduleError(404, 'Profesional no encontrado');
  if (profile.usuario.rol !== 'barbero') throw new ScheduleError(409, 'El profesional seleccionado no tiene rol Barbero');
  if (!profile.usuario.activo) throw new ScheduleError(409, 'El profesional está deshabilitado');
  if (!profile.usuario.aprobado) throw new ScheduleError(409, 'El profesional no está aprobado para recibir reservas');
  return profile;
}

export function assertReservationAccess(cita: { clienteId: number | null; barbero: { usuarioId: number } }, actor: Actor) {
  if (actor.rol === 'admin' ||
      (actor.rol === 'cliente' && cita.clienteId === actor.id) ||
      (actor.rol === 'barbero' && cita.barbero.usuarioId === actor.id)) return;
  throw new ScheduleError(403, 'No autorizado para acceder a esta reserva');
}

const transitions: Partial<Record<CitaEstado, CitaEstado[]>> = {
  pendiente: ['confirmada', 'rechazada', 'cancelada'],
  confirmada: ['cancelada', 'finalizada', 'inasistencia'],
};

export function validateTransition(
  cita: Pick<Cita, 'estado' | 'fecha_hora' | 'duracionReservada'> & { servicio: { duracion_minutos: number } | null },
  target: CitaEstado, actor: Actor, now = new Date(),
) {
  if (!['cliente', 'barbero', 'admin'].includes(actor.rol) || (actor.rol === 'cliente' && target !== 'cancelada')) {
    throw new ScheduleError(403, 'Tu rol no permite este cambio de estado');
  }
  if (!transitions[cita.estado]?.includes(target)) throw new ScheduleError(409, `No se puede cambiar una reserva ${cita.estado} a ${target}`);
  if (['confirmada', 'rechazada', 'cancelada'].includes(target) && cita.fecha_hora <= now) {
    throw new ScheduleError(409, 'No puedes confirmar, rechazar ni cancelar una cita pasada o iniciada');
  }
  if (target === 'finalizada' || target === 'inasistencia') {
    const duration = durationOf(cita);
    if (!duration || endOf(cita.fecha_hora, duration) > now) {
      throw new ScheduleError(409, 'Debes esperar al término del intervalo para finalizar o marcar inasistencia');
    }
  }
}

// Keep the existing response shape while ensuring the UI reads historical values.
export function historicalAppointment<T extends {
  nombreServicioReservado: string | null; precioReservado: number | null;
  duracionReservada: number | null; servicioId: string | null; servicio?: unknown;
}>(cita: T) {
  return { ...cita, servicio: cita.nombreServicioReservado === null ? null : {
    id: cita.servicioId, nombre_servicio: cita.nombreServicioReservado,
    precio: cita.precioReservado, duracion_minutos: cita.duracionReservada,
  } };
}

export async function freezeServiceHistory(tx: Prisma.TransactionClient, service: {
  id: string; nombre_servicio: string; precio: number; duracion_minutos: number;
}) {
  // Fill only missing snapshots. Never overwrite a price/duration already agreed upon.
  for (const [field, value] of Object.entries({
    nombreServicioReservado: service.nombre_servicio,
    precioReservado: service.precio,
    duracionReservada: service.duracion_minutos,
  })) {
    await tx.cita.updateMany({
      where: { servicioId: service.id, estado: { not: 'disponible' }, [field]: null },
      data: { [field]: value },
    });
  }
}
