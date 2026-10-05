// Small data helpers shared by the beneficiaries / experts / vendors / partners /
// operations features (kept inside the feature folders by convention).
import { type HealthArea, type Insight, type InsightKind, RECORD_TYPES, type Severity } from '@engine';
import { all, type ListOptions } from '@/services/db';
import { errorOf } from '@/services/errors';

/** Tables the user cannot read (RLS / disabled modules) come back empty instead of failing the whole screen. */
export async function safe<T>(p: Promise<T[]>): Promise<T[]> {
  try { return await p; } catch { return []; }
}

/** `all()` over an id list, chunked so the request URL stays short. */
export async function allIn<T>(table: string, column: string, ids: (string | null | undefined)[],
  o: Omit<ListOptions, 'page' | 'pageSize' | 'count'> = {}, chunk = 120): Promise<T[]> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (!uniq.length) return [];
  const out: T[] = [];
  for (let i = 0; i < uniq.length; i += chunk) {
    out.push(...await all<T>(table, { ...o, filters: [...(o.filters ?? []), [column, 'in', uniq.slice(i, i + chunk)]] }));
  }
  return out;
}

export function byId<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.id, r]));
}

export function makeInsight(p: {
  rule: string; severity: Severity; kind: InsightKind; area: HealthArea; title: [string, string]; rationale: [string, string];
  action: [string, string]; data?: Record<string, unknown>; key?: string;
}): Insight {
  return {
    rule_code: p.rule, severity: p.severity, kind: p.kind, area: p.area,
    title: { ar: p.title[0], en: p.title[1] }, rationale: { ar: p.rationale[0], en: p.rationale[1] },
    recommended_action: { ar: p.action[0], en: p.action[1] }, source_data: p.data ?? {}, fingerprint: `${p.rule}:${p.key ?? ''}`,
  };
}

const SEV: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
export const sortInsights = (xs: Insight[]) => [...xs].sort((a, b) => SEV[b.severity] - SEV[a.severity]);

export function errMsg(e: unknown, locale: 'ar' | 'en'): string {
  const err = errorOf(e);
  return locale === 'ar' ? err.message_ar : err.message_en;
}

/** Render loosely-typed text coming from Edge Functions (string | {ar,en} | {text} | object). */
export function textOf(v: unknown, locale: 'ar' | 'en'): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map((x) => textOf(x, locale)).filter(Boolean).join(' · ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('ar' in o || 'en' in o) return String((locale === 'ar' ? o.ar ?? o.en : o.en ?? o.ar) ?? '');
    for (const k of ['text', 'title', 'label', 'name', 'summary', 'recommendation', 'detail']) {
      if (k in o) {
        const main = textOf(o[k], locale);
        const extra = ['detail', 'rationale', 'reason'].filter((x) => x !== k && x in o).map((x) => textOf(o[x], locale)).filter(Boolean);
        return [main, ...extra].join(' — ');
      }
    }
    return Object.entries(o).map(([k, x]) => `${k}: ${textOf(x, locale)}`).join('، ');
  }
  return '';
}

export function asList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v === null || v === undefined || v === '') return [];
  return [v];
}

/** Human-readable summary of a program_stage_records.payload using the engine's record type definition. */
export function payloadSummary(recordType: string, payload: Record<string, unknown>, locale: 'ar' | 'en'): string {
  const def = RECORD_TYPES[recordType];
  const skip = new Set(['beneficiary_id', 'team_id', 'expert_id']);
  const parts: string[] = [];
  if (def) {
    for (const f of def.fields) {
      if (skip.has(f.key)) continue;
      const v = payload[f.key];
      if (v === null || v === undefined || v === '') continue;
      const opt = f.options?.find((o) => o.value === v);
      const label = locale === 'ar' ? f.label_ar : f.label_en;
      parts.push(`${label}: ${opt ? (locale === 'ar' ? opt.label_ar : opt.label_en) : String(v)}`);
    }
  } else {
    for (const [k, v] of Object.entries(payload)) if (!skip.has(k) && v !== null && v !== '' && typeof v !== 'object') parts.push(`${k}: ${String(v)}`);
  }
  return parts.join(' · ');
}

export function recordTypeName(key: string, locale: 'ar' | 'en'): string {
  const d = RECORD_TYPES[key];
  return d ? (locale === 'ar' ? d.name_ar : d.name_en) : key;
}

export const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const round1 = (x: number | null): number | null => (x === null ? null : Math.round(x * 10) / 10);
