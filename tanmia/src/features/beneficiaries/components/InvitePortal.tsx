// Portal account status + "Invite to portal" for beneficiaries and experts.
// The invitation is created server-side by the send-invitation Edge Function.
import { useState } from 'react';
import { Copy, Mail, UserCheck, UserPlus } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Modal, Notice, StatusBadge } from '@/components/ui';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { useAsync } from '@/hooks/useAsync';
import { list, maybe } from '@/services/db';
import { callFunction } from '@/services/functions';
import type { Role, UserInvitation } from '@/types/db';
import { errMsg } from './dataUtils';

interface InviteResult { invitation_id: string; link: string | null; expires_at: string; email_status: string }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InvitePortal({ kind, entityId, email, fullName, userId }: {
  kind: 'beneficiary' | 'expert'; entityId: string; email: string | null; fullName: string; userId: string | null;
}) {
  const { org, can } = useOrg();
  const { tr, fmtDateTime, locale } = useI18n();
  const linkCol = kind === 'beneficiary' ? 'link_beneficiary_id' : 'link_expert_id';
  const invites = useAsync(async () => {
    if (!can('users.view')) return [] as UserInvitation[];
    try {
      return (await list<UserInvitation>('user_invitations', { filters: [['organization_id', 'eq', org.id], [linkCol, 'eq', entityId]], pageSize: 10 })).rows;
    } catch { return [] as UserInvitation[]; }
  }, [org.id, entityId, linkCol]);
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(email ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InviteResult | null>(null);

  const send = async () => {
    setError(null);
    if (!EMAIL.test(to.trim())) { setError(tr('بريد إلكتروني غير صالح', 'Invalid email address')); return; }
    setBusy(true);
    try {
      const role = await maybe<Role>('roles', [['organization_id', 'eq', org.id], ['code', 'eq', kind], ['active', 'eq', true]]);
      if (!role) {
        setError(kind === 'beneficiary'
          ? tr('لا يوجد دور «beneficiary» نشط في هذه المؤسسة. أنشئه من الحوكمة ← الأدوار أولًا.', 'No active “beneficiary” role exists in this organization. Create it under Governance → Roles first.')
          : tr('لا يوجد دور «expert» نشط في هذه المؤسسة. أنشئه من الحوكمة ← الأدوار أولًا.', 'No active “expert” role exists in this organization. Create it under Governance → Roles first.'));
        return;
      }
      const r = await callFunction<InviteResult>('send-invitation', {
        organization_id: org.id, email: to.trim().toLowerCase(), full_name: fullName, role_ids: [role.id], [linkCol]: entityId,
      });
      setResult(r);
      void invites.reload();
    } catch (e) {
      setError(errMsg(e, locale));
    } finally { setBusy(false); }
  };

  const pending = (invites.data ?? []).find((i) => i.status === 'pending');
  return (
    <Card>
      <CardHeader title={tr('حساب البوابة', 'Portal account')} icon={<UserCheck />} />
      <CardBody>
        <div className="stack-sm">
          {userId ? (
            <div className="row"><Badge tone="success" icon={<UserCheck size={13} />}>{tr('مرتبط بحساب مستخدم', 'Linked to a user account')}</Badge></div>
          ) : (
            <div className="row wrap">
              <Badge tone="warning">{tr('لا يوجد حساب مرتبط', 'No linked account')}</Badge>
              {pending && <span className="small muted">{tr('دعوة معلقة تنتهي', 'Pending invitation expires')} {fmtDateTime(pending.expires_at)}</span>}
            </div>
          )}
          {!userId && (
            <p className="small muted">
              {kind === 'beneficiary'
                ? tr('دعوة المستفيد تمنحه الوصول لبوابته (جلساته، تقييماته، أدلته) فقط.', 'Inviting the beneficiary gives access to their own portal (sessions, assessments, evidence) only.')
                : tr('دعوة الخبير تمنحه الوصول لجلساته وتكليفاته وتسجيل الحضور.', 'Inviting the expert gives access to their sessions, assignments and attendance recording.')}
            </p>
          )}
          {(invites.data ?? []).length > 0 && (
            <ul className="list-plain small">
              {(invites.data ?? []).map((i) => (
                <li key={i.id} className="row between"><span className="ltr">{i.email}</span><span className="row"><StatusBadge group="invitationStatus" value={i.status} /><span className="muted tiny">{fmtDateTime(i.created_at)}</span></span></li>
              ))}
            </ul>
          )}
          {!userId && can('users.create') && (
            <div><Button size="sm" variant="primary" icon={<UserPlus />} onClick={() => { setOpen(true); setResult(null); setError(null); setTo(email ?? ''); }}>{tr('دعوة إلى البوابة', 'Invite to portal')}</Button></div>
          )}
          {!userId && !can('users.create') && <span className="tiny muted">{tr('إرسال الدعوات يتطلب صلاحية «المستخدمون ← إنشاء».', 'Sending invitations requires “Users → Create”.')}</span>}
        </div>
      </CardBody>
      <Modal open={open} onClose={() => setOpen(false)} title={tr('دعوة إلى البوابة', 'Invite to portal')} size="narrow"
        footer={result ? <Button variant="primary" onClick={() => setOpen(false)}>{tr('تم', 'Done')}</Button>
          : <><Button onClick={() => setOpen(false)}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" icon={<Mail />} loading={busy} onClick={() => void send()}>{tr('إرسال الدعوة', 'Send invitation')}</Button></>}>
        <div className="stack-sm">
          {error && <Notice tone="danger">{error}</Notice>}
          {!result ? (
            <>
              <Field label={tr('البريد الإلكتروني', 'Email')} required><Input type="email" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
              <p className="small muted">{tr(`سيُربط الحساب بسجل «${fullName}» عند قبول الدعوة.`, `The account will be linked to “${fullName}” when the invitation is accepted.`)}</p>
            </>
          ) : (
            <>
              <Notice tone="success">{tr('تم إنشاء الدعوة.', 'Invitation created.')} {tr('تنتهي', 'Expires')} {fmtDateTime(result.expires_at)}</Notice>
              {result.email_status === 'not_configured' || result.email_status === 'skipped'
                ? <Notice tone="warning">{tr('لم يُرسل بريد لأن مزود البريد غير مهيأ. انسخ الرابط وأرسله يدويًا — يظهر مرة واحدة فقط.', 'No email was sent because the email provider is not configured. Copy the link and share it manually — it is shown only once.')}</Notice>
                : <p className="small muted">{tr('حالة البريد:', 'Email status:')} <span className="mono">{result.email_status}</span></p>}
              {result.link && (
                <div className="row">
                  <Input readOnly dir="ltr" value={result.link} onFocus={(e) => e.target.select()} />
                  <Button size="sm" icon={<Copy />} onClick={() => void navigator.clipboard?.writeText(result.link ?? '')}>{tr('نسخ', 'Copy')}</Button>
                </div>
              )}
            </>
          )}
        </div>
      </Modal>
    </Card>
  );
}
