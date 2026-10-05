// Scheduling engine: conflict detection (mirror of public.check_session_conflicts
// for bulk previews) and recurring slot generation. Saudi Arabia time
// (Asia/Riyadh) is UTC+3 with no daylight saving, so a fixed offset is exact.
import type { AvailabilityLike, ExpertLike, ParticipantLike, SessionLike } from './types.ts';

export const RIYADH_OFFSET_MIN = 180;

export interface Candidate {
  starts_at: string; ends_at: string; expert_id?: string | null; beneficiary_ids?: string[];
  location?: string | null; delivery_mode?: string; exclude_session_id?: string | null;
  program_start?: string | null; program_end?: string | null;
}
export type ConflictType = 'invalid_range' | 'expert_overlap' | 'expert_blocked' | 'outside_availability' | 'expert_weekly_load'
  | 'beneficiary_overlap' | 'location_overlap' | 'outside_program_dates' | 'batch_overlap';
export interface Conflict { type: ConflictType; severity: 'high' | 'medium' | 'low'; session_id?: string; code?: string; title?: string; beneficiary_id?: string; detail?: string }

const overlaps = (a1: number, a2: number, b1: number, b2: number) => a1 < b2 && b1 < a2;
const ms = (iso: string) => new Date(iso).getTime();
const ACTIVE = new Set(['scheduled', 'draft']);

/** Convert a UTC instant to Riyadh wall-clock parts. */
export function riyadhParts(iso: string): { date: string; weekday: number; minutes: number } {
  const d = new Date(ms(iso) + RIYADH_OFFSET_MIN * 60000);
  return { date: d.toISOString().slice(0, 10), weekday: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
/** Convert Riyadh wall-clock date + "HH:MM" to a UTC ISO string. */
export function riyadhToUtc(date: string, time: string): string {
  const [h, m] = time.split(':').map(Number);
  const base = Date.parse(date + 'T00:00:00Z') + (h * 60 + m - RIYADH_OFFSET_MIN) * 60000;
  return new Date(base).toISOString();
}
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

export function detectConflicts(
  c: Candidate,
  ctx: { sessions: SessionLike[]; participants: ParticipantLike[]; availability: AvailabilityLike[]; experts: ExpertLike[] },
): Conflict[] {
  const out: Conflict[] = [];
  const s = ms(c.starts_at); const e = ms(c.ends_at);
  if (!(e > s)) return [{ type: 'invalid_range', severity: 'high' }];
  const others = ctx.sessions.filter((x) => ACTIVE.has(x.status) && x.id !== c.exclude_session_id);

  if (c.expert_id) {
    for (const x of others) if (x.expert_id === c.expert_id && overlaps(s, e, ms(x.starts_at), ms(x.ends_at)))
      out.push({ type: 'expert_overlap', severity: 'high', session_id: x.id, code: x.code, title: x.title });
    const av = ctx.availability.filter((a) => a.expert_id === c.expert_id);
    for (const b of av.filter((a) => a.kind === 'blocked')) if (b.starts_at && b.ends_at && overlaps(s, e, ms(b.starts_at), ms(b.ends_at)))
      out.push({ type: 'expert_blocked', severity: 'high' });
    const weekly = av.filter((a) => a.kind === 'weekly');
    if (weekly.length) {
      const ps = riyadhParts(c.starts_at); const pe = riyadhParts(c.ends_at);
      const fits = ps.date === pe.date && weekly.some((w) => w.weekday === ps.weekday && w.start_time && w.end_time
        && ps.minutes >= toMin(w.start_time) && pe.minutes <= toMin(w.end_time));
      if (!fits) out.push({ type: 'outside_availability', severity: 'medium' });
    }
    const ex = ctx.experts.find((x) => x.id === c.expert_id);
    if (ex?.max_weekly_hours) {
      const weekStart = startOfRiyadhWeek(c.starts_at);
      const hours = others.filter((x) => x.expert_id === c.expert_id && startOfRiyadhWeek(x.starts_at) === weekStart)
        .reduce((a, x) => a + (ms(x.ends_at) - ms(x.starts_at)) / 3600000, 0) + (e - s) / 3600000;
      if (hours > ex.max_weekly_hours) out.push({ type: 'expert_weekly_load', severity: 'medium', detail: `${Math.round(hours * 10) / 10}/${ex.max_weekly_hours}` });
    }
  }
  if (c.beneficiary_ids?.length) {
    const set = new Set(c.beneficiary_ids);
    const bySession = new Map(others.map((x) => [x.id, x]));
    for (const p of ctx.participants) {
      const x = bySession.get(p.session_id);
      if (x && set.has(p.beneficiary_id) && overlaps(s, e, ms(x.starts_at), ms(x.ends_at)))
        out.push({ type: 'beneficiary_overlap', severity: 'medium', session_id: x.id, code: x.code, title: x.title, beneficiary_id: p.beneficiary_id });
    }
  }
  if (c.location?.trim() && c.delivery_mode !== 'online') {
    const loc = c.location.trim().toLowerCase();
    for (const x of others) if (x.location?.trim().toLowerCase() === loc && x.delivery_mode !== 'online' && overlaps(s, e, ms(x.starts_at), ms(x.ends_at)))
      out.push({ type: 'location_overlap', severity: 'medium', session_id: x.id, code: x.code, title: x.title });
  }
  const startDate = riyadhParts(c.starts_at).date; const endDate = riyadhParts(c.ends_at).date;
  if ((c.program_start && startDate < c.program_start) || (c.program_end && endDate > c.program_end))
    out.push({ type: 'outside_program_dates', severity: 'low' });
  return out;
}

/** Saudi work-week start (Sunday), mirroring check_session_conflicts. */
export function startOfRiyadhWeek(iso: string): string {
  const d = new Date(ms(iso) + RIYADH_OFFSET_MIN * 60000);
  const day = d.getUTCDay(); // 0 = Sunday
  const sunday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return sunday.toISOString().slice(0, 10);
}

export interface RecurrenceInput {
  start_date: string; end_date?: string | null; count?: number | null; weekdays: number[]; // 0=Sunday
  start_time: string; duration_minutes: number; skip_dates?: string[];
}
export interface Slot { starts_at: string; ends_at: string; local_date: string }

export function generateSlots(r: RecurrenceInput, hardLimit = 200): Slot[] {
  const out: Slot[] = [];
  if (!r.weekdays.length || r.duration_minutes <= 0) return out;
  const skip = new Set(r.skip_dates ?? []);
  let cursor = Date.parse(r.start_date + 'T00:00:00Z');
  const end = r.end_date ? Date.parse(r.end_date + 'T00:00:00Z') : Number.POSITIVE_INFINITY;
  const max = Math.min(r.count ?? hardLimit, hardLimit);
  let guard = 0;
  while (out.length < max && cursor <= end && guard < 3660) {
    const d = new Date(cursor);
    const date = d.toISOString().slice(0, 10);
    if (r.weekdays.includes(d.getUTCDay()) && !skip.has(date)) {
      const starts_at = riyadhToUtc(date, r.start_time);
      out.push({ starts_at, ends_at: new Date(ms(starts_at) + r.duration_minutes * 60000).toISOString(), local_date: date });
    }
    cursor += 86400000; guard++;
  }
  return out;
}

/** Check a batch of candidate slots against existing sessions AND each other. */
export function detectBatchConflicts(
  slots: Candidate[],
  ctx: { sessions: SessionLike[]; participants: ParticipantLike[]; availability: AvailabilityLike[]; experts: ExpertLike[] },
): Conflict[][] {
  return slots.map((c, i) => {
    const res = detectConflicts(c, ctx);
    slots.forEach((o, j) => {
      if (j === i) return;
      const sameExpert = c.expert_id && o.expert_id === c.expert_id;
      const sharedBen = (c.beneficiary_ids ?? []).some((b) => (o.beneficiary_ids ?? []).includes(b));
      if ((sameExpert || sharedBen) && overlaps(ms(c.starts_at), ms(c.ends_at), ms(o.starts_at), ms(o.ends_at)))
        res.push({ type: 'batch_overlap', severity: 'high', detail: `#${j + 1}` });
    });
    return res;
  });
}
