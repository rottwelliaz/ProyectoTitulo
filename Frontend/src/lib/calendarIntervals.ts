export interface CalendarSettings { startTime: string; endTime: string; blockMinutes: number }
export const BLOCK_OPTIONS = [30, 45, 60];
export const parseTime = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
export const formatSlotTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
export function buildSlotTimes(settings: CalendarSettings) {
  const times: number[] = [];
  if (!BLOCK_OPTIONS.includes(settings.blockMinutes)) return times;
  for (let time = parseTime(settings.startTime); time + settings.blockMinutes <= parseTime(settings.endTime); time += settings.blockMinutes) times.push(time);
  return times;
}
export const slotEndMinute = (time: number, settings: CalendarSettings) => time + settings.blockMinutes;

export type IntervalStatus = 'available' | 'booking' | 'break' | 'unconfigured';
export interface AgendaInterval { start: number; end: number; status: IntervalStatus }
// Draft edits refer to real intervals, rather than a row index or start key.
// Changing row size cannot expand, round or lose a previous edit.
export function applyInterval(intervals: AgendaInterval[], change: AgendaInterval): AgendaInterval[] {
  const parts = intervals.flatMap(part => part.start >= change.end || part.end <= change.start ? [part] : [
    ...(part.start < change.start ? [{ ...part, end: change.start }] : []),
    ...(part.end > change.end ? [{ ...part, start: change.end }] : []),
  ]);
  if (change.status !== 'unconfigured') parts.push(change);
  const merged: AgendaInterval[] = [];
  for (const part of parts.sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && last.end === part.start && last.status === part.status) last.end = part.end;
    else merged.push({ ...part });
  }
  return merged;
}
export const clipIntervals = (intervals: AgendaInterval[], start: number, end: number) => intervals
  .filter(part => part.start < end && part.end > start)
  .map(part => ({ ...part, start: Math.max(start, part.start), end: Math.min(end, part.end) }));
export const sameIntervals = (first: AgendaInterval[], second: AgendaInterval[]) => first.length === second.length
  && first.every((part, index) => part.start === second[index].start && part.end === second[index].end && part.status === second[index].status);
export function intervalStatus(intervals: AgendaInterval[], start: number, end: number): IntervalStatus {
  const parts = clipIntervals(intervals, start, end);
  return parts.find(part => part.status === 'break')?.status ?? parts.find(part => part.status === 'booking')?.status
    ?? (parts.some(part => part.status === 'available') ? 'available' : 'unconfigured');
}
