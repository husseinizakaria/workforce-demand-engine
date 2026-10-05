// Organization-wide Outputs (delivery volume) & Outcomes (change achieved).
// The two are deliberately kept in separate sections: achieving outputs is not
// evidence that outcomes changed.
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Info, Pencil, Plus, Target, Trash2, TrendingUp, Truck } from 'lucide-react';
import { elapsedShare, indicatorPerformance, l, type IndicatorPerformance, type Insight } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import {
  AsyncView, Badge, Button, Card, CardBody, CardHeader, DataTable, InsightList, Kpi, Notice, PageHeader, Progress, Select, StatusBadge,
  toneOf, useConfirm, useToast, type Column,
} from '@/components/ui';
import { RecordFormModal, type FieldSpec } from '@/components/forms/RecordForm';
import { useAsync } from '@/hooks/useAsync';
import { all, insert, remove, update } from '@/services/db';
import { errorOf } from '@/services/errors';
import type { Evidence, Indicator, IndicatorMeasurement, Program, ProgramOutcome, ProgramOutput } from '@/types/db';

type ProgMin = Pick<Program, 'id' | 'code' | 'name' | 'name_en' | 'status' | 'start_date' | 'end_date'>;
type EvMin = Pick<Evidence, 'id' | 'output_id' | 'outcome_id' | 'indicator_id' | 'verification_status'>;
interface Data {
  programs: ProgMin[]; outputs: ProgramOutput[]; outcomes: ProgramOutcome[];
  indicators: Indicator[] | null; measurements: IndicatorMeasurement[]; evidence: EvMin[] | null;
}

async function safe<T>(p: Promise<T>): Promise<T | null> { try { return await p; } catch { return null; } }

export default function OutcomesPage() {
  const { tr, pick, enumOptions } = useI18n();
  const { org, can } = useOrg();
  const [program, setProgram] = useState('');
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('');

  const state = useAsync<Data>(async () => {
    const orgF: [string, 'eq', string] = ['organization_id', 'eq', org.id];
    const [programs, outputs, outcomes, indicators, evidence] = await Promise.all([
      all<Program>('programs', { select: 'id,code,name,name_en,status,start_date,end_date', filters: [orgF], order: { column: 'name', ascending: true } }),
      all<ProgramOutput>('program_outputs', { filters: [orgF], order: { column: 'code', ascending: true } }),
      all<ProgramOutcome>('program_outcomes', { filters: [orgF], order: { column: 'code', ascending: true } }),
      safe(all<Indicator>('indicators', { filters: [orgF, ['indicator_type', 'eq', 'outcome']], order: { column: 'code', ascending: true } })),
      safe(all<Evidence>('evidence', { select: 'id,output_id,outcome_id,indicator_id,verification_status', filters: [orgF] })),
    ]);
    const measurements = indicators && indicators.length
      ? (await safe(all<IndicatorMeasurement>('indicator_measurements', { filters: [orgF], order: { column: 'measured_at', ascending: true } }))) ?? []
      : [];
    return { programs, outputs, outcomes, indicators, measurements, evidence };
  }, [org.id]);

  return (
    <div className="stack">
      <PageHeader title={tr('المخرجات والنتائج', 'Outputs & outcomes')}
        subtitle={tr('على مستوى المؤسسة: ما نُفّذ (المخرجات) منفصلًا عمّا تغيّر لدى المستفيدين (النتائج).', 'Organization-wide: what was delivered (outputs) kept separate from what changed for beneficiaries (outcomes).')} />
      <Card tinted>
        <CardBody>
          <div className="grid g2">
            <div className="row start"><Truck size={18} /><div><b>{tr('المخرجات = حجم التنفيذ', 'Outputs = delivery volume')}</b><p className="small muted">{tr('منتجات مباشرة للأنشطة: عدد الجلسات، المتدربين، النماذج الأولية… تُقاس بالمستهدف والفعلي ونسبة الإنجاز.', 'Direct products of activities: sessions held, people trained, prototypes built… measured by target, actual and achievement %.')}</p></div></div>
            <div className="row start"><TrendingUp size={18} /><div><b>{tr('النتائج = التغير المتحقق', 'Outcomes = change achieved')}</b><p className="small muted">{tr('تغير في معارف أو سلوك أو وضع المستفيدين، يُقاس مقابل خط أساس عند نقاط القياس (T0…T5). إنجاز المخرجات لا يثبت تحقق النتائج.', 'Change in beneficiaries\' knowledge, behaviour or situation, measured against a baseline at measurement points (T0…T5). Achieving outputs does not prove outcomes.')}</p></div></div>
          </div>
        </CardBody>
      </Card>
      <AsyncView state={state}>
        {(d) => {
          const progOpts = d.programs.map((p) => ({ value: p.id, label: `${pick(p.name, p.name_en)} · ${p.code}` }));
          return (
            <>
              <div className="row wrap">
                <Select aria-label={tr('البرنامج', 'Program')} options={progOpts} placeholder={tr('كل البرامج', 'All programs')} value={program} onChange={(e) => setProgram(e.target.value)} style={{ maxWidth: 280 }} />
                <Select aria-label={tr('المدى', 'Term')} options={enumOptions('outcomeTerm')} placeholder={tr('كل المدد (النتائج)', 'All terms (outcomes)')} value={term} onChange={(e) => setTerm(e.target.value)} style={{ maxWidth: 220 }} />
                <Select aria-label={tr('الحالة', 'Status')} options={[...enumOptions('outputStatus').map((o) => ({ ...o, label: `${tr('مخرج', 'Output')}: ${o.label}` })), ...enumOptions('outcomeStatus').filter((o) => !['achieved', 'not_achieved'].includes(o.value)).map((o) => ({ ...o, label: `${tr('نتيجة', 'Outcome')}: ${o.label}` }))]}
                  placeholder={tr('كل الحالات', 'All statuses')} value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 260 }} />
              </div>
              <Flags d={d} program={program} />
              <OutputsSection d={d} program={program} status={status} canCreate={can('outcomes.create')} canEdit={can('outcomes.edit')} canDelete={can('outcomes.delete')} onChanged={() => void state.reload()} />
              <OutcomesSection d={d} program={program} term={term} status={status} canCreate={can('outcomes.create')} canEdit={can('outcomes.edit')} canDelete={can('outcomes.delete')} onChanged={() => void state.reload()} />
            </>
          );
        }}
      </AsyncView>
    </div>
  );
}

// ----------------------------------------------------------------------------- Flags (expert rules)
function Flags({ d, program }: { d: Data; program: string }) {
  const { tr, pick } = useI18n();
  const insights = useMemo(() => {
    const out: (Insight & { pid: string })[] = [];
    const progs = d.programs.filter((p) => !program || p.id === program);
    for (const p of progs) {
      const outs = d.outputs.filter((o) => o.program_id === p.id);
      const ocs = d.outcomes.filter((o) => o.program_id === p.id);
      const inds = (d.indicators ?? []).filter((i) => i.program_id === p.id && i.status !== 'retired');
      const indIds = new Set(inds.map((i) => i.id));
      const measuredOutcome = d.measurements.some((m) => indIds.has(m.indicator_id) && m.measurement_point !== 'T0')
        || ocs.some((o) => o.actual !== null);
      const achievedOuts = outs.filter((o) => o.status === 'achieved');
      const name = pick(p.name, p.name_en);
      const mk = (code: string, sev: Insight['severity'], kind: Insight['kind'], title: [string, string], why: [string, string], act: [string, string], link: string, suffix = ''): void => {
        out.push({ pid: p.id, rule_code: code, kind, severity: sev, area: 'measurement', title: l(...title), rationale: l(...why), recommended_action: l(...act), source_data: {}, fingerprint: `${p.id}:${code}${suffix}`, link });
      };
      if (achievedOuts.length && !measuredOutcome) mk('OUTPUTS_WITHOUT_OUTCOME_MEASUREMENT', 'high', 'gap',
        [`«${name}»: مخرجات متحققة دون قياس للنتائج`, `“${name}”: outputs achieved without outcome measurement`],
        [`${achievedOuts.length} مخرج متحقق، ولا يوجد أي قياس بعدي لمؤشرات النتائج أو قيمة فعلية للنتائج. لا يمكن الادعاء بحدوث تغيير.`, `${achievedOuts.length} outputs are achieved but there is no post measurement of outcome indicators or recorded outcome value. No change can be claimed.`],
        ['سجّل قياسات النتائج (T1 وما بعدها) مقابل خط الأساس.', 'Record outcome measurements (T1 onward) against the baseline.'], 'outcomes');
      if (outs.length && !ocs.length && !inds.length) mk('NO_OUTCOMES_DEFINED', 'medium', 'missing_config',
        [`«${name}»: لا توجد نتائج معرّفة`, `“${name}”: no outcomes defined`],
        ['البرنامج يتابع المخرجات فقط؛ لا يمكن تقييم التغيير لدى المستفيدين.', 'The program tracks outputs only; change in beneficiaries cannot be assessed.'],
        ['عرّف نتائج قصيرة المدى على الأقل مع مؤشر وخط أساس.', 'Define at least short-term outcomes with an indicator and baseline.'], 'outcomes');
      for (const o of ocs) {
        const ind = inds.find((i) => i.id === o.indicator_id);
        const hasBaseline = o.baseline !== null || (ind && (ind.baseline_value !== null || d.measurements.some((m) => m.indicator_id === ind.id && m.measurement_point === 'T0')));
        if (!hasBaseline) mk('OUTCOME_NO_BASELINE', 'medium', 'missing_config',
          [`النتيجة ${o.code} بلا خط أساس`, `Outcome ${o.code} has no baseline`],
          [`«${o.description}» — بدون خط أساس لا يمكن حساب التغير.`, `“${o.description}” — without a baseline change cannot be computed.`],
          ['أدخل خط الأساس أو اربط النتيجة بمؤشر له قياس T0.', 'Enter a baseline or link the outcome to an indicator with a T0 measurement.'], 'outcomes', `:${o.id}`);
        if (o.status === 'achieved' && d.evidence && !d.evidence.some((e) => e.outcome_id === o.id && e.verification_status !== 'rejected')
          && !(o.indicator_id && d.evidence.some((e) => e.indicator_id === o.indicator_id && e.verification_status !== 'rejected'))) mk('OUTCOME_ACHIEVED_NO_EVIDENCE', 'high', 'evidence_gap',
          [`النتيجة ${o.code} متحققة دون دليل`, `Outcome ${o.code} achieved without evidence`],
          ['الحالة «متحقق» غير مدعومة بأي دليل مرتبط.', 'The “achieved” status is not supported by any linked evidence.'],
          ['ارفع دليلًا (بيانات مسح، تقرير تقييم) واربطه بالنتيجة.', 'Upload evidence (survey data, assessment report) and link it to the outcome.'], 'evidence', `:${o.id}`);
      }
      if (d.evidence) for (const o of achievedOuts) if (!d.evidence.some((e) => e.output_id === o.id && e.verification_status !== 'rejected')) mk('OUTPUT_ACHIEVED_NO_EVIDENCE', 'medium', 'evidence_gap',
        [`المخرج ${o.code} متحقق دون دليل`, `Output ${o.code} achieved without evidence`],
        [`«${o.description}» (${o.actual}/${o.target ?? '—'}) بلا دليل مرتبط.`, `“${o.description}” (${o.actual}/${o.target ?? '—'}) has no linked evidence.`],
        ['اربط كشف حضور أو محضرًا أو منتجًا بالمخرج.', 'Link an attendance sheet, minutes or product to the output.'], 'evidence', `:${o.id}`);
    }
    const order = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
    return out.sort((a, b) => order[b.severity] - order[a.severity]);
  }, [d, program, pick]);
  const [showAll, setShowAll] = useState(false);
  const groups = useMemo(() => {
    const m = new Map<string, Insight[]>();
    for (const i of showAll ? insights : insights.slice(0, 8)) m.set(i.pid, [...(m.get(i.pid) ?? []), i]);
    return [...m.entries()];
  }, [insights, showAll]);
  return (
    <Card>
      <CardHeader title={tr('ملاحظات القياس', 'Measurement findings')} icon={<Info />} hint={tr('قواعد تكشف الخلط بين التنفيذ والتغيير وفجوات الأدلة', 'Rules detecting delivery/change confusion and evidence gaps')}
        actions={insights.length > 8 ? <Button size="sm" variant="ghost" onClick={() => setShowAll((s) => !s)}>{showAll ? tr('عرض أقل', 'Show less') : tr(`عرض الكل (${insights.length})`, `Show all (${insights.length})`)}</Button> : undefined} />
      <CardBody>
        {d.evidence === null && <Notice tone="info">{tr('لا تملك صلاحية عرض الأدلة؛ لم تُفحص فجوات الأدلة.', 'You cannot view evidence; evidence gaps were not checked.')}</Notice>}
        {!groups.length ? <InsightList insights={[]} /> : (
          <div className="stack">
            {groups.map(([pid, list]) => {
              const p = d.programs.find((x) => x.id === pid);
              return (
                <div key={pid} className="stack-sm">
                  <Link to={`/app/programs/${pid}`}><b className="small">{p ? pick(p.name, p.name_en) : pid}</b></Link>
                  <InsightList insights={list} linkBase={`/app/programs/${pid}`} />
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ----------------------------------------------------------------------------- Outputs
function OutputsSection({ d, program, status, canCreate, canEdit, canDelete, onChanged }: {
  d: Data; program: string; status: string; canCreate: boolean; canEdit: boolean; canDelete: boolean; onChanged: () => void;
}) {
  const { tr, pick, fmtNumber, fmtDate, locale } = useI18n();
  const { org } = useOrg();
  const confirm = useConfirm(); const toast = useToast();
  const [edit, setEdit] = useState<ProgramOutput | 'new' | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const pname = (id: string) => { const p = d.programs.find((x) => x.id === id); return p ? pick(p.name, p.name_en) : '—'; };
  const evCount = (id: string) => (d.evidence ? d.evidence.filter((e) => e.output_id === id).length : null);
  const rows = d.outputs.filter((o) => (!program || o.program_id === program) && (!status || o.status === status));
  const ach = (o: ProgramOutput) => (o.target ? Math.round((Number(o.actual) / Number(o.target)) * 1000) / 10 : null);
  const overdue = (o: ProgramOutput) => !!o.due_date && o.due_date < today && !['achieved', 'not_achieved'].includes(o.status);
  const achieved = rows.filter((o) => o.status === 'achieved').length;
  const overdueN = rows.filter(overdue).length;

  const fields: FieldSpec[] = [
    { name: 'program_id', label: ['البرنامج', 'Program'], type: 'select', required: true, options: d.programs.map((p) => ({ value: p.id, label: `${pick(p.name, p.name_en)} · ${p.code}` })), full: true },
    { name: 'description', label: ['وصف المخرج', 'Output description'], type: 'text', required: true, full: true, hint: ['مثال: عدد الجلسات التدريبية المنفذة', 'e.g. Number of training sessions delivered'] },
    { name: 'unit', label: ['الوحدة', 'Unit'], type: 'text', required: true },
    { name: 'status', label: ['الحالة', 'Status'], type: 'enum', enumGroup: 'outputStatus', required: true },
    { name: 'target', label: ['المستهدف', 'Target'], type: 'number', min: 0 },
    { name: 'actual', label: ['الفعلي', 'Actual'], type: 'number', min: 0, required: true },
    { name: 'due_date', label: ['تاريخ الاستحقاق', 'Due date'], type: 'date' },
    { name: 'stage_key', label: ['مفتاح المرحلة', 'Stage key'], type: 'text' },
    { name: 'indicator_id', label: ['مؤشر مرتبط (اختياري)', 'Linked indicator (optional)'], type: 'entity', entity: 'indicators', full: true },
  ];
  const save = async (v: Record<string, unknown>) => {
    if (v.status === 'achieved' && v.target !== null && Number(v.actual) < Number(v.target))
      throw { message_ar: 'لا يمكن اعتبار المخرج «متحققًا» والفعلي أقل من المستهدف؛ استخدم «متحقق جزئيًا».', message_en: 'An output cannot be “achieved” while actual is below target; use “partially achieved”.', code: '22023' };
    if (edit === 'new') await insert('program_outputs', { ...v, organization_id: org.id });
    else if (edit) await update('program_outputs', edit.id, v);
    toast.success(tr('تم الحفظ', 'Saved')); onChanged();
  };
  const del = async (o: ProgramOutput) => {
    if (!(await confirm({ title: tr('حذف المخرج؟', 'Delete output?'), message: `${o.code} — ${o.description}`, danger: true, confirmLabel: tr('حذف', 'Delete') }))) return;
    try { await remove('program_outputs', o.id); toast.success(tr('تم الحذف', 'Deleted')); onChanged(); }
    catch (e) { const ae = errorOf(e); toast.error(locale === 'ar' ? ae.message_ar : ae.message_en); }
  };

  const columns: Column<ProgramOutput>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), sortable: true, render: (o) => <span className="mono small">{o.code}</span> },
    { key: 'program', header: tr('البرنامج', 'Program'), value: (o) => pname(o.program_id), sortable: true, render: (o) => <Link className="small" to={`/app/programs/${o.program_id}/outcomes`}>{pname(o.program_id)}</Link> },
    { key: 'description', header: tr('المخرج', 'Output'), sortable: true },
    { key: 'target', header: tr('المستهدف', 'Target'), align: 'end', sortable: true, value: (o) => o.target, render: (o) => o.target === null ? '—' : `${fmtNumber(Number(o.target))} ${o.unit}` },
    { key: 'actual', header: tr('الفعلي', 'Actual'), align: 'end', sortable: true, value: (o) => o.actual, render: (o) => fmtNumber(Number(o.actual)) },
    { key: 'ach', header: tr('الإنجاز', 'Achievement'), value: ach, sortable: true,
      render: (o) => { const a = ach(o); return a === null ? <span className="muted small">{tr('بلا مستهدف', 'No target')}</span> : <div style={{ minWidth: 90 }}><Progress value={a} tone={a >= 100 ? 'success' : a < 50 ? 'danger' : 'warning'} /><span className="tiny">{fmtNumber(a, 1)}%</span></div>; } },
    { key: 'due_date', header: tr('الاستحقاق', 'Due'), sortable: true, render: (o) => <span className="row small" style={{ gap: 4 }}>{fmtDate(o.due_date)}{overdue(o) && <Badge tone="danger">{tr('متأخر', 'Overdue')}</Badge>}</span> },
    { key: 'status', header: tr('الحالة', 'Status'), sortable: true, render: (o) => <StatusBadge group="outputStatus" value={o.status} /> },
    { key: 'evidence', header: tr('الأدلة', 'Evidence'), align: 'end', value: (o) => evCount(o.id),
      render: (o) => { const n = evCount(o.id); return n === null ? '—' : n === 0 && o.status === 'achieved' ? <Badge tone="warning">0</Badge> : fmtNumber(n); } },
    { key: 'actions', header: '', hideInExport: true, render: (o) => (
      <div className="row" style={{ gap: 2 }}>
        {canEdit && <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => setEdit(o)} />}
        {canDelete && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')} onClick={() => void del(o)} />}
      </div>
    ) },
  ];
  return (
    <Card>
      <CardHeader title={tr('المخرجات — حجم التنفيذ', 'Outputs — delivery volume')} icon={<Truck />}
        actions={canCreate ? <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setEdit('new')} disabled={!d.programs.length}>{tr('مخرج جديد', 'New output')}</Button> : undefined} />
      <CardBody>
        <div className="grid g4" style={{ marginBottom: 12 }}>
          <Kpi label={tr('المخرجات', 'Outputs')} value={fmtNumber(rows.length)} />
          <Kpi label={tr('متحققة', 'Achieved')} value={fmtNumber(achieved)} tone="success" />
          <Kpi label={tr('متأخرة', 'Overdue')} value={fmtNumber(overdueN)} tone={overdueN ? 'danger' : undefined} />
          <Kpi label={tr('متحققة بلا دليل', 'Achieved without evidence')} value={d.evidence ? fmtNumber(rows.filter((o) => o.status === 'achieved' && !evCount(o.id)).length) : '—'} />
        </div>
        <DataTable columns={columns} rows={rows} rowKey={(o) => o.id} searchable exportName="outputs" pageSize={15}
          empty={{ title: tr('لا توجد مخرجات', 'No outputs'), description: tr('عرّف مخرجات البرامج لمتابعة حجم التنفيذ مقابل المستهدف.', 'Define program outputs to track delivery against target.') }} />
      </CardBody>
      <RecordFormModal open={edit !== null} title={edit === 'new' ? tr('مخرج جديد', 'New output') : tr('تعديل المخرج', 'Edit output')} fields={fields}
        initial={edit && edit !== 'new' ? { ...edit } : { program_id: program || '', unit: 'count', status: 'planned', actual: 0 }}
        onClose={() => setEdit(null)} onSubmit={save} />
    </Card>
  );
}

// ----------------------------------------------------------------------------- Outcomes
function OutcomesSection({ d, program, term, status, canCreate, canEdit, canDelete, onChanged }: {
  d: Data; program: string; term: string; status: string; canCreate: boolean; canEdit: boolean; canDelete: boolean; onChanged: () => void;
}) {
  const { tr, pick, fmtNumber, enumLabel, locale } = useI18n();
  const { org } = useOrg();
  const confirm = useConfirm(); const toast = useToast();
  const [edit, setEdit] = useState<ProgramOutcome | 'new' | null>(null);
  const pname = (id: string) => { const p = d.programs.find((x) => x.id === id); return p ? pick(p.name, p.name_en) : '—'; };
  const rows = d.outcomes.filter((o) => (!program || o.program_id === program) && (!term || o.term === term) && (!status || o.status === status));
  const evCount = (o: ProgramOutcome) => (d.evidence ? d.evidence.filter((e) => e.outcome_id === o.id).length : null);

  const perf = useMemo(() => {
    const out: { ind: Indicator; p: IndicatorPerformance }[] = [];
    for (const i of d.indicators ?? []) {
      if (i.status === 'retired') continue;
      if (program && i.program_id !== program) continue;
      if (term && i.outcome_term !== term) continue;
      const pr = d.programs.find((x) => x.id === i.program_id);
      out.push({ ind: i, p: indicatorPerformance(i, d.measurements, pr ? elapsedShare(pr.start_date, pr.end_date) : null) });
    }
    return out;
  }, [d, program, term]);

  const fields: FieldSpec[] = [
    { name: 'program_id', label: ['البرنامج', 'Program'], type: 'select', required: true, options: d.programs.map((p) => ({ value: p.id, label: `${pick(p.name, p.name_en)} · ${p.code}` })), full: true },
    { name: 'description', label: ['وصف النتيجة (التغير المتوقع)', 'Outcome description (expected change)'], type: 'text', required: true, full: true, hint: ['مثال: ارتفاع نسبة المتدربين القادرين على إعداد خطة عمل', 'e.g. Increase in trainees able to prepare a business plan'] },
    { name: 'scope', label: ['النطاق', 'Scope'], type: 'select', required: true, options: [
      { value: 'program', label: tr('البرنامج', 'Program') }, { value: 'cohort', label: tr('الدفعة', 'Cohort') }, { value: 'beneficiary', label: tr('مستفيد', 'Beneficiary') }] },
    { name: 'beneficiary_id', label: ['المستفيد', 'Beneficiary'], type: 'entity', entity: 'beneficiaries', required: true, visible: (v) => v.scope === 'beneficiary' },
    { name: 'term', label: ['المدى', 'Term'], type: 'enum', enumGroup: 'outcomeTerm', required: true },
    { name: 'unit', label: ['الوحدة', 'Unit'], type: 'text', required: true },
    { name: 'baseline', label: ['خط الأساس', 'Baseline'], type: 'number' },
    { name: 'target', label: ['المستهدف', 'Target'], type: 'number' },
    { name: 'actual', label: ['الفعلي', 'Actual'], type: 'number' },
    { name: 'measurement_point', label: ['نقطة القياس', 'Measurement point'], type: 'enum', enumGroup: 'measurementPoint' },
    { name: 'status', label: ['الحالة', 'Status'], type: 'enum', enumGroup: 'outcomeStatus', required: true },
    { name: 'indicator_id', label: ['مؤشر نتائج مرتبط', 'Linked outcome indicator'], type: 'entity', entity: 'indicators', entityFilters: [['indicator_type', 'eq', 'outcome']], full: true },
  ];
  const save = async (v: Record<string, unknown>) => {
    if (v.actual === null && ['achieved', 'on_track', 'at_risk', 'not_achieved'].includes(String(v.status)))
      throw { code: '22023', message_ar: 'لا يمكن تحديد حالة النتيجة دون قيمة فعلية مقاسة؛ استخدم «لم يُقس».', message_en: 'An outcome status cannot be set without a measured actual value; use “Not measured”.' };
    if (v.scope !== 'beneficiary') v.beneficiary_id = null;
    if (edit === 'new') await insert('program_outcomes', { ...v, organization_id: org.id });
    else if (edit) await update('program_outcomes', edit.id, v);
    toast.success(tr('تم الحفظ', 'Saved')); onChanged();
  };
  const del = async (o: ProgramOutcome) => {
    if (!(await confirm({ title: tr('حذف النتيجة؟', 'Delete outcome?'), message: `${o.code} — ${o.description}`, danger: true, confirmLabel: tr('حذف', 'Delete') }))) return;
    try { await remove('program_outcomes', o.id); toast.success(tr('تم الحذف', 'Deleted')); onChanged(); }
    catch (e) { const ae = errorOf(e); toast.error(locale === 'ar' ? ae.message_ar : ae.message_en); }
  };
  const change = (o: ProgramOutcome) => (o.actual !== null && o.baseline !== null ? Number(o.actual) - Number(o.baseline) : null);

  const columns: Column<ProgramOutcome>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), sortable: true, render: (o) => <span className="mono small">{o.code}</span> },
    { key: 'program', header: tr('البرنامج', 'Program'), value: (o) => pname(o.program_id), sortable: true, render: (o) => <Link className="small" to={`/app/programs/${o.program_id}/outcomes`}>{pname(o.program_id)}</Link> },
    { key: 'description', header: tr('النتيجة', 'Outcome'), sortable: true },
    { key: 'term', header: tr('المدى', 'Term'), value: (o) => enumLabel('outcomeTerm', o.term), sortable: true },
    { key: 'baseline', header: tr('خط الأساس', 'Baseline'), align: 'end', value: (o) => o.baseline, render: (o) => o.baseline === null ? <Badge tone="warning">{tr('مفقود', 'Missing')}</Badge> : fmtNumber(Number(o.baseline), 2) },
    { key: 'target', header: tr('المستهدف', 'Target'), align: 'end', value: (o) => o.target, render: (o) => fmtNumber(o.target === null ? null : Number(o.target), 2) },
    { key: 'actual', header: tr('الفعلي', 'Actual'), align: 'end', value: (o) => o.actual, render: (o) => fmtNumber(o.actual === null ? null : Number(o.actual), 2) },
    { key: 'change', header: tr('التغير المُلاحظ', 'Observed change'), align: 'end', value: change, render: (o) => { const c = change(o); return c === null ? '—' : `${c >= 0 ? '+' : ''}${fmtNumber(c, 2)}`; } },
    { key: 'point', header: tr('النقطة', 'Point'), value: (o) => o.measurement_point, render: (o) => o.measurement_point ? <Badge tone="outline">{o.measurement_point}</Badge> : '—' },
    { key: 'status', header: tr('الحالة', 'Status'), sortable: true, render: (o) => <StatusBadge group="outcomeStatus" value={o.status} /> },
    { key: 'evidence', header: tr('الأدلة', 'Evidence'), align: 'end', value: evCount, render: (o) => { const n = evCount(o); return n === null ? '—' : n === 0 && o.status === 'achieved' ? <Badge tone="warning">0</Badge> : fmtNumber(n); } },
    { key: 'actions', header: '', hideInExport: true, render: (o) => (
      <div className="row" style={{ gap: 2 }}>
        {canEdit && <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => setEdit(o)} />}
        {canDelete && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')} onClick={() => void del(o)} />}
      </div>
    ) },
  ];
  type PerfRow = { ind: Indicator; p: IndicatorPerformance };
  const indColumns: Column<PerfRow>[] = [
    { key: 'code', header: tr('المؤشر', 'Indicator'), value: (r) => `${r.ind.code} ${pick(r.ind.name, r.ind.name_en)}`, sortable: true,
      render: (r) => <span className="small"><span className="mono">{r.ind.code}</span> {pick(r.ind.name, r.ind.name_en)}</span> },
    { key: 'program', header: tr('البرنامج', 'Program'), value: (r) => pname(r.ind.program_id), sortable: true },
    { key: 'term', header: tr('المدى', 'Term'), value: (r) => enumLabel('outcomeTerm', r.ind.outcome_term) },
    { key: 'baseline', header: tr('خط الأساس', 'Baseline'), align: 'end', value: (r) => r.p.baseline, render: (r) => r.p.baseline === null ? <Badge tone="warning">{tr('مفقود', 'Missing')}</Badge> : fmtNumber(r.p.baseline, 2) },
    { key: 'latest', header: tr('آخر قيمة', 'Latest'), align: 'end', value: (r) => r.p.latest, render: (r) => r.p.latest === null ? '—' : <span>{fmtNumber(r.p.latest, 2)} <span className="tiny muted">{r.p.latest_point}</span></span> },
    { key: 'target', header: tr('المستهدف', 'Target'), align: 'end', value: (r) => r.p.target, render: (r) => fmtNumber(r.p.target, 2) },
    { key: 'progress', header: tr('التقدم نحو المستهدف', 'Progress to target'), value: (r) => r.p.progress_pct, sortable: true,
      render: (r) => r.p.progress_pct === null ? '—' : <div style={{ minWidth: 90 }}><Progress value={r.p.progress_pct} tone={r.p.status === 'off_track' ? 'danger' : r.p.status === 'at_risk' ? 'warning' : 'success'} /><span className="tiny">{fmtNumber(r.p.progress_pct, 1)}%</span></div> },
    { key: 'status', header: tr('الحالة', 'Status'), value: (r) => r.p.status, sortable: true, render: (r) => <Badge tone={toneOf(r.p.status)}>{enumLabel('indicatorStatus', r.p.status)}</Badge> },
    { key: 'anomalies', header: tr('تنبيهات البيانات', 'Data alerts'), value: (r) => r.p.anomalies.length,
      render: (r) => r.p.anomalies.length ? <span className="tiny" title={r.p.anomalies.map((a) => (locale === 'ar' ? a.ar : a.en)).join('\n')}><Badge tone="warning">{r.p.anomalies.length}</Badge></span> : '—' },
  ];
  return (
    <Card>
      <CardHeader title={tr('النتائج — التغير المتحقق', 'Outcomes — change achieved')} icon={<Target />}
        actions={canCreate ? <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setEdit('new')} disabled={!d.programs.length}>{tr('نتيجة جديدة', 'New outcome')}</Button> : undefined} />
      <CardBody>
        <div className="stack">
          <div className="grid g4">
            <Kpi label={tr('النتائج المسجلة', 'Recorded outcomes')} value={fmtNumber(rows.length)} />
            <Kpi label={tr('متحققة / على المسار', 'Achieved / on track')} value={fmtNumber(rows.filter((o) => ['achieved', 'on_track'].includes(o.status)).length)} tone="success" />
            <Kpi label={tr('لم تُقس', 'Not measured')} value={fmtNumber(rows.filter((o) => o.status === 'not_measured').length)} tone={rows.some((o) => o.status === 'not_measured') ? 'warning' : undefined} />
            <Kpi label={tr('بلا خط أساس', 'Without baseline')} value={fmtNumber(rows.filter((o) => o.baseline === null).length)} />
          </div>
          <DataTable columns={columns} rows={rows} rowKey={(o) => o.id} searchable exportName="outcomes" pageSize={15}
            empty={{ title: tr('لا توجد نتائج مسجلة', 'No recorded outcomes'), description: tr('سجّل النتائج المتوقعة مع خط الأساس والمستهدف لقياس التغير.', 'Record expected outcomes with baseline and target to measure change.') }} />
          <div className="stack-sm">
            <h4 className="small strong">{tr('أداء مؤشرات النتائج', 'Outcome indicator performance')}</h4>
            <p className="tiny muted">{tr('التقدم يُقاس من خط الأساس نحو المستهدف ويُقارن بالزمن المنقضي من البرنامج. هذه تغيرات مُلاحظة وليست إثباتًا سببيًا — راجع صفحة الأثر لمستوى الادعاء.', 'Progress is measured from baseline toward target and compared with elapsed program time. These are observed changes, not causal proof — see Impact for the claim level.')}</p>
            {d.indicators === null ? <Notice tone="info">{tr('لا تملك صلاحية عرض المؤشرات (وحدة الأثر).', 'You cannot view indicators (Impact module).')}</Notice> : (
              <DataTable columns={indColumns} rows={perf} rowKey={(r) => r.ind.id} exportName="outcome-indicators" pageSize={10}
                empty={{ title: tr('لا توجد مؤشرات نتائج', 'No outcome indicators') }} />
            )}
          </div>
        </div>
      </CardBody>
      <RecordFormModal open={edit !== null} title={edit === 'new' ? tr('نتيجة جديدة', 'New outcome') : tr('تعديل النتيجة', 'Edit outcome')} fields={fields}
        initial={edit && edit !== 'new' ? { ...edit } : { program_id: program || '', scope: 'program', term: term || 'short', unit: 'percent', status: 'not_measured' }}
        onClose={() => setEdit(null)} onSubmit={save} />
    </Card>
  );
}
