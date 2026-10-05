// Consolidated history of one beneficiary across this organization's programs.
import { all, get } from '@/services/db';
import type {
  AssessmentResult, AssessmentTool, Beneficiary, Certificate, Evidence, Expert, ExpertAssignment, MaturityAssessment, MaturityFramework,
  Program, ProgramAction, ProgramApplication, ProgramCohort, ProgramEnrollment, ProgramOutcome, ProgramProject, ProgramStage,
  ProgramStageRecord, ProgramTeam, ProgramTeamMember, Session, SessionParticipant,
} from '@/types/db';
import { allIn, byId, safe } from '../dataUtils';

export interface B360 {
  ben: Beneficiary;
  enrollments: ProgramEnrollment[];
  applications: ProgramApplication[];
  programs: Map<string, Program>;
  cohorts: Map<string, ProgramCohort>;
  stages: ProgramStage[];
  stageRecords: ProgramStageRecord[];
  maturity: MaturityAssessment[];
  frameworks: Map<string, MaturityFramework>;
  results: AssessmentResult[];
  tools: Map<string, AssessmentTool>;
  assignments: ExpertAssignment[];
  experts: Map<string, Expert>;
  participations: SessionParticipant[];
  sessions: Map<string, Session>;
  memberships: ProgramTeamMember[];
  teams: Map<string, ProgramTeam>;
  projects: ProgramProject[];
  outcomes: ProgramOutcome[];
  evidence: Evidence[];
  certificates: Certificate[];
  actions: ProgramAction[];
}

export async function loadB360(orgId: string, id: string): Promise<B360> {
  const ben = await get<Beneficiary>('beneficiaries', id);
  const org: [string, 'eq', string] = ['organization_id', 'eq', orgId];
  const mine = (extra: [string, 'eq', string][] = []) => ({ filters: [org, ['beneficiary_id', 'eq', id] as [string, 'eq', string], ...extra] });
  const [enrollments, applications, stageRecords, maturity, results, assignments, participations, memberships, outcomes, evidence, certificates, actions] = await Promise.all([
    safe(all<ProgramEnrollment>('program_enrollments', { ...mine(), order: { column: 'enrolled_at', ascending: false } })),
    safe(all<ProgramApplication>('program_applications', { ...mine(), order: { column: 'applied_at', ascending: false } })),
    safe(all<ProgramStageRecord>('program_stage_records', { ...mine(), order: { column: 'created_at', ascending: false } })),
    safe(all<MaturityAssessment>('maturity_assessments', { ...mine(), order: { column: 'assessed_at', ascending: true } })),
    safe(all<AssessmentResult>('assessment_results', { ...mine(), order: { column: 'assessed_at', ascending: false } })),
    safe(all<ExpertAssignment>('expert_assignments', { ...mine() })),
    safe(all<SessionParticipant>('session_participants', { ...mine() })),
    safe(all<ProgramTeamMember>('program_team_members', { ...mine() })),
    safe(all<ProgramOutcome>('program_outcomes', { ...mine() })),
    safe(all<Evidence>('evidence', { ...mine() })),
    safe(all<Certificate>('certificates', { ...mine() })),
    safe(all<ProgramAction>('program_actions', { ...mine() })),
  ]);
  const teamIds = memberships.map((m) => m.team_id);
  const [teams, teamProjects, ownProjects, sessions] = await Promise.all([
    safe(allIn<ProgramTeam>('program_teams', 'id', teamIds)),
    safe(allIn<ProgramProject>('program_projects', 'team_id', teamIds)),
    safe(all<ProgramProject>('program_projects', { ...mine() })),
    safe(allIn<Session>('sessions', 'id', participations.map((p) => p.session_id), { order: { column: 'starts_at', ascending: false } })),
  ]);
  const programIds = [...enrollments.map((e) => e.program_id), ...applications.map((a) => a.program_id), ...sessions.map((s) => s.program_id),
    ...assignments.map((a) => a.program_id), ...results.map((r) => r.program_id), ...maturity.map((m) => m.program_id)];
  const [programs, cohorts, stages, frameworks, tools, experts] = await Promise.all([
    safe(allIn<Program>('programs', 'id', programIds)),
    safe(allIn<ProgramCohort>('program_cohorts', 'id', enrollments.map((e) => e.cohort_id))),
    safe(allIn<ProgramStage>('program_stages', 'program_id', enrollments.map((e) => e.program_id), { order: { column: 'stage_order', ascending: true } })),
    safe(allIn<MaturityFramework>('maturity_frameworks', 'id', maturity.map((m) => m.framework_id))),
    safe(allIn<AssessmentTool>('assessment_tools', 'id', results.map((r) => r.tool_id))),
    safe(allIn<Expert>('experts', 'id', [...assignments.map((a) => a.expert_id), ...sessions.map((s) => s.expert_id)])),
  ]);
  const projMap = new Map<string, ProgramProject>();
  for (const p of [...ownProjects, ...teamProjects]) projMap.set(p.id, p);
  return {
    ben, enrollments, applications, programs: byId(programs), cohorts: byId(cohorts), stages, stageRecords, maturity, frameworks: byId(frameworks),
    results, tools: byId(tools), assignments, experts: byId(experts), participations, sessions: byId(sessions), memberships, teams: byId(teams),
    projects: [...projMap.values()], outcomes, evidence, certificates, actions,
  };
}

/** Attendance figures over sessions that have already started and were not cancelled. */
export function attendanceStats(d: B360, now = Date.now()) {
  const rows = d.participations.map((p) => ({ p, s: d.sessions.get(p.session_id) }))
    .filter((x): x is { p: SessionParticipant; s: Session } => !!x.s && new Date(x.s.starts_at).getTime() <= now && !['cancelled', 'rescheduled'].includes(x.s.status));
  const recorded = rows.filter((x) => x.p.attendance_status !== 'unknown');
  const attended = recorded.filter((x) => ['present', 'late'].includes(x.p.attendance_status));
  const absent = recorded.filter((x) => x.p.attendance_status === 'absent');
  return {
    past: rows.length, recorded: recorded.length, attended: attended.length, absent: absent.length,
    rate: recorded.length ? Math.round((attended.length / recorded.length) * 100) : null,
    unrecorded: rows.length - recorded.length,
  };
}

export const programName = (d: B360, id: string | null | undefined, pick: (ar: string | null | undefined, en: string | null | undefined) => string) => {
  if (!id) return '—';
  const p = d.programs.get(id);
  return p ? pick(p.name, p.name_en) : '—';
};
