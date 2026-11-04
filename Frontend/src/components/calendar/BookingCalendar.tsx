import { useMemo, useRef, useState } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import { addDays, businessDate, businessTime, formatDay, startOfWeek } from '../../lib/businessTime';
import '../../styles/booking-calendar.css';

export interface BookingCalendarCell {
  fecha: string;
  hora: string;
  fecha_hora: string | null;
  estado: 'available' | 'reserved' | 'unavailable';
  citaId?: string;
  motivo?: 'pasado' | 'bloqueado' | 'duracion' | 'sin_publicar' | 'agenda' | 'hora_invalida';
  ocupacion?: { inicio: string; fin: string; desde: number; hasta: number; tipo?: 'reserved' | 'bloqueado' | 'descanso' }[];
}

export interface BookingCalendarData {
  dias: string[];
  horas: string[];
  horarios: BookingCalendarCell[];
  zonaHoraria: string;
  consultadoEn: string;
  configuracion?: { startTime: string; endTime: string; blockMinutes: number };
}

const labels = { available: 'Disponible', reserved: 'Reservado', unavailable: 'No disponible', selected: 'Seleccionado' };
const reasons = {
  pasado: 'Esta hora ya pasó.', bloqueado: 'El profesional no atiende en este horario.',
  duracion: 'El bloque completo no está disponible antes de otra reserva, bloqueo o cierre.',
  sin_publicar: 'No hay un inicio de atención publicado para esta hora.',
  agenda: 'El profesional debe revisar este horario.', hora_invalida: 'Hora no válida por el cambio de horario de Chile.',
};

function StatusIcon({ status }: { status: keyof typeof labels }) {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    {status === 'reserved' ? <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>
      : status === 'unavailable' ? <><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></>
      : <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>}
  </svg>;
}

interface Props {
  now: number;
  weekStart: string;
  selectedDate: string;
  selectedSlotId: string | null;
  data: BookingCalendarData | null;
  loading: boolean;
  error: string;
  disabled: boolean;
  onDateChange: (date: string) => void;
  onWeekChange: (date: string) => void;
  onSelect: (cell: BookingCalendarCell) => void;
  onRefresh: () => void;
}

export default function BookingCalendar({ now, weekStart, selectedDate, selectedSlotId, data, loading, error, disabled, onDateChange, onWeekChange, onSelect, onRefresh }: Props) {
  const today = businessDate(new Date(now));
  const currentTime = businessTime(new Date(now));
  const visibleWeek = weekStart < startOfWeek(today) ? startOfWeek(today) : weekStart;
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(visibleWeek, i)).filter(day => day >= today), [visibleWeek, today]);
  // Shared rows must remain visible when the same time is still future on another day.
  const times = data?.horas.filter(time => days.some(day => day > today || time > currentTime)) ?? [];
  const cells = useMemo(() => new Map(data?.horarios.map(cell => [`${cell.fecha}-${cell.hora}`, cell])), [data]);
  const [month, setMonth] = useState(() => selectedDate.slice(0, 7) + '-01');
  const pickerRef = useRef<HTMLDetailsElement>(null);
  const pickerTriggerRef = useRef<HTMLElement>(null);
  const monthDays = useMemo(() => {
    const first = Temporal.PlainDate.from(month);
    const start = startOfWeek(month);
    return Array.from({ length: Math.ceil((first.dayOfWeek - 1 + first.daysInMonth) / 7) * 7 }, (_, i) => addDays(start, i));
  }, [month]);
  const goToDate = (date: string) => {
    if (date < businessDate()) return;
    onWeekChange(startOfWeek(date)); onDateChange(date);
    if (pickerRef.current) pickerRef.current.open = false;
    pickerTriggerRef.current?.focus();
  };

  return <div className="booking-availability" aria-label="Calendario de disponibilidad" aria-busy={loading}>
    <div className="booking-calendar-toolbar">
      <div className="booking-week-nav">
        <button type="button" aria-label="Semana anterior" disabled={disabled || visibleWeek <= startOfWeek(today)} onClick={() => onWeekChange(addDays(visibleWeek, -7))}>← Anterior</button>
        <strong aria-live="polite">{formatDay(days[0], { day: 'numeric', month: 'short' })} – {formatDay(days[days.length - 1], { day: 'numeric', month: 'short', year: 'numeric' })}</strong>
        <button type="button" aria-label="Semana siguiente" disabled={disabled} onClick={() => onWeekChange(addDays(visibleWeek, 7))}>Siguiente →</button>
      </div>
      <div className="booking-calendar-tools">
        <button type="button" disabled={disabled} onClick={() => goToDate(today)}>Hoy</button>
        <details className="booking-month-picker" ref={pickerRef} onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); event.currentTarget.open = false; pickerTriggerRef.current?.focus(); }
        }}>
          <summary ref={pickerTriggerRef} aria-disabled={disabled} onClick={event => {
            if (disabled) { event.preventDefault(); return; }
            setMonth(selectedDate.slice(0, 7) + '-01');
          }}>Elegir fecha <span aria-hidden="true">▾</span></summary>
          <div className="booking-month-popover" aria-label="Selector mensual">
            <div className="booking-month-header">
              <button type="button" aria-label="Mes anterior" disabled={disabled || month.slice(0, 7) <= today.slice(0, 7)} onClick={() => setMonth(Temporal.PlainDate.from(month).subtract({ months: 1 }).toString())}>←</button>
              <strong aria-live="polite">{formatDay(month, { month: 'long', year: 'numeric' })}</strong>
              <button type="button" aria-label="Mes siguiente" onClick={() => setMonth(Temporal.PlainDate.from(month).add({ months: 1 }).toString())}>→</button>
            </div>
            <div className="booking-month-grid">
              {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((day, i) => <span key={i} aria-hidden="true">{day}</span>)}
              {monthDays.map(day => <button type="button" key={day} disabled={disabled || day < today}
                className={`${day.slice(0, 7) !== month.slice(0, 7) ? 'is-outside' : ''}${day === today ? ' is-today' : ''}${day === selectedDate ? ' is-selected' : ''}`}
                aria-label={formatDay(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                aria-current={day === today ? 'date' : undefined} aria-pressed={day === selectedDate}
                onClick={() => goToDate(day)}>{formatDay(day, { day: 'numeric' })}</button>)}
            </div>
          </div>
        </details>
        <button type="button" disabled={loading || disabled} onClick={onRefresh}>{loading ? 'Actualizando…' : 'Actualizar'}</button>
      </div>
    </div>

    <ul className="booking-calendar-legend" aria-label="Estados de los horarios">
      {(Object.keys(labels) as (keyof typeof labels)[]).map(status => <li key={status} className={`is-${status}`}><StatusIcon status={status} />{labels[status]}</li>)}
    </ul>
    <div className="booking-calendar-days" style={{ gridTemplateColumns: `repeat(${Math.min(days.length, 4)}, minmax(0, 1fr))` }} aria-label="Elegir día">
      {days.map(day => <button key={day} type="button" disabled={disabled}
        className={`${day === selectedDate ? 'is-selected' : ''}${day === today ? ' is-today' : ''}`}
        aria-label={formatDay(day, { weekday: 'long', day: 'numeric', month: 'long' })}
        aria-current={day === today ? 'date' : undefined} aria-pressed={day === selectedDate}
        onClick={() => onDateChange(day)}>
        <span>{formatDay(day, { weekday: 'short' })}</span><strong>{formatDay(day, { day: 'numeric' })}</strong>
        {day === today && <small>Hoy</small>}
      </button>)}
    </div>
    {loading && !data ? <p className="booking-empty" role="status">Consultando agenda…</p>
      : error ? <div className="booking-calendar-error" role="alert"><p>{error}</p><button type="button" onClick={onRefresh}>Volver a consultar agenda</button></div>
      : data && <>
        {!data.horarios.some(cell => days.includes(cell.fecha) && cell.estado === 'available' && Boolean(cell.fecha_hora && new Date(cell.fecha_hora).getTime() > now)) && <p className="booking-calendar-notice" role="status">No hay horas disponibles en la semana consultada.</p>}
        <div className="booking-calendar-scroll">
          <table className="booking-calendar-table">
            <caption className="sr-only">Agenda semanal del barbero. Los horarios se muestran en la hora de Chile.</caption>
            <thead><tr><th scope="col">Hora</th>{days.map(day => <th scope="col" key={day} className={day === selectedDate ? 'is-selected-day' : ''}>
              <button type="button" disabled={disabled} aria-pressed={day === selectedDate} aria-current={day === today ? 'date' : undefined} onClick={() => onDateChange(day)}>
                <span>{formatDay(day, { weekday: 'short', day: 'numeric' })}</span>{day === today && <small>Hoy</small>}
              </button>
            </th>)}</tr></thead>
            <tbody>{times.map(time => <tr key={time}><th scope="row"><time>{time}</time></th>{days.map(day => {
              const cell = cells.get(`${day}-${time}`);
              const expired = cell?.fecha_hora ? new Date(cell.fecha_hora).getTime() <= now : day === today && time <= currentTime;
              const selected = Boolean(cell?.citaId && cell.citaId === selectedSlotId && !expired);
              const status = selected ? 'selected' : !cell || expired ? 'unavailable' : cell.estado;
              const reason = expired ? reasons.pasado : cell?.motivo ? reasons[cell.motivo] : '';
              return <td key={day} className={day === selectedDate ? 'is-selected-day' : ''}>
                <button type="button" className={`booking-calendar-cell is-${status}`} disabled={loading || disabled || !cell || cell.estado !== 'available' || expired}
                  aria-pressed={cell?.estado === 'available' ? selected : undefined}
                  aria-label={`${formatDay(day, { weekday: 'long', day: 'numeric', month: 'long' })}, ${time}: ${labels[status]}${reason ? `. ${reason}` : ''}`}
                  style={cell?.ocupacion?.length && !selected ? { backgroundImage: cell.ocupacion.map(part => { const color = part.tipo === 'descanso' ? 'rgba(242, 194, 48, .55)' : part.tipo === 'bloqueado' ? 'rgba(18, 97, 216, .5)' : 'rgba(220, 50, 50, .4)'; return `linear-gradient(to bottom, transparent ${part.desde}%, ${color} ${part.desde}%, ${color} ${part.hasta}%, transparent ${part.hasta}%)`; }).join(', ') } : undefined}
                  title={[reason || labels[status], ...(cell?.ocupacion || []).map(part => `${part.tipo === 'descanso' ? 'Descanso' : part.tipo === 'bloqueado' ? 'Bloqueado' : 'Reservado'} ${businessTime(part.inicio)}–${businessTime(part.fin)}`)].join(' · ')} onClick={() => cell && cell.fecha_hora && new Date(cell.fecha_hora).getTime() > Date.now() && onSelect(cell)}>
                  <StatusIcon status={status} /><span>{labels[status]}</span>
                </button>
              </td>;
            })}</tr>)}</tbody>
          </table>
        </div>
        <p className="booking-calendar-note">Hora de Chile{data.configuracion ? ` · Bloques de ${data.configuracion.blockMinutes} minutos` : ''} · La disponibilidad se actualiza automáticamente y se verifica al confirmar tu reserva.</p>
      </>}
  </div>;
}
