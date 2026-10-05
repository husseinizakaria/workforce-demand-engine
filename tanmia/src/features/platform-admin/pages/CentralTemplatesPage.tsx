import { useState } from 'react';
import { ClipboardList, FileText, ListTree, Pencil, Plus, Rows3 } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { Badge, Button, Card, CardBody, DataTable, Notice, PageHeader, Select, StatusBadge, Tabs, useConfirm } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { useAction } from '@/hooks/useAction';
import * as db from '@/services/db';
import type { AssessmentTool, FormTemplate } from '@/types/db';
import { PlatformFormModal, type PlatformFieldSpec } from '../components/PlatformForm';
import { ToolContentDrawer } from '../components/ToolContentDrawer';
import { FormFieldsDrawer } from '../components/FormFieldsDrawer';

type ToolRow = AssessmentTool & { assessment_dimensions: { count: number }[]; assessment_questions: { count: number }[] };
const cnt = (x: { count: number }[] | undefined) => x?.[0]?.count ?? 0;

export default function CentralTemplatesPage() {
  const { tr } = useI18n();
  const [tab, setTab] = useState('tools');
  return (
    <div className="stack">
      <PageHeader title={tr('القوالب المركزية', 'Central templates')} crumbs={[{ label: tr('إدارة المنصة', 'Platform'), to: '/platform' }, { label: tr('القوالب المركزية', 'Central templates') }]}
        subtitle={tr('أدوات تقييم ونماذج تتاح لكل المؤسسات. تنسخها المؤسسة إلى مساحتها (copy_central_template) ثم تعدّل نسختها باستقلالية.', 'Assessment tools and forms available to every organization. An organization copies one into its workspace (copy_central_template) and then edits its own copy independently.')} />
      <Tabs value={tab} onChange={setTab} items={[
        { key: 'tools', label: tr('أدوات التقييم', 'Assessment tools'), icon: <ClipboardList size={15} /> },
        { key: 'forms', label: tr('قوالب النماذج', 'Form templates'), icon: <FileText size={15} /> },
      ]} />
      {tab === 'tools' ? <ToolsTab /> : <FormsTab />}
    </div>
  );
}

function ToolsTab() {
  const { tr, pick, enumLabel } = useI18n();
  const state = useAsync(() => db.all<ToolRow>('assessment_tools', {
    select: '*,assessment_dimensions(count),assessment_questions(count)', filters: [['organization_id', 'is', null]], order: [{ column: 'code', ascending: true }, { column: 'version', ascending: false }],
  }), []);
  const [editing, setEditing] = useState<AssessmentTool | 'new' | null>(null);
  const [content, setContent] = useState<AssessmentTool | null>(null);
  const setStatus = useAction(async (t: AssessmentTool, status: AssessmentTool['status']) => { await db.update('assessment_tools', t.id, { status }); await state.reload(); }, { success: ['تم تحديث الحالة', 'Status updated'] });
  const confirm = useConfirm();

  const fields: PlatformFieldSpec[] = [
    { name: 'name', label: ['الاسم (عربي)', 'Name (Arabic)'], type: 'text', required: true },
    { name: 'name_en', label: ['الاسم (إنجليزي)', 'Name (English)'], type: 'text' },
    { name: 'tool_type', label: ['نوع الأداة', 'Tool type'], type: 'enum', enumGroup: 'toolType', required: true },
    { name: 'provider', label: ['المزوّد', 'Provider'], type: 'text', hint: ['مثل Hogan أو SHL للأدوات الخارجية', 'e.g. Hogan or SHL for external tools'], visible: (v) => v.tool_type === 'external' },
    { name: 'subject_type', label: ['موضوع التقييم', 'Subject'], type: 'enum', enumGroup: 'subjectType', required: true },
    { name: 'scoring_method', label: ['طريقة الاحتساب', 'Scoring method'], type: 'enum', enumGroup: 'scoringMethod', required: true },
    { name: 'scale_min', label: ['أدنى المقياس', 'Scale min'], type: 'number', required: true },
    { name: 'scale_max', label: ['أعلى المقياس', 'Scale max'], type: 'number', required: true,
      validate: (v, all) => (Number(v) > Number(all.scale_min) ? null : ['يجب أن يتجاوز الحد الأدنى', 'Must exceed the minimum']) },
    { name: 'pass_threshold', label: ['حد النجاح (0–100)', 'Pass threshold (0–100)'], type: 'number', min: 0, max: 100 },
    { name: 'status', label: ['الحالة', 'Status'], type: 'select', required: true, options: (['draft', 'active', 'archived'] as const).map((s) => ({ value: s, label: enumLabel('toolStatus', s) })) },
    { name: 'track_codes', label: ['المسارات المناسبة', 'Suitable tracks'], type: 'enum-multi', enumGroup: 'track' },
    { name: 'description', label: ['الوصف', 'Description'], type: 'textarea' },
  ];

  const rows = state.data ?? [];
  const activeEmpty = rows.filter((t) => t.status === 'active' && cnt(t.assessment_questions) === 0).length;

  return (
    <div className="stack-sm">
      {activeEmpty > 0 && <Notice tone="warning">{tr(`${activeEmpty} أدوات نشطة بلا أسئلة — ستنسخها المؤسسات فارغة.`, `${activeEmpty} active tools have no questions — organizations would copy them empty.`)}</Notice>}
      <Card>
        <CardBody flush>
          <DataTable<ToolRow> rows={rows} rowKey={(r) => r.id} loading={state.loading} error={state.error} onRetry={() => void state.reload()} searchable exportName="central-assessment-tools"
            toolbar={<Button size="sm" variant="primary" icon={<Plus />} onClick={() => setEditing('new')}>{tr('أداة جديدة', 'New tool')}</Button>}
            empty={{ title: tr('لا توجد أدوات تقييم مركزية', 'No central assessment tools'), description: tr('أنشئ أداة ثم أضف أبعادها وأسئلتها.', 'Create a tool, then add its dimensions and questions.') }}
            columns={[
              { key: 'code', header: tr('الرمز', 'Code'), render: (r) => <span className="mono">{r.code} <span className="muted">v{r.version}</span></span>, value: (r) => r.code, sortable: true },
              { key: 'name', header: tr('الاسم', 'Name'), value: (r) => pick(r.name, r.name_en), sortable: true },
              { key: 'type', header: tr('النوع', 'Type'), value: (r) => r.tool_type, render: (r) => <>{enumLabel('toolType', r.tool_type)}{r.provider && <span className="tiny muted"> · {r.provider}</span>}</> },
              { key: 'subject', header: tr('الموضوع', 'Subject'), value: (r) => r.subject_type, render: (r) => enumLabel('subjectType', r.subject_type) },
              { key: 'tracks', header: tr('المسارات', 'Tracks'), value: (r) => r.track_codes.join(' '), render: (r) => r.track_codes.length ? <div className="row wrap" style={{ gap: 3 }}>{r.track_codes.map((c) => <Badge key={c}>{enumLabel('track', c)}</Badge>)}</div> : <span className="muted small">{tr('الكل', 'All')}</span> },
              { key: 'scale', header: tr('المقياس', 'Scale'), value: (r) => `${r.scale_min}-${r.scale_max}`, render: (r) => <span className="mono">{r.scale_min}–{r.scale_max}</span> },
              { key: 'dims', header: tr('الأبعاد', 'Dims'), align: 'end', value: (r) => cnt(r.assessment_dimensions) },
              { key: 'qs', header: tr('الأسئلة', 'Questions'), align: 'end', value: (r) => cnt(r.assessment_questions), render: (r) => cnt(r.assessment_questions) || <Badge tone="warning">0</Badge> },
              { key: 'status', header: tr('الحالة', 'Status'), value: (r) => r.status, render: (r) => (
                <Select value={r.status} disabled={setStatus.busy} onClick={(e) => e.stopPropagation()} style={{ width: 110 }}
                  onChange={async (e) => {
                    const s = e.target.value as AssessmentTool['status'];
                    if (s === 'active' && cnt(r.assessment_questions) === 0 && !(await confirm({ title: tr('تفعيل أداة فارغة؟', 'Activate an empty tool?'), message: tr('الأداة لا تحتوي أسئلة بعد.', 'The tool has no questions yet.') }))) return;
                    await setStatus.run(r, s);
                  }}
                  options={(['draft', 'active', 'archived'] as const).map((s) => ({ value: s, label: enumLabel('toolStatus', s) }))} />
              ) },
              { key: 'actions', header: '', hideInExport: true, render: (r) => (
                <div className="row">
                  <Button size="sm" icon={<ListTree />} onClick={() => setContent(r)}>{tr('الأبعاد والأسئلة', 'Dims & questions')}</Button>
                  <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => setEditing(r)} />
                </div>
              ) },
            ]} />
        </CardBody>
      </Card>
      <PlatformFormModal open={!!editing} onClose={() => setEditing(null)} size="wide" fields={fields}
        title={editing === 'new' ? tr('أداة تقييم مركزية جديدة', 'New central assessment tool') : tr('تعديل الأداة', 'Edit tool')}
        initial={editing && editing !== 'new' ? { ...editing } : { tool_type: 'internal', subject_type: 'individual', scoring_method: 'weighted_average', scale_min: 1, scale_max: 5, status: 'draft', track_codes: [] }}
        onSubmit={async (v) => {
          const row = { name: v.name, name_en: v.name_en, description: v.description, tool_type: v.tool_type, provider: v.tool_type === 'external' ? v.provider ?? null : null,
            subject_type: v.subject_type, track_codes: v.track_codes, scoring_method: v.scoring_method, scale_min: v.scale_min, scale_max: v.scale_max,
            pass_threshold: v.pass_threshold, status: v.status };
          if (editing === 'new') { const t = await db.insert<AssessmentTool>('assessment_tools', { ...row, organization_id: null }); setContent(t); }
          else if (editing) await db.update('assessment_tools', editing.id, row);
          await state.reload();
        }} />
      <ToolContentDrawer tool={content} onClose={() => setContent(null)} onChanged={() => void state.reload()} />
    </div>
  );
}

function FormsTab() {
  const { tr, pick, enumLabel } = useI18n();
  const confirm = useConfirm();
  const state = useAsync(() => db.all<FormTemplate>('form_templates', { filters: [['organization_id', 'is', null], ['program_id', 'is', null]], order: [{ column: 'code', ascending: true }, { column: 'version', ascending: false }] }), []);
  const [editing, setEditing] = useState<FormTemplate | 'new' | null>(null);
  const [fieldsOf, setFieldsOf] = useState<FormTemplate | null>(null);
  const setStatus = useAction(async (t: FormTemplate, status: FormTemplate['status']) => { await db.update('form_templates', t.id, { status }); await state.reload(); }, { success: ['تم تحديث الحالة', 'Status updated'] });

  const fields: PlatformFieldSpec[] = [
    { name: 'title', label: ['العنوان (عربي)', 'Title (Arabic)'], type: 'text', required: true },
    { name: 'title_en', label: ['العنوان (إنجليزي)', 'Title (English)'], type: 'text' },
    { name: 'form_type', label: ['نوع النموذج', 'Form type'], type: 'enum', enumGroup: 'formType', required: true },
    { name: 'stage_key', label: ['مفتاح المرحلة (اختياري)', 'Stage key (optional)'], type: 'text', hint: ['لربط النموذج بمرحلة في رحلة المسار', 'Links the form to a journey stage'] },
    { name: 'track_codes', label: ['المسارات', 'Tracks'], type: 'enum-multi', enumGroup: 'track' },
    { name: 'scoring_enabled', label: ['تفعيل الاحتساب (درجات للإجابات)', 'Enable scoring (answer scores)'], type: 'checkbox' },
    { name: 'requires_review', label: ['يتطلب مراجعة واعتماد', 'Requires review / approval'], type: 'checkbox' },
    { name: 'description', label: ['الوصف', 'Description'], type: 'textarea' },
  ];

  const publish = async (t: FormTemplate, s: FormTemplate['status']) => {
    if (s === 'published' && !(t.schema?.fields ?? []).length) {
      await confirm({ title: tr('لا يمكن النشر', 'Cannot publish'), message: tr('أضف حقلًا واحدًا على الأقل قبل النشر.', 'Add at least one field before publishing.'), confirmLabel: tr('حسنًا', 'OK') });
      return;
    }
    await setStatus.run(t, s);
  };

  return (
    <Card>
      <CardBody flush>
        <DataTable<FormTemplate> rows={state.data ?? []} rowKey={(r) => r.id} loading={state.loading} error={state.error} onRetry={() => void state.reload()} searchable exportName="central-form-templates"
          toolbar={<Button size="sm" variant="primary" icon={<Plus />} onClick={() => setEditing('new')}>{tr('قالب نموذج جديد', 'New form template')}</Button>}
          empty={{ title: tr('لا توجد قوالب نماذج مركزية', 'No central form templates') }}
          columns={[
            { key: 'code', header: tr('الرمز', 'Code'), value: (r) => r.code, render: (r) => <span className="mono">{r.code} <span className="muted">v{r.version}</span></span>, sortable: true },
            { key: 'title', header: tr('العنوان', 'Title'), value: (r) => pick(r.title, r.title_en), sortable: true },
            { key: 'type', header: tr('النوع', 'Type'), value: (r) => r.form_type, render: (r) => enumLabel('formType', r.form_type) },
            { key: 'tracks', header: tr('المسارات', 'Tracks'), value: (r) => r.track_codes.join(' '), render: (r) => r.track_codes.length ? <div className="row wrap" style={{ gap: 3 }}>{r.track_codes.map((c) => <Badge key={c}>{enumLabel('track', c)}</Badge>)}</div> : <span className="muted small">{tr('الكل', 'All')}</span> },
            { key: 'fields', header: tr('الحقول', 'Fields'), align: 'end', value: (r) => r.schema?.fields?.length ?? 0 },
            { key: 'flags', header: tr('خصائص', 'Flags'), value: (r) => [r.scoring_enabled && 'scoring', r.requires_review && 'review'].filter(Boolean).join(' '),
              render: (r) => <div className="row" style={{ gap: 3 }}>{r.scoring_enabled && <Badge tone="info">{tr('احتساب', 'Scored')}</Badge>}{r.requires_review && <Badge tone="info">{tr('مراجعة', 'Review')}</Badge>}</div> },
            { key: 'status', header: tr('الحالة', 'Status'), value: (r) => r.status, render: (r) => <StatusBadge group="toolStatus" value={r.status} /> },
            { key: 'actions', header: '', hideInExport: true, render: (r) => (
              <div className="row">
                <Button size="sm" icon={<Rows3 />} onClick={() => setFieldsOf(r)}>{tr('الحقول', 'Fields')}</Button>
                <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => setEditing(r)} />
                {r.status !== 'published' && <Button size="sm" variant="ghost" loading={setStatus.busy} onClick={() => void publish(r, 'published')}>{tr('نشر', 'Publish')}</Button>}
                {r.status !== 'archived' && <Button size="sm" variant="ghost" loading={setStatus.busy} onClick={() => void publish(r, 'archived')}>{tr('أرشفة', 'Archive')}</Button>}
                {r.status === 'archived' && <Button size="sm" variant="ghost" loading={setStatus.busy} onClick={() => void publish(r, 'draft')}>{tr('إعادة لمسودة', 'Back to draft')}</Button>}
              </div>
            ) },
          ]} />
      </CardBody>
      <PlatformFormModal open={!!editing} onClose={() => setEditing(null)} size="wide" fields={fields}
        title={editing === 'new' ? tr('قالب نموذج مركزي جديد', 'New central form template') : tr('تعديل القالب', 'Edit template')}
        initial={editing && editing !== 'new' ? { ...editing } : { form_type: 'form', track_codes: [], scoring_enabled: false, requires_review: false }}
        onSubmit={async (v) => {
          if (editing === 'new') { const t = await db.insert<FormTemplate>('form_templates', { ...v, organization_id: null, program_id: null, schema: { fields: [] }, status: 'draft' }); setFieldsOf(t); }
          else if (editing) await db.update('form_templates', editing.id, v);
          await state.reload();
        }} />
      <FormFieldsDrawer template={fieldsOf} onClose={() => setFieldsOf(null)} onSaved={() => void state.reload()} />
    </Card>
  );
}
