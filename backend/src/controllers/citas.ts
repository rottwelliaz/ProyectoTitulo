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

export const agendarCita = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { servicioId } = req.body;

    if (!servicioId) {
      return res.status(400).json({ message: 'servicioId es requerido' });
    }

    const cita = await prisma.cita.findUnique({ where: { id } });
    if (!cita) {
      return res.status(404).json({ message: 'Cita no encontrada' });
    }

    if (cita.estado !== CitaEstado.disponible) {
      return res.status(409).json({ message: 'Esta cita ya no está disponible' });
    }

    const servicio = await prisma.service.findUnique({
      where: { id: servicioId },
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

    const updated = await prisma.cita.update({
      where: { id },
      data: {
        clienteId: req.user!.id,  // Int, viene del token ✓
        servicioId,               // String uuid ✓
        estado: CitaEstado.pendiente,
      },
    });

    return res.json(updated);
  } catch (error) {
    console.error('agendarCita error', error);
    return res.status(500).json({ message: 'Error al agendar cita' });
  }
};