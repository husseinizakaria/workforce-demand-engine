import { Link } from 'react-router';
import { FolderKanban, MessagesSquare, NotebookPen, UsersRound } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, DataTable, StatusBadge, type Column } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import type { ExpertAssignment, ProgramProject, ProgramStageRecord, Session, SessionParticipant } from '@/types/db';
import { avg, payloadSummary, round1 } from '../dataUtils';
import { type B360, programName } from './data';

export function MentoringTab({ d }: { d: B360 }) {
  const { tr, pick, enumLabel, fmtDateTime, fmtDate, locale } = useI18n();
  const expertName = (id: string | null | undefined) => { const e = id ? d.experts.get(id) : undefined; return e ? pick(e.full_name, e.full_name_en) : '—'; };
  const aCols: Column<ExpertAssignment>[] = [
    { key: 'expert', header: tr('الخبير', 'Expert'), value: (a) => expertName(a.expert_id), render: (a) => <Link to={`/app/experts/${a.expert_id}/profile`}>{expertName(a.expert_id)}</Link> },
    { key: 'role', header: tr('الدور', 'Role'), value: (a) => enumLabel('expertRole', a.role) },
    { key: 'program', header: tr('البرنامج', 'Program'), value: (a) => programName(d, a.program_id, pick) },
    { key: 'status', header: tr('الحالة', 'Status'), value: (a) => a.status, render: (a) => <StatusBadge group="assignmentStatus" value={a.status} /> },
    { key: 'hours', header: tr('الساعات (منفذة/مخططة)', 'Hours (delivered/planned)'), align: 'end', value: (a) => a.delivered_hours, render: (a) => `${round1(Number(a.delivered_hours))} / ${a.planned_hours ?? '—'}` },
    { key: 'rating', header: tr('تقييم الأداء', 'Performance'), align: 'end', value: (a) => a.performance_rating },
    { key: 'period', header: tr('الفترة', 'Period'), value: (a) => a.starts_on, render: (a) => `${fmtDate(a.starts_on)} – ${fmtDate(a.ends_on)}` },
  ];
  type Row = { p: SessionParticipant; s: Session };
  const rows: Row[] = d.participations.map((p) => ({ p, s: d.sessions.get(p.session_id) })).filter((x): x is Row => !!x.s)
    .sort((a, b) => b.s.starts_at.localeCompare(a.s.starts_at));
  const sCols: Column<Row>[] = [
    { key: 'date', header: tr('الموعد', 'When'), value: (r) => r.s.starts_at, render: (r) => fmtDateTime(r.s.starts_at) },
    { key: 'title', header: tr('الجلسة', 'Session'), value: (r) => r.s.title, render: (r) => <div><b>{r.s.title}</b><span className="sub">{enumLabel('sessionType', r.s.session_type)} · {programName(d, r.s.program_id, pick)}</span></div> },
    { key: 'expert', header: tr('الخبير', 'Expert'), value: (r) => expertName(r.s.expert_id) },
    { key: 'status', header: tr('حالة الجلسة', 'Session status'), value: (r) => r.s.status, render: (r) => <StatusBadge group="sessionStatus" value={r.s.status} /> },
    { key: 'att', header: tr('الحضور', 'Attendance'), value: (r) => r.p.attendance_status, render: (r) => <StatusBadge group="attendance" value={r.p.attendance_status} /> },
    { key: 'fb', header: tr('تقييم المستفيد', 'Feedback'), align: 'end', value: (r) => r.p.feedback_rating },
    { key: 'summary', header: tr('الملخص والتوصيات', 'Summary & recommendations'), value: (r) => [r.s.summary, r.s.recommendations].filter(Boolean).join(' | '),
      render: (r) => (r.s.summary || r.s.recommendations ? <div className="small">{r.s.summary}{r.s.recommendations && <span className="sub">↳ {r.s.recommendations}</span>}</div> : <span className="muted">—</span>) },
  ];
  const notes = d.stageRecords.filter((r) => r.record_type === 'mentoring_note');
  const nCols: Column<ProgramStageRecord>[] = [
    { key: 'date', header: tr('التاريخ', 'Date'), value: (r) => r.created_at, render: (r) => fmtDate(r.created_at) },
    { key: 'program', header: tr('البرنامج', 'Program'), value: (r) => programName(d, r.program_id, pick) },
    { key: 'mentor', header: tr('المرشد', 'Mentor'), value: (r) => expertName(r.expert_id ?? (r.payload.expert_id as string | undefined)) },
    { key: 'details', header: tr('التفاصيل', 'Details'), value: (r) => payloadSummary(r.record_type, r.payload, locale), render: (r) => <span className="small">{payloadSummary(r.record_type, r.payload, locale)}</span> },
    { key: 'status', header: tr('الحالة', 'Status'), value: (r) => r.status, render: (r) => <StatusBadge group="actionStatus" value={r.status} /> },
  ];
  const fb = avg(rows.map((r) => r.p.feedback_rating).filter((x): x is number => x !== null).map(Number));
  return (
    <div className="stack">
      <Card><CardHeader title={tr('تكليفات الخبراء لهذا المستفيد', 'Expert assignments for this beneficiary')} icon={<UsersRound />} /><CardBody flush>
        <DataTable columns={aCols} rows={d.assignments} rowKey={(a) => a.id} empty={{ title: tr('لا يوجد خبير مكلف مباشرة', 'No directly assigned expert') }} />
      </CardBody></Card>
      <Card><CardHeader title={tr('الجلسات', 'Sessions')} icon={<MessagesSquare />} hint={fb !== null ? `${tr('متوسط تقييم المستفيد', 'Avg. feedback')} ${round1(fb)}/5` : undefined} /><CardBody flush>
        <DataTable columns={sCols} rows={rows} rowKey={(r) => r.p.id} pageSize={15} exportName="beneficiary-sessions" empty={{ title: tr('لم يُسجل في أي جلسة', 'Not registered in any session') }} />
      </CardBody></Card>
      <Card><CardHeader title={tr('ملاحظات الإرشاد', 'Mentoring notes')} icon={<NotebookPen />} /><CardBody flush>
        <DataTable columns={nCols} rows={notes} rowKey={(r) => r.id} empty={{ title: tr('لا توجد ملاحظات إرشاد', 'No mentoring notes') }} />
      </CardBody></Card>
    </div>
  );
}

export function ProjectsTab({ d }: { d: B360 }) {
  const { tr, pick, fmtDate } = useI18n();
  const cols: Column<ProgramProject>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), value: (p) => p.code, render: (p) => <span className="mono">{p.code}</span> },
    { key: 'title', header: tr('المشروع', 'Project'), value: (p) => p.title, render: (p) => <div><b>{p.title}</b>{p.description && <span className="sub">{p.description}</span>}</div> },
    { key: 'program', header: tr('البرنامج', 'Program'), value: (p) => programName(d, p.program_id, pick) },
    { key: 'owner', header: tr('الملكية', 'Ownership'), value: (p) => (p.team_id ? d.teams.get(p.team_id)?.name ?? tr('فريق', 'Team') : tr('فردي', 'Individual')),
      render: (p) => p.team_id ? <Badge tone="info">{d.teams.get(p.team_id)?.name ?? tr('فريق', 'Team')}</Badge> : <Badge tone="outline">{tr('فردي', 'Individual')}</Badge> },
    { key: 'status', header: tr('الحالة', 'Status'), value: (p) => p.status, render: (p) => <StatusBadge group="projectStatus" value={p.status} /> },
    { key: 'score', header: tr('الدرجة', 'Score'), align: 'end', value: (p) => p.score },
    { key: 'due', header: tr('الاستحقاق', 'Due'), value: (p) => p.due_date, render: (p) => fmtDate(p.due_date) },
  ];
  return (
    <div className="stack">
      <Card><CardHeader title={tr('المشاريع', 'Projects')} icon={<FolderKanban />} hint={tr('مشاريع المستفيد الفردية ومشاريع فرقه', 'Individual projects and those of the teams they belong to')} /><CardBody flush>
        <DataTable columns={cols} rows={d.projects} rowKey={(p) => p.id} empty={{ title: tr('لا توجد مشاريع', 'No projects') }} />
      </CardBody></Card>
      <Card><CardHeader title={tr('عضوية الفرق', 'Team memberships')} icon={<UsersRound />} /><CardBody>
        {d.memberships.length === 0 ? <p className="small muted">{tr('ليس عضوًا في أي فريق.', 'Not a member of any team.')}</p> : (
          <ul className="list-plain small">
            {d.memberships.map((m) => { const t = d.teams.get(m.team_id); return (
              <li key={m.id} className="row between"><span><b>{t?.name ?? '—'}</b> {t?.project_title ? `· ${t.project_title}` : ''} · {t ? programName(d, t.program_id, pick) : ''}</span>
                <span className="row">{m.role === 'lead' ? <Badge tone="primary">{tr('قائد', 'Lead')}</Badge> : <Badge tone="outline">{tr('عضو', 'Member')}</Badge>}{t && <StatusBadge group="teamStatus" value={t.status} />}</span></li>
            ); })}
          </ul>
        )}
      </CardBody></Card>
    </div>
  );
}
