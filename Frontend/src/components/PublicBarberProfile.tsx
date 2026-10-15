import { useEffect, useState } from 'react';
import { API_URL, getSession, type SessionUser } from '../lib/session';
import { safePhotoUrl } from '../lib/profilePhoto';
import { businessDate, businessTime } from '../lib/businessTime';

interface Service { id: string; nombre_servicio: string; descripcion: string | null; precio: number; duracion_minutos: number }
interface Profile {
  id: number; biografia: string | null; especialidades: string[]; foto_perfil: string | null;
  usuario: { nombre: string; foto_perfil: string | null };
  lugarTrabajo: { nombre_barberia: string | null; direccion: string | null } | null;
  servicios: Service[];
}
interface Slot { id: string; fecha_hora: string; disponibleHasta: string }
const money = (amount: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);

export default function PublicBarberProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [day, setDay] = useState(businessDate());
  const [service, setService] = useState('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [availability, setAvailability] = useState('');
  const [loadingSlots, setLoadingSlots] = useState(false);

  useEffect(() => {
    void getSession().then(setUser).catch(() => setUser(null));
    const id = Number(new URLSearchParams(location.search).get('barbero'));
    if (!Number.isSafeInteger(id) || id <= 0) { setError('El enlace del perfil no es válido.'); return; }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    setError('');
    void (async () => {
      try {
        const response = await fetch(`${API_URL}/usuarios/barberos/${id}/perfil`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'No se pudo cargar el perfil.');
        setProfile(data); setService(data.servicios[0]?.id || '');
        document.title = `${data.usuario.nombre} - Conce Barber Club`;
      } catch (reason) {
        setError(controller.signal.aborted ? 'La consulta tardó demasiado. Inténtalo nuevamente.' : reason instanceof Error ? reason.message : 'No se pudo cargar el perfil.');
      } finally { window.clearTimeout(timeout); }
    })();
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [attempt]);

  useEffect(() => {
    setSlots([]); setAvailability('');
    setLoadingSlots(false);
    if (!profile || !service || !day || !profile.lugarTrabajo) return;
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    setLoadingSlots(true);
    const query = new URLSearchParams({ fecha: day, servicioId: service });
    void (async () => {
      try {
        const response = await fetch(`${API_URL}/usuarios/barberos/${profile.id}/disponibilidad?${query}`, { signal: controller.signal, cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'No se pudo consultar la disponibilidad.');
        if (active) setSlots(data.citas);
      } catch (reason) {
        if (active) setAvailability(controller.signal.aborted ? 'La consulta tardó demasiado. Vuelve a consultar.' : reason instanceof Error ? reason.message : 'No se pudo consultar la disponibilidad.');
      } finally { window.clearTimeout(timeout); if (active) setLoadingSlots(false); }
    })();
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [profile, service, day, availabilityAttempt]);

  if (error) return <section className="public-panel" role="alert"><h1>Perfil no disponible</h1><p>{error}</p><button onClick={() => setAttempt(value => value + 1)}>Reintentar</button></section>;
  if (!profile) return <p role="status">Cargando perfil profesional...</p>;
  const photo = safePhotoUrl(profile.foto_perfil || profile.usuario.foto_perfil);
  const booking = `/booking?barbero=${profile.id}#servicios`;
  const destination = user ? booking : `/login?redirect=${encodeURIComponent(booking)}`;
  const canBook = profile.servicios.length > 0 && !!profile.lugarTrabajo;
  return <>
    <section className="public-panel public-identity">
      {photo ? <img className="public-photo" src={photo} alt={`Fotografía de ${profile.usuario.nombre}`} referrerPolicy="no-referrer" /> : <div className="public-photo public-initial" aria-label="Sin fotografía">{profile.usuario.nombre.slice(0, 1)}</div>}
      <div><p className="public-eyebrow">Perfil profesional</p><h1>{profile.usuario.nombre}</h1>
        <p>{profile.lugarTrabajo?.nombre_barberia || 'Lugar de trabajo por informar'}</p>
        {profile.lugarTrabajo?.direccion && <p>{profile.lugarTrabajo.direccion}</p>}
        {canBook && (!user || user.rol === 'cliente') && <a className="public-book" href={destination}>Reservar una hora</a>}
        {user && user.rol !== 'cliente' && <p>Las reservas se realizan con una cuenta de cliente.</p>}
        {!canBook && <p>Este profesional todavía no tiene reservas habilitadas.</p>}
      </div>
    </section>
    <section className="public-panel"><h2>Sobre mí</h2><p className="public-bio">{profile.biografia || 'Este profesional aún no ha agregado su biografía.'}</p>
      <h2>Especialidades</h2>{profile.especialidades.length ? <ul className="public-tags">{profile.especialidades.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>Especialidades por informar.</p>}
    </section>
    <section className="public-panel"><h2>Servicios activos</h2>
      {profile.servicios.length ? <ul className="public-services">{profile.servicios.map(item => <li key={item.id}>
        <div><h3>{item.nombre_servicio}</h3>{item.descripcion && <p>{item.descripcion}</p>}</div>
        <strong>{money(item.precio)} <span>· {item.duracion_minutos} min</span></strong>
      </li>)}</ul> : <p>No hay servicios activos por el momento.</p>}
    </section>
    <section className="public-panel"><h2>Disponibilidad</h2><p>Horarios en Concepción (America/Santiago). La disponibilidad se confirma al reservar.</p>
      {canBook ? <>
        <div className="public-filters">
          <label>Servicio<select aria-label="Servicio" value={service} onChange={event => setService(event.target.value)}>{profile.servicios.map(item => <option key={item.id} value={item.id}>{item.nombre_servicio} · {item.duracion_minutos} min</option>)}</select></label>
          <label>Fecha<input type="date" value={day} min={businessDate()} onChange={event => setDay(event.target.value)} /></label>
          <button onClick={() => setAvailabilityAttempt(value => value + 1)}>Actualizar disponibilidad</button>
        </div>
        <div aria-live="polite">
          {loadingSlots ? <p>Consultando horarios...</p> : availability ? <p role="alert">{availability}</p> : !day ? <p>Selecciona una fecha.</p> : slots.length ? <ul className="public-tags">{slots.map(slot => <li key={slot.id}>{businessTime(slot.fecha_hora)}</li>)}</ul> : <p>No hay horarios disponibles para este servicio en la fecha seleccionada.</p>}
        </div>
      </> : <p>La disponibilidad se publicará cuando el profesional habilite sus reservas.</p>}
    </section>
  </>;
}
