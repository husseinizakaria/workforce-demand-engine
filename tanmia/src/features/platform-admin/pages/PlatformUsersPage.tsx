import { useEffect, useState } from 'react';
import { Ban, KeyRound, MailCheck, Shield, ShieldOff, UserPlus, CheckCircle2 } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useAuth } from '@/app/AuthProvider';
import { Badge, Button, Card, CardBody, Checkbox, DataTable, Field, Input, Modal, MultiCheck, Notice, PageHeader, Select, useConfirm } from '@/components/ui';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { useAction } from '@/hooks/useAction';
import * as db from '@/services/db';
import { callFunction } from '@/services/functions';
import { type AppError, errorOf } from '@/services/errors';
import type { PlatformUser, Profile, Role } from '@/types/db';
import { loadOrgOptions } from '../api';
import { CopyField, EMAIL_PATTERN, EmailStatusBadge, isUnavailable, useErrText } from '../components/common';

interface FnUser {
  id: string; email: string | null; full_name: string | null; last_sign_in_at: string | null; created_at: string; banned: boolean;
  is_platform_super_admin: boolean; memberships: { organization_id: string; organization_name: string; active: boolean; roles: string[] }[];
}
interface UsersPage { users: FnUser[]; total: number | null; limited: boolean; reason?: AppError }

const PER_PAGE = 25;

async function loadUsers(page: number, search: string): Promise<UsersPage> {
  try {
    const r = await callFunction<{ users: FnUser[]; total: number }>('admin-update-user', { action: 'list', page: page + 1, per_page: PER_PAGE, search: search.trim() || undefined });
    return { users: r.users ?? [], total: r.total ?? null, limited: false };
  } catch (e) {
    if (!isUnavailable(e)) throw e;
    // Fallback: database view (no auth metadata such as ban state or last sign-in from auth).
    const { rows, total } = await db.list<Profile>('profiles', { page, pageSize: PER_PAGE, count: true, search: search.trim() ? { columns: ['full_name', 'email'], term: search } : undefined });
    const ids = rows.map((p) => p.id);
    const [pu, mem] = await Promise.all([
      ids.length ? db.all<PlatformUser>('platform_users', { filters: [['user_id', 'in', ids]] }) : Promise.resolve([]),
      ids.length ? db.all<{ user_id: string; organization_id: string; active: boolean; organization: { name: string } | null }>('organization_members', {
        select: 'user_id,organization_id,active,organization:organizations(name)', filters: [['user_id', 'in', ids]], order: { column: 'joined_at' } }) : Promise.resolve([]),
    ]);
    return {
      limited: true, reason: errorOf(e), total,
      users: rows.map((p) => ({
        id: p.id, email: p.email, full_name: p.full_name, last_sign_in_at: p.last_login_at, created_at: p.created_at, banned: false,
        is_platform_super_admin: pu.some((x) => x.user_id === p.id && x.is_platform_super_admin && x.active),
        memberships: mem.filter((m) => m.user_id === p.id).map((m) => ({ organization_id: m.organization_id, organization_name: m.organization?.name ?? '', active: m.active, roles: [] })),
      })),
    };
  }
}

export default function PlatformUsersPage() {
  const { tr, fmtDateTime } = useI18n();
  const { user } = useAuth();
  const confirm = useConfirm();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 350);
  useEffect(() => setPage(0), [q]);
  const state = useAsync(() => loadUsers(page, q), [page, q]);
  const [creating, setCreating] = useState(false);
  const limited = !!state.data?.limited;

  const update = useAction(async (body: Record<string, unknown>) => {
    await callFunction('admin-update-user', { action: 'update', ...body });
    await state.reload();
  }, { success: ['تم التحديث', 'Updated'] });

  const act = async (u: FnUser, kind: 'super' | 'ban' | 'reset') => {
    const who = u.full_name ?? u.email ?? u.id;
    if (kind === 'super') {
      const ok = await confirm({
        title: u.is_platform_super_admin ? tr('سحب صلاحية مالك المنصة', 'Revoke platform owner') : tr('منح صلاحية مالك المنصة', 'Grant platform owner'),
        message: u.is_platform_super_admin
          ? tr(`سيفقد ${who} الوصول إلى إدارة المنصة وجميع المؤسسات.`, `${who} will lose access to platform administration and all organizations.`)
          : tr(`سيحصل ${who} على وصول كامل لجميع المؤسسات والبيانات والإعدادات. امنحها لأشخاص موثوقين فقط.`, `${who} will get full access to every organization, all data and settings. Grant only to trusted people.`),
        danger: true,
      });
      if (ok) await update.run({ user_id: u.id, is_platform_super_admin: !u.is_platform_super_admin });
    } else if (kind === 'ban') {
      const ok = await confirm({
        title: u.banned ? tr('رفع الحظر', 'Unban user') : tr('حظر المستخدم', 'Ban user'),
        message: u.banned ? tr(`سيتمكن ${who} من تسجيل الدخول مجددًا.`, `${who} will be able to sign in again.`)
          : tr(`سيُمنع ${who} من تسجيل الدخول إلى المنصة بالكامل (كل المؤسسات).`, `${who} will be blocked from signing in to the whole platform (all organizations).`),
        danger: !u.banned,
      });
      if (ok) await update.run({ user_id: u.id, banned: !u.banned });
    } else {
      if (await confirm({ title: tr('إرسال رابط إعادة تعيين كلمة المرور', 'Send password reset'), message: tr(`سيُرسل رابط إعادة التعيين إلى ${u.email ?? who}.`, `A reset link will be sent to ${u.email ?? who}.`) }))
        await update.run({ user_id: u.id, send_password_reset: true });
    }
  };

  return (
    <div className="stack">
      <PageHeader title={tr('المستخدمون', 'Users')} crumbs={[{ label: tr('إدارة المنصة', 'Platform'), to: '/platform' }, { label: tr('المستخدمون', 'Users') }]}
        subtitle={tr('جميع حسابات المنصة وعضوياتها. الإجراءات الحساسة تتم عبر الدوال الخلفية وتُسجل في التدقيق.', 'Every platform account and its memberships. Sensitive actions go through server functions and are audited.')}
        actions={<Button variant="primary" icon={<UserPlus />} onClick={() => setCreating(true)} disabled={limited}>{tr('إنشاء مستخدم', 'Create user')}</Button>} />
      {limited && (
        <Notice tone="warning">
          <b>{tr('عرض محدود', 'Limited view')}</b> — {tr('الدالة admin-update-user غير منشورة، لذا تُعرض الملفات الشخصية من قاعدة البيانات فقط (بدون حالة الحظر أو بيانات المصادقة)، والإجراءات معطلة. انشر الدالة لتفعيل الإدارة الكاملة.',
            'The admin-update-user function is not deployed, so profiles are listed from the database only (no ban state or auth data) and actions are disabled. Deploy the function to enable full management.')}
        </Notice>
      )}
      <Card>
        <CardBody flush>
          <DataTable<FnUser> rows={state.data?.users ?? []} rowKey={(r) => r.id} loading={state.loading} error={state.error} onRetry={() => void state.reload()}
            search={{ value: search, onChange: setSearch, placeholder: tr('بحث بالاسم أو البريد…', 'Search name or email…') }}
            server={{ page, pageSize: PER_PAGE, total: state.data?.total ?? null, onPage: setPage }} exportName="platform-users"
            empty={{ title: tr('لا يوجد مستخدمون مطابقون', 'No matching users') }}
            columns={[
              { key: 'email', header: tr('البريد', 'Email'), value: (r) => r.email, render: (r) => <span className="ltr">{r.email ?? '—'}</span> },
              { key: 'name', header: tr('الاسم', 'Name'), value: (r) => r.full_name },
              { key: 'last', header: tr('آخر دخول', 'Last sign-in'), value: (r) => r.last_sign_in_at, render: (r) => <span className="small nowrap">{fmtDateTime(r.last_sign_in_at)}</span> },
              { key: 'flags', header: tr('الحالة', 'Status'), value: (r) => [r.banned && 'banned', r.is_platform_super_admin && 'super_admin'].filter(Boolean).join(' '),
                render: (r) => <div className="row wrap" style={{ gap: 4 }}>
                  {r.is_platform_super_admin && <Badge tone="primary" icon={<Shield size={12} />}>{tr('مالك المنصة', 'Platform owner')}</Badge>}
                  {r.banned ? <Badge tone="danger">{tr('محظور', 'Banned')}</Badge> : !limited && <Badge tone="success">{tr('نشط', 'Active')}</Badge>}
                  {r.id === user?.id && <Badge tone="outline">{tr('أنت', 'You')}</Badge>}
                </div> },
              { key: 'memberships', header: tr('العضويات', 'Memberships'), value: (r) => r.memberships.map((m) => m.organization_name).join('; '),
                render: (r) => r.memberships.length ? <div className="stack-sm" style={{ gap: 2 }}>{r.memberships.map((m) => (
                  <span key={m.organization_id} className="small">{m.organization_name}{!m.active && <> <Badge>{tr('موقوفة', 'inactive')}</Badge></>}{m.roles.length > 0 && <span className="tiny muted mono"> {m.roles.join(', ')}</span>}</span>
                ))}</div> : <span className="muted small">{tr('بلا عضوية', 'No membership')}</span> },
              { key: 'actions', header: '', hideInExport: true, render: (r) => limited ? null : (
                <div className="row">
                  <Button size="sm" variant="ghost" iconOnly icon={r.is_platform_super_admin ? <ShieldOff /> : <Shield />} disabled={r.id === user?.id || update.busy}
                    title={r.id === user?.id ? tr('لا يمكنك تغيير صلاحيتك بنفسك', 'You cannot change your own owner flag') : r.is_platform_super_admin ? tr('سحب صلاحية المالك', 'Revoke owner') : tr('منح صلاحية المالك', 'Grant owner')}
                    aria-label={tr('مالك المنصة', 'Platform owner')} onClick={() => void act(r, 'super')} />
                  <Button size="sm" variant="ghost" iconOnly icon={r.banned ? <CheckCircle2 /> : <Ban />} disabled={r.id === user?.id || update.busy}
                    title={r.banned ? tr('رفع الحظر', 'Unban') : tr('حظر', 'Ban')} aria-label={r.banned ? tr('رفع الحظر', 'Unban') : tr('حظر', 'Ban')} onClick={() => void act(r, 'ban')} />
                  <Button size="sm" variant="ghost" iconOnly icon={<KeyRound />} disabled={!r.email || update.busy} title={tr('إرسال إعادة تعيين كلمة المرور', 'Send password reset')}
                    aria-label={tr('إعادة تعيين كلمة المرور', 'Password reset')} onClick={() => void act(r, 'reset')} />
                </div>
              ) },
            ]} />
        </CardBody>
      </Card>
      <CreateUserModal open={creating} onClose={() => setCreating(false)} onCreated={() => void state.reload()} />
    </div>
  );
}

interface CreateUserResult { user_id: string; created: boolean; setup_link: string | null; email_status: string }

function CreateUserModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { tr, pick } = useI18n();
  const errText = useErrText();
  const orgs = useAsync(() => (open ? loadOrgOptions() : Promise.resolve([])), [open]);
  const [v, setV] = useState({ email: '', full_name: '', job_title: '', organization_id: '', role_ids: [] as string[], super: false });
  const roles = useAsync(() => (v.organization_id ? db.all<Role>('roles', { filters: [['organization_id', 'eq', v.organization_id], ['active', 'eq', true]], order: { column: 'name_ar', ascending: true } }) : Promise.resolve([] as Role[])), [v.organization_id]);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [result, setResult] = useState<CreateUserResult | null>(null);
  useEffect(() => { if (open) { setV({ email: '', full_name: '', job_title: '', organization_id: '', role_ids: [], super: false }); setErrs({}); setError(null); setResult(null); } }, [open]);

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!EMAIL_PATTERN.test(v.email.trim())) e.email = tr('بريد غير صالح', 'Invalid email');
    if (!v.full_name.trim()) e.full_name = tr('الاسم إلزامي', 'Name is required');
    if (v.organization_id && !v.role_ids.length) e.role_ids = tr('اختر دورًا واحدًا على الأقل للعضوية', 'Choose at least one role for the membership');
    if (!v.organization_id && !v.super) e.organization_id = tr('اختر مؤسسة أو اجعل المستخدم مالكًا للمنصة', 'Choose an organization or make the user a platform owner');
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true); setError(null);
    try {
      const r = await callFunction<CreateUserResult>('admin-create-user', {
        email: v.email.trim().toLowerCase(), full_name: v.full_name.trim(), job_title: v.job_title.trim() || undefined,
        organization_id: v.organization_id || undefined, role_ids: v.organization_id ? v.role_ids : undefined, is_platform_super_admin: v.super || undefined,
      });
      setResult(r); onCreated();
    } catch (err) { setError(errorOf(err)); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={tr('إنشاء مستخدم', 'Create user')}
      footer={result ? <Button variant="primary" onClick={onClose}>{tr('تم', 'Done')}</Button>
        : <><Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} onClick={submit}>{tr('إنشاء', 'Create')}</Button></>}>
      {result ? (
        <div className="stack-sm">
          <div className="row wrap">
            <Badge tone="success" icon={<MailCheck size={12} />}>{result.created ? tr('أُنشئ الحساب', 'Account created') : tr('الحساب موجود مسبقًا — أُضيفت العضوية', 'Account existed — membership added')}</Badge>
            <EmailStatusBadge status={result.email_status} />
          </div>
          {result.setup_link
            ? <CopyField value={result.setup_link} label={tr('رابط إعداد كلمة المرور — يظهر مرة واحدة فقط، شاركه عبر قناة آمنة', 'Password setup link — shown only once; share it over a secure channel')} />
            : <p className="small muted">{tr('لا يوجد رابط لعرضه (أُرسل بالبريد أو الحساب موجود مسبقًا).', 'No link to show (it was emailed, or the account already existed).')}</p>}
        </div>
      ) : (
        <form className="stack-sm" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          {error && <Notice tone="danger">{errText(error)}</Notice>}
          <div className="form-grid">
            <Field label={tr('البريد الإلكتروني', 'Email')} required error={errs.email}><Input type="email" dir="ltr" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} invalid={!!errs.email} /></Field>
            <Field label={tr('الاسم الكامل', 'Full name')} required error={errs.full_name}><Input value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} invalid={!!errs.full_name} /></Field>
            <Field label={tr('المسمى الوظيفي', 'Job title')}><Input value={v.job_title} onChange={(e) => setV({ ...v, job_title: e.target.value })} /></Field>
            <Field label={tr('المؤسسة (اختياري)', 'Organization (optional)')} error={errs.organization_id}>
              <Select value={v.organization_id} placeholder={tr('— بدون —', '— None —')} onChange={(e) => setV({ ...v, organization_id: e.target.value, role_ids: [] })}
                options={(orgs.data ?? []).filter((o) => o.status === 'active').map((o) => ({ value: o.id, label: `${pick(o.name, o.name_en)} (${o.code})` }))} />
            </Field>
            {v.organization_id && (
              <Field className="full" label={tr('الأدوار في المؤسسة', 'Roles in the organization')} required error={errs.role_ids}>
                <MultiCheck options={(roles.data ?? []).map((r) => ({ value: r.id, label: pick(r.name_ar, r.name_en) }))} value={v.role_ids} onChange={(x) => setV({ ...v, role_ids: x })} />
              </Field>
            )}
            <div className="full stack-sm">
              <Checkbox label={tr('مالك منصة (صلاحية كاملة على كل المؤسسات)', 'Platform owner (full authority over all organizations)')} checked={v.super} onChange={(c) => setV({ ...v, super: c })} />
              {v.super && <Notice tone="warning">{tr('امنح هذه الصلاحية لأشخاص موثوقين فقط؛ تتجاوز جميع قيود الصلاحيات.', 'Grant only to trusted people; it bypasses all permission restrictions.')}</Notice>}
            </div>
          </div>
          <p className="tiny muted">{tr('لا تُدخل كلمات مرور هنا: يُنشأ رابط إعداد آمن يُرسل بالبريد أو يُعرض مرة واحدة.', 'No passwords are entered here: a secure setup link is emailed or shown once.')}</p>
          <button type="submit" hidden />
        </form>
      )}
    </Modal>
  );
}
