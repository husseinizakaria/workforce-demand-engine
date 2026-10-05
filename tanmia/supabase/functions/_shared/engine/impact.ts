// Social impact engine: results chain completeness, indicator performance,
// anomalies, and evidence-strength classification. The engine never treats a
// simple pre/post difference as proof of causal impact.
import {
  type EvidenceLike, type ImpactFrameworkLike, type IndicatorLike, type L10n, type MeasurementLike, type TocKey,
  l, roundTo,
} from './types.ts';

export const TOC_KEYS: { key: TocKey; ar: string; en: string; required: boolean }[] = [
  { key: 'inputs', ar: 'المدخلات', en: 'Inputs', required: true },
  { key: 'activities', ar: 'الأنشطة', en: 'Activities', required: true },
  { key: 'outputs', ar: 'المخرجات', en: 'Outputs', required: true },
  { key: 'outcomes_short', ar: 'النتائج قصيرة المدى', en: 'Short-term outcomes', required: true },
  { key: 'outcomes_medium', ar: 'النتائج متوسطة المدى', en: 'Medium-term outcomes', required: false },
  { key: 'outcomes_long', ar: 'النتائج طويلة المدى', en: 'Long-term outcomes', required: false },
  { key: 'impact', ar: 'الأثر', en: 'Impact', required: true },
  { key: 'assumptions', ar: 'الافتراضات', en: 'Assumptions', required: true },
  { key: 'external_factors', ar: 'العوامل الخارجية', en: 'External factors', required: false },
];

export interface ChainGap { key: string; label: L10n; severity: 'high' | 'medium' | 'low' }
export interface ChainCompleteness { score: number; gaps: ChainGap[]; byLevel: Record<string, number> }

export function resultsChainCompleteness(fw: ImpactFrameworkLike | null, indicators: IndicatorLike[]): ChainCompleteness {
  const gaps: ChainGap[] = [];
  const byLevel: Record<string, number> = { operational: 0, output: 0, outcome: 0, impact: 0 };
  for (const i of indicators) if (i.status !== 'retired') byLevel[i.indicator_type] = (byLevel[i.indicator_type] ?? 0) + 1;
  if (!fw) {
    gaps.push({ key: 'framework', label: l('لا يوجد إطار أثر / نظرية تغيير للبرنامج', 'No impact framework / Theory of Change'), severity: 'high' });
  } else {
    if (!fw.problem_statement?.trim()) gaps.push({ key: 'problem_statement', label: l('المشكلة الاجتماعية غير محددة', 'Social problem not defined'), severity: 'high' });
    if (!fw.target_population?.trim()) gaps.push({ key: 'target_population', label: l('الفئة المستهدفة غير محددة', 'Target population not defined'), severity: 'high' });
    if (!fw.baseline_summary?.trim()) gaps.push({ key: 'baseline_summary', label: l('وصف خط الأساس غير موجود', 'Baseline description missing'), severity: 'medium' });
    for (const k of TOC_KEYS) {
      const items = fw.theory_of_change?.[k.key] ?? [];
      if (!items.filter((x) => String(x).trim()).length) {
        gaps.push({ key: k.key, label: l(`${k.ar}: غير معرّفة في نظرية التغيير`, `${k.en}: not defined in the Theory of Change`), severity: k.required ? 'medium' : 'low' });
      }
    }
  }
  if (!byLevel.output) gaps.push({ key: 'ind_output', label: l('لا توجد مؤشرات مخرجات', 'No output indicators'), severity: 'medium' });
  if (!byLevel.outcome) gaps.push({ key: 'ind_outcome', label: l('لا توجد مؤشرات نتائج', 'No outcome indicators'), severity: 'high' });
  if (!byLevel.impact) gaps.push({ key: 'ind_impact', label: l('لا توجد مؤشرات أثر', 'No impact indicators'), severity: 'medium' });
  for (const i of indicators) {
    if (i.status === 'retired') continue;
    if (i.indicator_type !== 'operational' && i.baseline_value === null && !i.measurement_points.includes('T0'))
      gaps.push({ key: `baseline:${i.id}`, label: l(`المؤشر ${i.code} بلا خط أساس`, `Indicator ${i.code} has no baseline`), severity: 'medium' });
    if (i.target_value === null) gaps.push({ key: `target:${i.id}`, label: l(`المؤشر ${i.code} بلا مستهدف`, `Indicator ${i.code} has no target`), severity: 'medium' });
    if (!i.data_source?.trim()) gaps.push({ key: `source:${i.id}`, label: l(`المؤشر ${i.code} بلا مصدر بيانات`, `Indicator ${i.code} has no data source`), severity: 'low' });
  }
  const weights = { high: 15, medium: 6, low: 2 };
  const score = Math.max(0, 100 - gaps.reduce((a, g) => a + weights[g.severity], 0));
  return { score, gaps, byLevel };
}

export type IndicatorStatus = 'no_data' | 'on_track' | 'at_risk' | 'off_track' | 'achieved';
export interface IndicatorPerformance {
  indicator_id: string; baseline: number | null; latest: number | null; latest_point: string | null; target: number | null;
  progress_pct: number | null; status: IndicatorStatus; measurements: number; anomalies: L10n[];
}

const POINT_ORDER = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'other'];
function sortMeasurements(ms: MeasurementLike[]): MeasurementLike[] {
  return [...ms].sort((a, b) => {
    const pa = POINT_ORDER.indexOf(a.measurement_point ?? 'other'); const pb = POINT_ORDER.indexOf(b.measurement_point ?? 'other');
    if (pa !== pb && a.measurement_point !== 'other' && b.measurement_point !== 'other') return pa - pb;
    return new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime();
  });
}

export function indicatorPerformance(ind: IndicatorLike, measurements: MeasurementLike[], elapsedShare: number | null = null): IndicatorPerformance {
  const ms = sortMeasurements(measurements.filter((m) => m.indicator_id === ind.id));
  const t0 = ms.find((m) => m.measurement_point === 'T0');
  const baseline = ind.baseline_value ?? t0?.value ?? null;
  const post = ms.filter((m) => m.measurement_point !== 'T0');
  const latestM = post.length ? post[post.length - 1] : (ms.length ? ms[ms.length - 1] : null);
  const latest = latestM?.value ?? null;
  const target = ind.target_value;
  const anomalies: L10n[] = [];

  if (ind.unit === 'percent') for (const m of ms) if (m.value < 0 || m.value > 100)
    anomalies.push(l(`قيمة نسبة خارج النطاق (${m.value}) في ${m.measurement_point ?? 'قياس'}`, `Percentage out of range (${m.value}) at ${m.measurement_point ?? 'measurement'}`));
  for (let i = 1; i < ms.length; i++) {
    const prev = ms[i - 1].value; const cur = ms[i].value;
    if (Math.abs(prev) > 0 && Math.abs(cur / prev) >= 3)
      anomalies.push(l(`قفزة غير معتادة من ${prev} إلى ${cur}`, `Unusual jump from ${prev} to ${cur}`));
    if (Math.abs(prev) > 0 && Math.abs(cur / prev) <= 1 / 3 && ind.direction === 'increase')
      anomalies.push(l(`هبوط حاد من ${prev} إلى ${cur}`, `Sharp drop from ${prev} to ${cur}`));
  }
  const dupPoints = ms.map((m) => m.measurement_point).filter((p, i, arr) => p && p !== 'other' && arr.indexOf(p) !== i);
  if (dupPoints.length) anomalies.push(l(`قياسات مكررة لنفس النقطة: ${[...new Set(dupPoints)].join('، ')}`, `Duplicate measurements for: ${[...new Set(dupPoints)].join(', ')}`));
  const smallSample = ms.filter((m) => m.sample_size !== null && (m.sample_size as number) < 10);
  if (smallSample.length) anomalies.push(l('بعض القياسات بعينة أقل من 10؛ التعميم محدود.', 'Some measurements have sample size < 10; limited generalizability.'));

  let progress_pct: number | null = null;
  let status: IndicatorStatus = 'no_data';
  if (latest !== null && target !== null) {
    if (ind.direction === 'maintain') {
      progress_pct = target === 0 ? null : roundTo((latest / target) * 100, 1);
      status = Math.abs(latest - target) <= Math.abs(target) * 0.05 ? 'achieved' : 'at_risk';
    } else {
      const base = baseline ?? 0;
      const span = target - base;
      if (span !== 0) progress_pct = roundTo(((latest - base) / span) * 100, 1);
      const achieved = ind.direction === 'increase' ? latest >= target : latest <= target;
      if (achieved) status = 'achieved';
      else if (progress_pct === null) status = 'at_risk';
      else {
        const expected = elapsedShare === null ? 100 : Math.min(100, elapsedShare * 100);
        status = progress_pct >= expected - 10 ? 'on_track' : progress_pct >= expected - 30 ? 'at_risk' : 'off_track';
        if (progress_pct < 0) status = 'off_track';
      }
    }
  } else if (latest !== null) {
    status = 'at_risk';
  }
  return { indicator_id: ind.id, baseline, latest, latest_point: latestM?.measurement_point ?? null, target, progress_pct, status, measurements: ms.length, anomalies };
}

// ---------------------------------------------------------------------------
// Evidence strength / claim level
// ---------------------------------------------------------------------------
export type ClaimLevel = 'no_data' | 'activity_only' | 'observed_change' | 'contribution' | 'stronger_causal';
export interface ClaimAssessment {
  level: ClaimLevel; label: L10n; explanation: L10n; allowed_statement: L10n; requirements_for_next_level: L10n[];
  observed_change: number | null; comparison_change: number | null; difference_in_differences: number | null;
}

export const CLAIM_LABELS: Record<ClaimLevel, L10n> = {
  no_data: l('لا توجد بيانات كافية', 'Insufficient data'),
  activity_only: l('مخرجات / نشاط فقط', 'Activity / output only'),
  observed_change: l('تغير مُلاحظ', 'Observed change'),
  contribution: l('مساهمة مدعومة بالأدلة', 'Evidence-supported contribution'),
  stronger_causal: l('دليل سببي أقوى', 'Stronger causal evidence'),
};

export function assessClaim(
  ind: IndicatorLike, measurements: MeasurementLike[], evidence: EvidenceLike[], fw: ImpactFrameworkLike | null,
): ClaimAssessment {
  const ms = measurements.filter((m) => m.indicator_id === ind.id);
  const pre = ms.find((m) => m.measurement_point === 'T0');
  const posts = sortMeasurements(ms.filter((m) => m.measurement_point && m.measurement_point !== 'T0' && m.measurement_point !== 'other'));
  const post = posts[posts.length - 1];
  const verifiedEvidence = evidence.filter((e) => e.indicator_id === ind.id && e.verification_status === 'verified').length;
  const linkedVerified = ms.filter((m) => m.evidence_id && evidence.some((e) => e.id === m.evidence_id && e.verification_status === 'verified')).length;
  const observed = pre && post ? roundTo(post.value - pre.value, 2) : (post && ind.baseline_value !== null ? roundTo(post.value - ind.baseline_value, 2) : null);
  const compChange = pre && post && pre.comparison_value !== null && post.comparison_value !== null
    ? roundTo(post.comparison_value - pre.comparison_value, 2) : null;
  const did = observed !== null && compChange !== null ? roundTo(observed - compChange, 2) : null;
  const design = fw?.evaluation_design ?? 'monitoring_only';
  const tocReady = !!fw && fw.status === 'approved' && (fw.theory_of_change?.assumptions ?? []).length > 0;
  const name = ind.name;

  let level: ClaimLevel;
  if (!ms.length) level = 'no_data';
  else if (ind.indicator_type === 'operational' || ind.indicator_type === 'output') level = 'activity_only';
  else if (observed === null) level = 'no_data';
  else if (did !== null && ['comparison_group', 'quasi_experimental', 'rct'].includes(design)) level = 'stronger_causal';
  else if (tocReady && (verifiedEvidence + linkedVerified) > 0 && posts.length >= 1) level = 'contribution';
  else level = 'observed_change';

  const next: L10n[] = [];
  if (level === 'no_data') next.push(l('سجّل قياس خط الأساس (T0) وقياسًا لاحقًا على الأقل.', 'Record a baseline (T0) and at least one follow-up measurement.'));
  if (level === 'activity_only') next.push(l('أضف مؤشرات نتائج تقيس التغير لدى المستفيدين وليس حجم التنفيذ فقط.', 'Add outcome indicators measuring change in beneficiaries, not only delivery volume.'));
  if (level === 'observed_change') {
    if (!tocReady) next.push(l('اعتمد نظرية التغيير مع الافتراضات والعوامل الخارجية.', 'Approve the Theory of Change including assumptions and external factors.'));
    if (verifiedEvidence + linkedVerified === 0) next.push(l('اربط أدلة موثقة (متحقق منها) بالقياسات.', 'Link verified evidence to measurements.'));
  }
  if (level !== 'stronger_causal') next.push(l('لإثبات سببي أقوى: أضف مجموعة مقارنة وقياسها في نفس النقاط.', 'For stronger causal evidence: add a comparison group measured at the same points.'));

  const fmt = (v: number | null) => (v === null ? '—' : (v >= 0 ? '+' : '') + v);
  const statements: Record<ClaimLevel, [L10n, L10n]> = {
    no_data: [l('لا توجد قياسات كافية لتقدير أي تغير.', 'There are not enough measurements to estimate change.'),
      l(`لا يمكن حاليًا إصدار أي ادعاء حول «${name}».`, `No claim can currently be made about “${name}”.`)],
    activity_only: [l('هذا مؤشر تنفيذ/مخرجات يقيس حجم ما قُدِّم وليس التغير لدى المستفيدين.', 'This is a delivery/output indicator measuring volume, not change in beneficiaries.'),
      l(`قدّم البرنامج ${post?.value ?? ms[ms.length - 1]?.value ?? '—'} (${ind.unit}) في «${name}».`, `The program delivered ${post?.value ?? ms[ms.length - 1]?.value ?? '—'} (${ind.unit}) for “${name}”.`)],
    observed_change: [l('يوجد فرق بين القياس القبلي والبعدي دون أدلة كافية تربطه بالبرنامج أو تستبعد التفسيرات البديلة.', 'A pre/post difference exists, without evidence linking it to the program or ruling out alternative explanations.'),
      l(`لوحظ تغير قدره ${fmt(observed)} في «${name}» بين ${pre ? 'T0' : 'خط الأساس'} و${post?.measurement_point}. هذا تغير مُلاحظ ولا يمكن نسبته للبرنامج وحده.`,
        `An observed change of ${fmt(observed)} in “${name}” between ${pre ? 'T0' : 'baseline'} and ${post?.measurement_point}. This is observed change and cannot be attributed to the program alone.`)],
    contribution: [l('التغير متسق مع نظرية تغيير معتمدة ومدعوم بأدلة متحقق منها، دون مجموعة مقارنة.', 'Change is consistent with an approved Theory of Change and supported by verified evidence, without a comparison group.'),
      l(`تشير الأدلة إلى أن البرنامج أسهم على الأرجح في تغير قدره ${fmt(observed)} في «${name}»، مع وجود عوامل أخرى محتملة.`,
        `Evidence suggests the program likely contributed to a ${fmt(observed)} change in “${name}”, alongside other possible factors.`)],
    stronger_causal: [l(`يتوفر تصميم بمجموعة مقارنة؛ فرق الفروق = ${fmt(did)}.`, `A comparison design is available; difference-in-differences = ${fmt(did)}.`),
      l(`مقارنة بمجموعة المقارنة، يُقدَّر أثر البرنامج على «${name}» بنحو ${fmt(did)} (فرق الفروق)، ضمن حدود جودة التصميم والعينة.`,
        `Relative to the comparison group, the program's estimated effect on “${name}” is about ${fmt(did)} (difference-in-differences), within design and sample limits.`)],
  };
  return {
    level, label: CLAIM_LABELS[level], explanation: statements[level][0], allowed_statement: statements[level][1],
    requirements_for_next_level: next, observed_change: observed, comparison_change: compChange, difference_in_differences: did,
  };
}

export function elapsedShare(start: string | null, end: string | null, today: Date = new Date()): number | null {
  if (!start || !end) return null;
  const s = new Date(start + 'T00:00:00Z').getTime(); const e = new Date(end + 'T00:00:00Z').getTime();
  if (e <= s) return null;
  return Math.min(1, Math.max(0, (today.getTime() - s) / (e - s)));
}
