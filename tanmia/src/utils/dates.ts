// Saudi Arabia (Asia/Riyadh) is UTC+3 all year (no DST). Dates entered in the UI
// are interpreted as Riyadh wall-clock time and stored as UTC instants.
const OFFSET_MS = 3 * 60 * 60 * 1000;

/** Today's date in Riyadh as YYYY-MM-DD. */
export function todayISO(): string {
  return new Date(Date.now() + OFFSET_MS).toISOString().slice(0, 10);
}
export function addDaysISO(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** UTC ISO instant → value for <input type="datetime-local"> in Riyadh time. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(new Date(iso).getTime() + OFFSET_MS).toISOString().slice(0, 16);
}
/** <input type="datetime-local"> value (Riyadh) → UTC ISO instant. */
export function fromLocalInput(v: string): string {
  return new Date(new Date(v + ':00Z').getTime() - OFFSET_MS).toISOString();
}
export function minutesBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}
export function isPast(iso: string): boolean { return new Date(iso).getTime() < Date.now(); }
export function riyadhDate(iso: string): string { return new Date(new Date(iso).getTime() + OFFSET_MS).toISOString().slice(0, 10); }
export function startOfWeekISO(date: string): string {
  // Saudi work week starts on Sunday.
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
