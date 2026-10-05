// Assessment scoring — exact mirror of public.score_assessment_result() and
// public.score_form_submission() in supabase/migrations/*_assessments.sql.
import { roundTo } from './types.ts';

export interface ClassBand {
  min: number; max: number; label_ar: string; label_en: string;
  interpretation_ar?: string; interpretation_en?: string;
}
export interface ToolLike {
  scale_min: number; scale_max: number;
  scoring_method: 'weighted_average' | 'average' | 'sum';
  pass_threshold: number | null;
  classification: ClassBand[];
}
export interface DimLike { id: string; weight: number }
export interface QuestionOption { value: string; score?: number | null; label_ar?: string; label_en?: string }
export interface QuestionLike {
  id: string; dimension_id: string | null;
  question_type: 'scale' | 'single_choice' | 'multiple_choice' | 'number' | 'boolean' | 'text';
  options: QuestionOption[]; weight: number; reverse_scored: boolean;
}
export type ResponseValue = number | string | boolean | string[] | null | undefined;

export interface ScoreOutcome {
  dimension_scores: Record<string, number>;
  total_score: number | null;
  normalized_score: number | null;
  classification: ClassBand | null;
  passed: boolean | null;
  dimensions_scored: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function questionValue(tool: ToolLike, q: QuestionLike, raw: ResponseValue): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  let v: number | null = null;
  if (q.question_type === 'scale' || q.question_type === 'number') {
    const num = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(num)) v = clamp(num, tool.scale_min, tool.scale_max);
  } else if (q.question_type === 'boolean') {
    const b = raw === true || raw === 'true';
    v = b ? tool.scale_max : tool.scale_min;
  } else if (q.question_type === 'single_choice') {
    const opt = q.options.find((o) => o.value === String(raw));
    v = opt && opt.score !== null && opt.score !== undefined ? Number(opt.score) : null;
  } else if (q.question_type === 'multiple_choice' && Array.isArray(raw)) {
    const scores = q.options.filter((o) => raw.includes(o.value) && o.score !== null && o.score !== undefined).map((o) => Number(o.score));
    v = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  }
  if (v === null) return null;
  if (q.reverse_scored) v = tool.scale_min + tool.scale_max - v;
  return v;
}

export function scoreDimensionsFromResponses(tool: ToolLike, questions: QuestionLike[], responses: Record<string, ResponseValue>): Record<string, number> {
  const acc: Record<string, { s: number; w: number }> = {};
  for (const q of questions) {
    if (!q.dimension_id) continue;
    const v = questionValue(tool, q, responses[q.id]);
    if (v === null) continue;
    const a = (acc[q.dimension_id] ??= { s: 0, w: 0 });
    a.s += v * q.weight;
    a.w += q.weight;
  }
  const out: Record<string, number> = {};
  for (const [k, a] of Object.entries(acc)) if (a.w > 0) out[k] = roundTo(a.s / a.w, 4);
  return out;
}

export function classify(bands: ClassBand[], norm: number | null): ClassBand | null {
  if (norm === null) return null;
  const matches = bands.filter((c) => norm >= c.min && (norm < c.max || (c.max >= 100 && norm <= 100)));
  matches.sort((a, b) => b.min - a.min);
  return matches[0] ?? null;
}

export function scoreResult(
  tool: ToolLike,
  dims: DimLike[],
  questions: QuestionLike[],
  input: { responses?: Record<string, ResponseValue>; dimension_scores?: Record<string, number> },
): ScoreOutcome {
  let dimension_scores = input.dimension_scores ?? {};
  if (input.responses && Object.keys(input.responses).length > 0) {
    dimension_scores = scoreDimensionsFromResponses(tool, questions, input.responses);
  }
  let acc = 0, wsum = 0, n = 0;
  for (const d of dims) {
    if (!(d.id in dimension_scores)) continue;
    const v = clamp(Number(dimension_scores[d.id]), tool.scale_min, tool.scale_max);
    if (tool.scoring_method === 'weighted_average') { acc += v * d.weight; wsum += d.weight; } else { acc += v; wsum += 1; }
    n++;
  }
  if (n === 0) return { dimension_scores, total_score: null, normalized_score: null, classification: null, passed: null, dimensions_scored: 0 };
  let total: number | null; let norm: number | null;
  const range = tool.scale_max - tool.scale_min;
  if (tool.scoring_method === 'sum') {
    total = acc;
    norm = ((acc - n * tool.scale_min) / (n * range)) * 100;
  } else {
    total = wsum > 0 ? acc / wsum : null;
    norm = total === null ? null : ((total - tool.scale_min) / range) * 100;
  }
  const classification = classify(tool.classification ?? [], norm);
  return {
    dimension_scores,
    total_score: total === null ? null : roundTo(total, 2),
    normalized_score: norm === null ? null : roundTo(norm, 2),
    classification,
    passed: tool.pass_threshold === null || tool.pass_threshold === undefined || norm === null ? null : norm >= tool.pass_threshold,
    dimensions_scored: n,
  };
}

// ---------------------------------------------------------------------------
// Form submissions
// ---------------------------------------------------------------------------
export interface FormFieldLike {
  key: string; type: string; options?: QuestionOption[]; scoring?: { weight?: number } | null;
}
export function scoreFormAnswers(fields: FormFieldLike[], answers: Record<string, unknown>, scoringEnabled: boolean): number | null {
  if (!scoringEnabled) return null;
  let total = 0; let any = false;
  for (const f of fields) {
    const a = answers[f.key];
    if (a === null || a === undefined) continue;
    const w = f.scoring?.weight ?? 1;
    let s: number | null = null;
    if (f.type === 'single_choice') {
      const o = (f.options ?? []).find((x) => x.value === String(a));
      s = o?.score ?? null;
    } else if (f.type === 'multiple_choice' && Array.isArray(a)) {
      const sel = (f.options ?? []).filter((x) => (a as string[]).includes(x.value) && x.score !== null && x.score !== undefined);
      s = sel.length ? sel.reduce((acc, x) => acc + Number(x.score), 0) : null;
    } else if (['rating', 'scale', 'number'].includes(f.type) && typeof a === 'number' && f.scoring) {
      s = a;
    }
    if (s !== null && s !== undefined) { total += Number(s) * w; any = true; }
  }
  return any ? roundTo(total, 2) : null;
}

// ---------------------------------------------------------------------------
// Conditional logic for the form builder
// ---------------------------------------------------------------------------
export interface ShowIf { field: string; op: 'eq' | 'neq' | 'gt' | 'lt' | 'includes' | 'filled'; value?: unknown }
export function isFieldVisible(showIf: ShowIf | null | undefined, answers: Record<string, unknown>): boolean {
  if (!showIf || !showIf.field) return true;
  const v = answers[showIf.field];
  switch (showIf.op) {
    case 'eq': return String(v ?? '') === String(showIf.value ?? '');
    case 'neq': return String(v ?? '') !== String(showIf.value ?? '');
    case 'gt': return Number(v) > Number(showIf.value);
    case 'lt': return Number(v) < Number(showIf.value);
    case 'includes': return Array.isArray(v) && v.map(String).includes(String(showIf.value));
    case 'filled': return v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);
    default: return true;
  }
}

/** Default classification bands (0–100) used when a tool has none configured. */
export const DEFAULT_BANDS: ClassBand[] = [
  { min: 0, max: 40, label_ar: 'يحتاج تطويرًا جوهريًا', label_en: 'Needs substantial development',
    interpretation_ar: 'الأداء أقل بوضوح من المستوى المطلوب؛ يلزم دعم مركز وخطة تطوير.', interpretation_en: 'Clearly below the required level; focused support and a development plan are needed.' },
  { min: 40, max: 60, label_ar: 'نامٍ', label_en: 'Developing',
    interpretation_ar: 'أساس موجود مع فجوات واضحة في أبعاد محددة.', interpretation_en: 'A foundation exists with clear gaps in specific dimensions.' },
  { min: 60, max: 80, label_ar: 'متمكن', label_en: 'Proficient',
    interpretation_ar: 'يحقق المستوى المطلوب مع فرص تحسين محددة.', interpretation_en: 'Meets the required level with specific improvement opportunities.' },
  { min: 80, max: 100, label_ar: 'متميز', label_en: 'Distinguished',
    interpretation_ar: 'أداء يتجاوز المطلوب ويمكن البناء عليه كنقطة قوة.', interpretation_en: 'Exceeds the requirement; a strength to build on.' },
];
