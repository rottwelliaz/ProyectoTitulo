import { Response } from 'express';
import { CitaEstado } from '@prisma/client';
import prisma from '../config/prisma';
import { AuthRequest } from '../middleware/auth';

// ─── Helpers ────────────────────────────────────────────────────────────────

const getOwnBarberProfile = async (userId: number) => {
  return prisma.barberProfile.findUnique({
    where: { usuarioId: userId },
  });
};

const isExactHourBlock = (date: Date): boolean =>
  date.getMinutes() === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0;

// ─── Fase 1: Gestión del Barbero ────────────────────────────────────────────

export const createCita = async (req: AuthRequest, res: Response) => {
  try {
    const { fecha_hora } = req.body;

    if (!fecha_hora) {
      return res.status(400).json({ message: 'fecha_hora es requerido' });
    }

    const fechaDate = new Date(fecha_hora);
    if (isNaN(fechaDate.getTime())) {
      return res.status(400).json({ message: 'fecha_hora no es una fecha válida' });
    }

    if (!isExactHourBlock(fechaDate)) {
      return res.status(400).json({
        message: 'fecha_hora debe ser un bloque de hora exacta (ej. 14:00:00)',
      });
    }

    const barberProfile = await getOwnBarberProfile(req.user!.id);
    if (!barberProfile) {
      return res.status(404).json({ message: 'No tienes perfil de barbero creado' });
    }

    const existing = await prisma.cita.findFirst({
      where: {
        barberoId: barberProfile.id,
        fecha_hora: fechaDate,
      },
    });

    if (existing) {
      return res.status(409).json({ message: 'Ya existe una cita en ese bloque horario' });
    }

    const cita = await prisma.cita.create({
      data: {
        barberoId: barberProfile.id,
        fecha_hora: fechaDate,
        // clienteId y servicioId quedan null → estado default 'disponible'
      },
    });

    return res.status(201).json(cita);
  } catch (error) {
    console.error('createCita error', error);
    return res.status(500).json({ message: 'Error al crear cita' });
  }
};

export const updateCita = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { fecha_hora } = req.body;

    if (!fecha_hora) {
      return res.status(400).json({ message: 'fecha_hora es requerido' });
    }

    const fechaDate = new Date(fecha_hora);
    if (isNaN(fechaDate.getTime())) {
      return res.status(400).json({ message: 'fecha_hora no es una fecha válida' });
    }

    if (!isExactHourBlock(fechaDate)) {
      return res.status(400).json({
        message: 'fecha_hora debe ser un bloque de hora exacta (ej. 14:00:00)',
      });
    }

    const barberProfile = await getOwnBarberProfile(req.user!.id);
    if (!barberProfile) {
      return res.status(404).json({ message: 'No tienes perfil de barbero creado' });
    }

    const cita = await prisma.cita.findUnique({ where: { id } });
    if (!cita) {
      return res.status(404).json({ message: 'Cita no encontrada' });
    }

    if (cita.barberoId !== barberProfile.id) {
      return res.status(403).json({ message: 'No autorizado para editar esta cita' });
    }

    const conflict = await prisma.cita.findFirst({
      where: {
        barberoId: barberProfile.id,
        fecha_hora: fechaDate,
        NOT: { id },
      },
    });

    if (conflict) {
      return res.status(409).json({ message: 'Ya existe una cita en ese bloque horario' });
    }

    const updated = await prisma.cita.update({
      where: { id },
      data: { fecha_hora: fechaDate },
    });

    return res.json(updated);
  } catch (error) {
    console.error('updateCita error', error);
    return res.status(500).json({ message: 'Error al editar cita' });
  }
};

export const deleteCita = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const barberProfile = await getOwnBarberProfile(req.user!.id);
    if (!barberProfile) {
      return res.status(404).json({ message: 'No tienes perfil de barbero creado' });
    }

    const cita = await prisma.cita.findUnique({ where: { id } });
    if (!cita) {
      return res.status(404).json({ message: 'Cita no encontrada' });
    }

    if (cita.barberoId !== barberProfile.id) {
      return res.status(403).json({ message: 'No autorizado para eliminar esta cita' });
    }

    await prisma.cita.delete({ where: { id } });
    return res.status(204).send();
  } catch (error) {
    console.error('deleteCita error', error);
    return res.status(500).json({ message: 'Error al eliminar cita' });
  }
};

// ─── Fase 2: Interacción del Cliente ────────────────────────────────────────

export const saveWeekAvailability = async (req: AuthRequest, res: Response) => {
  try {
    const { fechaInicio, bloques } = req.body;
    if (!fechaInicio || !Array.isArray(bloques)) {
      return res.status(400).json({ message: 'fechaInicio y bloques son requeridos' });
    }

    if (bloques.length > 77) {
      return res.status(400).json({ message: 'Una semana no puede superar 77 bloques' });
    }

    const weekStart = new Date(`${fechaInicio}T00:00:00.000Z`);
    if (Number.isNaN(weekStart.getTime())) {
      return res.status(400).json({ message: 'fechaInicio debe usar formato YYYY-MM-DD' });
    }
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const uniqueDates = [...new Set(bloques.map((value: unknown) => String(value)))].map((value) => new Date(value));
    const invalidBlock = uniqueDates.some((date) =>
      Number.isNaN(date.getTime()) || !isExactHourBlock(date) || date < weekStart || date >= weekEnd,
    );
    if (invalidBlock) {
      return res.status(400).json({ message: 'Los bloques deben pertenecer a la semana y usar horas exactas' });
    }

    const barberProfile = await getOwnBarberProfile(req.user!.id);
    if (!barberProfile) {
      return res.status(404).json({ message: 'No tienes perfil de barbero creado' });
    }

    const occupied = await prisma.cita.findMany({
      where: {
        barberoId: barberProfile.id,
        estado: { in: [CitaEstado.pendiente, CitaEstado.confirmada, CitaEstado.finalizada] },
        fecha_hora: { gte: weekStart, lt: weekEnd },
      },
      select: { fecha_hora: true },
    });
    const occupiedTimes = new Set(occupied.map((cita) => cita.fecha_hora.getTime()));
    const availableDates = uniqueDates.filter((date) => !occupiedTimes.has(date.getTime()));

    await prisma.$transaction([
      prisma.cita.deleteMany({
        where: {
          barberoId: barberProfile.id,
          estado: CitaEstado.disponible,
          fecha_hora: { gte: weekStart, lt: weekEnd },
        },
      }),
      prisma.cita.createMany({
        data: availableDates.map((fecha_hora) => ({
          barberoId: barberProfile.id,
          fecha_hora,
          estado: CitaEstado.disponible,
        })),
      }),
    ]);

    const citas = await prisma.cita.findMany({
      where: {
        barberoId: barberProfile.id,
        estado: CitaEstado.disponible,
        fecha_hora: { gte: weekStart, lt: weekEnd },
      },
      orderBy: { fecha_hora: 'desc' },
    });

    return res.json({
      citas,
      omittedOccupiedBlocks: uniqueDates.length - availableDates.length,
    });
  } catch (error) {
    console.error('saveWeekAvailability error', error);
    return res.status(500).json({ message: 'Error al guardar la disponibilidad semanal' });
  }
};

export const getDisponibilidad = async (req: AuthRequest, res: Response) => {
  try {
    const barberoProfileId = parseInt(req.params.barberoId, 10);
    const { fecha } = req.query;

    if (isNaN(barberoProfileId)) {
      return res.status(400).json({ message: 'barberoId debe ser un número válido' });
    }

    if (!fecha || typeof fecha !== 'string') {
      return res.status(400).json({ message: 'Query param "fecha" es requerido (YYYY-MM-DD)' });
    }

    const diaInicio = new Date(`${fecha}T00:00:00.000Z`);
    const diaFin = new Date(`${fecha}T23:59:59.999Z`);

    if (isNaN(diaInicio.getTime())) {
      return res.status(400).json({ message: 'Formato de fecha inválido, usa YYYY-MM-DD' });
    }

    const barberProfile = await prisma.barberProfile.findUnique({
      where: { id: barberoProfileId },
    });

    if (!barberProfile) {
      return res.status(404).json({ message: 'Perfil de barbero no encontrado' });
    }

    const citas = await prisma.cita.findMany({
      where: {
        barberoId: barberoProfileId,
        estado: CitaEstado.disponible,  // ← enum tipado, no string
        fecha_hora: { gte: diaInicio, lte: diaFin },
      },
      orderBy: { fecha_hora: 'asc' },
    });

    const servicios = await prisma.service.findMany({
      where: { perfilBarberoId: barberoProfileId },
      select: {
        id: true,
        nombre_servicio: true,
        descripcion: true,
        precio: true,
        duracion_minutos: true,
      },
    });

    return res.json({ citas, servicios });
  } catch (error) {
    console.error('getDisponibilidad error', error);
    return res.status(500).json({ message: 'Error al obtener disponibilidad' });
  }
};

export const getBarberosParaReserva = async (_req: AuthRequest, res: Response) => {
  try {
    const barberos = await prisma.barberProfile.findMany({
      where: {
        usuario: { rol: 'barbero', aprobado: true },
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
        bancoNombre: true,
        bancoRut: true,
        bancoNombreBanco: true,
        bancoTipoCuenta: true,
        bancoNroCuenta: true,
        bancoCorreo: true,
        servicios: {
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

export const getReservationCalendar = async (req: AuthRequest, res: Response) => {
  try {
    const { fechaInicio } = req.query;
    if (!fechaInicio || typeof fechaInicio !== 'string') {
      return res.status(400).json({ message: 'fechaInicio es requerido (YYYY-MM-DD)' });
    }

    const weekStart = new Date(`${fechaInicio}T00:00:00.000Z`);
    if (Number.isNaN(weekStart.getTime())) {
      return res.status(400).json({ message: 'fechaInicio debe usar formato YYYY-MM-DD' });
    }
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const barberProfile = await getOwnBarberProfile(req.user!.id);
    if (!barberProfile) {
      return res.status(404).json({ message: 'No tienes perfil de barbero creado' });
    }

    const citas = await prisma.cita.findMany({
      where: {
        barberoId: barberProfile.id,
        estado: { in: [CitaEstado.disponible, CitaEstado.confirmada] },
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

    return res.json(citas);
  } catch (error) {
    console.error('getReservationCalendar error', error);
    return res.status(500).json({ message: 'Error al obtener el calendario de reservas' });
  }
};

export const getClientAppointments = async (req: AuthRequest, res: Response) => {
  try {
    const citas = await prisma.cita.findMany({
      where: {
        clienteId: req.user!.id,
        estado: {
          in: [CitaEstado.pendiente, CitaEstado.confirmada, CitaEstado.cancelada, CitaEstado.finalizada],
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

    return res.json(citas);
  } catch (error) {
    console.error('getClientAppointments error', error);
    return res.status(500).json({ message: 'Error al obtener tus citas' });
  }
};

export const cancelClientAppointment = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const cita = await prisma.cita.findUnique({
      where: { id },
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
    });

    if (!cita) {
      return res.status(404).json({ message: 'Cita no encontrada' });
    }

    if (cita.clienteId !== req.user!.id) {
      return res.status(403).json({ message: 'No autorizado para cancelar esta cita' });
    }

    if (cita.estado !== CitaEstado.pendiente && cita.estado !== CitaEstado.confirmada) {
      return res.status(409).json({ message: 'Solo puedes cancelar citas pendientes o confirmadas' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const appointment = await tx.cita.update({
        where: { id },
        data: { estado: CitaEstado.cancelada },
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
      });

      if (cita.fecha_hora > new Date()) {
        const available = await tx.cita.findFirst({
          where: {
            barberoId: cita.barberoId,
            fecha_hora: cita.fecha_hora,
            estado: CitaEstado.disponible,
          },
        });

        if (!available) {
          await tx.cita.create({
            data: {
              barberoId: cita.barberoId,
              fecha_hora: cita.fecha_hora,
              estado: CitaEstado.disponible,
            },
          });
        }
      }

      return appointment;
    });

    return res.json(updated);
  } catch (error) {
    console.error('cancelClientAppointment error', error);
    return res.status(500).json({ message: 'Error al cancelar la cita' });
  }
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
        estado: { in: [CitaEstado.confirmada, CitaEstado.cancelada, CitaEstado.finalizada] },
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

    return res.json(citas);
  } catch (error) {
    console.error('getMyAppointments error', error);
    return res.status(500).json({ message: 'Error al obtener tus citas' });
  }
};

export const updateAppointmentStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;
    if (![CitaEstado.cancelada, CitaEstado.finalizada].includes(estado)) {
      return res.status(400).json({ message: 'Solo puedes cancelar o finalizar una cita' });
    }

    const barberProfile = await getOwnBarberProfile(req.user!.id);
    if (!barberProfile) {
      return res.status(404).json({ message: 'No tienes perfil de barbero creado' });
    }

    const cita = await prisma.cita.findUnique({ where: { id } });
    if (!cita) {
      return res.status(404).json({ message: 'Cita no encontrada' });
    }
    if (cita.barberoId !== barberProfile.id) {
      return res.status(403).json({ message: 'No autorizado para gestionar esta cita' });
    }
    if (cita.estado !== CitaEstado.confirmada) {
      return res.status(409).json({ message: 'Solo las citas confirmadas pueden cambiar de estado' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const appointment = await tx.cita.update({
        where: { id },
        data: { estado },
        include: {
          cliente: { select: { id: true, nombre: true, telefono: true } },
          servicio: { select: { id: true, nombre_servicio: true, duracion_minutos: true } },
        },
      });

      if (estado === CitaEstado.cancelada && cita.fecha_hora > new Date()) {
        const available = await tx.cita.findFirst({
          where: {
            barberoId: barberProfile.id,
            fecha_hora: cita.fecha_hora,
            estado: CitaEstado.disponible,
          },
        });
        if (!available) {
          await tx.cita.create({
            data: {
              barberoId: barberProfile.id,
              fecha_hora: cita.fecha_hora,
              estado: CitaEstado.disponible,
            },
          });
        }
      }

      return appointment;
    });

    return res.json(updated);
  } catch (error) {
    console.error('updateAppointmentStatus error', error);
    return res.status(500).json({ message: 'Error al actualizar el estado de la cita' });
  }
};

export const agendarCita = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    let { servicioId, comprobanteTransferencia, comprobanteNombre } = req.body;

    if (typeof servicioId !== 'string' || !servicioId.trim()) {
      return res.status(400).json({ message: 'servicioId es requerido' });
    }
    servicioId = servicioId.trim();

    if (typeof comprobanteTransferencia !== 'string' || !comprobanteTransferencia.trim()) {
      return res.status(400).json({ message: 'Debes subir un comprobante de transferencia' });
    }

    if (!/^data:(image\/(png|jpeg|jpg|webp)|application\/pdf);base64,/.test(comprobanteTransferencia)) {
      return res.status(400).json({ message: 'El comprobante debe ser una imagen o PDF valido' });
    }

    if (comprobanteTransferencia.length > 5_500_000) {
      return res.status(400).json({ message: 'El comprobante no puede superar 4 MB' });
    }

    comprobanteNombre =
      typeof comprobanteNombre === 'string' && comprobanteNombre.trim()
        ? comprobanteNombre.trim().slice(0, 180)
        : 'comprobante-transferencia';

    const cita = await prisma.cita.findUnique({ where: { id } });
    if (!cita) {
      return res.status(404).json({ message: 'Cita no encontrada' });
    }

    if (cita.estado !== CitaEstado.disponible) {
      return res.status(409).json({ message: 'Esta cita ya no está disponible' });
    }

    const servicio = await prisma.service.findUnique({
      where: { id: servicioId.trim() },
    });

    if (!servicio) {
      return res.status(404).json({ message: 'Servicio no encontrado' });
    }

    // Validar que el servicio pertenece al barbero dueño de la cita
    if (servicio.perfilBarberoId !== cita.barberoId) {
      return res.status(403).json({
        message: 'El servicio seleccionado no pertenece al barbero de esta cita',
      });
    }

    const result = await prisma.cita.updateMany({
      where: {
        id,
        estado: CitaEstado.disponible,
      },
      data: {
        clienteId: req.user!.id,  // Int, viene del token ✓
        servicioId,               // String uuid ✓
        comprobanteTransferencia,
        comprobanteNombre,
        estado: CitaEstado.confirmada,
      },
    });

    if (result.count === 0) {
      return res.status(409).json({ message: 'Esta cita ya no esta disponible' });
    }

    const updated = await prisma.cita.findUnique({ where: { id } });

    return res.json(updated);
  } catch (error) {
    console.error('agendarCita error', error);
    return res.status(500).json({ message: 'Error al agendar cita' });
  }
};
