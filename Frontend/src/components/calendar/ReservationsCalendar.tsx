import { useEffect, useMemo, useState } from 'react';
import { addDays, addWeeks, format, startOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';

interface ReservationSlot {
  id: string;
  fecha_hora: string;
  estado: 'disponible' | 'confirmada';
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
const HOURS = Array.from({ length: 11 }, (_, index) => index + 9);
const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export default function ReservationsCalendar() {
  const currentWeek = useMemo(() => startOfWeek(new Date(), { weekStartsOn: 1 }), []);
  const [weekStart, setWeekStart] = useState(currentWeek);
  const [slots, setSlots] = useState<ReservationSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );

  useEffect(() => {
    const loadCalendar = async () => {
      const token = window.localStorage.getItem('token');
      if (!token) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const profileResponse = await fetch(`${API_URL}/auth/me`, { headers });
        const profile = await profileResponse.json().catch(() => ({}));
        if (!profileResponse.ok || !profile.perfilBarbero?.id) {
          throw new Error(profile.message || 'No se encontro el perfil profesional.');
        }

        const [appointmentsResponse, ...availabilityResponses] = await Promise.all([
          fetch(`${API_URL}/citas/mias`, { headers }),
          ...weekDays.map((day) =>
            fetch(
              `${API_URL}/citas/disponibilidad/${profile.perfilBarbero.id}?fecha=${format(day, 'yyyy-MM-dd')}`,
              { headers },
            ),
          ),
        ]);

        const appointments = await appointmentsResponse.json().catch(() => []);
        if (!appointmentsResponse.ok) {
          throw new Error(appointments.message || 'No se pudieron cargar las reservas.');
        }

        const availabilityPayloads = await Promise.all(
          availabilityResponses.map(async (response) => {
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.message || 'No se pudo cargar la disponibilidad.');
            return Array.isArray(data.citas) ? data.citas as ReservationSlot[] : [];
          }),
        );

        const weekEnd = addDays(weekStart, 7);
        const confirmed = (Array.isArray(appointments) ? appointments as ReservationSlot[] : []).filter((slot) => {
          const date = new Date(slot.fecha_hora);
          return slot.estado === 'confirmada' && date >= weekStart && date < weekEnd;
        });

        setSlots([...availabilityPayloads.flat(), ...confirmed]);
      } catch (requestError) {
        setSlots([]);
        setError(requestError instanceof Error ? requestError.message : 'No se pudo cargar el calendario.');
      } finally {
        setLoading(false);
      }
    };

    void loadCalendar();
  }, [weekStart, refreshKey]);

  const slotsByTime = useMemo(() => {
    const result = new Map<string, ReservationSlot>();
    slots.forEach((slot) => {
      const date = new Date(slot.fecha_hora);
      result.set(`${format(date, 'yyyy-MM-dd')}-${date.getHours()}`, slot);
    });
    return result;
  }, [slots]);

  return (
    <article className="pro-panel reservations-calendar">
      <div className="calendar-toolbar">
        <div>
          <h2>Calendario de reservas</h2>
          <p>
            {format(weekStart, "d 'de' MMMM", { locale: es })} –{' '}
            {format(weekDays[6], "d 'de' MMMM 'de' yyyy", { locale: es })}
          </p>
        </div>

        <div className="calendar-actions">
          <button type="button" onClick={() => setWeekStart(currentWeek)}>Semana actual</button>
          <button type="button" onClick={() => setWeekStart((week) => addWeeks(week, -1))}>← Anterior</button>
          <button type="button" onClick={() => setWeekStart((week) => addWeeks(week, 1))}>Siguiente →</button>
          <button type="button" onClick={() => setRefreshKey((key) => key + 1)}>Actualizar</button>
        </div>
      </div>

      {error && <p className="reservations-calendar-error" role="alert">{error}</p>}

      <div className={`calendar-scroll${loading ? ' is-loading' : ''}`}>
        <div className="calendar-grid">
          <div className="calendar-time-column">
            <span className="calendar-corner">Hora</span>
            {HOURS.map((hour) => <time key={hour}>{String(hour).padStart(2, '0')}:00</time>)}
          </div>

          {weekDays.map((date) => (
            <div key={date.toISOString()} className="calendar-day">
              <div className="calendar-day-header">
                <strong>{capitalize(format(date, 'EEEE', { locale: es }))}</strong>
                <span>{format(date, 'd')}</span>
              </div>

              {HOURS.map((hour) => {
                const key = `${format(date, 'yyyy-MM-dd')}-${hour}`;
                const slot = slotsByTime.get(key);
                const reserved = slot?.estado === 'confirmada';
                const available = slot?.estado === 'disponible';
                const title = reserved
                  ? `${slot.cliente?.nombre || 'Cliente'} · ${slot.servicio?.nombre_servicio || 'Servicio'}`
                  : available
                    ? 'Disponible para reservar'
                    : 'Horario no habilitado';

                return (
                  <div
                    key={key}
                    className={`reservation-calendar-slot${reserved ? ' is-reserved' : available ? ' is-available' : ' is-unavailable'}`}
                    title={title}
                  >
                    <strong>{reserved ? 'Reservado' : available ? 'Disponible' : 'No habilitado'}</strong>
                    {reserved && <small>{slot.cliente?.nombre || 'Cliente'}</small>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="calendar-legend">
        <span><i className="is-available" />Disponible</span>
        <span><i className="is-reserved" />Reservado por cliente</span>
        <span><i className="is-unavailable" />No habilitado</span>
      </div>
    </article>
  );
}
