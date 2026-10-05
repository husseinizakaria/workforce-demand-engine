// Generates supabase/migrations/20261005000800_reference_data.sql from the
// engine definitions so the database and the app never drift.
// Run: node --experimental-strip-types scripts/generate-reference-seed.ts
import { writeFileSync } from 'node:fs';
import { MATURITY_LEVELS, TRACKS } from '../supabase/functions/_shared/engine/tracks.ts';
import { DEFAULT_BANDS } from '../supabase/functions/_shared/engine/scoring.ts';

const q = (s: string | null | undefined) => (s === null || s === undefined ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
const j = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`;
const arr = (xs: string[]) => `array[${xs.map(q).join(',')}]::text[]`;

export const MODULES: { key: string; ar: string; en: string }[] = [
  { key: 'programs', ar: 'البرامج', en: 'Programs' }, { key: 'beneficiaries', ar: 'المستفيدون', en: 'Beneficiaries' },
  { key: 'experts', ar: 'الخبراء', en: 'Experts' }, { key: 'vendors', ar: 'الموردون', en: 'Vendors' },
  { key: 'partners', ar: 'الشركاء', en: 'Partners' }, { key: 'operations', ar: 'التشغيل والجدولة', en: 'Operations' },
  { key: 'assessments', ar: 'التقييم والجودة', en: 'Assessments' }, { key: 'evidence', ar: 'الأدلة والوثائق', en: 'Evidence' },
  { key: 'outcomes', ar: 'المخرجات والنتائج', en: 'Outputs & outcomes' }, { key: 'impact', ar: 'الأثر', en: 'Impact' },
  { key: 'templates', ar: 'القوالب والنماذج', en: 'Templates & forms' }, { key: 'reports', ar: 'التقارير', en: 'Reports' },
  { key: 'governance', ar: 'الحوكمة', en: 'Governance' }, { key: 'notifications', ar: 'الإشعارات', en: 'Notifications' },
  { key: 'users', ar: 'المستخدمون', en: 'Users' },
];
export const ACTIONS: { key: string; ar: string; en: string }[] = [
  { key: 'view', ar: 'عرض', en: 'View' }, { key: 'create', ar: 'إنشاء', en: 'Create' }, { key: 'edit', ar: 'تعديل', en: 'Edit' },
  { key: 'delete', ar: 'حذف', en: 'Delete' }, { key: 'approve', ar: 'اعتماد', en: 'Approve' }, { key: 'assign', ar: 'إسناد', en: 'Assign' },
  { key: 'export', ar: 'تصدير', en: 'Export' }, { key: 'configure', ar: 'تهيئة', en: 'Configure' }, { key: 'verify', ar: 'تحقق', en: 'Verify' },
];

type Bundle = Record<string, string[]>; // module -> actions ('*' = all)
const ALL = ['*'];
const RW = ['view', 'create', 'edit', 'export'];
export const ROLE_TEMPLATES: { code: string; ar: string; en: string; desc: string; bundle: Bundle }[] = [
  { code: 'org_admin', ar: 'مدير المؤسسة', en: 'Organization Admin', desc: 'إدارة المؤسسة ومستخدميها وبرامجها وإعداداتها',
    bundle: Object.fromEntries(MODULES.map((m) => [m.key, ALL])) },
  { code: 'program_manager', ar: 'مدير البرامج', en: 'Program Manager', desc: 'إدارة البرامج والرحلات والمستفيدين والتقارير',
    bundle: { programs: ALL, beneficiaries: ['view', 'create', 'edit', 'export', 'assign'], experts: ['view', 'create', 'edit', 'assign', 'export'],
      vendors: ['view', 'export'], partners: RW, operations: ALL, assessments: ['view', 'export'], evidence: ['view', 'create', 'export'],
      outcomes: ALL, impact: ['view', 'export'], templates: ['view', 'create', 'edit'], reports: ['view', 'create', 'edit', 'export'],
      governance: ['view', 'create'], notifications: ['view', 'create'], users: ['view'] } },
  { code: 'operations_manager', ar: 'مدير التشغيل', en: 'Operations Manager', desc: 'الجدولة والجلسات والحضور والإسنادات والموردين',
    bundle: { operations: ALL, programs: ['view', 'edit'], beneficiaries: ['view', 'create', 'edit', 'export'], experts: ['view', 'create', 'edit', 'assign', 'export'],
      vendors: ALL, partners: ['view'], evidence: ['view', 'create'], notifications: ['view', 'create', 'configure'], governance: ['view'], reports: ['view'] } },
  { code: 'impact_officer', ar: 'مسؤول القياس والأثر', en: 'Impact / Measurement Officer', desc: 'المؤشرات والنضج والأثر والأدلة',
    bundle: { impact: ALL, outcomes: ALL, assessments: ['view', 'create', 'edit', 'export'], evidence: ['view', 'create', 'edit', 'verify', 'export'],
      reports: ['view', 'create', 'edit', 'export'], programs: ['view'], beneficiaries: ['view'], operations: ['view'] } },
  { code: 'quality_officer', ar: 'مسؤول الجودة والتقييم', en: 'Quality / Assessment Officer', desc: 'أدوات التقييم والتحقق والجودة والنماذج',
    bundle: { assessments: ALL, evidence: ['view', 'create', 'edit', 'verify', 'approve', 'export'], templates: ALL, programs: ['view'],
      beneficiaries: ['view'], experts: ['view'], reports: ['view', 'export'], operations: ['view'] } },
  { code: 'reporting_officer', ar: 'مسؤول التقارير', en: 'Reporting Officer', desc: 'إعداد التقارير وإصداراتها وتصديرها',
    bundle: { reports: ['view', 'create', 'edit', 'export', 'delete'], programs: ['view'], beneficiaries: ['view'], outcomes: ['view', 'export'], impact: ['view', 'export'],
      assessments: ['view', 'export'], evidence: ['view', 'export'], governance: ['view'], operations: ['view'], experts: ['view'] } },
  { code: 'program_coordinator', ar: 'منسق برنامج', en: 'Program Coordinator', desc: 'متابعة المستفيدين والجلسات والوثائق',
    bundle: { programs: ['view', 'create', 'edit'], beneficiaries: ['view', 'create', 'edit'], operations: ['view', 'create', 'edit'], evidence: ['view', 'create'],
      templates: ['view'], experts: ['view'], outcomes: ['view', 'edit'], notifications: ['view'] } },
  { code: 'expert', ar: 'خبير / مدرب / مرشد / محكّم', en: 'Expert / Trainer / Mentor / Judge', desc: 'الوصول إلى التكليفات والجلسات المصرح بها فقط',
    bundle: { evidence: ['create'] } },
  { code: 'beneficiary', ar: 'مستفيد', en: 'Beneficiary', desc: 'الوصول إلى رحلته ونماذجه ومواعيده فقط',
    bundle: { evidence: ['create'] } },
  { code: 'viewer', ar: 'مشاهد / مدقق', en: 'Viewer / Auditor', desc: 'قراءة وتصدير البيانات والتقارير وسجل التدقيق',
    bundle: Object.fromEntries(MODULES.map((m) => [m.key, ['view', 'export']])) },
];

const TOC: Record<string, Record<string, string[]> & { problem: string[]; population: string[]; impact_text: string[] }> = {
  hackathon: { problem: ['ضعف تحويل الأفكار المبتكرة إلى حلول قابلة للتنفيذ لتحديات مجتمعية محددة'], population: ['شباب ومبتكرون ورواد أعمال ناشئون'],
    impact_text: ['حلول مبتكرة مستدامة تعالج تحديات مجتمعية'],
    inputs: ['تمويل ورعاة', 'تحديات من جهات مالكة', 'مرشدون ومحكّمون', 'منصة ومكان'], activities: ['ورش تمكين', 'إرشاد الفرق', 'تحكيم', 'متابعة ما بعد الهاكاثون'],
    outputs: ['فرق مكتملة', 'نماذج أولية', 'عروض نهائية'], outcomes_short: ['تحسن مهارات الابتكار والعمل الجماعي', 'نماذج أولية قابلة للاختبار'],
    outcomes_medium: ['مشاريع مستمرة بعد 6 أشهر', 'شراكات مع ملاك التحديات'], outcomes_long: ['مشاريع ناشئة مسجلة'], impact: ['حلول مطبقة لتحديات مجتمعية'],
    assumptions: ['توفر مرشدين مؤهلين', 'التزام الفرق بعد الحدث'], external_factors: ['توفر تمويل لاحق', 'بيئة تنظيمية داعمة'] },
  incubator: { problem: ['ارتفاع تعثر المشاريع الناشئة في سنواتها الأولى'], population: ['رواد أعمال ومشاريع ناشئة في مرحلة مبكرة'], impact_text: ['مشاريع مستدامة تخلق وظائف وقيمة اقتصادية'],
    inputs: ['مساحة احتضان', 'خبراء ومرشدون', 'تمويل تشغيلي'], activities: ['تشخيص الأعمال', 'خطط احتضان', 'إرشاد واستشارات', 'تحقق سوقي'],
    outputs: ['مشاريع محتضنة', 'ساعات إرشاد', 'نماذج أولية'], outcomes_short: ['نماذج عمل أوضح', 'MVP مختبر'], outcomes_medium: ['عملاء دافعون وإيرادات'],
    outcomes_long: ['نمو وتوظيف'], impact: ['وظائف مستحدثة ومشاريع مستدامة'], assumptions: ['التزام المؤسسين', 'جودة الإرشاد'], external_factors: ['الظروف الاقتصادية', 'الوصول للتمويل'] },
  vocational: { problem: ['فجوة المهارات المهنية والحرفية المطلوبة لسوق العمل'], population: ['باحثون عن عمل وحرفيون ناشئون'], impact_text: ['دخل مستدام من العمل أو الحرفة'],
    inputs: ['مدربون', 'ورش ومعدات', 'مواد خام'], activities: ['تدريب نظري وعملي', 'قياس مهارة', 'منتج عملي', 'اعتماد'],
    outputs: ['ساعات تدريب', 'متدربون معتمدون', 'منتجات عملية'], outcomes_short: ['تحسن المهارة العملية'], outcomes_medium: ['التحاق بعمل أو ممارسة الحرفة'],
    outcomes_long: ['استقرار الدخل'], impact: ['تحسن مستوى المعيشة'], assumptions: ['طلب سوقي على المهارة'], external_factors: ['توفر فرص العمل محليًا'] },
  consulting: { problem: ['ضعف القدرات المؤسسية والإدارية لدى الجهات المستفيدة'], population: ['منشآت صغيرة ومتوسطة وجهات غير ربحية'], impact_text: ['تحسن مستدام في الأداء المؤسسي'],
    inputs: ['مستشارون', 'أدوات تشخيص'], activities: ['تشخيص', 'جلسات استشارية', 'خطط عمل', 'متابعة'], outputs: ['جلسات منفذة', 'خطط عمل معتمدة'],
    outcomes_short: ['تطبيق التوصيات'], outcomes_medium: ['تحسن مؤشرات الأداء'], outcomes_long: ['استدامة التحسن'], impact: ['منشآت أكثر قدرة واستدامة'],
    assumptions: ['التزام الإدارة بالتطبيق'], external_factors: ['تغيرات السوق والتنظيم'] },
  bootcamp: { problem: ['فجوة بين التعليم الأكاديمي والمهارات التطبيقية المطلوبة'], population: ['طلاب وخريجون وباحثون عن عمل'], impact_text: ['جاهزية وظيفية وتوظيف في مجالات الطلب'],
    inputs: ['مدربون', 'منهج', 'منصة تعلم'], activities: ['جلسات مكثفة', 'مشاريع تطبيقية', 'تقييمات'], outputs: ['متخرجون', 'مشاريع مكتملة'],
    outcomes_short: ['تحسن المهارة والتطبيق'], outcomes_medium: ['توظيف خلال 3 أشهر'], outcomes_long: ['تقدم مهني'], impact: ['زيادة التوظيف في التخصص'],
    assumptions: ['التزام المشاركين'], external_factors: ['طلب سوق العمل'] },
  graduate: { problem: ['ضعف الجاهزية الوظيفية للخريجين الجدد لأدوار محددة'], population: ['خريجون جدد'], impact_text: ['كوادر جاهزة ومستقرة في وظائف الجهة'],
    inputs: ['احتياج وظيفي معتمد', 'مرشدون ومدربون', 'إدارات مستضيفة'], activities: ['استقطاب واختيار', 'IDP', 'تعلم', 'تدوير', 'إرشاد', 'مشاريع'],
    outputs: ['خريجون أكملوا البرنامج', 'خطط تطوير منفذة'], outcomes_short: ['تحسن الجدارات والجاهزية'], outcomes_medium: ['تسكين في الوظائف'],
    outcomes_long: ['احتفاظ وأداء بعد 12 شهرًا'], impact: ['خفض فجوة المواهب لدى الجهة'], assumptions: ['توفر وظائف شاغرة', 'دعم المديرين'], external_factors: ['تغير الهيكل التنظيمي'] },
};

function levels() {
  return Object.fromEntries(MATURITY_LEVELS.map((lv) => [String(lv.level), { ar: `${lv.ar}: ${lv.desc_ar}`, en: `${lv.en}: ${lv.desc_en}` }]));
}

const out: string[] = [];
out.push('-- =============================================================================');
out.push('-- TANMIA — 0800 Reference data (GENERATED by scripts/generate-reference-seed.ts)');
out.push('-- Permissions catalog, platform role templates, the six program tracks, central');
out.push('-- maturity / impact / assessment / form templates. Idempotent.');
out.push('-- =============================================================================');
out.push('');
out.push('-- Permissions');
out.push('insert into public.permissions (code, module, action, name_ar, name_en) values');
out.push(MODULES.flatMap((m) => ACTIONS.map((a) => `  (${q(`${m.key}.${a.key}`)}, ${q(m.key)}, ${q(a.key)}, ${q(`${a.ar} ${m.ar}`)}, ${q(`${a.en} ${m.en}`)})`)).join(',\n'));
out.push('on conflict (code) do update set name_ar = excluded.name_ar, name_en = excluded.name_en;');
out.push('');
out.push('-- Platform role templates (organization_id is null) and their permission bundles');
for (const r of ROLE_TEMPLATES) {
  out.push(`insert into public.roles (organization_id, code, name_ar, name_en, description, is_system) values (null, ${q(r.code)}, ${q(r.ar)}, ${q(r.en)}, ${q(r.desc)}, true)`);
  out.push('on conflict (organization_id, code) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, description = excluded.description;');
  const conds = Object.entries(r.bundle).map(([m, acts]) => acts[0] === '*' ? `(p.module = ${q(m)})` : `(p.module = ${q(m)} and p.action in (${acts.map(q).join(',')}))`);
  out.push(`insert into public.role_permissions (role_id, permission_id) select r.id, p.id from public.roles r join public.permissions p on (${conds.join(' or ')})`);
  out.push(`where r.organization_id is null and r.code = ${q(r.code)} on conflict do nothing;`);
}
out.push('');
out.push('-- Program track templates');
for (const t of TRACKS) {
  const stages = t.stages.map((s, i) => ({ key: s.key, name_ar: s.name_ar, name_en: s.name_en, description_ar: s.description_ar, description_en: s.description_en,
    order: i + 1, depends_on: s.depends_on, required_evidence: s.required_evidence, requires_approval: s.requires_approval, record_types: s.record_types }));
  out.push(`insert into public.program_track_templates (code, name_ar, name_en, description_ar, description_en, stages, maturity_dimensions, default_indicators, report_sections, session_types) values (`);
  out.push(`  ${q(t.code)}, ${q(t.name_ar)}, ${q(t.name_en)}, ${q(t.description_ar)}, ${q(t.description_en)},`);
  out.push(`  ${j(stages)},\n  ${j(t.maturity_dimensions)},\n  ${j(t.default_indicators)},\n  ${j(t.report_sections)},\n  ${arr(t.session_types)})`);
  out.push('on conflict (code) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, description_ar = excluded.description_ar, description_en = excluded.description_en,');
  out.push('  stages = excluded.stages, maturity_dimensions = excluded.maturity_dimensions, default_indicators = excluded.default_indicators,');
  out.push('  report_sections = excluded.report_sections, session_types = excluded.session_types, version = public.program_track_templates.version + 1, updated_at = now();');
}
out.push('');
out.push('-- Central maturity frameworks (one per track)');
for (const t of TRACKS) {
  const dims = t.maturity_dimensions.map((d) => ({ ...d, levels: levels() }));
  out.push(`insert into public.maturity_frameworks (organization_id, code, name, name_en, track_code, description, scale_min, scale_max, weighted, dimensions, status)`);
  out.push(`select null, ${q('MAT-' + t.code.toUpperCase())}, ${q('إطار نضج — ' + t.name_ar)}, ${q('Maturity framework — ' + t.name_en)}, ${q(t.code)}, ${q('خمسة مستويات لكل بعد؛ يقاس عند T0 وT1 ونقاط المتابعة.')}, 1, 5, true, ${j(dims)}, 'active'`);
  out.push(`where not exists (select 1 from public.maturity_frameworks where organization_id is null and code = ${q('MAT-' + t.code.toUpperCase())});`);
}
out.push('');
out.push('-- Central impact framework templates (Theory of Change starters, one per track)');
for (const t of TRACKS) {
  const c = TOC[t.code];
  const toc = { inputs: c.inputs, activities: c.activities, outputs: c.outputs, outcomes_short: c.outcomes_short, outcomes_medium: c.outcomes_medium,
    outcomes_long: c.outcomes_long, impact: c.impact, assumptions: c.assumptions, external_factors: c.external_factors };
  out.push(`insert into public.impact_frameworks (organization_id, program_id, code, name, track_code, problem_statement, target_population, theory_of_change, intended_impact, evaluation_design, attribution_approach, status)`);
  out.push(`select null, null, ${q('IMP-' + t.code.toUpperCase())}, ${q('قالب نظرية تغيير — ' + t.name_ar)}, ${q(t.code)}, ${q(c.problem[0])}, ${q(c.population[0])}, ${j(toc)}, ${q(c.impact_text[0])}, 'pre_post', 'contribution', 'approved'`);
  out.push(`where not exists (select 1 from public.impact_frameworks where organization_id is null and code = ${q('IMP-' + t.code.toUpperCase())});`);
}
out.push('');

// Central assessment tools
const TOOLS = [
  { code: 'ASM-EMPLOYABILITY', name: 'جاهزية التوظيف', name_en: 'Employability readiness', tracks: ['graduate', 'bootcamp', 'vocational'],
    dims: [
      { code: 'D1', name: 'التواصل المهني', name_en: 'Professional communication', weight: 1, qs: [
        ['أعبّر عن أفكاري بوضوح في بيئة العمل', 'I express my ideas clearly at work', false],
        ['أكتب رسائل وتقارير مهنية منظمة', 'I write organized professional messages and reports', false],
        ['أجد صعوبة في عرض عملي أمام الآخرين', 'I find it hard to present my work to others', true]] },
      { code: 'D2', name: 'حل المشكلات', name_en: 'Problem solving', weight: 1.2, qs: [
        ['أحلل المشكلة قبل اقتراح الحلول', 'I analyze a problem before proposing solutions', false],
        ['أستخدم البيانات لاتخاذ القرار', 'I use data to make decisions', false],
        ['أتوقف عند أول عقبة دون بدائل', 'I stop at the first obstacle without alternatives', true]] },
      { code: 'D3', name: 'العمل الجماعي', name_en: 'Teamwork', weight: 1, qs: [
        ['أتعاون بفاعلية مع زملاء من خلفيات مختلفة', 'I collaborate effectively with diverse colleagues', false],
        ['ألتزم بنصيبي من مهام الفريق في الوقت المحدد', 'I deliver my share of team tasks on time', false]] },
      { code: 'D4', name: 'الانضباط المهني', name_en: 'Professional discipline', weight: 0.8, qs: [
        ['ألتزم بالمواعيد والتعليمات', 'I respect schedules and instructions', false],
        ['أدير وقتي وأولوياتي بفاعلية', 'I manage my time and priorities effectively', false]] },
    ] },
  { code: 'ASM-VENTURE', name: 'جاهزية المشروع الريادي', name_en: 'Venture readiness', tracks: ['incubator', 'hackathon'],
    dims: [
      { code: 'D1', name: 'وضوح المشكلة والعميل', name_en: 'Problem & customer clarity', weight: 1.2, qs: [
        ['المشكلة محددة ومثبتة بمقابلات عملاء', 'The problem is specific and validated with customer interviews', false],
        ['الشريحة المستهدفة محددة بدقة', 'The target segment is precisely defined', false]] },
      { code: 'D2', name: 'الحل والمنتج', name_en: 'Solution & product', weight: 1, qs: [
        ['يوجد نموذج أولي قابل للاختبار', 'A testable prototype exists', false],
        ['الحل يتميز بوضوح عن البدائل', 'The solution is clearly differentiated', false]] },
      { code: 'D3', name: 'نموذج العمل', name_en: 'Business model', weight: 1.2, qs: [
        ['مصادر الإيراد محددة ومختبرة', 'Revenue streams are defined and tested', false],
        ['تكلفة اكتساب العميل معروفة', 'Customer acquisition cost is known', false]] },
      { code: 'D4', name: 'الفريق', name_en: 'Team', weight: 1, qs: [
        ['الفريق يغطي المهارات الأساسية', 'The team covers core skills', false],
        ['الأدوار والمسؤوليات واضحة', 'Roles and responsibilities are clear', false]] },
    ] },
];
for (const tool of TOOLS) {
  out.push(`do $$ declare tid uuid; did uuid; begin`);
  out.push(`  if exists (select 1 from public.assessment_tools where organization_id is null and code = ${q(tool.code)}) then return; end if;`);
  out.push(`  insert into public.assessment_tools (organization_id, code, name, name_en, tool_type, subject_type, track_codes, scoring_method, scale_min, scale_max, pass_threshold, classification, status)`);
  out.push(`  values (null, ${q(tool.code)}, ${q(tool.name)}, ${q(tool.name_en)}, 'internal', 'individual', ${arr(tool.tracks)}, 'weighted_average', 1, 5, 60, ${j(DEFAULT_BANDS)}, 'active') returning id into tid;`);
  tool.dims.forEach((d, di) => {
    out.push(`  insert into public.assessment_dimensions (organization_id, tool_id, code, name, name_en, weight, sort_order, rubric) values (null, tid, ${q(d.code)}, ${q(d.name)}, ${q(d.name_en)}, ${d.weight}, ${di + 1}, ${j(MATURITY_LEVELS.map((lv) => ({ score: lv.level, label_ar: lv.ar, label_en: lv.en })))}) returning id into did;`);
    d.qs.forEach(([ar, en, rev], qi) => {
      out.push(`  insert into public.assessment_questions (organization_id, tool_id, dimension_id, code, text_ar, text_en, question_type, weight, reverse_scored, sort_order, translation_status) values (null, tid, did, ${q(`${d.code}Q${qi + 1}`)}, ${q(ar as string)}, ${q(en as string)}, 'scale', 1, ${rev ? 'true' : 'false'}, ${qi + 1}, 'verified');`);
    });
  });
  out.push(`end $$;`);
}
out.push('');
out.push('-- Central form templates');
const scale = (key: string, ar: string, en: string) => ({ key, type: 'rating', label_ar: ar, label_en: en, required: true, min: 1, max: 5, scoring: { weight: 1 } });
const forms = [
  { code: 'FRM-APPLICATION', title: 'نموذج تقديم عام', title_en: 'General application form', form_type: 'application', scoring: false, fields: [
    { key: 'motivation', type: 'long_text', label_ar: 'لماذا ترغب في الالتحاق بالبرنامج؟', label_en: 'Why do you want to join?', required: true },
    { key: 'education', type: 'single_choice', label_ar: 'المؤهل', label_en: 'Education', required: true, options: [
      { value: 'secondary', label_ar: 'ثانوي', label_en: 'Secondary' }, { value: 'diploma', label_ar: 'دبلوم', label_en: 'Diploma' },
      { value: 'bachelor', label_ar: 'بكالوريوس', label_en: 'Bachelor' }, { value: 'postgraduate', label_ar: 'دراسات عليا', label_en: 'Postgraduate' }] },
    { key: 'employed', type: 'single_choice', label_ar: 'هل تعمل حاليًا؟', label_en: 'Currently employed?', required: true, options: [
      { value: 'yes', label_ar: 'نعم', label_en: 'Yes' }, { value: 'no', label_ar: 'لا', label_en: 'No' }] },
    { key: 'employer', type: 'text', label_ar: 'جهة العمل', label_en: 'Employer', show_if: { field: 'employed', op: 'eq', value: 'yes' } },
    { key: 'cv', type: 'file', label_ar: 'السيرة الذاتية', label_en: 'CV' },
    { key: 'consent', type: 'acknowledgment', label_ar: 'أوافق على معالجة بياناتي لأغراض البرنامج وقياس الأثر', label_en: 'I consent to processing of my data for program and impact measurement', required: true },
  ] },
  { code: 'FRM-SESSION-FEEDBACK', title: 'تقييم الجلسة', title_en: 'Session feedback', form_type: 'feedback', scoring: true, fields: [
    scale('content', 'جودة المحتوى', 'Content quality'), scale('facilitator', 'أداء الميسّر', 'Facilitator'), scale('relevance', 'ارتباط الجلسة باحتياجي', 'Relevance to my needs'),
    { key: 'comments', type: 'long_text', label_ar: 'ملاحظات', label_en: 'Comments' },
  ] },
];
for (const f of forms) {
  out.push(`insert into public.form_templates (organization_id, code, title, title_en, form_type, schema, scoring_enabled, status)`);
  out.push(`select null, ${q(f.code)}, ${q(f.title)}, ${q(f.title_en)}, ${q(f.form_type)}, ${j({ fields: f.fields })}, ${f.scoring}, 'published'`);
  out.push(`where not exists (select 1 from public.form_templates where organization_id is null and code = ${q(f.code)});`);
}
out.push('');
out.push('-- Platform settings defaults');
out.push(`insert into public.system_settings (organization_id, setting_key, setting_value) values`);
out.push(`  (null, 'platform', ${j({ name_ar: 'نماء', name_en: 'TANMIA', default_locale: 'ar', timezone: 'Asia/Riyadh', invitation_ttl_days: 7, data_residency: 'SA' })}),`);
out.push(`  (null, 'measurement_points', ${j({ T0: 'baseline', T1: 0, T2: 30, T3: 90, T4: 182, T5: 365 })})`);
out.push(`on conflict (organization_id, setting_key) do nothing;`);
out.push(`insert into public.integration_settings (organization_id, provider, enabled, config) values`);
out.push(`  (null, 'email', false, '{}'::jsonb), (null, 'sms', false, '{}'::jsonb), (null, 'whatsapp', false, '{}'::jsonb), (null, 'calendar_ics', true, '{}'::jsonb), (null, 'ai', false, '{}'::jsonb)`);
out.push(`on conflict (organization_id, provider) do nothing;`);
out.push('');

const target = new URL('../supabase/migrations/20261005000800_reference_data.sql', import.meta.url);
writeFileSync(target, out.join('\n') + '\n');
console.log('wrote', target.pathname);
