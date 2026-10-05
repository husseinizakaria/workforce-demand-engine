// Program track template model + validation (keys, dependencies, cycles, weights).
import { RECORD_TYPES, type L10n } from '@engine';
import type { ProgramTrackTemplate, TrackStageTemplate } from '@/types/db';
import { KEY_PATTERN, duplicates } from './common';

export interface IndicatorDraft {
  key: string; name_ar: string; name_en: string;
  indicator_type: 'operational' | 'output' | 'outcome' | 'impact';
  chain_level: 'input' | 'activity' | 'output' | 'outcome' | 'impact';
  outcome_term?: 'short' | 'medium' | 'long';
  unit: string; direction: 'increase' | 'decrease' | 'maintain'; measurement_points: string[];
}
export interface DimensionDraft { key: string; name_ar: string; name_en: string; weight: number }

export interface TrackDraft {
  name_ar: string; name_en: string; description_ar: string; description_en: string; active: boolean;
  stages: TrackStageTemplate[]; maturity_dimensions: DimensionDraft[]; default_indicators: IndicatorDraft[];
  report_sections: string[]; session_types: string[];
}

export function toDraft(t: ProgramTrackTemplate): TrackDraft {
  return {
    name_ar: t.name_ar, name_en: t.name_en, description_ar: t.description_ar ?? '', description_en: t.description_en ?? '', active: t.active,
    stages: [...(t.stages ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((s) => ({
      ...s, depends_on: s.depends_on ?? [], required_evidence: s.required_evidence ?? [], record_types: s.record_types ?? [], requires_approval: !!s.requires_approval,
    })),
    maturity_dimensions: (t.maturity_dimensions ?? []).map((d) => ({ ...d, weight: Number(d.weight ?? 1) })),
    default_indicators: (t.default_indicators ?? []) as unknown as IndicatorDraft[],
    report_sections: t.report_sections ?? [],
    session_types: t.session_types ?? [],
  };
}

export function fromDraft(d: TrackDraft): Record<string, unknown> {
  return {
    name_ar: d.name_ar.trim(), name_en: d.name_en.trim(), description_ar: d.description_ar.trim() || null, description_en: d.description_en.trim() || null,
    active: d.active,
    stages: d.stages.map((s, i) => ({ ...s, key: s.key.trim(), order: i + 1, depends_on: s.depends_on.filter(Boolean) })),
    maturity_dimensions: d.maturity_dimensions.map((m) => ({ ...m, weight: Number(m.weight) })),
    default_indicators: d.default_indicators.map((x) => {
      const o: Record<string, unknown> = { ...x };
      if (x.indicator_type !== 'outcome' || !x.outcome_term) delete o.outcome_term;
      return o;
    }),
    report_sections: d.report_sections, session_types: d.session_types,
  };
}

export interface Problem { level: 'error' | 'warning'; text: L10n; stage?: string }

export function validateTrack(d: TrackDraft): Problem[] {
  const p: Problem[] = [];
  const err = (ar: string, en: string, stage?: string) => p.push({ level: 'error', text: { ar, en }, stage });
  const warn = (ar: string, en: string, stage?: string) => p.push({ level: 'warning', text: { ar, en }, stage });
  if (!d.name_ar.trim() || !d.name_en.trim()) err('اسم المسار بالعربية والإنجليزية إلزامي', 'Track name in Arabic and English is required');
  if (!d.stages.length) err('يجب أن يحتوي المسار على مرحلة واحدة على الأقل', 'The track needs at least one stage');
  const keys = d.stages.map((s) => s.key.trim());
  for (const k of duplicates(keys)) err(`مفتاح المرحلة «${k}» مكرر`, `Stage key “${k}” is duplicated`, k);
  d.stages.forEach((s, i) => {
    const k = s.key.trim();
    if (!KEY_PATTERN.test(k)) err(`المرحلة ${i + 1}: مفتاح غير صالح`, `Stage ${i + 1}: invalid key`, k);
    if (!s.name_ar.trim()) err(`المرحلة ${i + 1}: الاسم العربي إلزامي`, `Stage ${i + 1}: Arabic name required`, k);
    if (!s.name_en.trim()) warn(`المرحلة ${i + 1}: الاسم الإنجليزي فارغ`, `Stage ${i + 1}: English name empty`, k);
    for (const dep of s.depends_on) {
      const j = keys.indexOf(dep);
      if (j < 0) err(`المرحلة «${k}» تعتمد على مرحلة غير موجودة «${dep}»`, `Stage “${k}” depends on a missing stage “${dep}”`, k);
      else if (j >= i) err(`المرحلة «${k}» تعتمد على مرحلة لاحقة «${dep}» — الاعتماد يجب أن يكون على مرحلة سابقة`, `Stage “${k}” depends on a later stage “${dep}” — dependencies must point to earlier stages`, k);
    }
    for (const rt of s.record_types) if (!RECORD_TYPES[rt]) warn(`المرحلة «${k}»: نوع سجل غير معروف «${rt}»`, `Stage “${k}”: unknown record type “${rt}”`, k);
    if (s.requires_approval && !s.required_evidence.length) warn(`المرحلة «${k}» تتطلب اعتمادًا دون أدلة مطلوبة`, `Stage “${k}” requires approval but no evidence`, k);
  });
  // Cycle detection (defensive: also catches cycles if ordering rules change).
  const graph = new Map(d.stages.map((s) => [s.key.trim(), s.depends_on]));
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (k: string): boolean => {
    if (state.get(k) === 1) return true;
    if (state.get(k) === 2) return false;
    state.set(k, 1);
    for (const dep of graph.get(k) ?? []) if (graph.has(dep) && visit(dep)) return true;
    state.set(k, 2); return false;
  };
  for (const k of graph.keys()) if (visit(k)) { err('توجد حلقة في اعتماديات المراحل', 'Stage dependencies contain a cycle'); break; }

  const mk = d.maturity_dimensions.map((m) => m.key.trim());
  for (const k of duplicates(mk)) err(`بعد النضج «${k}» مكرر`, `Maturity dimension “${k}” is duplicated`);
  d.maturity_dimensions.forEach((m, i) => {
    if (!KEY_PATTERN.test(m.key.trim())) err(`بعد النضج ${i + 1}: مفتاح غير صالح`, `Maturity dimension ${i + 1}: invalid key`);
    if (!m.name_ar.trim()) err(`بعد النضج ${i + 1}: الاسم العربي إلزامي`, `Maturity dimension ${i + 1}: Arabic name required`);
    if (!(Number(m.weight) > 0)) err(`بعد النضج ${i + 1}: الوزن يجب أن يكون أكبر من صفر`, `Maturity dimension ${i + 1}: weight must be > 0`);
  });
  if (!d.maturity_dimensions.length) warn('لا توجد أبعاد نضج: لن تُقاس النضج قبل/بعد لبرامج هذا المسار', 'No maturity dimensions: before/after maturity cannot be measured for this track');

  const ik = d.default_indicators.map((x) => x.key.trim());
  for (const k of duplicates(ik)) err(`المؤشر «${k}» مكرر`, `Indicator “${k}” is duplicated`);
  d.default_indicators.forEach((x, i) => {
    if (!KEY_PATTERN.test(x.key.trim())) err(`المؤشر ${i + 1}: مفتاح غير صالح`, `Indicator ${i + 1}: invalid key`);
    if (!x.name_ar.trim()) err(`المؤشر ${i + 1}: الاسم العربي إلزامي`, `Indicator ${i + 1}: Arabic name required`);
    if (!x.unit.trim()) warn(`المؤشر ${i + 1}: الوحدة فارغة`, `Indicator ${i + 1}: unit is empty`);
  });
  if (!d.default_indicators.some((x) => x.indicator_type === 'outcome')) warn('لا توجد مؤشرات نتائج افتراضية', 'No default outcome indicators');
  return p;
}

export function newStage(existing: string[]): TrackStageTemplate {
  let n = existing.length + 1; while (existing.includes(`stage_${n}`)) n++;
  return { key: `stage_${n}`, name_ar: '', name_en: '', description_ar: '', description_en: '', order: n, depends_on: [], required_evidence: [], requires_approval: false, record_types: [] };
}
