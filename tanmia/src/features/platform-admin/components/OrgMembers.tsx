// Members of one organization: roles (user_roles) and activation (admin-update-user).
import { useEffect, useState } from 'react';
import { KeyRound, UserCheck, UserX } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { Badge, Button, DataTable, Modal, MultiCheck, Notice, useConfirm } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { useAction } from '@/hooks/useAction';
import * as db from '@/services/db';
import { callFunction } from '@/services/functions';
import type { Role } from '@/types/db';
import { loadOrgMembers, type OrgMemberRow } from '../api';

export function OrgMembers({ orgId, roles }: { orgId: string; roles: Role[] }) {
  const { tr, pick, fmtDate, fmtDateTime } = useI18n();
  const confirm = useConfirm();
  const state = useAsync(() => loadOrgMembers(orgId), [orgId]);
  const [editing, setEditing] = useState<OrgMemberRow | null>(null);

  const toggle = useAction(async (m: OrgMemberRow) => {
    await callFunction('admin-update-user', { action: 'update', user_id: m.user_id, organization_id: orgId, member_active: !m.active });
    await state.reload();
  }, { success: ['تم تحديث حالة العضوية', 'Membership updated'] });

  const askToggle = async (m: OrgMemberRow) => {
    const name = m.profile?.full_name ?? m.profile?.email ?? m.user_id;
    const ok = await confirm({
      title: m.active ? tr('إيقاف العضوية', 'Deactivate membership') : tr('تفعيل العضوية', 'Activate membership'),
      message: m.active
        ? tr(`سيفقد ${name} الوصول إلى هذه المؤسسة فورًا مع الاحتفاظ بأدواره وسجلاته.`, `${name} will lose access to this organization immediately; roles and records are kept.`)
        : tr(`سيستعيد ${name} الوصول بأدواره الحالية.`, `${name} will regain access with their current roles.`),
      danger: m.active,
    });
    if (ok) await toggle.run(m);
  };

  const adminCount = (state.data ?? []).filter((m) => m.active && m.roles.some((r) => r.code === 'org_admin')).length;

  return (
    <div className="stack-sm">
      {state.data && state.data.length > 0 && adminCount === 0 && (
        <Notice tone="warning">{tr('لا يوجد عضو نشط بدور مدير المؤسسة. أسند الدور لعضو موثوق حتى تُدار المؤسسة محليًا.', 'No active member holds the organization admin role. Assign it to a trusted member so the organization can be managed locally.')}</Notice>
      )}
      <DataTable<OrgMemberRow> rows={state.data ?? []} rowKey={(r) => r.user_id} loading={state.loading} error={state.error} onRetry={() => void state.reload()}
        searchable pageSize={20} exportName="organization-members"
        empty={{ title: tr('لا يوجد أعضاء', 'No members'), description: tr('ادعُ مستخدمين من تبويب الدعوات.', 'Invite users from the invitations tab.') }}
        columns={[
          { key: 'name', header: tr('الاسم', 'Name'), value: (r) => r.profile?.full_name ?? '', sortable: true,
            render: (r) => <div><div className="strong">{r.profile?.full_name ?? '—'}</div><div className="tiny muted ltr">{r.profile?.email ?? r.user_id}</div></div> },
          { key: 'title', header: tr('المسمى', 'Title'), value: (r) => r.title ?? r.profile?.job_title ?? '' },
          { key: 'roles', header: tr('الأدوار', 'Roles'), value: (r) => r.roles.map((x) => x.code).join(' '),
            render: (r) => r.roles.length ? <div className="row wrap" style={{ gap: 4 }}>{r.roles.map((x) => <Badge key={x.id} tone={x.code === 'org_admin' ? 'primary' : 'neutral'}>{pick(x.name_ar, x.name_en)}</Badge>)}</div> : <Badge tone="warning">{tr('بلا دور', 'No role')}</Badge> },
          { key: 'active', header: tr('الحالة', 'Status'), value: (r) => (r.active ? 'active' : 'inactive'),
            render: (r) => <Badge tone={r.active ? 'success' : 'neutral'}>{r.active ? tr('نشط', 'Active') : tr('موقوف', 'Inactive')}</Badge> },
          { key: 'last', header: tr('آخر دخول', 'Last sign-in'), value: (r) => r.profile?.last_login_at ?? '', render: (r) => <span className="nowrap small">{fmtDateTime(r.profile?.last_login_at)}</span> },
          { key: 'joined', header: tr('انضم', 'Joined'), value: (r) => r.joined_at, render: (r) => <span className="nowrap small">{fmtDate(r.joined_at)}</span> },
          { key: 'actions', header: '', hideInExport: true, render: (r) => (
            <div className="row" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" icon={<KeyRound />} onClick={() => setEditing(r)}>{tr('الأدوار', 'Roles')}</Button>
              <Button size="sm" variant="ghost" icon={r.active ? <UserX /> : <UserCheck />} loading={toggle.busy} onClick={() => void askToggle(r)}>
                {r.active ? tr('إيقاف', 'Deactivate') : tr('تفعيل', 'Activate')}
              </Button>
            </div>
          ) },
        ]} />
      <RolesModal orgId={orgId} member={editing} roles={roles} onClose={() => setEditing(null)} onSaved={() => void state.reload()} />
    </div>
  );
}

function RolesModal({ orgId, member, roles, onClose, onSaved }: { orgId: string; member: OrgMemberRow | null; roles: Role[]; onClose: () => void; onSaved: () => void }) {
  const { tr, pick } = useI18n();
  const [sel, setSel] = useState<string[]>([]);
  useEffect(() => { setSel(member?.roles.map((r) => r.id) ?? []); }, [member]);
  const save = useAction(async () => {
    if (!member) return;
    const current = member.roles.map((r) => r.id);
    const add = sel.filter((id) => !current.includes(id));
    const del = current.filter((id) => !sel.includes(id));
    if (add.length) await db.insertMany('user_roles', add.map((role_id) => ({ organization_id: orgId, user_id: member.user_id, role_id })));
    for (const role_id of del) await db.removeWhere('user_roles', [['organization_id', 'eq', orgId], ['user_id', 'eq', member.user_id], ['role_id', 'eq', role_id]]);
  }, { success: ['تم حفظ الأدوار', 'Roles saved'], onDone: () => { onSaved(); onClose(); } });

  const options = roles.filter((r) => r.active || sel.includes(r.id)).map((r) => ({ value: r.id, label: `${pick(r.name_ar, r.name_en)}${r.active ? '' : ` (${tr('غير نشط', 'inactive')})`}` }));
  return (
    <Modal open={!!member} onClose={onClose} title={tr(`أدوار ${member?.profile?.full_name ?? ''}`, `Roles of ${member?.profile?.full_name ?? ''}`)}
      footer={<><Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={save.busy} onClick={() => void save.run()}>{tr('حفظ', 'Save')}</Button></>}>
      <div className="stack-sm">
        <p className="small muted">{tr('الصلاحيات الفعلية هي اتحاد صلاحيات الأدوار النشطة. يُطبّق التغيير عند تحديث المستخدم لجلسته.', 'Effective permissions are the union of active roles. Changes apply when the user refreshes their session.')}</p>
        {!sel.length && <Notice tone="warning">{tr('بدون أي دور لن يرى المستخدم أي وحدة.', 'Without any role the user will not see any module.')}</Notice>}
        <MultiCheck options={options} value={sel} onChange={setSel} />
      </div>
    </Modal>
  );
}
