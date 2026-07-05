import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { AuthRequest } from '../middleware/auth';
import {
  createServiceValidation,
  updateServiceValidation,
} from '../validations/servicios';

const toInt = (value: unknown) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
};

const getOwnBarberProfile = async (userId: number) => {
  return prisma.barberProfile.findUnique({
    where: { usuarioId: userId },
  });
};

const canAccessService = async (serviceId: string, userId: number) => {
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    include: {
      perfilBarbero: true,
    },
  });

  if (!service) {
    return { service: null, allowed: false };
  }

  return {
    service,
    allowed: service.perfilBarbero.usuarioId === userId,
  };
};

export const createService = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.rol !== 'barbero') {
      return res.status(403).json({ message: 'Solo los barberos pueden crear servicios' });
    }

    const { error, value } = createServiceValidation.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const { nombre_servicio, descripcion, precio, duracion_minutos } = value;
    const priceValue = toInt(precio);
    const durationValue = toInt(duracion_minutos);

    const barberProfile = await getOwnBarberProfile(req.user.id);
    if (!barberProfile) {
      return res.status(404).json({ message: 'No tienes perfil de barbero creado' });
    }

    const service = await prisma.service.create({
      data: {
        perfilBarberoId: barberProfile.id,
        nombre_servicio,
        descripcion: descripcion || null,
        precio: priceValue,
        duracion_minutos: durationValue,
      },
    });

    return res.status(201).json(service);
  } catch (error) {
    console.error('createService error', error);
    return res.status(500).json({ message: 'Error al crear servicio' });
  }
};

export const getServices = async (req: AuthRequest, res: Response) => {
  try {
    if (!['barbero', 'admin'].includes(req.user?.rol || '')) {
      return res.status(403).json({ message: 'No autorizado' });
    }

    if (req.user?.rol === 'admin') {
      const services = await prisma.service.findMany({
        include: {
          perfilBarbero: {
            include: {
              usuario: {
                select: {
                  id: true,
                  nombre: true,
                  email: true,
                  rol: true,
                },
              },
            },
          },
        },
      });

      return res.json(services);
    }

    const barberProfile = await getOwnBarberProfile(req.user!.id);
    if (!barberProfile) {
      return res.status(404).json({ message: 'No tienes perfil de barbero creado' });
    }

    const services = await prisma.service.findMany({
      where: { perfilBarberoId: barberProfile.id },
      include: {
        perfilBarbero: true,
      },
    });

    return res.json(services);
  } catch (error) {
    console.error('getServices error', error);
    return res.status(500).json({ message: 'Error al obtener servicios' });
  }
};

export const getServiceById = async (req: AuthRequest, res: Response) => {
  try {
    if (!['barbero', 'admin'].includes(req.user?.rol || '')) {
      return res.status(403).json({ message: 'No autorizado' });
    }

    const { id } = req.params;
    const service = await prisma.service.findUnique({
      where: { id },
      include: {
        perfilBarbero: true,
      },
    });

    if (!service) {
      return res.status(404).json({ message: 'Servicio no encontrado' });
    }

    if (req.user?.rol === 'barbero' && service.perfilBarbero.usuarioId !== req.user.id) {
      return res.status(403).json({ message: 'No autorizado para ver este servicio' });
    }

    return res.json(service);
  } catch (error) {
    console.error('getServiceById error', error);
    return res.status(500).json({ message: 'Error al obtener servicio' });
  }
};

export const updateService = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.rol !== 'barbero') {
      return res.status(403).json({ message: 'Solo los barberos pueden editar servicios' });
    }

    const { id } = req.params;
    const { service, allowed } = await canAccessService(id, req.user.id);

    if (!service) {
      return res.status(404).json({ message: 'Servicio no encontrado' });
    }

    if (!allowed) {
      return res.status(403).json({ message: 'No autorizado para editar este servicio' });
    }

    const { error, value } = updateServiceValidation.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const priceValue = value.precio !== undefined ? toInt(value.precio) : undefined;
    const durationValue = value.duracion_minutos !== undefined ? toInt(value.duracion_minutos) : undefined;

    const updated = await prisma.service.update({
      where: { id },
      data: {
        nombre_servicio: value.nombre_servicio ?? undefined,
        descripcion: value.descripcion !== undefined ? value.descripcion : undefined,
        precio: priceValue ?? undefined,
        duracion_minutos: durationValue ?? undefined,
      },
    });

    return res.json(updated);
  } catch (error) {
    console.error('updateService error', error);
    return res.status(500).json({ message: 'Error al editar servicio' });
  }
};

export const deleteService = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    if (req.user?.rol === 'barbero') {
      const { service, allowed } = await canAccessService(id, req.user.id);

      if (!service) {
        return res.status(404).json({ message: 'Servicio no encontrado' });
      }

      if (!allowed) {
        return res.status(403).json({ message: 'No autorizado para eliminar este servicio' });
      }
    }

    await prisma.service.delete({ where: { id } });
    return res.status(204).send();
  } catch (error) {
    console.error('deleteService error', error);
    return res.status(500).json({ message: 'Error al eliminar servicio' });
  }
};
