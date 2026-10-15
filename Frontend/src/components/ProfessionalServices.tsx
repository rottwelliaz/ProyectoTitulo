import { useEffect, useRef, useState } from 'react';
import { professionalApi, errorMessage } from '../lib/professionalApi';
type Service = { id: string; nombre_servicio: string; descripcion: string | null; precio: number; duracion_minutos: number; activo: boolean };
const price = (n: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(n);

export default function ProfessionalServices() {
  const [items, setItems] = useState<Service[]>([]), [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Service | null>(null), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState(''), [formError, setFormError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null), form = useRef<HTMLFormElement>(null);
  const load = async () => {
    const data = await professionalApi('/servicios');
    if (!Array.isArray(data)) throw new Error('La respuesta de servicios no es válida.');
    setItems(data);
  };
  useEffect(() => { load().catch(e => setError(errorMessage(e))).finally(() => setLoading(false)); }, []);
  const open = (service: Service | null) => {
    setEditing(service); setFormError(''); form.current?.reset();
    for (const key of ['nombre_servicio', 'descripcion', 'precio', 'duracion_minutos'] as const) {
      const input = form.current?.elements.namedItem(key) as HTMLInputElement;
      if (input) input.value = service ? String(service[key] ?? '') : '';
    }
    dialog.current?.showModal();
  };
  const change = async (service: Service, remove = false) => {
    if (remove && !window.confirm('¿Retirar este servicio? Se desactivará y se conservará el historial de reservas.')) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const updated = await professionalApi(`/servicios/${service.id}`, remove ? 'DELETE' : 'PUT', remove ? undefined : { activo: !service.activo });
      setItems(current => current.map(item => item.id === service.id ? remove ? { ...item, activo: false } : updated : item));
      setMessage(remove ? 'Servicio retirado. Su historial se conserva.' : service.activo ? 'Servicio desactivado.' : 'Servicio activado.');
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return <article id="servicios-profesional" className="pro-panel pro-services">
    <div className="pro-panel-header"><h2>Mis servicios</h2><button id="open-service-modal" disabled={busy} onClick={() => open(null)}>+ Agregar servicio</button></div>
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="workplace-message is-error">{error} <button onClick={() => load().then(() => setError('')).catch(e => setError(errorMessage(e)))}>Reintentar</button></p>}
    <div id="professional-services" className="pro-service-list">
      {loading ? <p>Cargando servicios...</p> : !items.length ? <p>Aún no tienes servicios registrados.</p> : items.map(service => <article className="pro-service-item" key={service.id}>
        <div><strong>{service.nombre_servicio}</strong><small>{service.descripcion || 'Sin descripción'}</small><small>{service.activo ? 'Activo' : 'Inactivo'}</small></div>
        <b>{price(service.precio)}</b><em>{service.duracion_minutos} min</em>
        <div className="professional-inline-actions"><button disabled={busy} onClick={() => open(service)}>Editar</button><button disabled={busy} onClick={() => void change(service)}>{service.activo ? 'Desactivar' : 'Activar'}</button><button disabled={busy || !service.activo} onClick={() => void change(service, true)}>Retirar</button></div>
      </article>)}
    </div>
    <dialog id="service-modal" className="service-modal" aria-labelledby="service-modal-title" ref={dialog} onCancel={event => { if (busy) event.preventDefault(); }}>
      <form id="service-form" className="service-form" ref={form} onSubmit={async event => {
        event.preventDefault(); if (busy) return; setBusy(true); setFormError('');
        const values = new FormData(event.currentTarget);
        const payload = { nombre_servicio: String(values.get('nombre_servicio')).trim(), descripcion: String(values.get('descripcion')).trim(), precio: Number(values.get('precio')), duracion_minutos: Number(values.get('duracion_minutos')) };
        try {
          const saved = await professionalApi(`/servicios${editing ? '/' + editing.id : ''}`, editing ? 'PUT' : 'POST', payload);
          setItems(current => editing ? current.map(item => item.id === editing.id ? saved : item) : [...current, saved]);
          dialog.current?.close(); setMessage(editing ? 'Servicio actualizado.' : 'Servicio creado.'); setError('');
        } catch (e) { setFormError(errorMessage(e)); } finally { setBusy(false); }
      }}>
        <div className="service-form-header"><h2 id="service-modal-title">{editing ? 'Editar servicio' : 'Agregar servicio'}</h2><button type="button" aria-label="Cerrar" disabled={busy} onClick={() => dialog.current?.close()}>×</button></div>
        <label>Nombre del servicio<input name="nombre_servicio" maxLength={80} required /></label>
        <label>Descripción<textarea name="descripcion" maxLength={300} rows={3} /></label>
        <div className="service-form-row"><label>Precio (CLP)<input type="number" name="precio" min={1000} max={50000} step={1} required /></label><label>Duración (minutos)<input type="number" name="duracion_minutos" min={10} max={60} step={1} required /></label></div>
        {formError && <p role="alert" className="service-form-message is-error">{formError}</p>}
        <div className="service-form-actions"><button type="button" disabled={busy} onClick={() => dialog.current?.close()}>Cancelar</button><button className="service-save-button" disabled={busy}>{busy ? 'Guardando...' : 'Guardar servicio'}</button></div>
      </form>
    </dialog>
  </article>;
}
