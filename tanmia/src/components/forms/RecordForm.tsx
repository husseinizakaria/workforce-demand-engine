// Declarative form used for create/edit dialogs across modules.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import type { EnumGroup } from '@/i18n/enums';
import { Checkbox, EntityPicker, Field, Input, Modal, MultiCheck, Select, TagInput, Textarea, Button, Notice, type EntityKind, type Option } from '@/components/ui';
import { useOrg } from '@/app/OrgProvider';
import { type AppError, errorOf } from '@/services/errors';
import { fromLocalInput, toLocalInput } from '@/utils/dates';

export type FieldSpec = {
  name: string;
  label: [string, string];
  type: 'text' | 'email' | 'tel' | 'url' | 'textarea' | 'number' | 'date' | 'datetime' | 'select' | 'enum' | 'enum-multi' | 'tags' | 'checkbox' | 'entity';
  required?: boolean;
  hint?: [string, string];
  options?: Option[];             // for 'select'
  enumGroup?: EnumGroup;          // for 'enum' / 'enum-multi'
  entity?: EntityKind;            // for 'entity'
  entityFilters?: [string, 'eq', unknown][];
  min?: number; max?: number; step?: number;
  full?: boolean;                 // span both columns
  placeholder?: string;
  disabled?: boolean;
  visible?: (values: Record<string, unknown>) => boolean;
  validate?: (v: unknown, values: Record<string, unknown>) => [string, string] | null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateRecord(fields: FieldSpec[], values: Record<string, unknown>): Record<string, [string, string]> {
  const errs: Record<string, [string, string]> = {};
  for (const f of fields) {
    if (f.visible && !f.visible(values)) continue;
    const v = values[f.name];
    const empty = v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
    if (f.required && empty && f.type !== 'checkbox') { errs[f.name] = ['هذا الحقل إلزامي', 'This field is required']; continue; }
    if (empty) continue;
    if (f.type === 'email' && !EMAIL.test(String(v))) errs[f.name] = ['بريد إلكتروني غير صالح', 'Invalid email address'];
    if (f.type === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n)) errs[f.name] = ['رقم غير صالح', 'Invalid number'];
      else if (f.min !== undefined && n < f.min) errs[f.name] = [`الحد الأدنى ${f.min}`, `Minimum is ${f.min}`];
      else if (f.max !== undefined && n > f.max) errs[f.name] = [`الحد الأقصى ${f.max}`, `Maximum is ${f.max}`];
    }
    const custom = f.validate?.(v, values);
    if (custom) errs[f.name] = custom;
  }
  return errs;
}

/** Normalize UI values to DB values: '' → null, numbers parsed, datetime → ISO. */
export function normalizeRecord(fields: FieldSpec[], values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.visible && !f.visible(values)) continue;
    let v = values[f.name];
    if (v === '' || v === undefined) v = null;
    if (f.type === 'number' && v !== null) v = Number(v);
    if (f.type === 'datetime' && typeof v === 'string' && v) v = fromLocalInput(v);
    if ((f.type === 'tags' || f.type === 'enum-multi') && v === null) v = [];
    if (f.type === 'checkbox') v = Boolean(v);
    if ((f.type === 'email') && typeof v === 'string') v = v.trim().toLowerCase();
    out[f.name] = v;
  }
  return out;
}

export function RecordFields({ fields, values, onChange, errors }: {
  fields: FieldSpec[]; values: Record<string, unknown>; onChange: (name: string, v: unknown) => void; errors: Record<string, [string, string]>;
}) {
  const { tr, enumOptions, locale } = useI18n();
  const { org } = useOrg();
  return (
    <div className="form-grid">
      {fields.filter((f) => !f.visible || f.visible(values)).map((f) => {
        const err = errors[f.name];
        const v = values[f.name];
        const id = `fld-${f.name}`;
        let control: ReactNode;
        switch (f.type) {
          case 'textarea': control = <Textarea id={id} value={String(v ?? '')} onChange={(e) => onChange(f.name, e.target.value)} invalid={!!err} disabled={f.disabled} placeholder={f.placeholder} />; break;
          case 'select': control = <Select id={id} options={f.options ?? []} placeholder={tr('— اختر —', '— Select —')} value={String(v ?? '')} onChange={(e) => onChange(f.name, e.target.value)} invalid={!!err} disabled={f.disabled} />; break;
          case 'enum': control = <Select id={id} options={enumOptions(f.enumGroup!)} placeholder={f.required ? undefined : tr('— اختر —', '— Select —')} value={String(v ?? '')} onChange={(e) => onChange(f.name, e.target.value)} invalid={!!err} disabled={f.disabled} />; break;
          case 'enum-multi': control = <MultiCheck options={enumOptions(f.enumGroup!)} value={(v as string[]) ?? []} onChange={(x) => onChange(f.name, x)} />; break;
          case 'tags': control = <TagInput value={(v as string[]) ?? []} onChange={(x) => onChange(f.name, x)} placeholder={f.placeholder} />; break;
          case 'checkbox': control = <Checkbox label={locale === 'ar' ? f.label[0] : f.label[1]} checked={Boolean(v)} onChange={(x) => onChange(f.name, x)} disabled={f.disabled} />; break;
          case 'entity': control = <EntityPicker kind={f.entity!} organizationId={org.id} value={(v as string) ?? null} filters={f.entityFilters} onChange={(x) => onChange(f.name, x)} disabled={f.disabled} />; break;
          case 'datetime': control = <Input id={id} type="datetime-local" value={typeof v === 'string' && v.includes('T') && v.length > 16 ? toLocalInput(v) : String(v ?? '')} onChange={(e) => onChange(f.name, e.target.value)} invalid={!!err} disabled={f.disabled} />; break;
          default:
            control = <Input id={id} type={f.type === 'number' ? 'number' : f.type} value={v === null || v === undefined ? '' : String(v)} min={f.min} max={f.max} step={f.step ?? (f.type === 'number' ? 'any' : undefined)}
              onChange={(e) => onChange(f.name, e.target.value)} invalid={!!err} disabled={f.disabled} placeholder={f.placeholder}
              dir={['email', 'tel', 'url', 'number'].includes(f.type) ? 'ltr' : undefined} />;
        }
        return (
          <Field key={f.name} htmlFor={id} className={f.full || f.type === 'textarea' || f.type === 'enum-multi' ? 'full' : undefined}
            label={f.type === 'checkbox' ? undefined : (locale === 'ar' ? f.label[0] : f.label[1])} required={f.required}
            hint={f.hint ? (locale === 'ar' ? f.hint[0] : f.hint[1]) : undefined} error={err ? (locale === 'ar' ? err[0] : err[1]) : undefined}>
            {control}
          </Field>
        );
      })}
    </div>
  );
}

/** Modal create/edit form. `onSubmit` receives normalized values. */
export function RecordFormModal({ open, title, fields, initial, onClose, onSubmit, submitLabel, size, intro }: {
  open: boolean; title: string; fields: FieldSpec[]; initial?: Record<string, unknown>; onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => Promise<unknown>; submitLabel?: string; size?: 'narrow' | 'wide'; intro?: ReactNode;
}) {
  const { tr, locale } = useI18n();
  const [values, setValues] = useState<Record<string, unknown>>(initial ?? {});
  const [errors, setErrors] = useState<Record<string, [string, string]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const initKey = useMemo(() => JSON.stringify(initial ?? {}), [initial]);
  useEffect(() => { if (open) { setValues(initial ?? {}); setErrors({}); setError(null); } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initKey]);

  const submit = async () => {
    const errs = validateRecord(fields, values);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    try { await onSubmit(normalizeRecord(fields, values)); onClose(); }
    catch (e) { setError(errorOf(e)); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={open} title={title} onClose={onClose} size={size}
      footer={<><Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} onClick={submit}>{submitLabel ?? tr('حفظ', 'Save')}</Button></>}>
      {intro}
      {error && <Notice tone="danger">{locale === 'ar' ? error.message_ar : error.message_en}</Notice>}
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <RecordFields fields={fields} values={values} errors={errors} onChange={(n, v) => setValues((s) => ({ ...s, [n]: v }))} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
