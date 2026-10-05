// /app/templates — organization forms, central library and the submissions
// inbox with the review workflow (submitted → reviewed → approved / rejected).
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { CheckCircle2, Copy, Download, Eye, FileText, Inbox, Library, Plus, XCircle } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAsync, type AsyncState } from '@/hooks/useAsync';
import { useAction } from '@/hooks/useAction';
import { all, get, insert, list, rpc, update, type Filter } from '@/services/db';
import { errorOf, type AppError } from '@/services/errors';
import { downloadCSV } from '@/utils/csv';
import {
  AsyncView, Badge, Button, Card, CardBody, CardHeader, DataTable, Drawer, Field, Notice, PageHeader, Select, StatusBadge, Tabs, Textarea, type Column,
} from '@/components/ui';
import { RecordFormModal, type FieldSpec } from '@/components/forms/RecordForm';
import type { FormSubmission, FormTemplate, Program } from '@/types/db';
import { FormRenderer } from '../components/FormRenderer';
import { answerToCell } from '../formUtils';

type ProgramLite = Pick<Program, 'id' | 'name' | 'name_en' | 'code'>;
const PAGE = 25;

export default function TemplatesPage() {
  const { tr } = useI18n();
  const { org } = useOrg();
  const [tab, setTab] = useState('forms');
  const programs = useAsync(() => all<ProgramLite>('programs', { select: 'id,name,name_en,code', filters: [['organization_id', 'eq', org.id]], order: { column: 'name', ascending: true } }, 3000), [org.id]);
  const forms = useAsync(() => all<FormTemplate>('form_templates', { filters: [['organization_id', 'eq', org.id]], order: [{ column: 'code', ascending: true }, { column: 'version', ascending: false }] }, 3000), [org.id]);
  return (
    <div className="stack">
      <PageHeader title={tr('القوالب والنماذج', 'Templates & forms')} subtitle={tr('نماذج التقديم والتسجيل والاستبيانات ونماذج المراحل، مع صندوق مراجعة الردود', 'Application, registration, survey and stage forms, with a review inbox for submissions')} />
      <Tabs value={tab} onChange={setTab} items={[
        { key: 'forms', label: tr('نماذج المؤسسة', 'Organization forms'), icon: <FileText size={15} /> },
        { key: 'library', label: tr('المكتبة المركزية', 'Central library'), icon: <Library size={15} /> },
        { key: 'inbox', label: tr('صندوق الردود', 'Submissions inbox'), icon: <Inbox size={15} /> },
      ]} />
      {tab === 'forms' && <FormsTab forms={forms} programs={programs.data ?? []} />}
      {tab === 'library' && <LibraryTab orgForms={forms.data ?? []} />}
      {tab === 'inbox' && <InboxTab forms={forms.data ?? []} programs={programs.data ?? []} />}
    </div>
  );
}

function FormsTab({ forms, programs }: { forms: AsyncState<FormTemplate[]>; programs: ProgramLite[] }) {
  const { tr, pick, enumLabel, fmtDate } = useI18n();
  const { org, can } = useOrg();
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState('');
  const rows = (forms.data ?? []).filter((f) => !status || f.status === status);
  const progName = (id: string | null) => { const p = programs.find((x) => x.id === id); return p ? pick(p.name, p.name_en) : ''; };
  const fields: FieldSpec[] = [
    { name: 'title', label: ['عنوان النموذج', 'Form title'], type: 'text', required: true },
    { name: 'title_en', label: ['العنوان بالإنجليزية', 'English title'], type: 'text' },
    { name: 'form_type', label: ['نوع النموذج', 'Form type'], type: 'enum', enumGroup: 'formType', required: true },
    { name: 'program_id', label: ['البرنامج (اختياري)', 'Program (optional)'], type: 'select', options: programs.map((p) => ({ value: p.id, label: `${pick(p.name, p.name_en)} · ${p.code}` })),
      hint: ['اتركه فارغًا ليكون النموذج عامًا قابلًا لإعادة الاستخدام', 'Leave empty for a reusable organization-wide form'] },
    { name: 'stage_key', label: ['مفتاح المرحلة', 'Stage key'], type: 'text', placeholder: 'e.g. screening', hint: ['لربط النموذج بمرحلة في رحلة المسار', 'Links the form to a journey stage'] },
    { name: 'track_codes', label: ['المسارات', 'Tracks'], type: 'enum-multi', enumGroup: 'track' },
    { name: 'scoring_enabled', label: ['تفعيل احتساب الدرجة', 'Enable scoring'], type: 'checkbox' },
    { name: 'requires_review', label: ['يتطلب مراجعة واعتمادًا', 'Requires review & approval'], type: 'checkbox' },
    { name: 'description', label: ['الوصف', 'Description'], type: 'textarea' },
  ];
  const cols: Column<FormTemplate>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), value: (f) => f.code, render: (f) => <span className="mono">{f.code}</span>, sortable: true },
    { key: 'title', header: tr('العنوان', 'Title'), value: (f) => pick(f.title, f.title_en), render: (f) => <b>{pick(f.title, f.title_en)}</b>, sortable: true },
    { key: 'type', header: tr('النوع', 'Type'), value: (f) => enumLabel('formType', f.form_type) },
    { key: 'version', header: tr('الإصدار', 'Version'), value: (f) => f.version, render: (f) => `v${f.version}` },
    { key: 'fields', header: tr('الحقول', 'Fields'), align: 'end', value: (f) => f.schema?.fields?.length ?? 0 },
    { key: 'program', header: tr('البرنامج', 'Program'), value: (f) => progName(f.program_id) || tr('عام', 'General') },
    { key: 'flags', header: tr('الخصائص', 'Flags'), value: (f) => [f.scoring_enabled ? 'scored' : '', f.requires_review ? 'review' : ''].filter(Boolean).join(' '),
      render: (f) => <div className="row" style={{ gap: 4 }}>{f.scoring_enabled && <Badge tone="info">{tr('محتسب', 'Scored')}</Badge>}{f.requires_review && <Badge tone="warning">{tr('مراجعة', 'Review')}</Badge>}</div> },
    { key: 'status', header: tr('الحالة', 'Status'), value: (f) => enumLabel('toolStatus', f.status), render: (f) => <StatusBadge group="toolStatus" value={f.status} /> },
    { key: 'updated', header: tr('آخر تحديث', 'Updated'), value: (f) => f.updated_at, render: (f) => fmtDate(f.updated_at) },
  ];
  return (
    <Card>
      <CardHeader title={tr('نماذج المؤسسة', 'Organization forms')} hint={tr('النماذج المنشورة التي لها ردود غير قابلة للتعديل؛ أنشئ إصدارًا جديدًا', 'Published forms with submissions are immutable; create a new version')}
        actions={can('templates.create') && <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>{tr('نموذج جديد', 'New form')}</Button>} />
      <CardBody flush>
        <DataTable columns={cols} rows={rows} rowKey={(f) => f.id} loading={forms.loading} error={forms.error} onRetry={forms.reload} searchable exportName="form-templates"
          onRowClick={(f) => nav(`/app/templates/${f.id}`)}
          toolbar={<Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder={tr('كل الحالات', 'All statuses')}
            options={[{ value: 'draft', label: tr('مسودة', 'Draft') }, { value: 'published', label: tr('منشور', 'Published') }, { value: 'archived', label: tr('مؤرشف', 'Archived') }]} />}
          empty={{ title: tr('لا توجد نماذج', 'No forms'), description: tr('انسخ نموذجًا من المكتبة المركزية أو أنشئ نموذجًا جديدًا.', 'Copy a form from the central library or create a new one.') }} />
      </CardBody>
      <RecordFormModal open={creating} onClose={() => setCreating(false)} title={tr('نموذج جديد', 'New form')} size="wide" fields={fields}
        initial={{ form_type: 'form', scoring_enabled: false, requires_review: false, track_codes: [] }}
        onSubmit={async (v) => {
          const row = await insert<FormTemplate>('form_templates', { ...v, organization_id: org.id, schema: { fields: [] }, status: 'draft' });
          nav(`/app/templates/${row.id}`);
        }} />
    </Card>
  );
}

function LibraryTab({ orgForms }: { orgForms: FormTemplate[] }) {
  const { tr, pick, enumLabel } = useI18n();
  const { org, can } = useOrg();
  const nav = useNavigate();
  const central = useAsync(() => all<FormTemplate>('form_templates', { filters: [['organization_id', 'is', null], ['status', 'eq', 'published']], order: { column: 'code', ascending: true } }), []);
  const codes = useMemo(() => new Set(orgForms.map((f) => f.code)), [orgForms]);
  const copy = useAction(async (f: FormTemplate) => rpc<string>('copy_central_template', { p_kind: 'form_template', p_id: f.id, p_org: org.id }), {
    success: ['تم نسخ النموذج إلى المؤسسة', 'Form copied into the organization'], onDone: (id) => { if (id) nav(`/app/templates/${id}`); },
  });
  const cols: Column<FormTemplate>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), render: (f) => <span className="mono">{f.code}</span> },
    { key: 'title', header: tr('العنوان', 'Title'), value: (f) => pick(f.title, f.title_en) },
    { key: 'type', header: tr('النوع', 'Type'), value: (f) => enumLabel('formType', f.form_type) },
    { key: 'fields', header: tr('الحقول', 'Fields'), align: 'end', value: (f) => f.schema?.fields?.length ?? 0 },
    { key: 'act', header: '', hideInExport: true, render: (f) => (
      <div className="row" style={{ gap: 6 }}>
        {codes.has(f.code) && <Badge tone="success">{tr('مستخدم', 'In use')}</Badge>}
        <Button size="sm" variant="ghost" icon={<Eye />} onClick={() => nav(`/app/templates/${f.id}`)}>{tr('معاينة', 'Preview')}</Button>
        {can('templates.create') && <Button size="sm" icon={<Copy />} loading={copy.busy} onClick={() => void copy.run(f)}>{codes.has(f.code) ? tr('نسخ إصدار جديد', 'Copy new version') : tr('استخدام في المؤسسة', 'Use in organization')}</Button>}
      </div>
    ) },
  ];
  return (
    <Card>
      <CardHeader title={tr('المكتبة المركزية للنماذج', 'Central forms library')} hint={tr('النسخ ينشئ نموذجًا منشورًا مستقلًا في مؤسستك', 'Copying creates an independent published form in your organization')} />
      <CardBody flush>
        <DataTable columns={cols} rows={central.data ?? []} rowKey={(f) => f.id} loading={central.loading} error={central.error} onRetry={central.reload} empty={{ title: tr('المكتبة فارغة', 'The library is empty') }} />
      </CardBody>
    </Card>
  );
}

function InboxTab({ forms, programs }: { forms: FormTemplate[]; programs: ProgramLite[] }) {
  const { tr, pick, enumLabel, enumOptions, fmtDateTime, fmtNumber } = useI18n();
  const { org } = useOrg();
  const [f, setF] = useState({ form: '', status: 'submitted', program: '' });
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<FormSubmission | null>(null);
  const [exporting, setExporting] = useState(false);
  const formMap = useMemo(() => Object.fromEntries(forms.map((x) => [x.id, x])), [forms]);
  const filters = (): Filter[] => [['organization_id', 'eq', org.id],
    ...(f.form ? [['template_id', 'eq', f.form] as Filter] : []), ...(f.status ? [['status', 'eq', f.status] as Filter] : []), ...(f.program ? [['program_id', 'eq', f.program] as Filter] : [])];
  const benNames = async (rows: FormSubmission[]) => {
    const ids = [...new Set(rows.map((r) => r.beneficiary_id).filter((x): x is string => !!x))];
    if (!ids.length) return {} as Record<string, string>;
    try { const bs = await all<{ id: string; full_name: string; code: string }>('beneficiaries', { select: 'id,full_name,code', filters: [['id', 'in', ids]] }); return Object.fromEntries(bs.map((b) => [b.id, `${b.full_name} · ${b.code}`])); }
    catch { return {} as Record<string, string>; }
  };
  const data = useAsync(async () => {
    const res = await list<FormSubmission>('form_submissions', { filters: filters(), order: { column: 'submitted_at' }, page, pageSize: PAGE, count: true });
    return { ...res, names: await benNames(res.rows) };
  }, [org.id, f.form, f.status, f.program, page]);
  const setFilter = (k: keyof typeof f, v: string) => { setF((s) => ({ ...s, [k]: v })); setPage(0); };
  const formTitle = (id: string) => { const t = formMap[id]; return t ? `${pick(t.title, t.title_en)} · v${t.version}` : '—'; };
  const progName = (id: string | null) => { const p = programs.find((x) => x.id === id); return p ? pick(p.name, p.name_en) : '—'; };

  const cols: Column<FormSubmission>[] = [
    { key: 'date', header: tr('تاريخ الإرسال', 'Submitted'), value: (r) => r.submitted_at, render: (r) => fmtDateTime(r.submitted_at) },
    { key: 'form', header: tr('النموذج', 'Form'), value: (r) => formTitle(r.template_id) },
    { key: 'ben', header: tr('المستفيد', 'Beneficiary'), value: (r) => (r.beneficiary_id ? data.data?.names[r.beneficiary_id] ?? '—' : '—') },
    { key: 'program', header: tr('البرنامج', 'Program'), value: (r) => progName(r.program_id) },
    { key: 'score', header: tr('الدرجة', 'Score'), align: 'end', value: (r) => (r.score === null ? null : Number(r.score)), render: (r) => <span className="mono">{r.score === null ? '—' : fmtNumber(Number(r.score), 2)}</span> },
    { key: 'status', header: tr('الحالة', 'Status'), value: (r) => enumLabel('submissionStatus', r.status), render: (r) => <StatusBadge group="submissionStatus" value={r.status} /> },
    { key: 'reviewed', header: tr('المراجعة', 'Reviewed'), value: (r) => r.reviewed_at ?? '', render: (r) => (r.reviewed_at ? fmtDateTime(r.reviewed_at) : '—') },
  ];

  const exportCsv = async () => {
    const tpl = formMap[f.form];
    if (!tpl) return;
    setExporting(true);
    try {
      const rows = await all<FormSubmission>('form_submissions', { filters: filters(), order: { column: 'submitted_at', ascending: true } });
      const names = await benNames(rows);
      const fields = tpl.schema?.fields ?? [];
      downloadCSV(`submissions-${tpl.code}-v${tpl.version}`,
        ['submission_id', 'submitted_at', 'beneficiary', 'program', 'status', 'score', 'review_note', ...fields.map((x) => `${x.key} | ${pick(x.label_ar, x.label_en)}`)],
        rows.map((r) => [r.id, r.submitted_at, r.beneficiary_id ? names[r.beneficiary_id] ?? r.beneficiary_id : '', progName(r.program_id), r.status, r.score === null ? null : Number(r.score), r.review_note,
          ...fields.map((x) => answerToCell(x, r.answers?.[x.key]))]));
    } finally { setExporting(false); }
  };

  return (
    <Card>
      <CardHeader title={tr('صندوق الردود', 'Submissions inbox')} hint={tr('مسار المراجعة: مُرسل ← تمت المراجعة ← معتمد / مرفوض', 'Review flow: submitted → reviewed → approved / rejected')}
        actions={<Button size="sm" icon={<Download />} loading={exporting} disabled={!f.form} title={!f.form ? tr('اختر نموذجًا لتصدير عمود لكل حقل', 'Choose a form to export one column per field') : undefined} onClick={exportCsv}>{tr('تصدير CSV (عمود لكل حقل)', 'Export CSV (column per field)')}</Button>} />
      <CardBody flush>
        <DataTable columns={cols} rows={data.data?.rows ?? []} rowKey={(r) => r.id} loading={data.loading} error={data.error} onRetry={data.reload} onRowClick={setOpen}
          server={{ page, pageSize: PAGE, total: data.data?.total ?? null, onPage: setPage }}
          toolbar={<>
            <Select value={f.form} onChange={(e) => setFilter('form', e.target.value)} placeholder={tr('كل النماذج', 'All forms')} options={forms.map((x) => ({ value: x.id, label: `${pick(x.title, x.title_en)} · v${x.version}` }))} />
            <Select value={f.status} onChange={(e) => setFilter('status', e.target.value)} placeholder={tr('كل الحالات', 'All statuses')} options={enumOptions('submissionStatus')} />
            <Select value={f.program} onChange={(e) => setFilter('program', e.target.value)} placeholder={tr('كل البرامج', 'All programs')} options={programs.map((p) => ({ value: p.id, label: pick(p.name, p.name_en) }))} />
          </>}
          empty={{ title: tr('لا توجد ردود مطابقة', 'No matching submissions') }} />
      </CardBody>
      {open && <SubmissionDrawer submission={open} template={formMap[open.template_id]} beneficiary={open.beneficiary_id ? data.data?.names[open.beneficiary_id] ?? null : null}
        programName={progName(open.program_id)} onClose={() => setOpen(null)} onChanged={(s) => { setOpen(s); void data.reload(); }} />}
    </Card>
  );
}

function SubmissionDrawer({ submission: s, template, beneficiary, programName, onClose, onChanged }: {
  submission: FormSubmission; template: FormTemplate | undefined; beneficiary: string | null; programName: string; onClose: () => void; onChanged: (s: FormSubmission) => void;
}) {
  const { tr, pick, fmtDateTime, fmtNumber, locale } = useI18n();
  const { can, org } = useOrg();
  const tpl = useAsync(async () => template ?? get<FormTemplate>('form_templates', s.template_id), [s.template_id]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<AppError | null>(null);
  const canReview = can('templates.approve');
  const act = async (status: 'reviewed' | 'approved' | 'rejected') => {
    if (status === 'rejected' && !note.trim()) { setErr({ code: 'x', message_ar: 'سبب الرفض إلزامي', message_en: 'A rejection reason is required' }); return; }
    setBusy(status); setErr(null);
    try { onChanged(await update<FormSubmission>('form_submissions', s.id, { status, review_note: note.trim() || s.review_note })); setNote(''); }
    catch (e) { setErr(errorOf(e)); } finally { setBusy(null); }
  };
  const actions: { status: 'reviewed' | 'approved' | 'rejected'; label: string; variant: 'primary' | 'danger' | 'secondary'; icon: ReactNode }[] =
    s.status === 'submitted' ? [{ status: 'reviewed', label: tr('تمت المراجعة', 'Mark reviewed'), variant: 'primary', icon: <CheckCircle2 /> }, { status: 'rejected', label: tr('رفض', 'Reject'), variant: 'danger', icon: <XCircle /> }]
      : s.status === 'reviewed' ? [{ status: 'approved', label: tr('اعتماد', 'Approve'), variant: 'primary', icon: <CheckCircle2 /> }, { status: 'rejected', label: tr('رفض', 'Reject'), variant: 'danger', icon: <XCircle /> }] : [];
  return (
    <Drawer open wide title={template ? pick(template.title, template.title_en) : tr('رد', 'Submission')} onClose={onClose}>
      <div className="stack">
        <dl className="kv">
          <dt>{tr('المستفيد', 'Beneficiary')}</dt><dd>{beneficiary ?? '—'}</dd>
          <dt>{tr('البرنامج', 'Program')}</dt><dd>{programName}</dd>
          <dt>{tr('أُرسل', 'Submitted')}</dt><dd>{fmtDateTime(s.submitted_at)}</dd>
          <dt>{tr('إصدار النموذج', 'Form version')}</dt><dd>v{s.template_version ?? '—'}</dd>
          <dt>{tr('الدرجة', 'Score')}</dt><dd className="mono">{s.score === null ? '—' : fmtNumber(Number(s.score), 2)}</dd>
          <dt>{tr('الحالة', 'Status')}</dt><dd><StatusBadge group="submissionStatus" value={s.status} /></dd>
          {s.signature && <><dt>{tr('التوقيع', 'Signature')}</dt><dd>{String((s.signature as Record<string, unknown>).name ?? '')} · {fmtDateTime(String((s.signature as Record<string, unknown>).acknowledged_at ?? '') || null)}</dd></>}
          {s.reviewed_at && <><dt>{tr('آخر مراجعة', 'Last review')}</dt><dd>{fmtDateTime(s.reviewed_at)}</dd></>}
          {s.review_note && <><dt>{tr('ملاحظة المراجعة', 'Review note')}</dt><dd className="small" style={{ whiteSpace: 'pre-wrap' }}>{s.review_note}</dd></>}
        </dl>
        {template && template.version !== s.template_version && <Notice tone="info">{tr('أُرسل هذا الرد على إصدار مختلف من النموذج.', 'This submission was made on a different form version.')}</Notice>}
        <Card><CardHeader title={tr('الإجابات', 'Answers')} /><CardBody>
          <AsyncView state={tpl}>{(t) => <FormRenderer fields={t.schema?.fields ?? []} answers={s.answers ?? {}} readOnly organizationId={org.id} />}</AsyncView>
        </CardBody></Card>
        {actions.length > 0 && (canReview ? (
          <Card><CardHeader title={tr('المراجعة', 'Review')} hint={tr('تتطلب templates.approve', 'Requires templates.approve')} /><CardBody>
            <Field label={tr('ملاحظة (إلزامية عند الرفض)', 'Note (required to reject)')}><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            {err && <Notice tone="danger">{locale === 'ar' ? err.message_ar : err.message_en}</Notice>}
            <div className="row" style={{ marginTop: 8 }}>{actions.map((a) => <Button key={a.status} variant={a.variant} icon={a.icon} loading={busy === a.status} onClick={() => act(a.status)}>{a.label}</Button>)}</div>
          </CardBody></Card>
        ) : <Notice tone="info">{tr('مراجعة الردود تتطلب صلاحية templates.approve.', 'Reviewing submissions requires templates.approve.')}</Notice>)}
      </div>
    </Drawer>
  );
}
