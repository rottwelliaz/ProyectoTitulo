import { authFetch as fetch, API_URL } from '../lib/session';
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { businessDate, formatInstant, startOfWeek } from '../lib/businessTime';
import { safePhotoUrl, photoBackground } from '../lib/profilePhoto';
import BookingCalendar, { type BookingCalendarCell, type BookingCalendarData } from './calendar/BookingCalendar';

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
  requiereComprobante: boolean;
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

interface PaymentDetails {
  citaId: string;
  servicioId: string;
  barberoId: number;
  bancoNombre: string;
  bancoRut: string;
  bancoNombreBanco: string;
  bancoTipoCuenta: string;
  bancoNroCuenta: string;
  bancoCorreo: string;
}

interface AvailabilityResponse {
  citas: AppointmentSlot[];
  servicios: Service[];
  calendario: BookingCalendarData;
  message?: string;
}



const initials = (name: string) =>
  name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'B';

const money = (value: number) =>
  new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(value);

const isFutureSlot = (slot: AppointmentSlot) => new Date(slot.fecha_hora).getTime() > Date.now();

export default function BookingFlow() {
  const servicesPanelRef = useRef<HTMLElement | null>(null);
  const schedulePanelRef = useRef<HTMLElement | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const paymentPanelRef = useRef<HTMLDivElement | null>(null);
  const successMessageRef = useRef<HTMLParagraphElement | null>(null);
  const errorMessageRef = useRef<HTMLParagraphElement | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [selectedBarberId, setSelectedBarberId] = useState<number | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [slots, setSlots] = useState<AppointmentSlot[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const today = businessDate(new Date(now));
  const [weekStart, setWeekStart] = useState(() => startOfWeek(businessDate()));
  const [selectedDate, setSelectedDate] = useState(() => businessDate());
  const [calendar, setCalendar] = useState<BookingCalendarData | null>(null);
  const [calendarError, setCalendarError] = useState('');
  const [availabilityVersion, setAvailabilityVersion] = useState(0);
  const selectionRef = useRef<string | null>(null);
  const [loadingBarbers, setLoadingBarbers] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [booking, setBooking] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [paymentDetails, setPaymentDetails] = useState<PaymentDetails | null>(null);
  const [loadingPayment, setLoadingPayment] = useState(false);
  const paymentRequest = useRef(0);
  const [proofData, setProofData] = useState('');
  const [proofName, setProofName] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const requestedBarberId = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return Number(new URLSearchParams(window.location.search).get('barbero')) || null;
  }, []);

  const selectedBarber = barbers.find((barber) => barber.id === selectedBarberId) ?? null;
  const selectedService = selectedBarber?.servicios.find((service) => service.id === selectedServiceId) ?? null;
  const selectedSlot = slots.find((slot) => slot.id === selectedSlotId) ?? null;
  const requiresProof = selectedBarber?.requiereComprobante ?? true;
  const hasBankingData = paymentDetails?.citaId === selectedSlotId &&
    paymentDetails?.servicioId === selectedServiceId && paymentDetails?.barberoId === selectedBarberId;

  useEffect(() => { selectionRef.current = selectedSlotId; }, [selectedSlotId]);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const interval = window.setInterval(tick, 1000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  useEffect(() => {
    setWeekStart(week => week < startOfWeek(today) ? startOfWeek(today) : week);
    setSelectedDate(date => date < today ? today : date);
  }, [today]);

  useEffect(() => {
    if (selectedSlot && new Date(selectedSlot.fecha_hora).getTime() <= now) {
      setSelectedSlotId(null);
      setShowPayment(false);
    }
  }, [now, selectedSlot]);

  useEffect(() => {
    const refresh = () => { if (!document.hidden) setAvailabilityVersion(version => version + 1); };
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  useEffect(() => {
    paymentRequest.current++;
    setPaymentDetails(null);
    setLoadingPayment(false);
    setShowPayment(false);
    return () => { paymentRequest.current++; };
  }, [token, selectedBarberId, selectedServiceId, selectedSlotId, selectedDate]);

  const scrollToElement = (element: HTMLElement | null) => {
    if (!element) return;
    window.setTimeout(() => {
      element.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      });
    }, 0);
  };

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
        if (!meResponse.ok) throw new Error('Tu sesión expiró. Inicia sesión nuevamente.');
        if (user.rol !== 'cliente') throw new Error('Las reservas deben realizarse desde una cuenta de cliente.');

        const response = await fetch(`${API_URL}/citas/barberos`, {
          headers: { Authorization: `Bearer ${savedToken}` },
        });
        const data = await response.json().catch(() => []);
        if (!response.ok) throw new Error(data.message || 'No se pudieron cargar los barberos.');

        const availableBarbers = Array.isArray(data) ? data as Barber[] : [];
        const requestedBarber = requestedBarberId
          ? availableBarbers.find((barber) => barber.id === requestedBarberId)
          : null;

        if (requestedBarberId && requestedBarber) {
          setBarbers([requestedBarber]);
          setSelectedBarberId(requestedBarberId);
        } else {
          setBarbers(availableBarbers);
          if (requestedBarberId) {
            setError('El barbero seleccionado no está disponible para reservar.');
          }
        }
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'No se pudieron cargar los barberos.');
      } finally {
        setLoadingBarbers(false);
        setAuthChecked(true);
      }
    };

    void loadBarbers();
  }, [requestedBarberId]);

  useEffect(() => {
    if (!token || !selectedBarberId || !selectedServiceId) {
      setSlots([]);
      setCalendar(null);
      return;
    }

    let active = true;
    const controller = new AbortController();
    const loadAvailability = async () => {
      setLoadingSlots(true);
      setCalendarError('');

      try {
        const params = new URLSearchParams({
          // The API derives the period bounds in America/Santiago.
          // Keep the selected week as a civil date, independent of browser TZ.
          fecha: weekStart,
          servicioId: selectedServiceId,
          vista: 'semana',
        });
        const response = await fetch(
          `${API_URL}/citas/disponibilidad/${selectedBarberId}?${params}`,
          { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal },
        );
        const data = await response.json().catch(() => ({})) as AvailabilityResponse;
        if (!response.ok) throw new Error(data.message || 'No se pudo cargar la disponibilidad.');
        if (!Array.isArray(data.citas) || !Array.isArray(data.calendario?.horarios) || !Array.isArray(data.calendario?.horas)) throw new Error('No se pudo cargar el calendario. Vuelve a consultar la agenda.');
        if (active) {
          const nextSlots = data.citas.filter(isFutureSlot);
          setSlots(nextSlots);
          setCalendar(data.calendario);
          if (selectionRef.current && !nextSlots.some(slot => slot.id === selectionRef.current)) {
            setSelectedSlotId(null);
            setError('El horario seleccionado dejó de estar disponible. Elige otra hora de la agenda actualizada.');
          }
        }
      } catch (requestError) {
        if (active) {
          setSlots([]);
          setCalendar(null);
          setSelectedSlotId(null);
          setCalendarError(requestError instanceof Error ? requestError.message : 'No se pudo cargar la disponibilidad.');
        }
      } finally {
        if (active) setLoadingSlots(false);
      }
    };

    void loadAvailability();
    return () => { active = false; controller.abort(); };
  }, [selectedBarberId, selectedServiceId, weekStart, token, availabilityVersion]);

  useEffect(() => {
    if (selectedBarber) {
      scrollToElement(servicesPanelRef.current);
    }
  }, [selectedBarberId, selectedBarber]);

  useEffect(() => {
    if (selectedService) {
      scrollToElement(schedulePanelRef.current);
    }
  }, [selectedServiceId, selectedService]);

  useEffect(() => {
    if (selectedSlot) {
      scrollToElement(summaryRef.current);
    }
  }, [selectedSlotId, selectedSlot?.id]);

  useEffect(() => {
    if (showPayment) {
      scrollToElement(paymentPanelRef.current);
    }
  }, [showPayment]);

  useEffect(() => {
    if (message) {
      scrollToElement(successMessageRef.current);
    }
  }, [message]);

  useEffect(() => {
    if (error) {
      scrollToElement(errorMessageRef.current);
    }
  }, [error]);

  const chooseBarber = (barber: Barber) => {
    setSelectedBarberId(barber.id);
    setSelectedServiceId(null);
    setSelectedSlotId(null);
    setShowPayment(false);
    setProofData('');
    setProofName('');
    setMessage('');
    setError('');
    setWeekStart(startOfWeek(businessDate()));
    setSelectedDate(businessDate());
  };

  const changeDate = (date: string) => {
    if (date < businessDate()) return;
    setSelectedDate(date);
    setSelectedSlotId(null);
  };

  const changeWeek = (date: string) => {
    const today = businessDate();
    const week = startOfWeek(date);
    if (week < startOfWeek(today)) return;
    setWeekStart(week);
    changeDate(week < today ? today : week);
  };

  const invalidateSelection = () => {
    setSelectedSlotId(null);
    setShowPayment(false);
    setProofData('');
    setProofName('');
    setAvailabilityVersion(version => version + 1);
  };

  const selectCalendarSlot = (cell: BookingCalendarCell) => {
    if (cell.estado !== 'available' || !cell.citaId || !cell.fecha_hora || new Date(cell.fecha_hora).getTime() <= Date.now()) return;
    setSelectedDate(cell.fecha);
    setSelectedSlotId(cell.citaId);
    setShowPayment(false);
    setProofData('');
    setProofName('');
    setMessage('');
    setError('');
  };

  const openPaymentStep = async () => {
    if (selectedSlot && !isFutureSlot(selectedSlot)) {
      setSelectedSlotId(null);
      setShowPayment(false);
      setError('Esta hora ya pasó. Selecciona otro horario disponible.');
      return;
    }

    if (!requiresProof) {
      void confirmBooking();
      return;
    }

    if (!token || !selectedSlotId || !selectedServiceId) return;
    const requestId = ++paymentRequest.current;
    setLoadingPayment(true);
    setPaymentDetails(null);
    setShowPayment(false);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/citas/${selectedSlotId}/pago`, {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ servicioId: selectedServiceId }),
      });
      const data = await response.json().catch(() => ({}));
      if (requestId !== paymentRequest.current) return;
      if (!response.ok) {
        if ([404, 409].includes(response.status)) invalidateSelection();
        throw new Error(data.message || 'No se pudieron cargar los datos de pago.');
      }
      if (data.citaId !== selectedSlotId || data.servicioId !== selectedServiceId || data.barberoId !== selectedBarberId) {
        throw new Error('Los datos de pago no corresponden a la selección actual.');
      }
      setPaymentDetails(data);
      setShowPayment(true);
    } catch (requestError) {
      if (requestId === paymentRequest.current) setError(requestError instanceof Error ? requestError.message : 'No se pudieron cargar los datos de pago.');
    } finally {
      if (requestId === paymentRequest.current) setLoadingPayment(false);
    }
  };

  const handleProofChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setProofData('');
    setProofName('');
    setError('');

    if (!file) return;

    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      setError('El comprobante debe ser una imagen o PDF.');
      event.target.value = '';
      return;
    }

    if (file.size > 4 * 1024 * 1024) {
      setError('El comprobante no puede superar 4 MB.');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.addEventListener('load', () => {
      setProofData(String(reader.result || ''));
      setProofName(file.name);
    });
    reader.readAsDataURL(file);
  };

  const confirmBooking = async () => {
    if (!token || !selectedSlotId || !selectedServiceId) return;
    if (selectedSlot && !isFutureSlot(selectedSlot)) {
      setSelectedSlotId(null);
      setShowPayment(false);
      setError('Esta hora ya pasó. Selecciona otro horario disponible.');
      return;
    }

    if (requiresProof && !proofData) {
      setError('Debes subir el comprobante de transferencia antes de reservar.');
      return;
    }

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
        body: JSON.stringify({
          servicioId: selectedServiceId,
          comprobanteTransferencia: proofData || null,
          comprobanteNombre: proofName || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if ([404, 409].includes(response.status)) {
          invalidateSelection();
          throw new Error('El horario dejó de estar disponible. La agenda se ha actualizado; selecciona otra hora.');
        }
        throw new Error(data.message || 'No se pudo completar la reserva.');
      }

      setSlots((current) => current.filter((slot) => slot.id !== selectedSlotId));
      setSelectedSlotId(null);
      setShowPayment(false);
      setProofData('');
      setProofName('');
      setMessage('Hora reservada y confirmada correctamente.');
      setAvailabilityVersion(version => version + 1);
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
          <h1>Inicia sesión para reservar</h1>
          <p>Necesitas una cuenta de cliente para elegir barbero, servicio y horario.</p>
          <a href="/login?redirect=/booking">Iniciar sesión</a>
        </section>
      </main>
    );
  }

  return (
    <main className="booking-root">
      <header className="booking-header">
        <div>
          <h1>Reservar hora</h1>
          <p>Elige tu profesional, servicio y un horario disponible.</p>
        </div>
        <div className="booking-steps" aria-label="Pasos de la reserva">
          <span className={selectedBarber ? 'is-complete' : 'is-current'}>1 Barbero</span>
          <span className={selectedService ? 'is-complete' : selectedBarber ? 'is-current' : ''}>2 Servicio</span>
          <span className={selectedSlot ? 'is-complete' : selectedService ? 'is-current' : ''}>3 Horario</span>
        </div>
      </header>

      <section className="booking-panel">
        <div className="booking-section-title">
          <span>01</span>
          <div>
            <h2>{requestedBarberId ? 'Barbero seleccionado' : 'Selecciona un barbero'}</h2>
            <p>{requestedBarberId ? 'Perfil elegido desde la página de barberos.' : 'Profesionales con lugar de trabajo registrado.'}</p>
          </div>
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
                <span
                  className={`booking-avatar${safePhotoUrl(barber.foto_perfil) ? ' has-photo' : ''}`}
                  style={{ backgroundImage: photoBackground(barber.foto_perfil) }}
                >
                  {!safePhotoUrl(barber.foto_perfil) && initials(barber.usuario.nombre)}
                </span>
                <strong>{barber.usuario.nombre}</strong>
                <small>{barber.lugarTrabajo?.nombre_barberia || 'Barbería'}</small>
                <em>{barber.lugarTrabajo?.direccion || 'Dirección no informada'}</em>
              </button>
            ))}
          </div>
        )}
      </section>

      {selectedBarber && (
        <section className="booking-panel" ref={servicesPanelRef} id="servicios">
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
                    setShowPayment(false);
                    setProofData('');
                    setProofName('');
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
        <section className="booking-panel" ref={schedulePanelRef} id="horarios">
          <div className="booking-section-title">
            <span>03</span>
            <div><h2>Selecciona fecha y hora</h2><p>Consulta la agenda semanal y elige una hora disponible para tu servicio.</p></div>
          </div>

          <BookingCalendar
            now={now}
            weekStart={weekStart} selectedDate={selectedDate} selectedSlotId={selectedSlotId}
            data={calendar} loading={loadingSlots} error={calendarError} disabled={booking || loadingPayment}
            onDateChange={changeDate} onWeekChange={changeWeek} onSelect={selectCalendarSlot}
            onRefresh={() => setAvailabilityVersion(version => version + 1)}
          />

          {selectedSlot && (
            <div className="booking-summary" ref={summaryRef} id="resumen-reserva">
              <div>
                <span>Resumen</span>
                <strong>{selectedBarber.usuario.nombre} · {selectedService.nombre_servicio}</strong>
                <p>{formatInstant(selectedSlot.fecha_hora, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}</p>
                {!requiresProof && <small className="booking-payment-note">Este profesional permite reservar sin comprobante de pago.</small>}
              </div>
              <button type="button" disabled={booking || loadingPayment || loadingSlots} onClick={() => void openPaymentStep()}>
                {booking ? 'Reservando...' : loadingPayment ? 'Consultando datos de pago...' : requiresProof ? 'Continuar al pago' : 'Reservar ahora'}
              </button>
            </div>
          )}

          {selectedSlot && showPayment && requiresProof && hasBankingData && paymentDetails && (
            <div className="booking-payment" ref={paymentPanelRef}>
              <div className="booking-section-title">
                <span>04</span>
                <div>
                  <h2>Transferencia y comprobante</h2>
                  <p>Transfiere al barbero y sube el comprobante para confirmar tu reserva.</p>
                </div>
              </div>

              {hasBankingData ? (
                <div className="booking-bank-grid">
                  <div>
                    <span>Nombre</span>
                    <strong>{paymentDetails.bancoNombre}</strong>
                  </div>
                  <div>
                    <span>RUT</span>
                    <strong>{paymentDetails.bancoRut}</strong>
                  </div>
                  <div>
                    <span>Banco</span>
                    <strong>{paymentDetails.bancoNombreBanco}</strong>
                  </div>
                  <div>
                    <span>Tipo de cuenta</span>
                    <strong>{paymentDetails.bancoTipoCuenta}</strong>
                  </div>
                  <div>
                    <span>N.º de cuenta</span>
                    <strong>{paymentDetails.bancoNroCuenta}</strong>
                  </div>
                  <div>
                    <span>Correo</span>
                    <strong>{paymentDetails.bancoCorreo}</strong>
                  </div>
                </div>
              ) : (
                <p className="booking-empty">Este barbero aun no tiene datos bancarios registrados.</p>
              )}

              <label className="booking-proof-field">
                Comprobante de transferencia
                <input
                  type="file"
                  required
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  onChange={handleProofChange}
                />
                <small>Formatos permitidos: PNG, JPG, WEBP o PDF. Maximo 4 MB.</small>
              </label>

              {proofName && <p className="booking-proof-name">Comprobante cargado: {proofName}</p>}

              <div className="booking-payment-actions">
                <button type="button" onClick={() => setShowPayment(false)} disabled={booking}>
                  Volver
                </button>
                <button type="button" disabled={booking || !proofData || !hasBankingData} onClick={confirmBooking}>
                  {booking ? 'Reservando...' : 'Reservar con comprobante'}
                </button>
              </div>
            </div>
          )}

          {message && (
            <p className="booking-alert booking-alert-bottom is-success" role="status" ref={successMessageRef}>
              {message}
            </p>
          )}
        </section>
      )}

      {error && (
        <p className="booking-alert booking-alert-bottom is-error" role="alert" ref={errorMessageRef}>
          {error}
        </p>
      )}
    </main>
  );
}
