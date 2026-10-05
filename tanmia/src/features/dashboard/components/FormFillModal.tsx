// Self-service form filling for beneficiaries / experts (published feedback &
// follow-up forms). Scoring is computed by the database trigger.
import { useEffect, useMemo, useState } from 'react';
import { isFieldVisible } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAuth } from '@/app/AuthProvider';
import { Button, Checkbox, Field, Input, Modal, MultiCheck, Notice, Select, Textarea, useToast } from '@/components/ui';
import { insert } from '@/services/db';
import { type AppError, errorOf } from '@/services/errors';
import type { FormField, FormTemplate } from '@/types/db';

const UNSUPPORTED = new Set(['file', 'signature']);

export function FormFillModal({ template, beneficiaryId, onClose, onDone }: {
  template: FormTemplate | null; beneficiaryId: string | null; onClose: () => void; onDone: () => void;
}) {
  const { tr, pick, locale } = useI18n();
  const { org } = useOrg();
  const { user } = useAuth();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const [error, setError] = useState<AppError | null>(null);
  useEffect(() => { setAnswers({}); setErrors({}); setError(null); }, [template?.id]);

  const fields = useMemo(() => (template?.schema?.fields ?? []).filter((f) => isFieldVisible(f.show_if ?? null, answers)), [template, answers]);
  const hasUnsupportedRequired = fields.some((f) => UNSUPPORTED.has(f.type) && f.required);
  const label = (f: FormField) => pick(f.label_ar, f.label_en ?? null);
  const set = (k: string, v: unknown) => setAnswers((a) => ({ ...a, [k]: v }));

  const submit = async () => {
    if (!template || !user) return;
    const errs: Record<string, boolean> = {};
    for (const f of fields) {
      if (!f.required || UNSUPPORTED.has(f.type)) continue;
      const v = answers[f.key];
      const empty = v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && !v.length)
        || (f.type === 'matrix' && (f.rows ?? []).some((r) => !(v as Record<string, unknown> | undefined)?.[r.key]));
      if (empty) errs[f.key] = true;
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const visibleKeys = new Set(fields.map((f) => f.key));
    const clean = Object.fromEntries(Object.entries(answers).filter(([k]) => visibleKeys.has(k)));
    setBusy(true); setError(null);
    try {
      await insert('form_submissions', {
        organization_id: org.id, template_id: template.id, template_version: template.version, program_id: template.program_id,
        beneficiary_id: beneficiaryId, submitted_by: user.id, answers: clean, status: 'submitted',
      });
      toast.success(tr('تم إرسال النموذج', 'Form submitted'));
      onDone(); onClose();
    } catch (e) { setError(errorOf(e)); } finally { setBusy(false); }
  };

  const optLabel = (o: { value: string; label_ar?: string; label_en?: string }) => pick(o.label_ar ?? o.value, o.label_en ?? null) || o.value;

  return (
    <Modal open={!!template} onClose={onClose} title={template ? pick(template.title, template.title_en) : ''} size="wide"
      footer={<><Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} disabled={hasUnsupportedRequired} onClick={submit}>{tr('إرسال', 'Submit')}</Button></>}>
      {template?.description && <p className="small muted">{template.description}</p>}
      {error && <Notice tone="danger">{locale === 'ar' ? error.message_ar : error.message_en}</Notice>}
      {hasUnsupportedRequired && <Notice tone="warning">{tr('يتضمن هذا النموذج حقولًا إلزامية (ملف/توقيع) لا يمكن تعبئتها من لوحة القيادة. تواصل مع فريق البرنامج.', 'This form has required file/signature fields that cannot be completed from the dashboard. Contact the program team.')}</Notice>}
      {!fields.length && <p className="muted small">{tr('لا توجد حقول في هذا النموذج.', 'This form has no fields.')}</p>}
      <div className="stack">
        {fields.map((f) => {
          const v = answers[f.key];
          const err = errors[f.key] ? tr('هذا الحقل إلزامي', 'This field is required') : undefined;
          const hint = pick(f.help_ar ?? null, f.help_en ?? null) || undefined;
          let control;
          switch (f.type) {
            case 'long_text': control = <Textarea value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value)} />; break;
            case 'number': control = <Input type="number" dir="ltr" min={f.min} max={f.max} value={v === undefined || v === null ? '' : String(v)} onChange={(e) => set(f.key, e.target.value === '' ? null : Number(e.target.value))} />; break;
            case 'date': control = <Input type="date" value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value)} />; break;
            case 'datetime': control = <Input type="datetime-local" value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value)} />; break;
            case 'single_choice': control = <Select options={(f.options ?? []).map((o) => ({ value: o.value, label: optLabel(o) }))} placeholder={tr('— اختر —', '— Select —')} value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value)} />; break;
            case 'multiple_choice': control = <MultiCheck options={(f.options ?? []).map((o) => ({ value: o.value, label: optLabel(o) }))} value={(v as string[]) ?? []} onChange={(x) => set(f.key, x)} />; break;
            case 'rating':
            case 'scale': {
              const min = f.min ?? 1; const max = f.max ?? 5;
              const opts = Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => min + i);
              control = (
                <div className="seg" role="group">
                  {opts.map((n) => <button key={n} type="button" className={v === n ? 'on' : undefined} aria-pressed={v === n} onClick={() => set(f.key, n)}>{n}</button>)}
                </div>
              );
              break;
            }
            case 'acknowledgment': control = <Checkbox label={label(f)} checked={v === true} onChange={(x) => set(f.key, x)} />; break;
            case 'matrix': {
              const cur = (v as Record<string, string> | undefined) ?? {};
              control = (
                <div className="table-wrap"><table className="table"><thead><tr><th />{(f.options ?? []).map((o) => <th key={o.value}>{optLabel(o)}</th>)}</tr></thead>
                  <tbody>{(f.rows ?? []).map((r) => (
                    <tr key={r.key}><td>{pick(r.label_ar, r.label_en ?? null)}</td>
                      {(f.options ?? []).map((o) => <td key={o.value}><input type="radio" name={`${f.key}-${r.key}`} checked={cur[r.key] === o.value} onChange={() => set(f.key, { ...cur, [r.key]: o.value })} aria-label={optLabel(o)} /></td>)}
                    </tr>
                  ))}</tbody></table></div>
              );
              break;
            }
            case 'file':
            case 'signature': control = <span className="small muted">{tr('هذا النوع من الحقول غير متاح في التعبئة السريعة.', 'This field type is not available in quick fill.')}</span>; break;
            default: control = <Input value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value)} />;
          }
          return <Field key={f.key} label={f.type === 'acknowledgment' ? undefined : label(f)} required={f.required} error={err} hint={hint}>{control}</Field>;
        })}
      </div>
    </Modal>
  );
}
