import { useEffect, useState } from 'react';
import { businessDate } from '../lib/businessTime';
import { professionalApi, errorMessage, reservationLabels } from '../lib/professionalApi';
export default function ProfessionalStatistics() {
  const today = businessDate();
  const [from, setFrom] = useState(today.slice(0, 7) + '-01'), [to, setTo] = useState(today);
  const [period, setPeriod] = useState({ from, to }), [data, setData] = useState<{ total: number; estados: Record<string, number> } | null>(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision(n => n + 1);
    window.addEventListener('professional-calendar-updated', refresh);
    return () => window.removeEventListener('professional-calendar-updated', refresh);
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setData(null);
    professionalApi(`/profesional/estadisticas?desde=${period.from}&hasta=${period.to}`, 'GET', undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) { if (!value?.estados) throw new Error('No se pudieron cargar las estadísticas.'); setData(value); } })
      .catch(e => { if (!controller.signal.aborted) setError(errorMessage(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [period, revision]);
  return <section className="pro-panel professional-statistics" aria-label="Estadísticas profesionales">
    <h2>Estadísticas profesionales</h2>
    <form className="professional-period" onSubmit={e => { e.preventDefault(); setPeriod({ from, to }); }}><label>Desde<input type="date" value={from} onChange={e => setFrom(e.target.value)} required /></label><label>Hasta<input type="date" min={from} value={to} onChange={e => setTo(e.target.value)} required /></label><button disabled={loading}>Consultar estadísticas</button></form>
    <p>Reservas según su fecha de atención. Período en hora de Santiago.</p>
    {loading && <p role="status">Cargando estadísticas...</p>}{error && <p role="alert">{error}</p>}
    {data && <div className="professional-stat-grid">{[['total', data.total], ...Object.entries(data.estados)].map(([key, count]) => <article className="pro-stat-card" key={key}><div><p>{key === 'total' ? 'Total de citas' : reservationLabels[String(key)]}</p><strong>{count}</strong></div></article>)}</div>}
  </section>;
}
