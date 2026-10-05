// /app/assessments/tools/:toolId — tool settings, classification bands,
// dimensions, questions, translations, question bank, versioning and archive.
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Archive, CheckCircle2, GitBranch, Lock, Pencil } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAsync } from '@/hooks/useAsync';
import { useAction } from '@/hooks/useAction';
import { all, count, rpc, update } from '@/services/db';
import { AsyncView, Badge, Button, Card, CardBody, CardHeader, InsightList, Notice, PageHeader, StatusBadge, useConfirm } from '@/components/ui';
import { RecordFormModal } from '@/components/forms/RecordForm';
import type { AssessmentTool } from '@/types/db';
import { loadToolBundle } from '../api';
import { toolInsights } from '../builder';
import { toolFields } from '../components/ToolsTab';
import { BandsEditor, DimensionsCard, QuestionsCard } from '../components/ToolStructure';

export default function ToolBuilderPage() {
  const { toolId = '' } = useParams();
  const nav = useNavigate();
  const { tr, pick, enumLabel, fmtDate } = useI18n();
  const { org, can } = useOrg();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);

  const data = useAsync(async () => {
    const b = await loadToolBundle(toolId);
    const [results, versions] = await Promise.all([
      count('assessment_results', [['tool_id', 'eq', toolId]]),
      all<AssessmentTool>('assessment_tools', { filters: [['code', 'eq', b.tool.code], b.tool.organization_id ? ['organization_id', 'eq', b.tool.organization_id] : ['organization_id', 'is', null]], order: { column: 'version', ascending: false } }),
    ]);
    return { ...b, results, versions };
  }, [toolId]);

  const newVersion = useAction(async () => rpc<string>('create_assessment_tool_version', { p_tool: toolId }), {
    success: ['أنشئ إصدار جديد (مسودة)', 'New version created (draft)'], onDone: (id) => { if (id) nav(`/app/assessments/tools/${id}`); },
  });
  const setStatus = useAction(async (status: AssessmentTool['status']) => update<AssessmentTool>('assessment_tools', toolId, { status }), {
    success: ['تم تحديث الحالة', 'Status updated'], onDone: () => { void data.reload(); },
  });

  const insights = useMemo(() => (data.data ? toolInsights(data.data.tool, data.data.dims, data.data.questions) : []), [data.data]);

  return (
    <AsyncView state={data} rows={8}>{(d) => {
      const t = d.tool;
      const central = t.organization_id === null;
      const foreign = !central && t.organization_id !== org.id;
      const hasResults = d.results > 0;
      const archived = t.status === 'archived';
      const canEdit = can('assessments.edit') && !central && !foreign;
      const structureEditable = canEdit && !hasResults && !archived;
      const blockers = insights.filter((i) => i.severity === 'high' || i.rule_code === 'TOOL_NO_DIMENSIONS');
      const activate = async () => {
        if (blockers.length) return;
        if (await confirm({ title: tr('تفعيل الأداة', 'Activate tool'), message: tr('ستصبح الأداة متاحة لتسجيل النتائج. بعد أول نتيجة تُقفل البنية ويلزم إصدار جديد لأي تعديل.', 'The tool becomes available for recording results. After the first result the structure locks and any change needs a new version.') })) void setStatus.run('active');
      };
      const archive = async () => {
        if (await confirm({ title: tr('أرشفة الأداة', 'Archive tool'), danger: true, message: tr('لن تظهر الأداة لتسجيل نتائج جديدة؛ تبقى النتائج السابقة كما هي.', 'The tool will no longer be offered for new results; existing results are kept.'), confirmLabel: tr('أرشفة', 'Archive') })) void setStatus.run('archived');
      };
      return (
        <div className="stack">
          <PageHeader title={pick(t.name, t.name_en)} subtitle={t.description ?? undefined}
            crumbs={[{ label: tr('التقييم', 'Assessments'), to: '/app/assessments' }, { label: t.code }]}
            badge={<><Badge tone="outline">v{t.version}</Badge><StatusBadge group="toolStatus" value={t.status} />{central && <Badge tone="info">{tr('مكتبة مركزية', 'Central library')}</Badge>}</>}
            actions={<>
              {canEdit && <Button icon={<Pencil />} onClick={() => setEditing(true)}>{tr('الإعدادات', 'Settings')}</Button>}
              {canEdit && t.status === 'draft' && <Button variant="primary" icon={<CheckCircle2 />} loading={setStatus.busy} disabled={blockers.length > 0} title={blockers.length ? tr('عالج الملاحظات عالية الخطورة أولًا', 'Resolve high-severity findings first') : undefined} onClick={activate}>{tr('تفعيل', 'Activate')}</Button>}
              {canEdit && archived && <Button onClick={() => void setStatus.run('draft')}>{tr('استعادة كمسودة', 'Restore as draft')}</Button>}
              {can('assessments.configure') && !foreign && !central && <Button icon={<GitBranch />} loading={newVersion.busy} onClick={() => void newVersion.run()}>{tr('إنشاء إصدار جديد', 'Create new version')}</Button>}
              {canEdit && !archived && <Button variant="danger" icon={<Archive />} loading={setStatus.busy} onClick={archive}>{tr('أرشفة', 'Archive')}</Button>}
            </>} />

          {central && <Notice tone="info">{tr('هذه أداة من المكتبة المركزية (للعرض). استخدم «استخدام في المؤسسة» من تبويب الأدوات لإنشاء نسخة قابلة للتعديل.', 'This is a central library tool (read-only here). Use “Use in organization” in the Tools tab to create an editable copy.')}</Notice>}
          {hasResults && !central && (
            <Notice tone="warning" icon={<Lock />}>
              {tr(`لهذه الأداة ${d.results} نتيجة مسجلة، لذلك بنيتها (المقياس، الطريقة، الفئات، الأبعاد، الأسئلة) مقفلة حفاظًا على قابلية مقارنة النتائج وتفسيرها. لأي تعديل جوهري أنشئ إصدارًا جديدًا؛ تبقى النتائج السابقة مرتبطة بهذا الإصدار. يمكن تعديل النصوص والترجمات والاسم والوصف.`,
                `This tool has ${d.results} recorded result(s), so its structure (scale, method, bands, dimensions, questions) is locked to keep results comparable and interpretable. For substantive changes create a new version; past results stay bound to this version. Texts, translations, name and description remain editable.`)}
              {can('assessments.configure') && <div style={{ marginTop: 6 }}><Button size="sm" icon={<GitBranch />} loading={newVersion.busy} onClick={() => void newVersion.run()}>{tr('إنشاء إصدار جديد', 'Create new version')}</Button></div>}
            </Notice>
          )}

          <div className="grid g-2-1">
            <Card>
              <CardHeader title={tr('الإعدادات', 'Settings')} />
              <CardBody>
                <dl className="kv">
                  <dt>{tr('الرمز', 'Code')}</dt><dd className="mono">{t.code}</dd>
                  <dt>{tr('النوع', 'Type')}</dt><dd>{enumLabel('toolType', t.tool_type)}{t.provider && ` · ${t.provider}`}</dd>
                  <dt>{tr('المُقيَّم', 'Subject')}</dt><dd>{enumLabel('subjectType', t.subject_type)}</dd>
                  <dt>{tr('طريقة الاحتساب', 'Scoring method')}</dt><dd>{enumLabel('scoringMethod', t.scoring_method)}</dd>
                  <dt>{tr('المقياس', 'Scale')}</dt><dd className="mono">{t.scale_min}–{t.scale_max}</dd>
                  <dt>{tr('حد النجاح', 'Pass threshold')}</dt><dd>{t.pass_threshold === null ? '—' : `${t.pass_threshold}%`}</dd>
                  <dt>{tr('المسارات', 'Tracks')}</dt><dd>{t.track_codes.length ? t.track_codes.map((c) => enumLabel('track', c)).join('، ') : '—'}</dd>
                  <dt>{tr('النتائج المسجلة', 'Recorded results')}</dt><dd>{d.results}</dd>
                  <dt>{tr('آخر تحديث', 'Updated')}</dt><dd>{fmtDate(t.updated_at)}</dd>
                </dl>
                {d.versions.length > 1 && (
                  <div className="row wrap" style={{ marginTop: 10, gap: 6 }}>
                    <span className="small muted">{tr('الإصدارات', 'Versions')}:</span>
                    {d.versions.map((v) => (
                      <button key={v.id} type="button" className="link-btn" onClick={() => nav(`/app/assessments/tools/${v.id}`)} disabled={v.id === t.id}>
                        <Badge tone={v.id === t.id ? 'primary' : v.status === 'active' ? 'success' : 'outline'}>v{v.version} · {enumLabel('toolStatus', v.status)}</Badge>
                      </button>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={tr('فحص جودة الأداة', 'Tool quality review')} hint={tr('قواعد خبير القياس', 'Measurement expert rules')} />
              <CardBody><InsightList insights={insights} max={12} emptyTitle={tr('لا توجد ملاحظات على بنية الأداة', 'No findings on the tool structure')} /></CardBody>
            </Card>
          </div>

          <BandsEditor tool={t} editable={structureEditable} onSaved={data.reload} />
          <DimensionsCard tool={t} dims={d.dims} questions={d.questions} editable={structureEditable} onChanged={data.reload} />
          <QuestionsCard tool={t} dims={d.dims} questions={d.questions} editable={structureEditable} textEditable={canEdit && !archived} onChanged={data.reload} />

          <RecordFormModal open={editing} onClose={() => setEditing(false)} title={tr('إعدادات الأداة', 'Tool settings')} size="wide"
            fields={toolFields(tr).filter((f) => f.name !== 'status').map((f) => (hasResults && ['scale_min', 'scale_max', 'scoring_method', 'pass_threshold', 'tool_type', 'subject_type'].includes(f.name)
              ? { ...f, disabled: true, hint: ['مقفل لوجود نتائج — أنشئ إصدارًا جديدًا', 'Locked because results exist — create a new version'] as [string, string] } : f))}
            initial={{ name: t.name, name_en: t.name_en, tool_type: t.tool_type, provider: t.provider, subject_type: t.subject_type, scoring_method: t.scoring_method, scale_min: t.scale_min, scale_max: t.scale_max, pass_threshold: t.pass_threshold, track_codes: t.track_codes, description: t.description }}
            onSubmit={async (v) => {
              const patch = { ...v };
              if (hasResults) for (const k of ['scale_min', 'scale_max', 'scoring_method', 'pass_threshold', 'tool_type', 'subject_type']) delete patch[k];
              await update('assessment_tools', t.id, patch);
              await data.reload();
            }} />
        </div>
      );
    }}</AsyncView>
  );
}
