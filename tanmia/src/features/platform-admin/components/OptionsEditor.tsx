// Choice options editor: value / Arabic label / English label / score.
import { Plus, Trash2 } from 'lucide-react';
import type { QuestionOption } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { Button, Input } from '@/components/ui';

export function OptionsEditor({ value, onChange, withScore = true }: { value: QuestionOption[]; onChange: (v: QuestionOption[]) => void; withScore?: boolean }) {
  const { tr } = useI18n();
  const set = (i: number, patch: Partial<QuestionOption>) => onChange(value.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  return (
    <div className="stack-sm" style={{ gap: 6 }}>
      {value.length > 0 && (
        <div className="row tiny muted">
          <span style={{ flex: '0 0 22%' }}>{tr('القيمة', 'Value')}</span><span className="grow">{tr('النص (عربي)', 'Label (AR)')}</span>
          <span className="grow">{tr('النص (إنجليزي)', 'Label (EN)')}</span>{withScore && <span style={{ width: 70 }}>{tr('الدرجة', 'Score')}</span>}<span style={{ width: 32 }} />
        </div>
      )}
      {value.map((o, i) => (
        <div key={i} className="row">
          <Input style={{ flex: '0 0 22%' }} dir="ltr" className="mono" value={o.value} onChange={(e) => set(i, { value: e.target.value })} aria-label={tr('القيمة', 'Value')} />
          <Input className="grow" value={o.label_ar ?? ''} onChange={(e) => set(i, { label_ar: e.target.value })} aria-label={tr('النص (عربي)', 'Label (AR)')} />
          <Input className="grow" dir="ltr" value={o.label_en ?? ''} onChange={(e) => set(i, { label_en: e.target.value })} aria-label={tr('النص (إنجليزي)', 'Label (EN)')} />
          {withScore && <Input style={{ width: 70 }} type="number" dir="ltr" value={o.score ?? ''} aria-label={tr('الدرجة', 'Score')}
            onChange={(e) => set(i, { score: e.target.value === '' ? null : Number(e.target.value) })} />}
          <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={tr('حذف', 'Remove')} />
        </div>
      ))}
      <div><Button size="sm" variant="ghost" icon={<Plus />} onClick={() => onChange([...value, { value: String(value.length + 1), label_ar: '', label_en: '', score: null }])}>{tr('إضافة خيار', 'Add option')}</Button></div>
    </div>
  );
}

/** Validation: non-empty unique values, Arabic or English label present. */
export function optionsProblems(opts: QuestionOption[]): [string, string] | null {
  if (!opts.length) return ['أضف خيارًا واحدًا على الأقل', 'Add at least one option'];
  const vals = opts.map((o) => o.value.trim());
  if (vals.some((v) => !v)) return ['قيمة خيار فارغة', 'An option value is empty'];
  if (new Set(vals).size !== vals.length) return ['قيم الخيارات مكررة', 'Option values are duplicated'];
  if (opts.some((o) => !(o.label_ar ?? '').trim() && !(o.label_en ?? '').trim())) return ['كل خيار يحتاج نصًا', 'Every option needs a label'];
  return null;
}
