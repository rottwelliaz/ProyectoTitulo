import prisma from '../config/prisma';

export const getOwnBarberProfile = async (userId: number) => {
  return prisma.barberProfile.findUnique({
    where: { usuarioId: userId },
  });
};
