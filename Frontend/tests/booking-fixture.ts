import { addDays, businessDate, businessTime, slotInstant, startOfWeek } from '../src/lib/businessTime';
import type { BookingCalendarCell } from '../src/components/calendar/BookingCalendar';

export function bookingAvailability(params: URLSearchParams, slots: { id: string; fecha_hora: string }[]) {
  const start = params.get('fecha') || startOfWeek(businessDate());
  const dias = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const citas = slots.filter(slot => dias.includes(businessDate(slot.fecha_hora)));
  const horas = [...new Set(citas.length ? citas.map(slot => businessTime(slot.fecha_hora)) : ['09:00'])].sort();
  const horarios: BookingCalendarCell[] = dias.flatMap(fecha => horas.map(hora => {
    const slot = citas.find(slot => businessDate(slot.fecha_hora) === fecha && businessTime(slot.fecha_hora) === hora);
    const minutes = Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3));
    return { fecha, hora, fecha_hora: slot?.fecha_hora || slotInstant(fecha, minutes).toISOString(),
      estado: slot ? 'available' : 'unavailable', ...(slot ? { citaId: slot.id } : { motivo: 'sin_publicar' }) } as BookingCalendarCell;
  }));
  return { citas, servicios: [], calendario: { dias, horas, horarios, zonaHoraria: 'America/Santiago', consultadoEn: new Date().toISOString() } };
}
