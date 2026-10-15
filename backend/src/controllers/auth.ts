import { Request, Response } from 'express';
import prisma from '../config/prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AuthRequest } from '../middleware/auth';
import { datosBancariosValidation } from '../validations/datosBancarios';
import { updateProfileValidation } from '../validations/usuarios';
import { normalizeProfilePhoto, ProfilePhotoError } from '../services/profilePhoto';
import { jwtSettings } from '../config/security';
import { reserveEmail } from '../services/accountEmail';
import { scheduleFailure } from '../services/schedule';

const dummyHash = bcrypt.hashSync('unused-login-timing-value', 10);

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body ?? {};
    // No new-password rules here: existing credentials must remain usable.
    if (typeof email !== 'string' || !email.trim() || email.length > 254 || typeof password !== 'string' || !password || password.length > 4096) return res.status(400).json({ message: 'Ingresa tu correo electrónico y contraseña' });

    let user = await prisma.user.findUnique({ where: { email: email.trim() } });
    if (!user) {
      const matches = await prisma.user.findMany({ where: { email: { equals: email.trim(), mode: 'insensitive' } }, take: 2 });
      // Do not choose between legacy accounts that differ only by letter case.
      user = matches.length === 1 ? matches[0] : null;
    }

    const match = await bcrypt.compare(password, user?.password || dummyHash);
    if (!user || !match) return res.status(401).json({ message: 'Credenciales inválidas' });

    if (user.activo === false) return res.status(403).json({ message: 'La cuenta está deshabilitada' });

    const settings = jwtSettings();
    const token = jwt.sign({ id: user.id, rol: user.rol }, settings.secret, { algorithm: 'HS256', expiresIn: settings.expiresIn });

    const { password: _p, ...safe } = user;

    return res.json({ token, user: { ...safe, rol: user.rol === 'barbero' && !user.aprobado ? 'cliente' : user.rol } });
  } catch (error) {
    console.error('login failed');
    return res.status(500).json({ message: 'Error en login' });
  }
};

export const getMe = async (req: AuthRequest, res: Response) => {
  res.set('Cache-Control', 'no-store');
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id:             true,
        nombre:         true,
        email:          true,
        telefono:       true,
        foto_perfil:    true,
        rol:            true,
        aprobado:       true,
        fecha_creacion: true,
        perfilBarbero: {
          select: {
            id: true,
            biografia: true,
            especialidades: true,
            foto_perfil: true,
            bancoNombre: req.user!.rol === 'barbero',
            bancoRut: req.user!.rol === 'barbero',
            bancoNombreBanco: req.user!.rol === 'barbero',
            bancoTipoCuenta: req.user!.rol === 'barbero',
            bancoNroCuenta: req.user!.rol === 'barbero',
            bancoCorreo: req.user!.rol === 'barbero',
            requiereComprobante: true,
            lugarTrabajo: {
              select: {
                id: true,
                nombre_barberia: true,
                direccion: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    return res.json({ ...user, rol: req.user!.rol });
  } catch (error) {
    console.error('getMe error', error);
    return res.status(500).json({ message: 'Error al obtener perfil' });
  }
};

export const updateMe = async (req: AuthRequest, res: Response) => {
  try {
    const { error, value } = updateProfileValidation.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const { nombre, email, password, telefono } = value;

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    const hashedPassword = password ? await bcrypt.hash(password, 10) : undefined;

    const updated = await prisma.$transaction(async tx => {
      if (email && email !== user.email) await reserveEmail(tx, email, req.user!.id);
      return tx.user.update({
      where: { id: req.user!.id },
      data: {
        nombre:   nombre   ?? undefined,
        email:    email    ?? undefined,
        password: hashedPassword,
        telefono: telefono === undefined ? undefined : telefono || null,
      },
      select: {
        id:             true,
        nombre:         true,
        email:          true,
        telefono:       true,
        foto_perfil:    true,
        rol:            true,
        aprobado:       true,
        fecha_creacion: true,
      },
      });
    });

    return res.json({ ...updated, rol: req.user!.rol });
  } catch (error) {
    const known = scheduleFailure(error);
    if (known) return res.status(known.status).json({ message: known.message });
    if ((error as { code?: string }).code === 'P2002') return res.status(409).json({ message: 'El email ya está en uso' });
    console.error('updateMe failed');
    return res.status(500).json({ message: 'Error al actualizar perfil' });
  }
};

export const updateProfilePhoto = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || !['cliente', 'barbero'].includes(req.user.rol)) {
      return res.status(403).json({ message: 'Tu tipo de cuenta no permite cambiar la foto de perfil' });
    }

    const fotoPerfil = await normalizeProfilePhoto(req.body?.foto_perfil);

    const updated = await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.update({
        where: { id: req.user!.id },
        data: { foto_perfil: fotoPerfil },
        select: { id: true, foto_perfil: true },
      });

      if (req.user!.rol === 'barbero') {
        await transaction.barberProfile.updateMany({
          where: { usuarioId: req.user!.id },
          data: { foto_perfil: fotoPerfil },
        });
      }

      return user;
    });

    return res.json(updated);
  } catch (error) {
    if (error instanceof ProfilePhotoError) return res.status(error.status).json({ message: error.message });
    console.error('updateProfilePhoto failed');
    return res.status(500).json({ message: 'Error al actualizar la foto de perfil' });
  }
};

export const updateBankingData = async (req: AuthRequest, res: Response) => {
  res.set('Cache-Control', 'no-store');
  try {
    if (req.user?.rol !== 'barbero') {
      return res.status(403).json({ message: 'Solo los barberos pueden editar sus datos bancarios' });
    }

    const { error, value } = datosBancariosValidation.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const fields = {
      bancoNombre: value.nombre,
      bancoRut: value.rut,
      bancoNombreBanco: value.banco,
      bancoTipoCuenta: value.tipoCuenta,
      bancoNroCuenta: value.nroCuenta,
      bancoCorreo: value.correo,
    };

    const profile = await prisma.barberProfile.findUnique({
      where: { usuarioId: req.user.id },
    });

    if (!profile) {
      return res.status(404).json({ message: 'No tienes perfil profesional creado' });
    }

    const updated = await prisma.barberProfile.update({
      where: { id: profile.id },
      data: fields,
      select: {
        id: true,
        bancoNombre: true,
        bancoRut: true,
        bancoNombreBanco: true,
        bancoTipoCuenta: true,
        bancoNroCuenta: true,
        bancoCorreo: true,
      },
    });

    return res.json(updated);
  } catch (error) {
    console.error('updateBankingData error', error);
    return res.status(500).json({ message: 'Error al actualizar datos bancarios' });
  }
};

export const updateBookingSettings = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.rol !== 'barbero') {
      return res.status(403).json({ message: 'Solo los barberos pueden editar la configuración de reservas' });
    }

    const { requiereComprobante } = req.body;
    if (typeof requiereComprobante !== 'boolean') {
      return res.status(400).json({ message: 'requiereComprobante debe ser un valor booleano' });
    }

    const profile = await prisma.barberProfile.findUnique({
      where: { usuarioId: req.user.id },
      select: { id: true },
    });

    if (!profile) {
      return res.status(404).json({ message: 'No tienes perfil profesional creado' });
    }

    const updated = await prisma.barberProfile.update({
      where: { id: profile.id },
      data: { requiereComprobante },
      select: { id: true, requiereComprobante: true },
    });

    return res.json(updated);
  } catch (error) {
    console.error('updateBookingSettings error', error);
    return res.status(500).json({ message: 'Error al actualizar la configuración de reservas' });
  }
};

export default {
  login,
  getMe,
  updateMe,
  updateProfilePhoto,
  updateBankingData,
  updateBookingSettings,
};
