// Delivery: sessions (schedule with conflict check, attendance, complete,
// cancel), milestones and program actions.
import { useMemo, useState } from 'react';
import { Ban, CalendarPlus, CheckCircle2, ClipboardList, Flag, ListChecks, Pencil, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAsync } from '@/hooks/useAsync';
import { useAction } from '@/hooks/useAction';
import { all, insert, remove, update } from '@/services/db';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, Kpi, Notice, Progress, Segmented, StatusBadge, useConfirm, type Column } from '@/components/ui';
import { RecordFormModal, type FieldSpec } from '@/components/forms/RecordForm';
import type { ProgramAction, ProgramMilestone, Session } from '@/types/db';
import { errText } from '../../lib';
import { useWorkspace } from '../context';
import { RowActions, TabInsights } from '../components/common';
import { AttendanceModal, CancelSessionModal, CompleteSessionModal, ScheduleSessionModal } from '../components/SessionModals';

export default function DeliveryTab() {
  const { tr, fmtNumber } = useI18n();
  const ws = useWorkspace();
  const b = ws.bundle;
  const now = Date.now();
  const upcoming = b.sessions.filter((s) => s.status === 'scheduled' && new Date(s.starts_at).getTime() >= now);
  const unclosed = b.sessions.filter((s) => s.status === 'scheduled' && new Date(s.ends_at).getTime() < now);
  const done = b.sessions.filter((s) => s.status === 'completed');
  const att = ws.health.metrics.attendance_rate;
  const overdue = b.actions.filter((a) => ['open', 'in_progress'].includes(a.status) && a.due_date && a.due_date < new Date().toISOString().slice(0, 10)).length;
  return (
    <div className="stack">
      <div className="grid g5">
        <Kpi label={tr('جلسات قادمة', 'Upcoming sessions')} value={fmtNumber(upcoming.length)} icon={<CalendarPlus />} />
        <Kpi label={tr('جلسات منفذة', 'Completed sessions')} value={fmtNumber(done.length)} icon={<CheckCircle2 />} />
        <Kpi label={tr('منتهية لم تُغلق', 'Ended, not closed')} value={fmtNumber(unclosed.length)} icon={<ClipboardList />} tone={unclosed.length ? 'warning' : undefined}
          hint={tr('أغلقها وسجل الحضور', 'Close them and record attendance')} />
        <Kpi label={tr('نسبة الحضور', 'Attendance rate')} value={att === null || att === undefined ? '—' : `${fmtNumber(att, 1)}%`} icon={<ListChecks />}
          tone={att !== null && att !== undefined ? (att < 60 ? 'danger' : att < 75 ? 'warning' : 'success') : undefined} />
        <Kpi label={tr('إجراءات متأخرة', 'Overdue actions')} value={fmtNumber(overdue)} icon={<Flag />} tone={overdue ? 'danger' : undefined} />
      </div>
      <TabInsights links={['delivery']} title={tr('ملاحظات المحرك على التنفيذ', 'Engine findings on delivery')} />
      <Sessions />
      <div className="grid g2">
        <Milestones />
        <Actions />
      </div>
    </div>
  );
}

function Sessions() {
  const { tr, enumLabel, fmtDateTime, fmtTime } = useI18n();
  const { can } = useOrg();
  const ws = useWorkspace();
  const b = ws.bundle;
  const [view, setView] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  const [schedule, setSchedule] = useState(false);
  const [attendance, setAttendance] = useState<Session | null>(null);
  const [complete, setComplete] = useState<Session | null>(null);
  const [cancel, setCancel] = useState<Session | null>(null);
  const now = Date.now();
  const rows = useMemo(() => {
    const list = view === 'upcoming' ? b.sessions.filter((s) => new Date(s.ends_at).getTime() >= now && s.status !== 'cancelled')
      : view === 'past' ? b.sessions.filter((s) => new Date(s.ends_at).getTime() < now || s.status === 'cancelled') : b.sessions;
    return view === 'past' ? [...list].reverse() : list;
  }, [b.sessions, view, now]);
  const stats = (id: string) => {
    const ps = b.participants.filter((p) => p.session_id === id);
    const marked = ps.filter((p) => p.attendance_status !== 'unknown');
    const present = marked.filter((p) => p.attendance_status === 'present' || p.attendance_status === 'late').length;
    return { n: ps.length, marked: marked.length, rate: marked.length ? Math.round((present / marked.length) * 100) : null };
  };
  const cols: Column<Session>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), render: (r) => <span className="mono">{r.code}</span>, value: (r) => r.code },
    { key: 'title', header: tr('العنوان', 'Title'), sortable: true, render: (r) => <span>{r.title}<span className="sub">{enumLabel('sessionType', r.session_type)}{r.stage_key ? ` · ${ws.stageName(r.stage_key)}` : ''}</span></span>, value: (r) => r.title },
    { key: 'when', header: tr('الموعد', 'When'), sortable: true, value: (r) => r.starts_at, render: (r) => <span className="nowrap">{fmtDateTime(r.starts_at)} – {fmtTime(r.ends_at)}</span> },
    { key: 'expert', header: tr('الخبير', 'Expert'), value: (r) => ws.expertName(r.expert_id) },
    { key: 'cohort', header: tr('الدفعة', 'Cohort'), value: (r) => ws.cohortName(r.cohort_id) },
    { key: 'mode', header: tr('التنفيذ', 'Mode'), value: (r) => `${enumLabel('deliveryMode', r.delivery_mode)}${r.location ? ' · ' + r.location : ''}` },
    { key: 'participants', header: tr('المشاركون', 'Participants'), align: 'end', value: (r) => stats(r.id).n,
      render: (r) => { const s = stats(r.id); return <span>{s.n}{s.rate !== null && <Badge tone={s.rate < 60 ? 'danger' : s.rate < 75 ? 'warning' : 'success'}>{s.rate}%</Badge>}</span>; } },
    { key: 'status', header: tr('الحالة', 'Status'), value: (r) => r.status, render: (r) => {
      const late = r.status === 'scheduled' && new Date(r.ends_at).getTime() < now;
      return <span className="row" style={{ gap: 4 }}><StatusBadge group="sessionStatus" value={r.status} />{late && <Badge tone="warning">{tr('لم تُغلق', 'Not closed')}</Badge>}</span>;
    } },
    { key: 'actions', header: '', hideInExport: true, render: (r) => (
      <RowActions>
        <Button size="sm" variant="ghost" onClick={() => setAttendance(r)}>{tr('الحضور', 'Attendance')}</Button>
        {can('operations.edit') && r.status === 'scheduled' && <>
          <Button size="sm" variant="ghost" icon={<CheckCircle2 />} onClick={() => setComplete(r)}>{tr('إكمال', 'Complete')}</Button>
          <Button size="sm" variant="ghost" iconOnly icon={<Ban />} aria-label={tr('إلغاء', 'Cancel')} onClick={() => setCancel(r)} />
        </>}
      </RowActions>
    ) },
  ];
  return (
    <Card>
      <CardHeader icon={<CalendarPlus />} title={tr('جلسات البرنامج', 'Program sessions')}
        actions={<>
          <Segmented value={view} onChange={setView} options={[{ value: 'upcoming', label: tr('القادمة', 'Upcoming') }, { value: 'past', label: tr('السابقة', 'Past') }, { value: 'all', label: tr('الكل', 'All') }]} />
          {can('operations.create') && <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setSchedule(true)}>{tr('جدولة جلسة', 'Schedule session')}</Button>}
        </>} />
      <CardBody flush>
        <DataTable rows={rows} rowKey={(r) => r.id} columns={cols} searchable pageSize={15} exportName={`${b.program.code}-sessions`}
          empty={{ title: view === 'upcoming' ? tr('لا توجد جلسات قادمة', 'No upcoming sessions') : tr('لا توجد جلسات', 'No sessions') }} />
      </CardBody>
      {schedule && <ScheduleSessionModal onClose={() => setSchedule(false)} />}
      {attendance && <AttendanceModal session={attendance} onClose={() => setAttendance(null)} />}
      {complete && <CompleteSessionModal session={complete} onClose={() => setComplete(null)} />}
      {cancel && <CancelSessionModal session={cancel} onClose={() => setCancel(null)} />}
    </Card>
  );
}

function Milestones() {
  const { tr, fmtDate, locale } = useI18n();
  const { can, org } = useOrg();
  const ws = useWorkspace();
  const confirm = useConfirm();
  const state = useAsync(() => all<ProgramMilestone>('program_milestones', { filters: [['organization_id', 'eq', org.id], ['program_id', 'eq', ws.programId]], order: { column: 'due_date', ascending: true } }), [ws.programId]);
  const [editing, setEditing] = useState<ProgramMilestone | 'new' | null>(null);
  const del = useAction(async (id: string) => { await remove('program_milestones', id); await state.reload(); });
  const today = new Date().toISOString().slice(0, 10);
  const fields: FieldSpec[] = [
    { name: 'title', label: ['المعلم', 'Milestone'], type: 'text', required: true, full: true },
    { name: 'stage_key', label: ['المرحلة', 'Stage'], type: 'select', options: ws.bundle.stages.map((s) => ({ value: s.stage_key, label: ws.stageName(s.stage_key) })) },
    { name: 'cohort_id', label: ['الدفعة', 'Cohort'], type: 'select', options: ws.bundle.cohorts.map((c) => ({ value: c.id, label: c.name })) },
    { name: 'beneficiary_id', label: ['المستفيد', 'Beneficiary'], type: 'select', options: ws.enrolled.map((x) => ({ value: x.id, label: x.full_name })) },
    { name: 'due_date', label: ['الموعد', 'Due date'], type: 'date' },
    { name: 'status', label: ['الحالة', 'Status'], type: 'select', required: true, options: [
      { value: 'not_started', label: tr('لم يبدأ', 'Not started') }, { value: 'in_progress', label: tr('قيد التنفيذ', 'In progress') },
      { value: 'achieved', label: tr('متحقق', 'Achieved') }, { value: 'missed', label: tr('فائت', 'Missed') }, { value: 'cancelled', label: tr('ملغى', 'Cancelled') }] },
    { name: 'progress', label: ['التقدم %', 'Progress %'], type: 'number', min: 0, max: 100, step: 1 },
    { name: 'evidence_required', label: ['يتطلب دليلًا', 'Evidence required'], type: 'checkbox' },
  ];
  const statusLabel = (s: string) => fields[5].options?.find((o) => o.value === s)?.label ?? s;
  return (
    <Card>
      <CardHeader icon={<Flag />} title={tr('المعالم', 'Milestones')}
        actions={can('programs.create') ? <Button size="sm" icon={<Plus />} onClick={() => setEditing('new')}>{tr('معلم', 'Milestone')}</Button> : undefined} />
      <CardBody flush>
        {state.error ? <Notice tone="danger">{errText(locale, state.error)}</Notice> : (
          <DataTable rows={state.data ?? []} loading={state.loading} rowKey={(r) => r.id} exportName={`${ws.bundle.program.code}-milestones`} empty={{ title: tr('لا توجد معالم', 'No milestones') }}
            columns={[
              { key: 'title', header: tr('المعلم', 'Milestone'), render: (r) => <span>{r.title}<span className="sub">{[ws.stageName(r.stage_key), r.beneficiary_id ? ws.benName(r.beneficiary_id) : null].filter((x) => x && x !== '—').join(' · ')}</span></span>, value: (r) => r.title },
              { key: 'due', header: tr('الموعد', 'Due'), value: (r) => r.due_date, render: (r) => r.due_date && r.due_date < today && !['achieved', 'cancelled'].includes(r.status) ? <Badge tone="danger">{fmtDate(r.due_date)}</Badge> : fmtDate(r.due_date) },
              { key: 'progress', header: tr('التقدم', 'Progress'), value: (r) => r.progress, render: (r) => <div className="row"><Progress value={r.progress} /><span className="tiny">{r.progress}%</span></div> },
              { key: 'status', header: tr('الحالة', 'Status'), value: (r) => statusLabel(r.status), render: (r) => <Badge tone={r.status === 'achieved' ? 'success' : r.status === 'missed' ? 'danger' : r.status === 'in_progress' ? 'primary' : 'neutral'}>{statusLabel(r.status)}</Badge> },
              { key: 'actions', header: '', hideInExport: true, render: (r) => (
                <RowActions>
                  {can('programs.edit') && <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => setEditing(r)} />}
                  {can('programs.delete') && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')}
                    onClick={async () => { if (await confirm({ title: tr('حذف المعلم؟', 'Delete milestone?'), danger: true })) void del.run(r.id); }} />}
                </RowActions>
              ) },
            ]} />
        )}
      </CardBody>
      <RecordFormModal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? tr('معلم جديد', 'New milestone') : tr('تعديل المعلم', 'Edit milestone')} fields={fields}
        initial={editing && editing !== 'new' ? { ...editing } : { status: 'not_started', progress: 0, evidence_required: true }}
        onSubmit={async (v) => {
          const row = { ...v, progress: v.status === 'achieved' ? 100 : v.progress ?? 0 };
          if (editing && editing !== 'new') await update<ProgramMilestone>('program_milestones', editing.id, row);
          else await insert<ProgramMilestone>('program_milestones', { ...row, organization_id: org.id, program_id: ws.programId });
          await state.reload();
        }} />
    </Card>
  );
}

function Actions() {
  const { tr, fmtDate, enumLabel } = useI18n();
  const { can, org } = useOrg();
  const ws = useWorkspace();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<ProgramAction | 'new' | null>(null);
  const [showDone, setShowDone] = useState(false);
  const del = useAction(async (id: string) => { await remove('program_actions', id); await ws.reload(); });
  const today = new Date().toISOString().slice(0, 10);
  const rows = ws.bundle.actions.filter((a) => showDone || ['open', 'in_progress'].includes(a.status))
    .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
  const fields: FieldSpec[] = [
    { name: 'title', label: ['الإجراء', 'Action'], type: 'text', required: true, full: true },
    { name: 'description', label: ['الوصف', 'Description'], type: 'textarea' },
    { name: 'owner_name', label: ['المسؤول', 'Owner'], type: 'text' },
    { name: 'due_date', label: ['الموعد', 'Due date'], type: 'date' },
    { name: 'priority', label: ['الأولوية', 'Priority'], type: 'enum', enumGroup: 'priority', required: true },
    { name: 'status', label: ['الحالة', 'Status'], type: 'enum', enumGroup: 'actionStatus', required: true },
    { name: 'stage_key', label: ['المرحلة', 'Stage'], type: 'select', options: ws.bundle.stages.map((s) => ({ value: s.stage_key, label: ws.stageName(s.stage_key) })) },
    { name: 'completion_note', label: ['ملاحظة الإنجاز', 'Completion note'], type: 'textarea', visible: (v) => v.status === 'done' },
  ];
  return (
    <Card>
      <CardHeader icon={<ListChecks />} title={tr('الإجراءات', 'Actions')}
        actions={<>
          <Button size="sm" variant="ghost" onClick={() => setShowDone(!showDone)}>{showDone ? tr('المفتوحة فقط', 'Open only') : tr('إظهار المنجزة', 'Show done')}</Button>
          {can('operations.create') && <Button size="sm" icon={<Plus />} onClick={() => setEditing('new')}>{tr('إجراء', 'Action')}</Button>}
        </>} />
      <CardBody flush>
        <DataTable rows={rows} rowKey={(r) => r.id} exportName={`${ws.bundle.program.code}-actions`} empty={{ title: tr('لا توجد إجراءات مفتوحة', 'No open actions') }}
          columns={[
            { key: 'title', header: tr('الإجراء', 'Action'), render: (r) => <span>{r.title}<span className="sub">{r.code}{r.owner_name ? ` · ${r.owner_name}` : ''} · {enumLabel('priority', r.priority)}</span></span>, value: (r) => r.title },
            { key: 'due', header: tr('الموعد', 'Due'), value: (r) => r.due_date, render: (r) => r.due_date && r.due_date < today && ['open', 'in_progress'].includes(r.status) ? <Badge tone="danger">{fmtDate(r.due_date)}</Badge> : fmtDate(r.due_date) },
            { key: 'priority', header: tr('الأولوية', 'Priority'), value: (r) => r.priority, render: (r) => <Badge tone={r.priority === 'critical' || r.priority === 'high' ? 'danger' : r.priority === 'medium' ? 'warning' : 'info'}>{enumLabel('priority', r.priority)}</Badge> },
            { key: 'status', header: tr('الحالة', 'Status'), value: (r) => r.status, render: (r) => <StatusBadge group="actionStatus" value={r.status} /> },
            { key: 'actions', header: '', hideInExport: true, render: (r) => (
              <RowActions>
                {can('operations.edit') && <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => setEditing(r)} />}
                {can('operations.delete') && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')}
                  onClick={async () => { if (await confirm({ title: tr('حذف الإجراء؟', 'Delete action?'), danger: true })) void del.run(r.id); }} />}
              </RowActions>
            ) },
          ]} />
      </CardBody>
      <RecordFormModal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? tr('إجراء جديد', 'New action') : tr('تعديل الإجراء', 'Edit action')} fields={fields}
        initial={editing && editing !== 'new' ? { ...editing } : { priority: 'medium', status: 'open' }}
        onSubmit={async (v) => {
          const row = { ...v, completed_at: v.status === 'done' ? (editing && editing !== 'new' && editing.completed_at) || new Date().toISOString() : null };
          if (editing && editing !== 'new') await update<ProgramAction>('program_actions', editing.id, row);
          else await insert<ProgramAction>('program_actions', { ...row, organization_id: org.id, program_id: ws.programId, source: 'manual' });
          await ws.reload();
        }} />
    </Card>
  );
}
