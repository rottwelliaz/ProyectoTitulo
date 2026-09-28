import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, addWeeks, format, isSameDay, startOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';
import CalendarSlot, { SLOT_LABELS, type SlotStatus } from './CalendarSlot';
import EditSlotModal from './EditSlotModal';

interface SelectedSlot {
  date: Date;
  slotTime: number;
  key: string;
  status: SlotStatus;
}

interface CopiedWeek {
  label: string;
  slots: Record<string, SlotStatus>;
}

interface CalendarSettings {
  startTime: string;
  endTime: string;
  blockMinutes: number;
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

const API_URL = 'http://localhost:3001/api';
const SLOT_STORAGE_PREFIX = 'barber-calendar-slots';
const SETTINGS_STORAGE_PREFIX = 'barber-calendar-settings';
const DEFAULT_SETTINGS: CalendarSettings = {
  startTime: '09:00',
  endTime: '19:00',
  blockMinutes: 60,
};
const BLOCK_OPTIONS = [10, 15, 20, 30, 45, 60];
const TIME_OPTIONS = Array.from({ length: 33 }, (_, index) => {
  const minutes = 6 * 60 + index * 30;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
});

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

const getStoredUserId = () => {
  try {
    const storedUser = window.localStorage.getItem('user');
    const user = storedUser ? JSON.parse(storedUser) : null;
    return user?.id ? String(user.id) : 'sin-usuario';
  } catch {
    return 'sin-usuario';
  }
};

const getStorageKey = (prefix: string) => `${prefix}-${getStoredUserId()}`;

const parseTime = (value: string) => {
  const [hour = '0', minute = '0'] = value.split(':');
  return Number(hour) * 60 + Number(minute);
};

const formatSlotTime = (slotTime: number) => {
  const hour = Math.floor(slotTime / 60);
  const minute = slotTime % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const buildSlotTimes = (settings: CalendarSettings) => {
  const start = parseTime(settings.startTime);
  const end = parseTime(settings.endTime);
  if (end < start) return [];

  const times: number[] = [];
  for (let value = start; value <= end; value += settings.blockMinutes) {
    times.push(value);
  }
  return times;
};

const buildSlotDate = (date: Date, slotTime: number) => {
  const blockDate = new Date(date);
  blockDate.setHours(Math.floor(slotTime / 60), slotTime % 60, 0, 0);
  return blockDate;
};

const getDefaultStatus = () => 'available' as SlotStatus;
const isPastSlot = (date: Date, slotTime: number) => buildSlotDate(date, slotTime).getTime() <= Date.now();

export default function BarberCalendar() {
  const today = useMemo(() => new Date(), []);
  const currentWeek = useMemo(() => startOfWeek(today, { weekStartsOn: 1 }), [today]);
  const [weekStart, setWeekStart] = useState(currentWeek);
  const [settings, setSettings] = useState<CalendarSettings>(DEFAULT_SETTINGS);
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
  const slotTimes = useMemo(() => buildSlotTimes(settings), [settings]);

  const getSlotKey = useCallback((date: Date, slotTime: number) => `${format(date, 'yyyy-MM-dd')}-${formatSlotTime(slotTime)}`, []);
  const getSlotKeyFromDate = useCallback((date: Date) => getSlotKey(date, date.getHours() * 60 + date.getMinutes()), [getSlotKey]);

  useEffect(() => {
    const slotsKey = getStorageKey(SLOT_STORAGE_PREFIX);
    const settingsKey = getStorageKey(SETTINGS_STORAGE_PREFIX);

    try {
      const savedSlots = window.localStorage.getItem(slotsKey);
      const savedSettings = window.localStorage.getItem(settingsKey);

      if (savedSlots) setSlots(JSON.parse(savedSlots) as StoredSlots);
      if (savedSettings) {
        const parsedSettings = JSON.parse(savedSettings) as CalendarSettings;
        setSettings({
          startTime: parsedSettings.startTime || DEFAULT_SETTINGS.startTime,
          endTime: parsedSettings.endTime || DEFAULT_SETTINGS.endTime,
          blockMinutes: Number(parsedSettings.blockMinutes) || DEFAULT_SETTINGS.blockMinutes,
        });
      }
    } catch {
      window.localStorage.removeItem(slotsKey);
      window.localStorage.removeItem(settingsKey);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(getStorageKey(SLOT_STORAGE_PREFIX), JSON.stringify(slots));
  }, [hydrated, slots]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(getStorageKey(SETTINGS_STORAGE_PREFIX), JSON.stringify(settings));
  }, [hydrated, settings]);

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
          nextReservedSlots[getSlotKeyFromDate(date)] = slot;
        });

      setReservedSlots(nextReservedSlots);
    } catch (error) {
      setCopyFeedback(error instanceof Error ? error.message : 'No se pudieron cargar las reservas.');
      setReservedSlots({});
    } finally {
      setLoadingReservations(false);
    }
  }, [getSlotKeyFromDate, weekStart]);

  useEffect(() => {
    void loadReservations();
  }, [loadReservations]);

  const openSlot = (date: Date, slotTime: number) => {
    const key = getSlotKey(date, slotTime);
    const reservedSlot = reservedSlots[key];
    const timeLabel = formatSlotTime(slotTime);

    if (isPastSlot(date, slotTime)) {
      setCopyFeedback('No puedes editar bloques de horas pasadas.');
      return;
    }

    if (reservedSlot) {
      const client = reservedSlot.cliente?.nombre || 'Cliente';
      const service = reservedSlot.servicio?.nombre_servicio || 'Servicio';
      setCopyFeedback(`La hora ${timeLabel} ya está reservada por ${client} (${service}).`);
      return;
    }

    setSelectedSlot({ date, slotTime, key, status: slots[key] ?? getDefaultStatus() });
  };

  const closeModal = useCallback(() => setSelectedSlot(null), []);

  const syncWeekAvailability = async (weekSlots: StoredSlots, days = weekDays, times = slotTimes) => {
    const token = window.localStorage.getItem('token');
    if (!token) {
      setCopyFeedback('Inicia sesión para guardar la agenda en el sistema.');
      return;
    }

    if (times.length === 0) {
      setCopyFeedback('La hora de cierre no puede ser anterior a la hora de entrada.');
      return;
    }

    const availableBlocks: string[] = [];
    days.forEach((date) => {
      times.forEach((slotTime) => {
        const key = getSlotKey(date, slotTime);
        if ((weekSlots[key] ?? getDefaultStatus()) === 'available') {
          const blockDate = buildSlotDate(date, slotTime);
          if (blockDate.getTime() > Date.now()) {
            availableBlocks.push(blockDate.toISOString());
          }
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

  const updateSettings = (nextSettings: CalendarSettings) => {
    setSettings(nextSettings);
    setCopiedWeek(null);
    setCopyFeedback('Configuración actualizada. Revisa los bloques y guarda la agenda.');
  };

  const goToCurrentWeek = (markToday: boolean) => {
    setWeekStart(currentWeek);
    setHighlightToday(markToday);
  };

  const copyCurrentWeek = () => {
    const copiedSlots: Record<string, SlotStatus> = {};

    weekDays.forEach((date, dayIndex) => {
      slotTimes.forEach((slotTime) => {
        const slotKey = getSlotKey(date, slotTime);
        copiedSlots[`${dayIndex}-${formatSlotTime(slotTime)}`] = slots[slotKey] ?? getDefaultStatus();
      });
    });

    const label = `${format(weekStart, 'd MMM', { locale: es })} - ${format(weekDays[6], 'd MMM', { locale: es })}`;
    setCopiedWeek({ label, slots: copiedSlots });
    setCopyFeedback(`Semana ${label} copiada. Navega a otra semana y presiona "Pegar aquí".`);
  };

  const pasteCopiedWeek = () => {
    if (!copiedWeek) return;

    const targetLabel = `${format(weekStart, 'd MMM', { locale: es })} - ${format(weekDays[6], 'd MMM', { locale: es })}`;
    const confirmed = window.confirm(
      `¿Copiar la agenda de ${copiedWeek.label} sobre la semana ${targetLabel}? Se reemplazarán sus bloques.`,
    );
    if (!confirmed) return;

    const updatedSlots = { ...slots };
    weekDays.forEach((date, dayIndex) => {
      slotTimes.forEach((slotTime) => {
        updatedSlots[getSlotKey(date, slotTime)] = copiedWeek.slots[`${dayIndex}-${formatSlotTime(slotTime)}`] ?? getDefaultStatus();
      });
    });
    setSlots(updatedSlots);
    setCopyFeedback(`Agenda pegada en la semana ${targetLabel}.`);
    void syncWeekAvailability(updatedSlots);
  };

  const weekEnd = weekDays[6];

  return (
    <article id="agenda-profesional" className="pro-panel pro-agenda barber-calendar">
      <div className="calendar-toolbar">
        <div>
          <h2>Mi agenda semanal</h2>
          <p>
            {capitalize(format(weekStart, "d 'de' MMMM", { locale: es }))} –{' '}
            {format(weekEnd, "d 'de' MMMM 'de' yyyy", { locale: es })}
          </p>
          <small className="calendar-toolbar-hint">
            Organiza tu semana y revisa aquí mismo las reservas confirmadas.
          </small>
        </div>

        <div className="calendar-actions" aria-label="Navegación de la agenda">
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
            Pegar aquí
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

      <section className="calendar-settings" aria-label="Configuración de bloques de agenda">
        <label>
          Hora de entrada
          <select
            value={settings.startTime}
            onChange={(event) => updateSettings({ ...settings, startTime: event.target.value })}
          >
            {TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}
          </select>
        </label>
        <label>
          Hora de cierre
          <select
            value={settings.endTime}
            onChange={(event) => updateSettings({ ...settings, endTime: event.target.value })}
          >
            {TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}
          </select>
        </label>
        <label>
          Duración de cada bloque
          <select
            value={settings.blockMinutes}
            onChange={(event) => updateSettings({ ...settings, blockMinutes: Number(event.target.value) })}
          >
            {BLOCK_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}
          </select>
        </label>
      </section>

      {copyFeedback && <p className="calendar-copy-feedback" role="status">{copyFeedback}</p>}
      {loadingReservations && <p className="calendar-copy-feedback is-loading" role="status">Actualizando reservas...</p>}

      <div className="calendar-scroll">
        <div className="calendar-grid">
          <div className="calendar-time-column">
            <span className="calendar-corner">Hora</span>
            {slotTimes.map((slotTime) => (
              <time key={slotTime}>{formatSlotTime(slotTime)}</time>
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
                {slotTimes.map((slotTime) => {
                  const key = getSlotKey(date, slotTime);
                  const reservedSlot = reservedSlots[key];
                  const pastSlot = isPastSlot(date, slotTime);
                  const detail = reservedSlot
                    ? `${reservedSlot.cliente?.nombre || 'Cliente'} · ${reservedSlot.servicio?.nombre_servicio || 'Servicio'}`
                    : undefined;
                  return (
                    <CalendarSlot
                      key={key}
                      dateLabel={dateLabel}
                      timeLabel={formatSlotTime(slotTime)}
                      status={reservedSlot ? 'reserved' : slots[key] ?? getDefaultStatus()}
                      disabled={Boolean(reservedSlot) || pastSlot}
                      detail={detail}
                      onClick={() => openSlot(date, slotTime)}
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
          hourLabel={formatSlotTime(selectedSlot.slotTime)}
          status={selectedSlot.status}
          onClose={closeModal}
          onChange={updateSlot}
        />
      )}
    </article>
  );
}
