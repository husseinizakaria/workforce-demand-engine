// Reusable renderer for form templates (builder preview, staff fill-in,
// read-only review). Honors conditional logic (isFieldVisible), validates
// required/visible fields, uploads files to the org's evidence bucket and
// captures typed-name signatures.
import { useState } from 'react';
import { Download, Star } from 'lucide-react';
import { isFieldVisible, scoreFormAnswers } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { Badge, Button, Checkbox, Field, FileDrop, Input, Notice, Textarea } from '@/components/ui';
import { signedUrl, uploadFile } from '@/services/storage';
import { errorOf } from '@/services/errors';
import { fromLocalInput, toLocalInput } from '@/utils/dates';
import type { FormField } from '@/types/db';
import type { Msg } from '../formUtils';

export { validateFormAnswers, visibleAnswers, extractSignature } from '../formUtils';

export interface FileAnswer { path: string; name: string; size: number; type: string }
export interface SignatureAnswer { name: string; acknowledged_at: string }

export interface FormRendererProps {
  fields: FormField[];
  answers: Record<string, unknown>;
  onChange?: (answers: Record<string, unknown>) => void;
  readOnly?: boolean;
  errors?: Record<string, Msg>;
  organizationId?: string;            // required for file uploads
  scoringEnabled?: boolean;           // shows the live score (engine mirror of the DB trigger)
  highlightKey?: string | null;       // builder: highlight the selected field
  onFieldClick?: (key: string) => void;
}

export function FormRenderer(p: FormRendererProps) {
  const { tr, pick, locale, fmtNumber } = useI18n();
  const set = (k: string, v: unknown) => p.onChange?.({ ...p.answers, [k]: v });
  const visible = p.fields.filter((f) => isFieldVisible(f.show_if ?? null, p.answers));
  const score = p.scoringEnabled ? scoreFormAnswers(p.fields.filter((f) => isFieldVisible(f.show_if ?? null, p.answers)), p.answers, true) : null;
  const hidden = p.fields.length - visible.length;
  return (
    <div className="stack">
      {visible.map((f) => {
        const err = p.errors?.[f.key];
        const label = pick(f.label_ar, f.label_en) || f.key;
        const help = pick(f.help_ar, f.help_en);
        return (
          <div key={f.key} onClick={p.onFieldClick ? () => p.onFieldClick!(f.key) : undefined}
            style={p.highlightKey === f.key ? { outline: '2px solid var(--primary)', outlineOffset: 4, borderRadius: 4 } : p.onFieldClick ? { cursor: 'pointer' } : undefined}>
            <Field label={f.type === 'acknowledgment' ? undefined : label} required={!!f.required} hint={help || undefined} error={err ? (locale === 'ar' ? err[0] : err[1]) : undefined}>
              <FieldControl f={f} value={p.answers[f.key]} onChange={(v) => set(f.key, v)} readOnly={!!p.readOnly} organizationId={p.organizationId} label={label} />
            </Field>
          </div>
        );
      })}
      {!p.fields.length && <p className="small muted">{tr('لا توجد حقول.', 'No fields.')}</p>}
      {hidden > 0 && !p.readOnly && <span className="tiny muted">{tr(`${hidden} حقل مخفي بحسب الإجابات (منطق شرطي)`, `${hidden} field(s) hidden by conditional logic`)}</span>}
      {p.scoringEnabled && (
        <div className="row between card card-pad" style={{ padding: '8px 12px' }}>
          <span className="small">{tr('الدرجة المحتسبة (معاينة)', 'Computed score (preview)')}</span>
          <b className="mono">{score === null ? '—' : fmtNumber(score, 2)}</b>
        </div>
      )}
    </div>
  );
}

const range = (a: number, b: number) => { const o: number[] = []; for (let i = Math.ceil(a); i <= Math.floor(b) && o.length < 21; i++) o.push(i); return o; };

function FieldControl({ f, value, onChange, readOnly, organizationId, label }: {
  f: FormField; value: unknown; onChange: (v: unknown) => void; readOnly: boolean; organizationId?: string; label: string;
}) {
  const { tr, pick, fmtDate, fmtDateTime, locale } = useI18n();
  const [uploading, setUploading] = useState(false);
  const [upErr, setUpErr] = useState<string | null>(null);
  const name = `ff-${f.key}`;
  switch (f.type) {
    case 'text':
      return readOnly ? <div className="small">{String(value ?? '—')}</div> : <Input value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'long_text':
      return readOnly ? <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{String(value ?? '—')}</div> : <Textarea rows={3} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return readOnly ? <div className="mono">{value === undefined || value === null ? '—' : String(value)}</div>
        : <Input type="number" step="any" className="ltr" min={f.min ?? undefined} max={f.max ?? undefined} value={typeof value === 'number' ? value : ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} style={{ maxWidth: 200 }} />;
    case 'date':
      return readOnly ? <div className="small">{value ? fmtDate(String(value)) : '—'}</div> : <Input type="date" value={String(value ?? '')} onChange={(e) => onChange(e.target.value || undefined)} style={{ maxWidth: 200 }} />;
    case 'datetime':
      return readOnly ? <div className="small">{value ? fmtDateTime(String(value)) : '—'}</div>
        : <Input type="datetime-local" value={typeof value === 'string' && value ? toLocalInput(value) : ''} onChange={(e) => onChange(e.target.value ? fromLocalInput(e.target.value) : undefined)} style={{ maxWidth: 240 }} />;
    case 'single_choice':
      return (
        <div className="stack-sm" style={{ gap: 4 }} role="radiogroup" aria-label={label}>
          {(f.options ?? []).map((o) => (
            <label key={o.value} className="check"><input type="radio" name={name} disabled={readOnly} checked={value === o.value} onChange={() => onChange(o.value)} /><span>{pick(o.label_ar, o.label_en) || o.value}</span></label>
          ))}
        </div>
      );
    case 'multiple_choice': {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="stack-sm" style={{ gap: 4 }}>
          {(f.options ?? []).map((o) => (
            <label key={o.value} className="check"><input type="checkbox" disabled={readOnly} checked={arr.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...arr, o.value] : arr.filter((x) => x !== o.value))} /><span>{pick(o.label_ar, o.label_en) || o.value}</span></label>
          ))}
        </div>
      );
    }
    case 'rating': {
      const max = Math.max(1, Math.min(10, Number(f.max ?? 5)));
      const v = typeof value === 'number' ? value : 0;
      return (
        <div className="row" style={{ gap: 2 }} role="radiogroup" aria-label={label}>
          {range(Number(f.min ?? 1), max).map((s) => (
            <button key={s} type="button" disabled={readOnly} className="link-btn" aria-label={`${s}`} aria-pressed={v >= s} onClick={() => onChange(s)}
              style={{ color: v >= s ? 'var(--warning)' : 'var(--border-strong)' }}><Star size={20} fill={v >= s ? 'currentColor' : 'none'} /></button>
          ))}
          <span className="mono small" style={{ marginInlineStart: 6 }}>{v || '—'}</span>
        </div>
      );
    }
    case 'scale': {
      const steps = range(Number(f.min ?? 1), Number(f.max ?? 10));
      return (
        <div className="row wrap" style={{ gap: 4 }} role="radiogroup" aria-label={label}>
          {steps.map((s) => (
            <label key={s} className="check" style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px', background: value === s ? 'var(--primary-soft)' : undefined }}>
              <input type="radio" name={name} disabled={readOnly} checked={value === s} onChange={() => onChange(s)} /><span className="mono">{s}</span>
            </label>
          ))}
        </div>
      );
    }
    case 'matrix': {
      const m = (value && typeof value === 'object' ? value : {}) as Record<string, string>;
      return (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th />{(f.options ?? []).map((o) => <th key={o.value} className="num">{pick(o.label_ar, o.label_en) || o.value}</th>)}</tr></thead>
            <tbody>{(f.rows ?? []).map((r) => (
              <tr key={r.key}>
                <td className="small">{pick(r.label_ar, r.label_en) || r.key}</td>
                {(f.options ?? []).map((o) => (
                  <td key={o.value} className="num"><input type="radio" name={`${name}-${r.key}`} disabled={readOnly} checked={m[r.key] === o.value} onChange={() => onChange({ ...m, [r.key]: o.value })} aria-label={`${r.key} ${o.value}`} /></td>
                ))}
              </tr>
            ))}</tbody>
          </table>
        </div>
      );
    }
    case 'file': {
      const fv = value && typeof value === 'object' ? (value as FileAnswer) : null;
      const open = async () => { if (fv?.path) { try { window.open(await signedUrl('evidence', fv.path), '_blank', 'noopener'); } catch (e) { setUpErr(locale === 'ar' ? errorOf(e).message_ar : errorOf(e).message_en); } } };
      if (readOnly) return fv ? <Button size="sm" icon={<Download />} onClick={open}>{fv.name}</Button> : <span className="muted">—</span>;
      return (
        <div className="stack-sm">
          {organizationId ? <FileDrop file={null} onFiles={async (files) => {
            const file = files[0]; if (!file) return;
            setUploading(true); setUpErr(null);
            try { const r = await uploadFile('evidence', organizationId, 'forms', file); onChange({ path: r.path, name: r.name, size: r.size, type: r.type } satisfies FileAnswer); }
            catch (e) { setUpErr(locale === 'ar' ? errorOf(e).message_ar : errorOf(e).message_en); } finally { setUploading(false); }
          }} /> : <Notice tone="info">{tr('رفع الملفات متاح عند التعبئة الفعلية.', 'File upload is available when actually filling the form.')}</Notice>}
          {uploading && <span className="small muted">{tr('جارٍ الرفع…', 'Uploading…')}</span>}
          {fv && <div className="row small"><Badge tone="success">{tr('مرفوع', 'Uploaded')}</Badge>{fv.name}<button type="button" className="link-btn tiny" onClick={() => onChange(undefined)}>{tr('إزالة', 'Remove')}</button></div>}
          {upErr && <span className="small" style={{ color: 'var(--danger)' }}>{upErr}</span>}
        </div>
      );
    }
    case 'signature': {
      const s = value && typeof value === 'object' ? (value as Partial<SignatureAnswer>) : {};
      if (readOnly) return s.name ? <div className="small"><b>{s.name}</b> · {fmtDateTime(s.acknowledged_at ?? null)}</div> : <span className="muted">—</span>;
      return (
        <div className="stack-sm">
          <Input value={s.name ?? ''} placeholder={tr('اكتب اسمك الكامل', 'Type your full name')} onChange={(e) => onChange(e.target.value ? { name: e.target.value, acknowledged_at: s.acknowledged_at } : undefined)} />
          <Checkbox label={tr('أقر بأن الاسم المكتوب يمثل توقيعي على هذا النموذج', 'I confirm the typed name is my signature on this form')} checked={!!s.acknowledged_at}
            disabled={!s.name?.trim()} onChange={(c) => onChange({ name: s.name ?? '', acknowledged_at: c ? new Date().toISOString() : undefined })} />
        </div>
      );
    }
    case 'acknowledgment':
      return <Checkbox label={<>{label}{f.required && <span style={{ color: 'var(--danger)' }}> *</span>}</>} checked={value === true} disabled={readOnly} onChange={(c) => onChange(c ? true : undefined)} />;
    default:
      return null;
  }
}
