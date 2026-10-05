// Single-session scheduling with a server-side conflict check before saving.
import { useMemo, useState } from 'react';
import { CalendarPlus, ShieldCheck } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, Checkbox, Field, Input, Notice, Select, TagInput, Textarea, useToast } from '@/components/ui';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { useAsync } from '@/hooks/useAsync';
import { all, insert, insertMany, rpc } from '@/services/db';
import { fromLocalInput, minutesBetween } from '@/utils/dates';
import type { ProgramStage, Session } from '@/types/db';
import { errMsg } from '@/features/beneficiaries/components/dataUtils';
import { ConflictList } from './ConflictList';
import { notify, type OpsRefs, type RpcConflict } from './ops';
import { ParticipantPicker, type PersonOption } from './ParticipantPicker';

interface FormState {
  program_id: string; cohort_id: string; team_id: string; expert_id: string; session_type: string; title: string; stage_key: string;
  starts: string; ends: string; delivery_mode: string; location: string; meeting_url: string; capacity: string; topics: string[]; agenda: string;
}
const EMPTY: FormState = { program_id: '', cohort_id: '', team_id: '', expert_id: '', session_type: 'training', title: '', stage_key: '', starts: '', ends: '',
  delivery_mode: 'onsite', location: '', meeting_url: '', capacity: '', topics: [], agenda: '' };

export function ScheduleSessionForm({ refs, onCreated }: { refs: OpsRefs; onCreated: (s: Session) => void }) {
  const { org, can } = useOrg();
  const { tr, enumOptions, pick, locale } = useI18n();
  const toast = useToast();
  const [f, setF] = useState<FormState>(EMPTY);
  const [participants, setParticipants] = useState<string[]>([]);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [conflicts, setConflicts] = useState<RpcConflict[] | null>(null);
  const [checkedKey, setCheckedKey] = useState('');
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  const stages = useAsync(() => (f.program_id ? all<ProgramStage>('program_stages', { filters: [['program_id', 'eq', f.program_id]], order: { column: 'stage_order', ascending: true } }) : Promise.resolve([] as ProgramStage[])), [f.program_id]);
  const program = f.program_id ? refs.programMap.get(f.program_id) : undefined;
  const cohorts = refs.cohorts.filter((c) => c.program_id === f.program_id);
  const teams = refs.teams.filter((t) => t.program_id === f.program_id && (!f.cohort_id || !t.cohort_id || t.cohort_id === f.cohort_id));
  const expert = f.expert_id ? refs.expertMap.get(f.expert_id) : undefined;

  const key = JSON.stringify([f.starts, f.ends, f.expert_id, f.location, f.delivery_mode, f.program_id, [...participants].sort()]);
  const stale = key !== checkedKey;
  const high = (conflicts ?? []).some((c) => c.severity === 'high');
  const errs = useMemo(() => {
    const e: [string, string][] = [];
    if (!f.title.trim()) e.push(['العنوان مطلوب', 'Title is required']);
    if (!f.starts || !f.ends) e.push(['حدد البداية والنهاية', 'Set start and end']);
    else {
      const m = minutesBetween(fromLocalInput(f.starts), fromLocalInput(f.ends));
      if (m <= 0) e.push(['النهاية يجب أن تكون بعد البداية', 'End must be after start']);
      else if (m > 24 * 60) e.push(['مدة الجلسة لا تتجاوز 24 ساعة', 'A session cannot exceed 24 hours']);
    }
    return e;
  }, [f.title, f.starts, f.ends]);
  const warnings: [string, string][] = [];
  if (f.delivery_mode !== 'online' && !f.location.trim()) warnings.push(['لم يُحدد مكان لجلسة حضورية؛ لن يُفحص تعارض المكان.', 'No location for an on-site session; location conflicts cannot be checked.']);
  if (f.delivery_mode !== 'onsite' && !f.meeting_url.trim()) warnings.push(['لا يوجد رابط اجتماع لجلسة عن بعد/مدمجة.', 'No meeting link for an online/hybrid session.']);
  if (!f.expert_id) warnings.push(['لا يوجد خبير مسند؛ لن تُحسب ساعات التنفيذ ولن يُفحص تعارض الخبير.', 'No expert assigned; delivered hours will not be tracked and expert conflicts are not checked.']);
  if (expert && f.session_type && expert.status !== 'active') warnings.push(['الخبير المختار غير نشط.', 'The selected expert is not active.']);
  if (!participants.length) warnings.push(['لا يوجد مشاركون؛ لن يمكن تسجيل الحضور.', 'No participants; attendance cannot be recorded.']);

  const check = async (): Promise<RpcConflict[] | null> => {
    setError(null);
    try {
      const res = await rpc<RpcConflict[]>('check_session_conflicts', {
        p_org: org.id, p_starts: fromLocalInput(f.starts), p_ends: fromLocalInput(f.ends), p_expert: f.expert_id || null,
        p_beneficiaries: participants, p_location: f.delivery_mode === 'online' ? null : f.location.trim() || null, p_exclude: null, p_program: f.program_id || null,
      });
      const list = Array.isArray(res) ? res : [];
      setConflicts(list); setCheckedKey(key); setOverride(false);
      return list;
    } catch (e) { setError(errMsg(e, locale)); return null; }
  };

  const save = async () => {
    if (errs.length) return;
    setBusy(true);
    try {
      let list = conflicts;
      if (stale || list === null) {
        list = await check();
        if (list === null) return;
        if (list.length) return; // show conflicts first; the user decides
      }
      if (list.some((c) => c.severity === 'high') && !override) return;
      const s = await insert<Session>('sessions', {
        organization_id: org.id, program_id: f.program_id || null, cohort_id: f.cohort_id || null, team_id: f.team_id || null, expert_id: f.expert_id || null,
        title: f.title.trim(), session_type: f.session_type, stage_key: f.stage_key || null, starts_at: fromLocalInput(f.starts), ends_at: fromLocalInput(f.ends),
        delivery_mode: f.delivery_mode, location: f.location.trim() || null, meeting_url: f.meeting_url.trim() || null, capacity: f.capacity ? Number(f.capacity) : null,
        topics: f.topics, agenda: f.agenda.trim() || null, status: 'scheduled',
      });
      if (participants.length) {
        try { await insertMany('session_participants', participants.map((b) => ({ organization_id: org.id, session_id: s.id, beneficiary_id: b }))); }
        catch (e) { toast.error(`${tr('أُنشئت الجلسة لكن تعذر تسجيل المشاركين:', 'Session created but participants could not be added:')} ${errMsg(e, locale)}`); }
      }
      toast.success(tr(`تمت جدولة الجلسة ${s.code}`, `Session ${s.code} scheduled`));
      const n = await notify(org.id, 'session_scheduled', s.id);
      if (!n.ok) toast.info(n.unavailable ? tr('خدمة الإشعارات غير منشورة؛ لم تُرسل إشعارات.', 'Notification service not deployed; no notifications were sent.') : `${tr('تعذر جدولة الإشعارات:', 'Notifications could not be scheduled:')} ${locale === 'ar' ? n.message_ar : n.message_en}`);
      setF((x) => ({ ...EMPTY, program_id: x.program_id, cohort_id: x.cohort_id, expert_id: x.expert_id, session_type: x.session_type, delivery_mode: x.delivery_mode, location: x.location }));
      setParticipants([]); setConflicts(null); setCheckedKey('');
      onCreated(s);
    } catch (e) { setError(errMsg(e, locale)); } finally { setBusy(false); }
  };

  if (!can('operations.create')) return <Notice tone="info">{tr('جدولة الجلسات تتطلب صلاحية «التشغيل ← إنشاء».', 'Scheduling sessions requires “Operations → Create”.')}</Notice>;
  const benName = (id: string) => people.find((p) => p.id === id)?.name ?? id.slice(0, 8);
  return (
    <div className="grid g-3-2">
      <Card>
        <CardHeader title={tr('جدولة جلسة', 'Schedule a session')} icon={<CalendarPlus />} hint={tr('الأوقات بتوقيت الرياض', 'Times in Riyadh time')} />
        <CardBody>
          <div className="form-grid">
            <Field label={tr('البرنامج', 'Program')}>
              <Select options={refs.programs.filter((p) => !['closed', 'cancelled'].includes(p.status)).map((p) => ({ value: p.id, label: `${pick(p.name, p.name_en)} · ${p.code}` }))}
                placeholder={tr('— بدون برنامج —', '— No program —')} value={f.program_id} onChange={(e) => { setF((s) => ({ ...s, program_id: e.target.value, cohort_id: '', team_id: '', stage_key: '' })); setParticipants([]); }} />
            </Field>
            <Field label={tr('المرحلة', 'Stage')}>
              <Select options={(stages.data ?? []).map((s) => ({ value: s.stage_key, label: pick(s.name_ar, s.name_en) }))} placeholder="—" value={f.stage_key} onChange={(e) => set('stage_key', e.target.value)} disabled={!f.program_id} />
            </Field>
            <Field label={tr('الدفعة', 'Cohort')}>
              <Select options={cohorts.map((c) => ({ value: c.id, label: c.name }))} placeholder={tr('كل الدفعات', 'All cohorts')} value={f.cohort_id} onChange={(e) => set('cohort_id', e.target.value)} disabled={!f.program_id} />
            </Field>
            <Field label={tr('الفريق', 'Team')}>
              <Select options={teams.map((t) => ({ value: t.id, label: t.name }))} placeholder="—" value={f.team_id} onChange={(e) => set('team_id', e.target.value)} disabled={!f.program_id} />
            </Field>
            <Field label={tr('الخبير', 'Expert')}>
              <Select options={refs.experts.filter((x) => x.status !== 'blocked').map((x) => ({ value: x.id, label: `${pick(x.full_name, x.full_name_en)} · ${x.code}` }))} placeholder="—" value={f.expert_id} onChange={(e) => set('expert_id', e.target.value)} />
            </Field>
            <Field label={tr('نوع الجلسة', 'Session type')}><Select options={enumOptions('sessionType')} value={f.session_type} onChange={(e) => set('session_type', e.target.value)} /></Field>
            <Field label={tr('العنوان', 'Title')} required className="full"><Input value={f.title} onChange={(e) => set('title', e.target.value)} /></Field>
            <Field label={tr('البداية', 'Starts')} required><Input type="datetime-local" value={f.starts} onChange={(e) => { set('starts', e.target.value); if (!f.ends && e.target.value) { const d = new Date(e.target.value + ':00Z'); d.setUTCHours(d.getUTCHours() + 2); set('ends', d.toISOString().slice(0, 16)); } }} /></Field>
            <Field label={tr('النهاية', 'Ends')} required><Input type="datetime-local" value={f.ends} onChange={(e) => set('ends', e.target.value)} /></Field>
            <Field label={tr('طريقة التقديم', 'Delivery mode')}><Select options={enumOptions('deliveryMode')} value={f.delivery_mode} onChange={(e) => set('delivery_mode', e.target.value)} /></Field>
            <Field label={tr('السعة', 'Capacity')}><Input type="number" min={0} dir="ltr" value={f.capacity} onChange={(e) => set('capacity', e.target.value)} /></Field>
            {f.delivery_mode !== 'online' && <Field label={tr('المكان', 'Location')}><Input value={f.location} onChange={(e) => set('location', e.target.value)} /></Field>}
            {f.delivery_mode !== 'onsite' && <Field label={tr('رابط الاجتماع', 'Meeting URL')}><Input type="url" dir="ltr" value={f.meeting_url} onChange={(e) => set('meeting_url', e.target.value)} /></Field>}
            <Field label={tr('المحاور', 'Topics')} className="full"><TagInput value={f.topics} onChange={(v) => set('topics', v)} /></Field>
            <Field label={tr('جدول الأعمال', 'Agenda')} className="full"><Textarea value={f.agenda} onChange={(e) => set('agenda', e.target.value)} rows={2} /></Field>
            <Field label={tr('المشاركون', 'Participants')} className="full">
              <ParticipantPicker programId={f.program_id || null} cohortId={f.cohort_id || null} teamId={f.team_id || null} value={participants} onChange={setParticipants} onOptions={setPeople} capacity={f.capacity ? Number(f.capacity) : null} />
            </Field>
          </div>
        </CardBody>
      </Card>
      <div className="stack">
        <Card>
          <CardHeader title={tr('فحص التعارض', 'Conflict check')} icon={<ShieldCheck />} hint={tr('يُنفذ على الخادم قبل الحفظ', 'Runs on the server before saving')} />
          <CardBody>
            <div className="stack-sm">
              {errs.map((e, i) => <Notice key={i} tone="danger">{tr(e[0], e[1])}</Notice>)}
              {error && <Notice tone="danger">{error}</Notice>}
              {conflicts && !stale && <ConflictList conflicts={conflicts} benName={benName} />}
              {conflicts && stale && <Notice tone="info">{tr('تغيرت بيانات الموعد؛ سيُعاد الفحص عند الحفظ.', 'Scheduling details changed; the check will run again on save.')}</Notice>}
              {high && !stale && <Checkbox label={<b>{tr('أفهم التعارضات عالية الخطورة وأريد الجدولة على أي حال', 'I understand the high-severity conflicts and want to schedule anyway')}</b>} checked={override} onChange={setOverride} />}
              {warnings.length > 0 && <ul className="small muted" style={{ margin: 0, paddingInlineStart: 18 }}>{warnings.map((w, i) => <li key={i}>{tr(w[0], w[1])}</li>)}</ul>}
              {program && (program.start_date || program.end_date) && <p className="tiny muted">{tr('فترة البرنامج', 'Program period')}: {program.start_date ?? '—'} → {program.end_date ?? '—'}</p>}
              <div className="row wrap">
                <Button icon={<ShieldCheck />} disabled={!!errs.length} onClick={() => void check()}>{tr('فحص التعارض', 'Check conflicts')}</Button>
                <Button variant={high ? 'danger' : 'primary'} icon={<CalendarPlus />} loading={busy} disabled={!!errs.length || (!stale && high && !override)} onClick={() => void save()}>
                  {stale || conflicts === null ? tr('فحص ثم حفظ', 'Check & save') : conflicts.length ? (high ? tr('جدولة على أي حال', 'Schedule anyway') : tr('حفظ مع التحذيرات', 'Save with warnings')) : tr('حفظ الجلسة', 'Save session')}
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
