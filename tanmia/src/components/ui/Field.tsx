import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { cx } from '@/utils/cx';
import { useI18n } from '@/i18n/I18nProvider';

export function Field({ label, hint, error, required, children, className, htmlFor }: {
  label?: ReactNode; hint?: ReactNode; error?: ReactNode; required?: boolean; children: ReactNode; className?: string; htmlFor?: string;
}) {
  return (
    <div className={cx('field', className)}>
      {label && <label htmlFor={htmlFor}>{label}{required && <span className="req" aria-hidden>*</span>}</label>}
      {children}
      {error ? <span className="err" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...rest }, ref) {
  return <input ref={ref} className={cx('input', className)} aria-invalid={invalid || undefined} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className, invalid, ...rest }, ref) {
  return <textarea ref={ref} className={cx('textarea', className)} aria-invalid={invalid || undefined} {...rest} />;
});

export interface Option { value: string; label: string; disabled?: boolean }
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { options: Option[]; placeholder?: string; invalid?: boolean }>(
  function Select({ options, placeholder, className, invalid, ...rest }, ref) {
    return (
      <select ref={ref} className={cx('select', className)} aria-invalid={invalid || undefined} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
      </select>
    );
  });

export function Checkbox({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** Free-text tag list (expertise, services, topics...). Enter or comma adds a tag. */
export function TagInput({ value, onChange, placeholder, suggestions }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; suggestions?: string[] }) {
  const [draft, setDraft] = useState('');
  const { tr } = useI18n();
  const listId = useId();
  const add = (raw: string) => {
    const parts = raw.split(/[,،]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...new Set([...value, ...parts])]);
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === '،') { e.preventDefault(); add(draft); }
    else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className="tags">
      {value.map((t) => (
        <span key={t} className="tag">{t}<button type="button" aria-label={tr('إزالة', 'Remove')} onClick={() => onChange(value.filter((x) => x !== t))}><X size={12} /></button></span>
      ))}
      <input value={draft} list={suggestions ? listId : undefined} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={() => draft && add(draft)}
        placeholder={value.length ? '' : placeholder ?? tr('اكتب ثم Enter', 'Type then Enter')} />
      {suggestions && <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>}
    </div>
  );
}

export function MultiCheck({ options, value, onChange }: { options: Option[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="row wrap" style={{ gap: '6px 14px' }}>
      {options.map((o) => (
        <Checkbox key={o.value} label={o.label} checked={value.includes(o.value)}
          onChange={(c) => onChange(c ? [...value, o.value] : value.filter((x) => x !== o.value))} />
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="group">
      {options.map((o) => <button key={o.value} type="button" className={cx(o.value === value && 'on')} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}
