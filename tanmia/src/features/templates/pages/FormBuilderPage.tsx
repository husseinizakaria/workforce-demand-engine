// /app/templates/:templateId — visual form builder with live preview,
// conditional logic, scoring, validation, versioning and staff fill-in.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Archive, ArrowDown, ArrowUp, CopyPlus, GitBranch, Lock, PenLine, Plus, Save, Send, Settings2, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAsync } from '@/hooks/useAsync';
import { all, count, get, insert, update } from '@/services/db';
import { errorOf, type AppError } from '@/services/errors';
import {
  AsyncView, Badge, Button, Card, CardBody, CardHeader, Checkbox, EmptyState, Field, Input, Notice, PageHeader, Select, StatusBadge, useConfirm, useToast,
} from '@/components/ui';
import { RecordFormModal, type FieldSpec } from '@/components/forms/RecordForm';
import type { FormField, FormFieldType, FormTemplate } from '@/types/db';
import type { QuestionOption } from '@engine';
import { FormRenderer } from '../components/FormRenderer';
import { FillFormModal } from '../components/FillFormModal';
import { CHOICE_TYPES, FIELD_TYPES, KEY_RE, RANGE_TYPES, SCORABLE, keyFromLabel, newField, schemaIssues, uniqueKey, validateFormAnswers, type Msg } from '../formUtils';

interface Item { uid: string; f: FormField; autoKey: boolean }
const uid = () => Math.random().toString(36).slice(2, 10);
const toItems = (fields: FormField[]): Item[] => fields.map((f) => ({ uid: uid(), f, autoKey: false }));
const clean = (f: FormField): FormField => {
  const o: FormField = { ...f };
  if (!CHOICE_TYPES.has(o.type)) delete o.options;
  if (o.type !== 'matrix') delete o.rows;
  if (!RANGE_TYPES.has(o.type)) { delete o.min; delete o.max; }
  if (!o.show_if?.field) delete o.show_if;
  if (!o.scoring) delete o.scoring;
  for (const k of ['label_en', 'help_ar', 'help_en'] as const) if (!o[k]) delete o[k];
  return o;
};

export default function FormBuilderPage() {
  const { templateId = '' } = useParams();
  const data = useAsync(async () => {
    const t = await get<FormTemplate>('form_templates', templateId);
    const subs = await count('form_submissions', [['template_id', 'eq', templateId]]).catch(() => 0);
    return { t, subs };
  }, [templateId]);
  return <AsyncView state={data} rows={8}>{(d) => <Builder key={`${d.t.id}:${d.t.updated_at}`} template={d.t} submissions={d.subs} reload={data.reload} />}</AsyncView>;
}

function Builder({ template: t, submissions, reload }: { template: FormTemplate; submissions: number; reload: () => Promise<void> }) {
  const { tr, pick, enumLabel, locale } = useI18n();
  const { org, can } = useOrg();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<Item[]>(() => toItems(t.schema?.fields ?? []));
  const [sel, setSel] = useState<string | null>(items[0]?.uid ?? null);
  const [addType, setAddType] = useState<FormFieldType>('text');
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [previewErrors, setPreviewErrors] = useState<Record<string, Msg>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<AppError | null>(null);
  const [settings, setSettings] = useState(false);
  const [fill, setFill] = useState(false);

  const central = t.organization_id === null;
  const immutable = t.status === 'published' && submissions > 0;
  const locked = central || immutable || t.status === 'archived' || !can('templates.edit');
  const fields = useMemo(() => items.map((i) => i.f), [items]);
  const dirty = JSON.stringify(fields.map(clean)) !== JSON.stringify((t.schema?.fields ?? []).map(clean));
  const issues = useMemo(() => schemaIssues(fields, t.scoring_enabled), [fields, t.scoring_enabled]);
  const selIdx = items.findIndex((i) => i.uid === sel);
  const current = selIdx >= 0 ? items[selIdx] : null;

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const patch = (u: string, p: Partial<FormField>, opts: { keyEdited?: boolean } = {}) => setItems((list) => {
    const idx = list.findIndex((x) => x.uid === u);
    if (idx < 0) return list;
    const it = list[idx];
    const f = { ...it.f, ...p };
    const autoKey = opts.keyEdited ? false : it.autoKey;
    if (autoKey && ('label_en' in p || 'label_ar' in p)) f.key = keyFromLabel(f, idx, new Set(list.filter((x) => x.uid !== u).map((x) => x.f.key)));
    const oldKey = it.f.key; const newKey = f.key;
    // keep later visibility rules pointing at the renamed key
    return list.map((x) => (x.uid === u ? { ...it, f, autoKey }
      : oldKey !== newKey && x.f.show_if?.field === oldKey ? { ...x, f: { ...x.f, show_if: { ...x.f.show_if, field: newKey } } } : x));
  });
  const add = () => {
    const taken = new Set(fields.map((f) => f.key));
    const it: Item = { uid: uid(), f: newField(addType, items.length, taken), autoKey: true };
    const at = selIdx >= 0 ? selIdx + 1 : items.length;
    setItems((l) => [...l.slice(0, at), it, ...l.slice(at)]);
    setSel(it.uid);
  };
  const move = (u: string, dir: -1 | 1) => setItems((l) => {
    const i = l.findIndex((x) => x.uid === u); const j = i + dir;
    if (i < 0 || j < 0 || j >= l.length) return l;
    const n = [...l]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });
  const duplicate = (u: string) => setItems((l) => {
    const i = l.findIndex((x) => x.uid === u); if (i < 0) return l;
    const taken = new Set(l.map((x) => x.f.key));
    const copy: Item = { uid: uid(), f: { ...JSON.parse(JSON.stringify(l[i].f)) as FormField, key: uniqueKey(`${l[i].f.key}_copy`, taken) }, autoKey: false };
    setSel(copy.uid);
    return [...l.slice(0, i + 1), copy, ...l.slice(i + 1)];
  });
  const removeField = async (u: string) => {
    const it = items.find((x) => x.uid === u); if (!it) return;
    const deps = items.filter((x) => x.f.show_if?.field === it.f.key);
    if (!(await confirm({ title: tr('حذف الحقل', 'Delete field'), danger: true, message: deps.length ? tr(`${deps.length} حقل يعتمد عليه في شرط الإظهار وسيُزال شرطه.`, `${deps.length} field(s) depend on it for visibility; their rule will be removed.`) : it.f.key }))) return;
    setItems((l) => l.filter((x) => x.uid !== u).map((x) => (x.f.show_if?.field === it.f.key ? { ...x, f: { ...x.f, show_if: null } } : x)));
    setSel(null);
  };

  const save = async (): Promise<boolean> => {
    if (issues.errors.length) { toast.error(tr('عالج الأخطاء قبل الحفظ', 'Fix the errors before saving')); return false; }
    setBusy('save'); setErr(null);
    try { await update('form_templates', t.id, { schema: { fields: fields.map(clean) } }); toast.success(tr('تم حفظ النموذج', 'Form saved')); await reload(); return true; }
    catch (e) { setErr(errorOf(e)); return false; } finally { setBusy(null); }
  };
  const publish = async () => {
    if (issues.errors.length) return;
    if (!(await confirm({ title: tr('نشر النموذج', 'Publish form'), message: tr('سيصبح النموذج متاحًا للتعبئة. بعد أول رد يصبح غير قابل للتعديل ويلزم إصدار جديد.', 'The form becomes available to fill. After the first submission it becomes immutable and changes need a new version.') }))) return;
    setBusy('publish'); setErr(null);
    try { await update('form_templates', t.id, { schema: { fields: fields.map(clean) }, status: 'published' }); await reload(); }
    catch (e) { setErr(errorOf(e)); } finally { setBusy(null); }
  };
  const setStatus = async (status: FormTemplate['status']) => {
    if (status === 'archived' && !(await confirm({ title: tr('أرشفة النموذج', 'Archive form'), danger: true, message: tr('لن يكون متاحًا لردود جديدة؛ تبقى الردود السابقة.', 'It will not accept new submissions; existing ones are kept.') }))) return;
    setBusy(status); setErr(null);
    try { await update('form_templates', t.id, { status }); await reload(); } catch (e) { setErr(errorOf(e)); } finally { setBusy(null); }
  };
  const newVersion = async () => {
    setBusy('version'); setErr(null);
    try {
      const versions = await all<{ version: number }>('form_templates', { select: 'version', filters: [['organization_id', 'eq', org.id], ['code', 'eq', t.code]], order: { column: 'version' } });
      const next = Math.max(t.version, ...versions.map((v) => v.version)) + 1;
      const row = await insert<FormTemplate>('form_templates', {
        organization_id: org.id, code: t.code, title: t.title, title_en: t.title_en, description: t.description, form_type: t.form_type, track_codes: t.track_codes,
        stage_key: t.stage_key, program_id: t.program_id, schema: { fields: fields.map(clean) }, scoring_enabled: t.scoring_enabled, requires_review: t.requires_review,
        version: next, parent_template_id: t.id, status: 'draft',
      });
      toast.success(tr(`أنشئ الإصدار v${next} كمسودة`, `Version v${next} created as draft`));
      nav(`/app/templates/${row.id}`);
    } catch (e) { setErr(errorOf(e)); } finally { setBusy(null); }
  };

  const settingsFields: FieldSpec[] = [
    { name: 'title', label: ['عنوان النموذج', 'Form title'], type: 'text', required: true },
    { name: 'title_en', label: ['العنوان بالإنجليزية', 'English title'], type: 'text' },
    { name: 'form_type', label: ['نوع النموذج', 'Form type'], type: 'enum', enumGroup: 'formType', required: true },
    { name: 'program_id', label: ['البرنامج', 'Program'], type: 'entity', entity: 'programs' },
    { name: 'stage_key', label: ['مفتاح المرحلة', 'Stage key'], type: 'text' },
    { name: 'track_codes', label: ['المسارات', 'Tracks'], type: 'enum-multi', enumGroup: 'track' },
    { name: 'scoring_enabled', label: ['تفعيل احتساب الدرجة', 'Enable scoring'], type: 'checkbox', disabled: immutable },
    { name: 'requires_review', label: ['يتطلب مراجعة واعتمادًا', 'Requires review & approval'], type: 'checkbox' },
    { name: 'description', label: ['الوصف', 'Description'], type: 'textarea' },
  ];

  const earlier = selIdx > 0 ? items.slice(0, selIdx).map((x) => x.f) : [];
  const fieldErrors = (key: string) => issues.errors.filter((e) => e.key === key);

  return (
    <div className="stack">
      <PageHeader title={pick(t.title, t.title_en)} subtitle={t.description ?? undefined}
        crumbs={[{ label: tr('القوالب والنماذج', 'Templates & forms'), to: '/app/templates' }, { label: t.code }]}
        badge={<><Badge tone="outline">v{t.version}</Badge><StatusBadge group="toolStatus" value={t.status} /><Badge tone="outline">{enumLabel('formType', t.form_type)}</Badge>{central && <Badge tone="info">{tr('مكتبة مركزية', 'Central library')}</Badge>}</>}
        actions={<>
          {!central && can('templates.edit') && <Button icon={<Settings2 />} onClick={() => setSettings(true)}>{tr('الإعدادات', 'Settings')}</Button>}
          {!locked && <Button icon={<Save />} loading={busy === 'save'} disabled={!dirty} onClick={() => void save()}>{tr('حفظ', 'Save')}</Button>}
          {!locked && t.status === 'draft' && <Button variant="primary" icon={<Send />} loading={busy === 'publish'} disabled={issues.errors.length > 0} onClick={publish}>{tr('نشر', 'Publish')}</Button>}
          {!central && t.status === 'published' && can('templates.create') && <Button icon={<PenLine />} onClick={() => setFill(true)}>{tr('تعبئة نيابة عن مستفيد', 'Fill on behalf of beneficiary')}</Button>}
          {!central && can('templates.create') && t.status !== 'draft' && <Button icon={<GitBranch />} loading={busy === 'version'} onClick={newVersion}>{tr('إصدار جديد', 'New version')}</Button>}
          {!central && can('templates.edit') && t.status !== 'archived' && <Button variant="danger" icon={<Archive />} loading={busy === 'archived'} onClick={() => void setStatus('archived')}>{tr('أرشفة', 'Archive')}</Button>}
          {!central && can('templates.edit') && t.status === 'archived' && <Button onClick={() => void setStatus('draft')}>{tr('استعادة كمسودة', 'Restore as draft')}</Button>}
        </>} />

      {central && <Notice tone="info">{tr('نموذج من المكتبة المركزية (عرض فقط). انسخه إلى مؤسستك من تبويب المكتبة لتعديله.', 'Central library form (read-only). Copy it to your organization from the Library tab to edit it.')}</Notice>}
      {immutable && <Notice tone="warning" icon={<Lock />}>{tr(`النموذج منشور ولديه ${submissions} رد، لذلك لا يمكن تعديله حفاظًا على اتساق الإجابات المسجلة. أنشئ «إصدارًا جديدًا» (نسخة مسودة برقم إصدار تالٍ ومرتبطة بهذا الإصدار).`, `This form is published and has ${submissions} submission(s), so it is immutable to keep recorded answers consistent. Create a “New version” (a draft copy with the next version number linked to this one).`)}</Notice>}
      {!immutable && t.status === 'published' && !locked && <Notice tone="info">{tr('النموذج منشور دون ردود بعد؛ التعديلات تظهر مباشرة للمستخدمين بعد الحفظ.', 'The form is published without submissions yet; edits go live once saved.')}</Notice>}
      {err && <Notice tone="danger">{locale === 'ar' ? err.message_ar : err.message_en}</Notice>}

      <div className="grid g2">
        <div className="stack">
          <Card>
            <CardHeader title={tr('الحقول', 'Fields')} hint={`${items.length}`}
              actions={!locked && <div className="row">
                <Select value={addType} onChange={(e) => setAddType(e.target.value as FormFieldType)} options={FIELD_TYPES.map((x) => ({ value: x, label: enumLabel('fieldType', x) }))} aria-label={tr('نوع الحقل', 'Field type')} />
                <Button size="sm" variant="primary" icon={<Plus />} onClick={add}>{tr('إضافة', 'Add')}</Button>
              </div>} />
            <CardBody flush>
              {!items.length ? <EmptyState compact title={tr('لا توجد حقول بعد', 'No fields yet')} description={locked ? undefined : tr('اختر نوع الحقل ثم «إضافة».', 'Pick a field type, then “Add”.')} /> : (
                <ul className="list-plain" style={{ padding: '0 12px' }}>
                  {items.map((it, i) => {
                    const errs = fieldErrors(it.f.key);
                    return (
                      <li key={it.uid} className="row between" style={{ background: it.uid === sel ? 'var(--primary-tint)' : undefined, cursor: 'pointer', paddingInline: 6 }} onClick={() => setSel(it.uid)}>
                        <div className="stack-sm" style={{ gap: 2, minWidth: 0 }}>
                          <span className="small strong ellipsis">{i + 1}. {pick(it.f.label_ar, it.f.label_en) || <span className="muted">{tr('بلا تسمية', 'Untitled')}</span>}{it.f.required && <span style={{ color: 'var(--danger)' }}> *</span>}</span>
                          <div className="row wrap" style={{ gap: 4 }}>
                            <Badge tone="outline">{enumLabel('fieldType', it.f.type)}</Badge><span className="mono tiny muted">{it.f.key}</span>
                            {it.f.show_if?.field && <Badge tone="info">{tr('شرطي', 'Conditional')}</Badge>}
                            {it.f.scoring && <Badge tone="primary">w={it.f.scoring.weight ?? 1}</Badge>}
                            {errs.length > 0 && <Badge tone="danger">{errs.length} {tr('خطأ', 'error')}</Badge>}
                          </div>
                        </div>
                        {!locked && <div className="row" style={{ gap: 0 }} onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" variant="ghost" iconOnly icon={<ArrowUp />} disabled={i === 0} aria-label={tr('لأعلى', 'Up')} onClick={() => move(it.uid, -1)} />
                          <Button size="sm" variant="ghost" iconOnly icon={<ArrowDown />} disabled={i === items.length - 1} aria-label={tr('لأسفل', 'Down')} onClick={() => move(it.uid, 1)} />
                          <Button size="sm" variant="ghost" iconOnly icon={<CopyPlus />} aria-label={tr('تكرار', 'Duplicate')} onClick={() => duplicate(it.uid)} />
                          <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')} onClick={() => void removeField(it.uid)} />
                        </div>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>

          {current && (
            <FieldEditor key={current.uid} item={current} earlier={earlier} locked={locked} scoring={t.scoring_enabled} errors={fieldErrors(current.f.key).map((e) => e.msg)}
              keysTaken={new Set(items.filter((x) => x.uid !== current.uid).map((x) => x.f.key))}
              onPatch={(p, o) => patch(current.uid, p, o)} />
          )}

          {(issues.errors.length > 0 || issues.warnings.length > 0) && (
            <Card>
              <CardHeader title={tr('فحص النموذج', 'Form check')} />
              <CardBody>
                {issues.errors.length > 0 && <Notice tone="danger"><ul style={{ margin: 0, paddingInlineStart: 16 }}>{issues.errors.map((e, i) => <li key={i}>{tr(e.msg[0], e.msg[1])}</li>)}</ul></Notice>}
                {issues.warnings.length > 0 && <div style={{ marginTop: 6 }}><Notice tone="warning"><ul style={{ margin: 0, paddingInlineStart: 16 }}>{issues.warnings.map((e, i) => <li key={i}>{tr(e.msg[0], e.msg[1])}</li>)}</ul></Notice></div>}
              </CardBody>
            </Card>
          )}
        </div>

        <div className="stack">
          <Card>
            <CardHeader title={tr('معاينة مباشرة', 'Live preview')} hint={tr('جرّب الإجابات لاختبار المنطق الشرطي والدرجة', 'Try answers to test conditional logic and scoring')}
              actions={<>
                <Button size="sm" onClick={() => setPreviewErrors(validateFormAnswers(fields, answers))}>{tr('اختبار التحقق', 'Test validation')}</Button>
                <Button size="sm" variant="ghost" onClick={() => { setAnswers({}); setPreviewErrors({}); }}>{tr('مسح', 'Reset')}</Button>
              </>} />
            <CardBody>
              {Object.keys(previewErrors).length === 0 && Object.keys(answers).length > 0 && <div style={{ marginBottom: 8 }}><span className="tiny muted">{tr('اضغط «اختبار التحقق» لفحص الحقول الإلزامية.', 'Press “Test validation” to check required fields.')}</span></div>}
              <FormRenderer fields={fields} answers={answers} onChange={setAnswers} errors={previewErrors} scoringEnabled={t.scoring_enabled}
                highlightKey={current?.f.key ?? null} onFieldClick={(k) => { const it = items.find((x) => x.f.key === k); if (it) setSel(it.uid); }} />
            </CardBody>
          </Card>
        </div>
      </div>

      <RecordFormModal open={settings} onClose={() => setSettings(false)} title={tr('إعدادات النموذج', 'Form settings')} size="wide" fields={settingsFields}
        intro={dirty ? <Notice tone="warning">{tr('لديك تعديلات حقول غير محفوظة ستُفقد عند حفظ الإعدادات. احفظ الحقول أولًا.', 'You have unsaved field edits that will be lost when saving settings. Save the fields first.')}</Notice> : undefined}
        initial={{ title: t.title, title_en: t.title_en, form_type: t.form_type, program_id: t.program_id, stage_key: t.stage_key, track_codes: t.track_codes, scoring_enabled: t.scoring_enabled, requires_review: t.requires_review, description: t.description }}
        onSubmit={async (v) => {
          const p = { ...v }; if (immutable) delete p.scoring_enabled;
          await update('form_templates', t.id, p); await reload();
        }} />
      {fill && <FillFormModal template={t} onClose={() => setFill(false)} onSubmitted={() => { void reload(); }} />}
    </div>
  );
}

function FieldEditor({ item, earlier, locked, scoring, errors, keysTaken, onPatch }: {
  item: Item; earlier: FormField[]; locked: boolean; scoring: boolean; errors: Msg[]; keysTaken: Set<string>;
  onPatch: (p: Partial<FormField>, o?: { keyEdited?: boolean }) => void;
}) {
  const { tr, enumLabel, pick } = useI18n();
  const f = item.f;
  const ref = f.show_if?.field ? earlier.find((x) => x.key === f.show_if!.field) : undefined;
  const opts = f.options ?? [];
  const setOpt = (i: number, p: Partial<QuestionOption>) => onPatch({ options: opts.map((o, j) => (j === i ? { ...o, ...p } : o)) });
  const rows = f.rows ?? [];
  const keyErr = !KEY_RE.test(f.key) ? tr('حروف إنجليزية صغيرة وأرقام و_ ويبدأ بحرف', 'Lowercase letters, digits and _, starting with a letter') : keysTaken.has(f.key) ? tr('المفتاح مستخدم', 'Key already used') : undefined;
  return (
    <Card>
      <CardHeader title={tr('خصائص الحقل', 'Field properties')} hint={enumLabel('fieldType', f.type)} />
      <CardBody>
        <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="stack">
            {errors.length > 0 && <Notice tone="danger"><ul style={{ margin: 0, paddingInlineStart: 16 }}>{errors.map((m, i) => <li key={i}>{tr(m[0], m[1])}</li>)}</ul></Notice>}
            <div className="form-grid">
              <Field label={tr('التسمية (ع)', 'Label (AR)')} required><Input value={f.label_ar} onChange={(e) => onPatch({ label_ar: e.target.value })} /></Field>
              <Field label={tr('التسمية (En)', 'Label (EN)')}><Input dir="ltr" value={f.label_en ?? ''} onChange={(e) => onPatch({ label_en: e.target.value })} /></Field>
              <Field label={tr('المفتاح', 'Key')} required error={keyErr} hint={item.autoKey ? tr('يُولّد تلقائيًا من التسمية الإنجليزية', 'Auto-generated from the English label') : tr('مفتاح ثابت لتخزين الإجابة وتصديرها', 'Stable key used to store and export the answer')}>
                <Input className="mono" dir="ltr" value={f.key} onChange={(e) => onPatch({ key: e.target.value.trim().toLowerCase() }, { keyEdited: true })} />
              </Field>
              <Field label={tr('النوع', 'Type')}>
                <Select value={f.type} onChange={(e) => {
                  const type = e.target.value as FormFieldType;
                  const p: Partial<FormField> = { type };
                  if ((type === 'single_choice' || type === 'multiple_choice' || type === 'matrix') && !opts.length) p.options = [{ value: 'a', label_ar: 'خيار 1', label_en: 'Option 1' }];
                  if (type === 'matrix' && !rows.length) p.rows = [{ key: 'r1', label_ar: 'بند 1', label_en: 'Item 1' }];
                  if (type === 'rating') { p.min = 1; p.max = 5; }
                  if (type === 'scale' && f.max === undefined) { p.min = 1; p.max = 10; }
                  onPatch(p);
                }} options={FIELD_TYPES.map((x) => ({ value: x, label: enumLabel('fieldType', x) }))} />
              </Field>
              <Field label={tr('نص مساعد (ع)', 'Help (AR)')}><Input value={f.help_ar ?? ''} onChange={(e) => onPatch({ help_ar: e.target.value })} /></Field>
              <Field label={tr('نص مساعد (En)', 'Help (EN)')}><Input dir="ltr" value={f.help_en ?? ''} onChange={(e) => onPatch({ help_en: e.target.value })} /></Field>
              {RANGE_TYPES.has(f.type) && <>
                <Field label={tr('الحد الأدنى', 'Minimum')}><Input type="number" className="ltr" value={f.min ?? ''} onChange={(e) => onPatch({ min: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
                <Field label={tr('الحد الأعلى', 'Maximum')} hint={f.type === 'rating' ? tr('حتى 10 نجوم', 'Up to 10 stars') : undefined}><Input type="number" className="ltr" value={f.max ?? ''} onChange={(e) => onPatch({ max: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
              </>}
              <div className="full"><Checkbox label={tr('إلزامي', 'Required')} checked={!!f.required} onChange={(v) => onPatch({ required: v })} /></div>
            </div>

            {f.type === 'matrix' && (
              <div className="stack-sm">
                <div className="row between"><b className="small">{tr('بنود المصفوفة (الصفوف)', 'Matrix items (rows)')}</b>
                  <Button size="sm" icon={<Plus />} onClick={() => onPatch({ rows: [...rows, { key: uniqueKey(`r${rows.length + 1}`, new Set(rows.map((r) => r.key))), label_ar: '', label_en: '' }] })}>{tr('بند', 'Row')}</Button></div>
                {rows.map((r, i) => (
                  <div key={i} className="row">
                    <Input className="mono" dir="ltr" style={{ width: 90 }} value={r.key} onChange={(e) => onPatch({ rows: rows.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })} aria-label="key" />
                    <Input value={r.label_ar} placeholder={tr('التسمية (ع)', 'Label (AR)')} onChange={(e) => onPatch({ rows: rows.map((x, j) => (j === i ? { ...x, label_ar: e.target.value } : x)) })} />
                    <Input dir="ltr" value={r.label_en ?? ''} placeholder="Label (EN)" onChange={(e) => onPatch({ rows: rows.map((x, j) => (j === i ? { ...x, label_en: e.target.value } : x)) })} />
                    <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')} onClick={() => onPatch({ rows: rows.filter((_, j) => j !== i) })} />
                  </div>
                ))}
              </div>
            )}

            {CHOICE_TYPES.has(f.type) && (
              <div className="stack-sm">
                <div className="row between"><b className="small">{f.type === 'matrix' ? tr('أعمدة المصفوفة (الخيارات)', 'Matrix columns (options)') : tr('الخيارات', 'Options')}</b>
                  <Button size="sm" icon={<Plus />} onClick={() => onPatch({ options: [...opts, { value: uniqueKey(`o${opts.length + 1}`, new Set(opts.map((o) => o.value))), label_ar: '', label_en: '' }] })}>{tr('خيار', 'Option')}</Button></div>
                {opts.map((o, i) => (
                  <div key={i} className="row">
                    <Input className="mono" dir="ltr" style={{ width: 90 }} value={o.value} onChange={(e) => setOpt(i, { value: e.target.value })} aria-label={tr('القيمة', 'Value')} />
                    <Input value={o.label_ar ?? ''} placeholder={tr('التسمية (ع)', 'Label (AR)')} onChange={(e) => setOpt(i, { label_ar: e.target.value })} />
                    <Input dir="ltr" value={o.label_en ?? ''} placeholder="Label (EN)" onChange={(e) => setOpt(i, { label_en: e.target.value })} />
                    {scoring && f.type !== 'matrix' && <Input type="number" step="any" className="ltr" style={{ width: 80 }} value={o.score ?? ''} placeholder={tr('درجة', 'Score')} onChange={(e) => setOpt(i, { score: e.target.value === '' ? null : Number(e.target.value) })} aria-label={tr('الدرجة', 'Score')} />}
                    <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')} onClick={() => onPatch({ options: opts.filter((_, j) => j !== i) })} />
                  </div>
                ))}
              </div>
            )}

            {scoring && SCORABLE.has(f.type) && (
              <div className="form-grid">
                {(f.type === 'rating' || f.type === 'scale' || f.type === 'number') && (
                  <div className="full"><Checkbox label={tr('تُحتسب قيمة الإجابة في الدرجة', 'Count the answer value in the score')} checked={!!f.scoring} onChange={(v) => onPatch({ scoring: v ? { weight: 1 } : null })} /></div>
                )}
                {(f.scoring || f.type === 'single_choice' || f.type === 'multiple_choice') && (
                  <Field label={tr('وزن الاحتساب', 'Scoring weight')} hint={tr('الدرجة = مجموع (درجة الإجابة × الوزن)', 'Score = Σ (answer score × weight)')}>
                    <Input type="number" step="any" min={0} className="ltr" value={f.scoring?.weight ?? 1} onChange={(e) => onPatch({ scoring: { weight: e.target.value === '' ? 1 : Number(e.target.value) } })} />
                  </Field>
                )}
              </div>
            )}

            <div className="stack-sm">
              <b className="small">{tr('منطق الإظهار الشرطي', 'Conditional visibility')}</b>
              {!earlier.length ? <span className="tiny muted">{tr('الحقل الأول لا يمكن أن يكون شرطيًا (يشير فقط لحقول سابقة).', 'The first field cannot be conditional (rules reference earlier fields only).')}</span> : (
                <div className="row wrap">
                  <Select value={f.show_if?.field ?? ''} placeholder={tr('— يظهر دائمًا —', '— Always shown —')}
                    onChange={(e) => onPatch({ show_if: e.target.value ? { field: e.target.value, op: f.show_if?.op ?? 'eq', value: '' } : null })}
                    options={earlier.map((x) => ({ value: x.key, label: `${pick(x.label_ar, x.label_en) || x.key} (${x.key})` }))} />
                  {f.show_if?.field && <>
                    <Select value={f.show_if.op} onChange={(e) => onPatch({ show_if: { ...f.show_if!, op: e.target.value as NonNullable<FormField['show_if']>['op'] } })}
                      options={[{ value: 'eq', label: tr('يساوي', 'equals') }, { value: 'neq', label: tr('لا يساوي', 'not equal') }, { value: 'gt', label: tr('أكبر من', 'greater than') }, { value: 'lt', label: tr('أصغر من', 'less than') }, { value: 'includes', label: tr('يتضمن', 'includes') }, { value: 'filled', label: tr('مُعبأ', 'is filled') }]} />
                    {f.show_if.op !== 'filled' && (ref?.options?.length && ref.type !== 'matrix'
                      ? <Select value={String(f.show_if.value ?? '')} placeholder={tr('— القيمة —', '— Value —')} onChange={(e) => onPatch({ show_if: { ...f.show_if!, value: e.target.value } })} options={ref.options.map((o) => ({ value: o.value, label: pick(o.label_ar, o.label_en) || o.value }))} />
                      : ref?.type === 'acknowledgment'
                        ? <Select value={String(f.show_if.value ?? '')} onChange={(e) => onPatch({ show_if: { ...f.show_if!, value: e.target.value } })} options={[{ value: 'true', label: tr('مُقر', 'acknowledged') }]} placeholder={tr('— القيمة —', '— Value —')} />
                        : <Input style={{ width: 140 }} value={String(f.show_if.value ?? '')} onChange={(e) => onPatch({ show_if: { ...f.show_if!, value: RANGE_TYPES.has(ref?.type ?? 'text') && e.target.value !== '' && Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : e.target.value } })} />)}
                  </>}
                </div>
              )}
              {f.show_if?.op === 'includes' && ref && ref.type !== 'multiple_choice' && <span className="tiny" style={{ color: 'var(--warning)' }}>{tr('«يتضمن» يعمل مع الاختيار المتعدد فقط', '“includes” only works with multiple choice')}</span>}
              {(f.show_if?.op === 'gt' || f.show_if?.op === 'lt') && ref && !RANGE_TYPES.has(ref.type) && <span className="tiny" style={{ color: 'var(--warning)' }}>{tr('المقارنة الرقمية تتطلب حقلًا رقميًا', 'Numeric comparison needs a numeric field')}</span>}
            </div>
            {f.type === 'file' && <span className="tiny muted">{tr('تُرفع الملفات إلى مخزن الأدلة الخاص بالمؤسسة ويُحفظ مسارها في الإجابة.', 'Files are uploaded to the organization evidence store and their path is saved in the answer.')}</span>}
            {f.type === 'signature' && <span className="tiny muted">{tr('التوقيع = الاسم الكامل المكتوب + إقرار مؤرخ.', 'Signature = typed full name + timestamped confirmation.')}</span>}
            {f.type === 'acknowledgment' && <span className="tiny muted">{tr('تظهر التسمية كنص الإقرار بجانب مربع الاختيار.', 'The label is shown as the acknowledgment text next to the checkbox.')}</span>}
          </div>
        </fieldset>
      </CardBody>
    </Card>
  );
}
