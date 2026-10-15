import { useEffect, useState } from 'react';
import { professionalApi, errorMessage } from '../lib/professionalApi';
import { safePhotoUrl } from '../lib/profilePhoto';

export default function ProfessionalProfileEditor() {
  const [bio, setBio] = useState(''), [specialties, setSpecialties] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false), [photo, setPhoto] = useState('');
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const load = async () => {
    setLoading(true); setError('');
    try {
      const user = await professionalApi('/auth/me');
      if (!user.perfilBarbero) throw new Error('No tienes un perfil profesional registrado.');
      setBio(user.perfilBarbero.biografia ?? ''); setSpecialties((user.perfilBarbero.especialidades ?? []).join(', '));
      setPhoto(safePhotoUrl(user.foto_perfil) || safePhotoUrl(user.perfilBarbero.foto_perfil) || ''); setReady(true);
    } catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const notify = () => window.dispatchEvent(new Event('professional-profile-updated'));
  return <article id="editar-perfil-profesional" className="pro-panel professional-editor">
    <div className="pro-panel-header"><h2>Editar perfil profesional</h2><a href="/perfil">Datos personales</a></div>
    <form className="workplace-form" onSubmit={async event => {
      event.preventDefault(); if (!ready || busy) return; setBusy(true); setError(''); setMessage('');
      try {
        const data = await professionalApi('/profesional/perfil', 'PUT', { biografia: bio.trim(), especialidades: specialties.split(',').map(s => s.trim()).filter(Boolean) });
        setBio(data.biografia ?? ''); setSpecialties(data.especialidades.join(', ')); setMessage('Perfil profesional guardado.'); notify();
      } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
    }}>
      <label>Biografía<textarea aria-label="Biografía" rows={4} maxLength={2000} value={bio} onChange={e => setBio(e.target.value)} disabled={loading || busy} /></label>
      <label>Especialidades<input maxLength={731} value={specialties} onChange={e => setSpecialties(e.target.value)} disabled={loading || busy} /><small>Separadas por comas. Máximo 12 especialidades.</small></label>
      <button className="workplace-primary" disabled={!ready || loading || busy}>Guardar perfil profesional</button>
    </form>
    {photo && <img className="professional-photo-preview" src={photo} alt="Fotografía profesional actual" />}
    <label className="professional-photo-label">Fotografía profesional<input id="professional-photo-input" type="file" accept="image/png,image/jpeg,image/webp" disabled={!ready || busy || loading} onChange={async event => {
      const input = event.currentTarget, file = input.files?.[0]; if (!file) return;
      setMessage(''); setError('');
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 4 * 1024 * 1024) { setError('Selecciona una imagen PNG, JPEG o WebP de hasta 4 MB.'); input.value = ''; return; }
      setBusy(true);
      try {
        const image = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('No se pudo leer la fotografía.')); reader.readAsDataURL(file); });
        const data = await professionalApi('/auth/me/photo', 'PUT', { foto_perfil: image });
        const photo = safePhotoUrl(data.foto_perfil); if (!photo) throw new Error('El servidor no devolvió una fotografía válida.');
        setPhoto(photo); window.dispatchEvent(new CustomEvent('profile-photo-change', { detail: photo })); notify(); setMessage('Fotografía guardada.');
      } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); input.value = ''; }
    }} /></label>
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="workplace-message is-error">{error} {!ready && <button onClick={() => void load()}>Reintentar perfil</button>}</p>}
  </article>;
}
