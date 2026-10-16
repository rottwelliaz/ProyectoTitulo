import { authFetch as fetch, API_URL } from '../lib/session';
import { useEffect, useState } from 'react';
import { businessTime, formatInstant } from '../lib/businessTime';

type AppointmentStatus = 'pendiente' | 'confirmada' | 'rechazada' | 'cancelada' | 'finalizada' | 'inasistencia';

interface Appointment {
  id: string;
  fecha_hora: string;
  estado: AppointmentStatus;
  duracionReservada?: number | null;
  comprobanteTransferencia: string | null;
  comprobanteNombre: string | null;
  cliente: {
    id: number;
    nombre: string;
    telefono: string | null;
  } | null;
  servicio: {
    id: string;
    nombre_servicio: string;
    duracion_minutos: number;
  } | null;
}



const STATUS_LABELS: Record<AppointmentStatus, string> = {
  pendiente: 'Pendiente',
  rechazada: 'Rechazada',
  inasistencia: 'Inasistencia',
  confirmada: 'Confirmada',
  cancelada: 'Cancelada',
  finalizada: 'Finalizada',
};

const sortAppointmentsByNewest = (items: Appointment[]) =>
  [...items].sort((a, b) => new Date(b.fecha_hora).getTime() - new Date(a.fecha_hora).getTime());

export default function BarberAppointments() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [listView, setListView] = useState<'reservas' | 'historial'>('reservas');
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const changeView = (event: Event) => setListView((event as CustomEvent<string>).detail === 'historial' ? 'historial' : 'reservas');
    window.addEventListener('professional-appointments-view', changeView);
    return () => window.removeEventListener('professional-appointments-view', changeView);
  }, []);
  const visibleAppointments = appointments.filter(item => {
    const historical = new Date(item.fecha_hora).getTime() < Date.now() || ['cancelada', 'rechazada', 'finalizada', 'inasistencia'].includes(item.estado);
    return listView === 'historial' ? historical : !historical;
  });

  useEffect(() => {
    const loadAppointments = async () => {
      const token = window.localStorage.getItem('token');
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(`${API_URL}/citas/mias`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json().catch(() => []);
        if (!response.ok) throw new Error(data.message || 'No se pudieron cargar tus citas.');
        setAppointments(Array.isArray(data) ? sortAppointmentsByNewest(data as Appointment[]) : []);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'No se pudieron cargar tus citas.');
      } finally {
        setLoading(false);
      }
    };

    void loadAppointments();
  }, []);

  const updateStatus = async (appointment: Appointment, estado: AppointmentStatus) => {
    const action = { confirmada: 'confirmar', rechazada: 'rechazar', cancelada: 'cancelar', finalizada: 'finalizar', inasistencia: 'marcar con inasistencia', pendiente: '' }[estado];
    if (!window.confirm(`¿Seguro que deseas ${action} esta cita?`)) return;

    const token = window.localStorage.getItem('token');
    if (!token) return;

    setUpdatingId(appointment.id);
    setError('');
    try {
      const response = await fetch(`${API_URL}/citas/${appointment.id}/estado`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ estado }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'No se pudo actualizar la cita.');

      setAppointments((current) =>
        sortAppointmentsByNewest(current.map((item) => item.id === data.id ? data as Appointment : item)),
      );
      window.dispatchEvent(new Event('professional-calendar-updated'));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo actualizar la cita.');
    } finally {
      setUpdatingId(null);
    }
  };

  const viewProof = async (appointment: Appointment) => {
    if (!appointment.comprobanteTransferencia) {
      setError('Esta cita no tiene comprobante registrado.');
      return;
    }

    const proofWindow = window.open('', '_blank');
    if (!proofWindow) {
      setError('El navegador bloqueo la pestaña del comprobante.');
      return;
    }

    proofWindow.opener = null;
    proofWindow.document.title = appointment.comprobanteNombre || 'Comprobante';
    proofWindow.document.body.innerHTML = '<p style="font-family: system-ui; padding: 24px;">Cargando comprobante...</p>';

    try {
      const response = await fetch(appointment.comprobanteTransferencia);
      const blob = await response.blob();
      const proofUrl = URL.createObjectURL(blob);
      proofWindow.location.href = proofUrl;
      window.setTimeout(() => URL.revokeObjectURL(proofUrl), 60_000);
    } catch {
      proofWindow.close();
      setError('No se pudo abrir el comprobante.');
    }
  };

  return (
    <article id="citas-profesional" className="pro-panel pro-appointments">
      <div className="pro-panel-header">
        <div>
          <h2>{listView === 'historial' ? 'Historial de citas' : 'Reservas'}</h2>
          <p className="appointments-helper">{listView === 'historial' ? 'Reservas anteriores y citas cerradas.' : 'Las reservas de clientes se confirman automáticamente.'}</p>
        </div>
      </div>

      {error && <p className="appointments-message is-error" role="alert">{error}</p>}
      {loading ? (
        <p className="pro-empty">Cargando citas...</p>
      ) : visibleAppointments.length === 0 ? (
        <p className="pro-empty">{listView === 'historial' ? 'Aún no tienes citas en el historial.' : 'Aún no tienes reservas activas.'}</p>
      ) : (
        <div className="appointments-list">
          {visibleAppointments.map((appointment) => (
            <section key={appointment.id} className="appointment-card">
              <div className="appointment-date">
                <strong>{formatInstant(appointment.fecha_hora, { day: '2-digit' })}</strong>
                <span>{formatInstant(appointment.fecha_hora, { month: 'short' })}</span>
                <time>{businessTime(appointment.fecha_hora)}</time>
              </div>

              <div className="appointment-info">
                <strong>{appointment.cliente?.nombre || 'Cliente'}</strong>
                <span>{appointment.servicio?.nombre_servicio || 'Servicio'}</span>
                <small>{appointment.cliente?.telefono || 'Sin teléfono registrado'}</small>
              </div>

              <span className={`appointment-status is-${appointment.estado}`}>
                {STATUS_LABELS[appointment.estado]}
              </span>

              <div className="appointment-actions">
                {appointment.comprobanteTransferencia && (
                  <button
                    type="button"
                    className="is-proof"
                    onClick={() => void viewProof(appointment)}
                  >
                    Ver comprobante
                  </button>
                )}

                {!appointment.comprobanteTransferencia && (
                  <span className="appointment-no-proof">Sin comprobante</span>
                )}

                {(() => {
                  const start = new Date(appointment.fecha_hora).getTime();
                  const duration = appointment.duracionReservada ?? appointment.servicio?.duracion_minutos;
                  const ended = duration && start + duration * 60000 <= Date.now();
                  const actions: AppointmentStatus[] = appointment.estado === 'pendiente' && start > Date.now()
                    ? ['confirmada', 'rechazada', 'cancelada']
                    : appointment.estado === 'confirmada'
                      ? start > Date.now() ? ['cancelada'] : ended ? ['finalizada', 'inasistencia'] : []
                      : [];
                  const labels = { confirmada: 'Confirmar', rechazada: 'Rechazar', cancelada: 'Cancelar', finalizada: 'Finalizar', inasistencia: 'Marcar inasistencia', pendiente: '' };
                  return actions.map(status => (
                    <button key={status} type="button"
                      className={['cancelada', 'rechazada'].includes(status) ? 'is-cancel' : 'is-finish'}
                      disabled={updatingId !== null}
                      onClick={() => void updateStatus(appointment, status)}>{labels[status]}</button>
                  ));
                })()}
              </div>
            </section>
          ))}
        </div>
      )}
    </article>
  );
}
