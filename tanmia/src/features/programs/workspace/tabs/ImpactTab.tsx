// Impact: Theory of Change, visual results chain, chain completeness, indicators
// (operational / output / outcome / impact), measurements and claim strength.
import { useMemo, useState } from 'react';
import { Activity, BadgeCheck, FilePlus2, Network, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { assessClaim, elapsedShare, indicatorPerformance, resultsChainCompleteness } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAction } from '@/hooks/useAction';
import { insert, remove, update } from '@/services/db';
import {
  Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, Notice, Progress, StatusBadge, scoreTone, useConfirm, type Column,
} from '@/components/ui';
import { RecordFormModal, type FieldSpec } from '@/components/forms/RecordForm';
import type { ImpactFramework, Indicator } from '@/types/db';
import { errText, narrativeLines, tryFunction, type FnResult } from '../../lib';
import { createDefaultIndicators, createImpactFramework, defaultIndicatorSeeds, findCentralImpactFramework } from '../../setup';
import { useWorkspace } from '../context';
import { IndicatorDrawer, ResultsChain, TocEditorModal, TYPE_TONE } from '../components/ImpactParts';
import { RowActions, TabInsights } from '../components/common';

interface ImpactResponse { narrative?: unknown; generated_by?: string; chain?: { score?: number } }

export default function ImpactTab() {
  const { tr, enumLabel, pick, locale, L, fmtNumber } = useI18n();
  const { can, org } = useOrg();
  const ws = useWorkspace();
  const b = ws.bundle;
  const fw = b.impactFramework as ImpactFramework | null;
  const confirm = useConfirm();
  const [tocOpen, setTocOpen] = useState(false);
  const [drawer, setDrawer] = useState<Indicator | null>(null);
  const [editing, setEditing] = useState<Indicator | 'new' | null>(null);
  const [server, setServer] = useState<FnResult<ImpactResponse> | null>(null);
  const [serverBusy, setServerBusy] = useState(false);
  const share = elapsedShare(b.program.start_date, b.program.end_date);
  const chain = useMemo(() => resultsChainCompleteness(fw, b.indicators), [fw, b.indicators]);

  const createFw = useAction(async (fromCentral: boolean) => {
    const central = fromCentral ? await findCentralImpactFramework(b.program.track_code) : null;
    if (fromCentral && !central) throw { code: 'not_found', message: tr('لا يوجد قالب مركزي لهذا المسار؛ أنشئ إطارًا فارغًا.', 'No central template for this track; create a blank framework.') };
    const created = await createImpactFramework(org.id, b.program, central);
    if (b.indicators.length) {
      // Attach existing indicators that are not linked to any framework.
      for (const i of b.indicators.filter((x) => !x.impact_framework_id)) await update<Indicator>('indicators', i.id, { impact_framework_id: created.id });
    }
    await ws.reload();
  }, { success: ['تم إنشاء إطار الأثر', 'Impact framework created'] });
  const seed = useAction(async () => { await createDefaultIndicators(org.id, ws.programId, b.program.track_code, fw?.id ?? null); await ws.reload(); }, { success: ['تمت إضافة المؤشرات الافتراضية', 'Default indicators added'] });
  const approve = useAction(async (status: 'approved' | 'draft') => { if (fw) { await update<ImpactFramework>('impact_frameworks', fw.id, { status }); await ws.reload(); } }, { success: ['تم تحديث حالة الإطار', 'Framework status updated'] });
  const delInd = useAction(async (id: string) => { await remove('indicators', id); await ws.reload(); }, { success: ['تم حذف المؤشر', 'Indicator deleted'] });

  const doApprove = async () => {
    const high = chain.gaps.filter((g) => g.severity === 'high');
    if (high.length && !(await confirm({ title: tr('اعتماد مع فجوات عالية؟', 'Approve with high gaps?'),
      message: <ul className="small">{high.map((g) => <li key={g.key}>{L(g.label)}</li>)}</ul> }))) return;
    await approve.run('approved');
  };
  const runServer = async () => {
    setServerBusy(true);
    setServer(await tryFunction<ImpactResponse>('ai-impact-analysis', { organization_id: org.id, program_id: ws.programId }));
    setServerBusy(false);
  };

  const fields: FieldSpec[] = [
    { name: 'name', label: ['اسم المؤشر', 'Indicator name'], type: 'text', required: true },
    { name: 'name_en', label: ['الاسم بالإنجليزية', 'English name'], type: 'text' },
    { name: 'definition', label: ['التعريف وطريقة الحساب', 'Definition & calculation'], type: 'textarea' },
    { name: 'indicator_type', label: ['نوع المؤشر', 'Indicator type'], type: 'enum', enumGroup: 'indicatorType', required: true,
      hint: ['التشغيلي/المخرجات يقيس حجم التنفيذ؛ النتائج/الأثر يقيس التغير', 'Operational/output measure delivery; outcome/impact measure change'] },
    { name: 'chain_level', label: ['مستوى سلسلة النتائج', 'Results-chain level'], type: 'enum', enumGroup: 'chainLevel', required: true },
    { name: 'outcome_term', label: ['المدى', 'Term'], type: 'enum', enumGroup: 'outcomeTerm', visible: (v) => v.indicator_type === 'outcome' || v.indicator_type === 'impact' },
    { name: 'unit', label: ['الوحدة', 'Unit'], type: 'text', required: true, hint: ['count / percent / score / hours / SAR …', 'count / percent / score / hours / SAR …'] },
    { name: 'direction', label: ['الاتجاه المرغوب', 'Desired direction'], type: 'enum', enumGroup: 'direction', required: true },
    { name: 'baseline_value', label: ['خط الأساس', 'Baseline'], type: 'number' },
    { name: 'baseline_date', label: ['تاريخ خط الأساس', 'Baseline date'], type: 'date' },
    { name: 'target_value', label: ['المستهدف', 'Target'], type: 'number' },
    { name: 'frequency', label: ['التكرار', 'Frequency'], type: 'enum', enumGroup: 'frequency', required: true },
    { name: 'data_source', label: ['مصدر البيانات', 'Data source'], type: 'text' },
    { name: 'collection_method', label: ['طريقة الجمع', 'Collection method'], type: 'text' },
    { name: 'measurement_points', label: ['نقاط القياس', 'Measurement points'], type: 'enum-multi', enumGroup: 'measurementPoint' },
    { name: 'evidence_required', label: ['يتطلب دليلًا لكل قياس', 'Evidence required for measurements'], type: 'checkbox' },
    { name: 'status', label: ['الحالة', 'Status'], type: 'select', required: true, options: [
      { value: 'draft', label: tr('مسودة', 'Draft') }, { value: 'active', label: tr('نشط', 'Active') }, { value: 'retired', label: tr('متقاعد', 'Retired') }] },
  ];

  const cols: Column<Indicator>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), render: (r) => <span className="mono">{r.code}</span>, value: (r) => r.code },
    { key: 'name', header: tr('المؤشر', 'Indicator'), sortable: true, value: (r) => pick(r.name, r.name_en),
      render: (r) => <span>{pick(r.name, r.name_en)}<span className="sub">{enumLabel('chainLevel', r.chain_level)}{r.outcome_term ? ` · ${enumLabel('outcomeTerm', r.outcome_term)}` : ''} · {r.unit}</span></span> },
    { key: 'type', header: tr('النوع', 'Type'), value: (r) => enumLabel('indicatorType', r.indicator_type), render: (r) => <Badge tone={TYPE_TONE[r.indicator_type]}>{enumLabel('indicatorType', r.indicator_type)}</Badge> },
    { key: 'baseline', header: tr('الأساس', 'Baseline'), align: 'end', value: (r) => indicatorPerformance(r, b.measurements, share).baseline },
    { key: 'target', header: tr('المستهدف', 'Target'), align: 'end', value: (r) => r.target_value },
    { key: 'latest', header: tr('الأحدث', 'Latest'), align: 'end', value: (r) => indicatorPerformance(r, b.measurements, share).latest },
    { key: 'progress', header: tr('التقدم', 'Progress'), value: (r) => indicatorPerformance(r, b.measurements, share).progress_pct,
      render: (r) => { const p = indicatorPerformance(r, b.measurements, share); return <div className="row"><Progress value={p.progress_pct ?? 0} /><span className="tiny nowrap">{p.progress_pct === null ? '—' : `${p.progress_pct}%`}</span></div>; } },
    { key: 'status', header: tr('الحالة', 'Status'), value: (r) => indicatorPerformance(r, b.measurements, share).status, render: (r) => r.status === 'active' ? <StatusBadge group="indicatorStatus" value={indicatorPerformance(r, b.measurements, share).status} /> : <Badge>{r.status}</Badge> },
    { key: 'claim', header: tr('مستوى الادعاء', 'Claim level'), value: (r) => assessClaim(r, b.measurements, b.evidence, fw).level,
      render: (r) => <Badge tone="outline">{enumLabel('claimLevel', assessClaim(r, b.measurements, b.evidence, fw).level)}</Badge> },
    { key: 'n', header: tr('قياسات', 'Meas.'), align: 'end', value: (r) => b.measurements.filter((m) => m.indicator_id === r.id).length },
    { key: 'actions', header: '', hideInExport: true, render: (r) => (
      <RowActions>
        {can('impact.edit') && <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => setEditing(r)} />}
        {can('impact.delete') && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')}
          onClick={async () => { if (await confirm({ title: tr('حذف المؤشر وقياساته؟', 'Delete the indicator and its measurements?'), danger: true })) void delInd.run(r.id); }} />}
      </RowActions>
    ) },
  ];
  const seeds = defaultIndicatorSeeds(b.program.track_code);
  const missingSeeds = seeds.filter((s) => !b.indicators.some((i) => i.name === s.name_ar));

  return (
    <div className="stack">
      <Notice tone="info">{tr('الفرق قبل/بعد تغير مُلاحظ ولا يثبت السببية. يعرض كل مؤشر مستوى الادعاء المسموح به وصياغته المعتمدة للتقارير.', 'A pre/post difference is observed change and does not prove causality. Each indicator shows its allowed claim level and the approved wording for reports.')}</Notice>

      {!fw ? (
        <Card>
          <EmptyState icon={<Network />} title={tr('لا يوجد إطار أثر / نظرية تغيير للبرنامج', 'No impact framework / Theory of Change')}
            description={tr('نظرية التغيير تربط المدخلات والأنشطة بالمخرجات والنتائج والأثر، وهي شرط للوصول إلى مستوى «مساهمة مدعومة بالأدلة».', 'The Theory of Change links inputs and activities to outputs, outcomes and impact, and is required to reach the “evidence-supported contribution” level.')}
            action={can('impact.create') ? (
              <div className="row">
                <Button variant="primary" icon={<FilePlus2 />} loading={createFw.busy} onClick={() => void createFw.run(true)}>{tr('نسخ قالب المسار المركزي', 'Copy the central track template')}</Button>
                <Button loading={createFw.busy} onClick={() => void createFw.run(false)}>{tr('إطار فارغ', 'Blank framework')}</Button>
              </div>
            ) : undefined} />
        </Card>
      ) : (
        <Card>
          <CardHeader icon={<Network />} title={fw.name}
            hint={`${enumLabel('evaluationDesign', fw.evaluation_design)} · ${enumLabel('attribution', fw.attribution_approach)} · v${fw.version}`}
            actions={<>
              <Badge tone={fw.status === 'approved' ? 'success' : 'warning'}>{fw.status === 'approved' ? tr('معتمد', 'Approved') : fw.status === 'draft' ? tr('مسودة', 'Draft') : tr('مؤرشف', 'Archived')}</Badge>
              {can('impact.edit') && <Button size="sm" icon={<Pencil />} onClick={() => setTocOpen(true)}>{tr('تحرير نظرية التغيير', 'Edit ToC')}</Button>}
              {can('impact.approve') && fw.status !== 'approved' && <Button size="sm" variant="primary" icon={<BadgeCheck />} loading={approve.busy} onClick={() => void doApprove()}>{tr('اعتماد', 'Approve')}</Button>}
              {can('impact.approve') && fw.status === 'approved' && <Button size="sm" variant="ghost" loading={approve.busy} onClick={() => void approve.run('draft')}>{tr('إعادة لمسودة', 'Back to draft')}</Button>}
            </>} />
          <CardBody>
            <div className="grid g3" style={{ marginBottom: 12 }}>
              <div className="stack-sm" style={{ gap: 2 }}><span className="tiny muted">{tr('المشكلة', 'Problem')}</span><span className="small">{fw.problem_statement ?? '—'}</span></div>
              <div className="stack-sm" style={{ gap: 2 }}><span className="tiny muted">{tr('الفئة المستهدفة', 'Target population')}</span><span className="small">{fw.target_population ?? '—'}</span></div>
              <div className="stack-sm" style={{ gap: 2 }}><span className="tiny muted">{tr('الأثر المقصود', 'Intended impact')}</span><span className="small">{fw.intended_impact ?? '—'}</span></div>
            </div>
            <ResultsChain framework={fw} onIndicator={setDrawer} />
          </CardBody>
        </Card>
      )}

      <div className="grid g-1-2">
        <Card>
          <CardHeader title={tr('اكتمال سلسلة النتائج', 'Results-chain completeness')} />
          <CardBody>
            <div className="row" style={{ marginBottom: 8 }}><Progress large value={chain.score} tone={scoreTone(chain.score)} /><b>{chain.score}</b></div>
            <div className="row wrap small" style={{ marginBottom: 8 }}>
              {(['operational', 'output', 'outcome', 'impact'] as const).map((k) => <Badge key={k} tone={TYPE_TONE[k]}>{enumLabel('indicatorType', k)}: {chain.byLevel[k] ?? 0}</Badge>)}
            </div>
            {chain.gaps.length === 0 ? <p className="small" style={{ color: 'var(--success)' }}>{tr('لا توجد فجوات.', 'No gaps.')}</p> : (
              <ul className="list-plain small">
                {chain.gaps.slice(0, 14).map((g) => <li key={g.key} className="row"><Badge tone={g.severity === 'high' ? 'danger' : g.severity === 'medium' ? 'warning' : 'info'}>{enumLabel('severity', g.severity)}</Badge>{L(g.label)}</li>)}
              </ul>
            )}
          </CardBody>
        </Card>
        <div className="stack">
          <TabInsights links={['impact']} title={tr('ملاحظات المحرك على القياس والأثر', 'Engine findings on measurement & impact')} />
          <Card>
            <CardHeader icon={<Sparkles />} title={tr('تحليل الأثر على الخادم', 'Server impact analysis')}
              actions={<Button size="sm" icon={<Activity />} loading={serverBusy} onClick={() => void runServer()}>{tr('تشغيل', 'Run')}</Button>} />
            <CardBody>
              {!server ? <p className="small muted">{tr('يولد الخادم تحليلًا شاملًا (السلسلة والمؤشرات والنضج والأدلة) مع سرد اختياري بنموذج لغوي. التحليل محليًا متاح أعلاه دائمًا.', 'The server produces a full analysis (chain, indicators, maturity, evidence) with an optional LLM narrative. Local analysis is always shown above.')}</p>
                : server.ok ? (
                  <div className="stack-sm">
                    <Badge tone="outline">{server.data.generated_by === 'rules+llm' ? tr('قواعد + نموذج لغوي', 'Rules + LLM') : tr('قواعد', 'Rules')}</Badge>
                    {narrativeLines(server.data.narrative, locale).map((x, i) => <p key={i} className="small">{x}</p>)}
                    {!narrativeLines(server.data.narrative, locale).length && <p className="small muted">{tr('لم يُرجع سرد نصي.', 'No narrative returned.')}</p>}
                  </div>
                ) : <Notice tone={server.unavailable ? 'warning' : 'danger'}>{server.unavailable ? tr('خدمة تحليل الأثر غير منشورة؛ اعتمد على التحليل المحسوب في المتصفح أعلاه.', 'The impact analysis service is not deployed; rely on the browser-computed analysis above.') : errText(locale, server.error)}</Notice>}
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader title={tr('المؤشرات', 'Indicators')} hint={tr('انقر على مؤشر لعرض الأداء وقوة الادعاء والقياسات', 'Click an indicator for performance, claim strength and measurements')}
          actions={<>
            {can('impact.create') && missingSeeds.length > 0 && <Button size="sm" loading={seed.busy} onClick={() => void seed.run()}>{tr(`إضافة مؤشرات المسار الافتراضية (${missingSeeds.length})`, `Add default track indicators (${missingSeeds.length})`)}</Button>}
            {can('impact.create') && <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setEditing('new')}>{tr('مؤشر', 'Indicator')}</Button>}
          </>} />
        <CardBody flush>
          <DataTable rows={b.indicators} rowKey={(r) => r.id} columns={cols} onRowClick={setDrawer} searchable exportName={`${b.program.code}-indicators`}
            empty={{ title: tr('لا توجد مؤشرات', 'No indicators') }} />
        </CardBody>
        <div className="card-foot"><span className="tiny muted">{tr(`${fmtNumber(b.measurements.length)} قياس مسجل`, `${fmtNumber(b.measurements.length)} measurements recorded`)}</span></div>
      </Card>

      {tocOpen && fw && <TocEditorModal framework={fw} onClose={() => setTocOpen(false)} />}
      {drawer && <IndicatorDrawer indicator={b.indicators.find((i) => i.id === drawer.id) ?? drawer} onClose={() => setDrawer(null)}
        onEdit={can('impact.edit') ? () => { setEditing(drawer); setDrawer(null); } : undefined} />}
      <RecordFormModal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? tr('مؤشر جديد', 'New indicator') : tr('تعديل المؤشر', 'Edit indicator')} fields={fields} size="wide"
        initial={editing && editing !== 'new' ? { ...editing } : { indicator_type: 'outcome', chain_level: 'outcome', outcome_term: 'short', unit: 'percent', direction: 'increase', frequency: 'per_measurement_point', measurement_points: ['T0', 'T1'], evidence_required: true, status: 'active' }}
        onSubmit={async (v) => {
          const row = { ...v, outcome_term: v.indicator_type === 'outcome' || v.indicator_type === 'impact' ? v.outcome_term ?? null : null };
          if (editing && editing !== 'new') await update<Indicator>('indicators', editing.id, row);
          else await insert<Indicator>('indicators', { ...row, organization_id: org.id, program_id: ws.programId, impact_framework_id: fw?.id ?? null });
          await ws.reload();
        }} />
    </div>
  );
}
