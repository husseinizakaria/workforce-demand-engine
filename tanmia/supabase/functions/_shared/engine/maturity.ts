// Maturity model: weighted scoring (mirror of public.score_maturity_assessment)
// and before/after comparison across measurement points T0..T5.
import { type L10n, type MaturityAssessmentLike, type MaturityFrameworkLike, l, roundTo } from './types.ts';

export function maturityOverall(fw: Pick<MaturityFrameworkLike, 'dimensions' | 'weighted'>, scores: Record<string, number>): { score: number | null; level: number | null } {
  let acc = 0, wsum = 0;
  for (const d of fw.dimensions) {
    if (!(d.key in scores)) continue;
    const w = fw.weighted ? (d.weight ?? 1) : 1;
    acc += Number(scores[d.key]) * w; wsum += w;
  }
  if (wsum === 0) return { score: null, level: null };
  return { score: roundTo(acc / wsum, 2), level: Math.round(acc / wsum) };
}

export interface DimensionMovement {
  key: string; name: L10n; before: number | null; after: number | null; change: number | null;
  improved: number; declined: number; unchanged: number; paired: number;
}
export interface MaturityComparison {
  from: string; to: string;
  subjects_before: number; subjects_after: number; paired: number;
  overall_before: number | null; overall_after: number | null; overall_change: number | null;
  effect_size: number | null; // paired Cohen's d_z
  improved: number; declined: number; unchanged: number;
  dimensions: DimensionMovement[];
  distribution: { point: string; levels: Record<number, number> }[];
  per_subject: { subject_id: string; before: number | null; after: number | null; change: number | null }[];
  data_quality: { verified_share: number | null; self_reported_share: number | null };
  missing_follow_up: number;
  confidence: 'insufficient' | 'indicative' | 'moderate';
  interpretation: L10n[];
}

const subjectKey = (a: MaturityAssessmentLike) => a.beneficiary_id ?? a.team_id ?? 'unknown';
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function sd(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}
const THRESHOLD = 0.25; // change smaller than a quarter level is "unchanged"

export function compareMaturity(fw: MaturityFrameworkLike, assessments: MaturityAssessmentLike[], from = 'T0', to = 'T1'): MaturityComparison {
  const rows = assessments.filter((a) => a.framework_id === fw.id);
  const before = new Map(rows.filter((a) => a.measurement_point === from).map((a) => [subjectKey(a), a]));
  const after = new Map(rows.filter((a) => a.measurement_point === to).map((a) => [subjectKey(a), a]));
  const pairedKeys = [...before.keys()].filter((k) => after.has(k));

  const overallOf = (a: MaturityAssessmentLike) => a.overall_score ?? maturityOverall(fw, a.dimension_scores).score;

  const per_subject = [...new Set([...before.keys(), ...after.keys()])].map((k) => {
    const b = before.get(k); const a = after.get(k);
    const bo = b ? overallOf(b) : null; const ao = a ? overallOf(a) : null;
    return { subject_id: k, before: bo, after: ao, change: bo !== null && ao !== null ? roundTo(ao - bo, 2) : null };
  });

  const diffs = per_subject.filter((s) => s.change !== null).map((s) => s.change as number);
  const improved = diffs.filter((x) => x >= THRESHOLD).length;
  const declined = diffs.filter((x) => x <= -THRESHOLD).length;
  const unchanged = diffs.length - improved - declined;

  const pairedBefore = pairedKeys.map((k) => overallOf(before.get(k)!)).filter((x): x is number => x !== null);
  const pairedAfter = pairedKeys.map((k) => overallOf(after.get(k)!)).filter((x): x is number => x !== null);
  const ob = mean(pairedBefore); const oa = mean(pairedAfter);
  const sdd = sd(diffs);
  const meanDiff = mean(diffs);
  const effect = sdd && sdd > 0 && meanDiff !== null ? roundTo(meanDiff / sdd, 2) : null;

  const dimensions: DimensionMovement[] = fw.dimensions.map((d) => {
    const pairs = pairedKeys
      .map((k) => [before.get(k)!.dimension_scores[d.key], after.get(k)!.dimension_scores[d.key]] as [number | undefined, number | undefined])
      .filter((p): p is [number, number] => p[0] !== undefined && p[1] !== undefined);
    const ch = pairs.map(([b, a]) => a - b);
    const bm = mean(pairs.map((p) => p[0])); const am = mean(pairs.map((p) => p[1]));
    return {
      key: d.key, name: l(d.name_ar, d.name_en),
      before: bm === null ? null : roundTo(bm, 2), after: am === null ? null : roundTo(am, 2),
      change: bm !== null && am !== null ? roundTo(am - bm, 2) : null,
      improved: ch.filter((x) => x >= THRESHOLD).length, declined: ch.filter((x) => x <= -THRESHOLD).length,
      unchanged: ch.filter((x) => Math.abs(x) < THRESHOLD).length, paired: pairs.length,
    };
  });

  const distribution = [from, to].map((point) => {
    const levels: Record<number, number> = {};
    for (let i = Math.ceil(fw.scale_min); i <= Math.floor(fw.scale_max); i++) levels[i] = 0;
    for (const a of rows.filter((r) => r.measurement_point === point)) {
      const o = overallOf(a);
      if (o === null) continue;
      const lv = Math.min(Math.max(Math.round(o), Math.ceil(fw.scale_min)), Math.floor(fw.scale_max));
      levels[lv] = (levels[lv] ?? 0) + 1;
    }
    return { point, levels };
  });

  const relevant = rows.filter((r) => r.measurement_point === from || r.measurement_point === to);
  const verified = relevant.filter((r) => r.data_quality === 'verified').length;
  const selfRep = relevant.filter((r) => r.data_quality === 'self_reported').length;
  const missing_follow_up = [...before.keys()].filter((k) => !after.has(k)).length;
  const paired = pairedKeys.length;
  const confidence: MaturityComparison['confidence'] = paired < 5 ? 'insufficient' : paired < 20 ? 'indicative' : 'moderate';

  const interpretation: L10n[] = [];
  const overall_change = ob !== null && oa !== null ? roundTo(oa - ob, 2) : null;
  if (paired === 0) {
    interpretation.push(l(`لا توجد قياسات مقترنة بين ${from} و${to}؛ لا يمكن حساب التغير.`, `No paired measurements between ${from} and ${to}; change cannot be computed.`));
  } else {
    if (overall_change !== null) {
      const dir = overall_change > 0 ? ['ارتفع', 'increased'] : overall_change < 0 ? ['انخفض', 'decreased'] : ['لم يتغير', 'did not change'];
      interpretation.push(l(
        `${dir[0]} متوسط النضج لدى ${paired} من المستفيدين المقترنين من ${roundTo(ob!, 2)} إلى ${roundTo(oa!, 2)} (${overall_change >= 0 ? '+' : ''}${overall_change}).`,
        `Average maturity across ${paired} paired subjects ${dir[1]} from ${roundTo(ob!, 2)} to ${roundTo(oa!, 2)} (${overall_change >= 0 ? '+' : ''}${overall_change}).`));
    }
    const ranked = dimensions.filter((d) => d.change !== null).sort((a, b) => (b.change! - a.change!));
    if (ranked.length) {
      const top = ranked[0]; const low = ranked[ranked.length - 1];
      interpretation.push(l(`أكبر تحسن في بعد «${top.name.ar}» (${top.change! >= 0 ? '+' : ''}${top.change})، وأضعف حركة في «${low.name.ar}» (${low.change! >= 0 ? '+' : ''}${low.change}).`,
        `Largest gain in “${top.name.en}” (${top.change! >= 0 ? '+' : ''}${top.change}); weakest movement in “${low.name.en}” (${low.change! >= 0 ? '+' : ''}${low.change}).`));
    }
    if (declined > 0) interpretation.push(l(`${declined} مستفيد(ين) تراجعوا؛ يوصى بمراجعة حالاتهم فرديًا.`, `${declined} subject(s) declined; review these cases individually.`));
    if (confidence !== 'moderate') interpretation.push(l(`حجم العينة المقترنة (${paired}) صغير؛ النتائج مؤشرات أولية فقط.`, `Paired sample (${paired}) is small; treat results as indicative only.`));
    if (missing_follow_up > 0) interpretation.push(l(`${missing_follow_up} لديهم قياس ${from} دون ${to}؛ قد يسبب ذلك تحيز الانسحاب.`, `${missing_follow_up} have ${from} without ${to}; attrition bias is possible.`));
    if (relevant.length && selfRep / relevant.length > 0.5) interpretation.push(l('أغلب القياسات ذاتية التقدير؛ يُنصح بتقييم من مقيم أو تحقق.', 'Most measurements are self-reported; assessor ratings or verification are recommended.'));
  }
  interpretation.push(l('هذا تغير مُلاحظ قبل/بعد، ولا يثبت وحده أن البرنامج سبّبه.', 'This is an observed before/after change; on its own it does not prove the program caused it.'));

  return {
    from, to, subjects_before: before.size, subjects_after: after.size, paired,
    overall_before: ob === null ? null : roundTo(ob, 2), overall_after: oa === null ? null : roundTo(oa, 2), overall_change,
    effect_size: effect, improved, declined, unchanged, dimensions, distribution, per_subject,
    data_quality: {
      verified_share: relevant.length ? roundTo(verified / relevant.length, 2) : null,
      self_reported_share: relevant.length ? roundTo(selfRep / relevant.length, 2) : null,
    },
    missing_follow_up, confidence, interpretation,
  };
}

/** Which measurement points are due given program end date and today. */
export function duePoints(endDate: string | null, today: Date = new Date()): string[] {
  const due = ['T0'];
  if (!endDate) return due;
  const end = new Date(endDate + 'T00:00:00Z');
  const offsets: [string, number][] = [['T1', 0], ['T2', 30], ['T3', 90], ['T4', 182], ['T5', 365]];
  for (const [p, days] of offsets) if (today.getTime() >= end.getTime() + days * 86400000) due.push(p);
  return due;
}
