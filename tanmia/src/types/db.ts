// Row types mirroring supabase/migrations (canonical schema). Keep in sync when
// migrations change. Timestamps are ISO strings, dates are 'YYYY-MM-DD'.
import type { ClassBand, MaturityDimension, QuestionOption, TocKey } from '@engine';

export type UUID = string;
export type Json = Record<string, unknown>;
export type MeasurementPointKey = 'T0' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5';

export type ModuleKey = 'programs' | 'beneficiaries' | 'experts' | 'vendors' | 'partners' | 'operations' | 'assessments'
  | 'evidence' | 'outcomes' | 'impact' | 'templates' | 'reports' | 'governance' | 'notifications';
export type PermissionModule = ModuleKey | 'users';
export type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'assign' | 'export' | 'configure' | 'verify';
export type PermissionCode = `${PermissionModule}.${PermissionAction}`;

export interface Organization {
  id: UUID; code: string; name: string; name_en: string | null; org_type: string | null; sector: string | null; city: string | null;
  country: string; timezone: string; default_locale: 'ar' | 'en'; status: 'active' | 'suspended' | 'archived'; contact_email: string | null;
  settings: Json; created_by: UUID | null; created_at: string; updated_at: string;
}
export interface PlatformUser { user_id: UUID; is_platform_super_admin: boolean; active: boolean; created_at: string }
export interface Profile {
  id: UUID; full_name: string | null; email: string | null; phone: string | null; job_title: string | null;
  preferred_locale: 'ar' | 'en'; status: 'active' | 'inactive' | 'invited'; last_login_at: string | null; created_at: string;
}
export interface OrganizationMember { organization_id: UUID; user_id: UUID; active: boolean; title: string | null; invited_by: UUID | null; joined_at: string }
export interface Permission { id: UUID; code: PermissionCode; module: PermissionModule; action: PermissionAction; name_ar: string; name_en: string }
export interface Role { id: UUID; organization_id: UUID | null; code: string; name_ar: string; name_en: string; description: string | null; is_system: boolean; active: boolean; created_at: string }
export interface RolePermission { role_id: UUID; permission_id: UUID }
export interface UserRole { organization_id: UUID; user_id: UUID; role_id: UUID; created_at: string }
export interface OrganizationModule { organization_id: UUID; module_key: ModuleKey; enabled: boolean; updated_at: string }
export interface AuditLog {
  id: number; organization_id: UUID | null; actor_user_id: UUID | null; scope: 'platform' | 'organization'; action: string;
  entity_type: string | null; entity_id: string | null; summary: string | null; old_data: Json | null; new_data: Json | null;
  source: 'database' | 'edge_function' | 'rpc'; created_at: string;
}

export interface Beneficiary {
  id: UUID; organization_id: UUID; code: string; user_id: UUID | null; full_name: string; full_name_en: string | null; national_id: string | null;
  gender: 'male' | 'female' | null; birth_date: string | null; mobile: string | null; email: string | null; city: string | null; region: string | null;
  education_level: string | null; specialization: string | null;
  employment_status: 'student' | 'unemployed' | 'employed' | 'self_employed' | 'entrepreneur' | 'other' | null;
  organization_name: string | null; tags: string[]; consent_given: boolean; consent_at: string | null;
  status: 'active' | 'inactive' | 'archived'; notes: string | null; created_at: string; updated_at: string;
}
export type ExpertRole = 'trainer' | 'mentor' | 'consultant' | 'coach' | 'assessor' | 'judge';
export interface Expert {
  id: UUID; organization_id: UUID; code: string; user_id: UUID | null; full_name: string; full_name_en: string | null; email: string | null;
  mobile: string | null; roles: ExpertRole[]; expertise: string[]; sectors: string[]; languages: string[]; city: string | null;
  delivery_modes: string[]; bio: string | null; qualifications: { title: string; issuer?: string; year?: number }[]; hourly_rate: number | null;
  currency: string; max_weekly_hours: number | null; rating: number | null; conflicts: string[]; status: 'active' | 'inactive' | 'blocked';
  created_at: string; updated_at: string;
}
export interface ExpertAvailability {
  id: UUID; organization_id: UUID; expert_id: UUID; kind: 'weekly' | 'blocked'; weekday: number | null; start_time: string | null;
  end_time: string | null; starts_at: string | null; ends_at: string | null; note: string | null; created_at: string;
}
export interface Vendor {
  id: UUID; organization_id: UUID; code: string; name: string; category: string | null; services: string[]; contact_name: string | null;
  email: string | null; mobile: string | null; cr_number: string | null; vat_number: string | null; city: string | null; rating: number | null;
  status: 'active' | 'inactive' | 'blocked'; notes: string | null; created_at: string; updated_at: string;
}
export interface Partner {
  id: UUID; organization_id: UUID; code: string; name: string;
  partner_type: 'funder' | 'government' | 'implementing' | 'academic' | 'private' | 'nonprofit' | 'employer' | 'other' | null;
  contact_name: string | null; email: string | null; mobile: string | null; agreement_start: string | null; agreement_end: string | null;
  status: 'prospect' | 'active' | 'inactive'; notes: string | null; created_at: string; updated_at: string;
}
export interface UserInvitation {
  id: UUID; organization_id: UUID; email: string; full_name: string | null; job_title: string | null;
  status: 'pending' | 'accepted' | 'revoked' | 'expired'; expires_at: string; link_beneficiary_id: UUID | null; link_expert_id: UUID | null;
  invited_by: UUID | null; accepted_by: UUID | null; accepted_at: string | null; created_at: string;
}

export interface TrackStageTemplate {
  key: string; name_ar: string; name_en: string; description_ar?: string; description_en?: string; order: number;
  depends_on: string[]; required_evidence: string[]; requires_approval: boolean; record_types: string[];
}
export interface ProgramTrackTemplate {
  id: UUID; code: string; name_ar: string; name_en: string; description_ar: string | null; description_en: string | null;
  stages: TrackStageTemplate[]; maturity_dimensions: { key: string; name_ar: string; name_en: string; weight: number }[];
  default_indicators: Json[]; report_sections: string[]; session_types: string[]; version: number; active: boolean; updated_at: string;
}
export type ProgramStatus = 'draft' | 'planning' | 'active' | 'on_hold' | 'completed' | 'closed' | 'cancelled';
export interface Program {
  id: UUID; organization_id: UUID; code: string; name: string; name_en: string | null; track_code: string; description: string | null;
  objectives: string | null; status: ProgramStatus; start_date: string | null; end_date: string | null; target_beneficiaries: number | null;
  budget_total: number | null; currency: string; region: string | null; delivery_mode: 'onsite' | 'online' | 'hybrid' | null;
  manager_user_id: UUID | null; sponsor_partner_id: UUID | null; disabled_tabs: string[]; created_by: UUID | null; created_at: string; updated_at: string;
}
export type StageStatus = 'not_started' | 'in_progress' | 'blocked' | 'completed' | 'skipped';
export interface ProgramStage {
  id: UUID; organization_id: UUID; program_id: UUID; stage_key: string; name_ar: string; name_en: string | null; description: string | null;
  stage_order: number; depends_on: string[]; status: StageStatus; progress: number; planned_start: string | null; planned_end: string | null;
  actual_start: string | null; actual_end: string | null; requires_approval: boolean;
  approval_status: 'not_required' | 'not_requested' | 'pending' | 'approved' | 'rejected'; required_evidence: string[]; record_types: string[];
  blocker_note: string | null; owner_user_id: UUID | null; notes: string | null; created_at: string; updated_at: string;
}
export interface ProgramCohort { id: UUID; organization_id: UUID; program_id: UUID; code: string; name: string; capacity: number | null; start_date: string | null; end_date: string | null; status: 'planned' | 'active' | 'completed' | 'cancelled'; created_at: string }
export type ApplicationStatus = 'submitted' | 'eligible' | 'ineligible' | 'screening' | 'shortlisted' | 'accepted' | 'rejected' | 'waitlisted' | 'withdrawn';
export interface ProgramApplication {
  id: UUID; organization_id: UUID; program_id: UUID; cohort_id: UUID | null; beneficiary_id: UUID; code: string; status: ApplicationStatus;
  eligibility_notes: string | null; screening_score: number | null; decision_note: string | null; answers: Json; applied_at: string;
  decided_at: string | null; decided_by: UUID | null;
}
export interface ProgramEnrollment {
  id: UUID; organization_id: UUID; program_id: UUID; cohort_id: UUID | null; beneficiary_id: UUID;
  status: 'active' | 'completed' | 'graduated' | 'withdrawn' | 'dropped'; current_stage_key: string | null; progress: number;
  enrolled_at: string; completed_at: string | null; exit_reason: string | null;
}
export interface ProgramTeam { id: UUID; organization_id: UUID; program_id: UUID; cohort_id: UUID | null; code: string; name: string; challenge: string | null; project_title: string | null; status: 'forming' | 'active' | 'withdrawn' | 'completed'; created_at: string }
export interface ProgramTeamMember { id: UUID; organization_id: UUID; team_id: UUID; beneficiary_id: UUID; role: 'lead' | 'member' }
export interface ProgramProject {
  id: UUID; organization_id: UUID; program_id: UUID; team_id: UUID | null; beneficiary_id: UUID | null; code: string; title: string;
  description: string | null; stage_key: string | null; status: 'proposed' | 'in_progress' | 'submitted' | 'evaluated' | 'completed' | 'discontinued';
  score: number | null; due_date: string | null; created_at: string;
}
export interface ExpertAssignment {
  id: UUID; organization_id: UUID; program_id: UUID; cohort_id: UUID | null; expert_id: UUID; beneficiary_id: UUID | null; team_id: UUID | null;
  role: ExpertRole; stage_key: string | null; planned_hours: number | null; delivered_hours: number; rate: number | null; starts_on: string | null;
  ends_on: string | null; status: 'proposed' | 'confirmed' | 'active' | 'completed' | 'cancelled'; match_score: number | null;
  match_rationale: Json[]; performance_rating: number | null; feedback: string | null; created_at: string;
}
export interface VendorAssignment {
  id: UUID; organization_id: UUID; program_id: UUID; vendor_id: UUID; service: string; value: number | null; contract_id: UUID | null;
  status: 'planned' | 'contracted' | 'delivering' | 'delivered' | 'cancelled'; due_date: string | null; performance_rating: number | null; notes: string | null; created_at: string;
}
export interface ProgramMilestone {
  id: UUID; organization_id: UUID; program_id: UUID; stage_key: string | null; cohort_id: UUID | null; team_id: UUID | null; beneficiary_id: UUID | null;
  title: string; due_date: string | null; status: 'not_started' | 'in_progress' | 'achieved' | 'missed' | 'cancelled'; progress: number; evidence_required: boolean; created_at: string;
}
export interface ProgramStageRecord {
  id: UUID; organization_id: UUID; program_id: UUID; stage_key: string; record_type: string; title: string; beneficiary_id: UUID | null;
  expert_id: UUID | null; team_id: UUID | null; status: 'open' | 'in_progress' | 'done' | 'cancelled'; score: number | null; due_date: string | null;
  payload: Record<string, unknown>; created_by: UUID | null; created_at: string; updated_at: string;
}
export interface Certificate { id: UUID; organization_id: UUID; program_id: UUID; beneficiary_id: UUID; code: string; title: string; issued_on: string; status: 'issued' | 'revoked'; created_at: string }

export type SessionType = 'training' | 'workshop' | 'mentoring' | 'coaching' | 'consulting' | 'assessment' | 'judging' | 'event' | 'orientation' | 'other';
export interface Session {
  id: UUID; organization_id: UUID; program_id: UUID | null; cohort_id: UUID | null; team_id: UUID | null; expert_id: UUID | null; code: string;
  title: string; session_type: SessionType; stage_key: string | null; starts_at: string; ends_at: string; timezone: string;
  delivery_mode: 'onsite' | 'online' | 'hybrid'; location: string | null; meeting_url: string | null; capacity: number | null;
  status: 'draft' | 'scheduled' | 'completed' | 'cancelled' | 'rescheduled'; topics: string[]; agenda: string | null; summary: string | null;
  recommendations: string | null; cancelled_reason: string | null; rescheduled_from: UUID | null; completed_at: string | null; created_at: string;
}
export type AttendanceStatus = 'unknown' | 'present' | 'late' | 'absent' | 'excused';
export interface SessionParticipant {
  id: UUID; organization_id: UUID; session_id: UUID; beneficiary_id: UUID; invitation_status: 'pending' | 'sent' | 'accepted' | 'declined';
  attendance_status: AttendanceStatus; check_in_at: string | null; check_out_at: string | null; feedback_rating: number | null; notes: string | null;
}
export interface ProgramAction {
  id: UUID; organization_id: UUID; program_id: UUID | null; session_id: UUID | null; beneficiary_id: UUID | null; expert_id: UUID | null;
  stage_key: string | null; code: string; title: string; description: string | null; owner_user_id: UUID | null; owner_name: string | null;
  due_date: string | null; priority: 'low' | 'medium' | 'high' | 'critical'; status: 'open' | 'in_progress' | 'done' | 'cancelled';
  source: 'manual' | 'session' | 'ai' | 'risk' | 'approval' | 'consulting'; completion_note: string | null; completed_at: string | null; created_at: string;
}
export type NotificationChannel = 'in_app' | 'email' | 'sms' | 'whatsapp' | 'calendar';
export interface NotificationRule {
  id: UUID; organization_id: UUID; name: string; event_type: string; audience: string; channels: NotificationChannel[]; offset_minutes: number;
  conditions: Json; subject_template: string | null; body_template: string | null; status: 'active' | 'inactive'; created_at: string;
}
export interface AppNotification {
  id: UUID; organization_id: UUID; user_id: UUID | null; recipient_email: string | null; recipient_phone: string | null; channel: NotificationChannel;
  event_type: string; title: string; body: string | null; link: string | null; entity_type: string | null; entity_id: UUID | null; rule_id: UUID | null;
  status: 'queued' | 'scheduled' | 'sent' | 'failed' | 'skipped' | 'read' | 'cancelled'; scheduled_for: string; sent_at: string | null; read_at: string | null;
  attempts: number; delivery_result: Json; created_at: string;
}

export interface AssessmentTool {
  id: UUID; organization_id: UUID | null; code: string; name: string; name_en: string | null; description: string | null;
  tool_type: 'internal' | 'external'; provider: string | null; subject_type: 'individual' | 'team' | 'expert' | 'program'; track_codes: string[];
  scoring_method: 'weighted_average' | 'average' | 'sum'; scale_min: number; scale_max: number; pass_threshold: number | null;
  classification: ClassBand[]; version: number; parent_tool_id: UUID | null; status: 'draft' | 'active' | 'archived'; created_at: string; updated_at: string;
}
export interface RubricLevel { score: number; label_ar: string; label_en: string; descriptor_ar?: string; descriptor_en?: string }
export interface AssessmentDimension { id: UUID; organization_id: UUID | null; tool_id: UUID; code: string; name: string; name_en: string | null; description: string | null; weight: number; sort_order: number; rubric: RubricLevel[] }
export interface AssessmentQuestion {
  id: UUID; organization_id: UUID | null; tool_id: UUID; dimension_id: UUID | null; code: string; text_ar: string | null; text_en: string | null;
  question_type: 'scale' | 'single_choice' | 'multiple_choice' | 'number' | 'boolean' | 'text'; options: QuestionOption[]; weight: number;
  reverse_scored: boolean; required: boolean; sort_order: number; translation_status: 'none' | 'machine' | 'verified';
}
export interface ExternalAssessmentImport {
  id: UUID; organization_id: UUID; tool_id: UUID; program_id: UUID | null; provider: string | null; file_path: string | null; original_filename: string | null;
  measurement_point: string | null; column_mapping: Json; status: 'uploaded' | 'parsed' | 'imported' | 'partially_imported' | 'failed';
  row_count: number; imported_count: number; unmatched: Json[]; error: string | null; imported_by: UUID | null; created_at: string;
}
export interface AssessmentResult {
  id: UUID; organization_id: UUID; tool_id: UUID; tool_version: number | null; program_id: UUID | null; cohort_id: UUID | null; beneficiary_id: UUID | null;
  team_id: UUID | null; expert_id: UUID | null; assessor_user_id: UUID | null; measurement_point: MeasurementPointKey | 'other';
  source: 'internal' | 'external_import'; import_id: UUID | null; responses: Record<string, unknown>; dimension_scores: Record<string, number>;
  total_score: number | null; normalized_score: number | null; classification_label: string | null; passed: boolean | null;
  interpretation: Json; external_raw: Json | null; status: 'draft' | 'submitted' | 'verified' | 'rejected'; verified_by: UUID | null;
  verified_at: string | null; notes: string | null; assessed_at: string; created_at: string;
}
export type FormFieldType = 'text' | 'long_text' | 'number' | 'date' | 'datetime' | 'single_choice' | 'multiple_choice' | 'rating' | 'scale'
  | 'matrix' | 'file' | 'signature' | 'acknowledgment';
export interface FormField {
  key: string; type: FormFieldType; label_ar: string; label_en?: string; help_ar?: string; help_en?: string; required?: boolean;
  options?: QuestionOption[]; min?: number; max?: number; rows?: { key: string; label_ar: string; label_en?: string }[];
  show_if?: { field: string; op: 'eq' | 'neq' | 'gt' | 'lt' | 'includes' | 'filled'; value?: unknown } | null; scoring?: { weight?: number } | null;
}
export interface FormTemplate {
  id: UUID; organization_id: UUID | null; code: string; title: string; title_en: string | null; description: string | null;
  form_type: 'application' | 'registration' | 'feedback' | 'survey' | 'assessment' | 'stage_form' | 'follow_up' | 'form';
  track_codes: string[]; stage_key: string | null; program_id: UUID | null; schema: { fields: FormField[] }; scoring_enabled: boolean;
  requires_review: boolean; version: number; parent_template_id: UUID | null; status: 'draft' | 'published' | 'archived'; created_at: string; updated_at: string;
}
export interface FormSubmission {
  id: UUID; organization_id: UUID; template_id: UUID; template_version: number | null; program_id: UUID | null; beneficiary_id: UUID | null;
  stage_key: string | null; submitted_by: UUID | null; answers: Record<string, unknown>; score: number | null; signature: Json | null;
  status: 'draft' | 'submitted' | 'reviewed' | 'approved' | 'rejected'; reviewed_by: UUID | null; reviewed_at: string | null; review_note: string | null; submitted_at: string;
}
export interface MaturityFramework {
  id: UUID; organization_id: UUID | null; program_id: UUID | null; code: string; name: string; name_en: string | null; track_code: string | null;
  description: string | null; scale_min: number; scale_max: number; weighted: boolean; dimensions: MaturityDimension[]; version: number;
  status: 'draft' | 'active' | 'archived'; created_at: string;
}
export interface MaturityAssessment {
  id: UUID; organization_id: UUID; framework_id: UUID; program_id: UUID; cohort_id: UUID | null; beneficiary_id: UUID | null; team_id: UUID | null;
  measurement_point: MeasurementPointKey; dimension_scores: Record<string, number>; overall_score: number | null; overall_level: number | null;
  data_quality: 'self_reported' | 'assessor_rated' | 'verified'; evidence_ids: UUID[]; assessed_by: UUID | null; assessed_at: string; notes: string | null;
}

export interface ImpactFramework {
  id: UUID; organization_id: UUID | null; program_id: UUID | null; code: string; name: string; track_code: string | null; problem_statement: string | null;
  target_population: string | null; baseline_summary: string | null; theory_of_change: Partial<Record<TocKey, string[]>>; intended_impact: string | null;
  evaluation_design: 'monitoring_only' | 'pre_post' | 'comparison_group' | 'quasi_experimental' | 'rct';
  attribution_approach: 'observed_change' | 'contribution' | 'attribution'; status: 'draft' | 'approved' | 'archived'; version: number; created_at: string;
}
export type IndicatorType = 'operational' | 'output' | 'outcome' | 'impact';
export interface Indicator {
  id: UUID; organization_id: UUID; program_id: UUID; impact_framework_id: UUID | null; code: string; name: string; name_en: string | null;
  definition: string | null; indicator_type: IndicatorType; chain_level: 'input' | 'activity' | 'output' | 'outcome' | 'impact';
  outcome_term: 'short' | 'medium' | 'long' | null; unit: string; baseline_value: number | null; baseline_date: string | null; target_value: number | null;
  direction: 'increase' | 'decrease' | 'maintain'; data_source: string | null; collection_method: string | null;
  frequency: 'once' | 'monthly' | 'quarterly' | 'per_measurement_point' | 'annual'; measurement_points: string[]; evidence_required: boolean;
  responsible_user_id: UUID | null; disaggregation: string[]; status: 'draft' | 'active' | 'retired'; created_at: string;
}
export interface IndicatorMeasurement {
  id: UUID; organization_id: UUID; indicator_id: UUID; program_id: UUID | null; measurement_point: MeasurementPointKey | 'other' | null;
  period_start: string | null; period_end: string | null; value: number; sample_size: number | null; comparison_value: number | null;
  data_quality: 'estimated' | 'reported' | 'verified'; source: string | null; notes: string | null; evidence_id: UUID | null; measured_at: string; recorded_by: UUID | null;
}
export interface ProgramOutput {
  id: UUID; organization_id: UUID; program_id: UUID; indicator_id: UUID | null; code: string; description: string; unit: string; target: number | null;
  actual: number; due_date: string | null; stage_key: string | null; status: 'planned' | 'in_progress' | 'achieved' | 'partially_achieved' | 'not_achieved'; created_at: string;
}
export interface ProgramOutcome {
  id: UUID; organization_id: UUID; program_id: UUID; indicator_id: UUID | null; beneficiary_id: UUID | null; code: string; description: string;
  scope: 'program' | 'cohort' | 'beneficiary'; term: 'short' | 'medium' | 'long'; unit: string; baseline: number | null; target: number | null;
  actual: number | null; measurement_point: string | null; status: 'not_measured' | 'on_track' | 'at_risk' | 'achieved' | 'not_achieved'; created_at: string;
}
export interface DocumentRow {
  id: UUID; organization_id: UUID; code: string; title: string;
  doc_type: 'plan' | 'contract' | 'agreement' | 'policy' | 'cv' | 'certificate' | 'id' | 'report' | 'minutes' | 'invoice' | 'other';
  program_id: UUID | null; beneficiary_id: UUID | null; expert_id: UUID | null; vendor_id: UUID | null; partner_id: UUID | null;
  file_path: string; file_name: string | null; mime_type: string | null; file_size: number | null; version: number;
  status: 'active' | 'superseded' | 'archived'; uploaded_by: UUID | null; created_at: string;
}
export type EvidenceType = 'document' | 'photo' | 'video' | 'attendance_sheet' | 'certificate' | 'assessment_report' | 'survey_data'
  | 'testimonial' | 'link' | 'dataset' | 'minutes' | 'product' | 'other';
export type VerificationStatus = 'pending' | 'verified' | 'rejected' | 'needs_info';
export interface Evidence {
  id: UUID; organization_id: UUID; code: string; title: string; evidence_type: EvidenceType; description: string | null; file_path: string | null;
  file_name: string | null; mime_type: string | null; file_size: number | null; source_url: string | null; program_id: UUID | null; cohort_id: UUID | null;
  beneficiary_id: UUID | null; expert_id: UUID | null; session_id: UUID | null; assessment_result_id: UUID | null; indicator_id: UUID | null;
  milestone_id: UUID | null; output_id: UUID | null; outcome_id: UUID | null; stage_key: string | null; verification_status: VerificationStatus;
  verified_by: UUID | null; verified_at: string | null; verification_notes: string | null; metadata: Json; collected_at: string | null;
  uploaded_by: UUID | null; created_at: string; updated_at: string;
}
export interface ProgramBudget { id: UUID; organization_id: UUID; program_id: UUID; category: string; planned_amount: number; committed_amount: number; actual_amount: number; currency: string; notes: string | null; created_at: string }
export interface Contract {
  id: UUID; organization_id: UUID; code: string; program_id: UUID | null; vendor_id: UUID | null; expert_id: UUID | null; partner_id: UUID | null;
  title: string; value: number | null; currency: string; start_date: string | null; end_date: string | null;
  status: 'draft' | 'pending_approval' | 'active' | 'completed' | 'terminated'; document_id: UUID | null; created_at: string;
}
export interface RiskIssue {
  id: UUID; organization_id: UUID; program_id: UUID | null; code: string; kind: 'risk' | 'issue'; title: string; description: string | null;
  category: string | null; likelihood: number | null; impact: number | null; severity: number; owner_user_id: UUID | null; mitigation: string | null;
  due_date: string | null; status: 'open' | 'mitigating' | 'escalated' | 'closed'; source: 'manual' | 'ai' | 'health_check'; created_at: string;
}
export interface ApprovalRequest {
  id: UUID; organization_id: UUID; program_id: UUID | null; entity_type: string; entity_id: UUID | null; title: string; details: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'; requested_by: UUID | null; approver_user_id: UUID | null; decided_by: UUID | null;
  decision_note: string | null; decided_at: string | null; created_at: string;
}
export interface DataSteward { id: UUID; organization_id: UUID; data_domain: string; owner_user_id: UUID | null; verifier_user_id: UUID | null; notes: string | null }
export type ReportType = 'executive' | 'progress' | 'attendance_delivery' | 'beneficiaries' | 'experts' | 'evaluation_quality' | 'maturity'
  | 'outputs' | 'outcomes' | 'impact' | 'evidence' | 'closure' | 'final_comprehensive';
export interface Report {
  id: UUID; organization_id: UUID; program_id: UUID | null; code: string; report_type: ReportType; title: string; period_start: string | null;
  period_end: string | null; configuration: Json; status: 'draft' | 'generated' | 'in_review' | 'approved' | 'published'; current_version: number;
  approved_by: UUID | null; approved_at: string | null; created_by: UUID | null; created_at: string; updated_at: string;
}
export interface ReportVersion { id: UUID; organization_id: UUID; report_id: UUID; version: number; content: Json; narrative: Json; generator: 'rules' | 'rules+llm' | 'manual'; generated_by: UUID | null; generated_at: string }
export interface AiInsight {
  id: UUID; organization_id: UUID; program_id: UUID | null; scope: string; entity_id: UUID | null; kind: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical'; rule_code: string | null; fingerprint: string | null; title: string; rationale: string;
  source_data: Json; recommended_action: string | null; generated_by: 'rules' | 'llm'; status: 'open' | 'accepted' | 'dismissed' | 'resolved';
  decided_by: UUID | null; decided_at: string | null; decision_note: string | null; created_at: string;
}
export interface SystemSetting { id: UUID; organization_id: UUID | null; setting_key: string; setting_value: Json; updated_at: string }
export interface IntegrationSetting { id: UUID; organization_id: UUID | null; provider: 'email' | 'sms' | 'whatsapp' | 'calendar_ics' | 'ai'; enabled: boolean; config: Json; updated_at: string }

// my_access() RPC
export interface AccessMembership {
  organization: Pick<Organization, 'id' | 'code' | 'name' | 'name_en' | 'status' | 'default_locale' | 'timezone'>;
  active: boolean; member_active: boolean;
  roles: { id: UUID; code: string; name_ar: string; name_en: string }[];
  permissions: PermissionCode[];
  modules: Partial<Record<ModuleKey, boolean>>;
}
export interface AccessContext { user_id: UUID; is_platform_super_admin: boolean; profile: Profile | null; memberships: AccessMembership[] }
