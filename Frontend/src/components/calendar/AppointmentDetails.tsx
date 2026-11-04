import { useEffect, useRef, useState } from 'react';
import { businessTime, formatInstant } from '../../lib/businessTime';
import { professionalApi, reservationLabels, errorMessage } from '../../lib/professionalApi';
import { confirmAction, notifyError, notifySuccess } from '../../lib/notifications';

export interface CalendarAppointment {
  id: string; inicio: string; fin: string | null; estado: string;
  cliente?: { nombre: string } | null;
  servicio?: { nombre_servicio: string } | null;
}

export default function AppointmentDetails({ appointment, onClose }: { appointment: CalendarAppointment; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); if (trigger?.isConnected) trigger.focus(); };
  }, []);
  const canCancel = ['pendiente', 'confirmada'].includes(appointment.estado) && +new Date(appointment.inicio) > Date.now();
  return <dialog ref={dialog} className="slot-modal-backdrop" aria-labelledby="appointment-detail-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <section className="slot-modal appointment-details">
      <div className="slot-modal-header"><h3 id="appointment-detail-title">Detalle de la cita</h3><button type="button" disabled={busy} aria-label="Cerrar detalle" onClick={onClose}>×</button></div>
      <dl>
        <dt>Cliente</dt><dd>{appointment.cliente?.nombre || 'Cliente sin información'}</dd>
        <dt>Servicio</dt><dd>{appointment.servicio?.nombre_servicio || 'Servicio sin información'}</dd>
        <dt>Fecha</dt><dd>{formatInstant(appointment.inicio, { day: 'numeric', month: 'long', year: 'numeric' })}</dd>
        <dt>Horario</dt><dd>{businessTime(appointment.inicio)}–{appointment.fin ? businessTime(appointment.fin) : 'Duración por verificar'}</dd>
        <dt>Estado</dt><dd>{reservationLabels[appointment.estado] || appointment.estado}</dd>
      </dl>
      {canCancel && <button type="button" disabled={busy} onClick={async () => {
        if (submitting.current) return;
        submitting.current = true; setBusy(true);
        try {
          if (!await confirmAction('¿Estás seguro de que deseas cancelar la reserva de este cliente?', 'Sí, cancelar cita', true, { titleText: '¿Cancelar esta cita?', cancelButtonText: 'Volver' })) return;
          await professionalApi(`/citas/${appointment.id}/estado`, 'PATCH', { estado: 'cancelada' });
          window.dispatchEvent(new Event('professional-calendar-updated'));
          onClose(); void notifySuccess('Cita cancelada correctamente.');
        } catch (error) { void notifyError(errorMessage(error)); }
        finally { submitting.current = false; setBusy(false); }
      }}>{busy ? 'Procesando...' : 'Cancelar cita'}</button>}
    </section>
  </dialog>;
}
