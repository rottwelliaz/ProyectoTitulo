export type SlotStatus = 'available' | 'booking' | 'reserved' | 'break' | 'unconfigured';

export const SLOT_LABELS: Record<SlotStatus, string> = {
  available: 'Disponible',
  booking: 'Bloqueado',
  reserved: 'Reservado',
  break: 'Descanso',
  unconfigured: 'Sin configurar',
};

interface CalendarSlotProps {
  dateLabel: string;
  timeLabel: string;
  status: SlotStatus;
  onClick: () => void;
  disabled?: boolean;
  detail?: string;
  pending?: boolean;
  reservedSegments?: { start: number; end: number }[];
  underlyingStatus?: SlotStatus;
  intervalSegments?: { start: number; end: number; status: SlotStatus }[];
  summaryTime?: string;
  reservationSummary?: { client: string; service: string; time: string; continuation?: boolean };
}

export default function CalendarSlot({ dateLabel, timeLabel, status, onClick, disabled = false, detail, pending = false, reservedSegments, underlyingStatus = 'unconfigured', intervalSegments = [], summaryTime = timeLabel, reservationSummary }: CalendarSlotProps) {
  const partial = reservedSegments?.some(segment => segment.start > 0 || segment.end < 100);
  const colors: Record<SlotStatus, string> = { available: '#16803a', booking: '#1261d8', reserved: '#ef4444', break: '#f2c230', unconfigured: '#586474' };
  const segments = [...(reservedSegments || []).map(segment => ({ ...segment, status: 'reserved' as SlotStatus })), ...intervalSegments];
  const partialAvailable = !reservedSegments?.length && status === 'available' && intervalSegments.reduce((sum, part) => sum + part.end - part.start, 0) < 100;
  const description = [
    `${dateLabel}, ${timeLabel}: ${SLOT_LABELS[status]}`,
    partial ? 'Ocupación parcial' : partialAvailable ? 'Disponibilidad parcial' : '',
    detail, pending ? 'Cambio pendiente de guardar' : '',
  ].filter(Boolean).join(' · ');
  return (
    <button
      type="button"
      className={`barber-slot is-${status} underlying-${underlyingStatus}${pending ? ' is-pending' : ''}`}
      style={segments.length ? { backgroundColor: colors.unconfigured, backgroundImage: segments.map(segment => `linear-gradient(to bottom, transparent ${segment.start}%, ${colors[segment.status]} ${segment.start}%, ${colors[segment.status]} ${segment.end}%, transparent ${segment.end}%)`).join(', ') } : undefined}
      onClick={onClick}
      disabled={disabled}
      title={description}
      aria-label={`${description}${disabled ? '' : '. Cambiar estado.'}`}
    >
      {reservationSummary ? <>
        <span className="slot-reservation-heading"><span>{reservationSummary.continuation ? 'Continuación de reserva' : SLOT_LABELS[status]}</span>{!reservationSummary.continuation && <span className="slot-reservation-client">{reservationSummary.client}</span>}</span>
        {!reservationSummary.continuation && <small className="slot-reservation-service">{reservationSummary.service}</small>}
        <small className="slot-time">{reservationSummary.time}</small>
      </> : <>
        <span>{SLOT_LABELS[status]}</span>
        <small className="slot-time">{summaryTime}</small>
      </>}
    </button>
  );
}
