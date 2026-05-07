// Error Middleware
// TODO: Implementar middleware de manejo de errores

export const errorMiddleware = (err: any, req: any, res: any, next: any) => {
  // Manejo de errores
  next();
};
