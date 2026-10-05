// Social impact portfolio: results-chain completeness, evaluation designs,
// indicator registry, claim levels (what may honestly be said), measurement due
// list and the central impact framework library.
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeftRight, BookOpen, CalendarClock, Copy, Eye, Gauge, Layers, Scale, Sprout } from 'lucide-react';
import {
  CLAIM_LABELS, MEASUREMENT_POINTS, assessClaim, duePoints, elapsedShare, indicatorPerformance, resultsChainCompleteness,
  type ChainCompleteness, type ClaimAssessment, type ClaimLevel, type EvidenceLike,
} from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import {
  AsyncView, Badge, Button, Card, CardBody, CardHeader, DataTable, Drawer, EmptyState, Field, Heatmap, Kpi, Modal, Notice, PageHeader, Progress,
  Select, StatusBadge, Tabs, scoreTone, toneOf, useToast, type Column,
} from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { all, insert } from '@/services/db';
import { errorOf } from '@/services/errors';
import { addDaysISO, todayISO } from '@/utils/dates';
import type { ImpactFramework, Indicator, IndicatorMeasurement, Program } from '@/types/db';

type ProgMin = Pick<Program, 'id' | 'code' | 'name' | 'name_en' | 'status' | 'track_code' | 'start_date' | 'end_date'>;
interface Data {
  programs: ProgMin[]; frameworks: ImpactFramework[]; templates: ImpactFramework[]; indicators: Indicator[];
  measurements: IndicatorMeasurement[]; evidence: EvidenceLike[] | null;
}
interface ProgramImpact {
  program: ProgMin; fw: ImpactFramework | null; chain: ChainCompleteness;
  claims: { ind: Indicator; claim: ClaimAssessment }[]; byLevel: Record<ClaimLevel, number>; inconsistent: boolean;
}
const LEVELS: ClaimLevel[] = ['no_data', 'activity_only', 'observed_change', 'contribution', 'stronger_causal'];
const LEVEL_TONE: Record<ClaimLevel, 'neutral' | 'info' | 'warning' | 'primary' | 'success'> = {
  no_data: 'neutral', activity_only: 'info', observed_change: 'warning', contribution: 'primary', stronger_causal: 'success',
};

export default function ImpactPage() {
  const { tr } = useI18n();
  const { org } = useOrg();
  const [tab, setTab] = useState('portfolio');
  const state = useAsync<Data>(async () => {
    const orgF: [string, 'eq', string] = ['organization_id', 'eq', org.id];
    const [programs, frameworks, templates, indicators, measurements, evidence] = await Promise.all([
      all<Program>('programs', { select: 'id,code,name,name_en,status,track_code,start_date,end_date', filters: [orgF], order: { column: 'name', ascending: true } }),
      all<ImpactFramework>('impact_frameworks', { filters: [orgF], order: { column: 'created_at' } }),
      all<ImpactFramework>('impact_frameworks', { filters: [['organization_id', 'is', null]], order: { column: 'name', ascending: true } }).catch(() => [] as ImpactFramework[]),
      all<Indicator>('indicators', { filters: [orgF], order: { column: 'code', ascending: true } }),
      all<IndicatorMeasurement>('indicator_measurements', { filters: [orgF], order: { column: 'measured_at', ascending: true } }),
      all<EvidenceLike>('evidence', { select: 'id,code,title,evidence_type,verification_status,stage_key,indicator_id,beneficiary_id,session_id,outcome_id,output_id,file_path,source_url,created_at', filters: [orgF] }).catch(() => null),
    ]);
    return { programs, frameworks: frameworks.filter((f) => f.program_id), templates, indicators, measurements, evidence };
  }, [org.id]);

  return (
    <div className="stack">
      <PageHeader title={tr('الأثر الاجتماعي', 'Social impact')} subtitle={tr('محفظة الأثر عبر البرامج: اكتمال سلسلة النتائج، قوة الأدلة، وما يمكن قوله بأمانة.', 'Impact portfolio across programs: results-chain completeness, strength of evidence, and what can honestly be claimed.')} />
      <ClaimExplainer />
      <Tabs value={tab} onChange={setTab} items={[
        { key: 'portfolio', label: tr('المحفظة', 'Portfolio'), icon: <Layers /> },
        { key: 'indicators', label: tr('سجل المؤشرات', 'Indicator registry'), icon: <Gauge /> },
        { key: 'due', label: tr('قياسات مستحقة', 'Measurements due'), icon: <CalendarClock /> },
        { key: 'library', label: tr('مكتبة الأطر', 'Framework library'), icon: <BookOpen /> },
      ]} />
      <AsyncView state={state}>
        {(d) => (
          <>
            {tab === 'portfolio' && <Portfolio d={d} />}
            {tab === 'indicators' && <Registry d={d} />}
            {tab === 'due' && <DueList d={d} />}
            {tab === 'library' && <Library d={d} onChanged={() => void state.reload()} />}
          </>
        )}
      </AsyncView>
    </div>
  );
}

function ClaimExplainer() {
  const { tr } = useI18n();
  return (
    <Card tinted>
      <CardHeader title={tr('ماذا يمكننا أن نقول؟ ثلاث درجات من الأدلة', 'What can we claim? Three levels of evidence')} icon={<Scale />} />
      <CardBody>
        <div className="grid g3">
          <div className="stack-sm">
            <Badge tone="warning">{tr('تغير مُلاحظ', 'Observed change')}</Badge>
            <p className="small">{tr('فرق بين القياس القبلي والبعدي. يصف ما حدث، لكنه لا يثبت أن البرنامج سبّبه — قد تفسره عوامل أخرى.', 'A pre/post difference. It describes what happened but does not show the program caused it — other factors may explain it.')}</p>
            <p className="tiny muted">{tr('العبارة المسموحة: «لوحظ تغير قدره…»', 'Allowed: “An observed change of … was recorded”')}</p>
          </div>
          <div className="stack-sm">
            <Badge tone="primary">{tr('مساهمة مدعومة بالأدلة', 'Evidence-supported contribution')}</Badge>
            <p className="small">{tr('تغير متسق مع نظرية تغيير معتمدة (بافتراضاتها) ومدعوم بأدلة متحقق منها، دون مجموعة مقارنة.', 'Change consistent with an approved Theory of Change (with assumptions) and backed by verified evidence, without a comparison group.')}</p>
            <p className="tiny muted">{tr('العبارة المسموحة: «أسهم البرنامج على الأرجح…»', 'Allowed: “The program likely contributed to …”')}</p>
          </div>
          <div className="stack-sm">
            <Badge tone="success">{tr('دليل سببي أقوى', 'Stronger causal evidence')}</Badge>
            <p className="small">{tr('تصميم بمجموعة مقارنة (شبه تجريبي أو عشوائي) مع قياس في النقاط نفسها، يسمح بتقدير فرق الفروق.', 'A comparison-group design (quasi-experimental or randomized) measured at the same points, allowing a difference-in-differences estimate.')}</p>
            <p className="tiny muted">{tr('العبارة المسموحة: «يُقدَّر أثر البرنامج بنحو…»', 'Allowed: “The program’s estimated effect is about …”')}</p>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function useProgramImpacts(d: Data): ProgramImpact[] {
  return useMemo(() => d.programs.map((p) => {
    const fw = d.frameworks.find((f) => f.program_id === p.id) ?? null;
    const inds = d.indicators.filter((i) => i.program_id === p.id);
    const ev = d.evidence ?? [];
    const chain = resultsChainCompleteness(fw, inds);
    const claims = inds.filter((i) => i.status !== 'retired' && (i.indicator_type === 'outcome' || i.indicator_type === 'impact'))
      .map((ind) => ({ ind, claim: assessClaim(ind, d.measurements, ev, fw) }));
    const byLevel = Object.fromEntries(LEVELS.map((lv) => [lv, 0])) as Record<ClaimLevel, number>;
    for (const c of claims) byLevel[c.claim.level]++;
    const inconsistent = !!fw && fw.attribution_approach === 'attribution' && !['comparison_group', 'quasi_experimental', 'rct'].includes(fw.evaluation_design);
    return { program: p, fw, chain, claims, byLevel, inconsistent };
  }), [d]);
}

// ----------------------------------------------------------------------------- Portfolio
function Portfolio({ d }: { d: Data }) {
  const { tr, pick, enumLabel, fmtNumber, L } = useI18n();
  const impacts = useProgramImpacts(d);
  const [open, setOpen] = useState<ProgramImpact | null>(null);
  const withFw = impacts.filter((x) => x.fw).length;
  const avgChain = impacts.length ? Math.round(impacts.reduce((a, x) => a + x.chain.score, 0) / impacts.length) : null;
  const totals = LEVELS.reduce((acc, lv) => ({ ...acc, [lv]: impacts.reduce((a, x) => a + x.byLevel[lv], 0) }), {} as Record<ClaimLevel, number>);
  const matrixRows = impacts.filter((x) => x.claims.length);

  const columns: Column<ProgramImpact>[] = [
    { key: 'program', header: tr('البرنامج', 'Program'), sortable: true, value: (x) => pick(x.program.name, x.program.name_en),
      render: (x) => <div className="stack-sm" style={{ gap: 2 }}><b className="small">{pick(x.program.name, x.program.name_en)}</b><span className="tiny muted">{enumLabel('track', x.program.track_code)} · {enumLabel('programStatus', x.program.status)}</span></div> },
    { key: 'fw', header: tr('إطار الأثر', 'Framework'), value: (x) => x.fw?.status ?? 'none',
      render: (x) => x.fw ? <Badge tone={toneOf(x.fw.status)}>{x.fw.status === 'approved' ? tr('معتمد', 'Approved') : x.fw.status === 'draft' ? tr('مسودة', 'Draft') : tr('مؤرشف', 'Archived')}</Badge> : <Badge tone="danger">{tr('غير موجود', 'Missing')}</Badge> },
    { key: 'design', header: tr('تصميم التقييم', 'Evaluation design'), value: (x) => enumLabel('evaluationDesign', x.fw?.evaluation_design),
      render: (x) => <span className="small">{enumLabel('evaluationDesign', x.fw?.evaluation_design)}{x.inconsistent && <> <Badge tone="danger" title={tr('نهج الإسناد السببي يتطلب مجموعة مقارنة', 'Attribution requires a comparison group')}>{tr('تعارض', 'Inconsistent')}</Badge></>}</span> },
    { key: 'chain', header: tr('اكتمال السلسلة', 'Chain completeness'), sortable: true, value: (x) => x.chain.score,
      render: (x) => <div style={{ minWidth: 100 }}><Progress value={x.chain.score} tone={scoreTone(x.chain.score)} /><span className="tiny">{x.chain.score}% · {x.chain.gaps.length} {tr('فجوة', 'gaps')}</span></div> },
    { key: 'types', header: tr('المؤشرات (تشغيلي/مخرجات/نتائج/أثر)', 'Indicators (op/out/oc/imp)'), value: (x) => `${x.chain.byLevel.operational}/${x.chain.byLevel.output}/${x.chain.byLevel.outcome}/${x.chain.byLevel.impact}`,
      render: (x) => <span className="mono small">{x.chain.byLevel.operational ?? 0} / {x.chain.byLevel.output ?? 0} / <b>{x.chain.byLevel.outcome ?? 0}</b> / <b>{x.chain.byLevel.impact ?? 0}</b></span> },
    { key: 'claims', header: tr('مستويات الادعاء', 'Claim levels'), value: (x) => LEVELS.map((lv) => `${lv}:${x.byLevel[lv]}`).join(' '),
      render: (x) => !x.claims.length ? <span className="tiny muted">{tr('لا مؤشرات نتائج/أثر', 'No outcome/impact indicators')}</span>
        : <div className="row wrap" style={{ gap: 3 }}>{LEVELS.filter((lv) => x.byLevel[lv]).map((lv) => <Badge key={lv} tone={LEVEL_TONE[lv]}>{L(CLAIM_LABELS[lv])}: {x.byLevel[lv]}</Badge>)}</div> },
    { key: 'open', header: '', hideInExport: true, render: (x) => <Button size="sm" variant="ghost" icon={<Eye />} onClick={() => setOpen(x)}>{tr('تفاصيل', 'Details')}</Button> },
  ];
  return (
    <div className="stack">
      <div className="grid g4">
        <Kpi label={tr('برامج لها إطار أثر', 'Programs with impact framework')} value={`${fmtNumber(withFw)} / ${fmtNumber(impacts.length)}`} tone={withFw < impacts.length ? 'warning' : 'success'} />
        <Kpi label={tr('متوسط اكتمال السلسلة', 'Average chain completeness')} value={avgChain === null ? '—' : `${avgChain}%`} tone={scoreTone(avgChain)} />
        <Kpi label={tr('ادعاءات مساهمة أو أقوى', 'Contribution or stronger claims')} value={fmtNumber(totals.contribution + totals.stronger_causal)} tone="success" />
        <Kpi label={tr('تغير مُلاحظ فقط', 'Observed change only')} value={fmtNumber(totals.observed_change)} hint={tr('لا يمكن نسبته للبرنامج وحده', 'cannot be attributed to the program alone')} />
      </div>
      <Card>
        <CardHeader title={tr('البرامج وسلسلة النتائج', 'Programs & results chain')} icon={<Sprout />} />
        <CardBody flush>
          <DataTable columns={columns} rows={impacts} rowKey={(x) => x.program.id} searchable exportName="impact-portfolio" pageSize={15} onRowClick={setOpen}
            empty={{ title: tr('لا توجد برامج', 'No programs') }} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={tr('مصفوفة مستوى الادعاء (البرنامج × المستوى)', 'Claim level matrix (program × level)')} icon={<Scale />}
          hint={tr('عدد مؤشرات النتائج/الأثر في كل مستوى دليل', 'Number of outcome/impact indicators at each evidence level')} />
        <CardBody>
          {!matrixRows.length ? <EmptyState compact title={tr('لا توجد مؤشرات نتائج أو أثر بعد', 'No outcome or impact indicators yet')} /> : (
            <Heatmap rows={matrixRows.map((x) => `${pick(x.program.name, x.program.name_en)} · ${x.program.code}`)} columns={LEVELS.map((lv) => L(CLAIM_LABELS[lv]))}
              values={matrixRows.map((x) => LEVELS.map((lv) => x.byLevel[lv] || null))} max={Math.max(1, ...matrixRows.flatMap((x) => LEVELS.map((lv) => x.byLevel[lv])))} />
          )}
        </CardBody>
      </Card>
      <ProgramDrawer item={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function ProgramDrawer({ item, onClose }: { item: ProgramImpact | null; onClose: () => void }) {
  const { tr, pick, L, enumLabel, fmtNumber } = useI18n();
  if (!item) return null;
  const { program: p, fw, chain, claims } = item;
  return (
    <Drawer open wide title={pick(p.name, p.name_en)} onClose={onClose}
      footer={<Link className="btn primary" to={`/app/programs/${p.id}/impact`}><ArrowLeftRight size={15} /> {tr('فتح أثر البرنامج', 'Open program impact')}</Link>}>
      <div className="stack">
        <dl className="kv">
          <dt>{tr('إطار الأثر', 'Impact framework')}</dt><dd>{fw ? `${fw.code} · ${fw.name}` : tr('غير موجود', 'Missing')}</dd>
          <dt>{tr('تصميم التقييم', 'Evaluation design')}</dt><dd>{enumLabel('evaluationDesign', fw?.evaluation_design)}</dd>
          <dt>{tr('نهج الإسناد', 'Attribution approach')}</dt><dd>{enumLabel('attribution', fw?.attribution_approach)}</dd>
          <dt>{tr('اكتمال السلسلة', 'Chain completeness')}</dt><dd>{chain.score}%</dd>
        </dl>
        {item.inconsistent && <Notice tone="danger">{tr('نهج «الإسناد السببي» محدد بينما تصميم التقييم لا يتضمن مجموعة مقارنة؛ لا يمكن دعم ادعاء سببي. عدّل التصميم أو غيّر النهج إلى «المساهمة».', '“Attribution” is selected but the evaluation design has no comparison group; a causal claim cannot be supported. Change the design or switch to “contribution”.')}</Notice>}
        <div className="stack-sm">
          <h4 className="small strong">{tr('فجوات سلسلة النتائج', 'Results chain gaps')}</h4>
          {!chain.gaps.length ? <p className="small muted">{tr('السلسلة مكتملة وفق القواعد الحالية.', 'The chain is complete under current rules.')}</p> : (
            <ul className="list-plain">{chain.gaps.slice(0, 25).map((g) => <li key={g.key} className="row between small"><span>{L(g.label)}</span><Badge tone={toneOf(g.severity)}>{enumLabel('severity', g.severity)}</Badge></li>)}</ul>
          )}
          {chain.gaps.length > 25 && <p className="tiny muted">{tr(`و${chain.gaps.length - 25} فجوة أخرى`, `and ${chain.gaps.length - 25} more`)}</p>}
        </div>
        <div className="stack-sm">
          <h4 className="small strong">{tr('مستوى الادعاء لكل مؤشر نتائج/أثر', 'Claim level per outcome/impact indicator')}</h4>
          {!claims.length && <p className="small muted">{tr('لا توجد مؤشرات نتائج أو أثر.', 'No outcome or impact indicators.')}</p>}
          {claims.map(({ ind, claim }) => (
            <div key={ind.id} className="card card-pad stack-sm">
              <div className="row between"><b className="small"><span className="mono">{ind.code}</span> {pick(ind.name, ind.name_en)}</b><Badge tone={LEVEL_TONE[claim.level]}>{L(claim.label)}</Badge></div>
              <p className="small muted">{L(claim.explanation)}</p>
              <p className="small"><b>{tr('العبارة المسموحة:', 'Allowed statement:')}</b> {L(claim.allowed_statement)}</p>
              <div className="row wrap tiny muted" style={{ gap: 12 }}>
                <span>{tr('التغير المُلاحظ', 'Observed change')}: {claim.observed_change === null ? '—' : fmtNumber(claim.observed_change, 2)}</span>
                <span>{tr('تغير المقارنة', 'Comparison change')}: {claim.comparison_change === null ? '—' : fmtNumber(claim.comparison_change, 2)}</span>
                <span>{tr('فرق الفروق', 'Diff-in-diff')}: {claim.difference_in_differences === null ? '—' : fmtNumber(claim.difference_in_differences, 2)}</span>
              </div>
              {claim.requirements_for_next_level.length > 0 && (
                <ul className="tiny" style={{ margin: 0, paddingInlineStart: 18 }}>{claim.requirements_for_next_level.map((r, i) => <li key={i}>{L(r)}</li>)}</ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </Drawer>
  );
}

// ----------------------------------------------------------------------------- Registry
type RegRow = { ind: Indicator; program: ProgMin | undefined; latest: number | null; latestPoint: string | null; status: string; measurements: number; claim: ClaimLevel | null };

function Registry({ d }: { d: Data }) {
  const { tr, pick, enumLabel, enumOptions, fmtNumber, L } = useI18n();
  const [type, setType] = useState(''); const [status, setStatus] = useState(''); const [program, setProgram] = useState('');
  const rows = useMemo<RegRow[]>(() => d.indicators
    .filter((i) => (!type || i.indicator_type === type) && (!status || i.status === status) && (!program || i.program_id === program))
    .map((ind) => {
      const p = d.programs.find((x) => x.id === ind.program_id);
      const fw = d.frameworks.find((f) => f.program_id === ind.program_id) ?? null;
      const perf = indicatorPerformance(ind, d.measurements, p ? elapsedShare(p.start_date, p.end_date) : null);
      const claim = ind.indicator_type === 'outcome' || ind.indicator_type === 'impact' ? assessClaim(ind, d.measurements, d.evidence ?? [], fw).level : null;
      return { ind, program: p, latest: perf.latest, latestPoint: perf.latest_point, status: perf.status, measurements: perf.measurements, claim };
    }), [d, type, status, program]);
  const columns: Column<RegRow>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), sortable: true, value: (r) => r.ind.code, render: (r) => <span className="mono small">{r.ind.code}</span> },
    { key: 'name', header: tr('المؤشر', 'Indicator'), sortable: true, value: (r) => pick(r.ind.name, r.ind.name_en) },
    { key: 'program', header: tr('البرنامج', 'Program'), sortable: true, value: (r) => (r.program ? pick(r.program.name, r.program.name_en) : '—'),
      render: (r) => r.program ? <Link className="small" to={`/app/programs/${r.program.id}/impact`}>{pick(r.program.name, r.program.name_en)}</Link> : '—' },
    { key: 'type', header: tr('النوع', 'Type'), sortable: true, value: (r) => enumLabel('indicatorType', r.ind.indicator_type) },
    { key: 'unit', header: tr('الوحدة', 'Unit'), value: (r) => r.ind.unit },
    { key: 'baseline', header: tr('خط الأساس', 'Baseline'), align: 'end', value: (r) => r.ind.baseline_value, render: (r) => fmtNumber(r.ind.baseline_value === null ? null : Number(r.ind.baseline_value), 2) },
    { key: 'latest', header: tr('آخر قيمة', 'Latest'), align: 'end', value: (r) => r.latest, render: (r) => r.latest === null ? '—' : <span>{fmtNumber(r.latest, 2)} <span className="tiny muted">{r.latestPoint}</span></span> },
    { key: 'target', header: tr('المستهدف', 'Target'), align: 'end', value: (r) => r.ind.target_value, render: (r) => fmtNumber(r.ind.target_value === null ? null : Number(r.ind.target_value), 2) },
    { key: 'n', header: tr('القياسات', 'Measurements'), align: 'end', value: (r) => r.measurements },
    { key: 'perf', header: tr('الأداء', 'Performance'), sortable: true, value: (r) => enumLabel('indicatorStatus', r.status), render: (r) => <Badge tone={toneOf(r.status)}>{enumLabel('indicatorStatus', r.status)}</Badge> },
    { key: 'claim', header: tr('مستوى الادعاء', 'Claim level'), value: (r) => (r.claim ? L(CLAIM_LABELS[r.claim]) : ''), render: (r) => r.claim ? <Badge tone={LEVEL_TONE[r.claim]}>{L(CLAIM_LABELS[r.claim])}</Badge> : <span className="muted tiny">—</span> },
    { key: 'status', header: tr('حالة المؤشر', 'Indicator status'), value: (r) => r.ind.status, render: (r) => <StatusBadge group="toolStatus" value={r.ind.status === 'retired' ? 'archived' : r.ind.status} /> },
  ];
  return (
    <Card>
      <CardHeader title={tr('سجل المؤشرات على مستوى المؤسسة', 'Organization indicator registry')} icon={<Gauge />} />
      <CardBody flush>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.ind.id} searchable exportName="indicator-registry" pageSize={20}
          toolbar={<>
            <Select aria-label={tr('النوع', 'Type')} options={enumOptions('indicatorType')} placeholder={tr('كل الأنواع', 'All types')} value={type} onChange={(e) => setType(e.target.value)} style={{ maxWidth: 170 }} />
            <Select aria-label={tr('الحالة', 'Status')} options={[{ value: 'draft', label: tr('مسودة', 'Draft') }, { value: 'active', label: tr('نشط', 'Active') }, { value: 'retired', label: tr('متقاعد', 'Retired') }]} placeholder={tr('كل الحالات', 'All statuses')} value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 160 }} />
            <Select aria-label={tr('البرنامج', 'Program')} options={d.programs.map((p) => ({ value: p.id, label: pick(p.name, p.name_en) }))} placeholder={tr('كل البرامج', 'All programs')} value={program} onChange={(e) => setProgram(e.target.value)} style={{ maxWidth: 220 }} />
          </>}
          empty={{ title: tr('لا توجد مؤشرات', 'No indicators'), description: tr('تُعرَّف المؤشرات داخل مساحة كل برنامج (تبويب الأثر).', 'Indicators are defined inside each program workspace (Impact tab).') }} />
      </CardBody>
    </Card>
  );
}

// ----------------------------------------------------------------------------- Due list
type DueRow = { key: string; ind: Indicator; program: ProgMin; point: string; due: string | null; daysLate: number | null };

function DueList({ d }: { d: Data }) {
  const { tr, pick, enumLabel, fmtDate, fmtNumber } = useI18n();
  const today = todayISO();
  const rows = useMemo<DueRow[]>(() => {
    const out: DueRow[] = [];
    for (const ind of d.indicators) {
      if (ind.status !== 'active') continue;
      const p = d.programs.find((x) => x.id === ind.program_id);
      if (!p || ['draft', 'cancelled'].includes(p.status)) continue;
      const due = new Set(duePoints(p.end_date));
      for (const pt of ind.measurement_points) {
        if (!due.has(pt)) continue;
        if (d.measurements.some((m) => m.indicator_id === ind.id && m.measurement_point === pt)) continue;
        if (pt === 'T0' && ind.baseline_value !== null) continue;
        const mp = MEASUREMENT_POINTS.find((x) => x.key === pt);
        const dueDate = pt === 'T0' ? p.start_date : p.end_date && mp && mp.offsetDays !== null ? addDaysISO(p.end_date, mp.offsetDays) : null;
        const daysLate = dueDate ? Math.max(0, Math.round((new Date(today).getTime() - new Date(dueDate).getTime()) / 86400000)) : null;
        out.push({ key: `${ind.id}:${pt}`, ind, program: p, point: pt, due: dueDate, daysLate });
      }
    }
    return out.sort((a, b) => (b.daysLate ?? -1) - (a.daysLate ?? -1));
  }, [d, today]);
  const columns: Column<DueRow>[] = [
    { key: 'program', header: tr('البرنامج', 'Program'), sortable: true, value: (r) => pick(r.program.name, r.program.name_en),
      render: (r) => <Link className="small" to={`/app/programs/${r.program.id}/impact`}>{pick(r.program.name, r.program.name_en)}</Link> },
    { key: 'ind', header: tr('المؤشر', 'Indicator'), sortable: true, value: (r) => `${r.ind.code} ${pick(r.ind.name, r.ind.name_en)}`,
      render: (r) => <span className="small"><span className="mono">{r.ind.code}</span> {pick(r.ind.name, r.ind.name_en)}</span> },
    { key: 'type', header: tr('النوع', 'Type'), value: (r) => enumLabel('indicatorType', r.ind.indicator_type) },
    { key: 'point', header: tr('نقطة القياس', 'Measurement point'), sortable: true, value: (r) => enumLabel('measurementPoint', r.point) },
    { key: 'due', header: tr('موعد الاستحقاق', 'Due date'), sortable: true, value: (r) => r.due, render: (r) => fmtDate(r.due) },
    { key: 'late', header: tr('أيام التأخير', 'Days overdue'), align: 'end', sortable: true, value: (r) => r.daysLate,
      render: (r) => r.daysLate === null ? '—' : <Badge tone={r.daysLate > 30 ? 'danger' : r.daysLate > 0 ? 'warning' : 'info'}>{fmtNumber(r.daysLate)}</Badge> },
  ];
  return (
    <Card>
      <CardHeader title={tr('قياسات مستحقة غير مسجلة', 'Due measurements not yet recorded')} icon={<CalendarClock />}
        hint={tr('النقاط المستحقة تُحسب من تاريخ انتهاء البرنامج: T1 عند الانتهاء، T2 بعد 30 يومًا، T3 بعد 3 أشهر، T4 بعد 6 أشهر، T5 بعد 12 شهرًا', 'Due points are computed from the program end date: T1 at end, T2 +30 days, T3 +3 months, T4 +6 months, T5 +12 months')} />
      <CardBody flush>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.key} searchable exportName="measurements-due" pageSize={20}
          empty={{ title: tr('لا توجد قياسات متأخرة', 'No overdue measurements'), description: tr('كل نقاط القياس المستحقة للمؤشرات النشطة مسجلة.', 'All due measurement points for active indicators are recorded.') }} />
      </CardBody>
    </Card>
  );
}

// ----------------------------------------------------------------------------- Library
function Library({ d, onChanged }: { d: Data; onChanged: () => void }) {
  const { tr, pick, enumLabel, locale } = useI18n();
  const { org, can } = useOrg();
  const toast = useToast();
  const [applying, setApplying] = useState<ImpactFramework | null>(null);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const withFw = new Set(d.frameworks.map((f) => f.program_id));
  const eligible = d.programs.filter((p) => !withFw.has(p.id) && !['cancelled', 'closed'].includes(p.status));
  const missing = d.programs.filter((p) => !withFw.has(p.id) && !['cancelled', 'closed', 'draft'].includes(p.status));

  const apply = async () => {
    if (!applying || !target) return;
    setBusy(true);
    try {
      await insert('impact_frameworks', {
        organization_id: org.id, program_id: target, name: applying.name, track_code: applying.track_code, problem_statement: applying.problem_statement,
        target_population: applying.target_population, baseline_summary: applying.baseline_summary, theory_of_change: applying.theory_of_change,
        intended_impact: applying.intended_impact, evaluation_design: applying.evaluation_design, attribution_approach: applying.attribution_approach, status: 'draft',
      });
      toast.success(tr('تم إنشاء إطار أثر للبرنامج من القالب (مسودة للمراجعة)', 'Program impact framework created from the template (draft for review)'));
      setApplying(null); setTarget(''); onChanged();
    } catch (e) { const ae = errorOf(e); toast.error(locale === 'ar' ? ae.message_ar : ae.message_en); }
    finally { setBusy(false); }
  };
  const tocCount = (f: ImpactFramework) => Object.values(f.theory_of_change ?? {}).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0);
  const columns: Column<ImpactFramework>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), render: (f) => <span className="mono small">{f.code}</span> },
    { key: 'name', header: tr('الإطار', 'Framework'), sortable: true },
    { key: 'track', header: tr('المسار', 'Track'), value: (f) => enumLabel('track', f.track_code) },
    { key: 'design', header: tr('تصميم التقييم', 'Evaluation design'), value: (f) => enumLabel('evaluationDesign', f.evaluation_design) },
    { key: 'approach', header: tr('نهج الإسناد', 'Attribution'), value: (f) => enumLabel('attribution', f.attribution_approach) },
    { key: 'toc', header: tr('عناصر نظرية التغيير', 'ToC items'), align: 'end', value: tocCount },
    { key: 'apply', header: '', hideInExport: true, render: (f) => can('impact.create')
      ? <Button size="sm" icon={<Copy />} disabled={!eligible.length} onClick={() => { setApplying(f); setTarget(eligible.find((p) => p.track_code === f.track_code)?.id ?? ''); }}>{tr('تطبيق على برنامج', 'Apply to program')}</Button> : null },
  ];
  const opts = [...eligible].sort((a, b) => Number(b.track_code === applying?.track_code) - Number(a.track_code === applying?.track_code))
    .map((p) => ({ value: p.id, label: `${pick(p.name, p.name_en)} · ${enumLabel('track', p.track_code)}${p.track_code === applying?.track_code ? ` ✓` : ''}` }));
  return (
    <div className="stack">
      {missing.length > 0 && (
        <Notice tone="warning">{tr(`${missing.length} برنامج بلا إطار أثر: ${missing.slice(0, 5).map((p) => p.name).join('، ')}${missing.length > 5 ? '…' : ''}. بدون إطار لا يمكن تجاوز مستوى «تغير مُلاحظ».`,
          `${missing.length} programs have no impact framework: ${missing.slice(0, 5).map((p) => p.name_en || p.name).join(', ')}${missing.length > 5 ? '…' : ''}. Without one, claims cannot go beyond “observed change”.`)}</Notice>
      )}
      <Card>
        <CardHeader title={tr('القوالب المركزية لأطر الأثر', 'Central impact framework templates')} icon={<BookOpen />}
          hint={tr('التطبيق ينشئ نسخة مسودة خاصة بالبرنامج؛ لا يُعدَّل القالب المركزي', 'Applying creates a draft copy for the program; the central template is not modified')} />
        <CardBody flush>
          <DataTable columns={columns} rows={d.templates} rowKey={(f) => f.id} exportName="impact-templates"
            empty={{ title: tr('لا توجد قوالب مركزية', 'No central templates') }} />
        </CardBody>
      </Card>
      <Modal open={!!applying} onClose={() => setApplying(null)} title={tr('تطبيق قالب على برنامج', 'Apply template to program')}
        footer={<><Button onClick={() => setApplying(null)}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} disabled={!target} onClick={apply}>{tr('إنشاء الإطار', 'Create framework')}</Button></>}>
        <div className="stack">
          <p className="small">{applying?.name}</p>
          <Field label={tr('البرنامج (بلا إطار حالي)', 'Program (without a framework)')} required>
            <Select options={opts} placeholder={tr('— اختر —', '— Select —')} value={target} onChange={(e) => setTarget(e.target.value)} />
          </Field>
          {target && applying?.track_code && d.programs.find((p) => p.id === target)?.track_code !== applying.track_code && (
            <Notice tone="warning">{tr('مسار البرنامج يختلف عن مسار القالب؛ راجع نظرية التغيير بعد النسخ.', 'The program track differs from the template track; review the Theory of Change after copying.')}</Notice>
          )}
          <Notice tone="info">{tr('سيُنشأ الإطار بحالة «مسودة». لا يُعتمد ادعاء «المساهمة» إلا بعد اعتماد نظرية التغيير وافتراضاتها.', 'The framework is created as “draft”. Contribution claims require an approved Theory of Change with assumptions.')}</Notice>
        </div>
      </Modal>
    </div>
  );
}
