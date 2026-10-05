// Overview: status, timeline, people, delivery, actions, risks, assessment and
// evidence status, indicator progress, budget, and the expert-system analysis.
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  Activity, AlertTriangle, BrainCircuit, CalendarDays, ClipboardCheck, GraduationCap, ListChecks, Paperclip, Pencil, Plus, Route, ShieldAlert, Target,
  UserMinus, Users, Wallet,
} from 'lucide-react';
import { elapsedShare, evidenceCompleteness, indicatorPerformance, type Insight, type InsightKind, type Severity } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAsync } from '@/hooks/useAsync';
import { useAction } from '@/hooks/useAction';
import { insert, list, rpc, update } from '@/services/db';
import {
  Badge, BarList, Button, Card, CardBody, CardHeader, EmptyState, InsightList, Kpi, Notice, Progress, ScoreRing, StatusBadge, scoreTone,
} from '@/components/ui';
import { RecordFormModal, type FieldSpec } from '@/components/forms/RecordForm';
import type { AiInsight, Program, RiskIssue } from '@/types/db';
import { errText, narrativeLines, pct, tryFunction, type FnResult } from '../../lib';
import { PROGRAM_FIELDS } from '../../programFields';
import { useWorkspace } from '../context';
import { HealthAreas } from '../components/common';
import { Timeline } from '../components/Timeline';
import { journeyProgress } from '../components/journeyModel';

interface AnalysisResponse { health?: { score?: number; grade?: string } | null; narrative?: unknown; generated_by?: string; model?: string | null; persisted?: number | { created?: number } | null }

export default function OverviewTab() {
  const { tr, fmtNumber, fmtDate, fmtMoney, fmtDateTime, enumLabel, pick, locale, L } = useI18n();
  const { can, org } = useOrg();
  const ws = useWorkspace();
  const { bundle, health, base } = ws;
  const p = bundle.program;
  const [editOpen, setEditOpen] = useState(false);
  const [riskOpen, setRiskOpen] = useState<RiskIssue | 'new' | null>(null);
  const [analysis, setAnalysis] = useState<FnResult<AnalysisResponse> | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const persisted = useAsync(() => list<AiInsight>('ai_insights', {
    filters: [['organization_id', 'eq', org.id], ['program_id', 'eq', p.id], ['status', 'eq', 'open']], order: { column: 'created_at' }, pageSize: 50,
  }).then((r) => r.rows), [p.id]);

  const active = bundle.enrollments.filter((e) => !['withdrawn', 'dropped'].includes(e.status));
  const graduated = bundle.enrollments.filter((e) => e.status === 'graduated' || e.status === 'completed').length;
  const withdrawn = bundle.enrollments.length - active.length;
  const now = Date.now();
  const sessionsDone = bundle.sessions.filter((s) => s.status === 'completed').length;
  const upcoming = bundle.sessions.filter((s) => s.status === 'scheduled' && new Date(s.starts_at).getTime() >= now);
  const attendance = health.metrics.attendance_rate;
  const share = elapsedShare(p.start_date, p.end_date);
  const ev = evidenceCompleteness(bundle);
  const openActions = bundle.actions.filter((a) => ['open', 'in_progress'].includes(a.status))
    .sort((a, b) => (a.due_date ?? '9999') .localeCompare(b.due_date ?? '9999'));
  const today = new Date().toISOString().slice(0, 10);
  const openRisks = bundle.risks.filter((r) => r.status !== 'closed').sort((a, b) => b.severity - a.severity);
  const planned = bundle.budgets.reduce((a, b) => a + Number(b.planned_amount), 0);
  const committed = bundle.budgets.reduce((a, b) => a + Number(b.committed_amount), 0);
  const actual = bundle.budgets.reduce((a, b) => a + Number(b.actual_amount), 0);
  const perf = useMemo(() => bundle.indicators.filter((i) => i.status === 'active')
    .map((i) => ({ i, perf: indicatorPerformance(i, bundle.measurements, share) })), [bundle, share]);
  const resultsByPoint = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of bundle.results) m.set(r.measurement_point, (m.get(r.measurement_point) ?? 0) + 1);
    return [...m.entries()].sort();
  }, [bundle.results]);
  const maturityByPoint = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of bundle.maturityAssessments) m.set(r.measurement_point, (m.get(r.measurement_point) ?? 0) + 1);
    return [...m.entries()].sort();
  }, [bundle.maturityAssessments]);

  const saveProgram = async (v: Record<string, unknown>) => { await update<Program>('programs', p.id, v); await ws.reload(); };
  const riskFields: FieldSpec[] = [
    { name: 'kind', label: ['النوع', 'Kind'], type: 'enum', enumGroup: 'riskKind', required: true },
    { name: 'category', label: ['الفئة', 'Category'], type: 'enum', enumGroup: 'riskCategory' },
    { name: 'title', label: ['العنوان', 'Title'], type: 'text', required: true, full: true },
    { name: 'description', label: ['الوصف', 'Description'], type: 'textarea' },
    { name: 'likelihood', label: ['الاحتمالية (1–5)', 'Likelihood (1–5)'], type: 'number', min: 1, max: 5, step: 1 },
    { name: 'impact', label: ['الأثر (1–5)', 'Impact (1–5)'], type: 'number', min: 1, max: 5, step: 1 },
    { name: 'mitigation', label: ['خطة المعالجة', 'Mitigation'], type: 'textarea', hint: ['الخطر المرتفع (≥15) دون معالجة يُرصد كملاحظة عالية', 'A high risk (≥15) without mitigation is flagged as a high finding'] },
    { name: 'due_date', label: ['موعد المعالجة', 'Treatment due'], type: 'date' },
    { name: 'status', label: ['الحالة', 'Status'], type: 'enum', enumGroup: 'riskStatus', required: true },
  ];
  const saveRisk = async (v: Record<string, unknown>) => {
    if (riskOpen && riskOpen !== 'new') await update<RiskIssue>('risks_issues', riskOpen.id, v);
    else await insert<RiskIssue>('risks_issues', { ...v, organization_id: org.id, program_id: p.id, source: 'manual' });
    await ws.reload();
  };

  const runAnalysis = async () => {
    setAnalyzing(true);
    const r = await tryFunction<AnalysisResponse>('ai-program-analysis', { mode: 'analyze', organization_id: org.id, program_id: p.id, persist: true, locale });
    setAnalysis(r); setAnalyzing(false);
    if (r.ok) await persisted.reload();
  };
  const decide = useAction(async (id: string, decision: 'accepted' | 'dismissed') => {
    await rpc('decide_insight', { p_id: id, p_decision: decision, p_note: null });
    await persisted.reload();
  }, { success: ['تم تسجيل القرار', 'Decision recorded'] });

  const persistedInsights: Insight[] = (persisted.data ?? []).map((r) => ({
    rule_code: r.rule_code ?? r.generated_by, kind: r.kind as InsightKind, severity: r.severity as Severity, area: 'setup',
    title: { ar: r.title, en: r.title }, rationale: { ar: r.rationale, en: r.rationale },
    recommended_action: { ar: r.recommended_action ?? '—', en: r.recommended_action ?? '—' }, source_data: r.source_data, fingerprint: r.id,
  }));

  return (
    <div className="stack">
      <div className="grid g6">
        <Kpi label={tr('المسجلون / المستهدف', 'Enrolled / target')} icon={<Users />} value={`${fmtNumber(active.length)} / ${fmtNumber(p.target_beneficiaries)}`}
          hint={p.target_beneficiaries ? `${pct(active.length, p.target_beneficiaries)}%` : tr('لا يوجد مستهدف', 'No target set')} />
        <Kpi label={tr('أكملوا / تخرجوا', 'Completed / graduated')} icon={<GraduationCap />} value={fmtNumber(graduated)} />
        <Kpi label={tr('منسحبون / متسربون', 'Withdrawn / dropped')} icon={<UserMinus />} value={fmtNumber(withdrawn)} tone={withdrawn && bundle.enrollments.length && withdrawn / bundle.enrollments.length > 0.2 ? 'warning' : undefined} />
        <Kpi label={tr('الجلسات المنفذة / القادمة', 'Sessions done / upcoming')} icon={<CalendarDays />} value={`${fmtNumber(sessionsDone)} / ${fmtNumber(upcoming.length)}`} />
        <Kpi label={tr('نسبة الحضور', 'Attendance rate')} icon={<ListChecks />} value={attendance === null || attendance === undefined ? '—' : `${fmtNumber(attendance, 1)}%`}
          tone={attendance !== null && attendance !== undefined ? (attendance < 60 ? 'danger' : attendance < 75 ? 'warning' : 'success') : undefined} />
        <Kpi label={tr('تقدم الرحلة', 'Journey progress')} icon={<Route />} value={`${journeyProgress(bundle.stages)}%`}
          hint={share !== null ? `${tr('مضى من المدة', 'Time elapsed')} ${Math.round(share * 100)}%` : undefined} />
      </div>

      <div className="grid g-2-1">
        <Card>
          <CardHeader icon={<BrainCircuit />} title={tr('التحليل والإجراءات التالية الموصى بها', 'Analysis & recommended next actions')}
            hint={tr('قواعد المحرك محسوبة مباشرة من بيانات البرنامج', 'Engine rules computed live from program data')}
            actions={<Button size="sm" icon={<Activity />} loading={analyzing} onClick={() => void runAnalysis()}>{tr('تشغيل التحليل على الخادم', 'Run server analysis')}</Button>} />
          {analysis && (
            <CardBody>
              {analysis.ok ? (
                <div className="stack-sm">
                  <div className="row wrap">
                    <Badge tone="success">{tr('اكتمل التحليل على الخادم', 'Server analysis complete')}</Badge>
                    <Badge tone="outline">{analysis.data.generated_by === 'rules+llm' || analysis.data.generated_by === 'llm' ? tr('قواعد + نموذج لغوي', 'Rules + LLM') : tr('قواعد', 'Rules')}</Badge>
                    {analysis.data.model && <span className="tiny muted mono">{analysis.data.model}</span>}
                  </div>
                  {narrativeLines(analysis.data.narrative, locale).map((line, i) => <p key={i} className="small">{line}</p>)}
                  {!narrativeLines(analysis.data.narrative, locale).length && <p className="small muted">{tr('لم يُرجع الخادم سردًا نصيًا (نموذج لغوي غير مهيأ)؛ النتائج أدناه من القواعد.', 'The server returned no narrative (LLM not configured); findings below come from rules.')}</p>}
                </div>
              ) : (
                <Notice tone={analysis.unavailable ? 'warning' : 'danger'}>
                  {analysis.unavailable
                    ? tr('خدمة التحليل على الخادم غير منشورة حاليًا. التحليل أدناه محسوب في المتصفح بنفس محرك القواعد.', 'The server analysis service is not deployed. The analysis below is computed in the browser with the same rules engine.')
                    : errText(locale, analysis.error)}
                </Notice>
              )}
            </CardBody>
          )}
          <CardBody flush>
            <InsightList insights={health.insights} linkBase={base} max={10} />
          </CardBody>
          {health.insights.length > 10 && <div className="card-foot"><span className="small muted">{tr(`يُعرض أهم 10 من ${health.insights.length} ملاحظة؛ البقية في التبويبات المعنية.`, `Showing the top 10 of ${health.insights.length}; the rest appear in the relevant tabs.`)}</span></div>}
        </Card>

        <div className="stack">
          <Card>
            <CardHeader icon={<Activity />} title={tr('صحة البرنامج', 'Program health')} hint={tr('محسوبة في المتصفح', 'Computed in browser')} />
            <CardBody>
              <div className="row" style={{ gap: 14, marginBottom: 10 }}>
                <ScoreRing value={health.score} tone={scoreTone(health.score)} />
                <div className="stack-sm" style={{ gap: 2 }}>
                  <b>{health.grade === 'good' ? tr('جيدة', 'Good') : health.grade === 'watch' ? tr('تحت المراقبة', 'Watch') : health.grade === 'at_risk' ? tr('معرضة للخطر', 'At risk') : tr('حرجة', 'Critical')}</b>
                  <span className="small muted">{tr('الدرجة تنخفض بحسب شدة الملاحظات المفتوحة', 'The score drops with the severity of open findings')}</span>
                </div>
              </div>
              <HealthAreas />
            </CardBody>
          </Card>
          <Card>
            <CardHeader icon={<ShieldAlert />} title={tr('ملاحظات محفوظة على الخادم', 'Persisted insights')} hint={tr('اقبل أو استبعد بعد المراجعة', 'Accept or dismiss after review')} />
            <CardBody flush>
              {persisted.error ? <Notice tone="danger">{errText(locale, persisted.error)}</Notice>
                : <InsightList insights={persistedInsights} onDecide={can('programs.edit') ? (i, d) => void decide.run(i.fingerprint, d) : undefined}
                  emptyTitle={tr('لا توجد ملاحظات محفوظة مفتوحة. شغّل التحليل على الخادم لحفظها ومتابعتها.', 'No open persisted insights. Run the server analysis to store and track them.')} />}
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="grid g2">
        <Card>
          <CardHeader title={tr('بيانات البرنامج', 'Program information')}
            actions={can('programs.edit') ? <Button size="sm" icon={<Pencil />} onClick={() => setEditOpen(true)}>{tr('تعديل', 'Edit')}</Button> : undefined} />
          <CardBody>
            <dl className="kv">
              <dt>{tr('الرمز', 'Code')}</dt><dd className="mono">{p.code}</dd>
              <dt>{tr('المسار', 'Track')}</dt><dd>{enumLabel('track', p.track_code)}</dd>
              <dt>{tr('الحالة', 'Status')}</dt><dd><StatusBadge group="programStatus" value={p.status} /></dd>
              <dt>{tr('المدة', 'Period')}</dt><dd>{fmtDate(p.start_date)} – {fmtDate(p.end_date)}</dd>
              <dt>{tr('طريقة التنفيذ', 'Delivery')}</dt><dd>{enumLabel('deliveryMode', p.delivery_mode)}</dd>
              <dt>{tr('المنطقة', 'Region')}</dt><dd>{p.region ?? '—'}</dd>
              <dt>{tr('الراعي', 'Sponsor')}</dt><dd>{bundle.sponsorName ?? '—'}</dd>
              <dt>{tr('الميزانية', 'Budget')}</dt><dd>{fmtMoney(p.budget_total, p.currency)}</dd>
              <dt>{tr('الأهداف', 'Objectives')}</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{p.objectives ?? '—'}</dd>
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<CalendarDays />} title={tr('الخط الزمني', 'Timeline')} hint={tr('مدة البرنامج والتواريخ المخططة للمراحل', 'Program period and stage planned dates')} />
          <CardBody><Timeline program={p} stages={bundle.stages} /></CardBody>
        </Card>
      </div>

      <div className="grid g3">
        <Card>
          <CardHeader icon={<Users />} title={tr('الدفعات', 'Cohorts')} actions={<Link className="small" to={`${base}/participants`}>{tr('إدارة', 'Manage')}</Link>} />
          <CardBody>
            {bundle.cohorts.length === 0 ? <p className="small muted">{tr('لا توجد دفعات.', 'No cohorts.')}</p> : (
              <ul className="list-plain">
                {bundle.cohorts.map((c) => {
                  const n = active.filter((e) => e.cohort_id === c.id).length;
                  const over = c.capacity !== null && n > c.capacity;
                  return (
                    <li key={c.id} className="stack-sm" style={{ gap: 3 }}>
                      <div className="row between"><span className="small strong">{c.name}</span><StatusBadge group="cohortStatus" value={c.status} /></div>
                      <div className="row"><Progress value={c.capacity ? (n / c.capacity) * 100 : 0} tone={over ? 'danger' : undefined} /><span className="tiny nowrap">{n} / {c.capacity ?? '—'}</span></div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<CalendarDays />} title={tr('التنفيذ', 'Delivery')} actions={<Link className="small" to={`${base}/delivery`}>{tr('الجلسات', 'Sessions')}</Link>} />
          <CardBody>
            <div className="row between small"><span>{tr('منفذة', 'Completed')}</span><b>{sessionsDone}</b></div>
            <div className="row between small"><span>{tr('قادمة', 'Upcoming')}</span><b>{upcoming.length}</b></div>
            <div className="row between small"><span>{tr('ملغاة', 'Cancelled')}</span><b>{bundle.sessions.filter((s) => s.status === 'cancelled').length}</b></div>
            <div className="divider" />
            {upcoming.slice(0, 4).map((s) => (
              <div key={s.id} className="row between small"><span className="ellipsis">{s.title}</span><span className="muted nowrap">{fmtDateTime(s.starts_at)}</span></div>
            ))}
            {!upcoming.length && <p className="small muted">{tr('لا توجد جلسات قادمة.', 'No upcoming sessions.')}</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<ListChecks />} title={tr('الإجراءات القادمة', 'Upcoming actions')} actions={<Link className="small" to={`${base}/delivery`}>{tr('الكل', 'All')}</Link>} />
          <CardBody>
            {openActions.length === 0 ? <p className="small muted">{tr('لا توجد إجراءات مفتوحة.', 'No open actions.')}</p> : (
              <ul className="list-plain">
                {openActions.slice(0, 6).map((a) => (
                  <li key={a.id} className="row between small">
                    <span className="ellipsis">{a.title}{a.owner_name ? <span className="muted"> · {a.owner_name}</span> : null}</span>
                    <span className="row nowrap" style={{ gap: 4 }}>
                      {a.due_date && a.due_date < today ? <Badge tone="danger">{tr('متأخر', 'Overdue')}</Badge> : null}
                      <span className="muted">{fmtDate(a.due_date)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid g2">
        <Card>
          <CardHeader icon={<AlertTriangle />} title={tr('المخاطر والقضايا', 'Risks & issues')} hint={`${openRisks.length} ${tr('مفتوحة', 'open')}`}
            actions={can('governance.create') ? <Button size="sm" icon={<Plus />} onClick={() => setRiskOpen('new')}>{tr('خطر / قضية', 'Risk / issue')}</Button> : undefined} />
          <CardBody flush>
            {openRisks.length === 0 ? <EmptyState compact title={tr('لا توجد مخاطر مفتوحة مسجلة', 'No open risks recorded')} /> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>{tr('الرمز', 'Code')}</th><th>{tr('العنوان', 'Title')}</th><th>{tr('الخطورة', 'Severity')}</th><th>{tr('الحالة', 'Status')}</th><th>{tr('الموعد', 'Due')}</th></tr></thead>
                  <tbody>
                    {openRisks.slice(0, 8).map((r) => (
                      <tr key={r.id} className={can('governance.edit') ? 'clickable' : undefined} onClick={can('governance.edit') ? () => setRiskOpen(r) : undefined}>
                        <td className="mono">{r.code}</td>
                        <td><span>{r.title}</span><span className="sub">{enumLabel('riskKind', r.kind)}{r.category ? ` · ${enumLabel('riskCategory', r.category)}` : ''}{!r.mitigation ? ` · ${tr('بلا معالجة', 'no mitigation')}` : ''}</span></td>
                        <td><Badge tone={r.severity >= 15 ? 'danger' : r.severity >= 8 ? 'warning' : 'info'}>{r.severity}/25</Badge></td>
                        <td><StatusBadge group="riskStatus" value={r.status} /></td>
                        <td>{r.due_date && r.due_date < today ? <Badge tone="danger">{fmtDate(r.due_date)}</Badge> : fmtDate(r.due_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<Target />} title={tr('تقدم النتائج والأثر', 'Outcome & impact progress')} actions={<Link className="small" to={`${base}/impact`}>{tr('المؤشرات', 'Indicators')}</Link>} />
          <CardBody>
            {perf.length === 0 ? <p className="small muted">{tr('لا توجد مؤشرات نشطة.', 'No active indicators.')}</p> : (
              <div className="stack-sm">
                {perf.slice(0, 8).map(({ i, perf: pf }) => (
                  <div key={i.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 90px 92px', gap: 8, alignItems: 'center' }}>
                    <span className="small ellipsis" title={pick(i.name, i.name_en)}><Badge tone="outline">{enumLabel('indicatorType', i.indicator_type)}</Badge> {pick(i.name, i.name_en)}</span>
                    <Progress value={pf.progress_pct ?? 0} tone={pf.status === 'off_track' ? 'danger' : pf.status === 'at_risk' ? 'warning' : pf.status === 'achieved' ? 'success' : undefined} />
                    <StatusBadge group="indicatorStatus" value={pf.status} />
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid g3">
        <Card>
          <CardHeader icon={<ClipboardCheck />} title={tr('حالة التقييم', 'Assessment status')} actions={<Link className="small" to={`${base}/assessments`}>{tr('التفاصيل', 'Details')}</Link>} />
          <CardBody>
            <div className="row between small"><span>{tr('نتائج الأدوات', 'Tool results')}</span><b>{bundle.results.length}</b></div>
            {resultsByPoint.map(([k, n]) => <div key={k} className="row between tiny muted"><span>{enumLabel('measurementPoint', k)}</span><span>{n}</span></div>)}
            <div className="divider" />
            <div className="row between small"><span>{tr('تقييمات النضج', 'Maturity assessments')}</span><b>{bundle.maturityAssessments.length}</b></div>
            {maturityByPoint.map(([k, n]) => <div key={k} className="row between tiny muted"><span>{enumLabel('measurementPoint', k)}</span><span>{n}</span></div>)}
            {!bundle.maturityFrameworks.length && <p className="tiny muted">{tr('لا يوجد إطار نضج مرتبط.', 'No maturity framework linked.')}</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<Paperclip />} title={tr('اكتمال الأدلة', 'Evidence completeness')} actions={<Link className="small" to={`${base}/evidence`}>{tr('السجل', 'Registry')}</Link>} />
          <CardBody>
            <div className="row" style={{ marginBottom: 8 }}><Progress large value={ev.score} tone={scoreTone(ev.score)} /><b>{ev.score}%</b></div>
            <p className="tiny muted">{tr(`${ev.satisfied} من ${ev.required} متطلبًا مستوفى`, `${ev.satisfied} of ${ev.required} requirements satisfied`)}{ev.verified_share !== null ? ` · ${tr('متحقق منه', 'verified')} ${Math.round(ev.verified_share * 100)}%` : ''}</p>
            <ul className="list-plain small">{ev.missing.slice(0, 4).map((m) => <li key={m.key}>{L(m.label)}</li>)}</ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<Wallet />} title={tr('ملخص الميزانية', 'Budget summary')} actions={<Link className="small" to={`${base}/finance`}>{tr('المالية', 'Finance')}</Link>} />
          <CardBody>
            {planned === 0 && !p.budget_total ? <p className="small muted">{tr('لا توجد ميزانية مسجلة.', 'No budget recorded.')}</p> : (
              <BarList format={(v) => fmtMoney(v, p.currency)} max={Math.max(planned, Number(p.budget_total ?? 0), actual + committed, 1)} items={[
                { label: tr('الإجمالي المعتمد', 'Approved total'), value: Number(p.budget_total ?? 0) },
                { label: tr('مخطط (البنود)', 'Planned (lines)'), value: planned },
                { label: tr('ملتزم به', 'Committed'), value: committed, tone: planned && committed + actual > planned ? 'warning' : undefined },
                { label: tr('فعلي', 'Actual'), value: actual, tone: planned && actual > planned ? 'danger' : undefined },
              ]} />
            )}
          </CardBody>
        </Card>
      </div>

      <RecordFormModal open={editOpen} onClose={() => setEditOpen(false)} title={tr('تعديل بيانات البرنامج', 'Edit program')} fields={PROGRAM_FIELDS} size="wide"
        initial={{ name: p.name, name_en: p.name_en, start_date: p.start_date, end_date: p.end_date, target_beneficiaries: p.target_beneficiaries, budget_total: p.budget_total,
          region: p.region, delivery_mode: p.delivery_mode, sponsor_partner_id: p.sponsor_partner_id, description: p.description, objectives: p.objectives }}
        onSubmit={saveProgram} />
      <RecordFormModal open={!!riskOpen} onClose={() => setRiskOpen(null)} title={riskOpen === 'new' ? tr('تسجيل خطر / قضية', 'Record risk / issue') : tr('تعديل الخطر', 'Edit risk')}
        fields={riskFields} onSubmit={saveRisk}
        initial={riskOpen && riskOpen !== 'new' ? { ...riskOpen } : { kind: 'risk', status: 'open', likelihood: 3, impact: 3 }} />
    </div>
  );
}
