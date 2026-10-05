import { useMemo } from 'react';
import { Gauge, Target } from 'lucide-react';
import { compareMaturity, MATURITY_LEVELS } from '@engine';
import { Badge, Card, CardBody, CardHeader, ColumnChart, DataTable, EmptyState, Heatmap, Notice, StatusBadge, type Column } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import type { MaturityAssessment, MaturityFramework, ProgramOutcome, ProgramStageRecord } from '@/types/db';
import { payloadSummary } from '../dataUtils';
import { type B360, programName } from './data';

const POINTS = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5'];
const BEFORE = '#8CBFBA';
const AFTER = '#287D78';

function latestByPoint(rows: MaturityAssessment[]): Map<string, MaturityAssessment> {
  const m = new Map<string, MaturityAssessment>();
  for (const r of [...rows].sort((a, b) => a.assessed_at.localeCompare(b.assessed_at))) m.set(r.measurement_point, r);
  return m;
}

function FrameworkSkills({ fw, rows }: { fw: MaturityFramework; rows: MaturityAssessment[] }) {
  const { tr, pick, L, fmtDate, enumLabel } = useI18n();
  const byPoint = latestByPoint(rows);
  const points = POINTS.filter((p) => byPoint.has(p));
  const baseline = byPoint.get('T0') ?? (points.length ? byPoint.get(points[0]) : undefined);
  const latest = points.length ? byPoint.get(points[points.length - 1]) : undefined;
  const dims = fw.dimensions;
  const values = dims.map((d) => points.map((p) => { const v = byPoint.get(p)?.dimension_scores[d.key]; return v === undefined ? null : Number(v); }));
  const level = (v: number | null | undefined) => (v === null || v === undefined ? null : MATURITY_LEVELS.find((l) => l.level === Math.round(v)));
  return (
    <Card>
      <CardHeader title={pick(fw.name, fw.name_en)} icon={<Gauge />} hint={`${tr('المقياس', 'Scale')} ${fw.scale_min}–${fw.scale_max} · ${points.join(' → ')}`} />
      <CardBody>
        <div className="grid g2">
          <div className="stack-sm">
            <h4 className="small">{tr('خريطة الأبعاد عبر نقاط القياس', 'Dimension heatmap across measurement points')}</h4>
            <Heatmap rows={dims.map((d) => pick(d.name_ar, d.name_en))} columns={points} values={values} max={fw.scale_max} />
          </div>
          <div className="stack-sm">
            <h4 className="small">{tr('خط الأساس مقابل آخر قياس', 'Baseline vs latest')} {baseline && latest && <span className="muted">({baseline.measurement_point} → {latest.measurement_point})</span>}</h4>
            {baseline && latest && baseline !== latest ? (
              <ColumnChart categories={dims.map((d) => pick(d.name_ar, d.name_en))} max={fw.scale_max}
                series={[
                  { name: `${tr('خط الأساس', 'Baseline')} ${baseline.measurement_point}`, color: BEFORE, values: dims.map((d) => baseline.dimension_scores[d.key] ?? null) },
                  { name: `${tr('الأحدث', 'Latest')} ${latest.measurement_point}`, color: AFTER, values: dims.map((d) => latest.dimension_scores[d.key] ?? null) },
                ]} />
            ) : <Notice tone="info">{tr('مطلوب قياسان على الأقل (مثل T0 وT1) للمقارنة.', 'At least two measurements (e.g. T0 and T1) are needed to compare.')}</Notice>}
          </div>
        </div>
        <table className="table" style={{ marginTop: 10 }}>
          <thead><tr><th>{tr('البعد', 'Dimension')}</th><th className="num">{tr('الأساس', 'Baseline')}</th><th className="num">{tr('الأحدث', 'Latest')}</th><th className="num">{tr('التغير', 'Change')}</th><th>{tr('المستوى الحالي', 'Current level')}</th></tr></thead>
          <tbody>
            {dims.map((d) => {
              const b = baseline?.dimension_scores[d.key]; const a = latest?.dimension_scores[d.key];
              const ch = b !== undefined && a !== undefined && baseline !== latest ? Math.round((a - b) * 100) / 100 : null;
              const lv = level(a);
              return (
                <tr key={d.key}>
                  <td>{pick(d.name_ar, d.name_en)}</td><td className="num">{b ?? '—'}</td><td className="num">{a ?? '—'}</td>
                  <td className="num">{ch === null ? '—' : <Badge tone={ch >= 0.25 ? 'success' : ch <= -0.25 ? 'danger' : 'neutral'}>{ch > 0 ? '+' : ''}{ch}</Badge>}</td>
                  <td>{lv ? pick(lv.ar, lv.en) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="tiny muted" style={{ marginTop: 6 }}>
          {latest && <>{tr('آخر قياس', 'Latest measurement')}: {fmtDate(latest.assessed_at)} · {enumLabel('dataQuality', latest.data_quality)}. </>}
          {L({ ar: 'التغير لدى فرد واحد مؤشر تطور وليس دليلًا على أثر البرنامج.', en: 'Change for one individual indicates development, not proof of program effect.' })}
        </p>
      </CardBody>
    </Card>
  );
}

export function SkillsTab({ d }: { d: B360 }) {
  const { tr, locale, fmtDate, pick } = useI18n();
  const groups = useMemo(() => [...d.frameworks.values()].map((fw) => ({ fw, rows: d.maturity.filter((m) => m.framework_id === fw.id) })).filter((g) => g.rows.length), [d]);
  const skills = d.stageRecords.filter((r) => r.record_type === 'skill_assessment');
  const cols: Column<ProgramStageRecord>[] = [
    { key: 'program', header: tr('البرنامج', 'Program'), value: (r) => programName(d, r.program_id, pick) },
    { key: 'title', header: tr('العنوان', 'Title'), value: (r) => r.title },
    { key: 'details', header: tr('التفاصيل', 'Details'), value: (r) => payloadSummary(r.record_type, r.payload, locale) },
    { key: 'score', header: tr('الدرجة', 'Score'), align: 'end', value: (r) => r.score },
    { key: 'date', header: tr('التاريخ', 'Date'), value: (r) => r.created_at, render: (r) => fmtDate(r.created_at) },
  ];
  return (
    <div className="stack">
      {groups.length === 0 && <Card><EmptyState title={tr('لا توجد قياسات نضج لهذا المستفيد', 'No maturity measurements for this beneficiary')} description={tr('سجل قياس خط الأساس T0 عند بداية البرنامج.', 'Record the T0 baseline at the start of the program.')} /></Card>}
      {groups.map((g) => <FrameworkSkills key={g.fw.id} fw={g.fw} rows={g.rows} />)}
      <Card><CardHeader title={tr('سجلات قياس المهارات', 'Skill assessment records')} /><CardBody flush>
        <DataTable columns={cols} rows={skills} rowKey={(r) => r.id} pageSize={10} empty={{ title: tr('لا توجد سجلات قياس مهارة', 'No skill assessment records') }} />
      </CardBody></Card>
    </div>
  );
}

export function OutcomesTab({ d }: { d: B360 }) {
  const { tr, pick, L, enumLabel } = useI18n();
  const cols: Column<ProgramOutcome>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), render: (o) => <span className="mono">{o.code}</span>, value: (o) => o.code },
    { key: 'program', header: tr('البرنامج', 'Program'), value: (o) => programName(d, o.program_id, pick) },
    { key: 'description', header: tr('النتيجة', 'Outcome'), value: (o) => o.description },
    { key: 'term', header: tr('المدى', 'Term'), value: (o) => enumLabel('outcomeTerm', o.term) },
    { key: 'baseline', header: tr('الأساس', 'Baseline'), align: 'end', value: (o) => o.baseline },
    { key: 'target', header: tr('المستهدف', 'Target'), align: 'end', value: (o) => o.target },
    { key: 'actual', header: tr('الفعلي', 'Actual'), align: 'end', value: (o) => o.actual, render: (o) => (o.actual === null ? '—' : `${o.actual} ${o.unit}`) },
    { key: 'point', header: tr('نقطة القياس', 'Point'), value: (o) => o.measurement_point ?? '' },
    { key: 'status', header: tr('الحالة', 'Status'), value: (o) => o.status, render: (o) => <StatusBadge group="outcomeStatus" value={o.status} /> },
  ];
  const movements = useMemo(() => [...d.frameworks.values()].map((fw) => {
    const rows = d.maturity.filter((m) => m.framework_id === fw.id && m.beneficiary_id === d.ben.id);
    const pts = POINTS.slice(1).filter((p) => rows.some((r) => r.measurement_point === p));
    return { fw, hasT0: rows.some((r) => r.measurement_point === 'T0'), comps: pts.map((p) => compareMaturity(fw, rows, 'T0', p)) };
  }).filter((x) => x.comps.length || x.hasT0), [d]);
  return (
    <div className="stack">
      <Card><CardHeader title={tr('نتائج المستفيد', 'Beneficiary-level outcomes')} icon={<Target />} /><CardBody flush>
        <DataTable columns={cols} rows={d.outcomes} rowKey={(o) => o.id} empty={{ title: tr('لا توجد نتائج على مستوى المستفيد', 'No beneficiary-level outcomes'), description: tr('تُعرّف النتائج بنطاق «مستفيد» في وحدة النتائج.', 'Outcomes with scope “beneficiary” are defined in the Outcomes module.') }} />
      </CardBody></Card>
      <Card>
        <CardHeader title={tr('حركة النضج من T0', 'Maturity movement from T0')} icon={<Gauge />} />
        <CardBody>
          {movements.length === 0 ? <p className="muted small">{tr('لا توجد قياسات نضج.', 'No maturity measurements.')}</p> : movements.map(({ fw, hasT0, comps }) => (
            <div key={fw.id} className="stack-sm" style={{ marginBottom: 12 }}>
              <b className="small">{pick(fw.name, fw.name_en)}</b>
              {!hasT0 && <Notice tone="warning">{tr('لا يوجد خط أساس T0؛ لا يمكن حساب الحركة.', 'No T0 baseline; movement cannot be computed.')}</Notice>}
              {hasT0 && comps.length === 0 && <Notice tone="info">{tr('يوجد T0 فقط؛ بانتظار قياس المتابعة (T1+).', 'Only T0 exists; awaiting a follow-up measurement (T1+).')}</Notice>}
              {comps.length > 0 && (
                <table className="table">
                  <thead><tr><th>{tr('المقارنة', 'Comparison')}</th><th className="num">{tr('قبل', 'Before')}</th><th className="num">{tr('بعد', 'After')}</th><th className="num">{tr('التغير', 'Change')}</th><th>{tr('أكبر تحسن / أضعف حركة', 'Largest gain / weakest movement')}</th></tr></thead>
                  <tbody>
                    {comps.map((c) => {
                      const ranked = c.dimensions.filter((x) => x.change !== null).sort((a, b) => b.change! - a.change!);
                      const s = c.per_subject[0];
                      return (
                        <tr key={c.to}>
                          <td className="mono">{c.from} → {c.to}</td>
                          <td className="num">{s?.before ?? '—'}</td><td className="num">{s?.after ?? '—'}</td>
                          <td className="num">{s?.change === null || s?.change === undefined ? '—' : <Badge tone={s.change >= 0.25 ? 'success' : s.change <= -0.25 ? 'danger' : 'neutral'}>{s.change > 0 ? '+' : ''}{s.change}</Badge>}</td>
                          <td className="small">{ranked.length ? `${L(ranked[0].name)} (${ranked[0].change! > 0 ? '+' : ''}${ranked[0].change}) / ${L(ranked[ranked.length - 1].name)} (${ranked[ranked.length - 1].change})` : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          ))}
          <p className="tiny muted">{tr('هذا تغير مُلاحظ قبل/بعد لفرد واحد، ولا يثبت وحده أن البرنامج سبّبه.', 'This is an observed before/after change for one individual; on its own it does not prove the program caused it.')}</p>
        </CardBody>
      </Card>
    </div>
  );
}
