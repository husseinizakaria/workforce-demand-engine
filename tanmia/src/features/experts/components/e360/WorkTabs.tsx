import { useMemo } from 'react';
import { Link } from 'react-router';
import { Banknote, BarChart3, Briefcase, FileSignature } from 'lucide-react';
import { BarList, Card, CardBody, CardHeader, DataTable, Kpi, Notice, StatusBadge, type Column } from '@/components/ui';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import type { Contract, ExpertAssignment } from '@/types/db';
import { avg, recordTypeName, round1 } from '@/features/beneficiaries/components/dataUtils';
import type { E360 } from './data';

const pname = (d: E360, id: string | null, pick: (a: string | null | undefined, b: string | null | undefined) => string) => {
  const p = id ? d.programs.get(id) : undefined;
  return p ? pick(p.name, p.name_en) : '—';
};

export function AssignmentsTab({ d }: { d: E360 }) {
  const { tr, pick, enumLabel, fmtDate, fmtNumber } = useI18n();
  const delivered = (a: ExpertAssignment) => Number(a.delivered_hours ?? 0);
  const cols: Column<ExpertAssignment>[] = [
    { key: 'program', header: tr('البرنامج', 'Program'), value: (a) => pname(d, a.program_id, pick), render: (a) => <Link to={`/app/programs/${a.program_id}`}>{pname(d, a.program_id, pick)}</Link> },
    { key: 'role', header: tr('الدور', 'Role'), value: (a) => enumLabel('expertRole', a.role) },
    { key: 'scope', header: tr('النطاق', 'Scope'), value: (a) => (a.beneficiary_id ? 'beneficiary' : a.team_id ? 'team' : a.stage_key ?? 'program'),
      render: (a) => a.beneficiary_id ? <Link to={`/app/beneficiaries/${a.beneficiary_id}/overview`}>{tr('مستفيد', 'Beneficiary')}</Link> : a.team_id ? tr('فريق', 'Team') : a.stage_key ?? tr('البرنامج', 'Program') },
    { key: 'status', header: tr('الحالة', 'Status'), value: (a) => a.status, render: (a) => <StatusBadge group="assignmentStatus" value={a.status} /> },
    { key: 'planned', header: tr('ساعات مخططة', 'Planned h'), align: 'end', value: (a) => a.planned_hours },
    { key: 'delivered', header: tr('ساعات منفذة', 'Delivered h'), align: 'end', value: (a) => round1(delivered(a)) },
    { key: 'pct', header: tr('الإنجاز', 'Done'), align: 'end', value: (a) => (a.planned_hours ? Math.round((delivered(a) / a.planned_hours) * 100) : null), render: (a) => (a.planned_hours ? `${Math.round((delivered(a) / a.planned_hours) * 100)}%` : '—') },
    { key: 'match', header: tr('درجة المطابقة', 'Match score'), align: 'end', value: (a) => a.match_score },
    { key: 'period', header: tr('الفترة', 'Period'), value: (a) => a.starts_on, render: (a) => `${fmtDate(a.starts_on)} – ${fmtDate(a.ends_on)}` },
  ];
  const planned = d.assignments.reduce((s, a) => s + Number(a.planned_hours ?? 0), 0);
  const del = d.assignments.reduce((s, a) => s + delivered(a), 0);
  return (
    <div className="stack">
      <div className="grid g3">
        <Kpi label={tr('التكليفات', 'Assignments')} value={fmtNumber(d.assignments.length)} hint={tr(`${d.assignments.filter((a) => ['confirmed', 'active'].includes(a.status)).length} نشطة`, `${d.assignments.filter((a) => ['confirmed', 'active'].includes(a.status)).length} active`)} />
        <Kpi label={tr('ساعات مخططة', 'Planned hours')} value={fmtNumber(planned, 1)} />
        <Kpi label={tr('ساعات منفذة', 'Delivered hours')} value={fmtNumber(del, 1)} hint={planned ? `${Math.round((del / planned) * 100)}%` : undefined} />
      </div>
      <Card><CardHeader title={tr('التكليفات عبر البرامج', 'Assignments across programs')} icon={<Briefcase />} /><CardBody flush>
        <DataTable columns={cols} rows={d.assignments} rowKey={(a) => a.id} exportName="expert-assignments" empty={{ title: tr('لا توجد تكليفات', 'No assignments') }} />
      </CardBody></Card>
    </div>
  );
}

export function PerformanceTab({ d }: { d: E360 }) {
  const { tr, pick, fmtNumber, locale } = useI18n();
  const stats = useMemo(() => {
    const now = Date.now();
    const completed = d.sessions.filter((s) => s.status === 'completed');
    const cancelled = d.sessions.filter((s) => s.status === 'cancelled');
    const rescheduled = d.sessions.filter((s) => s.status === 'rescheduled');
    const unclosed = d.sessions.filter((s) => s.status === 'scheduled' && new Date(s.ends_at).getTime() < now);
    const fb = d.participants.map((p) => p.feedback_rating).filter((x): x is number => x !== null).map(Number);
    const recorded = d.participants.filter((p) => p.attendance_status !== 'unknown');
    const attended = recorded.filter((p) => ['present', 'late'].includes(p.attendance_status));
    const ratings = d.assignments.filter((a) => a.performance_rating !== null);
    const byType = new Map<string, number>();
    for (const r of d.records) byType.set(r.record_type, (byType.get(r.record_type) ?? 0) + 1);
    return {
      completed: completed.length, cancelled: cancelled.length, rescheduled: rescheduled.length, unclosed: unclosed.length,
      fbAvg: avg(fb), fbN: fb.length, attRate: recorded.length ? Math.round((attended.length / recorded.length) * 100) : null,
      ratings, ratingAvg: avg(ratings.map((a) => Number(a.performance_rating))), byType,
      cancelRate: completed.length + cancelled.length ? Math.round((cancelled.length / (completed.length + cancelled.length)) * 100) : null,
    };
  }, [d]);
  return (
    <div className="stack">
      <div className="grid g5">
        <Kpi label={tr('متوسط تقييم الأداء', 'Avg. performance rating')} value={stats.ratingAvg === null ? '—' : `${fmtNumber(stats.ratingAvg, 2)}/5`} hint={tr(`${stats.ratings.length} تكليف مقيّم`, `${stats.ratings.length} rated assignments`)} />
        <Kpi label={tr('رضا المستفيدين', 'Participant feedback')} value={stats.fbAvg === null ? '—' : `${fmtNumber(stats.fbAvg, 2)}/5`} hint={tr(`${stats.fbN} تقييم`, `${stats.fbN} ratings`)}
          tone={stats.fbAvg !== null && stats.fbAvg < 3 ? 'danger' : undefined} />
        <Kpi label={tr('جلسات مكتملة', 'Completed sessions')} value={fmtNumber(stats.completed)} tone="success" />
        <Kpi label={tr('جلسات ملغاة', 'Cancelled sessions')} value={fmtNumber(stats.cancelled)} hint={stats.cancelRate !== null ? `${stats.cancelRate}%` : undefined} tone={stats.cancelRate !== null && stats.cancelRate > 20 ? 'warning' : undefined} />
        <Kpi label={tr('حضور جلساته', 'Attendance in their sessions')} value={stats.attRate === null ? '—' : `${stats.attRate}%`} />
      </div>
      {stats.unclosed > 0 && <Notice tone="warning">{tr(`${stats.unclosed} جلسة انتهى موعدها ولم تُغلق (لا حضور ولا ملخص). الساعات المنفذة لا تُحتسب حتى تُكمل الجلسة.`, `${stats.unclosed} sessions have ended but were not closed. Delivered hours are only counted once a session is completed.`)}</Notice>}
      <div className="grid g2">
        <Card><CardHeader title={tr('التقييم حسب التكليف', 'Rating per assignment')} icon={<BarChart3 />} /><CardBody>
          {stats.ratings.length ? <BarList max={5} format={(v) => fmtNumber(v, 1)} items={stats.ratings.map((a) => ({ label: `${pname(d, a.program_id, pick)} · ${a.role}`, value: Number(a.performance_rating), tone: Number(a.performance_rating) < 3 ? 'danger' : Number(a.performance_rating) < 4 ? 'warning' : 'success' }))} />
            : <p className="small muted">{tr('لا توجد تقييمات أداء على التكليفات بعد.', 'No assignment performance ratings yet.')}</p>}
        </CardBody></Card>
        <Card><CardHeader title={tr('سجلات التحكيم والتقييم', 'Judging & assessment records')} /><CardBody>
          {stats.byType.size ? <BarList items={[...stats.byType.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: recordTypeName(k, locale), value: v }))} />
            : <p className="small muted">{tr('لا توجد سجلات مراحل مرتبطة بالخبير.', 'No stage records linked to this expert.')}</p>}
          <p className="tiny muted" style={{ marginTop: 6 }}>{tr(`تحكيم: ${stats.byType.get('judging_score') ?? 0} · ملاحظات إرشاد: ${stats.byType.get('mentoring_note') ?? 0} · جلسات أُعيدت جدولتها: ${stats.rescheduled}`, `Judging: ${stats.byType.get('judging_score') ?? 0} · Mentoring notes: ${stats.byType.get('mentoring_note') ?? 0} · Rescheduled sessions: ${stats.rescheduled}`)}</p>
        </CardBody></Card>
      </div>
      <Card><CardHeader title={tr('ملاحظات المقيّمين', 'Assessor feedback')} /><CardBody>
        {d.assignments.filter((a) => a.feedback).length ? <ul className="list-plain small">{d.assignments.filter((a) => a.feedback).map((a) => <li key={a.id}><b>{pname(d, a.program_id, pick)}</b>: {a.feedback}</li>)}</ul>
          : <p className="small muted">{tr('لا توجد ملاحظات مكتوبة.', 'No written feedback.')}</p>}
      </CardBody></Card>
      <p className="tiny muted">{tr(`محسوب من ${d.sessions.length} جلسة و${d.participants.length} سجل مشاركة في الجلسات المكتملة.`, `Computed from ${d.sessions.length} sessions and ${d.participants.length} participant records in completed sessions.`)}</p>
    </div>
  );
}

export function FinancialTab({ d }: { d: E360 }) {
  const { can } = useOrg();
  const { tr, pick, fmtMoney, fmtNumber, fmtDate } = useI18n();
  const e = d.expert;
  type Row = ExpertAssignment & { rateUsed: number | null; cost: number | null; plannedCost: number | null };
  const rows: Row[] = d.assignments.map((a) => {
    const rateUsed = a.rate ?? e.hourly_rate;
    return { ...a, rateUsed, cost: rateUsed === null ? null : rateUsed * Number(a.delivered_hours ?? 0), plannedCost: rateUsed === null || a.planned_hours === null ? null : rateUsed * a.planned_hours };
  });
  const totalCost = rows.reduce((s, r) => s + (r.cost ?? 0), 0);
  const totalPlanned = rows.reduce((s, r) => s + (r.plannedCost ?? 0), 0);
  const contractTotal = d.contracts.filter((c) => !['terminated', 'draft'].includes(c.status)).reduce((s, c) => s + Number(c.value ?? 0), 0);
  const cols: Column<Row>[] = [
    { key: 'program', header: tr('البرنامج', 'Program'), value: (r) => pname(d, r.program_id, pick) },
    { key: 'role', header: tr('الدور', 'Role'), value: (r) => r.role },
    { key: 'rate', header: tr('السعر/ساعة', 'Rate/h'), align: 'end', value: (r) => r.rateUsed, render: (r) => (r.rateUsed === null ? '—' : `${fmtMoney(r.rateUsed, e.currency)}${r.rate === null ? ' *' : ''}`) },
    { key: 'delivered', header: tr('ساعات منفذة', 'Delivered h'), align: 'end', value: (r) => round1(Number(r.delivered_hours)) },
    { key: 'cost', header: tr('التكلفة المستحقة', 'Accrued cost'), align: 'end', value: (r) => r.cost, render: (r) => fmtMoney(r.cost, e.currency) },
    { key: 'planned', header: tr('التكلفة المخططة', 'Planned cost'), align: 'end', value: (r) => r.plannedCost, render: (r) => fmtMoney(r.plannedCost, e.currency) },
  ];
  const cCols: Column<Contract>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), value: (c) => c.code, render: (c) => <span className="mono">{c.code}</span> },
    { key: 'title', header: tr('العقد', 'Contract'), value: (c) => c.title },
    { key: 'program', header: tr('البرنامج', 'Program'), value: (c) => pname(d, c.program_id, pick) },
    { key: 'value', header: tr('القيمة', 'Value'), align: 'end', value: (c) => c.value, render: (c) => fmtMoney(c.value, c.currency) },
    { key: 'period', header: tr('الفترة', 'Period'), value: (c) => c.start_date, render: (c) => `${fmtDate(c.start_date)} – ${fmtDate(c.end_date)}` },
    { key: 'status', header: tr('الحالة', 'Status'), value: (c) => c.status, render: (c) => <StatusBadge group="contractStatus" value={c.status} /> },
  ];
  return (
    <div className="stack">
      <div className="grid g4">
        <Kpi label={tr('التكلفة المستحقة', 'Accrued cost')} icon={<Banknote size={14} />} value={fmtMoney(totalCost, e.currency)} hint={tr('سعر الساعة × الساعات المنفذة', 'rate × delivered hours')} />
        <Kpi label={tr('التكلفة المخططة', 'Planned cost')} value={fmtMoney(totalPlanned, e.currency)} />
        <Kpi label={tr('قيمة العقود السارية', 'Active contract value')} icon={<FileSignature size={14} />} value={can('governance.view') ? fmtMoney(contractTotal, e.currency) : '—'} />
        <Kpi label={tr('الفرق عن العقود', 'Variance vs contracts')} value={can('governance.view') && contractTotal ? fmtMoney(contractTotal - totalCost, e.currency) : '—'}
          tone={contractTotal && totalCost > contractTotal ? 'danger' : undefined} hint={contractTotal && totalCost > contractTotal ? tr('المستحق يتجاوز قيمة العقود', 'Accrued exceeds contracts') : undefined} />
      </div>
      {e.hourly_rate === null && rows.some((r) => r.rate === null) && <Notice tone="warning">{tr('لا يوجد سعر ساعة للخبير ولا سعر في بعض التكليفات؛ التكلفة غير مكتملة.', 'No hourly rate on the expert or some assignments; cost is incomplete.')}</Notice>}
      <Card><CardHeader title={tr('التكلفة حسب التكليف', 'Cost per assignment')} icon={<Banknote />} hint={tr('* سعر الخبير الافتراضي', '* expert default rate')} /><CardBody flush>
        <DataTable columns={cols} rows={rows} rowKey={(r) => r.id} exportName="expert-financial" empty={{ title: tr('لا توجد تكليفات', 'No assignments') }} />
      </CardBody></Card>
      <Card><CardHeader title={tr('العقود', 'Contracts')} icon={<FileSignature />} hint={`${fmtNumber(d.contracts.length)}`} /><CardBody flush>
        {can('governance.view') ? <DataTable columns={cCols} rows={d.contracts} rowKey={(c) => c.id} empty={{ title: tr('لا توجد عقود', 'No contracts') }} />
          : <div className="card-pad"><Notice tone="info">{tr('عرض العقود يتطلب صلاحية «الحوكمة ← عرض».', 'Viewing contracts requires “Governance → View”.')}</Notice></div>}
      </CardBody></Card>
    </div>
  );
}
