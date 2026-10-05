// Session scheduling (with server-side conflict check), attendance grid,
// completion and cancellation dialogs for the Delivery tab.
import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCheck, UserPlus } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useToast } from '@/components/ui/Toast';
import {
  Badge, Button, Checkbox, DataTable, EntityPicker, Field, Input, Modal, Notice, Segmented, Select, Textarea,
} from '@/components/ui';
import { insert, insertMany, remove, rpc, update, updateWhere } from '@/services/db';
import { errorOf, type AppError } from '@/services/errors';
import { fromLocalInput } from '@/utils/dates';
import type { AttendanceStatus, ProgramAction, Session, SessionParticipant } from '@/types/db';
import { errText, notifySessionEvent } from '../../lib';
import { useWorkspace } from '../context';

export interface ConflictRow { type: string; severity: 'high' | 'medium' | 'low'; code?: string; title?: string; starts_at?: string; beneficiary_id?: string; hours?: number; max?: number; note?: string | null; start_date?: string; end_date?: string }

export function useConflictLabel() {
  const { tr, fmtDateTime, fmtNumber, fmtDate } = useI18n();
  const ws = useWorkspace();
  return (c: ConflictRow): string => {
    const ref = c.code ? ` ${c.code} «${c.title ?? ''}» ${fmtDateTime(c.starts_at)}` : '';
    switch (c.type) {
      case 'invalid_range': return tr('وقت النهاية قبل البداية.', 'End time is before start time.');
      case 'expert_overlap': return tr(`الخبير لديه جلسة متداخلة:${ref}`, `The expert has an overlapping session:${ref}`);
      case 'expert_blocked': return tr(`الخبير غير متاح (وقت محجوب)${c.note ? ': ' + c.note : ''}`, `The expert is unavailable (blocked time)${c.note ? ': ' + c.note : ''}`);
      case 'outside_availability': return tr('الوقت خارج أوقات التوفر الأسبوعية المعلنة للخبير.', 'The time is outside the expert’s declared weekly availability.');
      case 'expert_weekly_load': return tr(`ساعات الخبير هذا الأسبوع ستصبح ${fmtNumber(c.hours, 1)} مقابل حد ${fmtNumber(c.max)}.`, `The expert’s hours this week would be ${fmtNumber(c.hours, 1)} vs a limit of ${fmtNumber(c.max)}.`);
      case 'beneficiary_overlap': return tr(`المستفيد ${ws.benName(c.beneficiary_id)} لديه جلسة متداخلة:${ref}`, `Beneficiary ${ws.benName(c.beneficiary_id)} has an overlapping session:${ref}`);
      case 'location_overlap': return tr(`المكان محجوز لجلسة أخرى:${ref}`, `The location is booked for another session:${ref}`);
      case 'outside_program_dates': return tr(`الجلسة خارج مدة البرنامج (${fmtDate(c.start_date)} – ${fmtDate(c.end_date)}).`, `The session is outside the program period (${fmtDate(c.start_date)} – ${fmtDate(c.end_date)}).`);
      default: return c.type;
    }
  };
}

export function ScheduleSessionModal({ onClose }: { onClose: () => void }) {
  const { tr, enumOptions, locale } = useI18n();
  const { org } = useOrg();
  const toast = useToast();
  const ws = useWorkspace();
  const b = ws.bundle;
  const label = useConflictLabel();
  const types = ws.track?.session_types.length ? ws.track.session_types : ['training'];
  const [v, setV] = useState({
    title: '', session_type: types[0], stage_key: b.stages.find((s) => s.status === 'in_progress')?.stage_key ?? '', cohort_id: '', expert_id: null as string | null,
    starts: '', ends: '', delivery_mode: b.program.delivery_mode ?? 'onsite', location: '', meeting_url: '', capacity: '', agenda: '', invite: 'cohort' as 'none' | 'cohort' | 'all',
  });
  const [conflicts, setConflicts] = useState<ConflictRow[] | null>(null);
  const [checkError, setCheckError] = useState<AppError | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => { setV((s) => ({ ...s, [k]: val })); setConflicts(null); setAck(false); };

  const invitees = useMemo(() => {
    const active = b.enrollments.filter((e) => !['withdrawn', 'dropped'].includes(e.status));
    if (v.invite === 'none') return [];
    if (v.invite === 'cohort' && v.cohort_id) return active.filter((e) => e.cohort_id === v.cohort_id).map((e) => e.beneficiary_id);
    return active.map((e) => e.beneficiary_id);
  }, [b.enrollments, v.invite, v.cohort_id]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!v.title.trim()) e.title = tr('العنوان مطلوب', 'Title is required');
    if (!v.starts) e.starts = tr('وقت البداية مطلوب', 'Start is required');
    if (!v.ends) e.ends = tr('وقت النهاية مطلوب', 'End is required');
    if (v.starts && v.ends) {
      const s = new Date(fromLocalInput(v.starts)).getTime(); const en = new Date(fromLocalInput(v.ends)).getTime();
      if (en <= s) e.ends = tr('النهاية يجب أن تكون بعد البداية', 'End must be after start');
      else if (en - s > 24 * 3600000) e.ends = tr('مدة الجلسة لا تتجاوز 24 ساعة', 'A session cannot exceed 24 hours');
    }
    if (v.delivery_mode !== 'onsite' && v.meeting_url && !/^https?:\/\//i.test(v.meeting_url)) e.meeting_url = tr('رابط غير صالح', 'Invalid URL');
    setErrs(e);
    return !Object.keys(e).length;
  };

  const check = async (): Promise<ConflictRow[] | null> => {
    setCheckError(null);
    try {
      const rows = await rpc<ConflictRow[]>('check_session_conflicts', {
        p_org: org.id, p_starts: fromLocalInput(v.starts), p_ends: fromLocalInput(v.ends), p_expert: v.expert_id, p_beneficiaries: invitees,
        p_location: v.delivery_mode === 'online' ? null : v.location.trim() || null, p_exclude: null, p_program: ws.programId,
      });
      setConflicts(rows ?? []);
      return rows ?? [];
    } catch (e) { setCheckError(errorOf(e)); setConflicts([]); return null; }
  };

  const submit = async () => {
    if (!validate()) return;
    let found = conflicts;
    if (found === null) found = await check();
    if ((found === null || found.length > 0) && !ack) return; // user must explicitly accept
    setBusy(true); setError(null);
    try {
      const s = await insert<Session>('sessions', {
        organization_id: org.id, program_id: ws.programId, cohort_id: v.cohort_id || null, expert_id: v.expert_id, title: v.title.trim(),
        session_type: v.session_type, stage_key: v.stage_key || null, starts_at: fromLocalInput(v.starts), ends_at: fromLocalInput(v.ends),
        delivery_mode: v.delivery_mode, location: v.location.trim() || null, meeting_url: v.meeting_url.trim() || null,
        capacity: v.capacity ? Number(v.capacity) : null, agenda: v.agenda.trim() || null, status: 'scheduled',
      });
      if (invitees.length) await insertMany('session_participants', invitees.map((id) => ({ organization_id: org.id, session_id: s.id, beneficiary_id: id })));
      const n = await notifySessionEvent(org.id, 'session_scheduled', s.id);
      if (n.ok) toast.success(tr(`تمت الجدولة؛ أُنشئ ${n.data?.created ?? 0} إشعار`, `Scheduled; ${n.data?.created ?? 0} notifications created`));
      else if (n.unavailable) toast.info(tr('تمت جدولة الجلسة. خدمة الإشعارات غير منشورة، لم تُرسل إشعارات.', 'Session scheduled. The notification service is not deployed; no notifications were sent.'));
      else toast.error(tr('تمت جدولة الجلسة لكن تعذر جدولة الإشعارات: ', 'Session scheduled but notifications failed: ') + errText(locale, n.error));
      await ws.reload();
      onClose();
    } catch (e) { setError(errorOf(e)); } finally { setBusy(false); }
  };

  const assigned = new Set(b.assignments.filter((a) => ['proposed', 'confirmed', 'active'].includes(a.status)).map((a) => a.expert_id));
  return (
    <Modal open size="wide" title={tr('جدولة جلسة', 'Schedule a session')} onClose={onClose}
      footer={<>
        <Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button>
        <Button onClick={() => { if (validate()) void check(); }}>{tr('فحص التعارضات', 'Check conflicts')}</Button>
        <Button variant="primary" loading={busy} onClick={() => void submit()} disabled={!!conflicts && conflicts.length > 0 && !ack}>
          {conflicts && conflicts.length > 0 ? tr('جدولة رغم التعارض', 'Schedule anyway') : tr('جدولة', 'Schedule')}
        </Button>
      </>}>
      {error && <Notice tone="danger">{errText(locale, error)}</Notice>}
      <div className="form-grid">
        <Field label={tr('العنوان', 'Title')} required error={errs.title} className="full"><Input value={v.title} onChange={(e) => set('title', e.target.value)} invalid={!!errs.title} /></Field>
        <Field label={tr('نوع الجلسة', 'Session type')}>
          <Select value={v.session_type} onChange={(e) => set('session_type', e.target.value)}
            options={enumOptions('sessionType').map((o) => ({ ...o, label: types.includes(o.value) ? `${o.label} ★` : o.label }))} />
        </Field>
        <Field label={tr('المرحلة', 'Stage')}>
          <Select placeholder="—" value={v.stage_key} onChange={(e) => set('stage_key', e.target.value)} options={b.stages.map((s) => ({ value: s.stage_key, label: ws.stageName(s.stage_key) }))} />
        </Field>
        <Field label={tr('البداية', 'Starts')} required error={errs.starts}><Input type="datetime-local" value={v.starts} onChange={(e) => set('starts', e.target.value)} invalid={!!errs.starts} /></Field>
        <Field label={tr('النهاية', 'Ends')} required error={errs.ends}><Input type="datetime-local" value={v.ends} onChange={(e) => set('ends', e.target.value)} invalid={!!errs.ends} /></Field>
        <Field label={tr('الخبير / المدرب', 'Expert / trainer')} hint={v.expert_id && !assigned.has(v.expert_id) ? tr('غير مسند لهذا البرنامج', 'Not assigned to this program') : undefined}>
          <EntityPicker kind="experts" organizationId={org.id} value={v.expert_id} onChange={(id) => set('expert_id', id)} />
        </Field>
        <Field label={tr('الدفعة', 'Cohort')}>
          <Select placeholder="—" value={v.cohort_id} onChange={(e) => set('cohort_id', e.target.value)} options={b.cohorts.map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
        <Field label={tr('طريقة التنفيذ', 'Delivery mode')}>
          <Select options={enumOptions('deliveryMode')} value={v.delivery_mode} onChange={(e) => set('delivery_mode', e.target.value as typeof v.delivery_mode)} />
        </Field>
        {v.delivery_mode !== 'online' && <Field label={tr('المكان', 'Location')}><Input value={v.location} onChange={(e) => set('location', e.target.value)} /></Field>}
        {v.delivery_mode !== 'onsite' && <Field label={tr('رابط الاجتماع', 'Meeting URL')} error={errs.meeting_url}><Input dir="ltr" value={v.meeting_url} onChange={(e) => set('meeting_url', e.target.value)} /></Field>}
        <Field label={tr('الطاقة', 'Capacity')}><Input type="number" min={0} dir="ltr" value={v.capacity} onChange={(e) => set('capacity', e.target.value)} /></Field>
        <Field label={tr('دعوة المشاركين', 'Invite participants')} className="full" hint={tr(`${invitees.length} مستفيد سيضاف لكشف الحضور`, `${invitees.length} beneficiaries will be added to the attendance list`)}>
          <Segmented value={v.invite} onChange={(x) => set('invite', x)} options={[
            { value: 'cohort', label: v.cohort_id ? tr('ملتحقو الدفعة', 'Cohort enrollees') : tr('كل الملتحقين', 'All enrollees') },
            { value: 'all', label: tr('كل الملتحقين', 'All enrollees') }, { value: 'none', label: tr('بدون', 'None') },
          ]} />
        </Field>
        <Field label={tr('جدول الأعمال', 'Agenda')} className="full"><Textarea value={v.agenda} onChange={(e) => set('agenda', e.target.value)} /></Field>
      </div>
      {checkError && <Notice tone="warning">{tr('تعذر فحص التعارضات على الخادم: ', 'Conflict check failed on the server: ')}{errText(locale, checkError)}</Notice>}
      {conflicts && conflicts.length === 0 && !checkError && <Notice tone="success">{tr('لا توجد تعارضات مرصودة.', 'No conflicts detected.')}</Notice>}
      {conflicts && (conflicts.length > 0 || checkError) && (
        <Notice tone="warning" icon={<AlertTriangle />}>
          <div className="stack-sm">
            {conflicts.length > 0 && <b>{tr(`رُصد ${conflicts.length} تعارض:`, `${conflicts.length} conflicts detected:`)}</b>}
            <ul style={{ margin: 0, paddingInlineStart: 16 }}>
              {conflicts.map((c, i) => <li key={i}><Badge tone={c.severity === 'high' ? 'danger' : c.severity === 'medium' ? 'warning' : 'info'}>{c.severity}</Badge> {label(c)}</li>)}
            </ul>
            <Checkbox checked={ack} onChange={setAck} label={tr('اطلعت على التعارضات وأرغب بالجدولة رغم ذلك', 'I reviewed the conflicts and want to schedule anyway')} />
          </div>
        </Notice>
      )}
    </Modal>
  );
}

const ATT: AttendanceStatus[] = ['present', 'late', 'absent', 'excused', 'unknown'];

export function AttendanceModal({ session, onClose }: { session: Session; onClose: () => void }) {
  const { tr, enumLabel, fmtDateTime, locale } = useI18n();
  const { can, org } = useOrg();
  const ws = useWorkspace();
  const [rows, setRows] = useState<SessionParticipant[]>(() => ws.bundle.participants.filter((p) => p.session_id === session.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [dirty, setDirty] = useState(false);
  const editable = can('operations.edit');
  const pool = ws.bundle.enrollments.filter((e) => !['withdrawn', 'dropped'].includes(e.status) && (!session.cohort_id || e.cohort_id === session.cohort_id));
  const missing = pool.filter((e) => !rows.some((r) => r.beneficiary_id === e.beneficiary_id));

  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); setDirty(true); } catch (e) { setError(errorOf(e)); } finally { setBusy(false); } };
  const addAll = () => run(async () => {
    const added = await insertMany<SessionParticipant>('session_participants', missing.map((e) => ({ organization_id: org.id, session_id: session.id, beneficiary_id: e.beneficiary_id })));
    setRows((r) => [...r, ...added]);
  });
  const setStatus = (row: SessionParticipant, status: AttendanceStatus) => run(async () => {
    const u = await update<SessionParticipant>('session_participants', row.id, { attendance_status: status, check_in_at: status === 'present' || status === 'late' ? row.check_in_at ?? new Date().toISOString() : null });
    setRows((r) => r.map((x) => (x.id === row.id ? u : x)));
  });
  const markAll = () => run(async () => {
    await updateWhere('session_participants', [['session_id', 'eq', session.id], ['attendance_status', 'eq', 'unknown']], { attendance_status: 'present', check_in_at: new Date().toISOString() });
    setRows((r) => r.map((x) => (x.attendance_status === 'unknown' ? { ...x, attendance_status: 'present' } : x)));
  });
  const drop = (row: SessionParticipant) => run(async () => { await remove('session_participants', row.id); setRows((r) => r.filter((x) => x.id !== row.id)); });
  const close = async () => { if (dirty) await ws.reload(); onClose(); };
  const marked = rows.filter((r) => r.attendance_status !== 'unknown');
  const present = marked.filter((r) => r.attendance_status === 'present' || r.attendance_status === 'late').length;

  return (
    <Modal open size="wide" title={`${tr('كشف الحضور', 'Attendance')}: ${session.title} · ${fmtDateTime(session.starts_at)}`} onClose={() => void close()}
      footer={<Button variant="primary" onClick={() => void close()}>{tr('تم', 'Done')}</Button>}>
      {error && <Notice tone="danger">{errText(locale, error)}</Notice>}
      <div className="row between wrap">
        <span className="small">{tr('المسجل', 'Recorded')}: <b>{marked.length}/{rows.length}</b> · {tr('نسبة الحضور', 'Attendance')}: <b>{marked.length ? Math.round((present / marked.length) * 100) : '—'}%</b></span>
        {editable && (
          <div className="row">
            {missing.length > 0 && can('operations.create') && <Button size="sm" icon={<UserPlus />} loading={busy} onClick={() => void addAll()}>
              {session.cohort_id ? tr(`إضافة ملتحقي الدفعة (${missing.length})`, `Add cohort enrollees (${missing.length})`) : tr(`إضافة كل الملتحقين (${missing.length})`, `Add all enrollees (${missing.length})`)}</Button>}
            <Button size="sm" icon={<CheckCheck />} disabled={!rows.some((r) => r.attendance_status === 'unknown')} loading={busy} onClick={() => void markAll()}>{tr('غير المسجلين = حاضر', 'Mark unrecorded present')}</Button>
          </div>
        )}
      </div>
      <DataTable rows={rows} rowKey={(r) => r.id} pageSize={50} empty={{ title: tr('لا يوجد مشاركون في الجلسة', 'No participants in this session') }}
        columns={[
          { key: 'ben', header: tr('المستفيد', 'Beneficiary'), value: (r) => ws.benName(r.beneficiary_id) },
          { key: 'status', header: tr('الحضور', 'Attendance'), value: (r) => enumLabel('attendance', r.attendance_status), render: (r) => editable
            ? <Segmented value={r.attendance_status} onChange={(s) => void setStatus(r, s)} options={ATT.map((a) => ({ value: a, label: enumLabel('attendance', a) }))} />
            : enumLabel('attendance', r.attendance_status) },
          { key: 'del', header: '', hideInExport: true, render: (r) => editable && can('operations.delete') ? <Button size="sm" variant="ghost" onClick={() => void drop(r)}>{tr('إزالة', 'Remove')}</Button> : null },
        ]} />
      {session.status === 'completed' && rows.length > 0 && marked.length < rows.length && (
        <Notice tone="warning">{tr('الجلسة مكتملة وما زال الحضور غير مسجل لبعض المشاركين؛ لن تُحتسب في نسبة الحضور.', 'The session is completed but attendance is missing for some participants; they are not counted in the attendance rate.')}</Notice>
      )}
    </Modal>
  );
}

export function CompleteSessionModal({ session, onClose }: { session: Session; onClose: () => void }) {
  const { tr, locale } = useI18n();
  const { can, org } = useOrg();
  const ws = useWorkspace();
  const [summary, setSummary] = useState(session.summary ?? '');
  const [recs, setRecs] = useState(session.recommendations ?? '');
  const [makeAction, setMakeAction] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const unrecorded = ws.bundle.participants.filter((p) => p.session_id === session.id && p.attendance_status === 'unknown').length;
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await update<Session>('sessions', session.id, { status: 'completed', summary: summary.trim() || null, recommendations: recs.trim() || null });
      if (makeAction && recs.trim()) {
        await insert<ProgramAction>('program_actions', {
          organization_id: org.id, program_id: ws.programId, session_id: session.id, stage_key: session.stage_key,
          title: recs.trim().split('\n')[0].slice(0, 140), description: recs.trim(), source: 'session', priority: 'medium', status: 'open',
        });
      }
      await ws.reload(); onClose();
    } catch (e) { setError(errorOf(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open title={`${tr('إكمال الجلسة', 'Complete session')}: ${session.title}`} onClose={onClose}
      footer={<><Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} onClick={() => void submit()}>{tr('إكمال', 'Complete')}</Button></>}>
      {error && <Notice tone="danger">{errText(locale, error)}</Notice>}
      {unrecorded > 0 && <Notice tone="warning">{tr(`${unrecorded} مشارك بلا تسجيل حضور؛ سجّل الحضور ليُحتسب.`, `${unrecorded} participants have no attendance recorded; record it so it counts.`)}</Notice>}
      <Field label={tr('ملخص الجلسة', 'Session summary')}><Textarea value={summary} onChange={(e) => setSummary(e.target.value)} /></Field>
      <Field label={tr('التوصيات / المتابعات', 'Recommendations / follow-ups')}><Textarea value={recs} onChange={(e) => setRecs(e.target.value)} /></Field>
      {can('operations.create') && <Checkbox checked={makeAction} onChange={setMakeAction} label={tr('إنشاء إجراء متابعة من التوصيات', 'Create a follow-up action from the recommendations')} />}
      <p className="tiny muted">{tr('بعد الإكمال: ارفع كشف الحضور أو صورًا أو محضرًا كدليل مرتبط بالجلسة من تبويب الأدلة. تُضاف ساعات الجلسة تلقائيًا لتكليف الخبير.', 'After completion: upload an attendance sheet, photos or minutes as evidence linked to the session in the Evidence tab. Session hours are added to the expert assignment automatically.')}</p>
    </Modal>
  );
}

export function CancelSessionModal({ session, onClose }: { session: Session; onClose: () => void }) {
  const { tr, locale } = useI18n();
  const { org } = useOrg();
  const toast = useToast();
  const ws = useWorkspace();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const submit = async () => {
    if (!reason.trim()) { setError({ code: 'invalid', message_ar: 'سبب الإلغاء مطلوب', message_en: 'A cancellation reason is required' }); return; }
    setBusy(true); setError(null);
    try {
      await update<Session>('sessions', session.id, { status: 'cancelled', cancelled_reason: reason.trim() });
      const n = await notifySessionEvent(org.id, 'session_cancelled', session.id);
      if (n.ok) toast.success(tr('أُلغيت الجلسة وجُدولت إشعارات الإلغاء', 'Session cancelled and cancellation notices scheduled'));
      else if (n.unavailable) toast.info(tr('أُلغيت الجلسة. خدمة الإشعارات غير منشورة؛ أبلغ المشاركين يدويًا.', 'Session cancelled. The notification service is not deployed; inform participants manually.'));
      else toast.error(tr('أُلغيت الجلسة لكن تعذر إرسال الإشعارات: ', 'Session cancelled but notifications failed: ') + errText(locale, n.error));
      await ws.reload(); onClose();
    } catch (e) { setError(errorOf(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open size="narrow" title={`${tr('إلغاء الجلسة', 'Cancel session')}: ${session.title}`} onClose={onClose}
      footer={<><Button onClick={onClose}>{tr('رجوع', 'Back')}</Button><Button variant="danger" loading={busy} onClick={() => void submit()}>{tr('إلغاء الجلسة', 'Cancel session')}</Button></>}>
      {error && <Notice tone="danger">{errText(locale, error)}</Notice>}
      <Field label={tr('سبب الإلغاء', 'Cancellation reason')} required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  );
}

