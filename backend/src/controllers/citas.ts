import { Response } from 'express';
import { CitaEstado } from '@prisma/client';
import prisma from '../config/prisma';
import { AuthRequest } from '../middleware/auth';
import { ScheduleError, withSchedule, validateInterval, durationOf, scheduleFailure } from '../services/schedule';
import { availabilitySnapshot, configurationValidation } from '../services/availability';
import { parseInstant, businessRange, checkRangeEnd } from '../services/businessTime';
import { bankingSelect } from '../services/professionalPrivacy';
import { paymentAccess, PaymentAccessLimit } from '../services/paymentAccess';
import { requireBookableProfessional, assertReservationAccess, validateTransition, historicalAppointment } from '../services/reservationLifecycle';
import { normalizePaymentProof } from '../services/paymentProof';

// ─── Helpers ────────────────────────────────────────────────────────────────

const getOwnBarberProfile = async (userId: number) => {
  return prisma.barberProfile.findUnique({
    where: { usuarioId: userId },
  });
};

const isValidAvailabilityBlock = (date: Date): boolean =>
  date.getUTCMinutes() % 5 === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;

const isFutureDate = (date: Date): boolean => date.getTime() > Date.now();

const validWindow = (start: Date, end: Date) =>
  isValidAvailabilityBlock(start) && isValidAvailabilityBlock(end) && end > start && end.getTime() - start.getTime() <= 86400000;

const appointmentError = (res: Response, error: unknown, fallback: string) => {
  if (error instanceof RangeError) return res.status(400).json({ message: error.message });
  const failure = scheduleFailure(error);
  if (failure) return res.status(failure.status).json({ message: failure.message });
  console.error(fallback, error);
  return res.status(500).json({ message: fallback });
};

// ─── Fase 1: Gestión del Barbero ────────────────────────────────────────────

export const createCita = async (req: AuthRequest, res: Response) => {
  try {
    const start = parseInstant(req.body.fecha_hora);
    const end = parseInstant(req.body.fin_hora);
    if (!validWindow(start, end) || !isFutureDate(start)) return res.status(400).json({ message: 'Indica inicio y fin futuros válidos para la disponibilidad' });
    const profile = await getOwnBarberProfile(req.user!.id);
    if (!profile) return res.status(404).json({ message: 'No tienes perfil de barbero creado' });
    const result = await withSchedule(profile.id, async tx => {
      await requireBookableProfessional(tx, profile.id);
      const existing = await tx.cita.findFirst({ where: { barberoId: profile.id, fecha_hora: start, estado: CitaEstado.disponible } });
      if (existing) throw new ScheduleError(409, 'Ya existe disponibilidad en ese horario');
      return tx.cita.create({ data: { barberoId: profile.id, fecha_hora: start, disponibleHasta: end, estado: CitaEstado.disponible } });
    });
    return res.status(201).json(result);
  } catch (error) { return appointmentError(res, error, 'Error al crear disponibilidad'); }
};

export const updateCita = async (req: AuthRequest, res: Response) => {
  try {
    const start = parseInstant(req.body.fecha_hora);
    if (!isValidAvailabilityBlock(start) || !isFutureDate(start)) return res.status(400).json({ message: 'La nueva fecha debe ser futura y válida' });
    const profile = await getOwnBarberProfile(req.user!.id);
    if (!profile) return res.status(404).json({ message: 'No tienes perfil de barbero creado' });
    const result = await withSchedule(profile.id, async tx => {
      await requireBookableProfessional(tx, profile.id);
      const cita = await tx.cita.findUnique({ where: { id: req.params.id }, include: { servicio: true } });
      if (!cita) throw new ScheduleError(404, 'Cita no encontrada');
      if (cita.barberoId !== profile.id) throw new ScheduleError(403, 'No autorizado para editar esta cita');
      if (cita.estado === CitaEstado.disponible) {
        const end = parseInstant(req.body.fin_hora);
        if (!validWindow(start, end)) throw new ScheduleError(400, 'Indica el fin del bloque disponible');
        const duplicate = await tx.cita.findFirst({ where: { barberoId: profile.id, fecha_hora: start, estado: CitaEstado.disponible, NOT: { id: cita.id } } });
        if (duplicate) throw new ScheduleError(409, 'Ya existe disponibilidad en ese horario');
        return tx.cita.update({ where: { id: cita.id }, data: { fecha_hora: start, disponibleHasta: end } });
      }
      if (cita.estado !== CitaEstado.pendiente && cita.estado !== CitaEstado.confirmada) throw new ScheduleError(409, 'Solo puedes mover una reserva pendiente o confirmada');
      if (!isFutureDate(cita.fecha_hora)) throw new ScheduleError(409, 'No puedes reprogramar una cita pasada o iniciada');
      const duration = durationOf(cita);
      if (!duration) throw new ScheduleError(409, 'La reserva no tiene una duración verificable');
      await validateInterval(tx, profile.id, start, duration, cita.id);
      return tx.cita.update({ where: { id: cita.id }, data: { fecha_hora: start, duracionReservada: duration } });
    });
    return res.json(result);
  } catch (error) { return appointmentError(res, error, 'Error al editar cita'); }
};

export const deleteCita = async (req: AuthRequest, res: Response) => {
  try {
    const profile = await getOwnBarberProfile(req.user!.id);
    if (!profile) return res.status(404).json({ message: 'No tienes perfil de barbero creado' });
    await withSchedule(profile.id, async tx => {
      const cita = await tx.cita.findUnique({ where: { id: req.params.id } });
      if (!cita) throw new ScheduleError(404, 'Cita no encontrada');
      if (cita.barberoId !== profile.id) throw new ScheduleError(403, 'No autorizado para eliminar esta cita');
      if (cita.estado !== CitaEstado.disponible) throw new ScheduleError(409, 'Las reservas se conservan en el historial; utiliza la cancelación');
      await tx.cita.delete({ where: { id: cita.id } });
    });
    return res.status(204).send();
  } catch (error) { return appointmentError(res, error, 'Error al eliminar disponibilidad'); }
};

// ─── Fase 2: Interacción del Cliente ────────────────────────────────────────

export const saveWeekAvailability = async (req: AuthRequest, res: Response) => {
  try {
    const { fechaInicio, fechaFin, bloques } = req.body;
    const { start: weekStart, end: weekEnd } = businessRange(fechaInicio, 7);
    checkRangeEnd(fechaFin, weekEnd);
    const hours = (weekEnd.getTime() - weekStart.getTime()) / 3600000;
    if (!Array.isArray(bloques) || bloques.length > 1008 || !Number.isFinite(hours) || hours < 167 || hours > 169) {
      return res.status(400).json({ message: 'Indica una semana válida y hasta 1008 bloques con inicio y fin' });
    }
    const windows = bloques.map((block: { inicio?: string; fin?: string } | null) => ({
      fecha_hora: parseInstant(block?.inicio), disponibleHasta: parseInstant(block?.fin),
    }));
    if (windows.some(window => !validWindow(window.fecha_hora, window.disponibleHasta) || !isFutureDate(window.fecha_hora) || window.fecha_hora < weekStart || window.disponibleHasta > weekEnd)) {
      return res.status(400).json({ message: 'Cada bloque debe tener inicio y fin futuros dentro de la semana; vuelve a publicar la agenda' });
    }
    const unique = [...new Map(windows.map(window => [window.fecha_hora.getTime(), window])).values()];
    if (unique.length !== windows.length) return res.status(400).json({ message: 'No repitas el inicio de un bloque disponible' });
    const blockedInput = req.body.bloqueos;
    if (blockedInput !== undefined && (!Array.isArray(blockedInput) || blockedInput.length > 1008)) throw new RangeError('Indica hasta 1008 bloqueos válidos');
    const blocked = (blockedInput ?? []).map((block: { inicio?: string; fin?: string; tipo?: string } | null) => ({
      inicio: parseInstant(block?.inicio), fin: parseInstant(block?.fin), tipo: block?.tipo ?? '', origen: 'agenda',
    })) as { inicio: Date; fin: Date; tipo: string; origen: string }[];
    if (blocked.some(block => !validWindow(block.inicio, block.fin) || !isFutureDate(block.inicio) || block.inicio < weekStart || block.fin > weekEnd || !['bloqueado', 'descanso'].includes(block.tipo))) throw new RangeError('Los bloqueos deben ser futuros, válidos y estar dentro de la semana');
    if (blocked.some(block => windows.some(window => block.inicio < window.disponibleHasta && window.fecha_hora < block.fin))) throw new RangeError('Un intervalo no puede estar disponible y bloqueado a la vez');
    const profile = await getOwnBarberProfile(req.user!.id);
    if (!profile) return res.status(404).json({ message: 'No tienes perfil de barbero creado' });
    const citas = await withSchedule(profile.id, async tx => {
      await requireBookableProfessional(tx, profile.id);
      if (typeof req.body.revision !== 'string') throw new ScheduleError(428, 'Carga la semana antes de guardarla');
      const snapshot = await availabilitySnapshot(tx, profile.id, weekStart, weekEnd);
      if (req.body.revision !== snapshot.revision) throw new ScheduleError(409, 'La agenda cambió en otro dispositivo o recibió una reserva. Recarga la semana y revisa los cambios antes de guardar.');
      const { error, value: configuracion } = configurationValidation.validate(req.body.configuracion);
      if (error || !configuracion) throw new ScheduleError(400, 'Indica una configuración de horarios válida');
      // Availability is independent of reservations. Existing appointments are never deleted.
      // Reject boundary-crossing windows rather than silently changing an adjacent week.
      const crossing = await tx.cita.findFirst({ where: { barberoId: profile.id, estado: CitaEstado.disponible, OR: [
        { fecha_hora: { lt: weekStart }, disponibleHasta: { gt: weekStart } },
        { fecha_hora: { lt: weekEnd }, disponibleHasta: { gt: weekEnd } },
      ] } });
      if (crossing) throw new ScheduleError(409, 'Hay un bloque que cruza el límite de la semana; ajústalo antes de publicar');
      await tx.cita.deleteMany({ where: { barberoId: profile.id, estado: CitaEstado.disponible, fecha_hora: { gte: weekStart, lt: weekEnd } } });
      if (windows.length) await tx.cita.createMany({ data: windows.map(window => ({ ...window, barberoId: profile.id, estado: CitaEstado.disponible })) });
      if (blockedInput !== undefined) {
        const crossingBlock = await tx.agendaBloqueo.findFirst({ where: { barberoId: profile.id, origen: 'agenda', OR: [
          { inicio: { lt: weekStart }, fin: { gt: weekStart } }, { inicio: { lt: weekEnd }, fin: { gt: weekEnd } },
        ] } });
        if (crossingBlock) throw new ScheduleError(409, 'Hay un bloqueo que cruza el límite de la semana; ajústalo antes de publicar');
        await tx.agendaBloqueo.deleteMany({ where: { barberoId: profile.id, origen: 'agenda', inicio: { gte: weekStart, lt: weekEnd } } });
        if (blocked.length) await tx.agendaBloqueo.createMany({ data: blocked.map(block => ({ ...block, barberoId: profile.id })) });
      }
      await tx.agendaSemana.upsert({ where: { barberoId_inicio: { barberoId: profile.id, inicio: weekStart } },
        create: { barberoId: profile.id, inicio: weekStart, configuracion }, update: { configuracion, revision: { increment: 1 } } });
      return tx.cita.findMany({ where: { barberoId: profile.id, estado: CitaEstado.disponible, fecha_hora: { gte: weekStart, lt: weekEnd } }, orderBy: { fecha_hora: 'asc' } });
    });
    return res.json({ citas, omittedOccupiedBlocks: 0 });
  } catch (error) { return appointmentError(res, error, 'Error al guardar la disponibilidad semanal'); }
};
export const getDisponibilidad = async (req: AuthRequest, res: Response) => {
  res.set('Cache-Control', 'no-store');
  try {
    const barberId = Number(req.params.barberoId);
    const { start, end } = businessRange(req.query.fecha ?? req.query.desde);
    checkRangeEnd(req.query.desde, start);
    checkRangeEnd(req.query.hasta, end);
    if (!Number.isInteger(barberId) || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end.getTime() - start.getTime() > 25 * 3600000) {
      return res.status(400).json({ message: 'Indica un profesional y un día válidos' });
    }
    const result = await withSchedule(barberId, async tx => {
      await requireBookableProfessional(tx, barberId);
      const servicios = await tx.service.findMany({ where: { perfilBarberoId: barberId, activo: true } });
      const serviceId = typeof req.query.servicioId === 'string' ? req.query.servicioId : null;
      const services = serviceId ? servicios.filter(service => service.id === serviceId) : servicios;
      if (serviceId && !services.length) throw new ScheduleError(404, 'Servicio no encontrado para este profesional');
      const candidates = await tx.cita.findMany({ where: { barberoId: barberId, estado: CitaEstado.disponible, disponibleHasta: { not: null }, fecha_hora: { gte: new Date(Math.max(start.getTime(), Date.now())), lt: end } }, orderBy: { fecha_hora: 'asc' } });
      const citas = [];
      for (const candidate of candidates) {
        for (const service of services) {
          try {
            await validateInterval(tx, barberId, candidate.fecha_hora, service.duracion_minutos);
            citas.push(candidate);
            break;
          } catch (error) { if (!(error instanceof ScheduleError && error.status === 409)) throw error; }
        }
      }
      return {
        citas: citas.map(({ id, fecha_hora, disponibleHasta }) => ({ id, fecha_hora, disponibleHasta })),
        servicios: servicios.map(({ id, nombre_servicio, descripcion, precio, duracion_minutos }) => ({ id, nombre_servicio, descripcion, precio, duracion_minutos })),
      };
    });
    return res.json(result);
  } catch (error) { return appointmentError(res, error, 'Error al obtener disponibilidad'); }
};

export const getBarberosParaReserva = async (_req: AuthRequest, res: Response) => {
  try {
    const barberos = await prisma.barberProfile.findMany({
      where: {
        usuario: { rol: 'barbero', aprobado: true, activo: true },
        lugarTrabajoId: { not: null },
      },
      select: {
        id: true,
        biografia: true,
        foto_perfil: true,
        usuario: {
          select: {
            id: true,
            nombre: true,
          },
        },
        lugarTrabajo: {
          select: {
            id: true,
            nombre_barberia: true,
            direccion: true,
          },
        },
        requiereComprobante: true,
        servicios: {
          where: { activo: true },
          select: {
            id: true,
            nombre_servicio: true,
            descripcion: true,
            precio: true,
            duracion_minutos: true,
          },
          orderBy: { nombre_servicio: 'asc' },
        },
      },
      orderBy: {
        usuario: { nombre: 'asc' },
      },
    });

    return res.json(barberos);
  } catch (error) {
    console.error('getBarberosParaReserva error', error);
    return res.status(500).json({ message: 'Error al obtener barberos para reservar' });
  }
};

export const getPaymentDetails = async (req: AuthRequest, res: Response) => {
  res.set('Cache-Control', 'no-store');
  try {
    if (req.user?.rol !== 'cliente') return res.status(403).json({ message: 'Solo el cliente puede iniciar el pago de una reserva' });
    paymentAccess.attempt(req.user.id);
    const { servicioId } = req.body ?? {};
    if (typeof servicioId !== 'string' || !servicioId.trim() || Object.keys(req.body).some(key => key !== 'servicioId')) {
      return res.status(400).json({ message: 'Selecciona un único horario y servicio para continuar al pago' });
    }
    const reference = await prisma.cita.findUnique({ where: { id: req.params.id }, select: { barberoId: true } });
    if (!reference) return res.status(404).json({ message: 'Horario no encontrado' });
    const details = await withSchedule(reference.barberoId, async tx => {
      const slot = await tx.cita.findUnique({ where: { id: req.params.id } });
      if (!slot || slot.estado !== CitaEstado.disponible || !isFutureDate(slot.fecha_hora) || !slot.disponibleHasta) {
        throw new ScheduleError(409, 'El horario ya no está disponible');
      }
      const service = await tx.service.findUnique({ where: { id: servicioId.trim() } });
      if (!service || !service.activo || service.perfilBarberoId !== slot.barberoId) throw new ScheduleError(404, 'Servicio no disponible para este horario');
      await validateInterval(tx, slot.barberoId, slot.fecha_hora, service.duracion_minutos);
      const profile = await tx.barberProfile.findFirst({
        where: { id: slot.barberoId, requiereComprobante: true, usuario: { rol: 'barbero', aprobado: true, activo: true } },
        select: bankingSelect,
      });
      if (!profile) throw new ScheduleError(403, 'Este profesional no tiene habilitado el pago con comprobante');
      if (Object.values(profile).some(value => !value?.trim())) throw new ScheduleError(409, 'El profesional aún no ha completado sus datos para recibir transferencias');
      paymentAccess.disclose(req.user!.id, slot.barberoId);
      return { citaId: slot.id, servicioId: service.id, barberoId: slot.barberoId, ...profile };
    });
    return res.json(details);
  } catch (error) {
    if (error instanceof PaymentAccessLimit) {
      res.set('Retry-After', String(error.retryAfter));
      return res.status(429).json({ message: error.message });
    }
    return appointmentError(res, error, 'No se pudieron obtener los datos de pago');
  }
};

export const getReservationCalendar = async (req: AuthRequest, res: Response) => {
  try {
    const { fechaInicio } = req.query;
    if (!fechaInicio || typeof fechaInicio !== 'string') {
      return res.status(400).json({ message: 'fechaInicio es requerido (YYYY-MM-DD)' });
    }

    const { start: weekStart, end: weekEnd } = businessRange(fechaInicio, 7);

    const barberProfile = await getOwnBarberProfile(req.user!.id);
    if (!barberProfile) {
      return res.status(404).json({ message: 'No tienes perfil de barbero creado' });
    }

    const citas = await prisma.cita.findMany({
      where: {
        barberoId: barberProfile.id,
        estado: { in: [CitaEstado.disponible, CitaEstado.pendiente, CitaEstado.confirmada] },
        fecha_hora: { gte: weekStart, lt: weekEnd },
      },
      include: {
        cliente: {
          select: { id: true, nombre: true, telefono: true },
        },
        servicio: {
          select: { id: true, nombre_servicio: true, duracion_minutos: true },
        },
      },
      orderBy: { fecha_hora: 'desc' },
    });

    return res.json(citas.map(historicalAppointment));
  } catch (error) {
    return appointmentError(res, error, 'Error al obtener el calendario de reservas');
  }
};

export const getClientAppointments = async (req: AuthRequest, res: Response) => {
  try {
    const citas = await prisma.cita.findMany({
      where: {
        clienteId: req.user!.id,
        estado: {
          not: CitaEstado.disponible,
        },
      },
      include: {
        barbero: {
          select: {
            id: true,
            usuario: { select: { id: true, nombre: true } },
            lugarTrabajo: {
              select: { id: true, nombre_barberia: true, direccion: true },
            },
          },
        },
        servicio: {
          select: {
            id: true,
            nombre_servicio: true,
            duracion_minutos: true,
            precio: true,
          },
        },
      },
      orderBy: { fecha_hora: 'asc' },
    });

    return res.json(citas.map(historicalAppointment));
  } catch (error) {
    console.error('getClientAppointments error', error);
    return res.status(500).json({ message: 'Error al obtener tus citas' });
  }
};

export const cancelClientAppointment = async (req: AuthRequest, res: Response) => {
  // The client route cannot select another target status through the request body.
  req.body = { estado: CitaEstado.cancelada };
  return updateAppointmentStatus(req, res);
};
export const getMyAppointments = async (req: AuthRequest, res: Response) => {
  try {
    const barberProfile = await getOwnBarberProfile(req.user!.id);
    if (!barberProfile) {
      return res.status(404).json({ message: 'No tienes perfil de barbero creado' });
    }

    const citas = await prisma.cita.findMany({
      where: {
        barberoId: barberProfile.id,
        estado: { not: CitaEstado.disponible },
      },
      include: {
        cliente: {
          select: {
            id: true,
            nombre: true,
            telefono: true,
          },
        },
        servicio: {
          select: {
            id: true,
            nombre_servicio: true,
            duracion_minutos: true,
          },
        },
      },
      orderBy: { fecha_hora: 'asc' },
    });

    return res.json(citas.map(historicalAppointment));
  } catch (error) {
    console.error('getMyAppointments error', error);
    return res.status(500).json({ message: 'Error al obtener tus citas' });
  }
};

export const updateAppointmentStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { estado } = req.body ?? {};
    if (!['confirmada', 'rechazada', 'cancelada', 'finalizada', 'inasistencia'].includes(estado)) {
      return res.status(400).json({ message: 'Estado de reserva inválido' });
    }
    const reference = await prisma.cita.findUnique({ where: { id: req.params.id }, select: { barberoId: true } });
    if (!reference) return res.status(404).json({ message: 'Cita no encontrada' });
    const updated = await withSchedule(reference.barberoId, async tx => {
      const cita = await tx.cita.findUnique({ where: { id: req.params.id }, include: { servicio: true, barbero: { select: { usuarioId: true } } } });
      if (!cita) throw new ScheduleError(404, 'Cita no encontrada');
      assertReservationAccess(cita, req.user!);
      validateTransition(cita, estado, req.user!);
      if (estado === CitaEstado.confirmada) await requireBookableProfessional(tx, cita.barberoId);
      // The existing profile lock serializes scheduling and status changes. The
      // conditional write also rejects a stale state instead of overwriting it.
      const changed = await tx.cita.updateMany({ where: { id: cita.id, estado: cita.estado }, data: { estado } });
      if (changed.count !== 1) throw new ScheduleError(409, 'La reserva cambió; actualiza e inténtalo nuevamente');
      await tx.citaCambioEstado.create({ data: {
        citaId: cita.id, estadoAnterior: cita.estado, estadoNuevo: estado, responsableId: req.user!.id,
      } });
      // Never recreate availability: a withdrawn window must stay withdrawn.
      return tx.cita.findUniqueOrThrow({ where: { id: cita.id }, include: {
        cliente: { select: { id: true, nombre: true, telefono: true } }, servicio: true,
        barbero: { select: { id: true, usuario: { select: { id: true, nombre: true } }, lugarTrabajo: true } },
      } });
    });
    return res.json(historicalAppointment(updated));
  } catch (error) { return appointmentError(res, error, 'Error al actualizar el estado de la cita'); }
};

export const getAppointmentHistory = async (req: AuthRequest, res: Response) => {
  try {
    const cita = await prisma.cita.findUnique({ where: { id: req.params.id },
      include: { barbero: { select: { usuarioId: true } } } });
    if (!cita) throw new ScheduleError(404, 'Cita no encontrada');
    assertReservationAccess(cita, req.user!);
    const history = await prisma.citaCambioEstado.findMany({
      where: { citaId: cita.id }, orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
      select: { id: true, estadoAnterior: true, estadoNuevo: true, fecha: true, responsableId: true, origen: true },
    });
    return res.json(history);
  } catch (error) { return appointmentError(res, error, 'Error al obtener historial de la reserva'); }
};
export const agendarCita = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    let { servicioId, comprobanteTransferencia, comprobanteNombre } = req.body ?? {};
    if (typeof servicioId !== 'string' || !servicioId.trim()) return res.status(400).json({ message: 'servicioId es requerido' });
    servicioId = servicioId.trim();
    const proof = typeof comprobanteTransferencia === 'string' && comprobanteTransferencia.trim()
      ? await normalizePaymentProof(comprobanteTransferencia.trim()) : null;
    const reference = await prisma.cita.findUnique({ where: { id }, select: { barberoId: true } });
    if (!reference) return res.status(404).json({ message: 'Cita no encontrada' });
    const booked = await withSchedule(reference.barberoId, async tx => {
      // Re-read everything after obtaining the database lock, never trust an earlier read.
      const cita = await tx.cita.findUnique({ where: { id }, include: { barbero: { include: { usuario: true } } } });
      if (!cita) throw new ScheduleError(404, 'El horario ya no está publicado');
      if (cita.estado !== CitaEstado.disponible || !isFutureDate(cita.fecha_hora)) throw new ScheduleError(409, 'Esta cita ya no está disponible');
      await requireBookableProfessional(tx, cita.barberoId);
      const hasProof = Boolean(proof);
      if (cita.barbero.requiereComprobante && !hasProof) throw new ScheduleError(400, 'Este profesional requiere un comprobante de transferencia');
      if (hasProof) {
        comprobanteTransferencia = proof;
        comprobanteNombre = typeof comprobanteNombre === 'string' && comprobanteNombre.trim() ? comprobanteNombre.trim().slice(0, 180) : 'comprobante-transferencia';
      } else { comprobanteTransferencia = null; comprobanteNombre = null; }
      const service = await tx.service.findUnique({ where: { id: servicioId } });
      if (!service || !service.activo) throw new ScheduleError(404, 'Servicio no disponible');
      if (service.perfilBarberoId !== cita.barberoId) throw new ScheduleError(403, 'El servicio seleccionado no pertenece al barbero de esta cita');
      if (!cita.disponibleHasta) throw new ScheduleError(409, 'El profesional debe volver a publicar este horario con su duración disponible');
      await validateInterval(tx, cita.barberoId, cita.fecha_hora, service.duracion_minutos);
      // Keep published availability independent: cancelling never invents or reopens a blocked window.
      return tx.cita.create({ data: {
        barberoId: cita.barberoId, fecha_hora: cita.fecha_hora,
        clienteId: req.user!.id, servicioId, duracionReservada: service.duracion_minutos,
        nombreServicioReservado: service.nombre_servicio, precioReservado: service.precio,
        cambiosEstado: { create: { estadoAnterior: null, estadoNuevo: CitaEstado.confirmada, responsableId: req.user!.id } },
        comprobanteTransferencia, comprobanteNombre, estado: CitaEstado.confirmada,
      } });
    });
    return res.json(booked);
  } catch (error) { return appointmentError(res, error, 'Error al agendar cita'); }
};
