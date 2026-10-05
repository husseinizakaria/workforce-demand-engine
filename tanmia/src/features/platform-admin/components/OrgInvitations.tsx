// Invitations of one organization (send-invitation Edge Function).
import { useEffect, useState } from 'react';
import { Ban, MailPlus, RotateCcw } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { Badge, Button, DataTable, Field, Input, Modal, MultiCheck, Notice, StatusBadge, useConfirm } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { useAction } from '@/hooks/useAction';
import * as db from '@/services/db';
import { callFunction } from '@/services/functions';
import { type AppError, errorOf } from '@/services/errors';
import type { Role, UserInvitation } from '@/types/db';
import { CopyField, EMAIL_PATTERN, EmailStatusBadge, useErrText } from './common';

type InvitationRow = UserInvitation & { invitation_roles: { role: Pick<Role, 'code' | 'name_ar' | 'name_en'> | null }[] };
interface InviteResult { invitation_id: string; link: string; expires_at: string; email_status: string }
interface Draft { email: string; full_name: string; job_title: string; role_ids: string[]; expires_in_days: string }

export function OrgInvitations({ orgId, roles, defaultTtl }: { orgId: string; roles: Role[]; defaultTtl: number }) {
  const { tr, pick, fmtDateTime } = useI18n();
  const confirm = useConfirm();
  const state = useAsync(() => db.all<InvitationRow>('user_invitations', {
    select: 'id,organization_id,email,full_name,job_title,status,expires_at,invited_by,accepted_by,accepted_at,created_at,link_beneficiary_id,link_expert_id,invitation_roles(role:roles(code,name_ar,name_en))',
    filters: [['organization_id', 'eq', orgId]], order: { column: 'created_at', ascending: false },
  }, 2000), [orgId]);
  const [draft, setDraft] = useState<Draft | null>(null);

  const revoke = useAction(async (inv: InvitationRow) => {
    await callFunction('send-invitation', { action: 'revoke', invitation_id: inv.id, organization_id: orgId });
    await state.reload();
  }, { success: ['أُلغيت الدعوة', 'Invitation revoked'] });

  const now = Date.now();
  const effStatus = (i: InvitationRow) => (i.status === 'pending' && new Date(i.expires_at).getTime() < now ? 'expired' : i.status);
  const blank = (): Draft => ({ email: '', full_name: '', job_title: '', role_ids: [], expires_in_days: String(defaultTtl) });

  return (
    <div className="stack-sm">
      <DataTable<InvitationRow> rows={state.data ?? []} rowKey={(r) => r.id} loading={state.loading} error={state.error} onRetry={() => void state.reload()}
        searchable pageSize={20} exportName="organization-invitations"
        toolbar={<Button variant="primary" size="sm" icon={<MailPlus />} onClick={() => setDraft(blank())}>{tr('دعوة مستخدم', 'Invite user')}</Button>}
        empty={{ title: tr('لا توجد دعوات', 'No invitations') }}
        columns={[
          { key: 'email', header: tr('البريد', 'Email'), value: (r) => r.email, render: (r) => <div><div className="ltr">{r.email}</div><div className="tiny muted">{r.full_name ?? ''}</div></div>, sortable: true },
          { key: 'roles', header: tr('الأدوار', 'Roles'), value: (r) => r.invitation_roles.map((x) => x.role?.code).join(' '),
            render: (r) => <div className="row wrap" style={{ gap: 4 }}>{r.invitation_roles.filter((x) => x.role).map((x) => <Badge key={x.role!.code}>{pick(x.role!.name_ar, x.role!.name_en)}</Badge>)}</div> },
          { key: 'status', header: tr('الحالة', 'Status'), value: (r) => effStatus(r), render: (r) => <StatusBadge group="invitationStatus" value={effStatus(r)} />, sortable: true },
          { key: 'expires', header: tr('تنتهي', 'Expires'), value: (r) => r.expires_at, render: (r) => <span className="small nowrap">{fmtDateTime(r.expires_at)}</span>, sortable: true },
          { key: 'created', header: tr('أُرسلت', 'Sent'), value: (r) => r.created_at, render: (r) => <span className="small nowrap">{fmtDateTime(r.created_at)}</span>, sortable: true },
          { key: 'actions', header: '', hideInExport: true, render: (r) => (
            <div className="row">
              {r.status === 'pending' && (
                <Button size="sm" variant="ghost" icon={<Ban />} loading={revoke.busy} onClick={async () => {
                  if (await confirm({ title: tr('إلغاء الدعوة', 'Revoke invitation'), message: tr(`لن يعمل رابط الدعوة المرسل إلى ${r.email} بعد الآن.`, `The invitation link sent to ${r.email} will stop working.`), danger: true })) await revoke.run(r);
                }}>{tr('إلغاء', 'Revoke')}</Button>
              )}
              {effStatus(r) !== 'accepted' && effStatus(r) !== 'pending' && (
                <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => setDraft({ ...blank(), email: r.email, full_name: r.full_name ?? '', job_title: r.job_title ?? '' })}>{tr('دعوة مجددًا', 'Invite again')}</Button>
              )}
            </div>
          ) },
        ]} />
      <InviteModal orgId={orgId} roles={roles} draft={draft} onClose={() => setDraft(null)} onSent={() => void state.reload()} />
    </div>
  );
}

function InviteModal({ orgId, roles, draft, onClose, onSent }: { orgId: string; roles: Role[]; draft: Draft | null; onClose: () => void; onSent: () => void }) {
  const { tr, pick, fmtDateTime } = useI18n();
  const errText = useErrText();
  const [v, setV] = useState<Draft | null>(draft);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [result, setResult] = useState<InviteResult | null>(null);
  useEffect(() => { setV(draft); setErrs({}); setError(null); setResult(null); }, [draft]);
  if (!draft || !v) return null;

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!EMAIL_PATTERN.test(v.email.trim())) e.email = tr('بريد غير صالح', 'Invalid email');
    if (!v.role_ids.length) e.role_ids = tr('اختر دورًا واحدًا على الأقل', 'Choose at least one role');
    const ttl = Number(v.expires_in_days);
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 30) e.expires_in_days = tr('بين 1 و30 يومًا', 'Between 1 and 30 days');
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true); setError(null);
    try {
      const r = await callFunction<InviteResult>('send-invitation', {
        action: 'create', organization_id: orgId, email: v.email.trim().toLowerCase(), full_name: v.full_name.trim() || undefined,
        job_title: v.job_title.trim() || undefined, role_ids: v.role_ids, expires_in_days: ttl,
      });
      setResult(r); onSent();
    } catch (err) { setError(errorOf(err)); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={tr('دعوة مستخدم إلى المؤسسة', 'Invite a user to the organization')}
      footer={result ? <Button variant="primary" onClick={onClose}>{tr('تم', 'Done')}</Button>
        : <><Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} onClick={submit}>{tr('إرسال الدعوة', 'Send invitation')}</Button></>}>
      {result ? (
        <div className="stack-sm">
          <div className="row wrap"><Badge tone="success">{tr('أُنشئت الدعوة', 'Invitation created')}</Badge><EmailStatusBadge status={result.email_status} /></div>
          <CopyField value={result.link} label={tr('رابط الدعوة — يظهر مرة واحدة فقط', 'Invitation link — shown only once')} />
          <p className="tiny muted">{tr(`صالحة حتى ${fmtDateTime(result.expires_at)}. يقبلها المدعو بتسجيل الدخول بالبريد نفسه.`, `Valid until ${fmtDateTime(result.expires_at)}. The invitee accepts by signing in with the same email.`)}</p>
        </div>
      ) : (
        <form className="stack-sm" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          {error && <Notice tone="danger">{errText(error)}</Notice>}
          <div className="form-grid">
            <Field label={tr('البريد الإلكتروني', 'Email')} required error={errs.email}><Input type="email" dir="ltr" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} invalid={!!errs.email} /></Field>
            <Field label={tr('الاسم الكامل', 'Full name')}><Input value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} /></Field>
            <Field label={tr('المسمى الوظيفي', 'Job title')}><Input value={v.job_title} onChange={(e) => setV({ ...v, job_title: e.target.value })} /></Field>
            <Field label={tr('مدة الصلاحية (أيام)', 'Valid for (days)')} error={errs.expires_in_days}><Input type="number" min={1} max={30} dir="ltr" value={v.expires_in_days} onChange={(e) => setV({ ...v, expires_in_days: e.target.value })} /></Field>
            <Field className="full" label={tr('الأدوار', 'Roles')} required error={errs.role_ids}>
              <MultiCheck options={roles.filter((r) => r.active).map((r) => ({ value: r.id, label: pick(r.name_ar, r.name_en) }))} value={v.role_ids} onChange={(x) => setV({ ...v, role_ids: x })} />
            </Field>
          </div>
          <button type="submit" hidden />
        </form>
      )}
    </Modal>
  );
}
