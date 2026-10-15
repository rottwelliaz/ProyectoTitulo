import { useEffect, useMemo, useState } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import { addDays, businessDate, businessTime, dayStart, formatDay, slotInstant, startOfWeek } from '../../lib/businessTime';
import { professionalApi, errorMessage, reservationLabels } from '../../lib/professionalApi';
import BarberCalendar from './BarberCalendar';
type Entry = { id: string; inicio: string; fin: string; estado: string; cliente?: { nombre: string } | null; servicio?: { nombre_servicio: string } | null; block?: boolean };
type View = 'dia' | 'semana' | 'mes';

export default function ProfessionalCalendar() {
  const [view, setView] = useState<View>('semana'), [date, setDate] = useState(businessDate());
  const [events, setEvents] = useState<Entry[]>([]), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const range = useMemo(() => {
    const day = Temporal.PlainDate.from(date);
    const start = view === 'dia' ? date : view === 'semana' ? startOfWeek(date) : day.with({ day: 1 }).toString();
    const count = view === 'dia' ? 1 : view === 'semana' ? 7 : day.daysInMonth;
    return { start, end: addDays(start, count - 1), days: Array.from({ length: count }, (_, i) => addDays(start, i)) };
  }, [date, view]);
  useEffect(() => {
    const refresh = () => setRevision(n => n + 1);
    window.addEventListener('professional-calendar-updated', refresh);
    return () => window.removeEventListener('professional-calendar-updated', refresh);
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setEvents([]); setError('');
    professionalApi(`/profesional/calendario?desde=${range.start}&hasta=${range.end}`, 'GET', undefined, controller.signal)
      .then(data => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(data?.citas) || !Array.isArray(data?.bloqueos)) throw new Error('No se pudo leer el calendario.');
        setEvents([
          ...data.citas.map((c: any) => ({ ...c, inicio: c.fecha_hora, fin: c.disponibleHasta || new Date(new Date(c.fecha_hora).getTime() + (c.duracionReservada || 1) * 60000).toISOString() })),
          ...data.bloqueos.map((b: any) => ({ ...b, estado: b.tipo, block: true })),
        ].sort((a, b) => a.inicio.localeCompare(b.inicio)));
      }).catch(e => { if (!controller.signal.aborted) setError(errorMessage(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [range, revision]);
  const move = (amount: number) => setDate(Temporal.PlainDate.from(date).add(view === 'mes' ? { months: amount } : { days: amount * (view === 'semana' ? 7 : 1) }).toString());
  return <section id="agenda-profesional" className="professional-agenda">
    <article className="pro-panel">
      <div className="pro-panel-header"><h2>Citas y bloqueos</h2><label>Vista del calendario<select aria-label="Vista del calendario" value={view} onChange={e => setView(e.target.value as View)}><option value="dia">Diaria</option><option value="semana">Semanal</option><option value="mes">Mensual</option></select></label></div>
      <div className="professional-period"><button onClick={() => move(-1)} aria-label="Período anterior">← Anterior</button><label>Fecha del calendario<input type="date" value={date} required onChange={e => { if (e.target.value) setDate(e.target.value); }} /></label><button onClick={() => setDate(businessDate())}>Ir a hoy</button><button onClick={() => move(1)} aria-label="Período siguiente">Siguiente →</button></div>
      <p>{formatDay(range.start, { day: 'numeric', month: 'long', year: 'numeric' })} — {formatDay(range.end, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      {loading && <p role="status">Cargando calendario...</p>}{error && <p role="alert">{error} <button onClick={() => setRevision(n => n + 1)}>Reintentar</button></p>}{message && <p role="status">{message}</p>}
      {!loading && !error && <div className={`professional-calendar-grid view-${view}`}>
        {range.days.map(day => {
          const start = +dayStart(day), end = +dayStart(addDays(day, 1));
          const entries = events.filter(e => +new Date(e.inicio) < end && +new Date(e.fin) > start);
          return <section className="professional-calendar-day" key={day} aria-label={day}>
            <button className="professional-day-title" onClick={() => { setDate(day); setView('dia'); }}>{formatDay(day, { weekday: 'short', day: 'numeric' })}</button>
            {!entries.length && <p>Sin citas ni disponibilidad publicada.</p>}
            {(view === 'mes' ? entries.slice(0, 3) : entries).map(entry => <div key={entry.id} className={`professional-event is-${entry.estado}`}>
              <strong>{reservationLabels[entry.estado] || entry.estado}</strong><time>{businessTime(entry.inicio)}–{businessTime(entry.fin)}</time>
              {entry.cliente && <span>{entry.cliente.nombre}</span>}{entry.servicio && <span>{entry.servicio.nombre_servicio}</span>}
              {entry.block && <button disabled={busy} onClick={async () => {
                if (!window.confirm('¿Retirar este bloqueo? Las reservas existentes se conservan.')) return;
                setBusy(true); setMessage('');
                try { await professionalApi(`/profesional/bloqueos/${entry.id}`, 'DELETE'); setMessage('Bloqueo retirado.'); window.dispatchEvent(new Event('professional-calendar-updated')); window.dispatchEvent(new Event('professional-blocks-updated')); }
                catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
              }}>Retirar bloqueo</button>}
            </div>)}
            {view === 'mes' && entries.length > 3 && <button onClick={() => { setDate(day); setView('dia'); }}>Ver {entries.length} registros</button>}
          </section>;
        })}
      </div>}
      <details className="professional-block-form"><summary>Agregar bloqueo o descanso</summary>
        <p>Impide nuevas reservas en ese intervalo. Las citas ya agendadas se mantienen.</p>
        <form className="professional-period" onSubmit={async event => {
          event.preventDefault(); const values = new FormData(event.currentTarget); setBusy(true); setError(''); setMessage('');
          const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
          try {
            await professionalApi('/profesional/bloqueos', 'POST', { inicio: slotInstant(String(values.get('dia')), minutes(String(values.get('inicio')))).toISOString(), fin: slotInstant(String(values.get('dia')), minutes(String(values.get('fin')))).toISOString(), tipo: values.get('tipo') });
            setMessage('Bloqueo guardado.'); window.dispatchEvent(new Event('professional-calendar-updated')); window.dispatchEvent(new Event('professional-blocks-updated'));
          } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
        }}><label>Día del bloqueo<input type="date" name="dia" defaultValue={date} min={businessDate()} required /></label><label>Inicio del bloqueo<input type="time" name="inicio" required /></label><label>Fin del bloqueo<input type="time" name="fin" required /></label><label>Tipo<select name="tipo"><option value="bloqueado">Bloqueo</option><option value="descanso">Descanso</option></select></label><button disabled={busy}>Guardar bloqueo</button></form>
      </details>
    </article>
    <details className="professional-publisher" open={view === 'semana'}><summary>Editar y publicar disponibilidad semanal</summary><BarberCalendar /></details>
  </section>;
}
