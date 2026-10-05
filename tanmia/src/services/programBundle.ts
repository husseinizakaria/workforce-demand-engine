// Loads everything the analysis engine needs for one program (RLS-scoped).
import type { ProgramBundle } from '@engine';
import { all, get, maybe } from './db';
import type {
  AssessmentResult, Beneficiary, Evidence, Expert, ExpertAssignment, ImpactFramework, Indicator, IndicatorMeasurement, MaturityAssessment,
  MaturityFramework, Partner, Program, ProgramAction, ProgramApplication, ProgramBudget, ProgramCohort, ProgramEnrollment, ProgramOutcome,
  ProgramOutput, ProgramStage, ProgramStageRecord, RiskIssue, Session, SessionParticipant, ApprovalRequest,
} from '@/types/db';

export interface FullProgramBundle extends ProgramBundle {
  program: Program;
  stages: ProgramStage[];
  cohorts: ProgramCohort[];
  enrollments: ProgramEnrollment[];
  applications: ProgramApplication[];
  beneficiaries: Beneficiary[];
  sessions: Session[];
  participants: SessionParticipant[];
  experts: Expert[];
  assignments: ExpertAssignment[];
  indicators: Indicator[];
  measurements: IndicatorMeasurement[];
  evidence: Evidence[];
  outputs: ProgramOutput[];
  outcomes: ProgramOutcome[];
  budgets: ProgramBudget[];
  risks: RiskIssue[];
  actions: ProgramAction[];
  impactFramework: ImpactFramework | null;
  maturityFrameworks: MaturityFramework[];
  maturityAssessments: MaturityAssessment[];
  results: AssessmentResult[];
  stageRecords: ProgramStageRecord[];
}

const byProgram = (id: string) => ({ filters: [['program_id', 'eq', id]] as [string, 'eq', string][] });

/** Tables the user cannot read (RLS / disabled modules) simply come back empty. */
async function safe<T>(p: Promise<T[]>): Promise<T[]> {
  try { return await p; } catch { return []; }
}

export async function loadProgramBundle(programId: string): Promise<FullProgramBundle> {
  const program = await get<Program>('programs', programId);
  const [stages, cohorts, enrollments, applications, sessions, assignments, indicators, measurements, evidence, outputs, outcomes,
    budgets, risks, actions, frameworks, maturity, results, stageRecords, approvals] = await Promise.all([
    safe(all<ProgramStage>('program_stages', { ...byProgram(programId), order: { column: 'stage_order', ascending: true } })),
    safe(all<ProgramCohort>('program_cohorts', byProgram(programId))),
    safe(all<ProgramEnrollment>('program_enrollments', { ...byProgram(programId), order: { column: 'enrolled_at' } })),
    safe(all<ProgramApplication>('program_applications', { ...byProgram(programId), order: { column: 'applied_at' } })),
    safe(all<Session>('sessions', { ...byProgram(programId), order: { column: 'starts_at', ascending: true } })),
    safe(all<ExpertAssignment>('expert_assignments', byProgram(programId))),
    safe(all<Indicator>('indicators', byProgram(programId))),
    safe(all<IndicatorMeasurement>('indicator_measurements', { ...byProgram(programId), order: { column: 'measured_at', ascending: true } })),
    safe(all<Evidence>('evidence', byProgram(programId))),
    safe(all<ProgramOutput>('program_outputs', byProgram(programId))),
    safe(all<ProgramOutcome>('program_outcomes', byProgram(programId))),
    safe(all<ProgramBudget>('program_budgets', byProgram(programId))),
    safe(all<RiskIssue>('risks_issues', byProgram(programId))),
    safe(all<ProgramAction>('program_actions', byProgram(programId))),
    safe(all<MaturityFramework>('maturity_frameworks', byProgram(programId))),
    safe(all<MaturityAssessment>('maturity_assessments', byProgram(programId))),
    safe(all<AssessmentResult>('assessment_results', byProgram(programId))),
    safe(all<ProgramStageRecord>('program_stage_records', byProgram(programId))),
    safe(all<ApprovalRequest>('approval_requests', { filters: [['program_id', 'eq', programId], ['status', 'eq', 'pending']] })),
  ]);
  const sessionIds = sessions.map((s) => s.id);
  const participants = sessionIds.length
    ? await safe(all<SessionParticipant>('session_participants', { filters: [['session_id', 'in', sessionIds]], order: { column: 'created_at' } }))
    : [];
  const benIds = [...new Set([...enrollments.map((e) => e.beneficiary_id), ...applications.map((a) => a.beneficiary_id)])];
  const beneficiaries = benIds.length ? await safe(all<Beneficiary>('beneficiaries', { filters: [['id', 'in', benIds]], order: { column: 'full_name', ascending: true } })) : [];
  const expertIds = [...new Set([...assignments.map((a) => a.expert_id), ...sessions.map((s) => s.expert_id).filter(Boolean) as string[]])];
  const experts = expertIds.length ? await safe(all<Expert>('experts', { filters: [['id', 'in', expertIds]], order: { column: 'full_name', ascending: true } })) : [];
  let impactFramework: ImpactFramework | null = null;
  try { impactFramework = await maybe<ImpactFramework>('impact_frameworks', [['program_id', 'eq', programId]]); } catch { impactFramework = null; }
  let sponsorName: string | null = null;
  if (program.sponsor_partner_id) {
    try { sponsorName = (await get<Partner>('partners', program.sponsor_partner_id)).name; } catch { sponsorName = null; }
  }
  return {
    program, stages, cohorts, enrollments, applications, beneficiaries, sessions, participants, experts, assignments, indicators, measurements,
    evidence, outputs, outcomes, budgets, risks, actions, impactFramework, maturityFrameworks: frameworks, maturityAssessments: maturity,
    results, stageRecords, approvalsPending: approvals.map((a) => ({ id: a.id, entity_type: a.entity_type, entity_id: a.entity_id, created_at: a.created_at })),
    sponsorName,
  };
}
