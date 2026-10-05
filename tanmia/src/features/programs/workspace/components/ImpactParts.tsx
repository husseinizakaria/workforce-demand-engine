// Impact building blocks: Theory of Change editor, visual results chain,
// claim-level card and the per-indicator drawer with measurements.
import { useMemo, useState } from 'react';
import { ArrowLeftRight, Plus, Quote, Scale, Trash2 } from 'lucide-react';
import {
  assessClaim, elapsedShare, indicatorPerformance, TOC_KEYS, type ClaimAssessment, type TocKey,
} from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAction } from '@/hooks/useAction';
import { insert, remove, update } from '@/services/db';
import { errorOf, type AppError } from '@/services/errors';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, Drawer, Field, Input, Modal, Notice, Progress, Select, StatusBadge, Textarea, useConfirm, type Tone } from '@/components/ui';
import { RecordFormModal, type FieldSpec } from '@/components/forms/RecordForm';
import type { ImpactFramework, Indicator, IndicatorMeasurement } from '@/types/db';
import { errText } from '../../lib';
import { useWorkspace } from '../context';
import { ListEditor, RowActions } from './common';

export const TYPE_TONE: Record<Indicator['indicator_type'], Tone> = { operational: 'neutral', output: 'info', outcome: 'primary', impact: 'success' };

// ------------------------------------------------------------------ ToC editor
export function TocEditorModal({ framework, onClose }: { framework: ImpactFramework; onClose: () => void }) {
  const { tr, locale, enumOptions } = useI18n();
  const ws = useWorkspace();
  const [v, setV] = useState({
    name: framework.name, problem_statement: framework.problem_statement ?? '', target_population: framework.target_population ?? '',
    baseline_summary: framework.baseline_summary ?? '', intended_impact: framework.intended_impact ?? '',
    evaluation_design: framework.evaluation_design, attribution_approach: framework.attribution_approach,
  });
  const [toc, setToc] = useState<Partial<Record<TocKey, string[]>>>({ ...framework.theory_of_change });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const causalMismatch = v.attribution_approach === 'attribution' && ['monitoring_only', 'pre_post'].includes(v.evaluation_design);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const clean = Object.fromEntries(Object.entries(toc).map(([k, list]) => [k, (list ?? []).map((x) => x.trim()).filter(Boolean)]));
      await update<ImpactFramework>('impact_frameworks', framework.id, {
        name: v.name.trim() || framework.name, problem_statement: v.problem_statement.trim() || null, target_population: v.target_population.trim() || null,
        baseline_summary: v.baseline_summary.trim() || null, intended_impact: v.intended_impact.trim() || null, evaluation_design: v.evaluation_design,
        attribution_approach: v.attribution_approach, theory_of_change: clean, ...(framework.status === 'approved' ? { status: 'draft' } : {}),
      });
      await ws.reload(); onClose();
    } catch (e) { setError(errorOf(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open size="wide" title={tr('تحرير نظرية التغيير', 'Edit Theory of Change')} onClose={onClose}
      footer={<><Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} onClick={() => void save()}>{tr('حفظ', 'Save')}</Button></>}>
      {error && <Notice tone="danger">{errText(locale, error)}</Notice>}
      {framework.status === 'approved' && <Notice tone="warning">{tr('الإطار معتمد؛ أي تعديل يعيده إلى «مسودة» ويتطلب إعادة الاعتماد.', 'The framework is approved; any edit returns it to “draft” and requires re-approval.')}</Notice>}
      <div className="form-grid">
        <Field label={tr('الاسم', 'Name')} className="full"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label={tr('المشكلة الاجتماعية', 'Social problem')} className="full"><Textarea value={v.problem_statement} onChange={(e) => setV({ ...v, problem_statement: e.target.value })} /></Field>
        <Field label={tr('الفئة المستهدفة', 'Target population')}><Textarea value={v.target_population} onChange={(e) => setV({ ...v, target_population: e.target.value })} /></Field>
        <Field label={tr('خط الأساس', 'Baseline')}><Textarea value={v.baseline_summary} onChange={(e) => setV({ ...v, baseline_summary: e.target.value })} /></Field>
        <Field label={tr('الأثر المقصود', 'Intended impact')} className="full"><Textarea value={v.intended_impact} onChange={(e) => setV({ ...v, intended_impact: e.target.value })} /></Field>
        <Field label={tr('تصميم التقييم', 'Evaluation design')} hint={tr('يحدد أقصى مستوى ادعاء ممكن', 'Determines the strongest claim possible')}>
          <Select options={enumOptions('evaluationDesign')} value={v.evaluation_design} onChange={(e) => setV({ ...v, evaluation_design: e.target.value as ImpactFramework['evaluation_design'] })} />
        </Field>
        <Field label={tr('منهج الإسناد', 'Attribution approach')}>
          <Select options={enumOptions('attribution')} value={v.attribution_approach} onChange={(e) => setV({ ...v, attribution_approach: e.target.value as ImpactFramework['attribution_approach'] })} />
        </Field>
      </div>
      {causalMismatch && <Notice tone="warning">{tr('الإسناد السببي يتطلب مجموعة مقارنة أو تصميمًا شبه تجريبي؛ مع التصميم الحالي لا يمكن ادعاء السببية.', 'Causal attribution requires a comparison group or quasi-experimental design; with the current design causality cannot be claimed.')}</Notice>}
      <div className="grid g2">
        {TOC_KEYS.map((k) => (
          <Field key={k.key} label={<>{locale === 'ar' ? k.ar : k.en}{k.required ? <span className="req">*</span> : null}</>}>
            <ListEditor value={toc[k.key] ?? []} onChange={(list) => setToc((t) => ({ ...t, [k.key]: list }))} />
          </Field>
        ))}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ results chain
export function ResultsChain({ framework, onIndicator }: { framework: ImpactFramework | null; onIndicator: (i: Indicator) => void }) {
  const { tr, pick, enumLabel } = useI18n();
  const ws = useWorkspace();
  const b = ws.bundle;
  const share = elapsedShare(b.program.start_date, b.program.end_date);
  const toc = framework?.theory_of_change ?? {};
  const cols: { key: string; label: string; items: { text: string; tag?: string }[]; level: Indicator['chain_level'] }[] = [
    { key: 'inputs', label: tr('المدخلات', 'Inputs'), items: (toc.inputs ?? []).map((t) => ({ text: t })), level: 'input' },
    { key: 'activities', label: tr('الأنشطة', 'Activities'), items: (toc.activities ?? []).map((t) => ({ text: t })), level: 'activity' },
    { key: 'outputs', label: tr('المخرجات', 'Outputs'), items: (toc.outputs ?? []).map((t) => ({ text: t })), level: 'output' },
    { key: 'outcomes', label: tr('النتائج', 'Outcomes'), level: 'outcome', items: [
      ...(toc.outcomes_short ?? []).map((t) => ({ text: t, tag: enumLabel('outcomeTerm', 'short') })),
      ...(toc.outcomes_medium ?? []).map((t) => ({ text: t, tag: enumLabel('outcomeTerm', 'medium') })),
      ...(toc.outcomes_long ?? []).map((t) => ({ text: t, tag: enumLabel('outcomeTerm', 'long') })),
    ] },
    { key: 'impact', label: tr('الأثر', 'Impact'), items: (toc.impact ?? []).map((t) => ({ text: t })), level: 'impact' },
  ];
  return (
    <div className="stack-sm">
      <div className="chain">
        {cols.map((c, ci) => {
          const inds = b.indicators.filter((i) => i.chain_level === c.level && i.status !== 'retired');
          return (
            <div key={c.key} className="chain-col">
              <h4><span>{ci + 1}. {c.label}</span><span className="tiny muted">{c.items.length} · {inds.length} {tr('مؤشر', 'ind.')}</span></h4>
              {c.items.length === 0 && <span className="tiny" style={{ color: 'var(--warning)' }}>{tr('غير معرّف في نظرية التغيير', 'Not defined in ToC')}</span>}
              {c.items.map((it, i) => (
                <div key={i} className="small" style={{ background: 'var(--primary-tint)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px' }}>
                  {it.tag && <span className="tiny muted">{it.tag} · </span>}{it.text}
                </div>
              ))}
              {inds.length > 0 && <div className="divider" />}
              {inds.map((i) => {
                const pf = indicatorPerformance(i, b.measurements, share);
                return (
                  <button key={i.id} type="button" className="link-btn small" style={{ textAlign: 'start', fontWeight: 500 }} onClick={() => onIndicator(i)}>
                    <Badge tone={TYPE_TONE[i.indicator_type]}>{i.code}</Badge> {pick(i.name, i.name_en)}{' '}
                    <span className="tiny muted">{pf.progress_pct === null ? '' : `${pf.progress_pct}%`}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      {(toc.assumptions?.length || toc.external_factors?.length) ? (
        <div className="grid g2">
          <div className="card card-pad stack-sm"><b className="small">{tr('الافتراضات', 'Assumptions')}</b><ul className="small" style={{ margin: 0, paddingInlineStart: 16 }}>{(toc.assumptions ?? []).map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          <div className="card card-pad stack-sm"><b className="small">{tr('العوامل الخارجية', 'External factors')}</b><ul className="small" style={{ margin: 0, paddingInlineStart: 16 }}>{(toc.external_factors ?? []).map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ claim card
export function ClaimCard({ claim }: { claim: ClaimAssessment }) {
  const { tr, L, enumLabel, fmtNumber } = useI18n();
  const tone: Tone = claim.level === 'stronger_causal' ? 'success' : claim.level === 'contribution' ? 'primary' : claim.level === 'observed_change' ? 'info' : 'neutral';
  const fmt = (x: number | null) => (x === null ? '—' : `${x >= 0 ? '+' : ''}${fmtNumber(x, 2)}`);
  return (
    <Card tinted>
      <CardHeader icon={<Scale />} title={tr('قوة الادعاء', 'Claim strength')} actions={<Badge tone={tone}>{enumLabel('claimLevel', claim.level)}</Badge>} />
      <CardBody>
        <div className="stack-sm">
          <p className="small">{L(claim.explanation)}</p>
          <div className="row start" style={{ gap: 8, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
            <Quote size={16} color="var(--primary)" style={{ flex: 'none' }} />
            <div className="stack-sm" style={{ gap: 2 }}>
              <span className="tiny muted">{tr('الصياغة المسموح بها في التقارير', 'Allowed statement for reports')}</span>
              <span className="small strong">{L(claim.allowed_statement)}</span>
            </div>
          </div>
          <div className="row wrap small" style={{ gap: 14 }}>
            <span>{tr('التغير المُلاحظ', 'Observed change')}: <b>{fmt(claim.observed_change)}</b></span>
            <span>{tr('تغير مجموعة المقارنة', 'Comparison change')}: <b>{fmt(claim.comparison_change)}</b></span>
            <span>{tr('فرق الفروق', 'Difference-in-differences')}: <b>{fmt(claim.difference_in_differences)}</b></span>
          </div>
          {claim.requirements_for_next_level.length > 0 && (
            <div className="stack-sm" style={{ gap: 2 }}>
              <span className="small strong">{tr('للوصول إلى مستوى أقوى', 'To reach a stronger level')}</span>
              <ul className="small" style={{ margin: 0, paddingInlineStart: 16 }}>{claim.requirements_for_next_level.map((r, i) => <li key={i}>{L(r)}</li>)}</ul>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

// ------------------------------------------------------------------ indicator drawer
export function IndicatorDrawer({ indicator, onClose, onEdit }: { indicator: Indicator; onClose: () => void; onEdit?: () => void }) {
  const { tr, pick, enumLabel, fmtDate, fmtNumber, L } = useI18n();
  const { can, org } = useOrg();
  const ws = useWorkspace();
  const b = ws.bundle;
  const confirm = useConfirm();
  const [add, setAdd] = useState(false);
  const share = elapsedShare(b.program.start_date, b.program.end_date);
  const ms = useMemo(() => b.measurements.filter((m) => m.indicator_id === indicator.id), [b.measurements, indicator.id]);
  const perf = useMemo(() => indicatorPerformance(indicator, b.measurements, share), [indicator, b.measurements, share]);
  const claim = useMemo(() => assessClaim(indicator, b.measurements, b.evidence, b.impactFramework), [indicator, b]);
  const del = useAction(async (id: string) => { await remove('indicator_measurements', id); await ws.reload(); });
  const fields: FieldSpec[] = [
    { name: 'measurement_point', label: ['نقطة القياس', 'Measurement point'], type: 'enum', enumGroup: 'measurementPoint', required: true },
    { name: 'value', label: ['القيمة', 'Value'], type: 'number', required: true, hint: [`الوحدة: ${indicator.unit}`, `Unit: ${indicator.unit}`],
      validate: (v) => (indicator.unit === 'percent' && (Number(v) < 0 || Number(v) > 100) ? ['النسبة بين 0 و100', 'Percent must be 0–100'] : null) },
    { name: 'sample_size', label: ['حجم العينة', 'Sample size'], type: 'number', min: 0, step: 1, hint: ['أقل من 10 يحد من التعميم', 'Below 10 limits generalization'] },
    { name: 'comparison_value', label: ['قيمة مجموعة المقارنة', 'Comparison group value'], type: 'number', hint: ['في نفس النقطة؛ يتيح فرق الفروق', 'At the same point; enables difference-in-differences'] },
    { name: 'data_quality', label: ['جودة البيانات', 'Data quality'], type: 'select', required: true, options: ['estimated', 'reported', 'verified'].map((x) => ({ value: x, label: enumLabel('dataQuality', x) })) },
    { name: 'evidence_id', label: ['الدليل المرتبط', 'Linked evidence'], type: 'select', options: b.evidence.map((e) => ({ value: e.id, label: `${e.code} · ${e.title} (${enumLabel('verification', e.verification_status)})` })) },
    { name: 'period_start', label: ['بداية الفترة', 'Period start'], type: 'date' },
    { name: 'period_end', label: ['نهاية الفترة', 'Period end'], type: 'date' },
    { name: 'source', label: ['المصدر', 'Source'], type: 'text', full: true },
    { name: 'notes', label: ['ملاحظات', 'Notes'], type: 'textarea' },
  ];
  const usedPoints = ms.map((m) => m.measurement_point).filter(Boolean);
  return (
    <Drawer open wide title={`${indicator.code} · ${pick(indicator.name, indicator.name_en)}`} onClose={onClose}
      footer={onEdit ? <Button icon={<ArrowLeftRight />} onClick={onEdit}>{tr('تعديل المؤشر', 'Edit indicator')}</Button> : undefined}>
      <div className="row wrap">
        <Badge tone={TYPE_TONE[indicator.indicator_type]}>{enumLabel('indicatorType', indicator.indicator_type)}</Badge>
        <Badge tone="outline">{enumLabel('chainLevel', indicator.chain_level)}</Badge>
        {indicator.outcome_term && <Badge tone="outline">{enumLabel('outcomeTerm', indicator.outcome_term)}</Badge>}
        <Badge tone="outline">{enumLabel('direction', indicator.direction)}</Badge>
        <StatusBadge group="indicatorStatus" value={perf.status} />
      </div>
      {indicator.definition && <p className="small">{indicator.definition}</p>}
      <dl className="kv">
        <dt>{tr('خط الأساس', 'Baseline')}</dt><dd>{fmtNumber(perf.baseline, 2)} {indicator.unit}</dd>
        <dt>{tr('آخر قيمة', 'Latest')}</dt><dd>{fmtNumber(perf.latest, 2)} {perf.latest_point ? `(${perf.latest_point})` : ''}</dd>
        <dt>{tr('المستهدف', 'Target')}</dt><dd>{fmtNumber(perf.target, 2)}</dd>
        <dt>{tr('التقدم نحو المستهدف', 'Progress to target')}</dt><dd><div className="row"><Progress value={perf.progress_pct ?? 0} /><span>{perf.progress_pct === null ? '—' : `${perf.progress_pct}%`}</span></div></dd>
        <dt>{tr('المصدر / الطريقة', 'Source / method')}</dt><dd>{indicator.data_source ?? '—'} {indicator.collection_method ? `· ${indicator.collection_method}` : ''}</dd>
        <dt>{tr('نقاط القياس', 'Measurement points')}</dt><dd>{indicator.measurement_points.join(' · ') || '—'}</dd>
      </dl>
      {perf.anomalies.length > 0 && <Notice tone="warning"><ul style={{ margin: 0, paddingInlineStart: 16 }}>{perf.anomalies.map((a, i) => <li key={i}>{L(a)}</li>)}</ul></Notice>}
      <ClaimCard claim={claim} />
      <div className="row between">
        <b>{tr('القياسات', 'Measurements')}</b>
        {can('impact.create') && <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setAdd(true)}>{tr('إضافة قياس', 'Add measurement')}</Button>}
      </div>
      <DataTable rows={ms} rowKey={(r) => r.id} empty={{ title: tr('لا توجد قياسات', 'No measurements') }} exportName={`${indicator.code}-measurements`}
        columns={[
          { key: 'point', header: tr('النقطة', 'Point'), value: (r) => r.measurement_point ?? '' },
          { key: 'value', header: tr('القيمة', 'Value'), align: 'end', value: (r) => Number(r.value) },
          { key: 'n', header: 'n', align: 'end', value: (r) => r.sample_size },
          { key: 'cmp', header: tr('المقارنة', 'Comparison'), align: 'end', value: (r) => r.comparison_value },
          { key: 'q', header: tr('الجودة', 'Quality'), value: (r) => enumLabel('dataQuality', r.data_quality) },
          { key: 'ev', header: tr('دليل', 'Evidence'), value: (r) => (r.evidence_id ? b.evidence.find((e) => e.id === r.evidence_id)?.code ?? '✓' : '') },
          { key: 'at', header: tr('التاريخ', 'Date'), value: (r) => r.measured_at, render: (r) => fmtDate(r.measured_at) },
          { key: 'actions', header: '', hideInExport: true, render: (r) => can('impact.delete') ? (
            <RowActions><Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')}
              onClick={async () => { if (await confirm({ title: tr('حذف القياس؟', 'Delete measurement?'), danger: true })) void del.run(r.id); }} /></RowActions>
          ) : null },
        ]} />
      <RecordFormModal open={add} onClose={() => setAdd(false)} title={tr('إضافة قياس', 'Add measurement')} fields={fields}
        initial={{ measurement_point: indicator.measurement_points.find((p) => !usedPoints.includes(p as IndicatorMeasurement['measurement_point'])) ?? 'other', data_quality: 'reported' }}
        intro={usedPoints.length ? <Notice tone="info">{tr(`نقاط مسجلة: ${usedPoints.join('، ')}. تكرار نفس النقطة يُرصد كقيمة غير معتادة.`, `Recorded points: ${usedPoints.join(', ')}. Repeating a point is flagged as an anomaly.`)}</Notice> : undefined}
        onSubmit={async (v) => {
          await insert<IndicatorMeasurement>('indicator_measurements', { ...v, organization_id: org.id, indicator_id: indicator.id, program_id: ws.programId });
          await ws.reload();
        }} />
    </Drawer>
  );
}
