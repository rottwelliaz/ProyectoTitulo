// Cita Entity
// TODO: Implementar entidad Cita con TypeORM

export interface ICita {
  id: string;
  clienteId: string;
  barberoId: string;
  servicioId: string;
  fechaHora: Date;
  estado: string;
}
