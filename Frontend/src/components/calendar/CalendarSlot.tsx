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
}

export default function CalendarSlot({ dateLabel, hour, status, onClick }: CalendarSlotProps) {
  const hourLabel = `${String(hour).padStart(2, '0')}:00`;

  return (
    <button
      type="button"
      className={`barber-slot is-${status}`}
      onClick={onClick}
      aria-label={`${dateLabel}, ${hourLabel}: ${SLOT_LABELS[status]}. Cambiar estado.`}
    >
      <span>{SLOT_LABELS[status]}</span>
    </button>
  );
}
