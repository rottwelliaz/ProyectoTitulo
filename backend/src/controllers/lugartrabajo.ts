import { Response } from 'express';
import prisma from '../config/prisma';
import { AuthRequest } from '../middleware/auth';

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

const canAccessLugarTrabajo = async (lugarTrabajoId: number, req: AuthRequest) => {
  const lugarTrabajo = await prisma.lugarTrabajo.findUnique({
    where: { id: lugarTrabajoId },
    include: {
      barberos: true,
    },
  });

  if (!lugarTrabajo) {
    return { lugarTrabajo: null, allowed: false };
  }

  if (req.user?.rol === 'admin') {
    return { lugarTrabajo, allowed: true };
  }

  const allowed = lugarTrabajo.barberos.some((barbero) => barbero.usuarioId === req.user?.id);
  return { lugarTrabajo, allowed };
};

export const createLugarTrabajo = async (req: AuthRequest, res: Response) => {
  try {
    const { nombre_barberia, direccion, perfilBarberoId } = req.body;

    if (!nombre_barberia?.trim() || !direccion?.trim()) {
      return res.status(400).json({ message: 'nombre_barberia y direccion son requeridos' });
    }

    let barberProfileId: number;

    if (req.user?.rol === 'barbero') {
      const barberProfile = await getOwnBarberProfile(req.user.id);
      if (!barberProfile) {
        return res.status(404).json({ message: 'No tienes perfil de barbero creado' });
      }
      barberProfileId = barberProfile.id;
      if (barberProfile.lugarTrabajoId) {
        return res.status(409).json({
          message: 'Ya tienes un lugar de trabajo. Puedes editarlo o eliminarlo antes de crear otro.',
        });
      }
    } else {
      barberProfileId = toInt(perfilBarberoId);
      if (Number.isNaN(barberProfileId)) {
        return res.status(400).json({ message: 'perfilBarberoId debe ser valido' });
      }

      const barberProfile = await prisma.barberProfile.findUnique({
        where: { id: barberProfileId },
      });

      if (!barberProfile) {
        return res.status(404).json({ message: 'Perfil de barbero no encontrado' });
      }

      if (barberProfile.lugarTrabajoId) {
        return res.status(409).json({
          message: 'El barbero ya tiene un lugar de trabajo asignado.',
        });
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const lugarTrabajo = await tx.lugarTrabajo.create({
        data: {
          nombre_barberia: nombre_barberia.trim(),
          direccion: direccion.trim(),
        },
      });

      await tx.barberProfile.update({
        where: { id: barberProfileId },
        data: { lugarTrabajoId: lugarTrabajo.id },
      });

      return tx.lugarTrabajo.findUnique({
        where: { id: lugarTrabajo.id },
        include: { barberos: true },
      });
    });

    return res.status(201).json(created);
  } catch (error) {
    console.error('createLugarTrabajo error', error);
    return res.status(500).json({ message: 'Error al crear lugar de trabajo' });
  }
};

export const getLugaresTrabajo = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.rol === 'admin') {
      const lugaresTrabajo = await prisma.lugarTrabajo.findMany({
        include: {
          barberos: {
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

      return res.json(lugaresTrabajo);
    }

    const barberProfile = await getOwnBarberProfile(req.user!.id);
    if (!barberProfile?.lugarTrabajoId) {
      return res.json([]);
    }

    const lugarTrabajo = await prisma.lugarTrabajo.findUnique({
      where: { id: barberProfile.lugarTrabajoId },
      include: { barberos: true },
    });

    return res.json(lugarTrabajo ? [lugarTrabajo] : []);
  } catch (error) {
    console.error('getLugaresTrabajo error', error);
    return res.status(500).json({ message: 'Error al obtener lugares de trabajo' });
  }
};

export const getLugarTrabajoById = async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'ID invalido' });
    }

    const { lugarTrabajo, allowed } = await canAccessLugarTrabajo(id, req);

    if (!lugarTrabajo) {
      return res.status(404).json({ message: 'Lugar de trabajo no encontrado' });
    }

    if (!allowed) {
      return res.status(403).json({ message: 'No autorizado para ver este lugar de trabajo' });
    }

    return res.json(lugarTrabajo);
  } catch (error) {
    console.error('getLugarTrabajoById error', error);
    return res.status(500).json({ message: 'Error al obtener lugar de trabajo' });
  }
};

export const updateLugarTrabajo = async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'ID invalido' });
    }

    const { lugarTrabajo, allowed } = await canAccessLugarTrabajo(id, req);

    if (!lugarTrabajo) {
      return res.status(404).json({ message: 'Lugar de trabajo no encontrado' });
    }

    if (!allowed) {
      return res.status(403).json({ message: 'No autorizado para editar este lugar de trabajo' });
    }

    const nombreBarberia = req.body.nombre_barberia;
    const direccion = req.body.direccion;
    if ((nombreBarberia !== undefined && !String(nombreBarberia).trim()) ||
        (direccion !== undefined && !String(direccion).trim())) {
      return res.status(400).json({ message: 'El nombre y la direccion no pueden estar vacios' });
    }

    const updated = await prisma.lugarTrabajo.update({
      where: { id },
      data: {
        nombre_barberia: nombreBarberia !== undefined ? String(nombreBarberia).trim() : undefined,
        direccion: direccion !== undefined ? String(direccion).trim() : undefined,
      },
    });

    return res.json(updated);
  } catch (error) {
    console.error('updateLugarTrabajo error', error);
    return res.status(500).json({ message: 'Error al editar lugar de trabajo' });
  }
};

export const deleteLugarTrabajo = async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'ID invalido' });
    }

    const { lugarTrabajo, allowed } = await canAccessLugarTrabajo(id, req);

    if (!lugarTrabajo) {
      return res.status(404).json({ message: 'Lugar de trabajo no encontrado' });
    }

    if (!allowed) {
      return res.status(403).json({ message: 'No autorizado para eliminar este lugar de trabajo' });
    }

    await prisma.lugarTrabajo.delete({ where: { id } });
    return res.status(204).send();
  } catch (error) {
    console.error('deleteLugarTrabajo error', error);
    return res.status(500).json({ message: 'Error al eliminar lugar de trabajo' });
  }
};

export default {
  createLugarTrabajo,
  deleteLugarTrabajo,
  getLugarTrabajoById,
  getLugaresTrabajo,
  updateLugarTrabajo,
};
