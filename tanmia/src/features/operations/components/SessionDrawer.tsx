// Session detail drawer: details, reschedule, cancel, attendance, completion,
// follow-up actions, evidence and ICS download.
import { useState } from 'react';
import { Link } from 'react-router';
import { CalendarClock, CalendarDays, CalendarX2, Download, ExternalLink } from 'lucide-react';
import { Badge, Button, Checkbox, Drawer, Field, Input, Modal, Notice, StatusBadge, Tabs, Textarea, useToast } from '@/components/ui';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { useAsync } from '@/hooks/useAsync';
import { all, get, insert, insertMany, rpc, update } from '@/services/db';
import { callFunction } from '@/services/functions';
import { errorOf } from '@/services/errors';
import { downloadBlob } from '@/utils/csv';
import { fromLocalInput, minutesBetween, toLocalInput } from '@/utils/dates';
import type { Beneficiary, Evidence, ProgramAction, Session, SessionParticipant } from '@/types/db';
import { allIn, errMsg, safe } from '@/features/beneficiaries/components/dataUtils';
import { ConflictList } from './ConflictList';
import { isOpenStatus, notify, type OpsRefs, type RpcConflict, sessionHours } from './ops';
import { SessionAttendance } from './SessionAttendance';
import { SessionCompletion } from './SessionCompletion';
import { SessionEvidence } from './SessionEvidence';

async function loadSession(orgId: string, id: string) {
  const session = await get<Session>('sessions', id);
  const [participants, evidence, actions] = await Promise.all([
    all<SessionParticipant>('session_participants', { filters: [['session_id', 'eq', id]], order: { column: 'created_at', ascending: true } }),
    safe(all<Evidence>('evidence', { filters: [['organization_id', 'eq', orgId], ['session_id', 'eq', id]] })),
    safe(all<ProgramAction>('program_actions', { filters: [['organization_id', 'eq', orgId], ['session_id', 'eq', id]] })),
  ]);
  const bens = await safe(allIn<Pick<Beneficiary, 'id' | 'full_name' | 'full_name_en' | 'code'>>('beneficiaries', 'id', participants.map((p) => p.beneficiary_id), { select: 'id,full_name,full_name_en,code' }));
  return { session, participants, evidence, actions, bens };
}

export function SessionDrawer({ sessionId, refs, onClose, onChanged, onOpen }: {
  sessionId: string; refs: OpsRefs; onClose: () => void; onChanged: () => void; onOpen: (id: string) => void;
}) {
  const { org, can } = useOrg();
  const { tr, pick, enumLabel, fmtDateTime, fmtTime, fmtNumber, locale } = useI18n();
  const toast = useToast();
  const state = useAsync(() => loadSession(org.id, sessionId), [org.id, sessionId]);
  const [tab, setTab] = useState('details');
  const [mode, setMode] = useState<'reschedule' | 'cancel' | null>(null);
  const [icsBusy, setIcsBusy] = useState(false);
  const refresh = () => { void state.reload(); onChanged(); };

  const d = state.data;
  const s = d?.session;
  const names = new Map((d?.bens ?? []).map((b) => [b.id, `${pick(b.full_name, b.full_name_en)} · ${b.code}`]));

  const ics = async () => {
    if (!s) return;
    setIcsBusy(true);
    try {
      const r = await callFunction<{ filename?: string; ics: string }>('calendar-sync', { action: 'ics', organization_id: org.id, scope: 'session', id: s.id });
      downloadBlob(r.filename || `${s.code}.ics`, new Blob([r.ics], { type: 'text/calendar;charset=utf-8' }));
    } catch (e) {
      const err = errorOf(e);
      toast.error(err.code === 'function_unavailable' ? tr('خدمة التقويم غير منشورة؛ تعذر توليد ملف ICS.', 'The calendar service is not deployed; the ICS file could not be generated.') : (locale === 'ar' ? err.message_ar : err.message_en));
    } finally { setIcsBusy(false); }
  };

  const program = s?.program_id ? refs.programMap.get(s.program_id) : undefined;
  const expert = s?.expert_id ? refs.expertMap.get(s.expert_id) : undefined;
  return (
    <Drawer open onClose={onClose} wide title={s ? <span className="row"><CalendarDays size={16} />{s.title} <span className="mono small muted">{s.code}</span></span> : tr('الجلسة', 'Session')}>
      {state.error ? <Notice tone="danger">{locale === 'ar' ? state.error.message_ar : state.error.message_en}</Notice> : !d || !s ? <p className="muted">{tr('جارٍ التحميل…', 'Loading…')}</p> : (
        <div className="stack">
          <div className="row wrap between">
            <div className="row wrap"><StatusBadge group="sessionStatus" value={s.status} /><Badge tone="outline">{enumLabel('sessionType', s.session_type)}</Badge><span className="small">{fmtDateTime(s.starts_at)} – {fmtTime(s.ends_at)}</span></div>
            <div className="row wrap">
              <Button size="sm" icon={<Download />} loading={icsBusy} onClick={() => void ics()}>{tr('ملف تقويم ICS', 'ICS file')}</Button>
              {isOpenStatus(s.status) && can('operations.edit') && <>
                <Button size="sm" icon={<CalendarClock />} onClick={() => setMode('reschedule')}>{tr('إعادة جدولة', 'Reschedule')}</Button>
                <Button size="sm" variant="danger" icon={<CalendarX2 />} onClick={() => setMode('cancel')}>{tr('إلغاء', 'Cancel')}</Button>
              </>}
            </div>
          </div>
          <Tabs value={tab} onChange={setTab} items={[
            { key: 'details', label: tr('التفاصيل', 'Details') },
            { key: 'attendance', label: tr('الحضور', 'Attendance'), badge: <span className="badge">{d.participants.length}</span> },
            { key: 'completion', label: tr('الإغلاق والإجراءات', 'Completion & actions') },
            { key: 'evidence', label: tr('الأدلة', 'Evidence'), badge: <span className="badge">{d.evidence.length}</span> },
          ]} />
          {tab === 'details' && (
            <dl className="kv">
              <dt>{tr('البرنامج', 'Program')}</dt><dd>{program ? <Link to={`/app/programs/${program.id}`}>{pick(program.name, program.name_en)}</Link> : '—'}</dd>
              <dt>{tr('الدفعة / الفريق', 'Cohort / team')}</dt><dd>{[s.cohort_id ? refs.cohortMap.get(s.cohort_id)?.name : null, s.team_id ? refs.teamMap.get(s.team_id)?.name : null].filter(Boolean).join(' · ') || '—'}</dd>
              <dt>{tr('المرحلة', 'Stage')}</dt><dd>{s.stage_key ?? '—'}</dd>
              <dt>{tr('الخبير', 'Expert')}</dt><dd>{expert ? <Link to={`/app/experts/${expert.id}/availability`}>{pick(expert.full_name, expert.full_name_en)}</Link> : <Badge tone="warning">{tr('غير مسند', 'Unassigned')}</Badge>}</dd>
              <dt>{tr('المدة', 'Duration')}</dt><dd>{fmtNumber(sessionHours(s), 2)} {tr('ساعة', 'h')}</dd>
              <dt>{tr('طريقة التقديم', 'Delivery')}</dt><dd>{enumLabel('deliveryMode', s.delivery_mode)}</dd>
              <dt>{tr('المكان', 'Location')}</dt><dd>{s.location ?? '—'}</dd>
              <dt>{tr('الرابط', 'Meeting link')}</dt><dd>{s.meeting_url ? <a href={s.meeting_url} target="_blank" rel="noreferrer" className="ltr">{s.meeting_url} <ExternalLink size={12} /></a> : '—'}</dd>
              <dt>{tr('السعة', 'Capacity')}</dt><dd>{s.capacity ?? '—'} {s.capacity && d.participants.length > s.capacity ? <Badge tone="warning">{tr('تجاوز السعة', 'Over capacity')}</Badge> : null}</dd>
              <dt>{tr('المحاور', 'Topics')}</dt><dd>{s.topics.length ? <span className="row wrap" style={{ gap: 4 }}>{s.topics.map((t) => <span key={t} className="tag">{t}</span>)}</span> : '—'}</dd>
              <dt>{tr('جدول الأعمال', 'Agenda')}</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{s.agenda ?? '—'}</dd>
              {s.rescheduled_from && <><dt>{tr('أعيدت جدولتها من', 'Rescheduled from')}</dt><dd><a href="#" onClick={(e) => { e.preventDefault(); onOpen(s.rescheduled_from!); }}>{tr('الجلسة الأصلية', 'Original session')}</a></dd></>}
              {s.cancelled_reason && <><dt>{tr('سبب الإلغاء', 'Cancellation reason')}</dt><dd>{s.cancelled_reason}</dd></>}
              {s.summary && <><dt>{tr('الملخص', 'Summary')}</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{s.summary}</dd></>}
            </dl>
          )}
          {tab === 'attendance' && <SessionAttendance session={s} participants={d.participants} names={names} onChanged={refresh} />}
          {tab === 'completion' && <SessionCompletion session={s} participants={d.participants} actions={d.actions} onChanged={refresh} />}
          {tab === 'evidence' && <SessionEvidence session={s} evidence={d.evidence} onChanged={refresh} />}
          {mode === 'reschedule' && <RescheduleModal session={s} participants={d.participants} names={names} onClose={() => setMode(null)} onDone={(n) => { setMode(null); onChanged(); onOpen(n.id); }} />}
          {mode === 'cancel' && <CancelModal session={s} onClose={() => setMode(null)} onDone={() => { setMode(null); refresh(); }} />}
        </div>
      )}
    </Drawer>
  );
}

function RescheduleModal({ session, participants, names, onClose, onDone }: {
  session: Session; participants: SessionParticipant[]; names: Map<string, string>; onClose: () => void; onDone: (s: Session) => void;
}) {
  const { org } = useOrg();
  const { tr, locale } = useI18n();
  const toast = useToast();
  const [starts, setStarts] = useState(toLocalInput(session.starts_at));
  const [ends, setEnds] = useState(toLocalInput(session.ends_at));
  const [reason, setReason] = useState('');
  const [conflicts, setConflicts] = useState<RpcConflict[] | null>(null);
  const [checked, setChecked] = useState('');
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const key = `${starts}|${ends}`;
  const valid = starts && ends && minutesBetween(fromLocalInput(starts), fromLocalInput(ends)) > 0 && minutesBetween(fromLocalInput(starts), fromLocalInput(ends)) <= 1440;
  const high = (conflicts ?? []).some((c) => c.severity === 'high');
  const stale = checked !== key;

  const check = async () => {
    setErr(null);
    try {
      const r = await rpc<RpcConflict[]>('check_session_conflicts', {
        p_org: org.id, p_starts: fromLocalInput(starts), p_ends: fromLocalInput(ends), p_expert: session.expert_id, p_beneficiaries: participants.map((p) => p.beneficiary_id),
        p_location: session.delivery_mode === 'online' ? null : session.location, p_exclude: session.id, p_program: session.program_id,
      });
      setConflicts(Array.isArray(r) ? r : []); setChecked(key); setOverride(false);
      return Array.isArray(r) ? r : [];
    } catch (e) { setErr(errMsg(e, locale)); return null; }
  };
  const save = async () => {
    setBusy(true);
    try {
      let list = conflicts;
      if (stale || !list) { list = await check(); if (!list || list.length) return; }
      if (list.some((c) => c.severity === 'high') && !override) return;
      const n = await insert<Session>('sessions', {
        organization_id: org.id, program_id: session.program_id, cohort_id: session.cohort_id, team_id: session.team_id, expert_id: session.expert_id,
        title: session.title, session_type: session.session_type, stage_key: session.stage_key, starts_at: fromLocalInput(starts), ends_at: fromLocalInput(ends),
        timezone: session.timezone, delivery_mode: session.delivery_mode, location: session.location, meeting_url: session.meeting_url, capacity: session.capacity,
        topics: session.topics, agenda: session.agenda, status: 'scheduled', rescheduled_from: session.id,
      });
      if (participants.length) await insertMany('session_participants', participants.map((p) => ({ organization_id: org.id, session_id: n.id, beneficiary_id: p.beneficiary_id })));
      await update<Session>('sessions', session.id, { status: 'rescheduled', cancelled_reason: reason.trim() || null });
      toast.success(tr(`أعيدت الجدولة إلى ${n.code}`, `Rescheduled as ${n.code}`));
      const r = await notify(org.id, 'session_rescheduled', n.id, { previous_session_id: session.id, reason: reason.trim() || null });
      if (!r.ok) toast.info(r.unavailable ? tr('خدمة الإشعارات غير منشورة؛ لم تُرسل إشعارات.', 'Notification service not deployed; no notifications were sent.') : (locale === 'ar' ? r.message_ar : r.message_en));
      onDone(n);
    } catch (e) { setErr(errMsg(e, locale)); } finally { setBusy(false); }
  };
  const benName = (id: string) => names.get(id) ?? id.slice(0, 8);
  return (
    <Modal open onClose={onClose} title={tr('إعادة جدولة الجلسة', 'Reschedule session')}
      footer={<><Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button>
        <Button variant={high && !stale ? 'danger' : 'primary'} loading={busy} disabled={!valid || (!stale && high && !override)} onClick={() => void save()}>
          {stale || !conflicts ? tr('فحص ثم إعادة الجدولة', 'Check & reschedule') : high ? tr('إعادة الجدولة على أي حال', 'Reschedule anyway') : tr('تأكيد إعادة الجدولة', 'Confirm reschedule')}
        </Button></>}>
      <div className="stack-sm">
        <p className="small muted">{tr('تُنشأ جلسة جديدة مرتبطة بالأصلية وتُنقل إليها قائمة المشاركين، وتُعلّم الأصلية «أعيدت جدولتها».', 'A new session linked to the original is created with the same participants; the original is marked “rescheduled”.')}</p>
        <div className="form-grid">
          <Field label={tr('البداية الجديدة', 'New start')}><Input type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} /></Field>
          <Field label={tr('النهاية الجديدة', 'New end')}><Input type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} /></Field>
          <Field label={tr('السبب', 'Reason')} className="full"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
        {!valid && <Notice tone="danger">{tr('نطاق زمني غير صالح', 'Invalid time range')}</Notice>}
        {err && <Notice tone="danger">{err}</Notice>}
        {conflicts && !stale && <ConflictList conflicts={conflicts} benName={benName} />}
        {high && !stale && <Checkbox label={<b>{tr('إعادة الجدولة رغم التعارضات عالية الخطورة', 'Reschedule despite high-severity conflicts')}</b>} checked={override} onChange={setOverride} />}
      </div>
    </Modal>
  );
}

function CancelModal({ session, onClose, onDone }: { session: Session; onClose: () => void; onDone: () => void }) {
  const { org } = useOrg();
  const { tr, locale } = useI18n();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await update<Session>('sessions', session.id, { status: 'cancelled', cancelled_reason: reason.trim() });
      toast.success(tr('أُلغيت الجلسة', 'Session cancelled'));
      const r = await notify(org.id, 'session_cancelled', session.id, { reason: reason.trim() });
      if (!r.ok) toast.info(r.unavailable ? tr('خدمة الإشعارات غير منشورة؛ لم يُبلغ المشاركون.', 'Notification service not deployed; participants were not notified.') : (locale === 'ar' ? r.message_ar : r.message_en));
      onDone();
    } catch (e) { toast.error(errMsg(e, locale)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="narrow" title={tr('إلغاء الجلسة', 'Cancel session')}
      footer={<><Button onClick={onClose}>{tr('رجوع', 'Back')}</Button><Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={() => void run()}>{tr('تأكيد الإلغاء', 'Confirm cancellation')}</Button></>}>
      <Field label={tr('سبب الإلغاء', 'Cancellation reason')} required><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <p className="small muted">{tr('سيُبلغ المشاركون والخبير وفق قواعد الإشعارات.', 'Participants and the expert are notified according to notification rules.')}</p>
    </Modal>
  );
}
