import { useEffect, useRef } from 'react';
import { SLOT_LABELS, type SlotStatus } from './CalendarSlot';

interface EditSlotModalProps {
  dateLabel: string;
  hourLabel: string;
  status: SlotStatus;
  onClose: () => void;
  onChange: (status: SlotStatus) => void;
}

const STATUS_OPTIONS: SlotStatus[] = ['available', 'booking', 'break'];

export default function EditSlotModal({
  dateLabel,
  hourLabel,
  status,
  onClose,
  onChange,
}: EditSlotModalProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => { element?.close(); if (trigger?.isConnected) trigger.focus(); };
  }, []);

  return (
    <dialog ref={dialog} className="slot-modal-backdrop" aria-labelledby="slot-modal-title"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        className="slot-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="slot-modal-header">
          <div>
            <h3 id="slot-modal-title">Editar bloque</h3>
            <p>{dateLabel} · {hourLabel}</p>
          </div>
          <button type="button" className="slot-modal-close" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        <div className="slot-status-options">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={status === option}
              className={`slot-status-option is-${option}${status === option ? ' is-selected' : ''}`}
              onClick={() => onChange(option)}
            >
              <i aria-hidden="true" />
              {SLOT_LABELS[option]}
            </button>
          ))}
        </div>
      </section>
    </dialog>
  );
}
