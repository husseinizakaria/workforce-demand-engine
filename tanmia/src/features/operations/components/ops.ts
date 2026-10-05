// Operations data helpers: reference lists, range queries, notifications and
// bilingual conflict descriptions (types returned by check_session_conflicts).
import { all, type Filter } from '@/services/db';
import { callFunction } from '@/services/functions';
import { errorOf } from '@/services/errors';
import type { Expert, ExpertAvailability, Program, ProgramCohort, ProgramTeam, Session, SessionParticipant } from '@/types/db';
import { allIn, byId, safe } from '@/features/beneficiaries/components/dataUtils';

export interface OpsRefs {
  programs: Program[]; experts: Expert[]; cohorts: ProgramCohort[]; teams: ProgramTeam[];
  programMap: Map<string, Program>; expertMap: Map<string, Expert>; cohortMap: Map<string, ProgramCohort>; teamMap: Map<string, ProgramTeam>;
}

export async function loadRefs(orgId: string): Promise<OpsRefs> {
  const org: Filter = ['organization_id', 'eq', orgId];
  const [programs, experts, cohorts, teams] = await Promise.all([
    safe(all<Program>('programs', { filters: [org], order: { column: 'name', ascending: true } }, 3000)),
    safe(all<Expert>('experts', { filters: [org], order: { column: 'full_name', ascending: true } }, 5000)),
    safe(all<ProgramCohort>('program_cohorts', { filters: [org], order: { column: 'name', ascending: true } }, 5000)),
    safe(all<ProgramTeam>('program_teams', { filters: [org], order: { column: 'name', ascending: true } }, 10000)),
  ]);
  return { programs, experts, cohorts, teams, programMap: byId(programs), expertMap: byId(experts), cohortMap: byId(cohorts), teamMap: byId(teams) };
}

/** Sessions overlapping [fromIso, toIso). */
export async function loadSessionsRange(orgId: string, fromIso: string, toIso: string, extra: Filter[] = [], cap = 5000): Promise<Session[]> {
  return all<Session>('sessions', {
    filters: [['organization_id', 'eq', orgId], ['starts_at', 'lt', toIso], ['ends_at', 'gt', fromIso], ...extra],
    order: { column: 'starts_at', ascending: true },
  }, cap);
}

export async function loadParticipants(sessionIds: string[]): Promise<SessionParticipant[]> {
  return allIn<SessionParticipant>('session_participants', 'session_id', sessionIds);
}

export async function loadAvailability(orgId: string, expertIds: string[]): Promise<ExpertAvailability[]> {
  if (!expertIds.length) return [];
  return safe(allIn<ExpertAvailability>('expert_availability', 'expert_id', expertIds, { filters: [['organization_id', 'eq', orgId]] }));
}

export type NotifyResult = { ok: true; created: number } | { ok: false; unavailable: boolean; message_ar: string; message_en: string };
export async function notify(orgId: string, eventType: 'session_scheduled' | 'session_cancelled' | 'session_rescheduled', sessionId: string, payload?: Record<string, unknown>): Promise<NotifyResult> {
  try {
    const r = await callFunction<{ created?: number }>('schedule-notification', { organization_id: orgId, event_type: eventType, entity_type: 'session', entity_id: sessionId, ...(payload ? { payload } : {}) });
    return { ok: true, created: Number(r?.created ?? 0) };
  } catch (e) {
    const err = errorOf(e);
    return { ok: false, unavailable: err.code === 'function_unavailable', message_ar: err.message_ar, message_en: err.message_en };
  }
}

export interface RpcConflict {
  type: string; severity: 'high' | 'medium' | 'low'; session_id?: string; code?: string; title?: string; starts_at?: string; ends_at?: string;
  beneficiary_id?: string; note?: string | null; hours?: number; max?: number; start_date?: string | null; end_date?: string | null; detail?: string;
}

export const CONFLICT_LABEL: Record<string, [string, string]> = {
  invalid_range: ['نطاق زمني غير صالح', 'Invalid time range'],
  expert_overlap: ['تداخل مع جلسة أخرى للخبير', 'Expert double-booked'],
  expert_blocked: ['الخبير غير متاح (فترة محجوبة)', 'Expert unavailable (blocked period)'],
  outside_availability: ['خارج أوقات توفر الخبير', 'Outside the expert’s availability'],
  expert_weekly_load: ['تجاوز الحد الأسبوعي لساعات الخبير', 'Exceeds the expert’s weekly hours'],
  beneficiary_overlap: ['تداخل مع جلسة أخرى لمستفيد', 'Participant double-booked'],
  location_overlap: ['المكان محجوز لجلسة أخرى', 'Location already booked'],
  outside_program_dates: ['خارج تواريخ البرنامج', 'Outside program dates'],
  batch_overlap: ['تداخل مع جلسة أخرى في نفس الدفعة', 'Overlaps another session in this batch'],
};

export function conflictDetail(c: RpcConflict, fmt: { tr: (a: string, e: string) => string; fmtDateTime: (d: string) => string; fmtDate: (d: string) => string }, benName?: (id: string) => string): string {
  const { tr, fmtDateTime, fmtDate } = fmt;
  const when = c.starts_at ? ` (${fmtDateTime(c.starts_at)})` : '';
  switch (c.type) {
    case 'invalid_range': return tr('وقت النهاية يجب أن يكون بعد وقت البداية.', 'End time must be after the start time.');
    case 'expert_overlap': return tr(`الخبير لديه جلسة ${c.code ?? ''} «${c.title ?? ''}»${when} في نفس الوقت.`, `The expert already has session ${c.code ?? ''} “${c.title ?? ''}”${when} at this time.`);
    case 'expert_blocked': return tr(`فترة محجوبة${c.note ? `: ${c.note}` : ''}${c.starts_at ? ` من ${fmtDateTime(c.starts_at)}` : ''}${c.ends_at ? ` إلى ${fmtDateTime(c.ends_at)}` : ''}.`,
      `Blocked period${c.note ? `: ${c.note}` : ''}${c.starts_at ? ` from ${fmtDateTime(c.starts_at)}` : ''}${c.ends_at ? ` to ${fmtDateTime(c.ends_at)}` : ''}.`);
    case 'outside_availability': return tr('الموعد لا يقع ضمن أي فترة توفر أسبوعية مسجلة للخبير (توقيت الرياض).', 'The time is not within any of the expert’s weekly availability slots (Riyadh time).');
    case 'expert_weekly_load': {
      const v = c.hours !== undefined && c.max !== undefined ? `${Math.round(Number(c.hours) * 10) / 10}/${c.max}` : c.detail ?? '';
      return tr(`مجموع ساعات الخبير في هذا الأسبوع سيصبح ${v} ساعة.`, `The expert’s total for this week would be ${v} hours.`);
    }
    case 'beneficiary_overlap': return tr(`${c.beneficiary_id && benName ? benName(c.beneficiary_id) : 'مستفيد'} مسجل في ${c.code ?? ''} «${c.title ?? ''}»${when}.`,
      `${c.beneficiary_id && benName ? benName(c.beneficiary_id) : 'A participant'} is registered in ${c.code ?? ''} “${c.title ?? ''}”${when}.`);
    case 'location_overlap': return tr(`الجلسة ${c.code ?? ''} «${c.title ?? ''}»${when} في نفس المكان.`, `Session ${c.code ?? ''} “${c.title ?? ''}”${when} uses the same location.`);
    case 'outside_program_dates': return tr(`البرنامج من ${c.start_date ? fmtDate(c.start_date) : '—'} إلى ${c.end_date ? fmtDate(c.end_date) : '—'}.`, `The program runs ${c.start_date ? fmtDate(c.start_date) : '—'} to ${c.end_date ? fmtDate(c.end_date) : '—'}.`);
    case 'batch_overlap': return tr(`يتداخل مع الصف ${c.detail ?? ''} لنفس الخبير أو المشاركين.`, `Overlaps row ${c.detail ?? ''} for the same expert or participants.`);
    default: return c.detail ?? '';
  }
}

export const sessionHours = (s: Pick<Session, 'starts_at' | 'ends_at'>) => (new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 3600000;
export const isOpenStatus = (s: string) => s === 'scheduled' || s === 'draft';
