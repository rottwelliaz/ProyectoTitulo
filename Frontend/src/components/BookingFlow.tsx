import { useEffect, useMemo, useState } from 'react';
import { addDays, addWeeks, format, startOfDay } from 'date-fns';
import { es } from 'date-fns/locale';

interface Service {
  id: string;
  nombre_servicio: string;
  descripcion: string | null;
  precio: number;
  duracion_minutos: number;
}

interface Barber {
  id: number;
  biografia: string | null;
  foto_perfil: string | null;
  usuario: {
    id: number;
    nombre: string;
  };
  lugarTrabajo: {
    id: number;
    nombre_barberia: string | null;
    direccion: string | null;
  } | null;
  servicios: Service[];
}

interface AppointmentSlot {
  id: string;
  fecha_hora: string;
}

interface AvailabilityResponse {
  citas: AppointmentSlot[];
  servicios: Service[];
  message?: string;
}

const API_URL = 'http://localhost:3001/api';

const initials = (name: string) =>
  name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'B';

const money = (value: number) =>
  new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(value);

export default function BookingFlow() {
  const [token, setToken] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [selectedBarberId, setSelectedBarberId] = useState<number | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [slots, setSlots] = useState<AppointmentSlot[]>([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState(startOfDay(new Date()));
  const [loadingBarbers, setLoadingBarbers] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [booking, setBooking] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const weekStart = useMemo(() => addWeeks(startOfDay(new Date()), weekOffset), [weekOffset]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );
  const selectedBarber = barbers.find((barber) => barber.id === selectedBarberId) ?? null;
  const selectedService = selectedBarber?.servicios.find((service) => service.id === selectedServiceId) ?? null;
  const selectedSlot = slots.find((slot) => slot.id === selectedSlotId) ?? null;

  useEffect(() => {
    const savedToken = window.localStorage.getItem('token');
    setToken(savedToken);

    if (!savedToken) {
      setLoadingBarbers(false);
      setAuthChecked(true);
      return;
    }

    const loadBarbers = async () => {
      try {
        const meResponse = await fetch(`${API_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${savedToken}` },
        });
        const user = await meResponse.json().catch(() => ({}));
        if (!meResponse.ok) throw new Error('Tu sesion expiro. Inicia sesion nuevamente.');
        if (user.rol !== 'cliente') throw new Error('Las reservas deben realizarse desde una cuenta de cliente.');

        const response = await fetch(`${API_URL}/citas/barberos`, {
          headers: { Authorization: `Bearer ${savedToken}` },
        });
        const data = await response.json().catch(() => []);
        if (!response.ok) throw new Error(data.message || 'No se pudieron cargar los barberos.');

        const availableBarbers = Array.isArray(data) ? data as Barber[] : [];
        setBarbers(availableBarbers);

        const requestedId = Number(new URLSearchParams(window.location.search).get('barbero'));
        if (requestedId && availableBarbers.some((barber) => barber.id === requestedId)) {
          setSelectedBarberId(requestedId);
        }
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'No se pudieron cargar los barberos.');
      } finally {
        setLoadingBarbers(false);
        setAuthChecked(true);
      }
    };

    void loadBarbers();
  }, []);

  useEffect(() => {
    if (!token || !selectedBarberId) {
      setSlots([]);
      return;
    }

    const loadAvailability = async () => {
      setLoadingSlots(true);
      setError('');
      setSelectedSlotId(null);

      try {
        const date = format(selectedDate, 'yyyy-MM-dd');
        const response = await fetch(
          `${API_URL}/citas/disponibilidad/${selectedBarberId}?fecha=${date}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const data = await response.json().catch(() => ({})) as AvailabilityResponse;
        if (!response.ok) throw new Error(data.message || 'No se pudo cargar la disponibilidad.');
        setSlots(Array.isArray(data.citas) ? data.citas : []);
      } catch (requestError) {
        setSlots([]);
        setError(requestError instanceof Error ? requestError.message : 'No se pudo cargar la disponibilidad.');
      } finally {
        setLoadingSlots(false);
      }
    };

    void loadAvailability();
  }, [selectedBarberId, selectedDate, token]);

  const chooseBarber = (barber: Barber) => {
    setSelectedBarberId(barber.id);
    setSelectedServiceId(null);
    setSelectedSlotId(null);
    setMessage('');
    setError('');
  };

  const moveWeek = (direction: number) => {
    const nextOffset = Math.max(0, weekOffset + direction);
    const nextStart = addWeeks(startOfDay(new Date()), nextOffset);
    setWeekOffset(nextOffset);
    setSelectedDate(nextStart);
  };

  const confirmBooking = async () => {
    if (!token || !selectedSlotId || !selectedServiceId) return;
    setBooking(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch(`${API_URL}/citas/${selectedSlotId}/agendar`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ servicioId: selectedServiceId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'No se pudo completar la reserva.');

      setSlots((current) => current.filter((slot) => slot.id !== selectedSlotId));
      setSelectedSlotId(null);
      setMessage('Hora reservada y confirmada correctamente.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo completar la reserva.');
    } finally {
      setBooking(false);
    }
  };

  if (authChecked && !token) {
    return (
      <main className="booking-root booking-centered">
        <section className="booking-auth-card">
          <span>Reserva protegida</span>
          <h1>Inicia sesion para reservar</h1>
          <p>Necesitas una cuenta de cliente para elegir barbero, servicio y horario.</p>
          <a href="/login?redirect=/booking">Iniciar sesion</a>
        </section>
      </main>
    );
  }

  return (
    <main className="booking-root">
      <header className="booking-header">
        <div>
          <a href="/home">← Volver al inicio</a>
          <h1>Reservar hora</h1>
          <p>Elige tu profesional, servicio y un horario disponible.</p>
        </div>
        <div className="booking-steps" aria-label="Pasos de la reserva">
          <span className={selectedBarber ? 'is-complete' : 'is-current'}>1 Barbero</span>
          <span className={selectedService ? 'is-complete' : selectedBarber ? 'is-current' : ''}>2 Servicio</span>
          <span className={selectedSlot ? 'is-complete' : selectedService ? 'is-current' : ''}>3 Horario</span>
        </div>
      </header>

      {error && <p className="booking-alert is-error" role="alert">{error}</p>}
      {message && <p className="booking-alert is-success" role="status">{message}</p>}

      <section className="booking-panel">
        <div className="booking-section-title">
          <span>01</span>
          <div><h2>Selecciona un barbero</h2><p>Profesionales con lugar de trabajo registrado.</p></div>
        </div>

        {loadingBarbers ? (
          <p className="booking-empty">Cargando barberos...</p>
        ) : barbers.length === 0 ? (
          <p className="booking-empty">No hay barberos disponibles para reservar.</p>
        ) : (
          <div className="booking-barbers">
            {barbers.map((barber) => (
              <button
                key={barber.id}
                type="button"
                className={`booking-barber-card${selectedBarberId === barber.id ? ' is-selected' : ''}`}
                onClick={() => chooseBarber(barber)}
              >
                <span className="booking-avatar">{initials(barber.usuario.nombre)}</span>
                <strong>{barber.usuario.nombre}</strong>
                <small>{barber.lugarTrabajo?.nombre_barberia || 'Barberia'}</small>
                <em>{barber.lugarTrabajo?.direccion || 'Direccion no informada'}</em>
              </button>
            ))}
          </div>
        )}
      </section>

      {selectedBarber && (
        <section className="booking-panel">
          <div className="booking-section-title">
            <span>02</span>
            <div><h2>Selecciona un servicio</h2><p>Servicios ofrecidos por {selectedBarber.usuario.nombre}.</p></div>
          </div>

          {selectedBarber.servicios.length === 0 ? (
            <p className="booking-empty">Este barbero aun no tiene servicios registrados.</p>
          ) : (
            <div className="booking-services">
              {selectedBarber.servicios.map((service) => (
                <button
                  key={service.id}
                  type="button"
                  className={`booking-service-card${selectedServiceId === service.id ? ' is-selected' : ''}`}
                  onClick={() => {
                    setSelectedServiceId(service.id);
                    setSelectedSlotId(null);
                  }}
                >
                  <span><strong>{service.nombre_servicio}</strong><small>{service.descripcion || 'Servicio profesional'}</small></span>
                  <span><b>{money(service.precio)}</b><em>{service.duracion_minutos} min</em></span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {selectedBarber && selectedService && (
        <section className="booking-panel">
          <div className="booking-section-title">
            <span>03</span>
            <div><h2>Selecciona fecha y hora</h2><p>Solo se muestran bloques disponibles en la agenda.</p></div>
          </div>

          <div className="booking-week-nav">
            <button type="button" onClick={() => moveWeek(-1)} disabled={weekOffset === 0}>← Semana anterior</button>
            <strong>{format(weekDays[0], 'd MMM', { locale: es })} – {format(weekDays[6], 'd MMM yyyy', { locale: es })}</strong>
            <button type="button" onClick={() => moveWeek(1)}>Semana siguiente →</button>
          </div>

          <div className="booking-days">
            {weekDays.map((day) => {
              const key = format(day, 'yyyy-MM-dd');
              return (
                <button
                  key={key}
                  type="button"
                  className={format(selectedDate, 'yyyy-MM-dd') === key ? 'is-selected' : ''}
                  onClick={() => setSelectedDate(day)}
                >
                  <span>{format(day, 'EEE', { locale: es })}</span>
                  <strong>{format(day, 'd')}</strong>
                  <small>{format(day, 'MMM', { locale: es })}</small>
                </button>
              );
            })}
          </div>

          <div className="booking-slots">
            {loadingSlots ? (
              <p className="booking-empty">Consultando agenda...</p>
            ) : slots.length === 0 ? (
              <p className="booking-empty">No hay horas disponibles para esta fecha.</p>
            ) : (
              slots.map((slot) => (
                <button
                  key={slot.id}
                  type="button"
                  className={selectedSlotId === slot.id ? 'is-selected' : ''}
                  onClick={() => setSelectedSlotId(slot.id)}
                >
                  {format(new Date(slot.fecha_hora), 'HH:mm')}
                </button>
              ))
            )}
          </div>

          {selectedSlot && (
            <div className="booking-summary">
              <div>
                <span>Resumen</span>
                <strong>{selectedBarber.usuario.nombre} · {selectedService.nombre_servicio}</strong>
                <p>{format(new Date(selectedSlot.fecha_hora), "EEEE d 'de' MMMM, HH:mm", { locale: es })}</p>
              </div>
              <button type="button" disabled={booking} onClick={confirmBooking}>
                {booking ? 'Reservando...' : 'Confirmar reserva'}
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
