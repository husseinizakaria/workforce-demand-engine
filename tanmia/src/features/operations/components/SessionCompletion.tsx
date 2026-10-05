import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ListPlus } from 'lucide-react';
import { Badge, Button, Checkbox, Field, Input, Notice, Select, StatusBadge, TagInput, Textarea, useToast } from '@/components/ui';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { insertMany, update } from '@/services/db';
import { addDaysISO, todayISO } from '@/utils/dates';
import type { ProgramAction, Session, SessionParticipant } from '@/types/db';
import { errMsg } from '@/features/beneficiaries/components/dataUtils';

interface Draft { title: string; include: boolean; due: string; priority: string }

export function SessionCompletion({ session, participants, actions, onChanged }: {
  session: Session; participants: SessionParticipant[]; actions: ProgramAction[]; onChanged: () => void;
}) {
  const { org, can } = useOrg();
  const { tr, enumOptions, fmtDate, locale } = useI18n();
  const toast = useToast();
  const [summary, setSummary] = useState(session.summary ?? '');
  const [recs, setRecs] = useState(session.recommendations ?? '');
  const [topics, setTopics] = useState<string[]>(session.topics ?? []);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  useEffect(() => { setSummary(session.summary ?? ''); setRecs(session.recommendations ?? ''); setTopics(session.topics ?? []); }, [session]);

  const existing = useMemo(() => new Set(actions.map((a) => a.title.trim())), [actions]);
  useEffect(() => {
    const lines = recs.split(/\r?\n/).map((l) => l.replace(/^[-*•\d.)\s]+/, '').trim()).filter((l) => l.length > 2);
    setDrafts((prev) => lines.map((l) => prev.find((p) => p.title === l) ?? { title: l, include: !existing.has(l), due: addDaysISO(todayISO(), 14), priority: 'medium' }));
  }, [recs, existing]);

  const unrecorded = participants.filter((p) => p.attendance_status === 'unknown').length;
  const future = new Date(session.ends_at).getTime() > Date.now();
  const editable = can('operations.edit');
  const done = session.status === 'completed';

  const complete = async (markCompleted: boolean) => {
    setBusy(true);
    try {
      await update<Session>('sessions', session.id, { summary: summary.trim() || null, recommendations: recs.trim() || null, topics, ...(markCompleted ? { status: 'completed' } : {}) });
      toast.success(markCompleted ? tr('أُغلقت الجلسة كمكتملة', 'Session closed as completed') : tr('تم الحفظ', 'Saved'));
      onChanged();
    } catch (e) { toast.error(errMsg(e, locale)); } finally { setBusy(false); }
  };
  const createActions = async () => {
    const sel = drafts.filter((d) => d.include && !existing.has(d.title));
    if (!sel.length) return;
    setBusy(true);
    try {
      await insertMany<ProgramAction>('program_actions', sel.map((d) => ({
        organization_id: org.id, program_id: session.program_id, session_id: session.id, expert_id: session.expert_id, stage_key: session.stage_key,
        title: d.title.slice(0, 300), due_date: d.due || null, priority: d.priority, status: 'open', source: 'session',
        description: tr(`من توصيات الجلسة ${session.code}`, `From recommendations of session ${session.code}`),
      })));
      toast.success(tr(`أُنشئ ${sel.length} إجراء متابعة`, `${sel.length} follow-up actions created`));
      onChanged();
    } catch (e) { toast.error(errMsg(e, locale)); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      {done && <Notice tone="success" icon={<CheckCircle2 />}>{tr('الجلسة مكتملة', 'Session completed')} {session.completed_at ? `· ${fmtDate(session.completed_at)}` : ''}</Notice>}
      {!done && future && <Notice tone="info">{tr('لم تنتهِ الجلسة بعد؛ الإغلاق كمكتملة يُحتسب في ساعات الخبير المنفذة.', 'The session has not ended yet; closing it as completed counts toward the expert’s delivered hours.')}</Notice>}
      {!done && unrecorded > 0 && <Notice tone="warning">{tr(`${unrecorded} مشارك بلا حضور مسجل. سجّل الحضور قبل الإغلاق لدقة مؤشرات الحضور.`, `${unrecorded} participants have no attendance recorded. Record attendance before closing for accurate attendance indicators.`)}</Notice>}
      <div className="form-grid">
        <Field label={tr('ملخص الجلسة', 'Session summary')} className="full"><Textarea rows={3} value={summary} disabled={!editable} onChange={(e) => setSummary(e.target.value)} /></Field>
        <Field label={tr('التوصيات (سطر لكل توصية)', 'Recommendations (one per line)')} className="full"><Textarea rows={3} value={recs} disabled={!editable} onChange={(e) => setRecs(e.target.value)} /></Field>
        <Field label={tr('المحاور المغطاة', 'Topics covered')} className="full"><TagInput value={topics} onChange={setTopics} /></Field>
      </div>
      {editable && (
        <div className="row wrap">
          <Button loading={busy} onClick={() => void complete(false)}>{tr('حفظ', 'Save')}</Button>
          {!done && !['cancelled', 'rescheduled'].includes(session.status) && <Button variant="primary" icon={<CheckCircle2 />} loading={busy} disabled={!summary.trim()} onClick={() => void complete(true)}>{tr('إغلاق كمكتملة', 'Close as completed')}</Button>}
          {!done && !summary.trim() && <span className="tiny muted">{tr('الملخص مطلوب للإغلاق', 'A summary is required to close')}</span>}
        </div>
      )}
      <div className="card card-pad stack-sm">
        <div className="row between"><b className="small"><ListPlus size={14} /> {tr('إنشاء إجراءات متابعة من التوصيات', 'Create follow-up actions from recommendations')}</b>
          {can('operations.create') && <Button size="sm" variant="primary" loading={busy} disabled={!drafts.some((d) => d.include && !existing.has(d.title))} onClick={() => void createActions()}>{tr('إنشاء المحدد', 'Create selected')}</Button>}</div>
        {drafts.length === 0 && <span className="small muted">{tr('اكتب التوصيات أعلاه (سطر لكل توصية) لتحويلها إلى إجراءات.', 'Write recommendations above (one per line) to turn them into actions.')}</span>}
        {drafts.map((d, i) => (
          <div key={i} className="row wrap" style={{ gap: 6 }}>
            <Checkbox label={<span className="small">{d.title}</span>} checked={d.include && !existing.has(d.title)} disabled={existing.has(d.title)} onChange={(c) => setDrafts((ds) => ds.map((x, j) => (j === i ? { ...x, include: c } : x)))} />
            {existing.has(d.title) ? <Badge tone="success">{tr('أُنشئ', 'Created')}</Badge> : <>
              <Input type="date" value={d.due} style={{ width: 150 }} onChange={(e) => setDrafts((ds) => ds.map((x, j) => (j === i ? { ...x, due: e.target.value } : x)))} />
              <Select options={enumOptions('priority')} value={d.priority} style={{ width: 110 }} onChange={(e) => setDrafts((ds) => ds.map((x, j) => (j === i ? { ...x, priority: e.target.value } : x)))} />
            </>}
          </div>
        ))}
        {actions.length > 0 && (
          <ul className="list-plain small">
            {actions.map((a) => <li key={a.id} className="row between"><span><span className="mono">{a.code}</span> {a.title}</span><span className="row">{fmtDate(a.due_date)}<StatusBadge group="actionStatus" value={a.status} /></span></li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
