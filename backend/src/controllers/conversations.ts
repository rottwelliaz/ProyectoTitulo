import { Response } from 'express';
import prisma from '../config/prisma';
import { AuthRequest } from '../middleware/auth';

const userSelect = {
  id: true,
  nombre: true,
  rol: true,
  foto_perfil: true,
  perfilBarbero: {
    select: {
      foto_perfil: true,
    },
  },
} as const;

const conversationInclude = {
  client: { select: userSelect },
  barber: { select: userSelect },
  messages: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: {
      id: true,
      senderId: true,
      content: true,
      read: true,
      createdAt: true,
    },
  },
} as const;

const formatConversation = (conversation: any, currentUserId: number) => {
  const otherUser = conversation.clientId === currentUserId
    ? conversation.barber
    : conversation.client;

  return {
    id: conversation.id,
    clientId: conversation.clientId,
    barberId: conversation.barberId,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    otherUser: {
      id: otherUser.id,
      nombre: otherUser.nombre,
      rol: otherUser.rol,
      foto_perfil: otherUser.foto_perfil || otherUser.perfilBarbero?.foto_perfil || null,
    },
    lastMessage: conversation.messages?.[0] || null,
  };
};

const findAccessibleConversation = (conversationId: string, userId: number) =>
  prisma.conversation.findFirst({
    where: {
      id: conversationId,
      OR: [{ clientId: userId }, { barberId: userId }],
    },
  });

export const createOrGetConversation = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.rol !== 'cliente') {
      return res.status(403).json({ message: 'Solo un cliente puede iniciar una conversación' });
    }

    const barberId = Number(req.body?.barberId);
    if (!Number.isInteger(barberId)) {
      return res.status(400).json({ message: 'barberId debe ser un número válido' });
    }

    const barber = await prisma.user.findFirst({
      where: { id: barberId, rol: 'barbero', aprobado: true },
      select: { id: true },
    });
    if (!barber) {
      return res.status(404).json({ message: 'Barbero no encontrado o no disponible' });
    }

    const conversation = await prisma.conversation.upsert({
      where: {
        clientId_barberId: {
          clientId: req.user.id,
          barberId,
        },
      },
      update: {},
      create: {
        clientId: req.user.id,
        barberId,
      },
      include: conversationInclude,
    });

    return res.status(200).json(formatConversation(conversation, req.user.id));
  } catch (error) {
    console.error('createOrGetConversation error', error);
    return res.status(500).json({ message: 'Error al abrir la conversación' });
  }
};

export const getConversations = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || !['cliente', 'barbero'].includes(req.user.rol)) {
      return res.status(403).json({ message: 'Tu tipo de cuenta no utiliza mensajería' });
    }

    const conversations = await prisma.conversation.findMany({
      where: {
        OR: [{ clientId: req.user.id }, { barberId: req.user.id }],
      },
      include: conversationInclude,
      orderBy: { updatedAt: 'desc' },
    });

    return res.json(conversations.map((conversation) => formatConversation(conversation, req.user!.id)));
  } catch (error) {
    console.error('getConversations error', error);
    return res.status(500).json({ message: 'Error al obtener las conversaciones' });
  }
};

export const getConversationMessages = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const conversation = await findAccessibleConversation(req.params.id, userId);
    if (!conversation) {
      return res.status(404).json({ message: 'Conversación no encontrada' });
    }

    await prisma.message.updateMany({
      where: {
        conversationId: conversation.id,
        senderId: { not: userId },
        read: false,
      },
      data: { read: true },
    });

    const messages = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        conversationId: true,
        senderId: true,
        content: true,
        read: true,
        createdAt: true,
        sender: {
          select: { id: true, nombre: true, rol: true },
        },
      },
    });

    return res.json(messages);
  } catch (error) {
    console.error('getConversationMessages error', error);
    return res.status(500).json({ message: 'Error al obtener los mensajes' });
  }
};

export const sendConversationMessage = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!content) {
      return res.status(400).json({ message: 'El mensaje no puede estar vacío' });
    }
    if (content.length > 2000) {
      return res.status(400).json({ message: 'El mensaje no puede superar 2000 caracteres' });
    }

    const conversation = await findAccessibleConversation(req.params.id, userId);
    if (!conversation) {
      return res.status(404).json({ message: 'Conversación no encontrada' });
    }

    const [, message] = await prisma.$transaction([
      prisma.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      }),
      prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: userId,
          content,
        },
        select: {
          id: true,
          conversationId: true,
          senderId: true,
          content: true,
          read: true,
          createdAt: true,
          sender: {
            select: { id: true, nombre: true, rol: true },
          },
        },
      }),
    ]);

    return res.status(201).json(message);
  } catch (error) {
    console.error('sendConversationMessage error', error);
    return res.status(500).json({ message: 'Error al enviar el mensaje' });
  }
};

export default {
  createOrGetConversation,
  getConversations,
  getConversationMessages,
  sendConversationMessage,
};
