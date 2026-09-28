export type SlotStatus = 'available' | 'booking' | 'reserved' | 'break';

export const SLOT_LABELS: Record<SlotStatus, string> = {
  available: 'Disponible',
  booking: 'Reserva',
  reserved: 'Reservado',
  break: 'Descanso',
};

interface CalendarSlotProps {
  dateLabel: string;
  timeLabel: string;
  status: SlotStatus;
  onClick: () => void;
  disabled?: boolean;
  detail?: string;
}

export default function CalendarSlot({ dateLabel, timeLabel, status, onClick, disabled = false, detail }: CalendarSlotProps) {
  return (
    <button
      type="button"
      className={`barber-slot is-${status}`}
      onClick={onClick}
      disabled={disabled}
      title={detail}
      aria-label={`${dateLabel}, ${timeLabel}: ${SLOT_LABELS[status]}${detail ? `, ${detail}` : ''}${disabled ? '' : '. Cambiar estado.'}`}
    >
      <span>{SLOT_LABELS[status]}</span>
      {detail && <small>{detail}</small>}
    </button>
  );
}
