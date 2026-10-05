// Data helpers shared by the assessment screens (tools, results, imports, maturity).
import type { QuestionLike, ToolLike } from '@engine';
import { all, get } from '@/services/db';
import type { AssessmentDimension, AssessmentQuestion, AssessmentTool, Program } from '@/types/db';
import type { AppError } from '@/services/errors';

export type ProgramLite = Pick<Program, 'id' | 'code' | 'name' | 'name_en' | 'start_date' | 'end_date' | 'track_code' | 'status'>;

export const MEASUREMENT_KEYS = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5'] as const;

export function loadPrograms(orgId: string): Promise<ProgramLite[]> {
  return all<ProgramLite>('programs', {
    select: 'id,code,name,name_en,start_date,end_date,track_code,status',
    filters: [['organization_id', 'eq', orgId]], order: { column: 'name', ascending: true },
  }, 3000);
}

export function loadOrgTools(orgId: string): Promise<AssessmentTool[]> {
  return all<AssessmentTool>('assessment_tools', {
    filters: [['organization_id', 'eq', orgId]], order: [{ column: 'code', ascending: true }, { column: 'version', ascending: false }],
  }, 3000);
}

export interface ToolBundle { tool: AssessmentTool; dims: AssessmentDimension[]; questions: AssessmentQuestion[] }

export async function loadToolBundle(toolId: string): Promise<ToolBundle> {
  const [tool, dims, questions] = await Promise.all([
    get<AssessmentTool>('assessment_tools', toolId),
    all<AssessmentDimension>('assessment_dimensions', { filters: [['tool_id', 'eq', toolId]], order: [{ column: 'sort_order', ascending: true }, { column: 'code', ascending: true }] }),
    all<AssessmentQuestion>('assessment_questions', { filters: [['tool_id', 'eq', toolId]], order: [{ column: 'sort_order', ascending: true }, { column: 'code', ascending: true }] }),
  ]);
  return { tool, dims, questions };
}

/** Engine-compatible view of a tool (numeric columns can arrive as strings from PostgREST). */
export function toolLike(t: AssessmentTool): ToolLike {
  return {
    scale_min: Number(t.scale_min), scale_max: Number(t.scale_max), scoring_method: t.scoring_method,
    pass_threshold: t.pass_threshold === null || t.pass_threshold === undefined ? null : Number(t.pass_threshold),
    classification: Array.isArray(t.classification) ? t.classification : [],
  };
}
export function questionLike(q: AssessmentQuestion): QuestionLike {
  return { id: q.id, dimension_id: q.dimension_id, question_type: q.question_type, options: Array.isArray(q.options) ? q.options : [], weight: Number(q.weight), reverse_scored: q.reverse_scored };
}

/** Question text in the current locale with fallback to the other language. */
export function questionText(q: Pick<AssessmentQuestion, 'text_ar' | 'text_en'>, locale: 'ar' | 'en'): { text: string; fallback: boolean } {
  const primary = locale === 'ar' ? q.text_ar : q.text_en;
  if (primary && primary.trim()) return { text: primary, fallback: false };
  return { text: (locale === 'ar' ? q.text_en : q.text_ar) ?? '', fallback: true };
}

export async function nameMap(table: 'beneficiaries' | 'program_teams' | 'experts', ids: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  const select = table === 'program_teams' ? 'id,code,name' : 'id,code,full_name';
  try {
    const rows = await all<Record<string, unknown>>(table, { select, filters: [['id', 'in', uniq]], order: { column: 'code', ascending: true } });
    return Object.fromEntries(rows.map((r) => [String(r.id), `${String(r.full_name ?? r.name ?? '')} · ${String(r.code ?? '')}`]));
  } catch { return {}; }
}

/** Display names for auth users (profiles are readable only with users.view; fall back to a short id). */
export async function profileNames(ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (!uniq.length) return {};
  try {
    const rows = await all<{ id: string; full_name: string | null; email: string | null }>('profiles', { select: 'id,full_name,email', filters: [['id', 'in', uniq]], order: { column: 'id', ascending: true } });
    return Object.fromEntries(rows.map((r) => [r.id, r.full_name || r.email || r.id.slice(0, 8)]));
  } catch { return {}; }
}

export function errText(e: AppError | null | undefined, locale: 'ar' | 'en'): string {
  if (!e) return '';
  return locale === 'ar' ? e.message_ar : e.message_en;
}

export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
