// Maturity before/after analysis (compareMaturity) and maturity assessment entry.
import { useMemo, useState } from 'react';
import { Gauge, Plus } from 'lucide-react';
import { compareMaturity, MATURITY_LEVELS, MEASUREMENT_POINTS } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import {
  Badge, Button, Card, CardBody, CardHeader, ColumnChart, DataTable, Distribution, Field, Kpi, Modal, Notice, Segmented, Select, Textarea,
} from '@/components/ui';
import { insert, update } from '@/services/db';
import { errorOf, type AppError } from '@/services/errors';
import type { MaturityAssessment, MaturityFramework, MeasurementPointKey } from '@/types/db';
import { errText } from '../../lib';
import { useWorkspace } from '../context';

const POINTS = MEASUREMENT_POINTS.map((p) => p.key);

export function MaturityPanel({ framework }: { framework: MaturityFramework }) {
  const { tr, L, enumLabel, fmtNumber, pick } = useI18n();
  const { can } = useOrg();
  const ws = useWorkspace();
  const [from, setFrom] = useState('T0');
  const [to, setTo] = useState('T1');
  const [record, setRecord] = useState(false);
  const cmp = useMemo(() => compareMaturity(framework, ws.bundle.maturityAssessments, from, to), [framework, ws.bundle.maturityAssessments, from, to]);
  const pointOptions = POINTS.map((p) => ({ value: p, label: enumLabel('measurementPoint', p) }));
  const fmtChange = (x: number | null) => (x === null ? '—' : `${x >= 0 ? '+' : ''}${fmtNumber(x, 2)}`);
  const conf = cmp.confidence === 'moderate' ? ['success', tr('متوسطة', 'Moderate')] : cmp.confidence === 'indicative' ? ['warning', tr('مؤشرات أولية', 'Indicative')] : ['danger', tr('غير كافية', 'Insufficient')];
  return (
    <Card>
      <CardHeader icon={<Gauge />} title={`${tr('النضج قبل / بعد', 'Maturity before / after')}: ${pick(framework.name, framework.name_en)}`}
        hint={`${framework.scale_min}–${framework.scale_max} · ${framework.dimensions.length} ${tr('أبعاد', 'dimensions')}`}
        actions={<>
          <Select aria-label={tr('من', 'From')} options={pointOptions} value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
          <span className="muted">→</span>
          <Select aria-label={tr('إلى', 'To')} options={pointOptions} value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
          {can('assessments.create') && <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setRecord(true)}>{tr('تسجيل تقييم نضج', 'Record maturity')}</Button>}
        </>} />
      <CardBody>
        {from === to && <Notice tone="warning">{tr('اختر نقطتي قياس مختلفتين.', 'Choose two different measurement points.')}</Notice>}
        <div className="grid g6" style={{ marginBottom: 12 }}>
          <Kpi label={tr('مقترنون', 'Paired subjects')} value={fmtNumber(cmp.paired)} hint={`${from}: ${cmp.subjects_before} · ${to}: ${cmp.subjects_after}`} />
          <Kpi label={`${tr('المتوسط', 'Mean')} ${from}`} value={fmtNumber(cmp.overall_before, 2)} />
          <Kpi label={`${tr('المتوسط', 'Mean')} ${to}`} value={fmtNumber(cmp.overall_after, 2)} />
          <Kpi label={tr('التغير المُلاحظ', 'Observed change')} value={fmtChange(cmp.overall_change)} tone={cmp.overall_change === null ? undefined : cmp.overall_change > 0 ? 'success' : cmp.overall_change < 0 ? 'danger' : undefined}
            hint={cmp.effect_size !== null ? `d = ${cmp.effect_size}` : undefined} />
          <Kpi label={tr('تحسن / تراجع / ثبات', 'Improved / declined / same')} value={`${cmp.improved} / ${cmp.declined} / ${cmp.unchanged}`} />
          <Kpi label={tr('الثقة', 'Confidence')} value={<Badge tone={conf[0] as 'success' | 'warning' | 'danger'}>{conf[1]}</Badge>} hint={cmp.missing_follow_up ? tr(`${cmp.missing_follow_up} بلا متابعة`, `${cmp.missing_follow_up} missing follow-up`) : undefined} />
        </div>
        <div className="grid g-3-2">
          <div className="stack-sm">
            <span className="small strong">{tr('متوسط الأبعاد للمقترنين', 'Dimension means for paired subjects')}</span>
            <ColumnChart max={Number(framework.scale_max)} categories={cmp.dimensions.map((d) => L(d.name))}
              series={[{ name: from, values: cmp.dimensions.map((d) => d.before), color: '#8CBFBA' }, { name: to, values: cmp.dimensions.map((d) => d.after), color: '#287D78' }]} />
          </div>
          <div className="stack">
            {cmp.distribution.map((d) => (
              <div key={d.point} className="stack-sm">
                <span className="small strong">{tr('توزيع المستويات', 'Level distribution')} · {enumLabel('measurementPoint', d.point)}</span>
                <Distribution levels={d.levels} total={Object.values(d.levels).reduce((a, b) => a + b, 0)} />
              </div>
            ))}
            <div className="stack-sm">
              <span className="small strong">{tr('جودة البيانات', 'Data quality')}</span>
              <span className="small">{tr('متحقق منها', 'Verified')}: {cmp.data_quality.verified_share === null ? '—' : `${Math.round(cmp.data_quality.verified_share * 100)}%`} · {tr('تقييم ذاتي', 'Self-reported')}: {cmp.data_quality.self_reported_share === null ? '—' : `${Math.round(cmp.data_quality.self_reported_share * 100)}%`}</span>
            </div>
          </div>
        </div>
        <div className="stack-sm" style={{ marginTop: 12 }}>
          <span className="small strong">{tr('التفسير', 'Interpretation')}</span>
          <ul className="small" style={{ margin: 0, paddingInlineStart: 18 }}>{cmp.interpretation.map((x, i) => <li key={i}>{L(x)}</li>)}</ul>
        </div>
      </CardBody>
      <CardBody flush>
        <DataTable rows={cmp.per_subject} rowKey={(r) => r.subject_id} searchable pageSize={15} exportName={`${ws.bundle.program.code}-maturity-${from}-${to}`}
          empty={{ title: tr('لا توجد تقييمات نضج لهاتين النقطتين', 'No maturity assessments for these points') }}
          columns={[
            { key: 'subject', header: tr('المستفيد', 'Beneficiary'), value: (r) => ws.benName(r.subject_id) },
            { key: 'before', header: from, align: 'end', sortable: true, value: (r) => r.before },
            { key: 'after', header: to, align: 'end', sortable: true, value: (r) => r.after },
            { key: 'change', header: tr('التغير', 'Change'), align: 'end', sortable: true, value: (r) => r.change,
              render: (r) => (r.change === null ? <Badge tone="warning">{tr('بلا اقتران', 'Unpaired')}</Badge> : <Badge tone={r.change >= 0.25 ? 'success' : r.change <= -0.25 ? 'danger' : 'neutral'}>{fmtChange(r.change)}</Badge>) },
          ]} />
      </CardBody>
      {record && <MaturityAssessModal framework={framework} defaultPoint={from as MeasurementPointKey} onClose={() => setRecord(false)} />}
    </Card>
  );
}

function MaturityAssessModal({ framework, defaultPoint, onClose }: { framework: MaturityFramework; defaultPoint: MeasurementPointKey; onClose: () => void }) {
  const { tr, locale, L, enumLabel, enumOptions, pick } = useI18n();
  const { org } = useOrg();
  const ws = useWorkspace();
  const [ben, setBen] = useState('');
  const [point, setPoint] = useState<MeasurementPointKey>(defaultPoint);
  const [quality, setQuality] = useState<'self_reported' | 'assessor_rated' | 'verified'>('assessor_rated');
  const [notes, setNotes] = useState('');
  const [scores, setScores] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const min = Math.ceil(Number(framework.scale_min)); const max = Math.floor(Number(framework.scale_max));
  const levels = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const existing = ws.bundle.maturityAssessments.find((a) => a.framework_id === framework.id && a.beneficiary_id === ben && a.measurement_point === point);
  const missing = framework.dimensions.filter((d) => scores[d.key] === undefined);
  const submit = async () => {
    if (!ben) { setError({ code: 'invalid', message_ar: 'اختر المستفيد', message_en: 'Select the beneficiary' }); return; }
    if (missing.length) { setError({ code: 'invalid', message_ar: 'قيّم جميع الأبعاد', message_en: 'Rate every dimension' }); return; }
    setBusy(true); setError(null);
    try {
      const enr = ws.bundle.enrollments.find((e) => e.beneficiary_id === ben);
      const row = { dimension_scores: scores, data_quality: quality, notes: notes.trim() || null };
      if (existing?.id) await update<MaturityAssessment>('maturity_assessments', existing.id, row);
      else await insert<MaturityAssessment>('maturity_assessments', { ...row, organization_id: org.id, framework_id: framework.id, program_id: ws.programId, beneficiary_id: ben, cohort_id: enr?.cohort_id ?? null, measurement_point: point });
      await ws.reload(); onClose();
    } catch (e) { setError(errorOf(e)); } finally { setBusy(false); }
  };
  const descriptor = (key: string, v: number) => {
    const d = framework.dimensions.find((x) => x.key === key);
    const lv = d?.levels?.[String(v)];
    if (lv) return L(lv);
    const g = MATURITY_LEVELS.find((m) => m.level === v);
    return g ? `${locale === 'ar' ? g.ar : g.en} — ${locale === 'ar' ? g.desc_ar : g.desc_en}` : '';
  };
  return (
    <Modal open size="wide" title={`${tr('تقييم نضج', 'Maturity assessment')} · ${pick(framework.name, framework.name_en)}`} onClose={onClose}
      footer={<><Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} onClick={() => void submit()}>{existing ? tr('تحديث التقييم', 'Update assessment') : tr('حفظ', 'Save')}</Button></>}>
      {error && <Notice tone="danger">{errText(locale, error)}</Notice>}
      <div className="form-grid">
        <Field label={tr('المستفيد', 'Beneficiary')} required>
          <Select placeholder="—" value={ben} onChange={(e) => {
            setBen(e.target.value);
            const ex = ws.bundle.maturityAssessments.find((a) => a.framework_id === framework.id && a.beneficiary_id === e.target.value && a.measurement_point === point);
            setScores(ex ? { ...ex.dimension_scores } : {});
          }} options={ws.enrolled.map((b) => ({ value: b.id, label: `${b.full_name} · ${b.code}` }))} />
        </Field>
        <Field label={tr('نقطة القياس', 'Measurement point')} required>
          <Select value={point} onChange={(e) => setPoint(e.target.value as MeasurementPointKey)} options={POINTS.map((p) => ({ value: p, label: enumLabel('measurementPoint', p) }))} />
        </Field>
        <Field label={tr('جودة البيانات', 'Data quality')}>
          <Select value={quality} onChange={(e) => setQuality(e.target.value as typeof quality)}
            options={enumOptions('dataQuality').filter((o) => ['self_reported', 'assessor_rated', 'verified'].includes(o.value))} />
        </Field>
        <Field label={tr('ملاحظات', 'Notes')}><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ minHeight: 34 }} /></Field>
      </div>
      {existing && <Notice tone="info">{tr('يوجد تقييم لهذا المستفيد في هذه النقطة؛ الحفظ سيحدثه.', 'An assessment exists for this beneficiary at this point; saving will update it.')}</Notice>}
      {quality === 'self_reported' && <Notice tone="warning">{tr('التقييم الذاتي يضعف قوة الاستنتاج؛ يفضل تقييم مقيّم أو تحقق.', 'Self-reported ratings weaken conclusions; assessor ratings or verification are preferred.')}</Notice>}
      <div className="stack-sm">
        {framework.dimensions.map((d) => (
          <div key={d.key} className="card card-pad stack-sm">
            <div className="row between wrap">
              <b className="small">{pick(d.name_ar, d.name_en)}{framework.weighted && d.weight ? <span className="tiny muted"> · {tr('الوزن', 'weight')} {d.weight}</span> : null}</b>
              <Segmented value={scores[d.key] === undefined ? '' : String(scores[d.key])} onChange={(v) => setScores((s) => ({ ...s, [d.key]: Number(v) }))}
                options={levels.map((l) => ({ value: String(l), label: String(l) }))} />
            </div>
            <span className="tiny muted">{scores[d.key] !== undefined ? descriptor(d.key, scores[d.key]) : tr('اختر المستوى', 'Choose a level')}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
