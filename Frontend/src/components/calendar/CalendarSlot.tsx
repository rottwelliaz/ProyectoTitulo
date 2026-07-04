export type SlotStatus = 'available' | 'booking' | 'reserved' | 'break';

export const SLOT_LABELS: Record<SlotStatus, string> = {
  available: 'Disponible',
  booking: 'Reserva',
  reserved: 'Reservado',
  break: 'Descanso',
};

interface CalendarSlotProps {
  dateLabel: string;
  hour: number;
  status: SlotStatus;
  onClick: () => void;
  disabled?: boolean;
  detail?: string;
}

export default function CalendarSlot({ dateLabel, hour, status, onClick, disabled = false, detail }: CalendarSlotProps) {
  const hourLabel = `${String(hour).padStart(2, '0')}:00`;

  return (
    <button
      type="button"
      className={`barber-slot is-${status}`}
      onClick={onClick}
      disabled={disabled}
      title={detail}
      aria-label={`${dateLabel}, ${hourLabel}: ${SLOT_LABELS[status]}${detail ? `, ${detail}` : ''}${disabled ? '' : '. Cambiar estado.'}`}
    >
      <span>{SLOT_LABELS[status]}</span>
      {detail && <small>{detail}</small>}
    </button>
  );
}
