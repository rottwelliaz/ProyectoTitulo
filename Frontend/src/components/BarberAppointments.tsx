import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

type AppointmentStatus = 'confirmada' | 'cancelada' | 'finalizada';

interface Appointment {
  id: string;
  fecha_hora: string;
  estado: AppointmentStatus;
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

const API_URL = 'http://localhost:3001/api';

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  confirmada: 'Confirmada',
  cancelada: 'Cancelada',
  finalizada: 'Finalizada',
};

const sortAppointmentsByNewest = (items: Appointment[]) =>
  [...items].sort((a, b) => new Date(b.fecha_hora).getTime() - new Date(a.fecha_hora).getTime());

export default function BarberAppointments() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState('');

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

  const updateStatus = async (appointment: Appointment, estado: 'cancelada' | 'finalizada') => {
    const action = estado === 'cancelada' ? 'cancelar' : 'finalizar';
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
    <article className="pro-panel pro-appointments">
      <div className="pro-panel-header">
        <div>
          <h2>Mis citas</h2>
          <p className="appointments-helper">Las reservas de clientes se confirman automaticamente.</p>
        </div>
      </div>

      {error && <p className="appointments-message is-error" role="alert">{error}</p>}
      {loading ? (
        <p className="pro-empty">Cargando citas...</p>
      ) : appointments.length === 0 ? (
        <p className="pro-empty">Aun no tienes citas de clientes.</p>
      ) : (
        <div className="appointments-list">
          {appointments.map((appointment) => (
            <section key={appointment.id} className="appointment-card">
              <div className="appointment-date">
                <strong>{format(new Date(appointment.fecha_hora), 'dd')}</strong>
                <span>{format(new Date(appointment.fecha_hora), 'MMM', { locale: es })}</span>
                <time>{format(new Date(appointment.fecha_hora), 'HH:mm')}</time>
              </div>

              <div className="appointment-info">
                <strong>{appointment.cliente?.nombre || 'Cliente'}</strong>
                <span>{appointment.servicio?.nombre_servicio || 'Servicio'}</span>
                <small>{appointment.cliente?.telefono || 'Sin telefono registrado'}</small>
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

                {appointment.estado === 'confirmada' && (
                  <>
                  <button
                    type="button"
                    className="is-cancel"
                    disabled={updatingId === appointment.id}
                    onClick={() => void updateStatus(appointment, 'cancelada')}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="is-finish"
                    disabled={updatingId === appointment.id}
                    onClick={() => void updateStatus(appointment, 'finalizada')}
                  >
                    Finalizar
                  </button>
                  </>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </article>
  );
}
