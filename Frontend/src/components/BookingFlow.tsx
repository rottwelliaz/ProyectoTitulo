import { authFetch as fetch, API_URL } from '../lib/session';
import { notifySuccess, notifyWarning } from '../lib/notifications';
import { formatPrice as money } from '../lib/formatPrice';
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { businessDate, formatInstant, startOfWeek } from '../lib/businessTime';
import { safePhotoUrl, photoBackground } from '../lib/profilePhoto';
import BookingCalendar, { type BookingCalendarCell, type BookingCalendarData } from './calendar/BookingCalendar';

interface Service {
  id: string;
  nombre_servicio: string;
  descripcion: string | null;
  precio: number;
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
  slotId?: string;
  fecha_hora: string;
  disponibleHasta: string;
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

const isFutureSlot = (slot: AppointmentSlot) => +new Date(slot.fecha_hora) > Date.now() && +new Date(slot.disponibleHasta) > +new Date(slot.fecha_hora);
const missingBankingMessage = 'El profesional aún no ha completado sus datos para recibir transferencias';
const transferWarning = 'Este profesional requiere pago por transferencia, pero todavía no ha configurado sus datos bancarios. Por el momento, no es posible completar una reserva con esta modalidad.';

export default function BookingFlow() {
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
  const selectedIntervalRef = useRef<AppointmentSlot | null>(null);
  const [loadingBarbers, setLoadingBarbers] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [booking, setBooking] = useState(false);
  const bookingRequest = useRef(false);
  const [paymentDetails, setPaymentDetails] = useState<PaymentDetails | null>(null);
  const [loadingPayment, setLoadingPayment] = useState(false);
  const paymentRequest = useRef(0);
  const [missingBankingBarber, setMissingBankingBarber] = useState<number | null>(null);
  const warnedBarbers = useRef(new Set<number>());
  const proofRequest = useRef(0);
  const [paymentVersion, setPaymentVersion] = useState(0);
  const [proofData, setProofData] = useState('');
  const [proofName, setProofName] = useState('');
  const [error, setError] = useState('');
  const requestedBarberId = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return Number(new URLSearchParams(window.location.search).get('barbero')) || null;
  }, []);

  const selectedBarber = barbers.find((barber) => barber.id === selectedBarberId) ?? null;
  const selectedService = selectedBarber?.servicios.find((service) => service.id === selectedServiceId) ?? null;
  const selectedSlot = slots.find((slot) => slot.id === selectedSlotId) ?? null;
  const requiresProof = selectedBarber?.requiereComprobante ?? true;
  const transfersUnavailable = requiresProof && missingBankingBarber === selectedBarberId && selectedBarberId !== null;
  const hasBankingData = paymentDetails?.citaId === (selectedSlot?.slotId || selectedSlotId) &&
    paymentDetails?.servicioId === selectedServiceId && paymentDetails?.barberoId === selectedBarberId;
  const canConfirm = Boolean(token && selectedBarber && selectedService && selectedSlot && isFutureSlot(selectedSlot) &&
    !booking && !loadingSlots && !loadingPayment && !transfersUnavailable && (!requiresProof || (hasBankingData && proofData)));

  useEffect(() => { selectionRef.current = selectedSlotId; }, [selectedSlotId]);
  useEffect(() => { selectedIntervalRef.current = selectedSlot; }, [selectedSlot]);

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
    if (!token || !selectedBarberId) {
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
          vista: 'semana',
        });
        const response = await fetch(
          `${API_URL}/citas/disponibilidad/${selectedBarberId}?${params}`,
          { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal },
        );
        const data = await response.json().catch(() => ({})) as AvailabilityResponse;
        if (!response.ok) throw new Error(data.message || 'No se pudo cargar la disponibilidad.');
        if (!Array.isArray(data.citas) || !Array.isArray(data.calendario?.horarios) || !Array.isArray(data.calendario?.horas)) throw new Error('No se pudo cargar el calendario. Vuelve a consultar la agenda.');
        if (data.citas.some(slot => !Number.isFinite(+new Date(slot.disponibleHasta)) || +new Date(slot.disponibleHasta) <= +new Date(slot.fecha_hora))) throw new Error('La agenda no contiene intervalos completos. Actualiza los horarios.');
        if (active) {
          const nextSlots = data.citas.filter(isFutureSlot);
          setSlots(nextSlots);
          setCalendar(data.calendario);
          if (selectionRef.current && !nextSlots.some(slot => slot.id === selectionRef.current &&
            (!selectedIntervalRef.current || (slot.fecha_hora === selectedIntervalRef.current.fecha_hora && slot.disponibleHasta === selectedIntervalRef.current.disponibleHasta)))) {
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
  }, [selectedBarberId, weekStart, token, availabilityVersion]);

  const chooseBarber = (barber: Barber) => {
    if (barber.id === selectedBarberId || bookingRequest.current) return;
    selectionRef.current = null;
    selectedIntervalRef.current = null;
    setSlots([]);
    setCalendar(null);
    setSelectedBarberId(barber.id);
    setSelectedServiceId(null);
    setSelectedSlotId(null);
    setProofData('');
    setProofName('');
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
    if (week !== weekStart) {
      setSlots([]);
      setCalendar(null);
    }
    setWeekStart(week);
    changeDate(week < today ? today : week);
  };

  const invalidateSelection = () => {
    setSelectedSlotId(null);
    setProofData('');
    setProofName('');
    setAvailabilityVersion(version => version + 1);
  };

  const selectCalendarSlot = (cell: BookingCalendarCell) => {
    if (cell.estado !== 'available' || !cell.citaId || !cell.fecha_hora || new Date(cell.fecha_hora).getTime() <= Date.now()) return;
    setSelectedDate(cell.fecha);
    setSelectedSlotId(cell.citaId);
    setProofData('');
    setProofName('');
    setError('');
  };

  // Payment stays inline and is fetched only for a complete, current selection.
  useEffect(() => {
    const requestId = ++paymentRequest.current;
    proofRequest.current++;
    setPaymentDetails(null);
    setLoadingPayment(false);
    setProofData('');
    setProofName('');
    if (!requiresProof || !token || !selectedBarber || !selectedService || !selectedSlot || !isFutureSlot(selectedSlot)) return;
    const controller = new AbortController();
    setLoadingPayment(true);
    setError('');
    const loadPayment = async () => {
      try {
        const response = await fetch(`${API_URL}/citas/${selectedSlot?.slotId || selectedSlotId}/pago`, {
          method: 'POST', cache: 'no-store', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ servicioId: selectedServiceId, fecha_hora: selectedSlot.fecha_hora, fin_hora: selectedSlot.disponibleHasta }),
        });
        const data = await response.json().catch(() => ({}));
        if (requestId !== paymentRequest.current) return;
        if (!response.ok) {
          if (response.status === 409 && data.message === missingBankingMessage) {
            setMissingBankingBarber(selectedBarberId);
            if (!warnedBarbers.current.has(selectedBarberId!)) {
              warnedBarbers.current.add(selectedBarberId!);
              void notifyWarning(transferWarning, 'Transferencias no disponibles', true);
            }
            return;
          }
          if ([404, 409].includes(response.status)) invalidateSelection();
          throw new Error(data.message || 'No se pudieron cargar los datos de pago.');
        }
        if (data.citaId !== (selectedSlot?.slotId || selectedSlotId) || data.servicioId !== selectedServiceId || data.barberoId !== selectedBarberId) {
          throw new Error('Los datos de pago no corresponden a la selección actual.');
        }
        setMissingBankingBarber(null);
        setPaymentDetails(data);
      } catch (requestError) {
        if (requestId === paymentRequest.current) setError(requestError instanceof Error ? requestError.message : 'No se pudieron cargar los datos de pago.');
      } finally {
        if (requestId === paymentRequest.current) setLoadingPayment(false);
      }
    };
    void loadPayment();
    return () => { paymentRequest.current++; controller.abort(); };
  }, [token, selectedBarberId, selectedServiceId, selectedSlotId, selectedSlot?.fecha_hora, selectedSlot?.disponibleHasta, requiresProof, paymentVersion]);

  const handleProofChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const requestId = ++proofRequest.current;
    const paymentId = paymentRequest.current;
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
      if (requestId !== proofRequest.current || paymentId !== paymentRequest.current) return;
      setProofData(String(reader.result || ''));
      setProofName(file.name);
    });
    reader.readAsDataURL(file);
  };

  const confirmBooking = async () => {
    if (transfersUnavailable) {
      void notifyWarning(transferWarning, 'Transferencias no disponibles', true);
      return;
    }
    if (bookingRequest.current || !canConfirm || !token || !selectedBarber || !selectedService || !selectedSlotId || !selectedSlot) return;
    if (selectedSlot && !isFutureSlot(selectedSlot)) {
      setSelectedSlotId(null);
      setError('Esta hora ya pasó. Selecciona otro horario disponible.');
      return;
    }

    if (requiresProof && !proofData) {
      setError('Debes subir el comprobante de transferencia antes de reservar.');
      return;
    }

    bookingRequest.current = true;
    setBooking(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/citas/${selectedSlot?.slotId || selectedSlotId}/agendar`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          servicioId: selectedServiceId,
          fecha_hora: selectedSlot.fecha_hora,
          fin_hora: selectedSlot.disponibleHasta,
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
      setProofData('');
      setProofName('');
      void notifySuccess('Hora reservada y confirmada correctamente.');
      setAvailabilityVersion(version => version + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo completar la reserva.');
    } finally {
      bookingRequest.current = false;
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
          <p>Elige servicio y horario en cualquier orden y confirma tu reserva.</p>
        </div>
      </header>

      <div className="booking-options">
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
            <div className={`booking-barbers${requestedBarberId && selectedBarber ? ' booking-barbers-compact' : ''}`}>
              {barbers.map((barber) => (
                <button
                  key={barber.id}
                  type="button"
                  className={`booking-barber-card${selectedBarberId === barber.id ? ' is-selected' : ''}`}
                  aria-pressed={selectedBarberId === barber.id}
                  disabled={booking}
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

        <section className="booking-panel" id="servicios">
          <div className="booking-section-title">
            <span>02</span>
            <div><h2>Selecciona un servicio</h2><p>{selectedBarber ? `Servicios ofrecidos por ${selectedBarber.usuario.nombre}.` : 'Elige un profesional para consultar sus servicios.'}</p></div>
          </div>

          {!selectedBarber ? (
            <p className="booking-empty">{loadingBarbers ? 'Cargando servicios...' : 'Selecciona un barbero para ver sus servicios.'}</p>
          ) : selectedBarber.servicios.length === 0 ? (
            <p className="booking-empty">Este barbero aun no tiene servicios registrados.</p>
          ) : (
            <div className="booking-services">
              {selectedBarber.servicios.map((service) => (
                <button
                  key={service.id}
                  type="button"
                  className={`booking-service-card${selectedServiceId === service.id ? ' is-selected' : ''}`}
                  aria-pressed={selectedServiceId === service.id}
                  disabled={booking}
                  onClick={() => {
                    if (selectedServiceId === service.id) return;
                    setSelectedServiceId(service.id);
                    setProofData('');
                    setProofName('');
                    setError('');
                  }}
                >
                  <span><strong>{service.nombre_servicio}</strong><small>{service.descripcion || 'Servicio profesional'}</small></span>
                  <span><b>{money(service.precio)}</b></span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="booking-panel" id="horarios">
        <div className="booking-section-title">
          <span>03</span>
          <div><h2>Selecciona fecha y hora</h2><p>{selectedBarber ? `Agenda de ${selectedBarber.usuario.nombre}. Puedes elegir tu horario antes del servicio.` : 'Selecciona un barbero para consultar su agenda semanal.'}</p></div>
        </div>

        <BookingCalendar
          now={now}
          weekStart={weekStart} selectedDate={selectedDate} selectedSlotId={selectedSlotId}
          data={calendar} loading={loadingSlots} error={calendarError} disabled={booking || !selectedBarber}
          onDateChange={changeDate} onWeekChange={changeWeek} onSelect={selectCalendarSlot}
          onRefresh={() => setAvailabilityVersion(version => version + 1)}
        />
      </section>

      <section className="booking-panel" id="confirmacion">
        <div className="booking-section-title">
          <span>04</span>
          <div><h2>Confirma tu reserva</h2><p>Revisa el servicio y el bloque seleccionado.</p></div>
        </div>
        <div className="booking-summary" id="resumen-reserva" aria-live="polite">
          <div className="booking-summary-details">
            <span>Resumen</span>
            <strong>{selectedBarber?.usuario.nombre || 'Barbero pendiente'} · {selectedService?.nombre_servicio || 'Servicio pendiente'}</strong>
            <p>{selectedService ? money(selectedService.precio) : 'Precio: selecciona un servicio.'}</p>
            <p>{selectedSlot ? `${formatInstant(selectedSlot.fecha_hora, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}–${formatInstant(selectedSlot.disponibleHasta, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}` : 'Fecha y horario pendientes.'}</p>
            {selectedBarber && !requiresProof && <small className="booking-payment-note">Este profesional permite reservar sin comprobante de pago.</small>}
            {transfersUnavailable && <p className="booking-alert is-error" role="alert">Transferencias no disponibles: el profesional aún no ha configurado sus datos bancarios. No es posible confirmar la reserva.</p>}
          </div>
        </div>

        {selectedSlot && requiresProof && hasBankingData && paymentDetails && (
          <div className="booking-payment">
            <div className="booking-section-title">
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
                disabled={booking}
                key={`${selectedBarberId}-${selectedServiceId}-${selectedSlotId}-${paymentVersion}`}
                accept="image/png,image/jpeg,image/webp,application/pdf"
                onChange={handleProofChange}
              />
              <small>Formatos permitidos: PNG, JPG, WEBP o PDF. Maximo 4 MB.</small>
            </label>

            {proofName && <p className="booking-proof-name">Comprobante cargado: {proofName}</p>}

          </div>
        )}

        <div className="booking-confirmation-actions">
          <p id="booking-confirmation-status">
            {!selectedBarber || !selectedService || !selectedSlot ? 'Selecciona un barbero, un servicio y un horario disponible para confirmar.'
              : transfersUnavailable ? 'No es posible confirmar: faltan los datos bancarios del profesional.'
              : loadingPayment ? 'Consultando datos de pago...'
              : requiresProof && !hasBankingData ? 'Se necesitan los datos de pago para adjuntar tu comprobante.'
              : requiresProof && !proofData ? 'Adjunta el comprobante para confirmar tu reserva.'
              : 'Todo listo para confirmar tu reserva.'}
          </p>
          {requiresProof && selectedService && selectedSlot && !hasBankingData && !loadingPayment && (
            <button type="button" disabled={booking} onClick={() => setPaymentVersion(version => version + 1)}>Reintentar datos de pago</button>
          )}
          <button type="button" disabled={!canConfirm} aria-describedby="booking-confirmation-status" onClick={() => void confirmBooking()}>
            {booking ? 'Reservando...' : 'Confirmar reserva'}
          </button>
        </div>
      </section>

      {error && (
        <p className="booking-alert booking-alert-bottom is-error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
