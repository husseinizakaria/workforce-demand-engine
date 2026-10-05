// Executive dashboard (organization KPIs, portfolio health, attention list,
// delivery vs outcomes) and a personal view for beneficiary / expert users.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  Activity, AlertTriangle, CalendarDays, CheckCircle2, ClipboardCheck, FileCheck2, FolderKanban, GraduationCap, Lightbulb, ListChecks,
  ShieldAlert, Target, UserRoundCog, Users, Wallet,
} from 'lucide-react';
import {
  SEVERITY_ORDER, elapsedShare, indicatorPerformance, programHealth, type HealthReport, type Insight, type InsightKind,
} from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAuth } from '@/app/AuthProvider';
import {
  AsyncView, Badge, Card, CardBody, CardHeader, DataTable, ErrorState, InsightList, Kpi, Loading, Notice, PageHeader, Progress,
  scoreTone, toneOf, useToast, type Column,
} from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { all, list, rpc } from '@/services/db';
import { errorOf } from '@/services/errors';
import { loadProgramBundle } from '@/services/programBundle';
import type { AiInsight, ApprovalRequest, Indicator, IndicatorMeasurement, Program, ProgramOutcome, ProgramOutput, Session } from '@/types/db';
import { PersonalDashboard } from '../components/PersonalDashboard';

interface OrgKpis {
  programs_total: number; programs_active: number; beneficiaries: number; enrollments_active: number; graduates: number; experts: number;
  sessions_upcoming: number; sessions_completed: number; attendance_rate: number | null; evidence_total: number; evidence_verified: number;
  evidence_pending: number; approvals_pending: number; risks_open: number; risks_high: number; actions_overdue: number; insights_open: number;
  budget_planned: number; budget_actual: number;
}

export default function DashboardPage() {
  const { can } = useOrg();
  return can('programs.view') ? <ExecutiveDashboard /> : <PersonalDashboard />;
}

const GRADE: Record<HealthReport['grade'], [string, string, 'success' | 'warning' | 'danger' | 'info']> = {
  good: ['جيد', 'Good', 'success'], watch: ['يحتاج متابعة', 'Watch', 'info'], at_risk: ['معرض للخطر', 'At risk', 'warning'], critical: ['حرج', 'Critical', 'danger'],
};

function ExecutiveDashboard() {
  const { tr, pick } = useI18n();
  const { org } = useOrg();
  return (
    <div className="stack">
      <PageHeader title={tr('لوحة القيادة التنفيذية', 'Executive dashboard')} subtitle={tr(`نظرة شاملة على محفظة برامج ${pick(org.name, org.name_en)}: التنفيذ والنتائج والمخاطر وما يحتاج قرارًا.`, `Portfolio overview for ${pick(org.name, org.name_en)}: delivery, results, risks and what needs a decision.`)} />
      <KpiTiles />
      <Portfolio />
      <div className="grid g2">
        <PersistedInsights />
        <PendingApprovals />
      </div>
      <div className="grid g2">
        <UpcomingSessions />
        <DeliveryVsOutcomes />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- KPIs
function KpiTiles() {
  const { tr, fmtNumber, fmtMoney } = useI18n();
  const { org, hasModule } = useOrg();
  const state = useAsync(() => rpc<OrgKpis>('org_dashboard', { p_org: org.id }), [org.id]);
  return (
    <AsyncView state={state} rows={2}>
      {(k) => {
        const n = (v: unknown) => Number(v ?? 0);
        const evPct = n(k.evidence_total) ? Math.round((n(k.evidence_verified) / n(k.evidence_total)) * 100) : null;
        const burn = n(k.budget_planned) ? Math.round((n(k.budget_actual) / n(k.budget_planned)) * 100) : null;
        const tiles: (ReactNode | false)[] = [
          hasModule('programs') && <Kpi key="p" icon={<FolderKanban />} label={tr('البرامج النشطة', 'Active programs')} value={`${fmtNumber(n(k.programs_active))} / ${fmtNumber(n(k.programs_total))}`} hint={tr('نشط / الإجمالي', 'active / total')} />,
          hasModule('beneficiaries') && <Kpi key="b" icon={<Users />} label={tr('المستفيدون النشطون', 'Active beneficiaries')} value={fmtNumber(n(k.beneficiaries))} />,
          hasModule('programs') && <Kpi key="e" icon={<ListChecks />} label={tr('التحاقات نشطة', 'Active enrollments')} value={fmtNumber(n(k.enrollments_active))} />,
          hasModule('programs') && <Kpi key="g" icon={<GraduationCap />} label={tr('الخريجون / المكملون', 'Graduates / completers')} value={fmtNumber(n(k.graduates))} />,
          hasModule('experts') && <Kpi key="x" icon={<UserRoundCog />} label={tr('الخبراء النشطون', 'Active experts')} value={fmtNumber(n(k.experts))} />,
          hasModule('operations') && <Kpi key="s" icon={<CalendarDays />} label={tr('الجلسات', 'Sessions')} value={`${fmtNumber(n(k.sessions_upcoming))} / ${fmtNumber(n(k.sessions_completed))}`} hint={tr('قادمة / مكتملة', 'upcoming / completed')} />,
          hasModule('operations') && <Kpi key="a" icon={<CheckCircle2 />} label={tr('نسبة الحضور', 'Attendance rate')} value={k.attendance_rate === null ? '—' : `${fmtNumber(Number(k.attendance_rate), 1)}%`}
            tone={k.attendance_rate === null ? undefined : Number(k.attendance_rate) < 70 ? 'warning' : 'success'} hint={k.attendance_rate === null ? tr('لا توجد بيانات حضور مسجلة', 'No attendance recorded') : undefined} />,
          hasModule('evidence') && <Kpi key="v" icon={<FileCheck2 />} label={tr('الأدلة المتحقق منها', 'Evidence verified')} value={evPct === null ? '—' : `${evPct}%`}
            hint={tr(`${fmtNumber(n(k.evidence_verified))} من ${fmtNumber(n(k.evidence_total))} · ${fmtNumber(n(k.evidence_pending))} بانتظار التحقق`, `${fmtNumber(n(k.evidence_verified))} of ${fmtNumber(n(k.evidence_total))} · ${fmtNumber(n(k.evidence_pending))} pending`)}
            tone={evPct !== null && evPct < 50 ? 'warning' : undefined} />,
          hasModule('governance') && <Kpi key="ap" icon={<ClipboardCheck />} label={tr('اعتمادات معلقة', 'Approvals pending')} value={fmtNumber(n(k.approvals_pending))} tone={n(k.approvals_pending) ? 'warning' : undefined} />,
          hasModule('governance') && <Kpi key="r" icon={<ShieldAlert />} label={tr('المخاطر المفتوحة', 'Open risks')} value={`${fmtNumber(n(k.risks_open))}`} hint={tr(`${fmtNumber(n(k.risks_high))} عالية الخطورة (≥15)`, `${fmtNumber(n(k.risks_high))} high severity (≥15)`)} tone={n(k.risks_high) ? 'danger' : undefined} />,
          hasModule('operations') && <Kpi key="o" icon={<AlertTriangle />} label={tr('إجراءات متأخرة', 'Overdue actions')} value={fmtNumber(n(k.actions_overdue))} tone={n(k.actions_overdue) ? 'danger' : undefined} />,
          hasModule('programs') && <Kpi key="i" icon={<Lightbulb />} label={tr('ملاحظات مفتوحة', 'Open insights')} value={fmtNumber(n(k.insights_open))} hint={tr('من فحص صحة البرامج', 'from program health checks')} />,
          hasModule('governance') && <Kpi key="bu" icon={<Wallet />} label={tr('الميزانية: الفعلي / المخطط', 'Budget: actual / planned')} value={fmtMoney(n(k.budget_actual))}
            hint={`${tr('المخطط', 'Planned')} ${fmtMoney(n(k.budget_planned))}${burn !== null ? ` · ${burn}%` : ''}`} tone={burn !== null && burn > 100 ? 'danger' : undefined} />,
        ];
        const visible = tiles.filter(Boolean);
        return visible.length ? <div className="grid g4">{visible}</div> : null;
      }}
    </AsyncView>
  );
}

// ----------------------------------------------------------------------------- Portfolio
type PRow = { program: Program; state: 'loading' | 'done' | 'error'; health?: HealthReport; error?: string };
const HEALTH_LIMIT = 8;

function Portfolio() {
  const { tr, pick, L, enumLabel, fmtDate, fmtNumber, locale } = useI18n();
  const { org } = useOrg();
  const progs = useAsync(() => list<Program>('programs', {
    filters: [['organization_id', 'eq', org.id], ['status', 'eq', 'active']], order: [{ column: 'end_date', ascending: true }], pageSize: 200, count: true,
  }), [org.id]);
  const [rows, setRows] = useState<Record<string, PRow>>({});

  useEffect(() => {
    const ps = progs.data?.rows.slice(0, HEALTH_LIMIT) ?? [];
    if (!ps.length) { setRows({}); return; }
    let alive = true;
    setRows(Object.fromEntries(ps.map((p) => [p.id, { program: p, state: 'loading' as const }])));
    (async () => {
      for (const p of ps) {
        try {
          const b = await loadProgramBundle(p.id);
          const h = programHealth(b);
          if (alive) setRows((r) => ({ ...r, [p.id]: { program: b.program, state: 'done', health: h } }));
        } catch (e) {
          const ae = errorOf(e);
          if (alive) setRows((r) => ({ ...r, [p.id]: { program: p, state: 'error', error: locale === 'ar' ? ae.message_ar : ae.message_en } }));
        }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progs.data]);

  const sorted = useMemo(() => Object.values(rows).sort((a, b) => {
    const sa = a.health?.score ?? 1000; const sb = b.health?.score ?? 1000;
    return sa - sb;
  }), [rows]);

  const attention = useMemo(() => {
    const items: { p: Program; i: Insight }[] = [];
    for (const r of sorted) for (const i of r.health?.next_actions ?? []) if (i.severity !== 'info') items.push({ p: r.program, i });
    items.sort((a, b) => SEVERITY_ORDER[b.i.severity] - SEVERITY_ORDER[a.i.severity]);
    const top = items.slice(0, 12);
    const groups = new Map<string, { p: Program; insights: Insight[] }>();
    for (const x of top) {
      const g = groups.get(x.p.id) ?? { p: x.p, insights: [] };
      g.insights.push(x.i); groups.set(x.p.id, g);
    }
    return [...groups.values()];
  }, [sorted]);

  const total = progs.data?.total ?? progs.data?.rows.length ?? 0;
  const columns: Column<PRow>[] = [
    { key: 'name', header: tr('البرنامج', 'Program'), value: (r) => pick(r.program.name, r.program.name_en),
      render: (r) => <div className="stack-sm" style={{ gap: 2 }}><Link to={`/app/programs/${r.program.id}`}><b>{pick(r.program.name, r.program.name_en)}</b></Link><span className="tiny muted mono">{r.program.code}</span></div> },
    { key: 'track', header: tr('المسار', 'Track'), value: (r) => enumLabel('track', r.program.track_code) },
    { key: 'dates', header: tr('الفترة', 'Period'), value: (r) => r.program.start_date, render: (r) => <span className="small nowrap">{fmtDate(r.program.start_date)} – {fmtDate(r.program.end_date)}</span> },
    { key: 'elapsed', header: tr('المنقضي', 'Elapsed'), value: (r) => elapsedShare(r.program.start_date, r.program.end_date),
      render: (r) => { const s = elapsedShare(r.program.start_date, r.program.end_date); return s === null ? <span className="muted">—</span> : <div style={{ minWidth: 80 }}><Progress value={s * 100} /><span className="tiny muted">{Math.round(s * 100)}%</span></div>; } },
    { key: 'journey', header: tr('الرحلة', 'Journey'), value: (r) => r.health?.metrics.stages_completed ?? null,
      render: (r) => r.state !== 'done' ? <RowState r={r} /> : <span className="small">{fmtNumber(r.health!.metrics.stages_completed)}/{fmtNumber(r.health!.metrics.stages_total)}</span> },
    { key: 'enrolled', header: tr('المسجلون / المستهدف', 'Enrolled / target'), value: (r) => r.health?.metrics.enrolled ?? null,
      render: (r) => r.state !== 'done' ? <RowState r={r} /> : <span className="small">{fmtNumber(r.health!.metrics.enrolled)} / {r.program.target_beneficiaries === null ? '—' : fmtNumber(r.program.target_beneficiaries)}</span> },
    { key: 'health', header: tr('الصحة', 'Health'), value: (r) => r.health?.score ?? null,
      render: (r) => r.state !== 'done' ? <RowState r={r} /> : (
        <div className="row" style={{ gap: 6 }}>
          <Badge tone={scoreTone(r.health!.score) ?? 'neutral'}>{r.health!.score}/100</Badge>
          <Badge tone={GRADE[r.health!.grade][2]}>{tr(GRADE[r.health!.grade][0], GRADE[r.health!.grade][1])}</Badge>
        </div>
      ) },
    { key: 'finding', header: tr('أبرز ملاحظة', 'Top finding'), value: (r) => (r.health?.insights[0] ? L(r.health.insights[0].title) : ''),
      render: (r) => r.state !== 'done' ? <RowState r={r} /> : r.health!.insights[0]
        ? <span className="row start small" style={{ gap: 6 }}><Badge tone={toneOf(r.health!.insights[0].severity)}>{enumLabel('severity', r.health!.insights[0].severity)}</Badge><span>{L(r.health!.insights[0].title)}</span></span>
        : <span className="small muted">{tr('لا ملاحظات', 'No findings')}</span> },
  ];

  return (
    <>
      <Card>
        <CardHeader title={tr('محفظة البرامج النشطة', 'Active program portfolio')} icon={<Activity />}
          hint={tr('الصحة محسوبة مباشرة بمحرك القواعد في المتصفح؛ الأسوأ أولًا', 'Health computed live by the rules engine in the browser; worst first')}
          actions={<Link className="small" to="/app/programs">{tr('كل البرامج', 'All programs')}</Link>} />
        <CardBody flush>
          {progs.error ? <ErrorState error={progs.error} onRetry={progs.reload} compact /> : progs.loading && !progs.data ? <Loading /> : (
            <>
              <DataTable columns={columns} rows={sorted} rowKey={(r) => r.program.id} exportName="portfolio-health"
                empty={{ title: tr('لا توجد برامج نشطة', 'No active programs'), description: tr('عند تفعيل برنامج ستظهر صحته هنا.', 'Once a program is active its health appears here.') }} />
              {total > HEALTH_LIMIT && <p className="tiny muted" style={{ padding: '6px 14px' }}>{tr(`يعرض أول ${HEALTH_LIMIT} من ${total} برنامجًا نشطًا (الأقرب انتهاءً).`, `Showing the first ${HEALTH_LIMIT} of ${total} active programs (ending soonest).`)}</p>}
            </>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={tr('يحتاج انتباهك', 'Needs attention')} icon={<AlertTriangle />} hint={tr('أهم الملاحظات عبر البرامج مع المبررات والإجراء المقترح — توصيات لا قرارات تلقائية', 'Top findings across programs with rationale and recommended action — recommendations, not automatic decisions')} />
        <CardBody>
          {Object.values(rows).some((r) => r.state === 'loading') && !attention.length ? <Loading rows={3} /> : !attention.length
            ? <InsightList insights={[]} />
            : (
              <div className="stack">
                {attention.map((g) => (
                  <div key={g.p.id} className="stack-sm">
                    <div className="row between"><Link to={`/app/programs/${g.p.id}`}><b>{pick(g.p.name, g.p.name_en)}</b></Link><span className="tiny muted mono">{g.p.code}</span></div>
                    <InsightList insights={g.insights} linkBase={`/app/programs/${g.p.id}`} />
                  </div>
                ))}
              </div>
            )}
        </CardBody>
      </Card>
    </>
  );
}

function RowState({ r }: { r: PRow }) {
  const { tr } = useI18n();
  if (r.state === 'loading') return <span className="skeleton" style={{ display: 'inline-block', width: 60, height: 12 }} aria-label={tr('جارٍ الحساب', 'Computing')} />;
  return <span className="tiny" style={{ color: 'var(--danger)' }} title={r.error}>{tr('تعذر الحساب', 'Could not compute')}</span>;
}

// ----------------------------------------------------------------------------- Persisted insights
function PersistedInsights() {
  const { tr } = useI18n();
  const { org, can } = useOrg();
  const toast = useToast();
  const { locale } = useI18n();
  const state = useAsync(() => list<AiInsight>('ai_insights', {
    filters: [['organization_id', 'eq', org.id], ['status', 'eq', 'open']], order: { column: 'created_at' }, pageSize: 30,
  }), [org.id]);
  const insights = useMemo(() => (state.data?.rows ?? []).map<Insight>((a) => ({
    rule_code: a.rule_code ?? a.generated_by, kind: a.kind as InsightKind, severity: a.severity, area: 'setup',
    title: { ar: a.title, en: a.title }, rationale: { ar: a.rationale, en: a.rationale },
    recommended_action: { ar: a.recommended_action ?? '', en: a.recommended_action ?? '' }, source_data: a.source_data, fingerprint: a.id,
    link: a.program_id ? `${a.program_id}/overview` : undefined,
  })).sort((x, y) => SEVERITY_ORDER[y.severity] - SEVERITY_ORDER[x.severity]), [state.data]);

  const decide = async (i: Insight, decision: 'accepted' | 'dismissed') => {
    try {
      await rpc('decide_insight', { p_id: i.fingerprint, p_decision: decision, p_note: null });
      toast.success(decision === 'accepted' ? tr('تم قبول الملاحظة', 'Insight accepted') : tr('تم استبعاد الملاحظة', 'Insight dismissed'));
      state.setData((d) => ({ rows: (d?.rows ?? []).filter((r) => r.id !== i.fingerprint), total: d?.total ?? null }));
    } catch (e) { const ae = errorOf(e); toast.error(locale === 'ar' ? ae.message_ar : ae.message_en); }
  };
  return (
    <Card>
      <CardHeader title={tr('ملاحظات فحص الصحة المحفوظة', 'Saved health-check insights')} icon={<Lightbulb />}
        hint={tr('من الفحص الدوري على الخادم؛ القبول أو الاستبعاد قرار بشري', 'From server-side periodic checks; accepting or dismissing is a human decision')} />
      <CardBody>
        <AsyncView state={state} rows={3}>
          {() => <InsightList insights={insights} max={8} linkBase="/app/programs" onDecide={can('programs.edit') ? decide : undefined}
            emptyTitle={tr('لا توجد ملاحظات مفتوحة محفوظة', 'No open saved insights')} />}
        </AsyncView>
      </CardBody>
    </Card>
  );
}

// ----------------------------------------------------------------------------- Approvals
function PendingApprovals() {
  const { tr, fmtDate, enumLabel } = useI18n();
  const { org, can } = useOrg();
  const { user } = useAuth();
  const approver = can('governance.approve');
  const state = useAsync(() => list<ApprovalRequest>('approval_requests', {
    filters: [['organization_id', 'eq', org.id], ['status', 'eq', 'pending'], ...(approver ? [] : [['approver_user_id', 'eq', user?.id ?? ''] as ['approver_user_id', 'eq', string]])],
    order: { column: 'created_at', ascending: true }, pageSize: 8, count: true,
  }), [org.id, approver, user?.id]);
  return (
    <Card>
      <CardHeader title={tr('اعتمادات بانتظار قرارك', 'Approvals awaiting your decision')} icon={<ClipboardCheck />}
        actions={<Link className="small" to="/app/governance/approvals">{tr('الحوكمة ← الاعتمادات', 'Governance → Approvals')}</Link>} />
      <CardBody>
        <AsyncView state={state} rows={3}>
          {(d) => !d.rows.length ? <p className="muted small">{tr('لا توجد طلبات اعتماد معلقة.', 'No pending approval requests.')}</p> : (
            <>
              <ul className="list-plain">
                {d.rows.map((a) => (
                  <li key={a.id} className="row between">
                    <span className="stack-sm" style={{ gap: 2 }}>
                      <b className="small">{a.title}</b>
                      <span className="tiny muted">{entityLabel(a.entity_type, tr)} · {fmtDate(a.created_at)}{a.requested_by === user?.id ? ` · ${tr('طلبك أنت', 'your request')}` : ''}</span>
                    </span>
                    <Badge tone="warning">{enumLabel('approvalStatus', a.status)}</Badge>
                  </li>
                ))}
              </ul>
              {(d.total ?? 0) > d.rows.length && <p className="tiny muted">{tr(`و${(d.total ?? 0) - d.rows.length} طلبات أخرى`, `and ${(d.total ?? 0) - d.rows.length} more`)}</p>}
            </>
          )}
        </AsyncView>
      </CardBody>
    </Card>
  );
}

function entityLabel(t: string, tr: (a: string, e: string) => string): string {
  const m: Record<string, [string, string]> = {
    program: ['برنامج', 'Program'], program_stage: ['مرحلة برنامج', 'Program stage'], report: ['تقرير', 'Report'], contract: ['عقد', 'Contract'],
    budget: ['ميزانية', 'Budget'], evidence: ['دليل', 'Evidence'], assessment_result: ['نتيجة تقييم', 'Assessment result'], application: ['طلب التحاق', 'Application'], other: ['أخرى', 'Other'],
  };
  return m[t] ? tr(m[t][0], m[t][1]) : t;
}

// ----------------------------------------------------------------------------- Sessions
function UpcomingSessions() {
  const { tr, enumLabel, fmtDateTime, fmtTime } = useI18n();
  const { org, hasModule } = useOrg();
  const enabled = hasModule('operations');
  const state = useAsync(async () => {
    if (!enabled) return [] as Session[];
    const now = new Date(); const to = new Date(now.getTime() + 7 * 86400000);
    return (await list<Session>('sessions', {
      filters: [['organization_id', 'eq', org.id], ['status', 'eq', 'scheduled'], ['starts_at', 'gte', now.toISOString()], ['starts_at', 'lte', to.toISOString()]],
      order: { column: 'starts_at', ascending: true }, pageSize: 12,
    })).rows;
  }, [org.id, enabled]);
  if (!enabled) return null;
  return (
    <Card>
      <CardHeader title={tr('الجلسات خلال 7 أيام', 'Sessions in the next 7 days')} icon={<CalendarDays />} actions={<Link className="small" to="/app/operations">{tr('التشغيل', 'Operations')}</Link>} />
      <CardBody>
        <AsyncView state={state} rows={3}>
          {(rows) => !rows.length ? <p className="muted small">{tr('لا توجد جلسات مجدولة خلال الأسبوع القادم.', 'No sessions scheduled in the coming week.')}</p> : (
            <ul className="list-plain">
              {rows.map((s) => (
                <li key={s.id} className="row between">
                  <span className="stack-sm" style={{ gap: 2 }}>
                    <b className="small">{s.title}</b>
                    <span className="tiny muted">{fmtDateTime(s.starts_at)} – {fmtTime(s.ends_at)} · {enumLabel('deliveryMode', s.delivery_mode)}{s.location ? ` · ${s.location}` : ''}</span>
                  </span>
                  <span className="row"><Badge tone="outline">{enumLabel('sessionType', s.session_type)}</Badge>{!s.expert_id && <Badge tone="warning">{tr('بلا خبير', 'No expert')}</Badge>}</span>
                </li>
              ))}
            </ul>
          )}
        </AsyncView>
      </CardBody>
    </Card>
  );
}

// ----------------------------------------------------------------------------- Delivery vs outcomes
interface DvO {
  outputs: Pick<ProgramOutput, 'id' | 'status' | 'target' | 'actual'>[] | null;
  outcomes: Pick<ProgramOutcome, 'id' | 'status'>[] | null;
  indicatorStatus: Record<string, number> | null;
  indicatorTotal: number;
}

function DeliveryVsOutcomes() {
  const { tr, fmtNumber, enumLabel } = useI18n();
  const { org, hasModule } = useOrg();
  const showOut = hasModule('outcomes'); const showImp = hasModule('impact');
  const state = useAsync<DvO>(async () => {
    const orgF: [string, 'eq', string] = ['organization_id', 'eq', org.id];
    const [outputs, outcomes] = await Promise.all([
      showOut ? all<ProgramOutput>('program_outputs', { select: 'id,status,target,actual', filters: [orgF] }) : Promise.resolve(null),
      showOut ? all<ProgramOutcome>('program_outcomes', { select: 'id,status', filters: [orgF] }) : Promise.resolve(null),
    ]);
    let indicatorStatus: Record<string, number> | null = null; let indicatorTotal = 0;
    if (showImp) {
      const [inds, progs] = await Promise.all([
        all<Indicator>('indicators', { filters: [orgF, ['indicator_type', 'eq', 'outcome'], ['status', 'eq', 'active']] }),
        all<Program>('programs', { select: 'id,start_date,end_date', filters: [orgF] }),
      ]);
      const ms = inds.length ? await all<IndicatorMeasurement>('indicator_measurements', { filters: [orgF], order: { column: 'measured_at', ascending: true } }) : [];
      const pmap = new Map(progs.map((p) => [p.id, p]));
      indicatorStatus = {}; indicatorTotal = inds.length;
      for (const i of inds) {
        const p = pmap.get(i.program_id);
        const perf = indicatorPerformance(i, ms, p ? elapsedShare(p.start_date, p.end_date) : null);
        indicatorStatus[perf.status] = (indicatorStatus[perf.status] ?? 0) + 1;
      }
    }
    return { outputs, outcomes, indicatorStatus, indicatorTotal };
  }, [org.id, showOut, showImp]);
  if (!showOut && !showImp) return null;
  return (
    <Card>
      <CardHeader title={tr('التنفيذ مقابل التغيير', 'Delivery vs change')} icon={<Target />} actions={<Link className="small" to={showOut ? '/app/outcomes' : '/app/impact'}>{tr('التفاصيل', 'Details')}</Link>} />
      <CardBody>
        <AsyncView state={state} rows={3}>
          {(d) => {
            const outs = d.outputs ?? [];
            const achieved = outs.filter((o) => o.status === 'achieved').length;
            const withTarget = outs.filter((o) => o.target && Number(o.target) > 0);
            const avgAch = withTarget.length ? Math.round(withTarget.reduce((a, o) => a + Math.min(1.5, Number(o.actual) / Number(o.target)), 0) / withTarget.length * 100) : null;
            const st = d.indicatorStatus ?? {};
            const onTrack = (st.on_track ?? 0) + (st.achieved ?? 0);
            const measured = d.indicatorTotal - (st.no_data ?? 0);
            const oc = d.outcomes ?? [];
            const ocGood = oc.filter((o) => ['achieved', 'on_track'].includes(o.status)).length;
            return (
              <div className="stack">
                <div className="grid g2">
                  <div className="stack-sm">
                    <span className="small strong">{tr('المخرجات — ما نُفّذ', 'Outputs — what was delivered')}</span>
                    {d.outputs === null ? <span className="muted small">{tr('وحدة المخرجات غير متاحة لك', 'Outputs module not available to you')}</span> : (
                      <>
                        <span style={{ fontSize: 22, fontWeight: 700 }}>{fmtNumber(achieved)} / {fmtNumber(outs.length)}</span>
                        <span className="tiny muted">{tr('مخرجات متحققة', 'outputs achieved')}{avgAch !== null ? ` · ${tr('متوسط الإنجاز', 'avg achievement')} ${avgAch}%` : ''}</span>
                        <Progress value={outs.length ? (achieved / outs.length) * 100 : 0} />
                      </>
                    )}
                  </div>
                  <div className="stack-sm">
                    <span className="small strong">{tr('النتائج — ما تغيّر', 'Outcomes — what changed')}</span>
                    {d.indicatorStatus === null ? <span className="muted small">{tr('وحدة الأثر غير متاحة لك', 'Impact module not available to you')}</span> : (
                      <>
                        <span style={{ fontSize: 22, fontWeight: 700 }}>{fmtNumber(onTrack)} / {fmtNumber(d.indicatorTotal)}</span>
                        <span className="tiny muted">{tr('مؤشرات نتائج على المسار أو متحققة', 'outcome indicators on track or achieved')} · {fmtNumber(measured)} {tr('مقاسة', 'measured')}</span>
                        <Progress value={d.indicatorTotal ? (onTrack / d.indicatorTotal) * 100 : 0} tone={d.indicatorTotal && onTrack / d.indicatorTotal < 0.5 ? 'warning' : 'success'} />
                        <div className="row wrap" style={{ gap: 4 }}>
                          {Object.entries(st).map(([k, v]) => <Badge key={k} tone={toneOf(k)}>{enumLabel('indicatorStatus', k)}: {fmtNumber(v)}</Badge>)}
                        </div>
                      </>
                    )}
                    {d.outcomes && <span className="tiny muted">{tr(`النتائج المسجلة: ${ocGood} من ${oc.length} متحققة أو على المسار`, `Recorded outcomes: ${ocGood} of ${oc.length} achieved or on track`)}</span>}
                  </div>
                </div>
                <Notice tone="info">{tr('المخرجات تقيس حجم التنفيذ (جلسات، متدربون، منتجات)، والنتائج تقيس التغير لدى المستفيدين. إنجاز المخرجات لا يعني تحقق النتائج.', 'Outputs measure delivery volume (sessions, trainees, products); outcomes measure change in beneficiaries. Achieving outputs does not mean outcomes were achieved.')}</Notice>
                {d.outputs && d.indicatorStatus && achieved > 0 && measured === 0 && (
                  <Notice tone="warning">{tr('توجد مخرجات متحققة دون أي قياس لمؤشرات النتائج؛ لا يمكن الحديث عن تغيير متحقق.', 'Outputs are achieved but no outcome indicator has been measured; no change can be claimed.')}</Notice>
                )}
              </div>
            );
          }}
        </AsyncView>
      </CardBody>
    </Card>
  );
}

