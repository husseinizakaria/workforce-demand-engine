// Outputs (delivery volume) vs outcomes (change achieved), kept clearly apart.
import { useState } from 'react';
import { AlertTriangle, Package, Pencil, Plus, Trash2, TrendingUp } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAction } from '@/hooks/useAction';
import { insert, remove, update } from '@/services/db';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, Notice, Progress, StatusBadge, useConfirm, type Column } from '@/components/ui';
import { RecordFormModal, type FieldSpec } from '@/components/forms/RecordForm';
import type { ProgramOutcome, ProgramOutput } from '@/types/db';
import { useWorkspace } from '../context';
import { RowActions, TabInsights } from '../components/common';

const outcomeProgress = (o: ProgramOutcome): number | null => {
  if (o.actual === null || o.target === null) return null;
  const base = o.baseline ?? 0; const span = Number(o.target) - Number(base);
  return span === 0 ? null : Math.round(((Number(o.actual) - Number(base)) / span) * 100);
};

export default function OutcomesTab() {
  const { tr, fmtNumber, fmtDate, enumLabel } = useI18n();
  const { can, org } = useOrg();
  const ws = useWorkspace();
  const b = ws.bundle;
  const confirm = useConfirm();
  const [editOut, setEditOut] = useState<ProgramOutput | 'new' | null>(null);
  const [editOc, setEditOc] = useState<ProgramOutcome | 'new' | null>(null);
  const delOut = useAction(async (id: string) => { await remove('program_outputs', id); await ws.reload(); });
  const delOc = useAction(async (id: string) => { await remove('program_outcomes', id); await ws.reload(); });
  const today = new Date().toISOString().slice(0, 10);
  const indOpts = (types: string[]) => b.indicators.filter((i) => types.includes(i.indicator_type)).map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` }));
  const stageOpts = b.stages.map((s) => ({ value: s.stage_key, label: ws.stageName(s.stage_key) }));

  const outputsAchieved = b.outputs.filter((o) => o.status === 'achieved').length;
  const outcomeMeasured = b.outcomes.some((o) => o.actual !== null) || b.measurements.some((m) => b.indicators.some((i) => i.id === m.indicator_id && (i.indicator_type === 'outcome' || i.indicator_type === 'impact')));

  const outFields: FieldSpec[] = [
    { name: 'description', label: ['وصف المخرج', 'Output description'], type: 'text', required: true, full: true, hint: ['ما قدّمه البرنامج: جلسات، متدربون، منتجات…', 'What the program delivered: sessions, trainees, products…'] },
    { name: 'unit', label: ['الوحدة', 'Unit'], type: 'text', required: true },
    { name: 'target', label: ['المستهدف', 'Target'], type: 'number', min: 0 },
    { name: 'actual', label: ['المتحقق', 'Actual'], type: 'number', min: 0 },
    { name: 'due_date', label: ['الموعد', 'Due date'], type: 'date' },
    { name: 'stage_key', label: ['المرحلة', 'Stage'], type: 'select', options: stageOpts },
    { name: 'indicator_id', label: ['مؤشر المخرجات', 'Output indicator'], type: 'select', options: indOpts(['output', 'operational']) },
    { name: 'status', label: ['الحالة', 'Status'], type: 'enum', enumGroup: 'outputStatus', required: true },
  ];
  const ocFields: FieldSpec[] = [
    { name: 'description', label: ['وصف النتيجة (التغير)', 'Outcome (change) description'], type: 'text', required: true, full: true, hint: ['التغير لدى المستفيدين: مهارة، توظيف، دخل…', 'Change in beneficiaries: skills, employment, income…'] },
    { name: 'scope', label: ['النطاق', 'Scope'], type: 'select', required: true, options: [{ value: 'program', label: tr('البرنامج', 'Program') }, { value: 'cohort', label: tr('دفعة', 'Cohort') }, { value: 'beneficiary', label: tr('مستفيد', 'Beneficiary') }] },
    { name: 'beneficiary_id', label: ['المستفيد', 'Beneficiary'], type: 'select', options: ws.enrolled.map((x) => ({ value: x.id, label: x.full_name })), visible: (v) => v.scope === 'beneficiary', required: true },
    { name: 'term', label: ['المدى', 'Term'], type: 'enum', enumGroup: 'outcomeTerm', required: true },
    { name: 'unit', label: ['الوحدة', 'Unit'], type: 'text', required: true },
    { name: 'baseline', label: ['خط الأساس', 'Baseline'], type: 'number' },
    { name: 'target', label: ['المستهدف', 'Target'], type: 'number' },
    { name: 'actual', label: ['القيمة المقاسة', 'Measured value'], type: 'number' },
    { name: 'measurement_point', label: ['نقطة القياس', 'Measurement point'], type: 'enum', enumGroup: 'measurementPoint' },
    { name: 'indicator_id', label: ['مؤشر النتائج', 'Outcome indicator'], type: 'select', options: indOpts(['outcome', 'impact']) },
    { name: 'status', label: ['الحالة', 'Status'], type: 'enum', enumGroup: 'outcomeStatus', required: true },
  ];

  const outCols: Column<ProgramOutput>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), render: (r) => <span className="mono">{r.code}</span>, value: (r) => r.code },
    { key: 'description', header: tr('المخرج', 'Output'), sortable: true },
    { key: 'progress', header: tr('المتحقق / المستهدف', 'Actual / target'), value: (r) => Number(r.actual),
      render: (r) => <div className="row"><Progress value={r.target ? (Number(r.actual) / Number(r.target)) * 100 : 0} tone={r.status === 'achieved' ? 'success' : undefined} /><span className="tiny nowrap">{fmtNumber(Number(r.actual))} / {fmtNumber(r.target === null ? null : Number(r.target))} {r.unit}</span></div> },
    { key: 'due', header: tr('الموعد', 'Due'), value: (r) => r.due_date, render: (r) => r.due_date && r.due_date < today && !['achieved', 'not_achieved', 'partially_achieved'].includes(r.status) ? <Badge tone="danger">{fmtDate(r.due_date)}</Badge> : fmtDate(r.due_date) },
    { key: 'stage', header: tr('المرحلة', 'Stage'), value: (r) => ws.stageName(r.stage_key) },
    { key: 'evidence', header: tr('أدلة', 'Evidence'), align: 'end', value: (r) => b.evidence.filter((e) => e.output_id === r.id).length,
      render: (r) => { const n = b.evidence.filter((e) => e.output_id === r.id).length; return r.status === 'achieved' && !n ? <Badge tone="warning">{tr('بلا دليل', 'None')}</Badge> : n; } },
    { key: 'status', header: tr('الحالة', 'Status'), value: (r) => r.status, render: (r) => <StatusBadge group="outputStatus" value={r.status} /> },
    { key: 'actions', header: '', hideInExport: true, render: (r) => (
      <RowActions>
        {can('outcomes.edit') && <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => setEditOut(r)} />}
        {can('outcomes.delete') && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')}
          onClick={async () => { if (await confirm({ title: tr('حذف المخرج؟', 'Delete output?'), danger: true })) void delOut.run(r.id); }} />}
      </RowActions>
    ) },
  ];
  const ocCols: Column<ProgramOutcome>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), render: (r) => <span className="mono">{r.code}</span>, value: (r) => r.code },
    { key: 'description', header: tr('النتيجة', 'Outcome'), sortable: true, render: (r) => <span>{r.description}<span className="sub">{enumLabel('outcomeTerm', r.term)}{r.beneficiary_id ? ` · ${ws.benName(r.beneficiary_id)}` : ''}</span></span>, value: (r) => r.description },
    { key: 'baseline', header: tr('خط الأساس', 'Baseline'), align: 'end', value: (r) => r.baseline },
    { key: 'target', header: tr('المستهدف', 'Target'), align: 'end', value: (r) => r.target },
    { key: 'actual', header: tr('المقاس', 'Measured'), align: 'end', value: (r) => r.actual, render: (r) => (r.actual === null ? <Badge tone="warning">{tr('لم يُقس', 'Not measured')}</Badge> : `${fmtNumber(Number(r.actual), 2)} ${r.unit}`) },
    { key: 'progress', header: tr('التقدم', 'Progress'), value: (r) => outcomeProgress(r), render: (r) => { const p = outcomeProgress(r); return p === null ? '—' : <div className="row"><Progress value={p} /><span className="tiny">{p}%</span></div>; } },
    { key: 'point', header: tr('النقطة', 'Point'), value: (r) => r.measurement_point ?? '' },
    { key: 'status', header: tr('الحالة', 'Status'), value: (r) => r.status, render: (r) => <StatusBadge group="outcomeStatus" value={r.status} /> },
    { key: 'actions', header: '', hideInExport: true, render: (r) => (
      <RowActions>
        {can('outcomes.edit') && <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => setEditOc(r)} />}
        {can('outcomes.delete') && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')}
          onClick={async () => { if (await confirm({ title: tr('حذف النتيجة؟', 'Delete outcome?'), danger: true })) void delOc.run(r.id); }} />}
      </RowActions>
    ) },
  ];

  return (
    <div className="stack">
      {outputsAchieved > 0 && !outcomeMeasured && (
        <Notice tone="warning" icon={<AlertTriangle />}>
          <b>{tr('مخرجات متحققة دون قياس للنتائج', 'Outputs achieved but outcomes not measured')}</b><br />
          {tr(`حقق البرنامج ${outputsAchieved} مخرجًا، لكن لا يوجد أي قياس للتغير لدى المستفيدين. المخرجات تثبت حجم التنفيذ فقط ولا تدل على تحقق نتائج أو أثر.`,
            `The program achieved ${outputsAchieved} outputs, but no change in beneficiaries has been measured. Outputs prove delivery volume only, not outcomes or impact.`)}
        </Notice>
      )}
      <TabInsights links={['outcomes']} />
      <Card>
        <CardHeader icon={<Package />} title={tr('حجم التنفيذ (المخرجات)', 'Delivery volume (outputs)')} hint={tr('ما قدّمه البرنامج', 'What the program delivered')}
          actions={can('outcomes.create') ? <Button size="sm" icon={<Plus />} onClick={() => setEditOut('new')}>{tr('مخرج', 'Output')}</Button> : undefined} />
        <CardBody flush>
          <DataTable rows={b.outputs} rowKey={(r) => r.id} columns={outCols} exportName={`${b.program.code}-outputs`} empty={{ title: tr('لا توجد مخرجات معرفة', 'No outputs defined') }} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader icon={<TrendingUp />} title={tr('التغير المتحقق (النتائج)', 'Change achieved (outcomes)')} hint={tr('ما تغيّر لدى المستفيدين', 'What changed for beneficiaries')}
          actions={can('outcomes.create') ? <Button size="sm" icon={<Plus />} onClick={() => setEditOc('new')}>{tr('نتيجة', 'Outcome')}</Button> : undefined} />
        <CardBody flush>
          <DataTable rows={b.outcomes} rowKey={(r) => r.id} columns={ocCols} exportName={`${b.program.code}-outcomes`}
            empty={{ title: tr('لا توجد نتائج معرفة', 'No outcomes defined'), description: tr('عرّف نتائج قابلة للقياس مع خط أساس ومستهدف.', 'Define measurable outcomes with a baseline and target.') }} />
        </CardBody>
        <div className="card-foot"><span className="tiny muted">{tr('الفرق بين خط الأساس والقيمة المقاسة تغير مُلاحظ، ولا يثبت وحده أن البرنامج سببه. راجع تبويب الأثر لمستوى قوة الادعاء.', 'The difference between baseline and measured value is observed change; on its own it does not prove the program caused it. See the Impact tab for the claim level.')}</span></div>
      </Card>
      <RecordFormModal open={!!editOut} onClose={() => setEditOut(null)} title={editOut === 'new' ? tr('مخرج جديد', 'New output') : tr('تعديل المخرج', 'Edit output')} fields={outFields}
        initial={editOut && editOut !== 'new' ? { ...editOut } : { unit: 'count', actual: 0, status: 'planned' }}
        onSubmit={async (v) => {
          const row = { ...v, actual: v.actual ?? 0 };
          if (editOut && editOut !== 'new') await update<ProgramOutput>('program_outputs', editOut.id, row);
          else await insert<ProgramOutput>('program_outputs', { ...row, organization_id: org.id, program_id: ws.programId });
          await ws.reload();
        }} />
      <RecordFormModal open={!!editOc} onClose={() => setEditOc(null)} title={editOc === 'new' ? tr('نتيجة جديدة', 'New outcome') : tr('تعديل النتيجة', 'Edit outcome')} fields={ocFields}
        initial={editOc && editOc !== 'new' ? { ...editOc } : { scope: 'program', term: 'short', unit: 'percent', status: 'not_measured' }}
        onSubmit={async (v) => {
          const row = { ...v, beneficiary_id: v.scope === 'beneficiary' ? v.beneficiary_id : null };
          if (editOc && editOc !== 'new') await update<ProgramOutcome>('program_outcomes', editOc.id, row);
          else await insert<ProgramOutcome>('program_outcomes', { ...row, organization_id: org.id, program_id: ws.programId });
          await ws.reload();
        }} />
    </div>
  );
}
