import { useEffect, useMemo, useState } from 'react';
import { CheckCheck, Save, Trash2, UserPlus } from 'lucide-react';
import { Button, EntityPicker, Input, Notice, Select, useConfirm, useToast } from '@/components/ui';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { insert, remove, update } from '@/services/db';
import { riyadhDate, toLocalInput } from '@/utils/dates';
import type { AttendanceStatus, Session, SessionParticipant } from '@/types/db';
import { errMsg } from '@/features/beneficiaries/components/dataUtils';

type Row = { id: string; beneficiary_id: string; attendance_status: AttendanceStatus; check_in: string; notes: string; feedback_rating: string };
const toRow = (p: SessionParticipant): Row => ({
  id: p.id, beneficiary_id: p.beneficiary_id, attendance_status: p.attendance_status,
  check_in: p.check_in_at ? toLocalInput(p.check_in_at).slice(11, 16) : '', notes: p.notes ?? '', feedback_rating: p.feedback_rating ? String(p.feedback_rating) : '',
});
const riyadhTimeToIso = (date: string, hhmm: string) => new Date(Date.parse(`${date}T${hhmm}:00Z`) - 3 * 3600000).toISOString();

export function SessionAttendance({ session, participants, names, onChanged }: {
  session: Session; participants: SessionParticipant[]; names: Map<string, string>; onChanged: () => void;
}) {
  const { org, can } = useOrg();
  const { tr, enumOptions, locale } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => setRows(participants.map(toRow)), [participants]);
  const original = useMemo(() => new Map(participants.map((p) => [p.id, toRow(p)])), [participants]);
  const changed = rows.filter((r) => JSON.stringify(r) !== JSON.stringify(original.get(r.id)));
  const editable = can('operations.edit');
  const future = new Date(session.starts_at).getTime() > Date.now();
  const date = riyadhDate(session.starts_at);
  const setRow = (id: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const saveAll = async () => {
    setBusy(true);
    try {
      await Promise.all(changed.map((r) => update<SessionParticipant>('session_participants', r.id, {
        attendance_status: r.attendance_status, check_in_at: r.check_in ? riyadhTimeToIso(date, r.check_in) : null,
        notes: r.notes.trim() || null, feedback_rating: r.feedback_rating ? Number(r.feedback_rating) : null,
      })));
      toast.success(tr(`حُفظ حضور ${changed.length} مشارك`, `Attendance saved for ${changed.length} participants`));
      onChanged();
    } catch (e) { toast.error(errMsg(e, locale)); } finally { setBusy(false); }
  };
  const add = async (id: string | null) => {
    if (!id) return;
    if (participants.some((p) => p.beneficiary_id === id)) { toast.info(tr('المستفيد مسجل مسبقًا', 'Already a participant')); return; }
    try { await insert('session_participants', { organization_id: org.id, session_id: session.id, beneficiary_id: id }); onChanged(); }
    catch (e) { toast.error(errMsg(e, locale)); }
  };
  const del = async (r: Row) => {
    if (!(await confirm({ title: tr('إزالة المشارك؟', 'Remove participant?'), danger: true, confirmLabel: tr('إزالة', 'Remove') }))) return;
    try { await remove('session_participants', r.id); onChanged(); } catch (e) { toast.error(errMsg(e, locale)); }
  };

  const counts = rows.reduce((m, r) => m.set(r.attendance_status, (m.get(r.attendance_status) ?? 0) + 1), new Map<string, number>());
  return (
    <div className="stack-sm">
      {future && <Notice tone="info">{tr('الجلسة لم تبدأ بعد؛ يُسجل الحضور عادة أثناء الجلسة أو بعدها.', 'The session has not started yet; attendance is normally recorded during or after it.')}</Notice>}
      {['cancelled', 'rescheduled'].includes(session.status) && <Notice tone="warning">{tr('الجلسة ملغاة أو أعيدت جدولتها.', 'This session was cancelled or rescheduled.')}</Notice>}
      <div className="row wrap between">
        <span className="small muted">{enumOptions('attendance').map((o) => `${o.label}: ${counts.get(o.value) ?? 0}`).join(' · ')}</span>
        {editable && <div className="row">
          <Button size="sm" icon={<CheckCheck />} disabled={!rows.length} onClick={() => setRows((rs) => rs.map((r) => (r.attendance_status === 'unknown' ? { ...r, attendance_status: 'present' } : r)))}>{tr('غير المسجلين = حاضر', 'Unrecorded → present')}</Button>
          <Button size="sm" variant="primary" icon={<Save />} loading={busy} disabled={!changed.length} onClick={() => void saveAll()}>{tr(`حفظ (${changed.length})`, `Save (${changed.length})`)}</Button>
        </div>}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{tr('المشارك', 'Participant')}</th><th>{tr('الحضور', 'Attendance')}</th><th style={{ width: 100 }}>{tr('وقت الدخول', 'Check-in')}</th><th style={{ width: 90 }}>{tr('التقييم', 'Rating')}</th><th>{tr('ملاحظات', 'Notes')}</th>{can('operations.delete') && <th />}</tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="muted small">{tr('لا يوجد مشاركون', 'No participants')}</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="small">{names.get(r.beneficiary_id) ?? r.beneficiary_id.slice(0, 8)}</td>
                <td><Select options={enumOptions('attendance')} value={r.attendance_status} disabled={!editable} onChange={(e) => setRow(r.id, { attendance_status: e.target.value as AttendanceStatus, ...(e.target.value === 'absent' ? { check_in: '' } : {}) })} /></td>
                <td><Input type="time" value={r.check_in} disabled={!editable || r.attendance_status === 'absent'} onChange={(e) => setRow(r.id, { check_in: e.target.value })} /></td>
                <td><Select options={['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: v }))} placeholder="—" value={r.feedback_rating} disabled={!editable} onChange={(e) => setRow(r.id, { feedback_rating: e.target.value })} /></td>
                <td><Input value={r.notes} disabled={!editable} onChange={(e) => setRow(r.id, { notes: e.target.value })} /></td>
                {can('operations.delete') && <td><Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('إزالة', 'Remove')} onClick={() => void del(r)} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {can('operations.create') && (
        <div className="row" style={{ maxWidth: 420 }}><UserPlus size={15} /><div className="grow"><EntityPicker kind="beneficiaries" organizationId={org.id} value={null} placeholder={tr('+ إضافة مشارك', '+ Add participant')} onChange={(id) => void add(id)} /></div></div>
      )}
    </div>
  );
}
