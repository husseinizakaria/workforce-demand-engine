// Small presentational helpers for the assessment module.
import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import type { ClassBand } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { Badge, Notice } from '@/components/ui';
import type { AppError } from '@/services/errors';
import type { AssessmentQuestion, RubricLevel } from '@/types/db';
import type { ResponseValue } from '@engine';

/** Renders a server-provided value whose exact shape may vary (string, {ar,en}, arrays, objects). */
export function useRichText() {
  const { locale } = useI18n();
  const text = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return v.map(text).filter(Boolean).join(' · ');
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if ('ar' in o || 'en' in o) return String((locale === 'ar' ? o.ar || o.en : o.en || o.ar) ?? '');
      for (const k of [`text_${locale}`, `title_${locale}`, `label_${locale}`, 'text', 'title', 'label', 'name', 'message']) if (o[k]) return text(o[k]);
      return Object.entries(o).map(([k, x]) => `${k}: ${text(x)}`).join(' · ');
    }
    return String(v);
  };
  return text;
}

export function RichList({ items }: { items: unknown }) {
  const text = useRichText();
  const arr = Array.isArray(items) ? items : items ? [items] : [];
  if (!arr.length) return <span className="muted small">—</span>;
  return <ul className="small" style={{ margin: 0, paddingInlineStart: 18 }}>{arr.map((x, i) => <li key={i}>{text(x)}</li>)}</ul>;
}

export function GeneratedBy({ value }: { value: unknown }) {
  const { tr } = useI18n();
  const llm = typeof value === 'string' && value.includes('llm');
  return <Badge tone={llm ? 'info' : 'outline'} icon={<Sparkles size={12} />}>{llm ? tr('قواعد + نموذج لغوي', 'Rules + LLM') : tr('قواعد التحليل', 'Rules engine')}</Badge>;
}

/** Explains an Edge Function failure without faking a result. */
export function FunctionError({ error }: { error: AppError | null }) {
  const { tr, locale } = useI18n();
  if (!error) return null;
  if (error.code === 'function_unavailable' || error.code === '404') {
    return <Notice tone="warning">{tr('خدمة التحليل في الخادم غير منشورة حاليًا؛ لم يُنتج أي تفسير. المعاينة المحسوبة محليًا أعلاه تبقى صالحة.', 'The server analysis service is not deployed; no interpretation was produced. The locally computed view above remains valid.')}</Notice>;
  }
  if (error.code === 'llm_not_configured') {
    return <Notice tone="warning">{tr('النموذج اللغوي غير مهيأ لهذه المنصة (llm_not_configured). يمكن لمالك المنصة تفعيله من التكاملات.', 'The language model is not configured for this platform (llm_not_configured). The platform owner can enable it under Integrations.')}</Notice>;
  }
  return <Notice tone="danger">{locale === 'ar' ? error.message_ar : error.message_en}</Notice>;
}

export function BandBadge({ band }: { band: ClassBand | null | undefined }) {
  const { pick } = useI18n();
  if (!band) return <span className="muted">—</span>;
  const tone = band.min >= 80 ? 'success' : band.min >= 60 ? 'primary' : band.min >= 40 ? 'warning' : 'danger';
  return <Badge tone={tone}>{pick(band.label_ar, band.label_en)}</Badge>;
}

export function Section({ title, children, actions }: { title: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="stack-sm">
      <div className="row between wrap"><h4>{title}</h4>{actions}</div>
      {children}
    </div>
  );
}

const range = (a: number, b: number) => { const out: number[] = []; for (let i = Math.ceil(a); i <= Math.floor(b); i++) out.push(i); return out; };

/** Input control for one assessment question, by question_type. */
export function QuestionInput({ q, value, onChange, scaleMin, scaleMax, rubric, disabled }: {
  q: AssessmentQuestion; value: ResponseValue; onChange: (v: ResponseValue) => void; scaleMin: number; scaleMax: number; rubric?: RubricLevel[]; disabled?: boolean;
}) {
  const { tr, pick } = useI18n();
  const name = `q-${q.id}`;
  switch (q.question_type) {
    case 'scale': {
      const steps = range(scaleMin, scaleMax);
      if (steps.length > 0 && steps.length <= 11) {
        return (
          <div className="row wrap" role="radiogroup" style={{ gap: 6 }}>
            {steps.map((s) => {
              const lvl = rubric?.find((r) => Number(r.score) === s);
              return (
                <label key={s} className="check" title={lvl ? pick(lvl.label_ar, lvl.label_en) : undefined}
                  style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', background: value === s ? 'var(--primary-soft)' : undefined }}>
                  <input type="radio" name={name} checked={value === s} disabled={disabled} onChange={() => onChange(s)} />
                  <span className="mono">{s}</span>{lvl && <span className="tiny muted">{pick(lvl.label_ar, lvl.label_en)}</span>}
                </label>
              );
            })}
            {value !== undefined && value !== null && !disabled && <button type="button" className="link-btn tiny" onClick={() => onChange(undefined)}>{tr('مسح', 'Clear')}</button>}
          </div>
        );
      }
      return (
        <div className="row">
          <input type="range" min={scaleMin} max={scaleMax} step="any" value={typeof value === 'number' ? value : scaleMin} disabled={disabled}
            onChange={(e) => onChange(Number(e.target.value))} style={{ flex: 1 }} aria-label={tr('القيمة', 'Value')} />
          <span className="mono" style={{ minWidth: 48 }}>{typeof value === 'number' ? value.toFixed(1) : '—'}</span>
        </div>
      );
    }
    case 'number':
      return <input className="input ltr" type="number" step="any" min={scaleMin} max={scaleMax} disabled={disabled} value={typeof value === 'number' ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} style={{ maxWidth: 160 }} />;
    case 'boolean':
      return (
        <div className="row" role="radiogroup">
          <label className="check"><input type="radio" name={name} checked={value === true} disabled={disabled} onChange={() => onChange(true)} /><span>{tr('نعم', 'Yes')}</span></label>
          <label className="check"><input type="radio" name={name} checked={value === false} disabled={disabled} onChange={() => onChange(false)} /><span>{tr('لا', 'No')}</span></label>
        </div>
      );
    case 'single_choice':
      return (
        <div className="stack-sm" role="radiogroup" style={{ gap: 4 }}>
          {(q.options ?? []).map((o) => (
            <label key={o.value} className="check">
              <input type="radio" name={name} checked={value === o.value} disabled={disabled} onChange={() => onChange(o.value)} />
              <span>{pick(o.label_ar, o.label_en) || o.value}</span>
            </label>
          ))}
        </div>
      );
    case 'multiple_choice': {
      const arr = Array.isArray(value) ? value : [];
      return (
        <div className="stack-sm" style={{ gap: 4 }}>
          {(q.options ?? []).map((o) => (
            <label key={o.value} className="check">
              <input type="checkbox" checked={arr.includes(o.value)} disabled={disabled}
                onChange={(e) => onChange(e.target.checked ? [...arr, o.value] : arr.filter((x) => x !== o.value))} />
              <span>{pick(o.label_ar, o.label_en) || o.value}</span>
            </label>
          ))}
        </div>
      );
    }
    default:
      return <textarea className="textarea" rows={2} disabled={disabled} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />;
  }
}
