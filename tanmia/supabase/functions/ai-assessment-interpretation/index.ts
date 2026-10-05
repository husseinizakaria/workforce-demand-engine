// ai-assessment-interpretation — assessments.view (translate_questions: assessments.edit)
//   mode 'result'              → strengths / development areas / recommendations for one result
//   mode 'cohort'              → n, mean, distribution and per-dimension means for a tool
//   mode 'translate_questions' → machine-translate missing question texts (requires the LLM)
import { serve, readJson, fail, check } from '../_shared/http.ts';
import { getCaller, requireOrgRow, requirePermission } from '../_shared/auth.ts';
import { enumOf, object, optional, parse, uuid, withDefault } from '../_shared/validate.ts';
import { audit } from '../_shared/audit.ts';
import { fetchAll } from '../_shared/bundle.ts';
import { type Filter } from '../_shared/bundle.ts';
import { type L10n, roundTo } from '../_shared/engine/index.ts';
import { draftNarrative, llmConfigured, translateItems } from '../_shared/llm.ts';

const Mode = object({ mode: enumOf(['result', 'cohort', 'translate_questions'] as const) });
const ResultBody = object({ organization_id: uuid(), result_id: uuid(), locale: withDefault(enumOf(['ar', 'en'] as const), 'ar') });
const CohortBody = object({
  organization_id: uuid(), tool_id: uuid(), program_id: optional(uuid()),
  measurement_point: optional(enumOf(['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'other'] as const)),
  locale: withDefault(enumOf(['ar', 'en'] as const), 'ar'),
});
const TranslateBody = object({ organization_id: uuid(), tool_id: uuid(), target: enumOf(['ar', 'en'] as const) });

interface Tool {
  id: string; name: string; name_en: string | null; scale_min: number; scale_max: number; pass_threshold: number | null; status: string;
  classification: { min: number; max: number; label_ar: string; label_en: string }[];
}
interface Dim {
  id: string; code: string; name: string; name_en: string | null; weight: number; sort_order: number;
  rubric: { score: number; label_ar?: string; label_en?: string; descriptor_ar?: string; descriptor_en?: string }[];
}

const STRENGTH = 70;
const DEVELOP = 50;

function norm(tool: Tool, v: number): number {
  const range = Number(tool.scale_max) - Number(tool.scale_min);
  return range > 0 ? roundTo(((v - Number(tool.scale_min)) / range) * 100, 1) : 0;
}

function rubricAt(d: Dim, score: number) {
  const r = (d.rubric ?? []).filter((x) => typeof x.score === 'number');
  if (!r.length) return null;
  return r.reduce((best, x) => (Math.abs(x.score - score) < Math.abs(best.score - score) ? x : best), r[0]);
}

async function loadTool(admin: Parameters<typeof requireOrgRow>[0], org: string, toolId: string) {
  const tool = await requireOrgRow<Tool>(admin, 'assessment_tools', toolId, org, 'id, name, name_en, scale_min, scale_max, pass_threshold, status, classification');
  const dims = await fetchAll<Dim>(admin, 'assessment_dimensions', [['tool_id', 'eq', toolId], ['organization_id', 'eq', org]],
    { columns: 'id, code, name, name_en, weight, sort_order, rubric', order: 'sort_order' });
  return { tool, dims };
}

serve(async (req) => {
  const caller = await getCaller(req);
  const raw = await readJson(req);
  const { mode } = parse(Mode, raw);
  const admin = caller.admin;

  if (mode === 'result') {
    const b = parse(ResultBody, raw);
    await requirePermission(caller, b.organization_id, 'assessments.view');
    const result = await requireOrgRow<{
      id: string; tool_id: string; beneficiary_id: string | null; measurement_point: string; total_score: number | null; normalized_score: number | null;
      classification_label: string | null; passed: boolean | null; interpretation: Record<string, unknown>; dimension_scores: Record<string, number>; status: string; source: string;
    }>(admin, 'assessment_results', b.result_id, b.organization_id,
      'id, tool_id, beneficiary_id, measurement_point, total_score, normalized_score, classification_label, passed, interpretation, dimension_scores, status, source');
    const { tool, dims } = await loadTool(admin, b.organization_id, result.tool_id);

    const scored = dims.filter((d) => result.dimension_scores?.[d.id] !== undefined).map((d) => {
      const score = Number(result.dimension_scores[d.id]);
      const r = rubricAt(d, score);
      return {
        dimension_id: d.id, code: d.code, name: { ar: d.name, en: d.name_en ?? d.name } as L10n, score: roundTo(score, 2), normalized: norm(tool, score),
        level: r ? { ar: r.label_ar ?? '', en: r.label_en ?? '' } : null, descriptor: r ? { ar: r.descriptor_ar ?? '', en: r.descriptor_en ?? '' } : null,
      };
    }).sort((a, b) => b.normalized - a.normalized);
    const mean = scored.length ? scored.reduce((a, x) => a + x.normalized, 0) / scored.length : null;
    const strengths = scored.filter((d) => d.normalized >= STRENGTH || (mean !== null && scored.length > 2 && d.normalized >= mean + 10)).slice(0, 5);
    const development_areas = [...scored].reverse().filter((d) => d.normalized < DEVELOP || (mean !== null && scored.length > 2 && d.normalized <= mean - 10)).slice(0, 5);
    const recommendations: L10n[] = development_areas.map((d) => {
      const dim = dims.find((x) => x.id === d.dimension_id)!;
      const next = rubricAt(dim, Math.min(Number(tool.scale_max), d.score + 1));
      return {
        ar: `ركّز خطة التطوير على «${d.name.ar}» (${d.normalized}%)${next?.descriptor_ar ? `؛ المستوى التالي: ${next.descriptor_ar}` : ''}.`,
        en: `Focus development on “${d.name.en}” (${d.normalized}%)${next?.descriptor_en ? `; next level: ${next.descriptor_en}` : ''}.`,
      };
    });
    if (!scored.length) recommendations.push({ ar: 'لا توجد درجات أبعاد لهذه النتيجة؛ أكمل الإجابات أو الاستيراد.', en: 'This result has no dimension scores; complete responses or the import.' });
    if (result.status !== 'verified') recommendations.push({ ar: 'النتيجة غير متحقق منها بعد؛ تعامل مع التفسير كتفسير أولي.', en: 'The result is not verified yet; treat the interpretation as preliminary.' });

    const payload = {
      result: { ...result, tool: { id: tool.id, name: tool.name, name_en: tool.name_en, scale_min: tool.scale_min, scale_max: tool.scale_max, pass_threshold: tool.pass_threshold }, dimensions: scored },
      strengths, development_areas, recommendations,
    };
    const llm = await draftNarrative({
      task: 'Interpret this individual assessment result for a program coordinator: overall level, strengths, development areas and practical development suggestions. Do not label or diagnose the person beyond the classification given.',
      facts: payload, locale: b.locale, effort: 'low',
    });
    return { ...payload, narrative: llm.text, generated_by: llm.text ? 'rules+llm' : 'rules' };
  }

  if (mode === 'cohort') {
    const b = parse(CohortBody, raw);
    await requirePermission(caller, b.organization_id, 'assessments.view');
    const { tool, dims } = await loadTool(admin, b.organization_id, b.tool_id);
    if (b.program_id) await requireOrgRow(admin, 'programs', b.program_id, b.organization_id, 'id');
    const filters: Filter[] = [['organization_id', 'eq', b.organization_id], ['tool_id', 'eq', b.tool_id], ['status', 'in', ['submitted', 'verified']], ['normalized_score', 'not_null']];
    if (b.program_id) filters.push(['program_id', 'eq', b.program_id]);
    if (b.measurement_point) filters.push(['measurement_point', 'eq', b.measurement_point]);
    const rows = await fetchAll<{ normalized_score: number; classification_label: string | null; passed: boolean | null; dimension_scores: Record<string, number> }>(
      admin, 'assessment_results', filters, { columns: 'id, normalized_score, classification_label, passed, dimension_scores' });
    const n = rows.length;
    const scores = rows.map((r) => Number(r.normalized_score));
    const mean = n ? roundTo(scores.reduce((a, x) => a + x, 0) / n, 2) : null;
    const sd = n > 1 && mean !== null ? roundTo(Math.sqrt(scores.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)), 2) : null;
    const byLabel = new Map<string, number>();
    for (const r of rows) byLabel.set(r.classification_label ?? '—', (byLabel.get(r.classification_label ?? '—') ?? 0) + 1);
    const bands = [0, 20, 40, 60, 80].map((lo) => ({ from: lo, to: lo + 20, count: scores.filter((s) => s >= lo && (lo === 80 ? s <= 100 : s < lo + 20)).length }));
    const passedKnown = rows.filter((r) => r.passed !== null);
    const distribution = {
      by_classification: [...byLabel.entries()].map(([label, count]) => ({ label, count, share: n ? roundTo((count / n) * 100, 1) : 0 })),
      by_band: bands,
      pass_rate: passedKnown.length ? roundTo((passedKnown.filter((r) => r.passed).length / passedKnown.length) * 100, 1) : null,
      sd,
    };
    const dimensions = dims.map((d) => {
      const vals = rows.map((r) => r.dimension_scores?.[d.id]).filter((v): v is number => v !== undefined && v !== null).map(Number);
      const m = vals.length ? vals.reduce((a, x) => a + x, 0) / vals.length : null;
      return { dimension_id: d.id, code: d.code, name: { ar: d.name, en: d.name_en ?? d.name }, n: vals.length, mean: m === null ? null : roundTo(m, 2), normalized_mean: m === null ? null : norm(tool, m) };
    });
    const payload = { n, mean, distribution, dimensions };
    const llm = n
      ? await draftNarrative({
        task: `Summarise the cohort results for the assessment tool "${tool.name_en ?? tool.name}": overall level, spread, strongest and weakest dimensions, and suggestions for group-level development. Note the sample size (n) and that cross-sectional results do not show change over time.`,
        facts: { tool: { name: tool.name, name_en: tool.name_en, scale_min: tool.scale_min, scale_max: tool.scale_max }, measurement_point: b.measurement_point ?? null, ...payload },
        locale: b.locale, effort: 'low',
      })
      : { text: null };
    return { ...payload, narrative: llm.text, generated_by: llm.text ? 'rules+llm' : 'rules' };
  }

  // ---- translate_questions ---------------------------------------------------
  const b = parse(TranslateBody, raw);
  await requirePermission(caller, b.organization_id, 'assessments.edit');
  await requireOrgRow(admin, 'assessment_tools', b.tool_id, b.organization_id, 'id');
  if (!llmConfigured()) fail('llm_not_configured');
  const src = b.target === 'ar' ? 'en' : 'ar';
  const questions = await fetchAll<{ id: string; text_ar: string | null; text_en: string | null; options: { value: string; label_ar?: string; label_en?: string }[]; translation_status: string }>(
    admin, 'assessment_questions', [['organization_id', 'eq', b.organization_id], ['tool_id', 'eq', b.tool_id]],
    { columns: 'id, text_ar, text_en, options, translation_status', order: 'sort_order' });

  const items: { id: string; text: string }[] = [];
  for (const q of questions) {
    if (q.translation_status === 'verified') continue;
    const s = q[`text_${src}`]; const t = q[`text_${b.target}`];
    if (s && !t?.trim()) items.push({ id: `q:${q.id}`, text: s });
    (Array.isArray(q.options) ? q.options : []).forEach((o, i) => {
      const os = o[`label_${src}`]; const ot = o[`label_${b.target}`];
      if (os && !ot?.trim()) items.push({ id: `o:${q.id}:${i}`, text: os });
    });
  }
  if (!items.length) return { updated: 0 };

  const translated: Record<string, string> = {};
  for (let i = 0; i < items.length; i += 40) {
    const r = await translateItems(items.slice(i, i + 40), b.target);
    if (!r.translations) fail('llm_failed', { detail: { reason: r.refused ? 'refused' : r.error ?? 'no_output' } });
    Object.assign(translated, r.translations);
  }

  let updated = 0;
  for (const q of questions) {
    const patch: Record<string, unknown> = {};
    const qt = translated[`q:${q.id}`];
    if (qt) patch[`text_${b.target}`] = qt;
    if (Array.isArray(q.options) && q.options.some((_, i) => translated[`o:${q.id}:${i}`])) {
      patch.options = q.options.map((o, i) => (translated[`o:${q.id}:${i}`] ? { ...o, [`label_${b.target}`]: translated[`o:${q.id}:${i}`] } : o));
    }
    if (!Object.keys(patch).length) continue;
    patch.translation_status = 'machine';
    check(await admin.from('assessment_questions').update(patch).eq('id', q.id).eq('organization_id', b.organization_id).neq('translation_status', 'verified'),
      'assessment_questions');
    updated++;
  }
  await audit(admin, { organization_id: b.organization_id, actor_user_id: caller.userId, action: 'questions_machine_translated', entity_type: 'assessment_tools',
    entity_id: b.tool_id, summary: `${updated} question(s) → ${b.target}`, new_data: { updated, target: b.target } });
  return { updated };
});
