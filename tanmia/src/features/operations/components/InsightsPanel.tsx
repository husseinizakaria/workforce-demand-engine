// Operational warnings computed in the browser from loaded sessions (last 60
// days → next 14 days): unclosed sessions, missing attendance, expert overload,
// double bookings. Recommendations only — nothing is changed automatically.
import { useMemo } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { startOfRiyadhWeek, type Insight } from '@engine';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, ErrorState, InsightList, Kpi, Loading, type Column } from '@/components/ui';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { useAsync } from '@/hooks/useAsync';
import { count } from '@/services/db';
import { todayISO } from '@/utils/dates';
import type { Session } from '@/types/db';
import { makeInsight, sortInsights } from '@/features/beneficiaries/components/dataUtils';
import { isOpenStatus, loadParticipants, loadSessionsRange, type OpsRefs, sessionHours } from './ops';

interface Affected { key: string; rule: string; label: [string, string]; severity: 'high' | 'medium' | 'low'; session: Session; detail: string }

export function InsightsPanel({ refs, onOpen, version }: { refs: OpsRefs; onOpen: (id: string) => void; version: number }) {
  const { org } = useOrg();
  const { tr, pick, fmtDateTime, fmtNumber } = useI18n();
  const state = useAsync(async () => {
    const now = Date.now();
    const from = new Date(now - 60 * 86400000).toISOString();
    const to = new Date(now + 14 * 86400000).toISOString();
    const sessions = await loadSessionsRange(org.id, from, to, [], 8000);
    const participants = await loadParticipants(sessions.filter((s) => s.status === 'completed' || (isOpenStatus(s.status) && new Date(s.ends_at).getTime() >= now)).map((s) => s.id)).catch(() => []);
    let overdueActions = 0;
    try { overdueActions = await count('program_actions', [['organization_id', 'eq', org.id], ['status', 'in', ['open', 'in_progress']], ['due_date', 'lt', todayISO()]]); } catch { /* not visible */ }
    return { sessions, participants, overdueActions, now };
  }, [org.id, version]);

  const result = useMemo(() => {
    if (!state.data) return null;
    const { sessions, participants, overdueActions, now } = state.data;
    const insights: Insight[] = []; const affected: Affected[] = [];
    const bySession = new Map<string, typeof participants>();
    for (const p of participants) bySession.set(p.session_id, [...(bySession.get(p.session_id) ?? []), p]);
    const ename = (id: string | null) => (id ? pick(refs.expertMap.get(id)?.full_name, refs.expertMap.get(id)?.full_name_en) || id.slice(0, 8) : '—');

    const unclosed = sessions.filter((s) => isOpenStatus(s.status) && new Date(s.ends_at).getTime() < now);
    unclosed.forEach((s) => affected.push({ key: `nc:${s.id}`, rule: 'OPS_NOT_CLOSED', label: ['جلسة لم تُغلق', 'Not closed'], severity: 'high', session: s,
      detail: tr(`انتهت منذ ${Math.floor((now - new Date(s.ends_at).getTime()) / 86400000)} يوم`, `Ended ${Math.floor((now - new Date(s.ends_at).getTime()) / 86400000)} days ago`) }));
    if (unclosed.length) insights.push(makeInsight({ rule: 'OPS_NOT_CLOSED', severity: unclosed.length > 5 ? 'high' : 'medium', kind: 'data_quality', area: 'delivery',
      title: ['جلسات منتهية لم تُغلق', 'Past sessions not closed'],
      rationale: [`${unclosed.length} جلسة انتهى موعدها وما زالت «مجدولة»؛ لا تُحتسب ساعات الخبراء ولا مؤشرات التنفيذ.`, `${unclosed.length} sessions have ended but are still “scheduled”; expert hours and delivery indicators are not counted.`],
      action: ['افتح كل جلسة وسجّل الحضور والملخص ثم أغلقها، أو ألغها إن لم تُنفذ.', 'Open each session, record attendance and a summary, then close it — or cancel it if it did not take place.'] }));

    const noAtt = sessions.filter((s) => s.status === 'completed' && (!(bySession.get(s.id)?.length) || bySession.get(s.id)!.every((p) => p.attendance_status === 'unknown')));
    noAtt.forEach((s) => affected.push({ key: `na:${s.id}`, rule: 'OPS_NO_ATTENDANCE', label: ['مكتملة بلا حضور', 'Completed without attendance'], severity: 'medium', session: s,
      detail: bySession.get(s.id)?.length ? tr('لم يُسجل أي حضور', 'No attendance recorded') : tr('لا يوجد مشاركون', 'No participants') }));
    if (noAtt.length) insights.push(makeInsight({ rule: 'OPS_NO_ATTENDANCE', severity: 'medium', kind: 'evidence_gap', area: 'evidence',
      title: ['جلسات مكتملة بلا حضور مسجل', 'Completed sessions without attendance'],
      rationale: [`${noAtt.length} جلسة مكتملة لا تحتوي حضورًا مسجلًا؛ تضعف أدلة التنفيذ ومؤشرات الحضور.`, `${noAtt.length} completed sessions have no recorded attendance; delivery evidence and attendance indicators are weakened.`],
      action: ['سجّل الحضور وارفع كشف الحضور كدليل.', 'Record attendance and upload the attendance sheet as evidence.'] }));

    const upcoming = sessions.filter((s) => isOpenStatus(s.status) && new Date(s.ends_at).getTime() >= now);
    const load = new Map<string, { expert: string; week: string; hours: number; sessions: Session[] }>();
    for (const s of upcoming) {
      if (!s.expert_id) continue;
      const k = `${s.expert_id}|${startOfRiyadhWeek(s.starts_at)}`;
      const cur = load.get(k) ?? { expert: s.expert_id, week: startOfRiyadhWeek(s.starts_at), hours: 0, sessions: [] };
      cur.hours += sessionHours(s); cur.sessions.push(s); load.set(k, cur);
    }
    for (const l of load.values()) {
      const max = refs.expertMap.get(l.expert)?.max_weekly_hours;
      if (!max || l.hours <= max) continue;
      insights.push(makeInsight({ rule: 'OPS_EXPERT_OVERLOAD', key: `${l.expert}:${l.week}`, severity: 'high', kind: 'risk', area: 'people',
        title: [`حمل زائد على ${ename(l.expert)}`, `Overload for ${ename(l.expert)}`],
        rationale: [`${fmtNumber(l.hours, 1)} ساعة في أسبوع ${l.week} مقابل حد ${max} ساعة.`, `${fmtNumber(l.hours, 1)} hours in the week of ${l.week} vs a cap of ${max}.`],
        action: ['أعد توزيع بعض الجلسات على خبير آخر (استخدم المطابقة الذكية) أو أعد جدولتها.', 'Move some sessions to another expert (use smart matching) or reschedule them.'], data: { hours: l.hours, max } }));
      l.sessions.forEach((s) => affected.push({ key: `ol:${s.id}`, rule: 'OPS_EXPERT_OVERLOAD', label: ['حمل زائد للخبير', 'Expert overload'], severity: 'high', session: s, detail: `${ename(l.expert)} · ${fmtNumber(l.hours, 1)}/${max}` }));
    }

    const ov = (a: Session, b: Session) => new Date(a.starts_at) < new Date(b.ends_at) && new Date(b.starts_at) < new Date(a.ends_at);
    const open = sessions.filter((s) => isOpenStatus(s.status));
    let dbl = 0; let loc = 0; let ben = 0;
    for (let i = 0; i < open.length; i++) for (let j = i + 1; j < open.length; j++) {
      const a = open[i]; const b = open[j];
      if (!ov(a, b)) continue;
      if (a.expert_id && a.expert_id === b.expert_id) {
        dbl++;
        affected.push({ key: `de:${a.id}:${b.id}`, rule: 'OPS_DOUBLE_BOOKING', label: ['حجز مزدوج للخبير', 'Expert double booking'], severity: 'high', session: a, detail: `${ename(a.expert_id)} ↔ ${b.code} ${b.title}` });
      }
      if (a.location && b.location && a.delivery_mode !== 'online' && b.delivery_mode !== 'online' && a.location.trim().toLowerCase() === b.location.trim().toLowerCase()) {
        loc++;
        affected.push({ key: `dl:${a.id}:${b.id}`, rule: 'OPS_LOCATION_CLASH', label: ['تعارض مكان', 'Location clash'], severity: 'medium', session: a, detail: `${a.location} ↔ ${b.code}` });
      }
      const pa = new Set((bySession.get(a.id) ?? []).map((p) => p.beneficiary_id));
      const shared = (bySession.get(b.id) ?? []).filter((p) => pa.has(p.beneficiary_id)).length;
      if (shared) {
        ben++;
        affected.push({ key: `db:${a.id}:${b.id}`, rule: 'OPS_PARTICIPANT_CLASH', label: ['تداخل مشاركين', 'Participant clash'], severity: 'medium', session: a, detail: tr(`${shared} مشارك مشترك مع ${b.code}`, `${shared} shared participants with ${b.code}`) });
      }
    }
    if (dbl) insights.push(makeInsight({ rule: 'OPS_DOUBLE_BOOKING', severity: 'high', kind: 'overlap', area: 'delivery', title: ['حجوزات مزدوجة للخبراء', 'Expert double bookings'],
      rationale: [`${dbl} زوج من الجلسات المتداخلة لنفس الخبير.`, `${dbl} pairs of overlapping sessions for the same expert.`], action: ['أعد جدولة إحدى الجلستين أو أسندها لخبير آخر.', 'Reschedule one session or assign another expert.'] }));
    if (loc) insights.push(makeInsight({ rule: 'OPS_LOCATION_CLASH', severity: 'medium', kind: 'overlap', area: 'delivery', title: ['تعارض في الأماكن', 'Location clashes'],
      rationale: [`${loc} زوج من الجلسات في نفس المكان والوقت.`, `${loc} pairs of sessions share the same location and time.`], action: ['غيّر المكان أو الموعد.', 'Change the location or time.'] }));
    if (ben) insights.push(makeInsight({ rule: 'OPS_PARTICIPANT_CLASH', severity: 'medium', kind: 'overlap', area: 'people', title: ['مشاركون في جلستين متزامنتين', 'Participants in simultaneous sessions'],
      rationale: [`${ben} زوج من الجلسات المتزامنة يشترك فيها مشاركون.`, `${ben} pairs of simultaneous sessions share participants.`], action: ['راجع قوائم المشاركين أو المواعيد.', 'Review participant lists or times.'] }));

    const noExpert = upcoming.filter((s) => !s.expert_id);
    if (noExpert.length) {
      insights.push(makeInsight({ rule: 'OPS_NO_EXPERT', severity: 'low', kind: 'missing_config', area: 'people', title: ['جلسات قادمة بلا خبير', 'Upcoming sessions without an expert'],
        rationale: [`${noExpert.length} جلسة خلال 14 يومًا بلا خبير مسند.`, `${noExpert.length} sessions in the next 14 days have no expert.`], action: ['أسند خبيرًا لكل جلسة.', 'Assign an expert to each session.'] }));
      noExpert.forEach((s) => affected.push({ key: `ne:${s.id}`, rule: 'OPS_NO_EXPERT', label: ['بلا خبير', 'No expert'], severity: 'low', session: s, detail: '' }));
    }
    const noPart = upcoming.filter((s) => !(bySession.get(s.id)?.length));
    if (noPart.length) insights.push(makeInsight({ rule: 'OPS_NO_PARTICIPANTS', severity: 'low', kind: 'missing_config', area: 'delivery', title: ['جلسات قادمة بلا مشاركين', 'Upcoming sessions without participants'],
      rationale: [`${noPart.length} جلسة قادمة بلا قائمة مشاركين؛ لن تصل الإشعارات ولن يمكن تسجيل الحضور.`, `${noPart.length} upcoming sessions have no participant list; notifications and attendance are not possible.`], action: ['أضف المشاركين من درج الجلسة.', 'Add participants from the session drawer.'] }));
    if (overdueActions) insights.push(makeInsight({ rule: 'OPS_ACTIONS_OVERDUE', severity: overdueActions > 10 ? 'high' : 'medium', kind: 'blocker', area: 'delivery', title: ['إجراءات متأخرة', 'Overdue actions'],
      rationale: [`${overdueActions} إجراء تجاوز تاريخ الاستحقاق.`, `${overdueActions} actions are past their due date.`], action: ['راجع لوحة الإجراءات.', 'Review the actions board.'] }));
    return { insights: sortInsights(insights), affected, upcoming: upcoming.length, unclosed: unclosed.length, noAtt: noAtt.length, clashes: dbl + loc + ben };
  }, [state.data, refs, pick, tr, fmtNumber]);

  const cols: Column<Affected>[] = [
    { key: 'rule', header: tr('الملاحظة', 'Finding'), value: (a) => a.rule, render: (a) => <Badge tone={a.severity === 'high' ? 'danger' : a.severity === 'medium' ? 'warning' : 'info'}>{tr(...a.label)}</Badge> },
    { key: 'session', header: tr('الجلسة', 'Session'), value: (a) => a.session.title, render: (a) => <div><b>{a.session.title}</b><span className="sub mono">{a.session.code}</span></div> },
    { key: 'when', header: tr('الموعد', 'When'), value: (a) => a.session.starts_at, render: (a) => fmtDateTime(a.session.starts_at) },
    { key: 'program', header: tr('البرنامج', 'Program'), value: (a) => (a.session.program_id ? pick(refs.programMap.get(a.session.program_id)?.name, refs.programMap.get(a.session.program_id)?.name_en) : '—') },
    { key: 'detail', header: tr('التفاصيل', 'Detail'), value: (a) => a.detail },
  ];
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  if (!result) return <Loading />;
  return (
    <div className="stack">
      <div className="grid g4">
        <Kpi label={tr('جلسات الأيام الـ14 القادمة', 'Sessions next 14 days')} value={fmtNumber(result.upcoming)} />
        <Kpi label={tr('لم تُغلق', 'Not closed')} value={fmtNumber(result.unclosed)} tone={result.unclosed ? 'danger' : undefined} />
        <Kpi label={tr('مكتملة بلا حضور', 'Completed w/o attendance')} value={fmtNumber(result.noAtt)} tone={result.noAtt ? 'warning' : undefined} />
        <Kpi label={tr('تداخلات', 'Clashes')} value={fmtNumber(result.clashes)} tone={result.clashes ? 'warning' : undefined} />
      </div>
      <Card>
        <CardHeader title={tr('تنبيهات تشغيلية', 'Operational warnings')} icon={<Activity />} hint={tr('محسوبة في المتصفح لآخر 60 يومًا والأيام الـ14 القادمة', 'Computed in the browser for the last 60 and next 14 days')}
          actions={<Button size="sm" variant="ghost" icon={<RefreshCw />} loading={state.loading} onClick={() => void state.reload()}>{tr('تحديث', 'Refresh')}</Button>} />
        <CardBody><InsightList insights={result.insights} /></CardBody>
      </Card>
      {result.affected.length > 0 && (
        <Card>
          <CardHeader title={tr('الجلسات المتأثرة', 'Affected sessions')} />
          <CardBody flush><DataTable columns={cols} rows={result.affected} rowKey={(a) => a.key} onRowClick={(a) => onOpen(a.session.id)} pageSize={15} exportName="operational-warnings" /></CardBody>
        </Card>
      )}
    </div>
  );
}
