import { authFetch as fetch, API_URL } from '../../lib/session';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, addWeeks, businessDate, businessTime, dayStart, formatDay, slotInstant, startOfWeek } from '../../lib/businessTime';
import { professionalApi } from '../../lib/professionalApi';
import CalendarSlot, { SLOT_LABELS, type SlotStatus } from './CalendarSlot';
import EditSlotModal from './EditSlotModal';

interface SelectedSlot {
  date: string;
  slotTime: number;
  key: string;
  status: SlotStatus;
}

interface CopiedWeek {
  label: string;
  slots: Record<string, SlotStatus>;
  settings: CalendarSettings;
}

interface CalendarSettings {
  startTime: string;
  endTime: string;
  blockMinutes: number;
}

interface AppointmentSlot {
  id: string;
  fecha_hora: string;
  duracionReservada?: number | null;
  disponibleHasta?: string | null;
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
  for (let value = start; value < end; value += settings.blockMinutes) {
    times.push(value);
  }
  return times;
};

const buildSlotDate = slotInstant;

const getDefaultStatus = () => 'available' as SlotStatus;
const isPastSlot = (date: string, slotTime: number) => buildSlotDate(date, slotTime).getTime() <= Date.now();

export default function BarberCalendar() {
  const today = useMemo(() => businessDate(), []);
  const currentWeek = useMemo(() => startOfWeek(today), [today]);
  const [weekStart, setWeekStart] = useState(currentWeek);
  const [settings, setSettings] = useState<CalendarSettings>(DEFAULT_SETTINGS);
  const [slots, setSlots] = useState<StoredSlots>({});
  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot | null>(null);
  const [highlightToday, setHighlightToday] = useState(true);
  const [copiedWeek, setCopiedWeek] = useState<CopiedWeek | null>(null);
  const [copyFeedback, setCopyFeedback] = useState('');
  const [savingWeek, setSavingWeek] = useState(false);
  const [reservedSlots, setReservedSlots] = useState<ReservedSlots>({});
  const [loadingReservations, setLoadingReservations] = useState(false);
  const [savedAgenda, setSavedAgenda] = useState<{ revision: string; publicada: boolean; configuracion: CalendarSettings; citas: AppointmentSlot[]; bloqueos: { inicio: string; fin: string; tipo: string; origen: string }[] } | null>(null);
  const requestVersion = useRef(0);
  const [calendarReady, setCalendarReady] = useState(false);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );
  const slotTimes = useMemo(() => buildSlotTimes(settings), [settings]);

  const getSlotKey = useCallback((date: string, slotTime: number) => `${date}-${formatSlotTime(slotTime)}`, []);
  const getSlotKeyFromDate = useCallback((date: Date) => `${businessDate(date)}-${businessTime(date)}`, []);

  const loadReservations = useCallback(async () => {
    const token = window.localStorage.getItem('token');
    if (!token) return;

    const version = ++requestVersion.current;
    setLoadingReservations(true); setCalendarReady(false); setSelectedSlot(null);
    try {
      const data = await professionalApi('/profesional/calendario?desde=' + weekStart + '&hasta=' + addDays(weekStart, 6));
      if (version !== requestVersion.current) return;
      if (!Array.isArray(data?.citas) || !Array.isArray(data?.bloqueos)) throw new Error('No se pudo cargar la disponibilidad publicada.');
      setSavedAgenda(data); setSettings(data.configuracion || DEFAULT_SETTINGS); setCalendarReady(true);
      const nextReservedSlots: ReservedSlots = {};

      (data.citas as AppointmentSlot[])
        .filter((slot) => {
          return ['pendiente', 'confirmada'].includes(slot.estado);
        })
        .forEach((slot) => {
          const date = new Date(slot.fecha_hora);
          nextReservedSlots[getSlotKeyFromDate(date)] = slot;
        });

      setReservedSlots(nextReservedSlots);
    } catch (error) {
      if (version !== requestVersion.current) return;
      setCopyFeedback(error instanceof Error ? error.message : 'No se pudieron cargar las reservas.');
      setReservedSlots({});
    } finally {
      if (version === requestVersion.current) setLoadingReservations(false);
    }
  }, [getSlotKeyFromDate, weekStart]);

  useEffect(() => {
    void loadReservations();
    const refresh = () => void loadReservations();
    window.addEventListener('professional-blocks-updated', refresh);
    return () => { requestVersion.current++; window.removeEventListener('professional-blocks-updated', refresh); };
  }, [loadReservations]);

  useEffect(() => {
    if (!savedAgenda) return;
    const windows = savedAgenda.citas.filter(c => c.estado === 'disponible' && c.disponibleHasta).sort((a,b) => a.fecha_hora.localeCompare(b.fecha_hora));
    const blocks = savedAgenda.bloqueos.filter(b => b.origen === 'agenda');
    const next: StoredSlots = {};
    weekDays.forEach(day => slotTimes.forEach(time => {
      const start = +buildSlotDate(day, time), end = +buildSlotDate(day, Math.min(time + settings.blockMinutes, parseTime(settings.endTime)));
      // Paint the published intervals; reservation permission stays in the backend.
      let cursor = start;
      for (const window of windows) {
        if (+new Date(window.fecha_hora) <= cursor && +new Date(window.disponibleHasta!) > cursor) cursor = +new Date(window.disponibleHasta!);
      }
      const block = blocks.find(b => +new Date(b.inicio) < end && +new Date(b.fin) > start);
      next[getSlotKey(day, time)] = block ? block.tipo === 'descanso' ? 'break' : 'booking'
        : !savedAgenda.publicada && !windows.length && !blocks.length || cursor >= end ? 'available' : 'booking';
    }));
    setSlots(next);
  }, [savedAgenda, weekDays, slotTimes, settings, getSlotKey]);

  const reservationAt = (date: string, time: number) => {
    const start = +buildSlotDate(date, time), end = +buildSlotDate(date, Math.min(time + settings.blockMinutes, parseTime(settings.endTime)));
    return Object.values(reservedSlots).find(slot => +new Date(slot.fecha_hora) < end && +new Date(slot.fecha_hora) + (slot.duracionReservada || slot.servicio?.duracion_minutos || 1) * 60000 > start);
  };

  const openSlot = (date: string, slotTime: number) => {
    const key = getSlotKey(date, slotTime);
    const reservedSlot = reservationAt(date, slotTime);
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

  const syncWeekAvailability = async (weekSlots: StoredSlots, days = weekDays, times = slotTimes, configuration = settings) => {
    const token = window.localStorage.getItem('token');
    if (!token) {
      setCopyFeedback('Inicia sesión para guardar la agenda en el sistema.');
      return;
    }

    if (times.length === 0) {
      setCopyFeedback('La hora de cierre no puede ser anterior a la hora de entrada.');
      return;
    }

    if (!calendarReady || savingWeek) return;
    const blockedBlocks: { inicio: string; fin: string; tipo: string }[] = [];
    const availableBlocks: { inicio: string; fin: string }[] = [];
    days.forEach((date) => {
      times.forEach((slotTime) => {
        const key = getSlotKey(date, slotTime);
        const status = weekSlots[key] ?? getDefaultStatus();
        if (status !== 'available' && !isPastSlot(date, slotTime)) blockedBlocks.push({ inicio: buildSlotDate(date, slotTime).toISOString(), fin: buildSlotDate(date, Math.min(slotTime + configuration.blockMinutes, parseTime(configuration.endTime))).toISOString(), tipo: status === 'break' ? 'descanso' : 'bloqueado' });
        if (status === 'available') {
          const blockDate = buildSlotDate(date, slotTime);
          if (blockDate.getTime() > Date.now()) {
            const endDate = buildSlotDate(date, Math.min(slotTime + configuration.blockMinutes, parseTime(configuration.endTime)));
            availableBlocks.push({ inicio: blockDate.toISOString(), fin: endDate.toISOString() });
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
          fechaInicio: dayStart(days[0]).toISOString(),
          fechaFin: dayStart(addDays(days[0], 7)).toISOString(),
          revision: savedAgenda?.revision,
          configuracion: configuration,
          bloques: availableBlocks,
          bloqueos: blockedBlocks,
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
      window.dispatchEvent(new Event('professional-calendar-updated'));
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
    setCopyFeedback('Configuración sin guardar. Revisa los bloques y guarda la agenda.');
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

    const label = `${formatDay(weekStart, { day: 'numeric', month: 'short' })} - ${formatDay(weekDays[6], { day: 'numeric', month: 'short' })}`;
    setCopiedWeek({ label, slots: copiedSlots, settings: { ...settings } });
    setCopyFeedback(`Semana ${label} copiada. Navega a otra semana y presiona "Pegar aquí".`);
  };

  const pasteCopiedWeek = () => {
    if (!copiedWeek) return;

    const targetLabel = `${formatDay(weekStart, { day: 'numeric', month: 'short' })} - ${formatDay(weekDays[6], { day: 'numeric', month: 'short' })}`;
    const confirmed = window.confirm(
      `¿Copiar la agenda de ${copiedWeek.label} sobre la semana ${targetLabel}? Se reemplazarán sus bloques.`,
    );
    if (!confirmed) return;

    const updatedSlots = { ...slots };
    const copiedTimes = buildSlotTimes(copiedWeek.settings);
    weekDays.forEach((date, dayIndex) => {
      copiedTimes.forEach((slotTime) => {
        updatedSlots[getSlotKey(date, slotTime)] = copiedWeek.slots[`${dayIndex}-${formatSlotTime(slotTime)}`] ?? getDefaultStatus();
      });
    });
    setSettings(copiedWeek.settings);
    setSlots(updatedSlots);
    setCopyFeedback('Guardando la semana copiada...');
    void syncWeekAvailability(updatedSlots, weekDays, copiedTimes, copiedWeek.settings);
  };

  const weekEnd = weekDays[6];

  return (
    <article id="disponibilidad-profesional" className="pro-panel pro-agenda barber-calendar">
      <div className="calendar-toolbar">
        <div>
          <h2>Mi agenda semanal</h2>
          <p>
            {capitalize(formatDay(weekStart, { day: 'numeric', month: 'long' }))} –{' '}
            {formatDay(weekEnd, { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
          <small className="calendar-toolbar-hint">
            Edita la disponibilidad. Si la semana está vacía, se propone el horario configurado; guárdalo para publicarlo.
          </small>
        </div>

        <div className="calendar-actions" aria-label="Navegación de la agenda">
          <button type="button" disabled={savingWeek} onClick={() => goToCurrentWeek(true)}>Hoy</button>
          <button type="button" disabled={savingWeek} onClick={() => goToCurrentWeek(false)}>Semana actual</button>
          <button
            type="button"
            disabled={savingWeek}
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
            disabled={savingWeek}
            aria-label="Semana siguiente"
            onClick={() => {
              setWeekStart((week) => addWeeks(week, 1));
              setHighlightToday(false);
            }}
          >
            Siguiente →
          </button>
          <button type="button" className="calendar-copy-button" disabled={savingWeek || !calendarReady} onClick={copyCurrentWeek}>
            Copiar semana
          </button>
          <button
            type="button"
            className="calendar-paste-button"
            onClick={pasteCopiedWeek}
            disabled={!copiedWeek || savingWeek || !calendarReady}
            title={copiedWeek ? `Copiar desde ${copiedWeek.label}` : 'Primero copia una semana'}
          >
            Pegar aquí
          </button>
          <button
            type="button"
            className="calendar-save-button"
            disabled={savingWeek || !calendarReady}
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
            aria-label="Hora de entrada" disabled={savingWeek || !calendarReady}
            value={settings.startTime}
            onChange={(event) => updateSettings({ ...settings, startTime: event.target.value })}
          >
            {TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}
          </select>
        </label>
        <label>
          Hora de cierre
          <select
            aria-label="Hora de cierre" disabled={savingWeek || !calendarReady}
            value={settings.endTime}
            onChange={(event) => updateSettings({ ...settings, endTime: event.target.value })}
          >
            {TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}
          </select>
        </label>
        <label>
          Duración de cada bloque
          <select
            aria-label="Duración de cada bloque" disabled={savingWeek || !calendarReady}
            value={settings.blockMinutes}
            onChange={(event) => updateSettings({ ...settings, blockMinutes: Number(event.target.value) })}
          >
            {BLOCK_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}
          </select>
        </label>
      </section>

      <button type="button" disabled={savingWeek || loadingReservations} onClick={() => void loadReservations()}>Recargar semana</button>
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
            const dateLabel = capitalize(formatDay(date, { weekday: 'long', day: 'numeric' }));
            const isToday = highlightToday && date === today;

            return (
              <div key={date} className={`calendar-day${isToday ? ' is-today' : ''}`}>
                <div className="calendar-day-header">
                  <strong>{capitalize(formatDay(date, { weekday: 'long' }))}</strong>
                  <span>{formatDay(date, { day: 'numeric' })}</span>
                </div>
                {slotTimes.map((slotTime) => {
                  const key = getSlotKey(date, slotTime);
                  const reservedSlot = reservedSlots[key];
                  const pastSlot = isPastSlot(date, slotTime);
                  const intervalStart = +buildSlotDate(date, slotTime), intervalEnd = +buildSlotDate(date, Math.min(slotTime + settings.blockMinutes, parseTime(settings.endTime)));
                  const manualBlock = savedAgenda?.bloqueos.find(b => b.origen !== 'agenda' && +new Date(b.inicio) < intervalEnd && +new Date(b.fin) > intervalStart);
                  const detail = reservedSlot
                    ? `${reservedSlot.cliente?.nombre || 'Cliente'} · ${reservedSlot.servicio?.nombre_servicio || 'Servicio'}`
                    : manualBlock ? 'Gestionar en Citas y bloqueos' : undefined;
                  return (
                    <CalendarSlot
                      key={key}
                      dateLabel={dateLabel}
                      timeLabel={formatSlotTime(slotTime)}
                      status={reservedSlot ? 'reserved' : manualBlock ? manualBlock.tipo === 'descanso' ? 'break' : 'booking' : slots[key] ?? getDefaultStatus()}
                      disabled={Boolean(reservedSlot || manualBlock) || pastSlot || savingWeek || !calendarReady}
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
          dateLabel={capitalize(formatDay(selectedSlot.date, { weekday: 'long', day: 'numeric', month: 'long' }))}
          hourLabel={formatSlotTime(selectedSlot.slotTime)}
          status={selectedSlot.status}
          onClose={closeModal}
          onChange={updateSlot}
        />
      )}
    </article>
  );
}
