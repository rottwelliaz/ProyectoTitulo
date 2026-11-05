import { authFetch as fetch, API_URL } from '../../lib/session';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, addWeeks, businessDate, businessTime, dayStart, formatDay, slotInstant, startOfWeek, reservationEnd } from '../../lib/businessTime';
import { professionalApi } from '../../lib/professionalApi';
import { confirmAction, notifySuccess, notifyError } from '../../lib/notifications';
import { BLOCK_OPTIONS, buildSlotTimes, parseTime, formatSlotTime, slotEndMinute, applyInterval, clipIntervals, intervalStatus, sameIntervals, type CalendarSettings, type AgendaInterval, type IntervalStatus } from '../../lib/calendarIntervals';
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
  intervals: { dayIndex: number; start: number; end: number; status: IntervalStatus }[];
  settings: CalendarSettings;
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
  } | null;
}

type ReservedSlots = Record<string, AppointmentSlot>;


const DEFAULT_SETTINGS: CalendarSettings = {
  startTime: '09:00',
  endTime: '19:00',
  blockMinutes: 60,
};
const TIME_OPTIONS = Array.from({ length: 33 }, (_, index) => {
  const minutes = 6 * 60 + index * 30;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
});

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

const buildSlotDate = slotInstant;

const isPastSlot = (date: string, slotTime: number) => buildSlotDate(date, slotTime).getTime() <= Date.now();

export default function BarberCalendar() {
  const today = useMemo(() => businessDate(), []);
  const currentWeek = useMemo(() => startOfWeek(today), [today]);
  const [weekStart, setWeekStart] = useState(currentWeek);
  const [settings, setSettings] = useState<CalendarSettings>(DEFAULT_SETTINGS);
  const [changes, setChanges] = useState<AgendaInterval[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot | null>(null);
  const [highlightToday, setHighlightToday] = useState(true);
  const [copiedWeek, setCopiedWeek] = useState<CopiedWeek | null>(null);
  const [copyFeedback, setCopyFeedback] = useState('');
  const [savingWeek, setSavingWeek] = useState(false);
  const [reservedSlots, setReservedSlots] = useState<ReservedSlots>({});
  const [loadingReservations, setLoadingReservations] = useState(false);
  const [savedAgenda, setSavedAgenda] = useState<{ revision: string; publicada: boolean; configuracion: CalendarSettings; citas: AppointmentSlot[]; bloqueos: { inicio: string; fin: string; tipo: string; origen: string }[] } | null>(null);
  const requestVersion = useRef(0);
  const pastingWeek = useRef(false);
  const [calendarReady, setCalendarReady] = useState(false);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const draftVersion = useRef(0);
  const editingSlot = useRef(false);
  // Keep the guard through the dialog's cleanup and native focus restoration.
  useEffect(() => { editingSlot.current = selectedSlot !== null; }, [selectedSlot]);

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
    const requestedDraftVersion = draftVersion.current;
    setLoadingReservations(true); setCalendarReady(false); setSelectedSlot(null);
    try {
      const data = await professionalApi('/profesional/calendario?desde=' + weekStart + '&hasta=' + addDays(weekStart, 6));
      if (version !== requestVersion.current) return;
      // A focus/periodic refresh may have started before a queued select/edit
      // event. Its response must not promote that newer draft to saved data.
      if (requestedDraftVersion !== draftVersion.current) { setCalendarReady(true); return; }
      if (!Array.isArray(data?.citas) || !Array.isArray(data?.bloqueos)) throw new Error('No se pudo cargar la disponibilidad publicada.');
      const configuration = { ...DEFAULT_SETTINGS, ...data.configuracion };
      if (!BLOCK_OPTIONS.includes(configuration.blockMinutes)) configuration.blockMinutes = DEFAULT_SETTINGS.blockMinutes;
      setSavedAgenda({ ...data, configuracion: configuration }); setSettings(configuration); setChanges([]); setCalendarReady(true);
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
      if (requestedDraftVersion !== draftVersion.current) setCalendarReady(true);
      else setReservedSlots({});
    } finally {
      if (version === requestVersion.current) setLoadingReservations(false);
    }
  }, [getSlotKeyFromDate, weekStart]);

  useEffect(() => {
    void loadReservations();
    const refresh = () => {
      // Native dialog focus traversal can refocus the window. Refreshing here
      // would close the editor before the user finishes choosing a status.
      if (savingRef.current || editingSlot.current) return;
      if (dirtyRef.current) { setCopyFeedback('La agenda puede haber cambiado. Tus cambios pendientes se conservan; recarga para revisar la última versión.'); return; }
      void loadReservations();
    };
    window.addEventListener('professional-calendar-updated', refresh);
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 30000);
    return () => { requestVersion.current++; clearInterval(timer); window.removeEventListener('professional-calendar-updated', refresh); window.removeEventListener('focus', refresh); };
  }, [loadReservations]);

  const baseIntervals = useMemo(() => {
    if (!savedAgenda) return [] as AgendaInterval[];
    const windows = savedAgenda.citas.filter(c => c.estado === 'disponible' && c.disponibleHasta).sort((a,b) => a.fecha_hora.localeCompare(b.fecha_hora));
    const blocks = savedAgenda.bloqueos.filter(b => b.origen === 'agenda');
    let next: AgendaInterval[] = [];
    windows.forEach(window => { next = applyInterval(next, { start: +new Date(window.fecha_hora), end: +new Date(window.disponibleHasta!), status: 'available' }); });
    blocks.forEach(block => { next = applyInterval(next, { start: +new Date(block.inicio), end: +new Date(block.fin), status: block.tipo === 'descanso' ? 'break' : 'booking' }); });
    return next;
  }, [savedAgenda]);
  const draftIntervals = useMemo(() => changes.reduce(applyInterval, baseIntervals), [baseIntervals, changes]);
  const visibleIntervals = useMemo(() => (savedAgenda?.bloqueos || []).filter(b => b.origen !== 'agenda').reduce((intervals, block) => applyInterval(intervals, { start: +new Date(block.inicio), end: +new Date(block.fin), status: block.tipo === 'descanso' ? 'break' : 'booking' }), draftIntervals), [draftIntervals, savedAgenda]);
  const settingsDirty = Boolean(savedAgenda && (settings.startTime !== savedAgenda.configuracion?.startTime || settings.endTime !== savedAgenda.configuracion?.endTime || settings.blockMinutes !== savedAgenda.configuracion?.blockMinutes));
  const dirty = settingsDirty || !sameIntervals(draftIntervals, baseIntervals);
  dirtyRef.current = dirty;
  const discardChanges = async () => !dirtyRef.current || await confirmAction('Hay cambios pendientes de guardar. ¿Deseas descartarlos y continuar?', 'Sí, descartar cambios');
  useEffect(() => {
    let bypass = false;
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    const navigation = (event: MouseEvent) => {
      if (bypass || !dirtyRef.current || !(event.target instanceof Element)) return;
      const target = event.target.closest<HTMLElement>('a[href], [data-pro-tab]');
      if (!target || target.closest('#disponibilidad-profesional')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      void (async () => { if (await discardChanges()) { setChanges([]); if (savedAgenda) setSettings(savedAgenda.configuracion); dirtyRef.current = false; bypass = true; target.click(); bypass = false; } })();
    };
    const beforeView = (event: Event) => {
      const detail = (event as CustomEvent<{ allow: Promise<boolean> }>).detail;
      detail.allow = discardChanges().then(allow => {
        if (allow) { setChanges([]); if (savedAgenda) setSettings(savedAgenda.configuracion); dirtyRef.current = false; }
        return allow;
      });
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', navigation, true);
    window.addEventListener('professional-before-view-change', beforeView);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', navigation, true); window.removeEventListener('professional-before-view-change', beforeView); };
  }, [savedAgenda]);
  const changeWeek = async (next: string, markToday = false) => {
    if (next === weekStart) { setHighlightToday(markToday); return; }
    if (!await discardChanges()) return;
    requestVersion.current++;
    setChanges([]); setSavedAgenda(null); setCalendarReady(false); setCopyFeedback(''); setWeekStart(next); setHighlightToday(markToday);
  };
  const reloadWeek = async () => { if (await discardChanges()) await loadReservations(); };

  const reservationsAt = (date: string, time: number) => {
    const start = +buildSlotDate(date, time), end = +buildSlotDate(date, slotEndMinute(time, settings));
    return Object.values(reservedSlots).filter(slot => +new Date(slot.fecha_hora) < end && +(reservationEnd(slot) ?? new Date(8640000000000000)) > start);
  };
  const reservationAt = (date: string, time: number) => reservationsAt(date, time)[0];

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

    editingSlot.current = true;
    setSelectedSlot({ date, slotTime, key, status: intervalStatus(draftIntervals, +buildSlotDate(date, slotTime), +buildSlotDate(date, slotEndMinute(slotTime, settings))) });
  };

  const closeModal = useCallback(() => setSelectedSlot(null), []);

  const syncWeekAvailability = async () => {
    const token = window.localStorage.getItem('token');
    if (!token) {
      setCopyFeedback('Inicia sesión para guardar la agenda en el sistema.');
      return;
    }

    if (slotTimes.length === 0) {
      setCopyFeedback('La hora de cierre no puede ser anterior a la hora de entrada.');
      return;
    }

    if (!calendarReady || savingWeek || savingRef.current) return;
    const blockedBlocks: { inicio: string; fin: string; tipo: string }[] = [];
    const availableBlocks: { inicio: string; fin: string }[] = [];
    weekDays.forEach(date => slotTimes.forEach(time => {
      const start = +buildSlotDate(date, time), end = +buildSlotDate(date, slotEndMinute(time, settings));
      if (start <= Date.now()) return;
      clipIntervals(draftIntervals, start, end).forEach(part => {
        const interval = { inicio: new Date(part.start).toISOString(), fin: new Date(part.end).toISOString() };
        if (part.status === 'available') availableBlocks.push(interval);
        else blockedBlocks.push({ ...interval, tipo: part.status === 'break' ? 'descanso' : 'bloqueado' });
      });
    }));

    setSavingWeek(true); savingRef.current = true;
    try {
      const save = (conservarReservas = false) => fetch(`${API_URL}/citas/disponibilidad/semana`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fechaInicio: dayStart(weekDays[0]).toISOString(),
          fechaFin: dayStart(addDays(weekDays[0], 7)).toISOString(),
          revision: savedAgenda?.revision,
          configuracion: settings,
          bloques: availableBlocks,
          bloqueos: blockedBlocks,
          conservarReservas,
        }),
      });
      let response = await save();
      let data = await response.json().catch(() => ({}));
      if (response.status === 409 && Array.isArray(data.conflictos)) {
        if (!await confirmAction(`${data.message}\n${data.conflictos.join('\n')}`, 'Conservar citas y guardar')) return;
        response = await save(true); data = await response.json().catch(() => ({}));
      }
      if (!response.ok) throw new Error(data.message || 'No se pudo guardar la agenda.');

      const omitted = Number(data.omittedOccupiedBlocks || 0);
      setCopyFeedback(
        omitted
          ? `Agenda guardada. ${omitted} bloque(s) ocupado(s) se conservaron sin cambios.`
          : 'Agenda guardada y disponible para las reservas de clientes.',
      );
      await loadReservations();
      void notifySuccess('Horarios guardados correctamente.');
      window.dispatchEvent(new Event('professional-calendar-updated'));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo guardar la agenda.';
      setCopyFeedback(message);
      void notifyError(message);
    } finally {
      setSavingWeek(false);
      savingRef.current = false;
    }
  };

  const updateSlot = (status: SlotStatus) => {
    if (!selectedSlot) return;
    if (status === 'reserved') return;
    draftVersion.current++;
    setChanges(previous => [...previous, { start: +buildSlotDate(selectedSlot.date, selectedSlot.slotTime), end: +buildSlotDate(selectedSlot.date, slotEndMinute(selectedSlot.slotTime, settings)), status }]);
    closeModal();
    setCopyFeedback('');
  };

  const updateSettings = (nextSettings: CalendarSettings) => {
    draftVersion.current++;
    setSettings(nextSettings);
    setCopiedWeek(null);
    setCopyFeedback('');
  };

  const goToCurrentWeek = (markToday: boolean) => {
    void changeWeek(currentWeek, markToday);
  };

  const copyCurrentWeek = () => {
    const intervals: CopiedWeek['intervals'] = [];
    weekDays.forEach((date, dayIndex) => clipIntervals(draftIntervals, +buildSlotDate(date, parseTime(settings.startTime)), +buildSlotDate(date, parseTime(settings.endTime))).forEach(part => {
      intervals.push({ dayIndex, start: parseTime(businessTime(new Date(part.start))), end: parseTime(businessTime(new Date(part.end))), status: part.status });
    }));

    const label = `${formatDay(weekStart, { day: 'numeric', month: 'short' })} - ${formatDay(weekDays[6], { day: 'numeric', month: 'short' })}`;
    setCopiedWeek({ label, intervals, settings: { ...settings } });
    setCopyFeedback(`Semana ${label} copiada. Navega a otra semana y presiona "Pegar aquí".`);
  };

  const pasteCopiedWeek = async () => {
    if (!copiedWeek || savingWeek || pastingWeek.current) return;
    pastingWeek.current = true;

    try {
      const targetLabel = `${formatDay(weekStart, { day: 'numeric', month: 'short' })} - ${formatDay(weekDays[6], { day: 'numeric', month: 'short' })}`;
      const confirmed = await confirmAction(
        `¿Copiar la agenda de ${copiedWeek.label} sobre la semana ${targetLabel}? Se reemplazarán sus bloques.`,
        'Sí, reemplazar bloques',
      );
      if (!confirmed) return;

      draftVersion.current++;
      const next: AgendaInterval[] = weekDays.map(date => ({ start: +dayStart(date), end: +dayStart(addDays(date, 1)), status: 'unconfigured' }));
      copiedWeek.intervals.forEach(part => next.push({ start: +buildSlotDate(weekDays[part.dayIndex], part.start), end: +buildSlotDate(weekDays[part.dayIndex], part.end), status: part.status }));
      setSettings(copiedWeek.settings);
      setChanges(next);
      setCopyFeedback('Semana copiada. Revisa los bloques antes de guardar.');
    } finally { pastingWeek.current = false; }
  };

  const weekEnd = weekDays[6];
  const outsideReservations = Object.values(reservedSlots).filter(slot => businessTime(slot.fecha_hora) < settings.startTime || businessTime(slot.fecha_hora) >= settings.endTime || (reservationEnd(slot) && (businessDate(reservationEnd(slot)!) !== businessDate(slot.fecha_hora) || businessTime(reservationEnd(slot)!) > settings.endTime)));

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
            Cada nueva reserva ocupa un bloque completo de {settings.blockMinutes} minutos. Las citas existentes conservan su horario. Solo se reservan bloques que terminan antes del cierre o a esa hora.
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
              void changeWeek(addWeeks(weekStart, -1));
            }}
          >
            ← Anterior
          </button>
          <button
            type="button"
            disabled={savingWeek}
            aria-label="Semana siguiente"
            onClick={() => {
              void changeWeek(addWeeks(weekStart, 1));
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
            onClick={() => void syncWeekAvailability()}
          >
            {savingWeek ? 'Guardando...' : 'Guardar horarios'}
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

      <div className="calendar-actions calendar-secondary-actions">
      <button type="button" disabled={savingWeek || !calendarReady} onClick={() => {
        draftVersion.current++;
        const next: AgendaInterval[] = [];
        weekDays.forEach(day => slotTimes.forEach(time => {
          const start = +buildSlotDate(day, time), end = +buildSlotDate(day, slotEndMinute(time, settings));
          if (!isPastSlot(day, time) && !reservationAt(day, time) && !savedAgenda?.bloqueos.some(b => b.origen !== 'agenda' && +new Date(b.inicio) < end && +new Date(b.fin) > start)) next.push({ start, end, status: 'available' });
        }));
        setChanges(previous => [...previous, ...next]);
        setCopyFeedback('');
      }}>Habilitar semana</button>
      <button type="button" disabled={savingWeek || loadingReservations} onClick={() => void reloadWeek()}>Recargar semana</button>
      </div>
      {dirty && <p className="calendar-pending-message" role="status">Cambios pendientes de guardar</p>}
      {!savedAgenda?.publicada && calendarReady && <p>Semana sin configurar. Solo los horarios guardados se ofrecen al cliente.</p>}
      {copyFeedback && <p className="calendar-copy-feedback" role="status">{copyFeedback}</p>}
      {loadingReservations && <p className="calendar-copy-feedback is-loading" role="status">Actualizando reservas...</p>}
      {outsideReservations.length > 0 && <p className="calendar-copy-feedback">Citas fuera del rango visible que se conservan: {outsideReservations.map(slot => `${formatDay(businessDate(slot.fecha_hora), { day: 'numeric', month: 'short' })} ${businessTime(slot.fecha_hora)}–${reservationEnd(slot) ? businessTime(reservationEnd(slot)!) : 'por verificar'} (${slot.cliente?.nombre || 'Cliente'})`).join('; ')}.</p>}

      <div className="calendar-scroll">
        <div className="calendar-grid" style={{ '--calendar-rows': slotTimes.length } as React.CSSProperties}>
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
                  const reservations = reservationsAt(date, slotTime), reservedSlot = reservations[0];
                  const pastSlot = isPastSlot(date, slotTime);
                  const intervalStart = +buildSlotDate(date, slotTime), intervalEnd = +buildSlotDate(date, slotEndMinute(slotTime, settings));
                  const intervalLength = intervalEnd - intervalStart;
                  const parts = clipIntervals(visibleIntervals, intervalStart, intervalEnd);
                  const underlying = intervalStatus(visibleIntervals, intervalStart, intervalEnd);
                  const summaryParts = parts.filter(part => part.status === underlying);
                  const manualBlock = savedAgenda?.bloqueos.find(b => b.origen !== 'agenda' && +new Date(b.inicio) < intervalEnd && +new Date(b.fin) > intervalStart);
                  const detail = reservedSlot
                    ? reservations.map(slot => `${slot.cliente?.nombre || 'Cliente'} · ${slot.servicio?.nombre_servicio || 'Servicio'} · ${businessTime(slot.fecha_hora)}–${reservationEnd(slot) ? businessTime(reservationEnd(slot)!) : 'Duración por verificar'}`).join('; ')
                    : manualBlock ? 'Gestionar en Citas y bloqueos' : parts.length ? parts.map(part => `${SLOT_LABELS[part.status]} ${businessTime(new Date(part.start))}–${businessTime(new Date(part.end))}`).join('; ') : undefined;
                  return (
                    <CalendarSlot
                      key={key}
                      dateLabel={dateLabel}
                      timeLabel={`${formatSlotTime(slotTime)}–${formatSlotTime(slotEndMinute(slotTime, settings))}`}
                      status={reservedSlot ? 'reserved' : underlying}
                      reservedSegments={reservations.map(slot => ({ start: Math.max(0, (+new Date(slot.fecha_hora) - intervalStart) / intervalLength * 100), end: Math.min(100, (+(reservationEnd(slot) ?? new Date(intervalEnd)) - intervalStart) / intervalLength * 100) }))}
                      intervalSegments={parts.map(part => ({ start: (part.start - intervalStart) / intervalLength * 100, end: (part.end - intervalStart) / intervalLength * 100, status: part.status }))}
                      underlyingStatus={underlying}
                      pending={settingsDirty || !sameIntervals(clipIntervals(draftIntervals, intervalStart, intervalEnd), clipIntervals(baseIntervals, intervalStart, intervalEnd))}
                      summaryTime={summaryParts.length === 1 ? `${businessTime(new Date(summaryParts[0].start))}–${businessTime(new Date(summaryParts[0].end))}` : undefined}
                      reservationSummary={reservedSlot ? { client: reservedSlot.cliente?.nombre || 'Cliente', service: reservedSlot.servicio?.nombre_servicio || 'Servicio', time: `${businessTime(reservedSlot.fecha_hora)}–${reservationEnd(reservedSlot) ? businessTime(reservationEnd(reservedSlot)!) : 'Por verificar'}`, continuation: +new Date(reservedSlot.fecha_hora) < intervalStart && slotTime !== slotTimes[0] } : undefined}
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
        <span><i className="is-pending" />Cambio pendiente de guardar</span>
      </div>

      {selectedSlot && (
        <EditSlotModal
          dateLabel={capitalize(formatDay(selectedSlot.date, { weekday: 'long', day: 'numeric', month: 'long' }))}
          hourLabel={`${formatSlotTime(selectedSlot.slotTime)}–${formatSlotTime(slotEndMinute(selectedSlot.slotTime, settings))}`}
          status={selectedSlot.status}
          onClose={closeModal}
          onChange={updateSlot}
        />
      )}
    </article>
  );
}
