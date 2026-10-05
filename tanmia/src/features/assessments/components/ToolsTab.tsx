// Tools: the organization's assessment tools (grouped by code with versions)
// and the central library that can be copied into the organization.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Copy, Library, Plus, Wrench } from 'lucide-react';
import { DEFAULT_BANDS } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAsync } from '@/hooks/useAsync';
import { useAction } from '@/hooks/useAction';
import { all, insert, rpc } from '@/services/db';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, StatusBadge, type Column } from '@/components/ui';
import { RecordFormModal, type FieldSpec } from '@/components/forms/RecordForm';
import type { AssessmentTool } from '@/types/db';
import { loadOrgTools } from '../api';

interface ToolGroup { code: string; latest: AssessmentTool; versions: AssessmentTool[] }

export function toolFields(tr: (a: string, e: string) => string): FieldSpec[] {
  return [
    { name: 'name', label: ['اسم الأداة', 'Tool name'], type: 'text', required: true },
    { name: 'name_en', label: ['الاسم بالإنجليزية', 'English name'], type: 'text' },
    { name: 'tool_type', label: ['نوع الأداة', 'Tool type'], type: 'enum', enumGroup: 'toolType', required: true },
    { name: 'provider', label: ['المزوّد', 'Provider'], type: 'text', placeholder: tr('مثال: Hogan أو داخلي', 'e.g. Hogan or internal'),
      hint: ['إلزامي عمليًا للأدوات الخارجية لتوثيق مصدر البيانات', 'Effectively required for external tools to document the data source'] },
    { name: 'subject_type', label: ['المُقيَّم', 'Subject'], type: 'enum', enumGroup: 'subjectType', required: true },
    { name: 'scoring_method', label: ['طريقة الاحتساب', 'Scoring method'], type: 'enum', enumGroup: 'scoringMethod', required: true },
    { name: 'scale_min', label: ['أدنى قيمة في المقياس', 'Scale minimum'], type: 'number', required: true },
    { name: 'scale_max', label: ['أعلى قيمة في المقياس', 'Scale maximum'], type: 'number', required: true,
      validate: (v, vals) => (Number(v) <= Number(vals.scale_min) ? ['يجب أن تكون أكبر من الحد الأدنى', 'Must be greater than the minimum'] : null) },
    { name: 'pass_threshold', label: ['حد النجاح (0–100)', 'Pass threshold (0–100)'], type: 'number', min: 0, max: 100,
      hint: ['على المقياس الموحد 0–100 بعد التطبيع', 'On the normalized 0–100 scale'] },
    { name: 'status', label: ['الحالة', 'Status'], type: 'select', required: true, options: [
      { value: 'draft', label: tr('مسودة', 'Draft') }, { value: 'active', label: tr('نشطة', 'Active') }, { value: 'archived', label: tr('مؤرشفة', 'Archived') }] },
    { name: 'track_codes', label: ['المسارات المناسبة', 'Suitable tracks'], type: 'enum-multi', enumGroup: 'track' },
    { name: 'description', label: ['الوصف والغرض', 'Description & purpose'], type: 'textarea' },
  ];
}

function group(tools: AssessmentTool[]): ToolGroup[] {
  const m = new Map<string, AssessmentTool[]>();
  for (const t of tools) m.set(t.code, [...(m.get(t.code) ?? []), t]);
  return [...m.entries()].map(([code, versions]) => {
    const sorted = [...versions].sort((a, b) => b.version - a.version);
    return { code, latest: sorted.find((v) => v.status === 'active') ?? sorted[0], versions: sorted };
  });
}

export function ToolsTab() {
  const { tr, pick, enumLabel, fmtDate } = useI18n();
  const { org, can } = useOrg();
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  const tools = useAsync(() => loadOrgTools(org.id), [org.id]);
  const central = useAsync(() => all<AssessmentTool>('assessment_tools', {
    filters: [['organization_id', 'is', null], ['status', 'neq', 'archived']], order: [{ column: 'code', ascending: true }, { column: 'version', ascending: false }],
  }), []);
  const groups = useMemo(() => group(tools.data ?? []), [tools.data]);
  const orgCodes = useMemo(() => new Set((tools.data ?? []).map((t) => t.code)), [tools.data]);

  const copy = useAction(async (t: AssessmentTool) => rpc<string>('copy_central_template', { p_kind: 'assessment_tool', p_id: t.id, p_org: org.id }), {
    success: ['تم نسخ الأداة إلى المؤسسة', 'Tool copied into the organization'],
    onDone: (id) => { if (id) nav(`/app/assessments/tools/${id}`); },
  });

  const cols: Column<ToolGroup>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), value: (g) => g.code, render: (g) => <span className="mono">{g.code}</span>, sortable: true },
    { key: 'name', header: tr('الأداة', 'Tool'), value: (g) => pick(g.latest.name, g.latest.name_en), sortable: true,
      render: (g) => <div><b>{pick(g.latest.name, g.latest.name_en)}</b>{g.latest.provider && <div className="tiny muted">{g.latest.provider}</div>}</div> },
    { key: 'type', header: tr('النوع', 'Type'), value: (g) => enumLabel('toolType', g.latest.tool_type), render: (g) => <Badge tone={g.latest.tool_type === 'external' ? 'info' : 'outline'}>{enumLabel('toolType', g.latest.tool_type)}</Badge> },
    { key: 'subject', header: tr('المُقيَّم', 'Subject'), value: (g) => enumLabel('subjectType', g.latest.subject_type) },
    { key: 'scale', header: tr('المقياس', 'Scale'), value: (g) => `${g.latest.scale_min}–${g.latest.scale_max}`, render: (g) => <span className="mono">{g.latest.scale_min}–{g.latest.scale_max}</span> },
    { key: 'method', header: tr('الاحتساب', 'Scoring'), value: (g) => enumLabel('scoringMethod', g.latest.scoring_method) },
    { key: 'pass', header: tr('حد النجاح', 'Pass'), value: (g) => g.latest.pass_threshold, align: 'end' },
    { key: 'versions', header: tr('الإصدارات', 'Versions'), value: (g) => g.versions.map((v) => `v${v.version}`).join(' '), hideInExport: false,
      render: (g) => (
        <div className="row wrap" style={{ gap: 4 }}>
          {g.versions.map((v) => (
            <button key={v.id} type="button" className="link-btn" onClick={(e) => { e.stopPropagation(); nav(`/app/assessments/tools/${v.id}`); }}
              title={`${enumLabel('toolStatus', v.status)} · ${fmtDate(v.updated_at)}`}>
              <Badge tone={v.status === 'active' ? 'success' : v.status === 'archived' ? 'neutral' : 'outline'}>v{v.version}</Badge>
            </button>
          ))}
        </div>
      ) },
    { key: 'status', header: tr('الحالة', 'Status'), value: (g) => enumLabel('toolStatus', g.latest.status), render: (g) => <StatusBadge group="toolStatus" value={g.latest.status} /> },
  ];

  const centralCols: Column<AssessmentTool>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), render: (t) => <span className="mono">{t.code}</span> },
    { key: 'name', header: tr('الأداة', 'Tool'), value: (t) => pick(t.name, t.name_en), render: (t) => <b>{pick(t.name, t.name_en)}</b> },
    { key: 'tracks', header: tr('المسارات', 'Tracks'), value: (t) => t.track_codes.map((c) => enumLabel('track', c)).join('، '),
      render: (t) => <div className="row wrap" style={{ gap: 4 }}>{t.track_codes.map((c) => <Badge key={c} tone="outline">{enumLabel('track', c)}</Badge>)}</div> },
    { key: 'scale', header: tr('المقياس', 'Scale'), value: (t) => `${t.scale_min}–${t.scale_max}` },
    { key: 'version', header: tr('الإصدار', 'Version'), value: (t) => t.version, render: (t) => `v${t.version}` },
    { key: 'act', header: '', hideInExport: true, render: (t) => (
      <div className="row" style={{ gap: 6 }}>
        {orgCodes.has(t.code) && <Badge tone="success">{tr('مستخدمة في المؤسسة', 'In use')}</Badge>}
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); nav(`/app/assessments/tools/${t.id}`); }}>{tr('معاينة', 'Preview')}</Button>
        {can('assessments.create') && (
          <Button size="sm" icon={<Copy />} loading={copy.busy} onClick={(e) => { e.stopPropagation(); void copy.run(t); }}>
            {orgCodes.has(t.code) ? tr('نسخ إصدار جديد', 'Copy new version') : tr('استخدام في المؤسسة', 'Use in organization')}
          </Button>
        )}
      </div>
    ) },
  ];

  return (
    <div className="stack">
      <Card>
        <CardHeader icon={<Wrench size={16} />} title={tr('أدوات المؤسسة', 'Organization tools')}
          hint={tr('كل رمز يجمع إصدارات الأداة؛ النتائج ترتبط بالإصدار المستخدم وقت القياس', 'Each code groups the tool versions; results are bound to the version used at measurement time')}
          actions={can('assessments.create') && <Button variant="primary" size="sm" icon={<Plus />} onClick={() => setCreating(true)}>{tr('أداة جديدة', 'New tool')}</Button>} />
        <CardBody flush>
          <DataTable columns={cols} rows={groups} rowKey={(g) => g.code} loading={tools.loading} error={tools.error} onRetry={tools.reload}
            onRowClick={(g) => nav(`/app/assessments/tools/${g.latest.id}`)} searchable exportName="assessment-tools"
            empty={{ title: tr('لا توجد أدوات تقييم بعد', 'No assessment tools yet'), description: tr('ابدأ بنسخ أداة من المكتبة المركزية أدناه أو أنشئ أداة داخلية/خارجية.', 'Start by copying a tool from the central library below, or create an internal/external tool.') }} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader icon={<Library size={16} />} title={tr('المكتبة المركزية للأدوات', 'Central tools library')}
          hint={tr('أدوات معتمدة من مالك المنصة؛ النسخ ينشئ نسخة مستقلة قابلة للتعديل في مؤسستك', 'Platform-curated tools; copying creates an independent, editable copy in your organization')} />
        <CardBody flush>
          <DataTable columns={centralCols} rows={central.data ?? []} rowKey={(t) => t.id} loading={central.loading} error={central.error} onRetry={central.reload}
            empty={{ title: tr('لا توجد أدوات في المكتبة المركزية', 'The central library is empty') }} />
        </CardBody>
      </Card>
      <RecordFormModal open={creating} onClose={() => setCreating(false)} title={tr('أداة تقييم جديدة', 'New assessment tool')} size="wide"
        fields={toolFields(tr)}
        initial={{ tool_type: 'internal', subject_type: 'individual', scoring_method: 'weighted_average', scale_min: 1, scale_max: 5, pass_threshold: 60, status: 'draft', track_codes: [] }}
        intro={<p className="small muted" style={{ marginBottom: 10 }}>{tr('ستُضاف فئات تصنيف افتراضية (0–100) يمكنك تعديلها في منشئ الأداة، ثم تضيف الأبعاد والأسئلة.', 'Default 0–100 classification bands are added; you can edit them in the tool builder, then add dimensions and questions.')}</p>}
        onSubmit={async (v) => {
          const row = await insert<AssessmentTool>('assessment_tools', { ...v, organization_id: org.id, classification: DEFAULT_BANDS });
          nav(`/app/assessments/tools/${row.id}`);
        }} />
    </div>
  );
}
