// TANMIA — Program track journeys (single source of truth).
// Used by the React app, Edge Functions, and scripts/generate-reference-seed.ts
// which writes supabase/migrations/*_reference_data.sql.

export type EvidenceType =
  | 'document' | 'photo' | 'video' | 'attendance_sheet' | 'certificate' | 'assessment_report'
  | 'survey_data' | 'testimonial' | 'link' | 'dataset' | 'minutes' | 'product' | 'other';

export interface StageDef {
  key: string;
  name_ar: string;
  name_en: string;
  description_ar: string;
  description_en: string;
  depends_on: string[];
  required_evidence: EvidenceType[];
  requires_approval: boolean;
  record_types: string[];
}

export interface DimensionSeed { key: string; name_ar: string; name_en: string; weight: number }

export interface IndicatorSeed {
  key: string;
  name_ar: string;
  name_en: string;
  indicator_type: 'operational' | 'output' | 'outcome' | 'impact';
  chain_level: 'input' | 'activity' | 'output' | 'outcome' | 'impact';
  outcome_term?: 'short' | 'medium' | 'long';
  unit: string;
  direction: 'increase' | 'decrease' | 'maintain';
  measurement_points: string[];
}

export interface TrackDef {
  code: TrackCode;
  name_ar: string;
  name_en: string;
  description_ar: string;
  description_en: string;
  stages: StageDef[];
  maturity_dimensions: DimensionSeed[];
  default_indicators: IndicatorSeed[];
  report_sections: string[];
  session_types: string[];
}

export type TrackCode = 'hackathon' | 'incubator' | 'vocational' | 'consulting' | 'bootcamp' | 'graduate';

// ---------------------------------------------------------------------------
// Stage-specific record forms (rendered inside the Journey stage panel)
// ---------------------------------------------------------------------------
export type RecordFieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'beneficiary' | 'expert' | 'team';
export interface RecordField {
  key: string;
  label_ar: string;
  label_en: string;
  type: RecordFieldType;
  required?: boolean;
  min?: number;
  max?: number;
  options?: { value: string; label_ar: string; label_en: string }[];
  scored?: boolean; // contributes to the record score (average of scored fields)
}
export interface RecordTypeDef { key: string; name_ar: string; name_en: string; subject?: 'beneficiary' | 'team' | 'expert' | 'none'; fields: RecordField[] }

const sev = [
  { value: 'low', label_ar: 'منخفضة', label_en: 'Low' },
  { value: 'medium', label_ar: 'متوسطة', label_en: 'Medium' },
  { value: 'high', label_ar: 'عالية', label_en: 'High' },
];
const n = (key: string, label_ar: string, label_en: string, min = 1, max = 10, scored = true): RecordField =>
  ({ key, label_ar, label_en, type: 'number', min, max, scored, required: true });
const t = (key: string, label_ar: string, label_en: string, required = false): RecordField =>
  ({ key, label_ar, label_en, type: 'text', required });
const ta = (key: string, label_ar: string, label_en: string, required = false): RecordField =>
  ({ key, label_ar, label_en, type: 'textarea', required });
const d = (key: string, label_ar: string, label_en: string, required = false): RecordField =>
  ({ key, label_ar, label_en, type: 'date', required });

export const RECORD_TYPES: Record<string, RecordTypeDef> = {
  design_decision: { key: 'design_decision', name_ar: 'قرار تصميم', name_en: 'Design decision', subject: 'none',
    fields: [ta('decision', 'القرار', 'Decision', true), ta('rationale', 'المبررات', 'Rationale'), t('owner', 'المسؤول', 'Owner')] },
  challenge: { key: 'challenge', name_ar: 'تحدٍّ', name_en: 'Challenge', subject: 'none',
    fields: [ta('problem', 'وصف المشكلة', 'Problem statement', true), t('sector', 'القطاع', 'Sector'), t('challenge_owner', 'صاحب التحدي', 'Challenge owner'),
      ta('success_criteria', 'معايير النجاح', 'Success criteria')] },
  application_review: { key: 'application_review', name_ar: 'مراجعة طلب', name_en: 'Application review', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'المتقدم', label_en: 'Applicant', type: 'beneficiary', required: true },
      { key: 'eligible', label_ar: 'الأهلية', label_en: 'Eligibility', type: 'select', required: true,
        options: [{ value: 'yes', label_ar: 'مؤهل', label_en: 'Eligible' }, { value: 'no', label_ar: 'غير مؤهل', label_en: 'Not eligible' }] },
      ta('notes', 'ملاحظات', 'Notes')] },
  screening_score: { key: 'screening_score', name_ar: 'درجة فرز', name_en: 'Screening score', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'المتقدم', label_en: 'Applicant', type: 'beneficiary', required: true },
      n('motivation', 'الدافعية', 'Motivation'), n('fit', 'ملاءمة البرنامج', 'Program fit'), n('capability', 'القدرات', 'Capability'), ta('notes', 'ملاحظات', 'Notes')] },
  team_formation: { key: 'team_formation', name_ar: 'تكوين فريق', name_en: 'Team formation', subject: 'team',
    fields: [{ key: 'team_id', label_ar: 'الفريق', label_en: 'Team', type: 'team', required: true }, ta('composition_notes', 'ملاحظات التكوين', 'Composition notes')] },
  session_log: { key: 'session_log', name_ar: 'سجل جلسة', name_en: 'Session log', subject: 'none',
    fields: [t('topic', 'الموضوع', 'Topic', true), n('participants', 'عدد الحضور', 'Participants', 0, 10000, false), ta('observations', 'ملاحظات', 'Observations')] },
  mentoring_note: { key: 'mentoring_note', name_ar: 'ملاحظة إرشاد', name_en: 'Mentoring note', subject: 'team',
    fields: [{ key: 'expert_id', label_ar: 'المرشد', label_en: 'Mentor', type: 'expert', required: true },
      { key: 'team_id', label_ar: 'الفريق', label_en: 'Team', type: 'team' }, { key: 'beneficiary_id', label_ar: 'المستفيد', label_en: 'Beneficiary', type: 'beneficiary' },
      ta('focus', 'محور الجلسة', 'Focus', true), ta('agreed_actions', 'الإجراءات المتفق عليها', 'Agreed actions'), n('progress_rating', 'تقدير التقدم', 'Progress rating', 1, 5)] },
  project_checkpoint: { key: 'project_checkpoint', name_ar: 'نقطة مراجعة مشروع', name_en: 'Project checkpoint', subject: 'team',
    fields: [{ key: 'team_id', label_ar: 'الفريق', label_en: 'Team', type: 'team', required: true }, t('deliverable', 'المخرج', 'Deliverable', true),
      n('completion', 'نسبة الإنجاز', 'Completion %', 0, 100), ta('blockers', 'المعوقات', 'Blockers')] },
  judging_score: { key: 'judging_score', name_ar: 'تقييم تحكيم', name_en: 'Judging score', subject: 'team',
    fields: [{ key: 'team_id', label_ar: 'الفريق', label_en: 'Team', type: 'team', required: true },
      { key: 'expert_id', label_ar: 'المحكّم', label_en: 'Judge', type: 'expert', required: true },
      n('innovation', 'الابتكار', 'Innovation'), n('feasibility', 'الجدوى', 'Feasibility'), n('impact', 'الأثر المتوقع', 'Expected impact'),
      n('presentation', 'العرض', 'Presentation'), ta('comments', 'تعليقات', 'Comments')] },
  award: { key: 'award', name_ar: 'جائزة', name_en: 'Award', subject: 'team',
    fields: [{ key: 'team_id', label_ar: 'الفريق', label_en: 'Team', type: 'team', required: true }, t('rank', 'المركز', 'Rank', true), t('prize', 'الجائزة', 'Prize')] },
  follow_up: { key: 'follow_up', name_ar: 'متابعة', name_en: 'Follow-up', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'المستفيد', label_en: 'Beneficiary', type: 'beneficiary' }, { key: 'team_id', label_ar: 'الفريق', label_en: 'Team', type: 'team' },
      { key: 'point', label_ar: 'نقطة القياس', label_en: 'Measurement point', type: 'select', required: true,
        options: ['T2', 'T3', 'T4', 'T5'].map((p) => ({ value: p, label_ar: p, label_en: p })) },
      { key: 'status', label_ar: 'الوضع الحالي', label_en: 'Current status', type: 'select', required: true,
        options: [{ value: 'active', label_ar: 'مستمر', label_en: 'Continuing' }, { value: 'scaled', label_ar: 'توسع', label_en: 'Scaled' },
          { value: 'paused', label_ar: 'متوقف مؤقتًا', label_en: 'Paused' }, { value: 'closed', label_ar: 'مغلق', label_en: 'Closed' }] },
      ta('notes', 'ملاحظات', 'Notes')] },
  impact_measurement: { key: 'impact_measurement', name_ar: 'قياس أثر', name_en: 'Impact measurement', subject: 'none',
    fields: [t('indicator', 'المؤشر', 'Indicator', true), n('value', 'القيمة', 'Value', -1e9, 1e9, false), t('method', 'منهجية القياس', 'Method'), ta('notes', 'ملاحظات', 'Notes')] },
  business_diagnostic: { key: 'business_diagnostic', name_ar: 'تشخيص أعمال', name_en: 'Business diagnostic', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'المشروع / المستفيد', label_en: 'Venture / beneficiary', type: 'beneficiary', required: true },
      n('business_model', 'نموذج العمل', 'Business model', 1, 5), n('market', 'السوق', 'Market', 1, 5), n('product', 'المنتج', 'Product', 1, 5),
      n('operations', 'التشغيل', 'Operations', 1, 5), n('finance', 'المالية', 'Finance', 1, 5), ta('priority_gaps', 'الفجوات ذات الأولوية', 'Priority gaps', true)] },
  incubation_plan: { key: 'incubation_plan', name_ar: 'خطة احتضان', name_en: 'Incubation plan', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'المشروع / المستفيد', label_en: 'Venture / beneficiary', type: 'beneficiary', required: true },
      ta('objectives', 'الأهداف', 'Objectives', true), ta('support_services', 'خدمات الدعم', 'Support services'), d('target_date', 'تاريخ الإنجاز المستهدف', 'Target date')] },
  milestone_check: { key: 'milestone_check', name_ar: 'مراجعة معلم', name_en: 'Milestone check', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'المستفيد', label_en: 'Beneficiary', type: 'beneficiary', required: true }, t('milestone', 'المعلم', 'Milestone', true),
      { key: 'result', label_ar: 'النتيجة', label_en: 'Result', type: 'select', required: true,
        options: [{ value: 'achieved', label_ar: 'تحقق', label_en: 'Achieved' }, { value: 'partial', label_ar: 'جزئي', label_en: 'Partial' }, { value: 'missed', label_ar: 'لم يتحقق', label_en: 'Missed' }] }] },
  mvp_checkpoint: { key: 'mvp_checkpoint', name_ar: 'مراجعة النموذج الأولي', name_en: 'MVP checkpoint', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'المستفيد', label_en: 'Beneficiary', type: 'beneficiary', required: true },
      ta('mvp_description', 'وصف النموذج', 'MVP description', true), n('readiness', 'الجاهزية', 'Readiness', 1, 5), n('users_tested', 'عدد المستخدمين المختبرين', 'Users tested', 0, 100000, false)] },
  market_validation: { key: 'market_validation', name_ar: 'تحقق سوقي', name_en: 'Market validation', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'المستفيد', label_en: 'Beneficiary', type: 'beneficiary', required: true },
      n('customer_interviews', 'مقابلات العملاء', 'Customer interviews', 0, 10000, false), n('paying_customers', 'عملاء دافعون', 'Paying customers', 0, 1000000, false),
      ta('learnings', 'الدروس المستفادة', 'Learnings')] },
  growth_metric: { key: 'growth_metric', name_ar: 'مؤشر نمو', name_en: 'Growth metric', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'المستفيد', label_en: 'Beneficiary', type: 'beneficiary', required: true },
      n('revenue', 'الإيرادات (ريال)', 'Revenue (SAR)', 0, 1e12, false), n('employees', 'عدد الموظفين', 'Employees', 0, 100000, false), d('as_of', 'بتاريخ', 'As of', true)] },
  graduation_decision: { key: 'graduation_decision', name_ar: 'قرار تخرج', name_en: 'Graduation decision', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'المستفيد', label_en: 'Beneficiary', type: 'beneficiary', required: true },
      { key: 'decision', label_ar: 'القرار', label_en: 'Decision', type: 'select', required: true,
        options: [{ value: 'graduate', label_ar: 'يتخرج', label_en: 'Graduate' }, { value: 'extend', label_ar: 'تمديد', label_en: 'Extend' }, { value: 'exit', label_ar: 'خروج', label_en: 'Exit' }] },
      ta('justification', 'المبررات', 'Justification', true)] },
  skill_assessment: { key: 'skill_assessment', name_ar: 'قياس مهارة', name_en: 'Skill assessment', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'المتدرب', label_en: 'Trainee', type: 'beneficiary', required: true },
      t('skill', 'المهارة', 'Skill', true), n('theory', 'المعرفة النظرية', 'Theory', 1, 5), n('practical', 'الأداء العملي', 'Practical', 1, 5), n('safety', 'السلامة', 'Safety', 1, 5)] },
  attendance_check: { key: 'attendance_check', name_ar: 'مراجعة الحضور', name_en: 'Attendance check', subject: 'none',
    fields: [d('week_of', 'الأسبوع', 'Week of', true), n('attendance_rate', 'نسبة الحضور %', 'Attendance %', 0, 100, false), ta('absence_actions', 'إجراءات الغياب', 'Absence actions')] },
  practical_product: { key: 'practical_product', name_ar: 'منتج عملي', name_en: 'Practical product', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'المتدرب', label_en: 'Trainee', type: 'beneficiary', required: true },
      t('product', 'المنتج', 'Product', true), n('quality', 'الجودة', 'Quality', 1, 5), n('finish', 'الإتقان', 'Finish', 1, 5)] },
  certification: { key: 'certification', name_ar: 'اعتماد شهادة', name_en: 'Certification', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'المتدرب', label_en: 'Trainee', type: 'beneficiary', required: true }, t('certificate', 'الشهادة', 'Certificate', true),
      t('issuer', 'جهة الإصدار', 'Issuer')] },
  employment_status: { key: 'employment_status', name_ar: 'حالة التوظيف / الممارسة', name_en: 'Employment / practice status', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'المستفيد', label_en: 'Beneficiary', type: 'beneficiary', required: true },
      { key: 'status', label_ar: 'الحالة', label_en: 'Status', type: 'select', required: true,
        options: [{ value: 'employed', label_ar: 'موظف', label_en: 'Employed' }, { value: 'self_employed', label_ar: 'يعمل لحسابه', label_en: 'Self-employed' },
          { value: 'seeking', label_ar: 'يبحث عن عمل', label_en: 'Seeking' }, { value: 'studying', label_ar: 'يدرس', label_en: 'Studying' }] },
      t('employer', 'جهة العمل', 'Employer'), n('monthly_income', 'الدخل الشهري', 'Monthly income', 0, 1e9, false), d('as_of', 'بتاريخ', 'As of', true)] },
  consulting_request: { key: 'consulting_request', name_ar: 'طلب استشارة', name_en: 'Consulting request', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'طالب الاستشارة', label_en: 'Requester', type: 'beneficiary', required: true },
      t('domain', 'مجال الاستشارة', 'Domain', true), ta('need', 'وصف الاحتياج', 'Need', true), { key: 'urgency', label_ar: 'الأولوية', label_en: 'Urgency', type: 'select', options: sev }] },
  diagnosis: { key: 'diagnosis', name_ar: 'تشخيص', name_en: 'Diagnosis', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'المستفيد', label_en: 'Beneficiary', type: 'beneficiary', required: true },
      ta('findings', 'النتائج', 'Findings', true), { key: 'severity', label_ar: 'الحدة', label_en: 'Severity', type: 'select', options: sev }, ta('root_causes', 'الأسباب الجذرية', 'Root causes')] },
  consultant_match: { key: 'consultant_match', name_ar: 'مطابقة مستشار', name_en: 'Consultant match', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'المستفيد', label_en: 'Beneficiary', type: 'beneficiary', required: true },
      { key: 'expert_id', label_ar: 'المستشار', label_en: 'Consultant', type: 'expert', required: true }, ta('rationale', 'مبررات المطابقة', 'Match rationale')] },
  recommendation: { key: 'recommendation', name_ar: 'توصية', name_en: 'Recommendation', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'المستفيد', label_en: 'Beneficiary', type: 'beneficiary', required: true },
      ta('recommendation', 'التوصية', 'Recommendation', true), { key: 'priority', label_ar: 'الأولوية', label_en: 'Priority', type: 'select', options: sev }] },
  action_plan_item: { key: 'action_plan_item', name_ar: 'بند خطة عمل', name_en: 'Action plan item', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'المستفيد', label_en: 'Beneficiary', type: 'beneficiary', required: true },
      t('action', 'الإجراء', 'Action', true), d('due', 'الموعد', 'Due date', true), t('owner', 'المسؤول', 'Owner')] },
  closure: { key: 'closure', name_ar: 'إغلاق', name_en: 'Closure', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'المستفيد', label_en: 'Beneficiary', type: 'beneficiary', required: true },
      n('implementation_rate', 'نسبة تطبيق التوصيات %', 'Recommendation implementation %', 0, 100), n('satisfaction', 'الرضا', 'Satisfaction', 1, 5), ta('summary', 'الخلاصة', 'Summary')] },
  cohort_setup: { key: 'cohort_setup', name_ar: 'إعداد دفعة', name_en: 'Cohort setup', subject: 'none',
    fields: [t('cohort', 'الدفعة', 'Cohort', true), n('size', 'العدد', 'Size', 0, 10000, false), ta('notes', 'ملاحظات', 'Notes')] },
  learning_module: { key: 'learning_module', name_ar: 'وحدة تعلم', name_en: 'Learning module', subject: 'none',
    fields: [t('module', 'الوحدة', 'Module', true), n('hours', 'الساعات', 'Hours', 0, 1000, false), ta('outcomes', 'نواتج التعلم', 'Learning outcomes')] },
  project_evaluation: { key: 'project_evaluation', name_ar: 'تقييم مشروع', name_en: 'Project evaluation', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'المستفيد', label_en: 'Beneficiary', type: 'beneficiary' }, { key: 'team_id', label_ar: 'الفريق', label_en: 'Team', type: 'team' },
      n('quality', 'الجودة', 'Quality', 1, 5), n('application', 'التطبيق', 'Application', 1, 5), n('presentation', 'العرض', 'Presentation', 1, 5)] },
  workforce_need: { key: 'workforce_need', name_ar: 'احتياج وظيفي', name_en: 'Workforce need', subject: 'none',
    fields: [t('role_family', 'العائلة الوظيفية', 'Role family', true), n('positions', 'عدد الوظائف', 'Positions', 0, 100000, false),
      ta('competencies', 'الجدارات المطلوبة', 'Required competencies', true), t('department', 'الإدارة', 'Department')] },
  campaign_channel: { key: 'campaign_channel', name_ar: 'قناة استقطاب', name_en: 'Campaign channel', subject: 'none',
    fields: [t('channel', 'القناة', 'Channel', true), n('reach', 'الوصول', 'Reach', 0, 1e9, false), n('applications', 'الطلبات', 'Applications', 0, 1e7, false)] },
  eligibility_check: { key: 'eligibility_check', name_ar: 'تحقق أهلية', name_en: 'Eligibility check', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'المتقدم', label_en: 'Applicant', type: 'beneficiary', required: true },
      { key: 'eligible', label_ar: 'الأهلية', label_en: 'Eligibility', type: 'select', required: true,
        options: [{ value: 'yes', label_ar: 'مؤهل', label_en: 'Eligible' }, { value: 'no', label_ar: 'غير مؤهل', label_en: 'Not eligible' }] },
      t('criteria_failed', 'المعيار غير المستوفى', 'Failed criterion')] },
  onboarding_item: { key: 'onboarding_item', name_ar: 'بند تهيئة', name_en: 'Onboarding item', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'المستفيد', label_en: 'Beneficiary', type: 'beneficiary', required: true }, t('item', 'البند', 'Item', true),
      { key: 'done', label_ar: 'الحالة', label_en: 'Status', type: 'select', options: [{ value: 'done', label_ar: 'مكتمل', label_en: 'Done' }, { value: 'pending', label_ar: 'معلق', label_en: 'Pending' }] }] },
  idp_item: { key: 'idp_item', name_ar: 'بند خطة تطوير فردية', name_en: 'IDP item', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'المستفيد', label_en: 'Beneficiary', type: 'beneficiary', required: true },
      t('competency', 'الجدارة', 'Competency', true), ta('development_goal', 'هدف التطوير', 'Development goal', true),
      { key: 'method', label_ar: 'أسلوب التطوير', label_en: 'Development method', type: 'select',
        options: [{ value: '70', label_ar: 'تجربة عملية (70)', label_en: 'On-the-job (70)' }, { value: '20', label_ar: 'تعلم من الآخرين (20)', label_en: 'Social (20)' },
          { value: '10', label_ar: 'تعلم رسمي (10)', label_en: 'Formal (10)' }] },
      d('due', 'الموعد', 'Due date')] },
  rotation: { key: 'rotation', name_ar: 'تدوير وظيفي', name_en: 'Job rotation', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'المستفيد', label_en: 'Beneficiary', type: 'beneficiary', required: true },
      t('department', 'الإدارة', 'Department', true), d('from', 'من', 'From', true), d('to', 'إلى', 'To', true), n('supervisor_rating', 'تقييم المشرف', 'Supervisor rating', 1, 5)] },
  assignment_review: { key: 'assignment_review', name_ar: 'مراجعة مهمة', name_en: 'Assignment review', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'المستفيد', label_en: 'Beneficiary', type: 'beneficiary', required: true },
      t('assignment', 'المهمة', 'Assignment', true), n('quality', 'الجودة', 'Quality', 1, 5), n('timeliness', 'الالتزام بالوقت', 'Timeliness', 1, 5)] },
  placement: { key: 'placement', name_ar: 'تسكين', name_en: 'Placement', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'الخريج', label_en: 'Graduate', type: 'beneficiary', required: true },
      t('employer', 'جهة العمل', 'Employer', true), t('job_title', 'المسمى الوظيفي', 'Job title', true), d('start_date', 'تاريخ المباشرة', 'Start date', true),
      { key: 'employment_type', label_ar: 'نوع التوظيف', label_en: 'Employment type', type: 'select',
        options: [{ value: 'full_time', label_ar: 'دوام كامل', label_en: 'Full-time' }, { value: 'contract', label_ar: 'عقد', label_en: 'Contract' }, { value: 'internship', label_ar: 'تدريب', label_en: 'Internship' }] }] },
  retention_check: { key: 'retention_check', name_ar: 'متابعة الاستمرار', name_en: 'Retention check', subject: 'beneficiary',
    fields: [{ key: 'beneficiary_id', label_ar: 'الخريج', label_en: 'Graduate', type: 'beneficiary', required: true },
      { key: 'point', label_ar: 'نقطة المتابعة', label_en: 'Follow-up point', type: 'select', required: true,
        options: [{ value: 'T4', label_ar: '6 أشهر (T4)', label_en: '6 months (T4)' }, { value: 'T5', label_ar: '12 شهرًا (T5)', label_en: '12 months (T5)' }] },
      { key: 'retained', label_ar: 'مستمر في العمل', label_en: 'Retained', type: 'select', required: true,
        options: [{ value: 'yes', label_ar: 'نعم', label_en: 'Yes' }, { value: 'no', label_ar: 'لا', label_en: 'No' }] },
      n('manager_rating', 'تقييم المدير', 'Manager rating', 1, 5)] },
};

// ---------------------------------------------------------------------------
// Journeys
// ---------------------------------------------------------------------------
type S = [key: string, ar: string, en: string, dar: string, den: string, deps: string[] | null, ev: EvidenceType[], approval: boolean, records: string[]];

function build(rows: S[]): StageDef[] {
  return rows.map(([key, name_ar, name_en, description_ar, description_en, deps, ev, approval, records], i) => ({
    key, name_ar, name_en, description_ar, description_en,
    depends_on: deps ?? (i > 0 ? [rows[i - 1][0]] : []),
    required_evidence: ev, requires_approval: approval, record_types: records,
  }));
}

const PP = ['T0', 'T1'];
const FOLLOW = ['T0', 'T1', 'T3', 'T4'];

export const TRACKS: TrackDef[] = [
  {
    code: 'hackathon', name_ar: 'هاكاثون', name_en: 'Hackathon',
    description_ar: 'من تصميم التحديات إلى التحكيم والجوائز ومتابعة المشاريع وقياس الأثر.',
    description_en: 'From challenge design to judging, awards, project follow-up and impact.',
    stages: build([
      ['design', 'التصميم', 'Design', 'تحديد الهدف والفئة المستهدفة ونطاق الهاكاثون ومعايير النجاح.', 'Define purpose, target group, scope and success criteria.', null, ['document'], true, ['design_decision']],
      ['challenges', 'التحديات', 'Challenges', 'صياغة التحديات مع أصحابها ومعايير الحلول.', 'Frame challenges with owners and solution criteria.', null, ['document'], false, ['challenge']],
      ['applications', 'التقديم', 'Applications', 'استقبال الطلبات والتحقق من اكتمالها.', 'Receive and check applications.', null, [], false, ['application_review']],
      ['screening', 'الفرز', 'Screening', 'فرز المتقدمين وفق معايير معلنة.', 'Screen applicants against published criteria.', null, ['minutes'], true, ['screening_score']],
      ['teams', 'تكوين الفرق', 'Teams', 'تكوين فرق متوازنة وربطها بالتحديات.', 'Form balanced teams and link them to challenges.', null, [], false, ['team_formation']],
      ['bootcamp', 'المعسكر', 'Bootcamp', 'جلسات تمكين مكثفة قبل التطوير.', 'Intensive enablement sessions before development.', null, ['attendance_sheet'], false, ['session_log']],
      ['mentoring', 'الإرشاد', 'Mentoring', 'إسناد مرشدين للفرق وتوثيق الجلسات.', 'Assign mentors to teams and log sessions.', ['teams'], [], false, ['mentoring_note']],
      ['project_development', 'تطوير المشاريع', 'Project development', 'متابعة نقاط المراجعة للمشاريع.', 'Track project checkpoints.', ['teams'], [], false, ['project_checkpoint']],
      ['judging', 'التحكيم', 'Judging', 'تحكيم المشاريع بمعايير موزونة ومحكّمين دون تعارض مصالح.', 'Judge projects with weighted criteria and conflict-free judges.', ['project_development', 'mentoring'], ['minutes'], true, ['judging_score']],
      ['awards', 'الجوائز', 'Awards', 'إعلان الفائزين وتسليم الجوائز.', 'Announce winners and deliver awards.', null, ['photo'], false, ['award']],
      ['post_tracking', 'متابعة ما بعد الهاكاثون', 'Post-hackathon tracking', 'متابعة استمرار المشاريع عند T2–T5.', 'Follow project continuity at T2–T5.', null, [], false, ['follow_up']],
      ['impact', 'الأثر', 'Impact', 'قياس النتائج والأثر مقارنة بخط الأساس.', 'Measure outcomes and impact against baseline.', null, ['survey_data'], false, ['impact_measurement']],
    ]),
    maturity_dimensions: [
      { key: 'problem_clarity', name_ar: 'وضوح المشكلة', name_en: 'Problem clarity', weight: 1 },
      { key: 'innovation', name_ar: 'الابتكار', name_en: 'Innovation', weight: 1.2 },
      { key: 'feasibility', name_ar: 'الجدوى', name_en: 'Feasibility', weight: 1 },
      { key: 'execution', name_ar: 'قابلية التنفيذ', name_en: 'Execution readiness', weight: 1 },
      { key: 'expected_impact', name_ar: 'الأثر المتوقع', name_en: 'Expected impact', weight: 1.2 },
    ],
    default_indicators: [
      { key: 'applications', name_ar: 'عدد الطلبات المستلمة', name_en: 'Applications received', indicator_type: 'operational', chain_level: 'activity', unit: 'count', direction: 'increase', measurement_points: ['T1'] },
      { key: 'teams_completed', name_ar: 'الفرق التي أكملت مشاريعها', name_en: 'Teams completing projects', indicator_type: 'output', chain_level: 'output', unit: 'count', direction: 'increase', measurement_points: ['T1'] },
      { key: 'prototype_quality', name_ar: 'متوسط جودة النماذج الأولية', name_en: 'Average prototype quality', indicator_type: 'outcome', chain_level: 'outcome', outcome_term: 'short', unit: 'score', direction: 'increase', measurement_points: PP },
      { key: 'projects_continuing', name_ar: 'نسبة المشاريع المستمرة بعد 6 أشهر', name_en: '% projects continuing after 6 months', indicator_type: 'impact', chain_level: 'impact', outcome_term: 'long', unit: 'percent', direction: 'increase', measurement_points: ['T4'] },
    ],
    report_sections: ['executive_summary', 'program_information', 'participation', 'execution', 'evaluation', 'outputs', 'outcomes', 'impact', 'success_stories', 'lessons_learned', 'recommendations'],
    session_types: ['workshop', 'mentoring', 'judging', 'event'],
  },
  {
    code: 'incubator', name_ar: 'حاضنة أعمال', name_en: 'Business incubator',
    description_ar: 'من التقديم والتشخيص إلى MVP والتحقق السوقي والنمو والتخرج.',
    description_en: 'From application and diagnostics to MVP, market validation, growth and graduation.',
    stages: build([
      ['application', 'التقديم', 'Application', 'استقبال طلبات المشاريع.', 'Receive venture applications.', null, [], false, ['application_review']],
      ['assessment', 'التقييم', 'Assessment', 'تقييم الجاهزية والفريق والفكرة.', 'Assess readiness, team and idea.', null, ['assessment_report'], false, ['screening_score']],
      ['selection', 'الاختيار', 'Selection', 'اعتماد المشاريع المقبولة.', 'Approve accepted ventures.', null, ['minutes'], true, []],
      ['business_diagnostic', 'تشخيص الأعمال', 'Business diagnostic', 'تشخيص نموذج العمل والسوق والمنتج والمالية.', 'Diagnose business model, market, product and finance.', null, ['assessment_report'], false, ['business_diagnostic']],
      ['incubation_plan', 'خطة الاحتضان', 'Incubation plan', 'خطة احتضان لكل مشروع مرتبطة بالفجوات.', 'Per-venture plan tied to diagnosed gaps.', null, ['document'], true, ['incubation_plan']],
      ['mentoring', 'الإرشاد', 'Mentoring', 'جلسات إرشاد واستشارات متخصصة.', 'Mentoring and specialist advisory.', null, [], false, ['mentoring_note']],
      ['milestones', 'المعالم', 'Milestones', 'متابعة معالم الخطة.', 'Track plan milestones.', ['incubation_plan'], [], false, ['milestone_check']],
      ['mvp', 'النموذج الأولي (MVP)', 'MVP', 'بناء واختبار النموذج الأولي.', 'Build and test the MVP.', ['milestones'], ['product'], false, ['mvp_checkpoint']],
      ['market_validation', 'التحقق السوقي', 'Market validation', 'إثبات الطلب والعملاء الدافعين.', 'Prove demand and paying customers.', null, ['dataset'], false, ['market_validation']],
      ['growth', 'النمو', 'Growth', 'تتبع الإيرادات والتوظيف.', 'Track revenue and hiring.', null, [], false, ['growth_metric']],
      ['graduation', 'التخرج', 'Graduation', 'قرار التخرج وفق معايير معتمدة.', 'Graduation decision against approved criteria.', null, ['certificate'], true, ['graduation_decision']],
      ['post_incubation', 'ما بعد الاحتضان', 'Post-incubation', 'متابعة المشاريع بعد التخرج.', 'Follow ventures after graduation.', null, [], false, ['follow_up', 'growth_metric']],
      ['impact', 'الأثر', 'Impact', 'قياس الأثر الاقتصادي والاجتماعي.', 'Measure economic and social impact.', null, ['survey_data'], false, ['impact_measurement']],
    ]),
    maturity_dimensions: [
      { key: 'business_model', name_ar: 'نموذج العمل', name_en: 'Business model', weight: 1.2 },
      { key: 'market', name_ar: 'السوق', name_en: 'Market', weight: 1.2 },
      { key: 'product', name_ar: 'المنتج', name_en: 'Product', weight: 1 },
      { key: 'operations', name_ar: 'التشغيل', name_en: 'Operations', weight: 0.8 },
      { key: 'finance', name_ar: 'المالية', name_en: 'Finance', weight: 1 },
      { key: 'governance', name_ar: 'الحوكمة', name_en: 'Governance', weight: 0.8 },
      { key: 'sustainability', name_ar: 'الاستدامة', name_en: 'Sustainability', weight: 1 },
    ],
    default_indicators: [
      { key: 'ventures_incubated', name_ar: 'المشاريع المحتضنة', name_en: 'Ventures incubated', indicator_type: 'output', chain_level: 'output', unit: 'count', direction: 'increase', measurement_points: ['T1'] },
      { key: 'mentoring_hours', name_ar: 'ساعات الإرشاد المقدمة', name_en: 'Mentoring hours delivered', indicator_type: 'operational', chain_level: 'activity', unit: 'hours', direction: 'increase', measurement_points: ['T1'] },
      { key: 'ventures_revenue', name_ar: 'نسبة المشاريع المحققة لإيرادات', name_en: '% ventures generating revenue', indicator_type: 'outcome', chain_level: 'outcome', outcome_term: 'medium', unit: 'percent', direction: 'increase', measurement_points: FOLLOW },
      { key: 'jobs_created', name_ar: 'الوظائف المستحدثة', name_en: 'Jobs created', indicator_type: 'impact', chain_level: 'impact', outcome_term: 'long', unit: 'count', direction: 'increase', measurement_points: ['T0', 'T4', 'T5'] },
    ],
    report_sections: ['executive_summary', 'program_information', 'target_group', 'execution', 'participation', 'evaluation', 'maturity', 'outputs', 'outcomes', 'impact', 'success_stories', 'challenges', 'lessons_learned', 'recommendations'],
    session_types: ['mentoring', 'consulting', 'workshop', 'assessment'],
  },
  {
    code: 'vocational', name_ar: 'برنامج مهني / حرفي', name_en: 'Vocational / craft program',
    description_ar: 'من التسجيل وقياس المهارة القبلي إلى الشهادة والتوظيف ومتابعة الأثر.',
    description_en: 'From registration and baseline skill assessment to certification, employment and impact follow-up.',
    stages: build([
      ['registration', 'التسجيل', 'Registration', 'تسجيل المتدربين والتحقق من البيانات.', 'Register trainees and validate data.', null, [], false, ['application_review']],
      ['baseline_skill_assessment', 'قياس المهارة القبلي', 'Baseline skill assessment', 'قياس مستوى المهارة عند T0.', 'Measure skill level at T0.', null, ['assessment_report'], false, ['skill_assessment']],
      ['training', 'التدريب النظري والعملي', 'Theory / practical training', 'تنفيذ التدريب وفق الخطة.', 'Deliver training per plan.', null, ['attendance_sheet'], false, ['session_log']],
      ['attendance', 'الحضور', 'Attendance', 'متابعة الحضور ومعالجة الغياب.', 'Monitor attendance and handle absence.', ['training'], [], false, ['attendance_check']],
      ['skill_assessment', 'قياس المهارة', 'Skill assessment', 'قياس المهارة عند T1.', 'Measure skill at T1.', ['training'], ['assessment_report'], false, ['skill_assessment']],
      ['practical_product', 'المنتج العملي', 'Practical product', 'تقييم المنتج العملي لكل متدرب.', 'Evaluate each trainee\'s practical product.', null, ['photo', 'product'], false, ['practical_product']],
      ['certification', 'الشهادة', 'Certification', 'اعتماد ومنح الشهادات.', 'Approve and issue certificates.', ['skill_assessment', 'practical_product'], ['certificate'], true, ['certification']],
      ['employment_practice', 'التوظيف / الممارسة', 'Employment / practice', 'متابعة الالتحاق بعمل أو ممارسة الحرفة.', 'Track employment or craft practice.', null, [], false, ['employment_status']],
      ['impact_follow_up', 'متابعة الأثر', 'Impact follow-up', 'متابعة الدخل والاستمرار عند T3–T5.', 'Follow income and continuity at T3–T5.', null, ['survey_data'], false, ['employment_status', 'impact_measurement']],
    ]),
    maturity_dimensions: [
      { key: 'knowledge', name_ar: 'المعرفة', name_en: 'Knowledge', weight: 0.8 },
      { key: 'practical_skill', name_ar: 'المهارة العملية', name_en: 'Practical skill', weight: 1.4 },
      { key: 'quality', name_ar: 'الجودة', name_en: 'Quality', weight: 1.2 },
      { key: 'safety', name_ar: 'السلامة', name_en: 'Safety', weight: 1 },
      { key: 'independence', name_ar: 'الاستقلالية', name_en: 'Independence', weight: 1 },
      { key: 'employability', name_ar: 'قابلية التوظيف', name_en: 'Employability', weight: 1 },
    ],
    default_indicators: [
      { key: 'training_hours', name_ar: 'ساعات التدريب المنفذة', name_en: 'Training hours delivered', indicator_type: 'operational', chain_level: 'activity', unit: 'hours', direction: 'increase', measurement_points: ['T1'] },
      { key: 'certified', name_ar: 'المتدربون الحاصلون على شهادة', name_en: 'Trainees certified', indicator_type: 'output', chain_level: 'output', unit: 'count', direction: 'increase', measurement_points: ['T1'] },
      { key: 'skill_gain', name_ar: 'متوسط التحسن في المهارة', name_en: 'Average skill gain', indicator_type: 'outcome', chain_level: 'outcome', outcome_term: 'short', unit: 'score', direction: 'increase', measurement_points: PP },
      { key: 'employed_or_practicing', name_ar: 'نسبة العاملين أو الممارسين بعد 6 أشهر', name_en: '% employed or practicing at 6 months', indicator_type: 'impact', chain_level: 'impact', outcome_term: 'long', unit: 'percent', direction: 'increase', measurement_points: ['T0', 'T4'] },
    ],
    report_sections: ['executive_summary', 'program_information', 'execution', 'participation', 'evaluation', 'maturity', 'outputs', 'outcomes', 'impact', 'success_stories', 'recommendations'],
    session_types: ['training', 'workshop', 'assessment'],
  },
  {
    code: 'consulting', name_ar: 'جلسات استشارية', name_en: 'Consulting sessions',
    description_ar: 'من الطلب والتشخيص والمطابقة إلى التوصيات وخطة العمل والمتابعة والإغلاق.',
    description_en: 'From request, diagnosis and matching to recommendations, action plan, follow-up and closure.',
    stages: build([
      ['request', 'الطلب', 'Request', 'استقبال طلب الاستشارة وتحديد الاحتياج.', 'Receive request and define need.', null, [], false, ['consulting_request']],
      ['diagnosis', 'التشخيص', 'Diagnosis', 'تشخيص المشكلة وأسبابها الجذرية.', 'Diagnose problem and root causes.', null, [], false, ['diagnosis']],
      ['matching', 'إسناد / مطابقة المستشار', 'Consultant assignment / matching', 'مطابقة قابلة للتفسير مع فحص تعارض المصالح.', 'Explainable matching with conflict-of-interest check.', null, [], false, ['consultant_match']],
      ['session', 'الجلسة', 'Session', 'تنفيذ الجلسات وتوثيقها.', 'Deliver and document sessions.', null, ['minutes'], false, ['session_log']],
      ['recommendations', 'التوصيات', 'Recommendations', 'توصيات محددة قابلة للتنفيذ.', 'Specific, actionable recommendations.', null, [], false, ['recommendation']],
      ['action_plan', 'خطة العمل', 'Action plan', 'خطة عمل بمسؤوليات ومواعيد.', 'Action plan with owners and dates.', null, ['document'], false, ['action_plan_item']],
      ['follow_up', 'المتابعة', 'Follow-up', 'متابعة تطبيق خطة العمل.', 'Follow up plan implementation.', null, [], false, ['follow_up']],
      ['closure', 'الإغلاق', 'Closure', 'إغلاق الحالة بتقييم التطبيق والرضا.', 'Close with implementation and satisfaction review.', null, ['document'], true, ['closure']],
      ['outcome_impact', 'النتيجة / الأثر', 'Outcome / impact', 'قياس التحسن الناتج.', 'Measure resulting improvement.', null, ['survey_data'], false, ['impact_measurement']],
    ]),
    maturity_dimensions: [
      { key: 'need_clarity', name_ar: 'وضوح الاحتياج', name_en: 'Need clarity', weight: 1 },
      { key: 'execution_capacity', name_ar: 'القدرة على التنفيذ', name_en: 'Execution capacity', weight: 1.2 },
      { key: 'decision_quality', name_ar: 'جودة القرار', name_en: 'Decision quality', weight: 1 },
      { key: 'application', name_ar: 'التطبيق', name_en: 'Application', weight: 1.2 },
      { key: 'sustained_improvement', name_ar: 'استدامة التحسن', name_en: 'Sustained improvement', weight: 1 },
    ],
    default_indicators: [
      { key: 'sessions_delivered', name_ar: 'الجلسات المنفذة', name_en: 'Sessions delivered', indicator_type: 'operational', chain_level: 'activity', unit: 'count', direction: 'increase', measurement_points: ['T1'] },
      { key: 'action_plans', name_ar: 'خطط العمل المعتمدة', name_en: 'Action plans agreed', indicator_type: 'output', chain_level: 'output', unit: 'count', direction: 'increase', measurement_points: ['T1'] },
      { key: 'implementation_rate', name_ar: 'نسبة تطبيق التوصيات', name_en: 'Recommendation implementation rate', indicator_type: 'outcome', chain_level: 'outcome', outcome_term: 'short', unit: 'percent', direction: 'increase', measurement_points: ['T2', 'T3'] },
      { key: 'performance_improvement', name_ar: 'التحسن في الأداء المؤسسي', name_en: 'Organizational performance improvement', indicator_type: 'impact', chain_level: 'impact', outcome_term: 'medium', unit: 'score', direction: 'increase', measurement_points: ['T0', 'T3'] },
    ],
    report_sections: ['executive_summary', 'program_information', 'execution', 'participation', 'evaluation', 'outputs', 'outcomes', 'impact', 'recommendations'],
    session_types: ['consulting', 'coaching'],
  },
  {
    code: 'bootcamp', name_ar: 'معسكر', name_en: 'Bootcamp',
    description_ar: 'من التسجيل والاختيار والدفعات إلى رحلة التعلم والمشاريع والتخرج والمتابعة.',
    description_en: 'From registration, selection and cohorts to learning journey, projects, graduation and follow-up.',
    stages: build([
      ['registration', 'التسجيل', 'Registration', 'استقبال التسجيلات.', 'Receive registrations.', null, [], false, ['application_review']],
      ['selection', 'الاختيار', 'Selection', 'اختيار المشاركين واعتماد القوائم.', 'Select and approve participants.', null, ['minutes'], true, ['screening_score']],
      ['cohorts', 'الدفعات', 'Cohorts', 'تقسيم المشاركين إلى دفعات.', 'Organize participants into cohorts.', null, [], false, ['cohort_setup']],
      ['learning_journey', 'رحلة التعلم', 'Learning journey', 'تصميم وحدات التعلم ونواتجها.', 'Design learning modules and outcomes.', null, ['document'], false, ['learning_module']],
      ['sessions', 'الجلسات', 'Sessions', 'تنفيذ الجلسات ومتابعة الحضور.', 'Deliver sessions and track attendance.', ['cohorts', 'learning_journey'], ['attendance_sheet'], false, ['session_log']],
      ['projects', 'المشاريع', 'Projects', 'مشاريع تطبيقية فردية أو جماعية.', 'Applied individual or team projects.', null, [], false, ['project_evaluation']],
      ['assessments', 'التقييمات', 'Assessments', 'تقييم نواتج التعلم.', 'Assess learning outcomes.', null, ['assessment_report'], false, ['skill_assessment']],
      ['graduation', 'التخرج', 'Graduation', 'اعتماد المتخرجين.', 'Approve graduates.', null, ['certificate'], true, ['graduation_decision']],
      ['follow_up', 'المتابعة', 'Follow-up', 'متابعة التطبيق والتوظيف.', 'Follow application and employment.', null, [], false, ['employment_status', 'follow_up']],
    ]),
    maturity_dimensions: [
      { key: 'knowledge', name_ar: 'المعرفة', name_en: 'Knowledge', weight: 1 },
      { key: 'skill', name_ar: 'المهارة', name_en: 'Skill', weight: 1.2 },
      { key: 'application', name_ar: 'التطبيق', name_en: 'Application', weight: 1.2 },
      { key: 'project', name_ar: 'المشروع', name_en: 'Project', weight: 1 },
      { key: 'readiness', name_ar: 'الجاهزية', name_en: 'Readiness', weight: 1 },
    ],
    default_indicators: [
      { key: 'attendance_rate', name_ar: 'نسبة الحضور', name_en: 'Attendance rate', indicator_type: 'operational', chain_level: 'activity', unit: 'percent', direction: 'increase', measurement_points: ['T1'] },
      { key: 'graduates', name_ar: 'عدد المتخرجين', name_en: 'Graduates', indicator_type: 'output', chain_level: 'output', unit: 'count', direction: 'increase', measurement_points: ['T1'] },
      { key: 'skill_gain', name_ar: 'التحسن في المهارة', name_en: 'Skill gain', indicator_type: 'outcome', chain_level: 'outcome', outcome_term: 'short', unit: 'score', direction: 'increase', measurement_points: PP },
      { key: 'employment', name_ar: 'نسبة التوظيف بعد 3 أشهر', name_en: 'Employment at 3 months', indicator_type: 'impact', chain_level: 'impact', outcome_term: 'medium', unit: 'percent', direction: 'increase', measurement_points: ['T0', 'T3'] },
    ],
    report_sections: ['executive_summary', 'program_information', 'participation', 'execution', 'evaluation', 'maturity', 'outputs', 'outcomes', 'impact', 'recommendations'],
    session_types: ['training', 'workshop', 'assessment'],
  },
  {
    code: 'graduate', name_ar: 'تطوير الخريجين', name_en: 'Graduate development program',
    description_ar: 'من الاحتياج الوظيفي والاستقطاب إلى IDP والتدوير والتقييم والتسكين ومتابعة 6/12 شهرًا.',
    description_en: 'From workforce need and campaign to IDP, rotation, assessment, placement and 6/12-month tracking.',
    stages: build([
      ['workforce_need', 'الاحتياج الوظيفي', 'Workforce / talent need', 'تحديد الوظائف والجدارات المطلوبة.', 'Define roles and required competencies.', null, ['document'], false, ['workforce_need']],
      ['program_design', 'تصميم البرنامج', 'Program design', 'تصميم مسار التطوير ومعايير التخرج.', 'Design the development path and graduation criteria.', null, ['document'], true, ['design_decision']],
      ['campaign', 'الحملة', 'Campaign', 'حملة الاستقطاب وقنواتها.', 'Recruitment campaign and channels.', null, [], false, ['campaign_channel']],
      ['applications', 'التقديم', 'Applications', 'استقبال الطلبات.', 'Receive applications.', null, [], false, ['application_review']],
      ['eligibility', 'الأهلية', 'Eligibility', 'التحقق من شروط الأهلية.', 'Check eligibility criteria.', null, [], false, ['eligibility_check']],
      ['screening', 'الفرز', 'Screening', 'الفرز الأولي.', 'Initial screening.', null, [], false, ['screening_score']],
      ['assessment', 'التقييم', 'Assessment', 'تقييمات معيارية ومقابلات.', 'Standardized assessments and interviews.', null, ['assessment_report'], false, ['screening_score']],
      ['selection', 'الاختيار', 'Selection', 'اعتماد المقبولين.', 'Approve selected candidates.', null, ['minutes'], true, []],
      ['onboarding', 'التهيئة', 'Onboarding', 'تهيئة المنضمين.', 'Onboard joiners.', null, [], false, ['onboarding_item']],
      ['baseline', 'خط الأساس (T0)', 'Baseline (T0)', 'قياس خط الأساس للجدارات.', 'Baseline competency measurement.', null, ['assessment_report'], false, ['skill_assessment']],
      ['idp', 'خطة التطوير الفردية', 'IDP', 'خطة تطوير فردية مبنية على فجوات T0.', 'Individual plan built from T0 gaps.', ['baseline'], ['document'], false, ['idp_item']],
      ['learning_journey', 'رحلة التعلم', 'Learning journey', 'تنفيذ الوحدات التعليمية.', 'Deliver learning modules.', null, ['attendance_sheet'], false, ['learning_module']],
      ['job_rotation', 'التدوير الوظيفي', 'Job rotation', 'تدوير بين الإدارات بتقييم المشرف.', 'Rotations with supervisor ratings.', ['idp'], [], false, ['rotation']],
      ['mentoring_coaching', 'الإرشاد والكوتشينغ', 'Mentoring / coaching', 'جلسات إرشاد وكوتشينغ.', 'Mentoring and coaching sessions.', ['idp'], [], false, ['mentoring_note']],
      ['projects_assignments', 'المشاريع والمهام', 'Projects / assignments', 'مهام ومشاريع تطبيقية.', 'Applied projects and assignments.', ['idp'], [], false, ['assignment_review']],
      ['periodic_assessment', 'التقييم الدوري', 'Periodic assessment', 'تقييمات دورية للتقدم.', 'Periodic progress assessments.', ['learning_journey'], ['assessment_report'], false, ['skill_assessment']],
      ['final_assessment', 'التقييم النهائي (T1)', 'Final assessment (T1)', 'التقييم النهائي ومقارنته بـ T0.', 'Final assessment compared with T0.', ['periodic_assessment', 'job_rotation', 'projects_assignments'], ['assessment_report'], false, ['skill_assessment']],
      ['graduation', 'التخرج', 'Graduation', 'اعتماد التخرج.', 'Approve graduation.', null, ['certificate'], true, ['graduation_decision']],
      ['placement', 'التسكين', 'Placement', 'تسكين الخريجين في الوظائف.', 'Place graduates in roles.', null, ['document'], false, ['placement']],
      ['tracking', 'متابعة 6/12 شهرًا', '6/12-month tracking', 'متابعة الاستمرار والأداء عند T4 وT5.', 'Track retention and performance at T4 and T5.', null, [], false, ['retention_check']],
      ['impact', 'الأثر', 'Impact', 'قياس الأثر على الجاهزية والاحتفاظ والأداء.', 'Measure impact on readiness, retention and performance.', null, ['survey_data'], false, ['impact_measurement']],
    ]),
    maturity_dimensions: [
      { key: 'competence', name_ar: 'الكفاءة', name_en: 'Competence', weight: 1.2 },
      { key: 'job_readiness', name_ar: 'الجاهزية الوظيفية', name_en: 'Job readiness', weight: 1.2 },
      { key: 'practical_application', name_ar: 'التطبيق العملي', name_en: 'Practical application', weight: 1 },
      { key: 'independence', name_ar: 'الاستقلالية', name_en: 'Independence', weight: 0.8 },
      { key: 'performance', name_ar: 'الأداء', name_en: 'Performance', weight: 1 },
      { key: 'role_readiness', name_ar: 'الاستعداد للدور', name_en: 'Role readiness', weight: 1 },
    ],
    default_indicators: [
      { key: 'applications', name_ar: 'الطلبات المستلمة', name_en: 'Applications received', indicator_type: 'operational', chain_level: 'activity', unit: 'count', direction: 'increase', measurement_points: ['T1'] },
      { key: 'graduates', name_ar: 'الخريجون', name_en: 'Graduates', indicator_type: 'output', chain_level: 'output', unit: 'count', direction: 'increase', measurement_points: ['T1'] },
      { key: 'readiness_gain', name_ar: 'التحسن في الجاهزية الوظيفية', name_en: 'Job-readiness gain', indicator_type: 'outcome', chain_level: 'outcome', outcome_term: 'short', unit: 'score', direction: 'increase', measurement_points: PP },
      { key: 'placement_rate', name_ar: 'نسبة التسكين', name_en: 'Placement rate', indicator_type: 'outcome', chain_level: 'outcome', outcome_term: 'medium', unit: 'percent', direction: 'increase', measurement_points: ['T2'] },
      { key: 'retention_12m', name_ar: 'نسبة الاحتفاظ بعد 12 شهرًا', name_en: '12-month retention', indicator_type: 'impact', chain_level: 'impact', outcome_term: 'long', unit: 'percent', direction: 'increase', measurement_points: ['T5'] },
    ],
    report_sections: ['executive_summary', 'program_information', 'target_group', 'execution', 'participation', 'evaluation', 'maturity', 'outputs', 'outcomes', 'impact', 'success_stories', 'challenges', 'lessons_learned', 'recommendations', 'appendices'],
    session_types: ['training', 'mentoring', 'coaching', 'assessment', 'orientation'],
  },
];

export const TRACK_BY_CODE: Record<string, TrackDef> = Object.fromEntries(TRACKS.map((tr) => [tr.code, tr]));

export const MATURITY_LEVELS = [
  { level: 1, ar: 'مبتدئ', en: 'Initial', desc_ar: 'ممارسات غير منتظمة تعتمد على المبادرة الفردية', desc_en: 'Ad-hoc practice dependent on individual initiative' },
  { level: 2, ar: 'نامٍ', en: 'Developing', desc_ar: 'ممارسات أساسية موجودة لكنها غير متسقة', desc_en: 'Basic practice exists but is inconsistent' },
  { level: 3, ar: 'متمكن', en: 'Established', desc_ar: 'ممارسات مستقرة ومطبقة باتساق', desc_en: 'Stable practice applied consistently' },
  { level: 4, ar: 'متقدم', en: 'Advanced', desc_ar: 'ممارسات مقاسة تُحسَّن بناءً على البيانات', desc_en: 'Measured practice improved using data' },
  { level: 5, ar: 'رائد', en: 'Leading', desc_ar: 'ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين', desc_en: 'Exemplary, transferable practice that influences others' },
] as const;

export const MEASUREMENT_POINTS = [
  { key: 'T0', ar: 'خط الأساس', en: 'Baseline', offsetDays: null },
  { key: 'T1', ar: 'نهاية البرنامج', en: 'Program end', offsetDays: 0 },
  { key: 'T2', ar: 'بعد 30 يومًا', en: '30 days', offsetDays: 30 },
  { key: 'T3', ar: 'بعد 3 أشهر', en: '3 months', offsetDays: 90 },
  { key: 'T4', ar: 'بعد 6 أشهر', en: '6 months', offsetDays: 182 },
  { key: 'T5', ar: 'بعد 12 شهرًا', en: '12 months', offsetDays: 365 },
] as const;
export type MeasurementPoint = 'T0' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5';
