// User Entity
// TODO: Implementar entidad User con TypeORM

export interface IUser {
  id: string;
  nombre: string;
  email: string;
  rol: 'barbero' | 'cliente';
}
