// Minimal row shapes consumed by the engine. Full database rows are
// structurally compatible (extra columns are ignored).

export interface L10n { ar: string; en: string }

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type InsightKind =
  | 'missing_config' | 'inconsistency' | 'blocker' | 'evidence_gap' | 'kpi_anomaly' | 'risk'
  | 'recommendation' | 'interpretation' | 'conflict' | 'overlap' | 'gap' | 'data_quality';
export type HealthArea = 'setup' | 'delivery' | 'measurement' | 'evidence' | 'finance' | 'risk' | 'people';

export interface Insight {
  rule_code: string;
  kind: InsightKind;
  severity: Severity;
  area: HealthArea;
  title: L10n;
  rationale: L10n;
  recommended_action: L10n;
  source_data: Record<string, unknown>;
  fingerprint: string;
  link?: string; // relative program workspace tab, e.g. 'journey'
}

export interface ProgramLike {
  id: string; organization_id: string; code: string; name: string; track_code: string; status: string;
  start_date: string | null; end_date: string | null; target_beneficiaries: number | null; budget_total: number | null;
  sponsor_partner_id?: string | null;
}
export interface StageLike {
  id: string; stage_key: string; name_ar: string; name_en: string | null; stage_order: number; depends_on: string[];
  status: string; progress: number; planned_start: string | null; planned_end: string | null; actual_start: string | null;
  actual_end: string | null; requires_approval: boolean; approval_status: string; required_evidence: string[];
  record_types: string[]; blocker_note: string | null; updated_at?: string;
}
export interface CohortLike { id: string; name: string; capacity: number | null; start_date: string | null; end_date: string | null; status: string }
export interface EnrollmentLike { id: string; beneficiary_id: string; cohort_id: string | null; status: string; progress: number }
export interface ApplicationLike { id: string; beneficiary_id: string; status: string; screening_score: number | null }
export interface BeneficiaryLike { id: string; code: string; full_name: string; email?: string | null; mobile?: string | null; national_id?: string | null; city?: string | null; gender?: string | null }
export interface SessionLike {
  id: string; code: string; title: string; program_id: string | null; expert_id: string | null; starts_at: string; ends_at: string;
  status: string; session_type: string; location: string | null; delivery_mode: string; stage_key?: string | null; cohort_id?: string | null;
}
export interface ParticipantLike { session_id: string; beneficiary_id: string; attendance_status: string }
export interface ExpertLike {
  id: string; code: string; full_name: string; roles: string[]; expertise: string[]; sectors: string[]; languages: string[];
  city: string | null; delivery_modes: string[]; rating: number | null; max_weekly_hours: number | null; conflicts: string[]; status: string;
}
export interface AssignmentLike {
  id: string; expert_id: string; program_id: string; role: string; status: string; planned_hours: number | null;
  delivered_hours: number; performance_rating: number | null; beneficiary_id?: string | null; team_id?: string | null;
}
export interface AvailabilityLike { expert_id: string; kind: 'weekly' | 'blocked'; weekday: number | null; start_time: string | null; end_time: string | null; starts_at: string | null; ends_at: string | null }
export interface IndicatorLike {
  id: string; code: string; name: string; name_en?: string | null; indicator_type: 'operational' | 'output' | 'outcome' | 'impact';
  chain_level: string; outcome_term?: string | null; unit: string; baseline_value: number | null; target_value: number | null;
  direction: 'increase' | 'decrease' | 'maintain'; data_source: string | null; measurement_points: string[]; evidence_required: boolean; status: string;
}
export interface MeasurementLike {
  id: string; indicator_id: string; measurement_point: string | null; value: number; comparison_value: number | null;
  sample_size: number | null; data_quality: string; evidence_id: string | null; measured_at: string;
}
export interface EvidenceLike {
  id: string; code: string; title: string; evidence_type: string; verification_status: string; stage_key: string | null;
  indicator_id: string | null; beneficiary_id: string | null; session_id: string | null; outcome_id: string | null; output_id: string | null;
  file_path: string | null; source_url: string | null; created_at: string;
}
export interface OutputLike { id: string; code: string; description: string; target: number | null; actual: number; due_date: string | null; status: string; unit: string }
export interface OutcomeLike { id: string; code: string; description: string; baseline: number | null; target: number | null; actual: number | null; status: string; term: string; unit: string; measurement_point: string | null }
export interface BudgetLike { category: string; planned_amount: number; committed_amount: number; actual_amount: number }
export interface RiskLike { id: string; code: string; title: string; kind: string; severity: number; status: string; mitigation: string | null; due_date: string | null }
export interface ActionLike { id: string; code: string; title: string; status: string; due_date: string | null; priority: string }
export interface ImpactFrameworkLike {
  id: string; problem_statement: string | null; target_population: string | null; baseline_summary: string | null;
  theory_of_change: Partial<Record<TocKey, string[]>>; intended_impact: string | null;
  evaluation_design: 'monitoring_only' | 'pre_post' | 'comparison_group' | 'quasi_experimental' | 'rct';
  attribution_approach: string; status: string;
}
export type TocKey = 'inputs' | 'activities' | 'outputs' | 'outcomes_short' | 'outcomes_medium' | 'outcomes_long' | 'impact' | 'assumptions' | 'external_factors';
export interface MaturityDimension { key: string; name_ar: string; name_en: string; weight?: number; levels?: Record<string, { ar: string; en: string }> }
export interface MaturityFrameworkLike { id: string; name: string; scale_min: number; scale_max: number; weighted: boolean; dimensions: MaturityDimension[] }
export interface MaturityAssessmentLike {
  id?: string; framework_id: string; beneficiary_id: string | null; team_id: string | null; cohort_id?: string | null;
  measurement_point: string; dimension_scores: Record<string, number>; overall_score: number | null; data_quality: string;
}
export interface ResultLike {
  id: string; tool_id: string; beneficiary_id: string | null; measurement_point: string; normalized_score: number | null;
  total_score: number | null; classification_label: string | null; passed: boolean | null; status: string; source: string;
  dimension_scores: Record<string, number>;
}
export interface StageRecordLike { id: string; stage_key: string; record_type: string; status: string; score: number | null; payload: Record<string, unknown>; beneficiary_id: string | null; team_id: string | null; expert_id: string | null }

export interface ProgramBundle {
  program: ProgramLike;
  stages: StageLike[];
  cohorts: CohortLike[];
  enrollments: EnrollmentLike[];
  applications: ApplicationLike[];
  beneficiaries: BeneficiaryLike[];
  sessions: SessionLike[];
  participants: ParticipantLike[];
  experts: ExpertLike[];
  assignments: AssignmentLike[];
  indicators: IndicatorLike[];
  measurements: MeasurementLike[];
  evidence: EvidenceLike[];
  outputs: OutputLike[];
  outcomes: OutcomeLike[];
  budgets: BudgetLike[];
  risks: RiskLike[];
  actions: ActionLike[];
  impactFramework: ImpactFrameworkLike | null;
  maturityFrameworks: MaturityFrameworkLike[];
  maturityAssessments: MaturityAssessmentLike[];
  results: ResultLike[];
  stageRecords: StageRecordLike[];
  approvalsPending: { id: string; entity_type: string; entity_id: string | null; created_at: string }[];
  sponsorName?: string | null;
}

export const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 25, high: 12, medium: 6, low: 2, info: 0 };
export const SEVERITY_ORDER: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

export function l(ar: string, en: string): L10n { return { ar, en }; }

export function roundTo(x: number, digits: number): number {
  const f = 10 ** digits;
  return (Math.sign(x) * Math.round(Math.abs(x) * f + Number.EPSILON)) / f;
}

export function daysBetween(a: string | Date, b: string | Date): number {
  const da = typeof a === 'string' ? new Date(a) : a;
  const db = typeof b === 'string' ? new Date(b) : b;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

export function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
