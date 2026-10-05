// Report composition: turns a program bundle into structured, bilingual report
// sections. Narratives are generated from data by rules; Edge Functions may add
// an LLM-drafted narrative on top, which is always marked as a draft.
import { type L10n, type ProgramBundle, l, roundTo } from './types.ts';
import { TRACK_BY_CODE } from './tracks.ts';
import { programHealth } from './health.ts';
import { compareMaturity } from './maturity.ts';
import { assessClaim, elapsedShare, indicatorPerformance, resultsChainCompleteness } from './impact.ts';
import { evidenceCompleteness } from './evidence.ts';

export type ReportType = 'executive' | 'progress' | 'attendance_delivery' | 'beneficiaries' | 'experts' | 'evaluation_quality'
  | 'maturity' | 'outputs' | 'outcomes' | 'impact' | 'evidence' | 'closure' | 'final_comprehensive';

export const REPORT_TYPES: { key: ReportType; ar: string; en: string }[] = [
  { key: 'executive', ar: 'تقرير تنفيذي', en: 'Executive' },
  { key: 'progress', ar: 'تقرير تقدم', en: 'Progress' },
  { key: 'attendance_delivery', ar: 'الحضور والتنفيذ', en: 'Attendance & delivery' },
  { key: 'beneficiaries', ar: 'المستفيدون', en: 'Beneficiaries' },
  { key: 'experts', ar: 'الخبراء / المرشدون', en: 'Experts / mentors' },
  { key: 'evaluation_quality', ar: 'التقييم والجودة', en: 'Evaluation & quality' },
  { key: 'maturity', ar: 'النضج قبل/بعد', en: 'Maturity before/after' },
  { key: 'outputs', ar: 'المخرجات', en: 'Outputs' },
  { key: 'outcomes', ar: 'النتائج', en: 'Outcomes' },
  { key: 'impact', ar: 'الأثر', en: 'Impact' },
  { key: 'evidence', ar: 'الأدلة', en: 'Evidence' },
  { key: 'closure', ar: 'تقرير الإغلاق', en: 'Closure' },
  { key: 'final_comprehensive', ar: 'التقرير الختامي الشامل', en: 'Final comprehensive' },
];

export const SECTION_CATALOG: Record<string, L10n> = {
  executive_summary: l('الملخص التنفيذي', 'Executive summary'),
  program_information: l('معلومات البرنامج', 'Program information'),
  target_group: l('الفئة المستهدفة', 'Target group'),
  execution: l('التنفيذ', 'Execution'),
  participation: l('المشاركة والحضور', 'Participation'),
  experts: l('الخبراء والمرشدون', 'Experts & mentors'),
  evaluation: l('التقييم والجودة', 'Evaluation'),
  maturity: l('تطور النضج', 'Maturity development'),
  outputs: l('المخرجات', 'Outputs'),
  outcomes: l('النتائج', 'Outcomes'),
  impact: l('الأثر', 'Impact'),
  evidence: l('الأدلة', 'Evidence'),
  finance: l('الميزانية', 'Budget'),
  risks: l('المخاطر والقضايا', 'Risks & issues'),
  success_stories: l('قصص النجاح', 'Success stories'),
  challenges: l('التحديات', 'Challenges'),
  lessons_learned: l('الدروس المستفادة', 'Lessons learned'),
  recommendations: l('التوصيات', 'Recommendations'),
  appendices: l('الأدلة والملاحق', 'Evidence & appendices'),
};

export const DEFAULT_SECTIONS: Record<ReportType, string[]> = {
  executive: ['executive_summary', 'program_information', 'participation', 'outputs', 'outcomes', 'impact', 'risks', 'recommendations'],
  progress: ['executive_summary', 'execution', 'participation', 'outputs', 'risks', 'recommendations'],
  attendance_delivery: ['execution', 'participation', 'experts'],
  beneficiaries: ['target_group', 'participation', 'evaluation'],
  experts: ['experts'],
  evaluation_quality: ['evaluation', 'evidence'],
  maturity: ['maturity'],
  outputs: ['outputs', 'evidence'],
  outcomes: ['outcomes', 'evidence'],
  impact: ['impact', 'maturity', 'outcomes', 'evidence'],
  evidence: ['evidence', 'appendices'],
  closure: ['executive_summary', 'execution', 'outputs', 'outcomes', 'finance', 'challenges', 'lessons_learned', 'recommendations'],
  final_comprehensive: ['executive_summary', 'program_information', 'target_group', 'execution', 'participation', 'experts', 'evaluation', 'maturity',
    'outputs', 'outcomes', 'impact', 'finance', 'risks', 'success_stories', 'challenges', 'lessons_learned', 'recommendations', 'appendices'],
};

export interface ReportTable { columns: L10n[]; rows: (string | number | null)[][] }
export interface ReportSection {
  key: string; title: L10n; narrative: L10n[]; kpis?: { label: L10n; value: string | number | null; hint?: L10n }[];
  tables?: { title: L10n; table: ReportTable }[]; manual?: boolean;
}
export interface ReportContent {
  type: ReportType; title: L10n; program: { id: string; code: string; name: string; track: L10n; status: string; start_date: string | null; end_date: string | null };
  period: { start: string | null; end: string | null }; sections: ReportSection[]; generated_at: string;
  data_notes: L10n[];
}

const pct = (n: number, d: number) => (d ? roundTo((n / d) * 100, 1) : null);
const inPeriod = (iso: string, s: string | null, e: string | null) => (!s || iso.slice(0, 10) >= s) && (!e || iso.slice(0, 10) <= e);

export interface ReportOptions {
  sections?: string[]; period_start?: string | null; period_end?: string | null; detail_level?: 'summary' | 'detailed';
  manual_text?: Record<string, { ar?: string; en?: string }>; compare_from?: string; compare_to?: string; today?: Date;
}

export function buildReport(type: ReportType, b: ProgramBundle, opt: ReportOptions = {}): ReportContent {
  const today = opt.today ?? new Date();
  const p = b.program; const track = TRACK_BY_CODE[p.track_code];
  const sections = (opt.sections?.length ? opt.sections : DEFAULT_SECTIONS[type]).filter((s) => SECTION_CATALOG[s]);
  const ps = opt.period_start ?? null; const pe = opt.period_end ?? null;
  const detailed = opt.detail_level === 'detailed';
  const health = programHealth(b, today);
  const sessions = b.sessions.filter((s) => inPeriod(s.starts_at, ps, pe));
  const completed = sessions.filter((s) => s.status === 'completed');
  const sessIds = new Set(sessions.map((s) => s.id));
  const parts = b.participants.filter((x) => sessIds.has(x.session_id));
  const marked = parts.filter((x) => x.attendance_status !== 'unknown');
  const present = marked.filter((x) => ['present', 'late'].includes(x.attendance_status)).length;
  const enrolled = b.enrollments.filter((e) => !['withdrawn', 'dropped'].includes(e.status));
  const graduated = b.enrollments.filter((e) => ['graduated', 'completed'].includes(e.status)).length;
  const share = elapsedShare(p.start_date, p.end_date, today);
  const notes: L10n[] = [];
  const benName = (id: string | null) => b.beneficiaries.find((x) => x.id === id)?.full_name ?? '—';

  const build = (key: string): ReportSection => {
    const title = SECTION_CATALOG[key];
    const manual = opt.manual_text?.[key];
    const manualNarr = manual && (manual.ar || manual.en) ? [l(manual.ar ?? '', manual.en ?? manual.ar ?? '')] : [];
    switch (key) {
      case 'executive_summary': {
        const top = health.next_actions.slice(0, 3);
        return { key, title, kpis: [
          { label: l('مؤشر صحة البرنامج', 'Program health'), value: `${health.score}/100` },
          { label: l('المسجلون', 'Enrolled'), value: enrolled.length, hint: p.target_beneficiaries ? l(`المستهدف ${p.target_beneficiaries}`, `Target ${p.target_beneficiaries}`) : undefined },
          { label: l('الجلسات المكتملة', 'Sessions completed'), value: completed.length },
          { label: l('نسبة الحضور', 'Attendance'), value: pct(present, marked.length) === null ? '—' : `${pct(present, marked.length)}%` },
          { label: l('اكتمال الرحلة', 'Journey completion'), value: `${health.metrics.stages_completed}/${health.metrics.stages_total}` },
        ], narrative: [
          l(`يُنفَّذ برنامج «${p.name}» ضمن مسار ${track?.name_ar ?? p.track_code}${share !== null ? `، وقد مضى ${Math.round(share * 100)}% من مدته` : ''}. سُجّل ${enrolled.length} مستفيدًا ونُفّذت ${completed.length} جلسة.`,
            `“${p.name}” runs on the ${track?.name_en ?? p.track_code} track${share !== null ? `, ${Math.round(share * 100)}% through its period` : ''}. ${enrolled.length} beneficiaries are enrolled and ${completed.length} sessions were delivered.`),
          ...(top.length ? [l(`أبرز ما يحتاج متابعة: ${top.map((t) => t.title.ar).join('؛ ')}.`, `Key attention points: ${top.map((t) => t.title.en).join('; ')}.`)] : []),
          ...manualNarr,
        ] };
      }
      case 'program_information':
        return { key, title, narrative: manualNarr, tables: [{ title, table: { columns: [l('البند', 'Item'), l('القيمة', 'Value')], rows: [
          ['Code', p.code], ['Track', track?.name_ar ?? p.track_code], ['Status', p.status], ['Start', p.start_date], ['End', p.end_date],
          ['Target beneficiaries', p.target_beneficiaries], ['Budget', p.budget_total],
        ] } }] };
      case 'target_group': {
        const byGender: Record<string, number> = {}; const byCity: Record<string, number> = {};
        for (const e of enrolled) {
          const bn = b.beneficiaries.find((x) => x.id === e.beneficiary_id);
          byGender[bn?.gender ?? 'unknown'] = (byGender[bn?.gender ?? 'unknown'] ?? 0) + 1;
          byCity[bn?.city ?? '—'] = (byCity[bn?.city ?? '—'] ?? 0) + 1;
        }
        return { key, title, narrative: [
          l(`الفئة المستهدفة وفق إطار الأثر: ${b.impactFramework?.target_population ?? 'غير محددة'}.`, `Target population per impact framework: ${b.impactFramework?.target_population ?? 'not defined'}.`), ...manualNarr],
          tables: [
            { title: l('حسب الجنس', 'By gender'), table: { columns: [l('الجنس', 'Gender'), l('العدد', 'Count')], rows: Object.entries(byGender) } },
            { title: l('حسب المدينة', 'By city'), table: { columns: [l('المدينة', 'City'), l('العدد', 'Count')], rows: Object.entries(byCity).sort((a, c) => c[1] - a[1]).slice(0, 15) } },
          ] };
      }
      case 'execution':
        return { key, title, kpis: [
          { label: l('المراحل المكتملة', 'Stages completed'), value: `${health.metrics.stages_completed}/${health.metrics.stages_total}` },
          { label: l('الجلسات المكتملة', 'Sessions completed'), value: completed.length },
          { label: l('الجلسات الملغاة', 'Sessions cancelled'), value: sessions.filter((s) => s.status === 'cancelled').length },
        ], narrative: [
          l(`المراحل الجارية: ${b.stages.filter((s) => s.status === 'in_progress').map((s) => s.name_ar).join('، ') || 'لا يوجد'}. المراحل المتوقفة: ${b.stages.filter((s) => s.status === 'blocked').map((s) => s.name_ar).join('، ') || 'لا يوجد'}.`,
            `In progress: ${b.stages.filter((s) => s.status === 'in_progress').map((s) => s.name_en ?? s.name_ar).join(', ') || 'none'}. Blocked: ${b.stages.filter((s) => s.status === 'blocked').map((s) => s.name_en ?? s.name_ar).join(', ') || 'none'}.`),
          ...manualNarr],
          tables: [{ title: l('حالة الرحلة', 'Journey status'), table: { columns: [l('المرحلة', 'Stage'), l('الحالة', 'Status'), l('التقدم', 'Progress')],
            rows: b.stages.sort((a, c) => a.stage_order - c.stage_order).map((s) => [s.name_ar, s.status, `${s.progress}%`]) } }] };
      case 'participation': {
        const byType: Record<string, number> = {};
        for (const s of completed) byType[s.session_type] = (byType[s.session_type] ?? 0) + 1;
        return { key, title, kpis: [
          { label: l('المسجلون', 'Enrolled'), value: enrolled.length },
          { label: l('الخريجون / المكملون', 'Graduated / completed'), value: graduated },
          { label: l('المنسحبون', 'Withdrawn / dropped'), value: b.enrollments.filter((e) => ['withdrawn', 'dropped'].includes(e.status)).length },
          { label: l('نسبة الحضور', 'Attendance rate'), value: pct(present, marked.length) === null ? '—' : `${pct(present, marked.length)}%` },
        ], narrative: marked.length ? manualNarr : [l('لا توجد بيانات حضور مسجلة في الفترة.', 'No attendance recorded in the period.'), ...manualNarr],
          tables: [{ title: l('الجلسات حسب النوع', 'Sessions by type'), table: { columns: [l('النوع', 'Type'), l('العدد', 'Count')], rows: Object.entries(byType) } }] };
      }
      case 'experts': {
        const rows = b.experts.map((e) => {
          const as = b.assignments.filter((a) => a.expert_id === e.id);
          const hrs = as.reduce((a, x) => a + Number(x.delivered_hours), 0);
          const rating = as.filter((x) => x.performance_rating !== null);
          return [e.full_name, as.map((a) => a.role).join(', '), roundTo(hrs, 1), rating.length ? roundTo(rating.reduce((a, x) => a + Number(x.performance_rating), 0) / rating.length, 2) : null];
        }).filter((r) => r[1]);
        return { key, title, narrative: manualNarr, tables: [{ title, table: { columns: [l('الخبير', 'Expert'), l('الأدوار', 'Roles'), l('الساعات المنفذة', 'Hours delivered'), l('التقييم', 'Rating')], rows } }] };
      }
      case 'evaluation': {
        const res = b.results.filter((r) => r.status !== 'rejected');
        const scores = res.map((r) => r.normalized_score).filter((x): x is number => x !== null);
        const passed = res.filter((r) => r.passed === true).length;
        return { key, title, kpis: [
          { label: l('عدد التقييمات', 'Assessments'), value: res.length },
          { label: l('متوسط الدرجة المعيارية', 'Mean normalized score'), value: scores.length ? roundTo(scores.reduce((a, x) => a + x, 0) / scores.length, 1) : '—' },
          { label: l('نسبة الاجتياز', 'Pass rate'), value: res.length ? `${pct(passed, res.filter((r) => r.passed !== null).length) ?? '—'}%` : '—' },
          { label: l('المتحقق منها', 'Verified'), value: res.filter((r) => r.status === 'verified').length },
        ], narrative: manualNarr };
      }
      case 'maturity': {
        const fw = b.maturityFrameworks[0];
        if (!fw) return { key, title, narrative: [l('لا يوجد إطار نضج مرتبط بالبرنامج.', 'No maturity framework linked.')] };
        const cmp = compareMaturity(fw, b.maturityAssessments, opt.compare_from ?? 'T0', opt.compare_to ?? 'T1');
        return { key, title, kpis: [
          { label: l(`المتوسط ${cmp.from}`, `Mean ${cmp.from}`), value: cmp.overall_before ?? '—' },
          { label: l(`المتوسط ${cmp.to}`, `Mean ${cmp.to}`), value: cmp.overall_after ?? '—' },
          { label: l('التغير', 'Change'), value: cmp.overall_change ?? '—' },
          { label: l('العينة المقترنة', 'Paired n'), value: cmp.paired },
        ], narrative: [...cmp.interpretation, ...manualNarr],
          tables: [{ title: l('الحركة حسب البعد', 'Movement by dimension'), table: { columns: [l('البعد', 'Dimension'), l('قبل', 'Before'), l('بعد', 'After'), l('التغير', 'Change'), l('تحسن', 'Improved'), l('تراجع', 'Declined')],
            rows: cmp.dimensions.map((d) => [d.name.ar, d.before, d.after, d.change, d.improved, d.declined]) } }] };
      }
      case 'outputs':
        return { key, title, narrative: [l('المخرجات تقيس حجم ما نُفّذ، ولا تعني بحد ذاتها تحقق النتائج.', 'Outputs measure delivery volume; they do not by themselves mean outcomes were achieved.'), ...manualNarr],
          tables: [{ title, table: { columns: [l('الرمز', 'Code'), l('الوصف', 'Description'), l('المستهدف', 'Target'), l('الفعلي', 'Actual'), l('الإنجاز', 'Achievement'), l('الحالة', 'Status')],
            rows: b.outputs.map((o) => [o.code, o.description, o.target, o.actual, o.target ? `${pct(o.actual, o.target)}%` : '—', o.status]) } }] };
      case 'outcomes': {
        const outcomeInd = b.indicators.filter((i) => i.indicator_type === 'outcome');
        return { key, title, narrative: manualNarr, tables: [
          { title: l('النتائج المسجلة', 'Recorded outcomes'), table: { columns: [l('الرمز', 'Code'), l('الوصف', 'Description'), l('خط الأساس', 'Baseline'), l('المستهدف', 'Target'), l('الفعلي', 'Actual'), l('الحالة', 'Status')],
            rows: b.outcomes.map((o) => [o.code, o.description, o.baseline, o.target, o.actual, o.status]) } },
          { title: l('مؤشرات النتائج', 'Outcome indicators'), table: { columns: [l('المؤشر', 'Indicator'), l('خط الأساس', 'Baseline'), l('آخر قيمة', 'Latest'), l('المستهدف', 'Target'), l('الحالة', 'Status')],
            rows: outcomeInd.map((i) => { const perf = indicatorPerformance(i, b.measurements, share); return [`${i.code} ${i.name}`, perf.baseline, perf.latest, perf.target, perf.status]; }) } },
        ] };
      }
      case 'impact': {
        const chain = resultsChainCompleteness(b.impactFramework, b.indicators);
        const claims = b.indicators.filter((i) => i.indicator_type === 'impact' || i.indicator_type === 'outcome').map((i) => ({ i, c: assessClaim(i, b.measurements, b.evidence, b.impactFramework) }));
        return { key, title, kpis: [
          { label: l('اكتمال سلسلة النتائج', 'Results chain completeness'), value: `${chain.score}%` },
          { label: l('تصميم التقييم', 'Evaluation design'), value: b.impactFramework?.evaluation_design ?? '—' },
        ], narrative: [
          l(`المشكلة: ${b.impactFramework?.problem_statement ?? 'غير محددة'}. الأثر المقصود: ${b.impactFramework?.intended_impact ?? 'غير محدد'}.`,
            `Problem: ${b.impactFramework?.problem_statement ?? 'not defined'}. Intended impact: ${b.impactFramework?.intended_impact ?? 'not defined'}.`),
          ...claims.map(({ c }) => c.allowed_statement),
          l('تميّز المنصة بين التغير المُلاحظ والمساهمة والدليل السببي الأقوى؛ لا يُعد الفرق القبلي/البعدي وحده إثباتًا لأثر سببي.', 'The platform distinguishes observed change, contribution and stronger causal evidence; a pre/post difference alone is not proof of causal impact.'),
          ...manualNarr],
          tables: [{ title: l('مستوى الادعاء لكل مؤشر', 'Claim level per indicator'), table: { columns: [l('المؤشر', 'Indicator'), l('التغير المُلاحظ', 'Observed change'), l('فرق الفروق', 'Diff-in-diff'), l('مستوى الدليل', 'Evidence level')],
            rows: claims.map(({ i, c }) => [`${i.code} ${i.name}`, c.observed_change, c.difference_in_differences, c.label.ar]) } }] };
      }
      case 'evidence': {
        const ev = evidenceCompleteness(b);
        return { key, title, kpis: [
          { label: l('اكتمال الأدلة', 'Evidence completeness'), value: `${ev.score}%` },
          { label: l('إجمالي الأدلة', 'Evidence items'), value: b.evidence.length },
          { label: l('المتحقق منها', 'Verified'), value: b.evidence.filter((e) => e.verification_status === 'verified').length },
        ], narrative: [...ev.missing.slice(0, detailed ? 50 : 6).map((m) => m.label), ...manualNarr] };
      }
      case 'finance': {
        const planned = b.budgets.reduce((a, x) => a + Number(x.planned_amount), 0);
        const actual = b.budgets.reduce((a, x) => a + Number(x.actual_amount), 0);
        return { key, title, kpis: [
          { label: l('المخطط', 'Planned'), value: planned }, { label: l('الفعلي', 'Actual'), value: actual },
          { label: l('نسبة الصرف', 'Burn'), value: planned ? `${pct(actual, planned)}%` : '—' },
        ], narrative: manualNarr, tables: [{ title, table: { columns: [l('البند', 'Category'), l('المخطط', 'Planned'), l('الملتزم', 'Committed'), l('الفعلي', 'Actual')],
          rows: b.budgets.map((x) => [x.category, x.planned_amount, x.committed_amount, x.actual_amount]) } }] };
      }
      case 'risks':
        return { key, title, narrative: manualNarr, tables: [{ title, table: { columns: [l('الرمز', 'Code'), l('العنوان', 'Title'), l('الخطورة', 'Severity'), l('الحالة', 'Status')],
          rows: b.risks.filter((r) => r.status !== 'closed').sort((a, c) => c.severity - a.severity).map((r) => [r.code, r.title, r.severity, r.status]) } }] };
      case 'recommendations':
        return { key, title, narrative: [...health.next_actions.map((i) => l(`${i.recommended_action.ar} (${i.title.ar})`, `${i.recommended_action.en} (${i.title.en})`)), ...manualNarr] };
      case 'success_stories': {
        const best = b.maturityAssessments.length && b.maturityFrameworks[0]
          ? compareMaturity(b.maturityFrameworks[0], b.maturityAssessments).per_subject.filter((s) => s.change !== null).sort((a, c) => (c.change! - a.change!)).slice(0, 3)
          : [];
        return { key, title, manual: true, narrative: [
          ...best.map((s) => l(`مرشح لقصة نجاح: ${benName(s.subject_id)} (تحسن +${s.change} في النضج).`, `Success story candidate: ${benName(s.subject_id)} (+${s.change} maturity).`)),
          ...(manualNarr.length ? manualNarr : [l('أضف قصص النجاح الموثقة بأدلة (شهادات، منتجات، توظيف).', 'Add evidence-backed success stories (testimonials, products, employment).')]),
        ] };
      }
      case 'challenges':
        return { key, title, manual: true, narrative: [...b.risks.filter((r) => r.kind === 'issue').slice(0, 5).map((r) => l(r.title, r.title)), ...b.stages.filter((s) => s.status === 'blocked').map((s) => l(`${s.name_ar}: ${s.blocker_note ?? ''}`, `${s.name_en ?? s.name_ar}: ${s.blocker_note ?? ''}`)), ...manualNarr] };
      case 'lessons_learned':
        return { key, title, manual: true, narrative: manualNarr.length ? manualNarr : [l('يُستكمل يدويًا من فريق البرنامج.', 'To be completed by the program team.')] };
      case 'appendices':
        return { key, title, narrative: [], tables: [{ title: l('سجل الأدلة', 'Evidence register'), table: { columns: [l('الرمز', 'Code'), l('العنوان', 'Title'), l('النوع', 'Type'), l('التحقق', 'Verification')],
          rows: b.evidence.slice(0, detailed ? 500 : 50).map((e) => [e.code, e.title, e.evidence_type, e.verification_status]) } }] };
      default:
        return { key, title, narrative: manualNarr };
    }
  };

  if (!b.measurements.length) notes.push(l('لا توجد قياسات مؤشرات بعد؛ أقسام النتائج والأثر محدودة.', 'No indicator measurements yet; outcome and impact sections are limited.'));
  if (b.evidence.length && b.evidence.filter((e) => e.verification_status === 'verified').length / b.evidence.length < 0.5)
    notes.push(l('أقل من نصف الأدلة متحقق منها.', 'Less than half of the evidence is verified.'));

  const rt = REPORT_TYPES.find((r) => r.key === type)!;
  return {
    type, title: l(`${rt.ar} — ${p.name}`, `${rt.en} — ${p.name}`),
    program: { id: p.id, code: p.code, name: p.name, track: l(track?.name_ar ?? p.track_code, track?.name_en ?? p.track_code), status: p.status, start_date: p.start_date, end_date: p.end_date },
    period: { start: ps, end: pe }, sections: sections.map(build), generated_at: today.toISOString(), data_notes: notes,
  };
}
