import { authFetch, API_URL } from './session';

export async function professionalApi(path: string, method = 'GET', body?: unknown, signal?: AbortSignal) {
  const response = await authFetch(`${API_URL}${path}`, {
    method, signal,
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || 'No se pudo completar la operación. Inténtalo nuevamente.');
  return data;
}
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la operación.';
export const reservationLabels: Record<string, string> = {
  disponible: 'Disponible', pendiente: 'Pendiente', confirmada: 'Confirmada', rechazada: 'Rechazada',
  cancelada: 'Cancelada', finalizada: 'Completada', inasistencia: 'Inasistencia', bloqueado: 'Bloqueo', descanso: 'Descanso',
};
