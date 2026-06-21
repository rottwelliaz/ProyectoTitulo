import { useEffect } from 'react';
import { SLOT_LABELS, type SlotStatus } from './CalendarSlot';

interface EditSlotModalProps {
  dateLabel: string;
  hourLabel: string;
  status: SlotStatus;
  onClose: () => void;
  onChange: (status: SlotStatus) => void;
}

const STATUS_OPTIONS = Object.keys(SLOT_LABELS) as SlotStatus[];

export default function EditSlotModal({
  dateLabel,
  hourLabel,
  status,
  onClose,
  onChange,
}: EditSlotModalProps) {
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div className="slot-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="slot-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="slot-modal-title"
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
              className={`slot-status-option is-${option}${status === option ? ' is-selected' : ''}`}
              onClick={() => onChange(option)}
            >
              <i aria-hidden="true" />
              {SLOT_LABELS[option]}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
