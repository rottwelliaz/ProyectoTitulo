export const publicServiceSelect = {
  id: true, nombre_servicio: true, descripcion: true, precio: true, duracion_minutos: true,
} as const;
export const publicProfileSelect = {
  id: true, biografia: true, especialidades: true, foto_perfil: true,
  lugarTrabajo: { select: { nombre_barberia: true, direccion: true } },
  servicios: { where: { activo: true }, select: publicServiceSelect, orderBy: { nombre_servicio: 'asc' as const } },
} as const;
export const publicUserSelect = {
  id: true, nombre: true, foto_perfil: true, rol: true, aprobado: true,
  perfilBarbero: { select: publicProfileSelect },
} as const;
