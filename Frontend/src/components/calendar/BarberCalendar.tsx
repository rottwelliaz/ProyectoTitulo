import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, addWeeks, format, isSameDay, startOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';
import CalendarSlot, { SLOT_LABELS, type SlotStatus } from './CalendarSlot';
import EditSlotModal from './EditSlotModal';

interface SelectedSlot {
  date: Date;
  hour: number;
  key: string;
  status: SlotStatus;
}

interface CopiedWeek {
  label: string;
  slots: Record<string, SlotStatus>;
}

interface AppointmentSlot {
  id: string;
  fecha_hora: string;
  estado: 'confirmada' | 'cancelada' | 'finalizada' | 'pendiente' | 'disponible';
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

type StoredSlots = Record<string, SlotStatus>;
type ReservedSlots = Record<string, AppointmentSlot>;

const HOURS = Array.from({ length: 11 }, (_, index) => index + 9);
const STORAGE_KEY = 'barber-calendar-slots';
const API_URL = 'http://localhost:3001/api';

const getDefaultStatus = (hour: number): SlotStatus => {
  if (hour === 10) return 'booking';
  if (hour === 13) return 'break';
  if (hour === 15) return 'reserved';
  return 'available';
};

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export default function BarberCalendar() {
  const today = useMemo(() => new Date(), []);
  const currentWeek = useMemo(() => startOfWeek(today, { weekStartsOn: 1 }), [today]);
  const [weekStart, setWeekStart] = useState(currentWeek);
  const [slots, setSlots] = useState<StoredSlots>({});
  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot | null>(null);
  const [highlightToday, setHighlightToday] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [copiedWeek, setCopiedWeek] = useState<CopiedWeek | null>(null);
  const [copyFeedback, setCopyFeedback] = useState('');
  const [savingWeek, setSavingWeek] = useState(false);
  const [reservedSlots, setReservedSlots] = useState<ReservedSlots>({});
  const [loadingReservations, setLoadingReservations] = useState(false);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );

  useEffect(() => {
    try {
      const savedSlots = window.localStorage.getItem(STORAGE_KEY);
      if (savedSlots) setSlots(JSON.parse(savedSlots) as StoredSlots);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
  }, [hydrated, slots]);

  const getSlotKey = (date: Date, hour: number) => `${format(date, 'yyyy-MM-dd')}-${hour}`;

  const loadReservations = useCallback(async () => {
    const token = window.localStorage.getItem('token');
    if (!token) return;

    setLoadingReservations(true);
    try {
      const response = await fetch(`${API_URL}/citas/mias`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(data.message || 'No se pudieron cargar las reservas.');

      const weekEndLimit = addDays(weekStart, 7);
      const nextReservedSlots: ReservedSlots = {};

      (Array.isArray(data) ? data as AppointmentSlot[] : [])
        .filter((slot) => {
          const date = new Date(slot.fecha_hora);
          return slot.estado === 'confirmada' && date >= weekStart && date < weekEndLimit;
        })
        .forEach((slot) => {
          const date = new Date(slot.fecha_hora);
          nextReservedSlots[getSlotKey(date, date.getHours())] = slot;
        });

      setReservedSlots(nextReservedSlots);
    } catch (error) {
      setCopyFeedback(error instanceof Error ? error.message : 'No se pudieron cargar las reservas.');
      setReservedSlots({});
    } finally {
      setLoadingReservations(false);
    }
  }, [weekStart]);

  useEffect(() => {
    void loadReservations();
  }, [loadReservations]);

  const openSlot = (date: Date, hour: number) => {
    const key = getSlotKey(date, hour);
    const reservedSlot = reservedSlots[key];
    if (reservedSlot) {
      const client = reservedSlot.cliente?.nombre || 'Cliente';
      const service = reservedSlot.servicio?.nombre_servicio || 'Servicio';
      setCopyFeedback(`La hora ${String(hour).padStart(2, '0')}:00 ya esta reservada por ${client} (${service}).`);
      return;
    }
    setSelectedSlot({ date, hour, key, status: slots[key] ?? getDefaultStatus(hour) });
  };

  const closeModal = useCallback(() => setSelectedSlot(null), []);

  const syncWeekAvailability = async (weekSlots: StoredSlots, days = weekDays) => {
    const token = window.localStorage.getItem('token');
    if (!token) {
      setCopyFeedback('Inicia sesion para guardar la agenda en el sistema.');
      return;
    }

    const availableBlocks: string[] = [];
    days.forEach((date) => {
      HOURS.forEach((hour) => {
        const key = getSlotKey(date, hour);
        if ((weekSlots[key] ?? getDefaultStatus(hour)) === 'available') {
          const blockDate = new Date(date);
          blockDate.setHours(hour, 0, 0, 0);
          availableBlocks.push(blockDate.toISOString());
        }
      });
    });

    setSavingWeek(true);
    try {
      const response = await fetch(`${API_URL}/citas/disponibilidad/semana`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fechaInicio: format(days[0], 'yyyy-MM-dd'),
          bloques: availableBlocks,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'No se pudo guardar la agenda.');

      const omitted = Number(data.omittedOccupiedBlocks || 0);
      setCopyFeedback(
        omitted
          ? `Agenda guardada. ${omitted} bloque(s) ocupado(s) se conservaron sin cambios.`
          : 'Agenda guardada y disponible para las reservas de clientes.',
      );
      await loadReservations();
    } catch (error) {
      setCopyFeedback(error instanceof Error ? error.message : 'No se pudo guardar la agenda.');
    } finally {
      setSavingWeek(false);
    }
  };

  const updateSlot = (status: SlotStatus) => {
    if (!selectedSlot) return;
    const updatedSlots = { ...slots, [selectedSlot.key]: status };
    setSlots(updatedSlots);
    closeModal();
    void syncWeekAvailability(updatedSlots);
  };

  const goToCurrentWeek = (markToday: boolean) => {
    setWeekStart(currentWeek);
    setHighlightToday(markToday);
  };

  const copyCurrentWeek = () => {
    const copiedSlots: Record<string, SlotStatus> = {};

    weekDays.forEach((date, dayIndex) => {
      HOURS.forEach((hour) => {
        const slotKey = getSlotKey(date, hour);
        copiedSlots[`${dayIndex}-${hour}`] = slots[slotKey] ?? getDefaultStatus(hour);
      });
    });

    const label = `${format(weekStart, 'd MMM', { locale: es })} - ${format(weekDays[6], 'd MMM', { locale: es })}`;
    setCopiedWeek({ label, slots: copiedSlots });
    setCopyFeedback(`Semana ${label} copiada. Navega a otra semana y presiona "Pegar aqui".`);
  };

  const pasteCopiedWeek = () => {
    if (!copiedWeek) return;

    const targetLabel = `${format(weekStart, 'd MMM', { locale: es })} - ${format(weekDays[6], 'd MMM', { locale: es })}`;
    const confirmed = window.confirm(
      `¿Copiar la agenda de ${copiedWeek.label} sobre la semana ${targetLabel}? Se reemplazaran sus bloques.`,
    );
    if (!confirmed) return;

    const updatedSlots = { ...slots };
    weekDays.forEach((date, dayIndex) => {
      HOURS.forEach((hour) => {
        updatedSlots[getSlotKey(date, hour)] = copiedWeek.slots[`${dayIndex}-${hour}`];
      });
    });
    setSlots(updatedSlots);
    setCopyFeedback(`Agenda pegada en la semana ${targetLabel}.`);
    void syncWeekAvailability(updatedSlots);
  };

  const weekEnd = weekDays[6];

  return (
    <article className="pro-panel pro-agenda barber-calendar">
      <div className="calendar-toolbar">
        <div>
          <h2>Mi agenda semanal</h2>
          <p>
            {capitalize(format(weekStart, "d 'de' MMMM", { locale: es }))} –{' '}
            {format(weekEnd, "d 'de' MMMM 'de' yyyy", { locale: es })}
          </p>
          <small className="calendar-toolbar-hint">
            Organiza tu semana y revisa aqui mismo las reservas confirmadas.
          </small>
        </div>

        <div className="calendar-actions" aria-label="Navegacion de la agenda">
          <button type="button" onClick={() => goToCurrentWeek(true)}>Hoy</button>
          <button type="button" onClick={() => goToCurrentWeek(false)}>Semana actual</button>
          <button
            type="button"
            aria-label="Semana anterior"
            onClick={() => {
              setWeekStart((week) => addWeeks(week, -1));
              setHighlightToday(false);
            }}
          >
            ← Anterior
          </button>
          <button
            type="button"
            aria-label="Semana siguiente"
            onClick={() => {
              setWeekStart((week) => addWeeks(week, 1));
              setHighlightToday(false);
            }}
          >
            Siguiente →
          </button>
          <button type="button" className="calendar-copy-button" onClick={copyCurrentWeek}>
            Copiar semana
          </button>
          <button
            type="button"
            className="calendar-paste-button"
            onClick={pasteCopiedWeek}
            disabled={!copiedWeek}
            title={copiedWeek ? `Copiar desde ${copiedWeek.label}` : 'Primero copia una semana'}
          >
            Pegar aqui
          </button>
          <button
            type="button"
            className="calendar-save-button"
            disabled={savingWeek}
            onClick={() => void syncWeekAvailability(slots)}
          >
            {savingWeek ? 'Guardando...' : 'Guardar agenda'}
          </button>
        </div>
      </div>

      {copyFeedback && <p className="calendar-copy-feedback" role="status">{copyFeedback}</p>}
      {loadingReservations && <p className="calendar-copy-feedback is-loading" role="status">Actualizando reservas...</p>}

      <div className="calendar-scroll">
        <div className="calendar-grid">
          <div className="calendar-time-column">
            <span className="calendar-corner">Hora</span>
            {HOURS.map((hour) => (
              <time key={hour}>{String(hour).padStart(2, '0')}:00</time>
            ))}
          </div>

          {weekDays.map((date) => {
            const dateLabel = capitalize(format(date, 'EEEE d', { locale: es }));
            const isToday = highlightToday && isSameDay(date, today);

            return (
              <div key={date.toISOString()} className={`calendar-day${isToday ? ' is-today' : ''}`}>
                <div className="calendar-day-header">
                  <strong>{capitalize(format(date, 'EEEE', { locale: es }))}</strong>
                  <span>{format(date, 'd')}</span>
                </div>
                {HOURS.map((hour) => {
                  const key = getSlotKey(date, hour);
                  const reservedSlot = reservedSlots[key];
                  const detail = reservedSlot
                    ? `${reservedSlot.cliente?.nombre || 'Cliente'} · ${reservedSlot.servicio?.nombre_servicio || 'Servicio'}`
                    : undefined;
                  return (
                    <CalendarSlot
                      key={key}
                      dateLabel={dateLabel}
                      hour={hour}
                      status={reservedSlot ? 'reserved' : slots[key] ?? getDefaultStatus(hour)}
                      disabled={Boolean(reservedSlot)}
                      detail={detail}
                      onClick={() => openSlot(date, hour)}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className="calendar-legend" aria-label="Estados de la agenda">
        {(Object.entries(SLOT_LABELS) as [SlotStatus, string][]).map(([status, label]) => (
          <span key={status}><i className={`is-${status}`} />{label}</span>
        ))}
      </div>

      {selectedSlot && (
        <EditSlotModal
          dateLabel={capitalize(format(selectedSlot.date, "EEEE d 'de' MMMM", { locale: es }))}
          hourLabel={`${String(selectedSlot.hour).padStart(2, '0')}:00`}
          status={selectedSlot.status}
          onClose={closeModal}
          onChange={updateSlot}
        />
      )}
    </article>
  );
}
