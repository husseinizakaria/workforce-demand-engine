import { useState } from 'react';
import { Ban, CalendarClock, Clock, Plus, Trash2 } from 'lucide-react';
import { riyadhParts, startOfRiyadhWeek } from '@engine';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, Field, Input, Kpi, Notice, Progress, Select, StatusBadge, useConfirm, type Column } from '@/components/ui';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { useAction } from '@/hooks/useAction';
import { insert, remove } from '@/services/db';
import { addDaysISO, fromLocalInput, todayISO } from '@/utils/dates';
import type { ExpertAvailability, Session } from '@/types/db';
import { type E360, hoursOf } from './data';

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '—');
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

export function AvailabilityTab({ d, onChanged }: { d: E360; onChanged: () => void }) {
  const { org, can } = useOrg();
  const { tr, enumLabel, enumOptions, fmtDateTime, fmtNumber, fmtTime, pick } = useI18n();
  const confirm = useConfirm();
  const e = d.expert;
  const [wd, setWd] = useState('0');
  const [st, setSt] = useState('09:00');
  const [en, setEn] = useState('17:00');
  const [note, setNote] = useState('');
  const [bs, setBs] = useState('');
  const [be, setBe] = useState('');
  const [bnote, setBnote] = useState('');
  const editable = can('experts.edit') || can('experts.create');

  const weekly = d.availability.filter((a) => a.kind === 'weekly').sort((a, b) => (a.weekday ?? 0) - (b.weekday ?? 0) || (a.start_time ?? '').localeCompare(b.start_time ?? ''));
  const blocked = d.availability.filter((a) => a.kind === 'blocked').sort((a, b) => (a.starts_at ?? '').localeCompare(b.starts_at ?? ''));
  const weeklyHours = weekly.reduce((s, w) => s + (w.start_time && w.end_time ? (toMin(w.end_time) - toMin(w.start_time)) / 60 : 0), 0);

  const overlapping = weekly.some((w) => w.weekday === Number(wd) && w.start_time && w.end_time && toMin(st) < toMin(w.end_time) && toMin(w.start_time) < toMin(en));
  const addWeekly = useAction(() => insert<ExpertAvailability>('expert_availability', {
    organization_id: org.id, expert_id: e.id, kind: 'weekly', weekday: Number(wd), start_time: st, end_time: en, note: note.trim() || null,
  }), { success: ['أضيفت فترة التوفر', 'Availability slot added'], onDone: () => { setNote(''); onChanged(); } });
  const addBlocked = useAction(() => insert<ExpertAvailability>('expert_availability', {
    organization_id: org.id, expert_id: e.id, kind: 'blocked', starts_at: fromLocalInput(bs), ends_at: fromLocalInput(be), note: bnote.trim() || null,
  }), { success: ['أضيفت فترة الحجب', 'Blocked period added'], onDone: () => { setBs(''); setBe(''); setBnote(''); onChanged(); } });
  const del = useAction(async (a: ExpertAvailability) => {
    if (!(await confirm({ title: tr('حذف الفترة؟', 'Delete this period?'), danger: true, confirmLabel: tr('حذف', 'Delete') }))) return;
    await remove('expert_availability', a.id); onChanged();
  });

  const now = Date.now();
  const horizon = new Date(addDaysISO(todayISO(), 14) + 'T23:59:59+03:00').getTime();
  const upcoming = d.sessions.filter((s) => ['scheduled', 'draft'].includes(s.status) && new Date(s.ends_at).getTime() >= now && new Date(s.starts_at).getTime() <= horizon)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const thisWeek = startOfRiyadhWeek(new Date().toISOString());
  const weekLoad = d.sessions.filter((s) => ['scheduled', 'draft', 'completed'].includes(s.status) && startOfRiyadhWeek(s.starts_at) === thisWeek).reduce((a, s) => a + hoursOf(s), 0);
  const util = e.max_weekly_hours ? (weekLoad / e.max_weekly_hours) * 100 : null;

  const fitsWeekly = (s: Session) => {
    if (!weekly.length) return null;
    const ps = riyadhParts(s.starts_at); const pe = riyadhParts(s.ends_at);
    return ps.date === pe.date && weekly.some((w) => w.weekday === ps.weekday && w.start_time && w.end_time && ps.minutes >= toMin(w.start_time) && pe.minutes <= toMin(w.end_time));
  };
  const inBlocked = (s: Session) => blocked.some((b) => b.starts_at && b.ends_at && new Date(s.starts_at) < new Date(b.ends_at) && new Date(b.starts_at) < new Date(s.ends_at));
  const sCols: Column<Session>[] = [
    { key: 'when', header: tr('الموعد', 'When'), value: (s) => s.starts_at, render: (s) => `${fmtDateTime(s.starts_at)} – ${fmtTime(s.ends_at)}` },
    { key: 'title', header: tr('الجلسة', 'Session'), value: (s) => s.title, render: (s) => <div><b>{s.title}</b><span className="sub">{enumLabel('sessionType', s.session_type)} · {s.program_id ? pick(d.programs.get(s.program_id)?.name, d.programs.get(s.program_id)?.name_en) : '—'}</span></div> },
    { key: 'hours', header: tr('ساعات', 'Hours'), align: 'end', value: (s) => Math.round(hoursOf(s) * 10) / 10 },
    { key: 'status', header: tr('الحالة', 'Status'), value: (s) => s.status, render: (s) => <StatusBadge group="sessionStatus" value={s.status} /> },
    { key: 'fit', header: tr('التوافق', 'Fit'), value: (s) => String(fitsWeekly(s)), render: (s) => {
      const f = fitsWeekly(s);
      return <div className="row" style={{ gap: 4 }}>{inBlocked(s) && <Badge tone="danger">{tr('ضمن فترة محجوبة', 'In blocked period')}</Badge>}{f === false && <Badge tone="warning">{tr('خارج التوفر', 'Outside availability')}</Badge>}{f === true && !inBlocked(s) && <Badge tone="success">{tr('ضمن التوفر', 'Within availability')}</Badge>}</div>;
    } },
  ];

  return (
    <div className="stack">
      <div className="grid g4">
        <Kpi label={tr('ساعات التوفر الأسبوعية', 'Weekly available hours')} icon={<Clock size={14} />} value={fmtNumber(weeklyHours, 1)} hint={tr(`${weekly.length} فترة`, `${weekly.length} slots`)} />
        <Kpi label={tr('الحد الأقصى الأسبوعي', 'Weekly cap')} value={e.max_weekly_hours === null ? '—' : fmtNumber(e.max_weekly_hours)} />
        <Kpi label={tr('حمل هذا الأسبوع', 'This week’s load')} value={`${fmtNumber(weekLoad, 1)} ${tr('س', 'h')}`} hint={`${tr('أسبوع يبدأ', 'Week of')} ${thisWeek}`} tone={util !== null && util > 100 ? 'danger' : util !== null && util > 85 ? 'warning' : undefined} />
        <div className="card kpi"><span className="label">{tr('نسبة الاستغلال', 'Utilization')}</span><span className="value">{util === null ? '—' : `${Math.round(util)}%`}</span><Progress value={util ?? 0} tone={util !== null && util > 100 ? 'danger' : util !== null && util > 85 ? 'warning' : 'success'} /></div>
      </div>
      {!weekly.length && <Notice tone="warning">{tr('لم تُحدد أوقات توفر أسبوعية؛ فحص التعارض لن يكتشف الجدولة خارج أوقات الخبير، والمطابقة تخصم نقاط التوفر.', 'No weekly availability defined; conflict checks cannot detect scheduling outside the expert’s hours, and matching deducts availability points.')}</Notice>}
      {e.max_weekly_hours === null && <Notice tone="info">{tr('لم يُحدد حد أقصى للساعات الأسبوعية؛ لن يُنبه النظام لتجاوز الحمل.', 'No weekly hours cap set; overload will not be flagged.')}</Notice>}
      <div className="grid g2">
        <Card>
          <CardHeader title={tr('التوفر الأسبوعي (توقيت الرياض)', 'Weekly availability (Riyadh time)')} icon={<CalendarClock />} />
          <CardBody flush>
            <table className="table">
              <thead><tr><th>{tr('اليوم', 'Day')}</th><th>{tr('من', 'From')}</th><th>{tr('إلى', 'To')}</th><th>{tr('ملاحظة', 'Note')}</th>{editable && <th />}</tr></thead>
              <tbody>
                {weekly.length === 0 && <tr><td colSpan={5} className="muted small">{tr('لا توجد فترات', 'No slots')}</td></tr>}
                {weekly.map((w) => (
                  <tr key={w.id}><td>{enumLabel('weekday', String(w.weekday))}</td><td className="mono">{hhmm(w.start_time)}</td><td className="mono">{hhmm(w.end_time)}</td><td className="small">{w.note ?? ''}</td>
                    {editable && <td><Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')} onClick={() => void del.run(w)} /></td>}</tr>
                ))}
              </tbody>
            </table>
          </CardBody>
          {editable && (
            <CardBody>
              <div className="row wrap" style={{ alignItems: 'flex-end' }}>
                <Field label={tr('اليوم', 'Day')}><Select options={enumOptions('weekday')} value={wd} onChange={(x) => setWd(x.target.value)} /></Field>
                <Field label={tr('من', 'From')}><Input type="time" value={st} onChange={(x) => setSt(x.target.value)} /></Field>
                <Field label={tr('إلى', 'To')}><Input type="time" value={en} onChange={(x) => setEn(x.target.value)} /></Field>
                <Field label={tr('ملاحظة', 'Note')}><Input value={note} onChange={(x) => setNote(x.target.value)} /></Field>
                <Button icon={<Plus />} variant="primary" loading={addWeekly.busy} disabled={!st || !en || toMin(en) <= toMin(st) || overlapping} onClick={() => void addWeekly.run()}>{tr('إضافة', 'Add')}</Button>
              </div>
              {st && en && toMin(en) <= toMin(st) && <span className="small" style={{ color: 'var(--danger)' }}>{tr('وقت النهاية يجب أن يكون بعد البداية', 'End must be after start')}</span>}
              {overlapping && <span className="small" style={{ color: 'var(--warning)' }}>{tr('تتداخل مع فترة قائمة في نفس اليوم', 'Overlaps an existing slot on the same day')}</span>}
            </CardBody>
          )}
        </Card>
        <Card>
          <CardHeader title={tr('فترات محجوبة (إجازات، التزامات)', 'Blocked periods (leave, commitments)')} icon={<Ban />} />
          <CardBody flush>
            <table className="table">
              <thead><tr><th>{tr('من', 'From')}</th><th>{tr('إلى', 'To')}</th><th>{tr('ملاحظة', 'Note')}</th>{editable && <th />}</tr></thead>
              <tbody>
                {blocked.length === 0 && <tr><td colSpan={4} className="muted small">{tr('لا توجد فترات محجوبة', 'No blocked periods')}</td></tr>}
                {blocked.map((b) => (
                  <tr key={b.id} style={b.ends_at && new Date(b.ends_at).getTime() < now ? { opacity: 0.55 } : undefined}>
                    <td>{fmtDateTime(b.starts_at)}</td><td>{fmtDateTime(b.ends_at)}</td><td className="small">{b.note ?? ''}</td>
                    {editable && <td><Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')} onClick={() => void del.run(b)} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
          {editable && (
            <CardBody>
              <div className="row wrap" style={{ alignItems: 'flex-end' }}>
                <Field label={tr('من', 'From')}><Input type="datetime-local" value={bs} onChange={(x) => setBs(x.target.value)} /></Field>
                <Field label={tr('إلى', 'To')}><Input type="datetime-local" value={be} onChange={(x) => setBe(x.target.value)} /></Field>
                <Field label={tr('ملاحظة', 'Note')}><Input value={bnote} onChange={(x) => setBnote(x.target.value)} /></Field>
                <Button icon={<Plus />} variant="primary" loading={addBlocked.busy} disabled={!bs || !be || be <= bs} onClick={() => void addBlocked.run()}>{tr('حجب', 'Block')}</Button>
              </div>
            </CardBody>
          )}
        </Card>
      </div>
      <Card><CardHeader title={tr('جلسات الأيام الـ14 القادمة', 'Sessions in the next 14 days')} icon={<CalendarClock />} /><CardBody flush>
        <DataTable columns={sCols} rows={upcoming} rowKey={(s) => s.id} empty={{ title: tr('لا توجد جلسات قادمة', 'No upcoming sessions') }} />
      </CardBody></Card>
    </div>
  );
}
