import { Prisma } from '@prisma/client';

// The caller must lock and authorize the account before invoking this helper.
export async function removeAccount(tx: Prisma.TransactionClient, id: number) {
  const profile = await tx.barberProfile.findUnique({ where: { usuarioId: id } });
  const appointments: Prisma.CitaWhereInput = { OR: [
    { clienteId: id },
    { barbero: { usuarioId: id } },
    { servicio: { perfilBarbero: { usuarioId: id } } },
  ] };

  // The history trigger permits only this account's reservations, in this transaction.
  await tx.$queryRaw`SELECT set_config('app.account_deletion_user_id', ${String(id)}, true)`;
  await tx.citaCambioEstado.deleteMany({ where: { cita: appointments } });
  await tx.cita.deleteMany({ where: appointments });

  // Keep other accounts' history, without references to the removed administrator.
  await tx.citaCambioEstado.updateMany({ where: { responsableId: id }, data: { responsableId: null } });
  await tx.solicitudProfesional.updateMany({ where: { revisorId: id }, data: { revisorId: null } });
  await tx.solicitudProfesional.deleteMany({ where: { usuarioId: id } });
  await tx.conversation.deleteMany({ where: { OR: [{ clientId: id }, { barberId: id }] } });
  await tx.message.deleteMany({ where: { senderId: id } });

  if (profile) {
    await tx.service.deleteMany({ where: { perfilBarberoId: profile.id } });
    await tx.agendaBloqueo.deleteMany({ where: { barberoId: profile.id } });
    await tx.agendaSemana.deleteMany({ where: { barberoId: profile.id } });
    if (profile.lugarTrabajoId) {
      await tx.$queryRaw`SELECT "id" FROM "LugarTrabajo" WHERE "id" = ${profile.lugarTrabajoId} FOR UPDATE`;
    }
    await tx.barberProfile.delete({ where: { id: profile.id } });
    if (profile.lugarTrabajoId && await tx.barberProfile.count({ where: { lugarTrabajoId: profile.lugarTrabajoId } }) === 0) {
      await tx.lugarTrabajo.delete({ where: { id: profile.lugarTrabajoId } });
    }
  }
  await tx.user.delete({ where: { id } });
}
