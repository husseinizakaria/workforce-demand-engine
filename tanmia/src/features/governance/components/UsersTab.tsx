import { useState } from 'react';
import { Ban, KeyRound, MailPlus, Power, Users } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAuth } from '@/app/AuthProvider';
import {
  AsyncView, Badge, Button, Card, CardBody, CardHeader, DataTable, EntityPicker, Field, Input, Modal, MultiCheck, Notice, Segmented, StatusBadge,
  useConfirm, useToast, type Column,
} from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { all, insertMany, removeWhere } from '@/services/db';
import { callFunction } from '@/services/functions';
import { errorOf } from '@/services/errors';
import type { Role, UserInvitation, UserRole } from '@/types/db';
import { ShowOnce, UNAVAILABLE, memberLabel, useErrMsg, useMembers, type Member } from '../shared';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function UsersTab() {
  const { tr, pick, fmtDateTime, fmtDate } = useI18n();
  const { org, can, refresh } = useOrg();
  const { user } = useAuth();
  const toast = useToast(); const confirm = useConfirm(); const errMsg = useErrMsg();
  const members = useMembers();
  const [roleEdit, setRoleEdit] = useState<Member | null>(null);
  const [inviting, setInviting] = useState(false);
  const meta = useAsync(async () => {
    const orgF: [string, 'eq', string] = ['organization_id', 'eq', org.id];
    const [roles, userRoles, invitations] = await Promise.all([
      all<Role>('roles', { filters: [orgF], order: { column: 'name_ar', ascending: true } }),
      all<UserRole>('user_roles', { filters: [orgF], order: { column: 'created_at' } }),
      all<UserInvitation>('user_invitations', { filters: [orgF], order: { column: 'created_at' } }, 1000).catch(() => [] as UserInvitation[]),
    ]);
    return { roles, userRoles, invitations };
  }, [org.id]);

  const setActive = async (m: Member, active: boolean) => {
    if (m.user_id === user?.id && !active) { toast.error(tr('لا يمكنك تعطيل حسابك بنفسك.', 'You cannot deactivate your own membership.')); return; }
    if (!(await confirm({ title: active ? tr('تفعيل العضوية؟', 'Activate membership?') : tr('تعطيل العضوية؟', 'Deactivate membership?'), danger: !active,
      message: active ? memberLabel(m) : tr(`سيفقد ${memberLabel(m)} الوصول إلى هذه المؤسسة فورًا. لا تُحذف بياناته.`, `${memberLabel(m)} will immediately lose access to this organization. No data is deleted.`) }))) return;
    try {
      await callFunction('admin-update-user', { action: 'update', user_id: m.user_id, organization_id: org.id, member_active: active });
      toast.success(tr('تم التحديث', 'Updated')); void members.reload();
    } catch (e) {
      const ae = errorOf(e);
      toast.error(UNAVAILABLE.has(ae.code) ? tr('خدمة إدارة المستخدمين غير منشورة؛ لم يتغير شيء.', 'The user administration service is not deployed; nothing changed.') : errMsg(e));
    }
  };
  const revoke = async (i: UserInvitation) => {
    if (!(await confirm({ title: tr('إلغاء الدعوة؟', 'Revoke invitation?'), message: i.email, danger: true }))) return;
    try { await callFunction('send-invitation', { action: 'revoke', invitation_id: i.id }); toast.success(tr('أُلغيت الدعوة', 'Invitation revoked')); void meta.reload(); }
    catch (e) { const ae = errorOf(e); toast.error(UNAVAILABLE.has(ae.code) ? tr('خدمة الدعوات غير منشورة؛ لم تُلغَ الدعوة.', 'The invitation service is not deployed; the invitation was not revoked.') : errMsg(e)); }
  };

  return (
    <AsyncView state={members}>
      {(ms) => (
        <AsyncView state={meta}>
          {(d) => {
            const rolesOf = (uid: string) => d.userRoles.filter((ur) => ur.user_id === uid).map((ur) => d.roles.find((r) => r.id === ur.role_id)).filter(Boolean) as Role[];
            const columns: Column<Member>[] = [
              { key: 'name', header: tr('المستخدم', 'User'), sortable: true, value: (m) => memberLabel(m),
                render: (m) => <div className="stack-sm" style={{ gap: 2 }}><b className="small">{m.full_name ?? '—'}{m.user_id === user?.id && <> <Badge tone="outline">{tr('أنت', 'You')}</Badge></>}</b><span className="tiny muted ltr">{m.email}</span></div> },
              { key: 'title', header: tr('المسمى', 'Title'), value: (m) => m.title ?? m.job_title ?? '' },
              { key: 'roles', header: tr('الأدوار', 'Roles'), value: (m) => rolesOf(m.user_id).map((r) => r.code).join(', '),
                render: (m) => { const rs = rolesOf(m.user_id); return rs.length ? <div className="row wrap" style={{ gap: 3 }}>{rs.map((r) => <Badge key={r.id} tone={r.active ? 'primary' : 'neutral'}>{pick(r.name_ar, r.name_en)}</Badge>)}</div> : <Badge tone="warning">{tr('بلا دور', 'No role')}</Badge>; } },
              { key: 'active', header: tr('العضوية', 'Membership'), value: (m) => (m.active ? 'active' : 'inactive'), render: (m) => <StatusBadge group="entityStatus" value={m.active ? 'active' : 'inactive'} /> },
              { key: 'login', header: tr('آخر دخول', 'Last sign-in'), value: (m) => m.last_login_at, render: (m) => <span className="small">{m.last_login_at ? fmtDateTime(m.last_login_at) : tr('لم يسجل الدخول', 'Never')}</span> },
              { key: 'actions', header: '', hideInExport: true, render: (m) => (
                <div className="row" style={{ gap: 2 }}>
                  {can('users.assign') && <Button size="sm" variant="ghost" icon={<KeyRound />} onClick={() => setRoleEdit(m)}>{tr('الأدوار', 'Roles')}</Button>}
                  {can('users.edit') && m.user_id !== user?.id && <Button size="sm" variant="ghost" icon={<Power />} onClick={() => void setActive(m, !m.active)}>{m.active ? tr('تعطيل', 'Deactivate') : tr('تفعيل', 'Activate')}</Button>}
                </div>
              ) },
            ];
            const now = new Date().toISOString();
            const invCols: Column<UserInvitation>[] = [
              { key: 'email', header: tr('البريد', 'Email'), sortable: true, render: (i) => <span className="small ltr">{i.email}</span> },
              { key: 'full_name', header: tr('الاسم', 'Name'), value: (i) => i.full_name ?? '' },
              { key: 'link', header: tr('ربط', 'Linked to'), value: (i) => (i.link_beneficiary_id ? 'beneficiary' : i.link_expert_id ? 'expert' : ''),
                render: (i) => i.link_beneficiary_id ? <Badge tone="outline">{tr('مستفيد', 'Beneficiary')}</Badge> : i.link_expert_id ? <Badge tone="outline">{tr('خبير', 'Expert')}</Badge> : '—' },
              { key: 'status', header: tr('الحالة', 'Status'), value: (i) => i.status,
                render: (i) => <StatusBadge group="invitationStatus" value={i.status === 'pending' && i.expires_at < now ? 'expired' : i.status} /> },
              { key: 'expires', header: tr('تنتهي', 'Expires'), value: (i) => i.expires_at, render: (i) => <span className="small">{fmtDate(i.expires_at)}</span> },
              { key: 'created', header: tr('أُرسلت', 'Sent'), value: (i) => i.created_at, render: (i) => <span className="small">{fmtDate(i.created_at)}</span> },
              { key: 'actions', header: '', hideInExport: true, render: (i) => i.status === 'pending' && i.expires_at >= now && can('users.create')
                ? <Button size="sm" variant="ghost" icon={<Ban />} onClick={() => void revoke(i)}>{tr('إلغاء', 'Revoke')}</Button> : null },
            ];
            const noRole = ms.filter((m) => m.active && !rolesOf(m.user_id).length);
            return (
              <div className="stack">
                {ms.length <= 1 && !can('users.view') && <Notice tone="info">{tr('عرض الأعضاء يتطلب صلاحية «عرض المستخدمين».', 'Listing members requires the “view users” permission.')}</Notice>}
                {noRole.length > 0 && <Notice tone="warning">{tr(`${noRole.length} عضو نشط بلا أي دور؛ لن يرى أي وحدة.`, `${noRole.length} active members have no role and cannot see any module.`)}</Notice>}
                <Card>
                  <CardHeader title={tr('أعضاء المؤسسة', 'Organization members')} icon={<Users />} hint={`${ms.length}`}
                    actions={can('users.create') ? <Button size="sm" variant="primary" icon={<MailPlus />} onClick={() => setInviting(true)}>{tr('دعوة مستخدم', 'Invite user')}</Button> : undefined} />
                  <CardBody flush>
                    <DataTable columns={columns} rows={ms} rowKey={(m) => m.user_id} searchable exportName="members" pageSize={20} empty={{ title: tr('لا يوجد أعضاء', 'No members') }} />
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title={tr('الدعوات', 'Invitations')} icon={<MailPlus />} hint={tr('رمز الدعوة يُعرض مرة واحدة فقط عند الإنشاء', 'The invitation token is shown only once, at creation')} />
                  <CardBody flush>
                    <DataTable columns={invCols} rows={d.invitations} rowKey={(i) => i.id} exportName="invitations" pageSize={10} empty={{ title: tr('لا توجد دعوات', 'No invitations') }} />
                  </CardBody>
                </Card>
                {roleEdit && <RoleAssignModal member={roleEdit} roles={d.roles} current={rolesOf(roleEdit.user_id).map((r) => r.id)} onClose={() => setRoleEdit(null)}
                  onSaved={() => { setRoleEdit(null); void meta.reload(); if (roleEdit.user_id === user?.id) void refresh(); }} />}
                {inviting && <InviteModal roles={d.roles.filter((r) => r.active)} onClose={() => setInviting(false)} onDone={() => void meta.reload()} />}
              </div>
            );
          }}
        </AsyncView>
      )}
    </AsyncView>
  );
}

function RoleAssignModal({ member, roles, current, onClose, onSaved }: { member: Member; roles: Role[]; current: string[]; onClose: () => void; onSaved: () => void }) {
  const { tr, pick } = useI18n();
  const { org } = useOrg();
  const { user } = useAuth();
  const toast = useToast(); const errMsg = useErrMsg();
  const [value, setValue] = useState<string[]>(current);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const add = value.filter((v) => !current.includes(v)); const del = current.filter((v) => !value.includes(v));
    setBusy(true);
    try {
      if (add.length) await insertMany('user_roles', add.map((role_id) => ({ organization_id: org.id, user_id: member.user_id, role_id })));
      if (del.length) await removeWhere('user_roles', [['organization_id', 'eq', org.id], ['user_id', 'eq', member.user_id], ['role_id', 'in', del]]);
      toast.success(tr('حُدّثت الأدوار', 'Roles updated')); onSaved();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`${tr('أدوار', 'Roles of')} ${memberLabel(member)}`}
      footer={<><Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} onClick={save}>{tr('حفظ', 'Save')}</Button></>}>
      <div className="stack">
        {member.user_id === user?.id && <Notice tone="warning">{tr('تعدّل أدوارك أنت؛ إزالة دور الإدارة قد تفقدك صلاحية هذه الشاشة.', 'You are editing your own roles; removing an admin role may lock you out of this screen.')}</Notice>}
        <MultiCheck options={roles.map((r) => ({ value: r.id, label: `${pick(r.name_ar, r.name_en)}${r.active ? '' : ` (${tr('غير نشط', 'inactive')})`}` }))} value={value} onChange={setValue} />
        {!value.length && <Notice tone="warning">{tr('بدون أي دور لن يرى المستخدم أي وحدة.', 'Without any role the user cannot see any module.')}</Notice>}
      </div>
    </Modal>
  );
}

function InviteModal({ roles, onClose, onDone }: { roles: Role[]; onClose: () => void; onDone: () => void }) {
  const { tr, pick, locale } = useI18n();
  const { org } = useOrg();
  const [email, setEmail] = useState(''); const [name, setName] = useState(''); const [job, setJob] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [linkKind, setLinkKind] = useState<'none' | 'beneficiary' | 'expert'>('none');
  const [linkId, setLinkId] = useState<string | null>(null);
  const [days, setDays] = useState('7');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<{ link: string; email_status: string; expires_at: string } | null>(null);
  const emailErr = submitted && !EMAIL.test(email.trim());
  const daysN = Number(days);
  const send = async () => {
    setSubmitted(true);
    if (!EMAIL.test(email.trim()) || !roleIds.length || !(daysN >= 1 && daysN <= 30) || (linkKind !== 'none' && !linkId)) return;
    setBusy(true); setErr(null);
    try {
      const r = await callFunction<{ invitation_id: string; link: string; expires_at: string; email_status: string }>('send-invitation', {
        action: 'create', organization_id: org.id, email: email.trim().toLowerCase(), full_name: name.trim() || undefined, job_title: job.trim() || undefined, role_ids: roleIds,
        link_beneficiary_id: linkKind === 'beneficiary' ? linkId : undefined, link_expert_id: linkKind === 'expert' ? linkId : undefined, expires_in_days: daysN,
      });
      setResult({ link: r.link, email_status: r.email_status, expires_at: r.expires_at }); onDone();
    } catch (e) {
      const ae = errorOf(e);
      setErr(UNAVAILABLE.has(ae.code) ? tr('خدمة الدعوات غير منشورة؛ لم تُرسل أي دعوة.', 'The invitation service is not deployed; no invitation was sent.') : locale === 'ar' ? ae.message_ar : ae.message_en);
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="wide" title={tr('دعوة مستخدم', 'Invite user')}
      footer={result ? <Button variant="primary" onClick={onClose}>{tr('تم', 'Done')}</Button> : <><Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" icon={<MailPlus />} loading={busy} onClick={send}>{tr('إرسال الدعوة', 'Send invitation')}</Button></>}>
      {result ? (
        <div className="stack">
          <Notice tone="success">{tr('أُنشئت الدعوة.', 'Invitation created.')} {result.email_status === 'sent' ? tr('أُرسل البريد الإلكتروني.', 'The email was sent.') : tr('لم يُرسل بريد إلكتروني (الخدمة غير مهيأة أو تعذر الإرسال) — شارك الرابط يدويًا.', 'No email was sent (not configured or failed) — share the link manually.')}</Notice>
          <ShowOnce value={result.link} note={tr('هذا الرابط يُعرض مرة واحدة فقط ولا يُخزن بصيغته الأصلية. انسخه الآن.', 'This link is shown only once and is not stored in clear. Copy it now.')} />
        </div>
      ) : (
        <div className="stack">
          {err && <Notice tone="danger">{err}</Notice>}
          <div className="form-grid">
            <Field label={tr('البريد الإلكتروني', 'Email')} required error={emailErr ? tr('بريد غير صالح', 'Invalid email') : undefined}><Input dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label={tr('الاسم الكامل', 'Full name')}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label={tr('المسمى الوظيفي', 'Job title')}><Input value={job} onChange={(e) => setJob(e.target.value)} /></Field>
            <Field label={tr('صلاحية الدعوة (أيام)', 'Valid for (days)')} required error={submitted && !(daysN >= 1 && daysN <= 30) ? tr('بين 1 و30', 'Between 1 and 30') : undefined}><Input type="number" dir="ltr" min={1} max={30} value={days} onChange={(e) => setDays(e.target.value)} /></Field>
            <Field label={tr('الأدوار', 'Roles')} required className="full" error={submitted && !roleIds.length ? tr('اختر دورًا واحدًا على الأقل', 'Select at least one role') : undefined}>
              <MultiCheck options={roles.map((r) => ({ value: r.id, label: pick(r.name_ar, r.name_en) }))} value={roleIds} onChange={setRoleIds} />
            </Field>
            <Field label={tr('ربط الحساب بسجل (اختياري)', 'Link the account to a record (optional)')} className="full" hint={tr('للمستفيدين والخبراء: يرون بياناتهم الذاتية فقط', 'For beneficiaries and experts: they see their own records only')}>
              <div className="stack-sm">
                <Segmented value={linkKind} onChange={(v) => { setLinkKind(v); setLinkId(null); }} options={[{ value: 'none', label: tr('بدون', 'None') }, { value: 'beneficiary', label: tr('مستفيد', 'Beneficiary') }, { value: 'expert', label: tr('خبير', 'Expert') }]} />
                {linkKind !== 'none' && <EntityPicker kind={linkKind === 'beneficiary' ? 'beneficiaries' : 'experts'} organizationId={org.id} value={linkId} onChange={(id) => setLinkId(id)} />}
                {submitted && linkKind !== 'none' && !linkId && <span className="tiny" style={{ color: 'var(--danger)' }}>{tr('اختر السجل', 'Select the record')}</span>}
              </div>
            </Field>
          </div>
        </div>
      )}
    </Modal>
  );
}
