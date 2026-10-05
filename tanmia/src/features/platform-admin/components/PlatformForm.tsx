// Create/edit dialog for platform pages. The shared RecordFormModal renders
// RecordFields, which calls useOrg() and therefore cannot run under /platform
// (no OrgProvider). This mirrors it, reusing the shared validation and
// normalization, without the organization-scoped 'entity' field type.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { Button, Checkbox, Field, Input, Modal, MultiCheck, Notice, Select, TagInput, Textarea } from '@/components/ui';
import { type FieldSpec, normalizeRecord, validateRecord } from '@/components/forms/RecordForm';
import { type AppError, errorOf } from '@/services/errors';
import { toLocalInput } from '@/utils/dates';

export type PlatformFieldSpec = Omit<FieldSpec, 'type'> & { type: Exclude<FieldSpec['type'], 'entity'> };

export function PlatformFields({ fields, values, onChange, errors }: {
  fields: PlatformFieldSpec[]; values: Record<string, unknown>; onChange: (name: string, v: unknown) => void; errors: Record<string, [string, string]>;
}) {
  const { tr, enumOptions, locale } = useI18n();
  const pickL = (p: [string, string]) => (locale === 'ar' ? p[0] : p[1]);
  return (
    <div className="form-grid">
      {fields.filter((f) => !f.visible || f.visible(values)).map((f) => {
        const err = errors[f.name];
        const v = values[f.name];
        const id = `pfld-${f.name}`;
        let control: ReactNode;
        switch (f.type) {
          case 'textarea': control = <Textarea id={id} value={String(v ?? '')} onChange={(e) => onChange(f.name, e.target.value)} invalid={!!err} disabled={f.disabled} placeholder={f.placeholder} />; break;
          case 'select': control = <Select id={id} options={f.options ?? []} placeholder={f.required ? undefined : tr('— اختر —', '— Select —')} value={String(v ?? '')} onChange={(e) => onChange(f.name, e.target.value)} invalid={!!err} disabled={f.disabled} />; break;
          case 'enum': control = <Select id={id} options={enumOptions(f.enumGroup!)} placeholder={f.required ? undefined : tr('— اختر —', '— Select —')} value={String(v ?? '')} onChange={(e) => onChange(f.name, e.target.value)} invalid={!!err} disabled={f.disabled} />; break;
          case 'enum-multi': control = <MultiCheck options={f.options ?? enumOptions(f.enumGroup!)} value={(v as string[]) ?? []} onChange={(x) => onChange(f.name, x)} />; break;
          case 'tags': control = <TagInput value={(v as string[]) ?? []} onChange={(x) => onChange(f.name, x)} placeholder={f.placeholder} />; break;
          case 'checkbox': control = <Checkbox label={pickL(f.label)} checked={Boolean(v)} onChange={(x) => onChange(f.name, x)} disabled={f.disabled} />; break;
          case 'datetime': control = <Input id={id} type="datetime-local" value={typeof v === 'string' && v.length > 16 ? toLocalInput(v) : String(v ?? '')} onChange={(e) => onChange(f.name, e.target.value)} invalid={!!err} disabled={f.disabled} />; break;
          default:
            control = <Input id={id} type={f.type === 'number' ? 'number' : f.type} value={v === null || v === undefined ? '' : String(v)} min={f.min} max={f.max}
              step={f.step ?? (f.type === 'number' ? 'any' : undefined)} onChange={(e) => onChange(f.name, e.target.value)} invalid={!!err} disabled={f.disabled}
              placeholder={f.placeholder} dir={['email', 'tel', 'url', 'number'].includes(f.type) ? 'ltr' : undefined} />;
        }
        return (
          <Field key={f.name} htmlFor={id} className={f.full || f.type === 'textarea' || f.type === 'enum-multi' ? 'full' : undefined}
            label={f.type === 'checkbox' ? undefined : pickL(f.label)} required={f.required}
            hint={f.hint ? pickL(f.hint) : undefined} error={err ? pickL(err) : undefined}>
            {control}
          </Field>
        );
      })}
    </div>
  );
}

export function PlatformFormModal({ open, title, fields, initial, onClose, onSubmit, submitLabel, size, intro }: {
  open: boolean; title: string; fields: PlatformFieldSpec[]; initial?: Record<string, unknown>; onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => Promise<unknown>; submitLabel?: string; size?: 'narrow' | 'wide'; intro?: ReactNode;
}) {
  const { tr, locale } = useI18n();
  const [values, setValues] = useState<Record<string, unknown>>(initial ?? {});
  const [errors, setErrors] = useState<Record<string, [string, string]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const initKey = useMemo(() => JSON.stringify(initial ?? {}), [initial]);
  useEffect(() => {
    if (open) { setValues(initial ?? {}); setErrors({}); setError(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initKey]);

  const submit = async () => {
    const specs = fields as FieldSpec[];
    const errs = validateRecord(specs, values);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    try {
      await onSubmit(normalizeRecord(specs, values)); onClose();
    } catch (e) { setError(errorOf(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} title={title} onClose={onClose} size={size}
      footer={<><Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} onClick={submit}>{submitLabel ?? tr('حفظ', 'Save')}</Button></>}>
      <div className="stack-sm">
        {intro}
        {error && <Notice tone="danger">{locale === 'ar' ? error.message_ar : error.message_en}</Notice>}
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <PlatformFields fields={fields} values={values} errors={errors} onChange={(n, v) => setValues((s) => ({ ...s, [n]: v }))} />
          <button type="submit" hidden />
        </form>
      </div>
    </Modal>
  );
}
