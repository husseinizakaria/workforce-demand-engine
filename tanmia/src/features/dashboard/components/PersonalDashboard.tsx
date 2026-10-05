// Personal dashboard for beneficiaries and experts (users without programs.view).
// Everything here is read through the self-service RLS policies.
import { useState } from 'react';
import { Link } from 'react-router';
import { Bell, CalendarDays, ClipboardList, FolderKanban, UserRound } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAuth } from '@/app/AuthProvider';
import { AsyncView, Badge, Button, Card, CardBody, CardHeader, EmptyState, Kpi, PageHeader, Progress, StatusBadge } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { all, list } from '@/services/db';
import type {
  AppNotification, Beneficiary, Expert, ExpertAssignment, FormSubmission, FormTemplate, Program, ProgramEnrollment, Session, SessionParticipant,
} from '@/types/db';
import { FormFillModal } from './FormFillModal';

interface PersonalData {
  beneficiaries: Pick<Beneficiary, 'id' | 'code' | 'full_name'>[];
  experts: Pick<Expert, 'id' | 'code' | 'full_name'>[];
  enrollments: ProgramEnrollment[];
  assignments: ExpertAssignment[];
  programs: Record<string, Pick<Program, 'id' | 'code' | 'name' | 'name_en' | 'status' | 'start_date' | 'end_date'>>;
  sessions: Session[];
  forms: FormTemplate[];
  notifications: AppNotification[];
}

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> { try { return await p; } catch { return fallback; } }

export function PersonalDashboard() {
  const { tr, pick, enumLabel, fmtDate, fmtDateTime, fmtTime, fmtNumber } = useI18n();
  const { org } = useOrg();
  const { user, access } = useAuth();
  const [filling, setFilling] = useState<FormTemplate | null>(null);

  const state = useAsync<PersonalData>(async () => {
    const uid = user?.id ?? '';
    const orgF: [string, 'eq', string] = ['organization_id', 'eq', org.id];
    const [bens, exps] = await Promise.all([
      safe(all<Beneficiary>('beneficiaries', { select: 'id,code,full_name', filters: [orgF, ['user_id', 'eq', uid]], order: { column: 'full_name', ascending: true } }), []),
      safe(all<Expert>('experts', { select: 'id,code,full_name', filters: [orgF, ['user_id', 'eq', uid]], order: { column: 'full_name', ascending: true } }), []),
    ]);
    const benIds = bens.map((b) => b.id); const expIds = exps.map((e) => e.id);
    const nowIso = new Date().toISOString();
    const [enrollments, assignments, participants, expertSessions, forms, submissions, notifications] = await Promise.all([
      benIds.length ? safe(all<ProgramEnrollment>('program_enrollments', { filters: [orgF, ['beneficiary_id', 'in', benIds]], order: { column: 'enrolled_at' } }), []) : Promise.resolve([]),
      expIds.length ? safe(all<ExpertAssignment>('expert_assignments', { filters: [orgF, ['expert_id', 'in', expIds]] }), []) : Promise.resolve([]),
      benIds.length ? safe(all<SessionParticipant>('session_participants', { select: 'id,session_id,beneficiary_id', filters: [orgF, ['beneficiary_id', 'in', benIds]], order: { column: 'session_id' } }), []) : Promise.resolve([]),
      expIds.length ? safe(list<Session>('sessions', { filters: [orgF, ['expert_id', 'in', expIds], ['status', 'eq', 'scheduled'], ['starts_at', 'gte', nowIso]], order: { column: 'starts_at', ascending: true }, pageSize: 20 }).then((r) => r.rows), []) : Promise.resolve([]),
      safe(all<FormTemplate>('form_templates', { filters: [orgF, ['status', 'eq', 'published'], ['form_type', 'in', ['feedback', 'follow_up']]], order: { column: 'title', ascending: true } }, 200), []),
      safe(all<FormSubmission>('form_submissions', { select: 'id,template_id,status', filters: [orgF, ['submitted_by', 'eq', uid]], order: { column: 'submitted_at' } }, 2000), []),
      safe(list<AppNotification>('notifications', { filters: [orgF, ['user_id', 'eq', uid], ['channel', 'eq', 'in_app'], ['scheduled_for', 'lte', nowIso], ['status', 'in', ['sent', 'queued', 'scheduled', 'read']]], order: { column: 'scheduled_for' }, pageSize: 6 }).then((r) => r.rows), []),
    ]);
    const sessIds = [...new Set(participants.map((p) => p.session_id))];
    const benSessions = sessIds.length
      ? await safe(list<Session>('sessions', { filters: [orgF, ['id', 'in', sessIds.slice(0, 300)], ['status', 'eq', 'scheduled'], ['starts_at', 'gte', nowIso]], order: { column: 'starts_at', ascending: true }, pageSize: 20 }).then((r) => r.rows), [])
      : [];
    const sessions = [...new Map([...benSessions, ...expertSessions].map((s) => [s.id, s])).values()].sort((a, b) => a.starts_at.localeCompare(b.starts_at)).slice(0, 15);
    const progIds = [...new Set([...enrollments.map((e) => e.program_id), ...assignments.map((a) => a.program_id), ...sessions.map((s) => s.program_id).filter(Boolean) as string[]])];
    const progs = progIds.length
      ? await safe(all<Program>('programs', { select: 'id,code,name,name_en,status,start_date,end_date', filters: [orgF, ['id', 'in', progIds]], order: { column: 'name', ascending: true } }), [])
      : [];
    const submitted = new Set(submissions.map((s) => s.template_id));
    const myPrograms = new Set(progIds);
    const pendingForms = forms.filter((f) => !submitted.has(f.id) && (!f.program_id || myPrograms.has(f.program_id)));
    return {
      beneficiaries: bens, experts: exps, enrollments, assignments, programs: Object.fromEntries(progs.map((p) => [p.id, p])),
      sessions, forms: pendingForms, notifications,
    };
  }, [org.id, user?.id]);

  const name = access?.profile?.full_name ?? user?.email ?? '';
  return (
    <div className="stack">
      <PageHeader title={tr(`مرحبًا ${name}`, `Welcome, ${name}`)} subtitle={tr('ملخصك الشخصي: برامجك وجلساتك القادمة والنماذج المطلوبة منك.', 'Your personal summary: your programs, upcoming sessions and forms awaiting you.')} />
      <AsyncView state={state}>
        {(d) => {
          const progName = (id: string | null) => (id && d.programs[id] ? pick(d.programs[id].name, d.programs[id].name_en) : '—');
          const noLink = !d.beneficiaries.length && !d.experts.length;
          return (
            <>
              {noLink && (
                <Card><EmptyState icon={<UserRound />} title={tr('حسابك غير مرتبط بسجل مستفيد أو خبير', 'Your account is not linked to a beneficiary or expert record')}
                  description={tr('اطلب من مدير المؤسسة ربط حسابك (عبر دعوة مرتبطة) لتظهر برامجك وجلساتك هنا.', 'Ask your organization admin to link your account (via a linked invitation) so your programs and sessions appear here.')} /></Card>
              )}
              <div className="grid g4">
                <Kpi label={tr('التحاقاتي', 'My enrollments')} value={fmtNumber(d.enrollments.length)} icon={<FolderKanban />} />
                <Kpi label={tr('تكليفاتي كخبير', 'My expert assignments')} value={fmtNumber(d.assignments.length)} icon={<UserRound />} />
                <Kpi label={tr('جلسات قادمة', 'Upcoming sessions')} value={fmtNumber(d.sessions.length)} icon={<CalendarDays />} />
                <Kpi label={tr('نماذج بانتظاري', 'Forms awaiting me')} value={fmtNumber(d.forms.length)} icon={<ClipboardList />} tone={d.forms.length ? 'warning' : undefined} />
              </div>
              <div className="grid g2">
                <Card>
                  <CardHeader title={tr('برامجي', 'My programs')} icon={<FolderKanban />} />
                  <CardBody>
                    {!d.enrollments.length && !d.assignments.length ? <p className="muted small">{tr('لا توجد التحاقات أو تكليفات.', 'No enrollments or assignments.')}</p> : (
                      <ul className="list-plain">
                        {d.enrollments.map((e) => (
                          <li key={e.id} className="stack-sm" style={{ gap: 4 }}>
                            <div className="row between"><b>{progName(e.program_id)}</b><StatusBadge group="enrollmentStatus" value={e.status} /></div>
                            <div className="row"><span className="tiny muted">{tr('التقدم', 'Progress')}</span><div className="grow"><Progress value={e.progress} /></div><span className="tiny">{fmtNumber(e.progress)}%</span></div>
                          </li>
                        ))}
                        {d.assignments.map((a) => (
                          <li key={a.id} className="row between">
                            <span><b>{progName(a.program_id)}</b> <span className="muted small">· {enumLabel('expertRole', a.role)}</span></span>
                            <span className="row"><span className="tiny muted">{fmtNumber(a.delivered_hours, 1)}/{fmtNumber(a.planned_hours, 1)} {tr('ساعة', 'h')}</span><StatusBadge group="assignmentStatus" value={a.status} /></span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title={tr('جلساتي القادمة', 'My upcoming sessions')} icon={<CalendarDays />} />
                  <CardBody>
                    {!d.sessions.length ? <p className="muted small">{tr('لا توجد جلسات مجدولة.', 'No scheduled sessions.')}</p> : (
                      <ul className="list-plain">
                        {d.sessions.map((s) => (
                          <li key={s.id} className="stack-sm" style={{ gap: 2 }}>
                            <div className="row between"><b className="small">{s.title}</b><Badge tone="outline">{enumLabel('sessionType', s.session_type)}</Badge></div>
                            <span className="tiny muted">{fmtDateTime(s.starts_at)} – {fmtTime(s.ends_at)} · {enumLabel('deliveryMode', s.delivery_mode)}{s.location ? ` · ${s.location}` : ''} · {progName(s.program_id)}</span>
                            {s.meeting_url && <a className="tiny ltr" href={s.meeting_url} target="_blank" rel="noreferrer">{tr('رابط الاجتماع', 'Meeting link')}</a>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title={tr('نماذج مطلوبة مني', 'Forms awaiting me')} icon={<ClipboardList />} hint={tr('تقييم الرضا والمتابعة', 'Feedback & follow-up')} />
                  <CardBody>
                    {!d.forms.length ? <p className="muted small">{tr('لا توجد نماذج معلقة.', 'No pending forms.')}</p> : (
                      <ul className="list-plain">
                        {d.forms.map((f) => (
                          <li key={f.id} className="row between">
                            <span><b className="small">{pick(f.title, f.title_en)}</b> <span className="tiny muted">· {enumLabel('formType', f.form_type)}{f.program_id ? ` · ${progName(f.program_id)}` : ''}</span></span>
                            <Button size="sm" variant="primary" onClick={() => setFilling(f)}>{tr('تعبئة', 'Fill in')}</Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title={tr('أحدث الإشعارات', 'Latest notifications')} icon={<Bell />} actions={<Link className="small" to="/app/notifications">{tr('الكل', 'All')}</Link>} />
                  <CardBody>
                    {!d.notifications.length ? <p className="muted small">{tr('لا توجد إشعارات.', 'No notifications.')}</p> : (
                      <ul className="list-plain">
                        {d.notifications.map((n) => (
                          <li key={n.id} className="stack-sm" style={{ gap: 2 }}>
                            <div className="row between"><b className="small">{n.title}</b>{n.status !== 'read' && <Badge tone="primary">{tr('جديد', 'New')}</Badge>}</div>
                            {n.body && <span className="tiny muted">{n.body}</span>}
                            <span className="tiny muted">{fmtDate(n.scheduled_for)}{n.link ? <> · <Link to={n.link}>{tr('فتح', 'Open')}</Link></> : null}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardBody>
                </Card>
              </div>
              <FormFillModal template={filling} beneficiaryId={filling?.program_id
                ? d.enrollments.find((e) => e.program_id === filling.program_id)?.beneficiary_id ?? d.beneficiaries[0]?.id ?? null
                : d.beneficiaries[0]?.id ?? null}
                onClose={() => setFilling(null)} onDone={() => void state.reload()} />
            </>
          );
        }}
      </AsyncView>
    </div>
  );
}
