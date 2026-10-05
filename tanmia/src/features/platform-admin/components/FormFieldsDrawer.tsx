// Compact, JSON-free field editor for central form templates.
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import type { QuestionOption } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { Badge, Button, Card, CardBody, Checkbox, Drawer, EmptyState, Field, Input, Notice, Select } from '@/components/ui';
import { useAction } from '@/hooks/useAction';
import * as db from '@/services/db';
import type { FormField, FormFieldType, FormTemplate } from '@/types/db';
import { OptionsEditor, optionsProblems } from './OptionsEditor';
import { KEY_PATTERN, duplicates, toKey } from './common';

const CHOICE: FormFieldType[] = ['single_choice', 'multiple_choice'];
const RANGE: FormFieldType[] = ['number', 'scale', 'rating'];
type ShowOp = NonNullable<FormField['show_if']>['op'];

export function validateFields(fields: FormField[]): { ar: string; en: string }[] {
  const out: { ar: string; en: string }[] = [];
  const dup = duplicates(fields.map((f) => f.key));
  if (dup.length) out.push({ ar: `مفاتيح مكررة: ${dup.join('، ')}`, en: `Duplicate keys: ${dup.join(', ')}` });
  fields.forEach((f, i) => {
    const n = i + 1;
    if (!KEY_PATTERN.test(f.key)) out.push({ ar: `الحقل ${n}: مفتاح غير صالح (أحرف إنجليزية صغيرة وأرقام و _)`, en: `Field ${n}: invalid key (lowercase letters, digits, _)` });
    if (!f.label_ar.trim()) out.push({ ar: `الحقل ${n}: العنوان العربي إلزامي`, en: `Field ${n}: Arabic label is required` });
    if (CHOICE.includes(f.type)) { const p = optionsProblems(f.options ?? []); if (p) out.push({ ar: `الحقل ${n}: ${p[0]}`, en: `Field ${n}: ${p[1]}` }); }
    if (f.type === 'matrix' && !(f.rows ?? []).length) out.push({ ar: `الحقل ${n}: المصفوفة تحتاج صفوفًا`, en: `Field ${n}: matrix needs rows` });
    if (f.type === 'matrix' && !(f.options ?? []).length) out.push({ ar: `الحقل ${n}: المصفوفة تحتاج أعمدة (خيارات)`, en: `Field ${n}: matrix needs columns (options)` });
    if (RANGE.includes(f.type) && f.min !== undefined && f.max !== undefined && f.max <= f.min) out.push({ ar: `الحقل ${n}: الحد الأقصى يجب أن يتجاوز الأدنى`, en: `Field ${n}: max must exceed min` });
    if (f.show_if) {
      const j = fields.findIndex((x) => x.key === f.show_if!.field);
      if (j < 0 || j >= i) out.push({ ar: `الحقل ${n}: شرط الظهور يجب أن يشير إلى حقل سابق`, en: `Field ${n}: visibility condition must reference an earlier field` });
    }
  });
  return out;
}

export function FormFieldsDrawer({ template, onClose, onSaved }: { template: FormTemplate | null; onClose: () => void; onSaved: () => void }) {
  const { tr, enumOptions, L } = useI18n();
  const [fields, setFields] = useState<FormField[]>([]);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setFields(structuredClone(template?.schema?.fields ?? [])); setDirty(false); }, [template]);
  const problems = validateFields(fields);
  const save = useAction(async () => {
    if (!template) return;
    await db.update<FormTemplate>('form_templates', template.id, { schema: { fields } });
    setDirty(false); onSaved();
  }, { success: ['تم حفظ الحقول', 'Fields saved'] });
  if (!template) return null;

  const set = (i: number, patch: Partial<FormField>) => { setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f))); setDirty(true); };
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= fields.length) return; const n = [...fields]; [n[i], n[j]] = [n[j], n[i]]; setFields(n); setDirty(true); };
  const add = () => { setFields([...fields, { key: `field_${fields.length + 1}`, type: 'text', label_ar: '', label_en: '', required: false }]); setDirty(true); };

  return (
    <Drawer wide open onClose={onClose} title={<>{tr('حقول النموذج', 'Form fields')} · {template.title}</>}
      footer={<>
        <span className="small muted grow">{dirty ? tr('تغييرات غير محفوظة', 'Unsaved changes') : tr('لا تغييرات', 'No changes')}</span>
        <Button onClick={onClose}>{tr('إغلاق', 'Close')}</Button>
        <Button variant="primary" icon={<Save />} loading={save.busy} disabled={!dirty || problems.length > 0} onClick={() => void save.run()}>{tr('حفظ الحقول', 'Save fields')}</Button>
      </>}>
      <div className="stack">
        {template.status === 'published' && <Notice tone="info">{tr('النموذج منشور: النسخ التي أخذتها المؤسسات سابقًا لن تتغير؛ التعديل يظهر في النسخ الجديدة فقط.', 'This form is published: copies organizations already took will not change; edits apply to new copies only.')}</Notice>}
        {problems.length > 0 && <Notice tone="danger"><ul style={{ margin: 0, paddingInlineStart: 16 }}>{problems.slice(0, 8).map((p, i) => <li key={i}>{L(p)}</li>)}</ul></Notice>}
        {!fields.length && <EmptyState compact title={tr('لا توجد حقول بعد', 'No fields yet')} />}
        {fields.map((f, i) => (
          <Card key={i}>
            <CardBody>
              <div className="row between" style={{ marginBottom: 8 }}>
                <div className="row"><Badge tone="outline">{i + 1}</Badge><b className="small">{f.label_ar || f.label_en || f.key}</b></div>
                <div className="row">
                  <Button size="sm" variant="ghost" iconOnly icon={<ArrowUp />} disabled={i === 0} onClick={() => move(i, -1)} aria-label={tr('أعلى', 'Up')} />
                  <Button size="sm" variant="ghost" iconOnly icon={<ArrowDown />} disabled={i === fields.length - 1} onClick={() => move(i, 1)} aria-label={tr('أسفل', 'Down')} />
                  <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} onClick={() => { setFields(fields.filter((_, j) => j !== i)); setDirty(true); }} aria-label={tr('حذف', 'Remove')} />
                </div>
              </div>
              <div className="grid g4" style={{ gap: 10 }}>
                <Field label={tr('المفتاح', 'Key')}><Input dir="ltr" className="mono" value={f.key} onChange={(e) => set(i, { key: e.target.value })} onBlur={(e) => set(i, { key: toKey(e.target.value) || f.key })} /></Field>
                <Field label={tr('النوع', 'Type')}><Select value={f.type} options={enumOptions('fieldType')} onChange={(e) => {
                  const type = e.target.value as FormFieldType;
                  set(i, { type, options: CHOICE.includes(type) || type === 'matrix' ? (f.options ?? []) : undefined, rows: type === 'matrix' ? (f.rows ?? []) : undefined });
                }} /></Field>
                <Field label={tr('العنوان (عربي)', 'Label (Arabic)')} required><Input value={f.label_ar} onChange={(e) => set(i, { label_ar: e.target.value })} /></Field>
                <Field label={tr('العنوان (إنجليزي)', 'Label (English)')}><Input dir="ltr" value={f.label_en ?? ''} onChange={(e) => set(i, { label_en: e.target.value })} /></Field>
                <Field label={tr('مساعدة (عربي)', 'Help (Arabic)')}><Input value={f.help_ar ?? ''} onChange={(e) => set(i, { help_ar: e.target.value || undefined })} /></Field>
                <Field label={tr('مساعدة (إنجليزي)', 'Help (English)')}><Input dir="ltr" value={f.help_en ?? ''} onChange={(e) => set(i, { help_en: e.target.value || undefined })} /></Field>
                {RANGE.includes(f.type) && <>
                  <Field label={tr('الحد الأدنى', 'Min')}><Input type="number" dir="ltr" value={f.min ?? ''} onChange={(e) => set(i, { min: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
                  <Field label={tr('الحد الأقصى', 'Max')}><Input type="number" dir="ltr" value={f.max ?? ''} onChange={(e) => set(i, { max: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
                </>}
                <div className="stack-sm" style={{ alignContent: 'end' }}>
                  <Checkbox label={tr('إلزامي', 'Required')} checked={!!f.required} onChange={(c) => set(i, { required: c })} />
                  {template.scoring_enabled && <Field label={tr('وزن الاحتساب', 'Scoring weight')}><Input type="number" min={0} dir="ltr" value={f.scoring?.weight ?? ''} onChange={(e) => set(i, { scoring: e.target.value === '' ? null : { weight: Number(e.target.value) } })} /></Field>}
                </div>
              </div>
              {(CHOICE.includes(f.type) || f.type === 'matrix') && (
                <div style={{ marginTop: 10 }}>
                  <span className="small strong">{f.type === 'matrix' ? tr('أعمدة المصفوفة', 'Matrix columns') : tr('الخيارات', 'Options')}</span>
                  <OptionsEditor value={f.options ?? []} withScore={template.scoring_enabled} onChange={(o: QuestionOption[]) => set(i, { options: o })} />
                </div>
              )}
              {f.type === 'matrix' && (
                <div style={{ marginTop: 10 }}>
                  <span className="small strong">{tr('صفوف المصفوفة', 'Matrix rows')}</span>
                  <OptionsEditor value={(f.rows ?? []).map((r) => ({ value: r.key, label_ar: r.label_ar, label_en: r.label_en }))} withScore={false}
                    onChange={(o) => set(i, { rows: o.map((r) => ({ key: r.value, label_ar: r.label_ar ?? '', label_en: r.label_en })) })} />
                </div>
              )}
              {i > 0 && (
                <div className="row wrap" style={{ marginTop: 10, gap: 8 }}>
                  <Checkbox label={tr('يظهر بشرط', 'Show conditionally')} checked={!!f.show_if} onChange={(c) => set(i, { show_if: c ? { field: fields[i - 1].key, op: 'filled' } : null })} />
                  {f.show_if && <>
                    <Select style={{ width: 180 }} value={f.show_if.field} onChange={(e) => set(i, { show_if: { ...f.show_if!, field: e.target.value } })}
                      options={fields.slice(0, i).map((x) => ({ value: x.key, label: x.label_ar || x.key }))} />
                    <Select style={{ width: 140 }} value={f.show_if.op} onChange={(e) => set(i, { show_if: { ...f.show_if!, op: e.target.value as ShowOp } })}
                      options={[{ value: 'filled', label: tr('مُعبأ', 'is filled') }, { value: 'eq', label: '=' }, { value: 'neq', label: '≠' }, { value: 'gt', label: '>' }, { value: 'lt', label: '<' }, { value: 'includes', label: tr('يتضمن', 'includes') }]} />
                    {f.show_if.op !== 'filled' && <Input style={{ width: 160 }} dir="ltr" value={String(f.show_if.value ?? '')} placeholder={tr('القيمة', 'Value')}
                      onChange={(e) => set(i, { show_if: { ...f.show_if!, value: ['gt', 'lt'].includes(f.show_if!.op) && e.target.value !== '' && !Number.isNaN(Number(e.target.value)) ? Number(e.target.value) : e.target.value } })} />}
                  </>}
                </div>
              )}
            </CardBody>
          </Card>
        ))}
        <div><Button icon={<Plus />} onClick={add}>{tr('إضافة حقل', 'Add field')}</Button></div>
      </div>
    </Drawer>
  );
}
