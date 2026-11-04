import PaginatedCards from './PaginatedCards';
import { appointmentOrders } from '../lib/dataTables';
import { authFetch as fetch, API_URL } from '../lib/session';
import { useEffect, useRef, useState } from 'react';
import { confirmAction, notifyError } from '../lib/notifications';
import { businessTime, formatInstant, reservationEnd, reservationDuration } from '../lib/businessTime';

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

export default function BarberAppointments() {
  const [revision, setRevision] = useState(0);
  const [listView, setListView] = useState<'reservas' | 'historial'>('reservas');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const updating = useRef(false);

  useEffect(() => {
    const changeView = (event: Event) => { setListView((event as CustomEvent<string>).detail === 'historial' ? 'historial' : 'reservas'); };
    const refresh = () => { if (!document.hidden && !updating.current) setRevision(n => n + 1); };
    window.addEventListener('professional-appointments-view', changeView);
    window.addEventListener('professional-calendar-updated', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const timer = window.setInterval(refresh, 30000);
    return () => { clearInterval(timer); window.removeEventListener('professional-appointments-view', changeView); window.removeEventListener('professional-calendar-updated', refresh); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  const updateStatus = async (appointment: Appointment, estado: AppointmentStatus) => {
    const action = { confirmada: 'confirmar', rechazada: 'rechazar', cancelada: 'cancelar', finalizada: 'finalizar', inasistencia: 'marcar con inasistencia', pendiente: '' }[estado];
    const token = window.localStorage.getItem('token');
    if (!token || updating.current) return;

    updating.current = true;
    setUpdatingId(appointment.id);
    try {
      if (!await confirmAction(`¿Seguro que deseas ${action} esta cita?`, 'Sí, ' + action, !['confirmada', 'finalizada'].includes(estado))) return;
      setError('');
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

      setRevision(current => current + 1);
      window.dispatchEvent(new Event('professional-calendar-updated'));
    } catch {
      void notifyError('No se pudo actualizar la cita. Inténtalo nuevamente.');
    } finally {
      updating.current = false;
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
      <div className="appointments-list">
        <PaginatedCards<Appointment> endpoint={`/citas/mias?vista=${listView}`} orders={appointmentOrders} revision={revision}
          label={listView === 'historial' ? 'Historial de citas' : 'Reservas'}
          empty="Aún no tienes citas en esta sección."
          render={appointment => (
            <section key={appointment.id} className="appointment-card">
              <div className="appointment-date">
                <strong>{formatInstant(appointment.fecha_hora, { day: '2-digit' })}</strong>
                <span>{formatInstant(appointment.fecha_hora, { month: 'short' })}</span>
                <time>{businessTime(appointment.fecha_hora)}–{reservationEnd(appointment) ? businessTime(reservationEnd(appointment)!) : 'Por verificar'}</time>
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
                  const duration = reservationDuration(appointment);
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
          )} />
      </div>
    </article>
  );
}
