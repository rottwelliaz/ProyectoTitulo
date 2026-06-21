import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

type AppointmentStatus = 'confirmada' | 'cancelada' | 'finalizada';

interface Appointment {
  id: string;
  fecha_hora: string;
  estado: AppointmentStatus;
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
        setAppointments(Array.isArray(data) ? data : []);
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

      setAppointments((current) => current.map((item) => item.id === data.id ? data as Appointment : item));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo actualizar la cita.');
    } finally {
      setUpdatingId(null);
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

              {appointment.estado === 'confirmada' && (
                <div className="appointment-actions">
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
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </article>
  );
}
