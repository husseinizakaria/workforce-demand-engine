// Form builder helpers: keys, validation of a form schema and of answers.
import { isFieldVisible } from '@engine';
import type { FormField, FormFieldType } from '@/types/db';

export type Msg = [ar: string, en: string];

export const FIELD_TYPES: FormFieldType[] = ['text', 'long_text', 'number', 'date', 'datetime', 'single_choice', 'multiple_choice', 'rating', 'scale', 'matrix', 'file', 'signature', 'acknowledgment'];
export const CHOICE_TYPES = new Set<FormFieldType>(['single_choice', 'multiple_choice', 'matrix']);
export const RANGE_TYPES = new Set<FormFieldType>(['number', 'rating', 'scale']);
export const SCORABLE = new Set<FormFieldType>(['single_choice', 'multiple_choice', 'rating', 'scale', 'number']);

export const KEY_RE = /^[a-z][a-z0-9_]{0,48}$/;

export function slugify(s: string): string {
  return s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 40);
}

export function uniqueKey(base: string, taken: Set<string>): string {
  let k = KEY_RE.test(base) ? base : `field${base ? `_${base}` : ''}`.replace(/[^a-z0-9_]/g, '').slice(0, 40) || 'field';
  if (!/^[a-z]/.test(k)) k = `f_${k}`;
  if (!taken.has(k)) return k;
  let i = 2;
  while (taken.has(`${k}_${i}`)) i++;
  return `${k}_${i}`;
}

export function keyFromLabel(f: Pick<FormField, 'label_en' | 'label_ar'>, index: number, taken: Set<string>): string {
  const base = slugify(f.label_en ?? '') || `q${index + 1}`;
  return uniqueKey(base, taken);
}

export function newField(type: FormFieldType, index: number, taken: Set<string>): FormField {
  const f: FormField = { key: uniqueKey(`q${index + 1}`, taken), type, label_ar: '', label_en: '', required: false };
  if (type === 'single_choice' || type === 'multiple_choice') f.options = [{ value: 'a', label_ar: 'خيار 1', label_en: 'Option 1' }, { value: 'b', label_ar: 'خيار 2', label_en: 'Option 2' }];
  if (type === 'matrix') { f.rows = [{ key: 'r1', label_ar: 'بند 1', label_en: 'Item 1' }]; f.options = [{ value: '1', label_ar: '1', label_en: '1' }, { value: '2', label_ar: '2', label_en: '2' }, { value: '3', label_ar: '3', label_en: '3' }]; }
  if (type === 'rating') { f.min = 1; f.max = 5; }
  if (type === 'scale') { f.min = 1; f.max = 10; }
  return f;
}

/** Schema problems (errors block publish; warnings inform). */
export function schemaIssues(fields: FormField[], scoringEnabled: boolean): { errors: { key: string; msg: Msg }[]; warnings: { key: string; msg: Msg }[] } {
  const errors: { key: string; msg: Msg }[] = []; const warnings: { key: string; msg: Msg }[] = [];
  const seen = new Set<string>();
  if (!fields.length) errors.push({ key: '', msg: ['النموذج بلا حقول', 'The form has no fields'] });
  fields.forEach((f, i) => {
    const k = f.key || `#${i + 1}`;
    if (!KEY_RE.test(f.key)) errors.push({ key: k, msg: [`المفتاح «${f.key}» غير صالح (حروف إنجليزية صغيرة وأرقام و_)`, `Key “${f.key}” is invalid (lowercase letters, digits, _)`] });
    if (seen.has(f.key)) errors.push({ key: k, msg: [`المفتاح «${f.key}» مكرر`, `Duplicate key “${f.key}”`] });
    seen.add(f.key);
    if (!f.label_ar?.trim()) errors.push({ key: k, msg: [`الحقل ${k}: التسمية العربية مفقودة`, `Field ${k}: Arabic label missing`] });
    if (!f.label_en?.trim()) warnings.push({ key: k, msg: [`الحقل ${k}: التسمية الإنجليزية مفقودة`, `Field ${k}: English label missing`] });
    if (CHOICE_TYPES.has(f.type)) {
      const opts = f.options ?? [];
      if (opts.length < (f.type === 'matrix' ? 2 : 1)) errors.push({ key: k, msg: [`الحقل ${k}: خيارات غير كافية`, `Field ${k}: not enough options`] });
      if (new Set(opts.map((o) => o.value)).size !== opts.length || opts.some((o) => !String(o.value).trim())) errors.push({ key: k, msg: [`الحقل ${k}: قيم الخيارات فارغة أو مكررة`, `Field ${k}: empty or duplicate option values`] });
      if (scoringEnabled && f.type !== 'matrix' && opts.length && opts.every((o) => o.score === null || o.score === undefined)) warnings.push({ key: k, msg: [`الحقل ${k}: لا درجات للخيارات فلن يُحتسب`, `Field ${k}: no option scores, so it is not scored`] });
    }
    if (f.type === 'matrix' && !(f.rows ?? []).length) errors.push({ key: k, msg: [`الحقل ${k}: المصفوفة بلا بنود`, `Field ${k}: matrix has no rows`] });
    if (RANGE_TYPES.has(f.type) && f.min !== undefined && f.max !== undefined && f.min !== null && f.max !== null && Number(f.min) >= Number(f.max)) errors.push({ key: k, msg: [`الحقل ${k}: الحد الأدنى ≥ الأعلى`, `Field ${k}: min ≥ max`] });
    if (f.show_if?.field) {
      const idx = fields.findIndex((x) => x.key === f.show_if!.field);
      if (idx < 0) errors.push({ key: k, msg: [`الحقل ${k}: شرط الإظهار يشير لحقل غير موجود`, `Field ${k}: visibility rule references a missing field`] });
      else if (idx >= i) errors.push({ key: k, msg: [`الحقل ${k}: شرط الإظهار يجب أن يشير لحقل سابق`, `Field ${k}: visibility rule must reference an earlier field`] });
      if (f.show_if.op !== 'filled' && (f.show_if.value === undefined || f.show_if.value === '')) warnings.push({ key: k, msg: [`الحقل ${k}: شرط الإظهار دون قيمة`, `Field ${k}: visibility rule has no value`] });
      if (f.required && f.show_if) warnings.push({ key: k, msg: [`الحقل ${k}: إلزامي فقط عند ظهوره`, `Field ${k}: required only when visible`] });
    }
  });
  if (scoringEnabled && !fields.some((f) => SCORABLE.has(f.type) && (f.type === 'single_choice' || f.type === 'multiple_choice' ? (f.options ?? []).some((o) => o.score !== null && o.score !== undefined) : !!f.scoring))) {
    warnings.push({ key: '', msg: ['الاحتساب مفعّل لكن لا يوجد حقل محتسب', 'Scoring is enabled but no field is scored'] });
  }
  return { errors, warnings };
}

const emptyVal = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

export function validateFormAnswers(fields: FormField[], answers: Record<string, unknown>): Record<string, Msg> {
  const errs: Record<string, Msg> = {};
  for (const f of fields) {
    if (!isFieldVisible(f.show_if ?? null, answers)) continue;
    const v = answers[f.key];
    if (f.type === 'acknowledgment') { if (f.required && v !== true) errs[f.key] = ['يجب الإقرار', 'Acknowledgment required']; continue; }
    if (f.type === 'signature') {
      const s = v as { name?: string; acknowledged_at?: string } | undefined;
      if (f.required && (!s?.name?.trim() || !s.acknowledged_at)) errs[f.key] = ['التوقيع بالاسم الكامل والإقرار مطلوبان', 'Full-name signature and confirmation are required'];
      continue;
    }
    if (f.type === 'matrix') {
      const m = (v ?? {}) as Record<string, unknown>;
      if (f.required && (f.rows ?? []).some((r) => emptyVal(m[r.key]))) errs[f.key] = ['أجب عن جميع البنود', 'Answer all items'];
      continue;
    }
    if (f.required && emptyVal(v)) { errs[f.key] = ['هذا الحقل إلزامي', 'This field is required']; continue; }
    if (!emptyVal(v) && RANGE_TYPES.has(f.type)) {
      const n = Number(v);
      if (!Number.isFinite(n)) errs[f.key] = ['رقم غير صالح', 'Invalid number'];
      else if (f.min !== undefined && f.min !== null && n < Number(f.min)) errs[f.key] = [`الحد الأدنى ${f.min}`, `Minimum is ${f.min}`];
      else if (f.max !== undefined && f.max !== null && n > Number(f.max)) errs[f.key] = [`الحد الأقصى ${f.max}`, `Maximum is ${f.max}`];
    }
  }
  return errs;
}

/** Keep only answers of visible fields (hidden branches are discarded on submit). */
export function visibleAnswers(fields: FormField[], answers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) if (isFieldVisible(f.show_if ?? null, answers) && !emptyVal(answers[f.key])) out[f.key] = answers[f.key];
  return out;
}

export function extractSignature(fields: FormField[], answers: Record<string, unknown>): { name: string; acknowledged_at: string } | null {
  const f = fields.find((x) => x.type === 'signature' && answers[x.key]);
  const s = f ? (answers[f.key] as { name?: string; acknowledged_at?: string }) : null;
  return s?.name && s.acknowledged_at ? { name: s.name, acknowledged_at: s.acknowledged_at } : null;
}

/** Flat value of an answer for CSV export. */
export function answerToCell(f: FormField | undefined, v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.join('|');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (f?.type === 'file') return String(o.name ?? o.path ?? '');
    if (f?.type === 'signature') return `${o.name ?? ''} @ ${o.acknowledged_at ?? ''}`;
    return Object.entries(o).map(([k, x]) => `${k}=${String(x)}`).join('; ');
  }
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  return String(v);
}
