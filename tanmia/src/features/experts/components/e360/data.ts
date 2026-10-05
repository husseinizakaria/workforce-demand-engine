import { all, get } from '@/services/db';
import type { Contract, Expert, ExpertAssignment, ExpertAvailability, Program, ProgramStageRecord, Session, SessionParticipant } from '@/types/db';
import { allIn, byId, safe } from '@/features/beneficiaries/components/dataUtils';

export type ParticipantLite = Pick<SessionParticipant, 'session_id' | 'attendance_status' | 'feedback_rating'>;
export interface E360 {
  expert: Expert;
  assignments: ExpertAssignment[];
  programs: Map<string, Program>;
  sessions: Session[];
  participants: ParticipantLite[];
  availability: ExpertAvailability[];
  contracts: Contract[];
  records: ProgramStageRecord[];
}

export async function loadE360(orgId: string, id: string): Promise<E360> {
  const expert = await get<Expert>('experts', id);
  const f = { filters: [['organization_id', 'eq', orgId], ['expert_id', 'eq', id]] as [string, 'eq', string][] };
  const [assignments, sessions, availability, contracts, records] = await Promise.all([
    safe(all<ExpertAssignment>('expert_assignments', f)),
    safe(all<Session>('sessions', { ...f, order: { column: 'starts_at', ascending: false } }, 5000)),
    safe(all<ExpertAvailability>('expert_availability', { ...f, order: { column: 'created_at', ascending: true } })),
    safe(all<Contract>('contracts', f)),
    safe(all<ProgramStageRecord>('program_stage_records', f)),
  ]);
  const [programs, participants] = await Promise.all([
    safe(allIn<Program>('programs', 'id', [...assignments.map((a) => a.program_id), ...sessions.map((s) => s.program_id), ...contracts.map((c) => c.program_id)])),
    safe(allIn<ParticipantLite>('session_participants', 'session_id', sessions.filter((s) => s.status === 'completed').map((s) => s.id), { select: 'session_id,attendance_status,feedback_rating' })),
  ]);
  return { expert, assignments, programs: byId(programs), sessions, participants, availability, contracts, records };
}

export const hoursOf = (s: Pick<Session, 'starts_at' | 'ends_at'>) => (new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 3600000;
