import { Prisma, CitaEstado } from '@prisma/client';
import type { AuthRequest } from '../middleware/auth';
import { dataTablePage, dataTableParams } from './dataTables';
import { historicalAppointment } from './reservationLifecycle';
import { ScheduleError } from './schedule';

const contains = (value: string): Prisma.StringFilter => ({ contains: value, mode: 'insensitive' });
export const pendingWhere: Prisma.UserWhereInput = { rol: 'barbero', aprobado: false, solicitudProfesional: { is: { estado: 'pendiente' } } };

export async function appointmentPage(req: AuthRequest, owner: Prisma.CitaWhereInput, client: boolean) {
  const params = dataTableParams(req, {
    fecha_hora: { fecha_hora: 'desc' }, estado: { estado: 'asc' },
    persona: client ? { barbero: { usuario: { nombre: 'asc' } } } : { cliente: { nombre: 'asc' } },
    servicio: { nombreServicioReservado: 'asc' },
  }, 'fecha_hora');
  const where: Prisma.CitaWhereInput = { ...owner, estado: { not: CitaEstado.disponible } };
  const view = req.query.vista ?? (client ? 'todas' : undefined);
  const views = client ? ['todas', 'proximas', 'historial'] : ['reservas', 'historial'];
  if (typeof view !== 'string' || !views.includes(view)) throw new ScheduleError(400, 'Vista inválida');
  if (view !== 'todas') {
    const historical: Prisma.CitaWhereInput = { OR: [
      { fecha_hora: { lt: new Date() } },
      { estado: { in: ['cancelada', 'rechazada', 'finalizada', 'inasistencia'] } },
    ] };
    where.AND = view === 'historial' ? [historical] : [{ NOT: historical }];
  }
  const filtered: Prisma.CitaWhereInput = { AND: [where, { OR: [
    { nombreServicioReservado: contains(params.search) }, { servicio: { nombre_servicio: contains(params.search) } },
    ...(client ? [{ barbero: { usuario: { nombre: contains(params.search) } } }] : [{ cliente: { nombre: contains(params.search) } }]),
    ...(['pendiente', 'confirmada', 'cancelada', 'rechazada', 'finalizada', 'inasistencia'].includes(params.search.toLowerCase())
      ? [{ estado: params.search.toLowerCase() as CitaEstado }] : []),
  ] }] };
  const result = await dataTablePage(params, {
    count: (tx, search) => tx.cita.count({ where: search ? filtered : where }),
    rows: (tx, skip, take) => tx.cita.findMany({ where: params.search ? filtered : where, skip, take,
      orderBy: params.orderBy as Prisma.CitaOrderByWithRelationInput[],
      include: {
        ...(client ? { barbero: { select: { id: true, usuario: { select: { id: true, nombre: true } }, lugarTrabajo: { select: { id: true, nombre_barberia: true, direccion: true } } } } }
          : { cliente: { select: { id: true, nombre: true, telefono: true } } }),
        servicio: { select: { id: true, nombre_servicio: true, precio: true } },
      },
    }),
  });
  return { ...result, data: result.data.map(historicalAppointment) };
}

export const adminUserSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true, nombre: true, email: true, telefono: true, rol: true, aprobado: true, activo: true, fecha_creacion: true, solicitudProfesional: true,
  perfilBarbero: { select: { id: true, biografia: true, foto_perfil: true, lugarTrabajo: { select: { id: true, nombre_barberia: true, direccion: true } },
    servicios: { select: { id: true, nombre_servicio: true, precio: true }, orderBy: { nombre_servicio: 'asc' } },
    _count: { select: { citas: true, servicios: true } },
  } }, _count: { select: { citas: true } },
});

export async function userPage(req: AuthRequest, where: Prisma.UserWhereInput) {
  const params = dataTableParams(req, { nombre: { nombre: 'asc' }, email: { email: 'asc' }, fecha_creacion: { fecha_creacion: 'desc' }, activo: { activo: 'asc' } }, 'fecha_creacion');
  const filtered: Prisma.UserWhereInput = { AND: [where, { OR: [{ nombre: contains(params.search) }, { email: contains(params.search) }] }] };
  return dataTablePage(params, {
    count: (tx, search) => tx.user.count({ where: search ? filtered : where }),
    rows: (tx, skip, take) => tx.user.findMany({ where: params.search ? filtered : where, select: adminUserSelect, skip, take, orderBy: params.orderBy as Prisma.UserOrderByWithRelationInput[] }),
  });
}
