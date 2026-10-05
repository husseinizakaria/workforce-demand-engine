// Recurring / bulk scheduling: generate slots, preview conflicts (engine,
// against loaded sessions, participants and availability), include/exclude, create.
import { useMemo, useState } from 'react';
import { CalendarRange, Eye, Save } from 'lucide-react';
import { type Candidate, detectBatchConflicts, generateSlots, riyadhToUtc } from '@engine';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, MultiCheck, Notice, Progress, Segmented, Select, TagInput, useToast } from '@/components/ui';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { insertMany } from '@/services/db';
import { addDaysISO, todayISO } from '@/utils/dates';
import type { Session } from '@/types/db';
import { errMsg } from '@/features/beneficiaries/components/dataUtils';
import { ConflictList } from './ConflictList';
import { loadAvailability, loadParticipants, loadSessionsRange, notify, type OpsRefs, type RpcConflict } from './ops';
import { ParticipantPicker, type PersonOption } from './ParticipantPicker';

interface PreviewRow { idx: number; starts_at: string; ends_at: string; local_date: string; conflicts: RpcConflict[]; include: boolean }
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function BulkScheduleTab({ refs, onCreated }: { refs: OpsRefs; onCreated: () => void }) {
  const { org, can } = useOrg();
  const { tr, pick, enumOptions, enumLabel, fmtDate, fmtTime, locale } = useI18n();
  const toast = useToast();
  const [programId, setProgramId] = useState('');
  const [cohortId, setCohortId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [expertId, setExpertId] = useState('');
  const [type, setType] = useState('training');
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState('onsite');
  const [location, setLocation] = useState('');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [capacity, setCapacity] = useState('');
  const [topics, setTopics] = useState<string[]>([]);
  const [participants, setParticipants] = useState<string[]>([]);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [startDate, setStartDate] = useState(todayISO());
  const [endMode, setEndMode] = useState<'date' | 'count'>('count');
  const [endDate, setEndDate] = useState(addDaysISO(todayISO(), 28));
  const [count, setCount] = useState('8');
  const [weekdays, setWeekdays] = useState<string[]>(['0', '2']);
  const [startTime, setStartTime] = useState('16:00');
  const [duration, setDuration] = useState('120');
  const [skip, setSkip] = useState<string[]>([]);
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const program = programId ? refs.programMap.get(programId) : undefined;
  const cohorts = refs.cohorts.filter((c) => c.program_id === programId);
  const teams = refs.teams.filter((t) => t.program_id === programId);
  const badSkip = skip.filter((d) => !DATE.test(d));
  const formErrors: [string, string][] = [];
  if (!title.trim()) formErrors.push(['عنوان الجلسات مطلوب', 'A session title is required']);
  if (!weekdays.length) formErrors.push(['اختر يومًا واحدًا على الأقل', 'Choose at least one weekday']);
  if (!(Number(duration) > 0 && Number(duration) <= 1440)) formErrors.push(['مدة غير صالحة (1–1440 دقيقة)', 'Invalid duration (1–1440 minutes)']);
  if (endMode === 'date' && endDate < startDate) formErrors.push(['تاريخ النهاية قبل البداية', 'End date is before start date']);
  if (endMode === 'count' && !(Number(count) >= 1 && Number(count) <= 200)) formErrors.push(['العدد بين 1 و200', 'Count must be 1–200']);
  if (badSkip.length) formErrors.push([`تواريخ تخطي غير صالحة: ${badSkip.join('، ')} (YYYY-MM-DD)`, `Invalid skip dates: ${badSkip.join(', ')} (YYYY-MM-DD)`]);

  const preview = async () => {
    setError(null); setRows(null);
    const slots = generateSlots({
      start_date: startDate, end_date: endMode === 'date' ? endDate : null, count: endMode === 'count' ? Number(count) : null,
      weekdays: weekdays.map(Number), start_time: startTime, duration_minutes: Number(duration), skip_dates: skip,
    });
    if (!slots.length) { setError(tr('لم تُولّد أي مواعيد بهذه الإعدادات.', 'No slots were generated with these settings.')); return; }
    setBusy(true);
    try {
      const from = riyadhToUtc(addDaysISO(slots[0].local_date, -7), '00:00');
      const to = riyadhToUtc(addDaysISO(slots[slots.length - 1].local_date, 8), '00:00');
      const sessions = (await loadSessionsRange(org.id, from, to, [], 10000)).filter((s) => ['scheduled', 'draft'].includes(s.status));
      const [parts, availability] = await Promise.all([
        participants.length ? loadParticipants(sessions.map((s) => s.id)) : Promise.resolve([]),
        loadAvailability(org.id, expertId ? [expertId] : []),
      ]);
      const cands: Candidate[] = slots.map((s) => ({
        starts_at: s.starts_at, ends_at: s.ends_at, expert_id: expertId || null, beneficiary_ids: participants, location: mode === 'online' ? null : location.trim() || null,
        delivery_mode: mode, program_start: program?.start_date ?? null, program_end: program?.end_date ?? null,
      }));
      const byId = new Map(sessions.map((s) => [s.id, s]));
      const res = detectBatchConflicts(cands, { sessions, participants: parts, availability, experts: refs.experts });
      setRows(slots.map((s, i) => {
        const conflicts: RpcConflict[] = res[i].map((c) => ({ ...c, starts_at: c.session_id ? byId.get(c.session_id)?.starts_at : undefined,
          ...(c.type === 'outside_program_dates' ? { start_date: program?.start_date ?? null, end_date: program?.end_date ?? null } : {}) }));
        return { idx: i, ...s, conflicts, include: !conflicts.some((c) => c.severity === 'high') };
      }));
    } catch (e) { setError(errMsg(e, locale)); } finally { setBusy(false); }
  };

  const selected = useMemo(() => (rows ?? []).filter((r) => r.include), [rows]);
  const create = async () => {
    if (!selected.length) return;
    setBusy(true); setProgress(0); setError(null);
    const created: Session[] = [];
    try {
      const base = {
        organization_id: org.id, program_id: programId || null, cohort_id: cohortId || null, team_id: teamId || null, expert_id: expertId || null,
        session_type: type, delivery_mode: mode, location: mode === 'online' ? null : location.trim() || null, meeting_url: mode === 'onsite' ? null : meetingUrl.trim() || null,
        capacity: capacity ? Number(capacity) : null, topics, status: 'scheduled',
      };
      for (let i = 0; i < selected.length; i += 100) {
        const chunk = selected.slice(i, i + 100);
        created.push(...await insertMany<Session>('sessions', chunk.map((r) => ({ ...base, title: `${title.trim()} (${r.idx + 1})`, starts_at: r.starts_at, ends_at: r.ends_at }))));
        setProgress((created.length / selected.length) * 70);
      }
      const partRows = created.flatMap((s) => participants.map((b) => ({ organization_id: org.id, session_id: s.id, beneficiary_id: b })));
      for (let i = 0; i < partRows.length; i += 500) { await insertMany('session_participants', partRows.slice(i, i + 500)); setProgress(70 + ((i + 500) / partRows.length) * 20); }
      let notified = 0; let notifyNote: string | null = null;
      for (const s of created) {
        const r = await notify(org.id, 'session_scheduled', s.id);
        if (r.ok) notified++;
        else { notifyNote = r.unavailable ? tr('خدمة الإشعارات غير منشورة؛ لم تُرسل إشعارات.', 'Notification service not deployed; no notifications were sent.') : (locale === 'ar' ? r.message_ar : r.message_en); break; }
      }
      setProgress(100);
      toast.success(tr(`أُنشئت ${created.length} جلسة`, `${created.length} sessions created`));
      if (notifyNote) toast.info(notifyNote); else if (notified) toast.info(tr(`جُدولت إشعارات ${notified} جلسة`, `Notifications scheduled for ${notified} sessions`));
      setRows(null); onCreated();
    } catch (e) {
      setError(`${errMsg(e, locale)}${created.length ? ` — ${tr(`أُنشئت ${created.length} جلسة قبل الخطأ.`, `${created.length} sessions were created before the error.`)}` : ''}`);
      if (created.length) onCreated();
    } finally { setBusy(false); }
  };

  if (!can('operations.create')) return <Notice tone="info">{tr('الجدولة الجماعية تتطلب صلاحية «التشغيل ← إنشاء».', 'Bulk scheduling requires “Operations → Create”.')}</Notice>;
  const benName = (id: string) => people.find((p) => p.id === id)?.name ?? id.slice(0, 8);
  const highCount = (rows ?? []).filter((r) => r.conflicts.some((c) => c.severity === 'high')).length;
  return (
    <div className="stack">
      <div className="grid g2">
        <Card>
          <CardHeader title={tr('بيانات الجلسات', 'Session details')} icon={<CalendarRange />} />
          <CardBody>
            <div className="form-grid">
              <Field label={tr('البرنامج', 'Program')}><Select options={refs.programs.filter((p) => !['closed', 'cancelled'].includes(p.status)).map((p) => ({ value: p.id, label: pick(p.name, p.name_en) }))} placeholder="—" value={programId} onChange={(e) => { setProgramId(e.target.value); setCohortId(''); setTeamId(''); setParticipants([]); setRows(null); }} /></Field>
              <Field label={tr('الدفعة', 'Cohort')}><Select options={cohorts.map((c) => ({ value: c.id, label: c.name }))} placeholder={tr('الكل', 'All')} value={cohortId} disabled={!programId} onChange={(e) => setCohortId(e.target.value)} /></Field>
              <Field label={tr('الفريق', 'Team')}><Select options={teams.map((t) => ({ value: t.id, label: t.name }))} placeholder="—" value={teamId} disabled={!programId} onChange={(e) => setTeamId(e.target.value)} /></Field>
              <Field label={tr('الخبير', 'Expert')}><Select options={refs.experts.filter((x) => x.status !== 'blocked').map((x) => ({ value: x.id, label: pick(x.full_name, x.full_name_en) }))} placeholder="—" value={expertId} onChange={(e) => { setExpertId(e.target.value); setRows(null); }} /></Field>
              <Field label={tr('النوع', 'Type')}><Select options={enumOptions('sessionType')} value={type} onChange={(e) => setType(e.target.value)} /></Field>
              <Field label={tr('عنوان الجلسات', 'Session title')} required hint={tr('يُضاف رقم تسلسلي لكل جلسة', 'A sequence number is appended')}><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
              <Field label={tr('طريقة التقديم', 'Delivery mode')}><Select options={enumOptions('deliveryMode')} value={mode} onChange={(e) => { setMode(e.target.value); setRows(null); }} /></Field>
              <Field label={tr('السعة', 'Capacity')}><Input type="number" min={0} dir="ltr" value={capacity} onChange={(e) => setCapacity(e.target.value)} /></Field>
              {mode !== 'online' && <Field label={tr('المكان', 'Location')}><Input value={location} onChange={(e) => { setLocation(e.target.value); setRows(null); }} /></Field>}
              {mode !== 'onsite' && <Field label={tr('رابط الاجتماع', 'Meeting URL')}><Input dir="ltr" value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} /></Field>}
              <Field label={tr('المحاور', 'Topics')} className="full"><TagInput value={topics} onChange={setTopics} /></Field>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={tr('التكرار (توقيت الرياض)', 'Recurrence (Riyadh time)')} />
          <CardBody>
            <div className="form-grid">
              <Field label={tr('تاريخ البداية', 'Start date')}><Input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setRows(null); }} /></Field>
              <Field label={tr('ينتهي بـ', 'Ends by')}><Segmented value={endMode} onChange={(v) => { setEndMode(v); setRows(null); }} options={[{ value: 'count', label: tr('عدد الجلسات', 'Count') }, { value: 'date', label: tr('تاريخ', 'Date') }]} /></Field>
              {endMode === 'date'
                ? <Field label={tr('تاريخ النهاية', 'End date')}><Input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setRows(null); }} /></Field>
                : <Field label={tr('عدد الجلسات', 'Number of sessions')}><Input type="number" min={1} max={200} dir="ltr" value={count} onChange={(e) => { setCount(e.target.value); setRows(null); }} /></Field>}
              <Field label={tr('وقت البداية', 'Start time')}><Input type="time" value={startTime} onChange={(e) => { setStartTime(e.target.value); setRows(null); }} /></Field>
              <Field label={tr('المدة (دقيقة)', 'Duration (minutes)')}><Input type="number" min={15} step={15} dir="ltr" value={duration} onChange={(e) => { setDuration(e.target.value); setRows(null); }} /></Field>
              <Field label={tr('أيام الأسبوع', 'Weekdays')} className="full"><MultiCheck options={enumOptions('weekday')} value={weekdays} onChange={(v) => { setWeekdays(v); setRows(null); }} /></Field>
              <Field label={tr('تواريخ تُتخطى (إجازات)', 'Skip dates (holidays)')} hint="YYYY-MM-DD" className="full"><TagInput value={skip} onChange={(v) => { setSkip(v); setRows(null); }} /></Field>
            </div>
            {program && (program.start_date || program.end_date) && <p className="tiny muted">{tr('فترة البرنامج', 'Program period')}: {program.start_date ?? '—'} → {program.end_date ?? '—'}</p>}
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title={tr('المشاركون', 'Participants')} hint={tr('يُضافون لكل الجلسات المنشأة', 'Added to every created session')} />
        <CardBody><ParticipantPicker programId={programId || null} cohortId={cohortId || null} teamId={teamId || null} value={participants} onChange={(v) => { setParticipants(v); setRows(null); }} onOptions={setPeople} capacity={capacity ? Number(capacity) : null} /></CardBody>
      </Card>
      {formErrors.map((e, i) => <Notice key={i} tone="danger">{tr(e[0], e[1])}</Notice>)}
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="row"><Button icon={<Eye />} variant="primary" loading={busy && !rows} disabled={!!formErrors.length} onClick={() => void preview()}>{tr('توليد المعاينة وفحص التعارض', 'Generate preview & check conflicts')}</Button></div>
      {rows && (
        <Card>
          <CardHeader title={tr(`معاينة ${rows.length} موعد`, `Preview of ${rows.length} slots`)} hint={tr('فحص المتصفح بمحرك التعارض مقابل الجلسات المحمّلة', 'Browser check with the conflict engine against loaded sessions')}
            actions={<Button variant="primary" icon={<Save />} loading={busy} disabled={!selected.length} onClick={() => void create()}>{tr(`إنشاء ${selected.length} جلسة`, `Create ${selected.length} sessions`)}</Button>} />
          <CardBody>
            {highCount > 0 && <Notice tone="warning">{tr(`${highCount} موعدًا بتعارض عالي الخطورة استُبعد افتراضيًا؛ يمكنك تضمينه صراحة.`, `${highCount} slots with high-severity conflicts were excluded by default; you may include them explicitly.`)}</Notice>}
            {busy && <Progress value={progress} large label={tr('تقدم الإنشاء', 'Creation progress')} />}
          </CardBody>
          <CardBody flush>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th style={{ width: 60 }}>{tr('تضمين', 'Include')}</th><th>#</th><th>{tr('التاريخ', 'Date')}</th><th>{tr('اليوم', 'Day')}</th><th>{tr('الوقت', 'Time')}</th><th>{tr('التعارضات', 'Conflicts')}</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.idx} style={!r.include ? { opacity: 0.6 } : undefined}>
                      <td><Checkbox label="" checked={r.include} onChange={(c) => setRows((rs) => (rs ?? []).map((x) => (x.idx === r.idx ? { ...x, include: c } : x)))} /></td>
                      <td className="mono">{r.idx + 1}</td>
                      <td>{fmtDate(r.local_date)}</td>
                      <td>{enumLabel('weekday', String(new Date(r.local_date + 'T00:00:00Z').getUTCDay()))}</td>
                      <td className="mono">{fmtTime(r.starts_at)}–{fmtTime(r.ends_at)}</td>
                      <td>{r.conflicts.length ? <details><summary><ConflictList compact conflicts={r.conflicts} benName={benName} /></summary><ConflictList conflicts={r.conflicts} benName={benName} /></details> : <Badge tone="success">{tr('لا تعارض', 'No conflicts')}</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
