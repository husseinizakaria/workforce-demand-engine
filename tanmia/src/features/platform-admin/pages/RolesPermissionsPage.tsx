import { useEffect, useMemo, useState } from 'react';
import { Lock, Pencil, Plus, Power, ShieldCheck, Users } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { AsyncView, Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, Field, Notice, PageHeader, Select, useConfirm } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { useAction } from '@/hooks/useAction';
import * as db from '@/services/db';
import type { Permission, PermissionAction, PermissionModule, Profile, Role, RolePermission } from '@/types/db';
import { cx } from '@/utils/cx';
import { loadOrgOptions, loadProfiles } from '../api';
import { KEY_PATTERN, PERMISSION_ACTIONS, PERMISSION_MODULES } from '../components/common';
import { PlatformFormModal, type PlatformFieldSpec } from '../components/PlatformForm';

export default function RolesPermissionsPage() {
  const { tr, pick, enumLabel } = useI18n();
  const confirm = useConfirm();
  const [scope, setScope] = useState('');            // '' = platform templates, else organization id
  const [roleId, setRoleId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Role | 'new' | null>(null);

  const orgs = useAsync(loadOrgOptions, []);
  const perms = useAsync(() => db.all<Permission>('permissions', { order: [{ column: 'module', ascending: true }, { column: 'action', ascending: true }] }), []);
  const roles = useAsync(() => db.all<Role>('roles', { filters: [scope ? ['organization_id', 'eq', scope] : ['organization_id', 'is', null]], order: [{ column: 'is_system', ascending: false }, { column: 'name_ar', ascending: true }] }), [scope]);
  useEffect(() => {
    if (!roles.data) return;
    if (!roleId || !roles.data.some((r) => r.id === roleId)) setRoleId(roles.data[0]?.id ?? null);
  }, [roles.data, roleId]);
  const role = roles.data?.find((r) => r.id === roleId) ?? null;

  const grants = useAsync(() => (roleId ? db.all<RolePermission>('role_permissions', { filters: [['role_id', 'eq', roleId]], order: { column: 'permission_id', ascending: true } }) : Promise.resolve([])), [roleId]);
  const granted = useMemo(() => new Set((grants.data ?? []).map((g) => g.permission_id)), [grants.data]);

  const holders = useAsync(async () => {
    if (!scope || !roleId) return [] as Profile[];
    const ur = await db.all<{ user_id: string }>('user_roles', { select: 'user_id', filters: [['organization_id', 'eq', scope], ['role_id', 'eq', roleId]] });
    const map = await loadProfiles(ur.map((x) => x.user_id));
    return ur.map((x) => map.get(x.user_id)).filter((p): p is Profile => !!p);
  }, [scope, roleId]);

  const permAt = (m: PermissionModule, a: PermissionAction) => perms.data?.find((p) => p.module === m && p.action === a);

  const toggle = useAction(async (ids: string[], on: boolean) => {
    if (!roleId) return;
    if (on) {
      const add = ids.filter((id) => !granted.has(id));
      if (add.length) await db.insertMany('role_permissions', add.map((permission_id) => ({ role_id: roleId, permission_id })));
    } else {
      const del = ids.filter((id) => granted.has(id));
      if (del.length) await db.removeWhere('role_permissions', [['role_id', 'eq', roleId], ['permission_id', 'in', del]]);
    }
    await grants.reload();
  });

  const setActive = useAction(async (r: Role) => {
    await db.update<Role>('roles', r.id, { active: !r.active });
    await roles.reload();
  }, { success: ['تم تحديث الدور', 'Role updated'] });

  const fields = (r: Role | null): PlatformFieldSpec[] => [
    { name: 'code', label: ['الرمز', 'Code'], type: 'text', required: true, disabled: !!r?.is_system,
      hint: r?.is_system ? ['رمز دور النظام ثابت', 'System role codes are immutable'] : ['أحرف إنجليزية صغيرة وأرقام و _', 'lowercase letters, digits and _'],
      validate: (v) => (KEY_PATTERN.test(String(v)) ? null : ['رمز غير صالح', 'Invalid code']) },
    { name: 'name_ar', label: ['الاسم (عربي)', 'Name (Arabic)'], type: 'text', required: true },
    { name: 'name_en', label: ['الاسم (إنجليزي)', 'Name (English)'], type: 'text', required: true },
    { name: 'description', label: ['الوصف', 'Description'], type: 'textarea' },
  ];

  const scopeOptions = [{ value: '', label: tr('قوالب أدوار المنصة (للمؤسسات الجديدة)', 'Platform role templates (for new organizations)') },
    ...(orgs.data ?? []).map((o) => ({ value: o.id, label: `${pick(o.name, o.name_en)} (${o.code})` }))];
  const totalGranted = granted.size;

  return (
    <div className="stack">
      <PageHeader title={tr('الأدوار والصلاحيات', 'Roles & permissions')} crumbs={[{ label: tr('إدارة المنصة', 'Platform'), to: '/platform' }, { label: tr('الأدوار والصلاحيات', 'Roles & permissions') }]}
        subtitle={tr('مصفوفة الصلاحيات (الوحدة × الإجراء) لكل دور. الصلاحية الفعلية = الدور + تفعيل الوحدة + عضوية نشطة.', 'Permission matrix (module × action) per role. Effective access = role + module enabled + active membership.')} />
      <Card>
        <CardBody>
          <div className="grid g-2-1" style={{ alignItems: 'end' }}>
            <Field label={tr('النطاق', 'Scope')}><Select value={scope} onChange={(e) => setScope(e.target.value)} options={scopeOptions} /></Field>
            <div className="row" style={{ justifyContent: 'flex-end' }}><Button variant="primary" icon={<Plus />} onClick={() => setEditing('new')}>{tr('دور مخصص جديد', 'New custom role')}</Button></div>
          </div>
          <div style={{ marginTop: 10 }}>
            {scope
              ? <Notice tone="info">{tr('تعديل أدوار هذه المؤسسة يؤثر فورًا على أعضائها الحاليين.', 'Editing this organization’s roles immediately affects its current members.')}</Notice>
              : <Notice tone="warning">{tr('قوالب المنصة تُنسخ عند إنشاء مؤسسة جديدة فقط. تغييرها لا يغير أدوار المؤسسات الموجودة — عدّل تلك من نطاق المؤسسة.', 'Platform templates are copied only when a NEW organization is created. Changing them does not alter existing organizations — edit those from the organization scope.')}</Notice>}
          </div>
        </CardBody>
      </Card>

      <div className="grid g-1-2">
        <Card>
          <CardHeader icon={<ShieldCheck />} title={tr('الأدوار', 'Roles')} hint={roles.data ? String(roles.data.length) : undefined} />
          <CardBody flush>
            <AsyncView state={roles}>
              {(list) => list.length ? (
                <ul className="list-plain" style={{ padding: '0 12px' }}>
                  {list.map((r) => (
                    <li key={r.id} className={cx('row between')} style={{ cursor: 'pointer', background: r.id === roleId ? 'var(--primary-tint)' : undefined, paddingInline: 6, borderRadius: 6 }}
                      onClick={() => setRoleId(r.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setRoleId(r.id); }}>
                      <div className="grow">
                        <div className="strong small">{pick(r.name_ar, r.name_en)}</div>
                        <div className="tiny muted mono">{r.code}</div>
                      </div>
                      <div className="row" style={{ gap: 4 }}>
                        {r.is_system && <Badge tone="outline" icon={<Lock size={11} />}>{tr('نظام', 'System')}</Badge>}
                        {!r.active && <Badge>{tr('غير نشط', 'Inactive')}</Badge>}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState compact title={tr('لا توجد أدوار في هذا النطاق', 'No roles in this scope')} />}
            </AsyncView>
          </CardBody>
        </Card>

        <div className="stack">
          {!role ? <Card><CardBody><EmptyState compact title={tr('اختر دورًا لعرض صلاحياته', 'Select a role to see its permissions')} /></CardBody></Card> : (
            <>
              <Card>
                <CardHeader icon={<ShieldCheck />} title={pick(role.name_ar, role.name_en)} hint={tr(`${totalGranted} صلاحية`, `${totalGranted} permissions`)}
                  actions={<>
                    <Button size="sm" icon={<Pencil />} onClick={() => setEditing(role)}>{tr('تعديل', 'Edit')}</Button>
                    <Button size="sm" variant="ghost" icon={<Power />} loading={setActive.busy} onClick={async () => {
                      if (await confirm({ title: role.active ? tr('إيقاف الدور', 'Deactivate role') : tr('تفعيل الدور', 'Activate role'),
                        message: role.active ? tr('سيفقد حاملو هذا الدور صلاحياته فورًا (تبقى الإسنادات محفوظة).', 'Holders lose this role’s permissions immediately (assignments are kept).') : tr('ستعود صلاحيات الدور لحامليه.', 'Holders regain this role’s permissions.'),
                        danger: role.active })) await setActive.run(role);
                    }}>{role.active ? tr('إيقاف', 'Deactivate') : tr('تفعيل', 'Activate')}</Button>
                  </>} />
                <CardBody>
                  {role.description && <p className="small muted" style={{ marginBottom: 8 }}>{role.description}</p>}
                  {role.code === 'org_admin' && <Notice tone="warning">{tr('إزالة صلاحيات المستخدمين من مدير المؤسسة قد يمنع المؤسسة من إدارة نفسها.', 'Removing user permissions from the organization admin may leave the organization unable to manage itself.')}</Notice>}
                  <AsyncView state={perms}>
                    {() => (
                      <div className="table-wrap" style={{ marginTop: 8 }}>
                        <table className="table">
                          <thead>
                            <tr>
                              <th>{tr('الوحدة', 'Module')}</th>
                              {PERMISSION_ACTIONS.map((a) => <th key={a} style={{ textAlign: 'center' }}>{enumLabel('permAction', a)}</th>)}
                              <th style={{ textAlign: 'center' }}>{tr('الكل', 'All')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {PERMISSION_MODULES.map((m) => {
                              const rowIds = PERMISSION_ACTIONS.map((a) => permAt(m, a)?.id).filter((x): x is string => !!x);
                              const all = rowIds.length > 0 && rowIds.every((id) => granted.has(id));
                              return (
                                <tr key={m}>
                                  <td className="strong small">{enumLabel('module', m)}</td>
                                  {PERMISSION_ACTIONS.map((a) => {
                                    const p = permAt(m, a);
                                    return (
                                      <td key={a} style={{ textAlign: 'center' }}>
                                        {p ? <input type="checkbox" aria-label={`${m}.${a}`} title={pick(p.name_ar, p.name_en)} checked={granted.has(p.id)} disabled={toggle.busy || grants.loading}
                                          onChange={(e) => void toggle.run([p.id], e.target.checked)} /> : <span className="muted tiny">—</span>}
                                      </td>
                                    );
                                  })}
                                  <td style={{ textAlign: 'center' }}>
                                    <input type="checkbox" aria-label={`${m}.*`} checked={all} disabled={toggle.busy || !rowIds.length} onChange={(e) => void toggle.run(rowIds, e.target.checked)} />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </AsyncView>
                </CardBody>
              </Card>
              {scope && (
                <Card>
                  <CardHeader icon={<Users />} title={tr('حاملو الدور', 'Role holders')} hint={holders.data ? String(holders.data.length) : undefined} />
                  <CardBody flush>
                    <DataTable<Profile> rows={holders.data ?? []} rowKey={(p) => p.id} loading={holders.loading} error={holders.error} pageSize={10}
                      empty={{ title: tr('لا يحمل أحد هذا الدور', 'Nobody holds this role') }}
                      columns={[
                        { key: 'full_name', header: tr('الاسم', 'Name') },
                        { key: 'email', header: tr('البريد', 'Email'), render: (p) => <span className="ltr">{p.email ?? '—'}</span> },
                        { key: 'job_title', header: tr('المسمى', 'Title') },
                      ]} />
                  </CardBody>
                </Card>
              )}
            </>
          )}
        </div>
      </div>

      <PlatformFormModal open={!!editing} onClose={() => setEditing(null)} fields={fields(editing === 'new' ? null : editing)}
        title={editing === 'new' ? tr('دور مخصص جديد', 'New custom role') : tr('تعديل الدور', 'Edit role')}
        intro={editing === 'new' ? <p className="small muted">{scope ? tr('سيُنشأ الدور داخل المؤسسة المحددة بدون صلاحيات؛ حددها من المصفوفة بعد الإنشاء.', 'The role is created in the selected organization with no permissions; set them in the matrix afterwards.') : tr('سيُنشأ قالب دور يُنسخ إلى المؤسسات الجديدة فقط.', 'Creates a role template copied to new organizations only.')}</p> : undefined}
        initial={editing && editing !== 'new' ? { code: editing.code, name_ar: editing.name_ar, name_en: editing.name_en, description: editing.description } : { code: '', name_ar: '', name_en: '', description: '' }}
        onSubmit={async (v) => {
          if (editing === 'new') {
            const r = await db.insert<Role>('roles', { organization_id: scope || null, code: v.code, name_ar: v.name_ar, name_en: v.name_en, description: v.description, is_system: false, active: true });
            await roles.reload(); setRoleId(r.id);
          } else if (editing) {
            const patch: Record<string, unknown> = { name_ar: v.name_ar, name_en: v.name_en, description: v.description };
            if (!editing.is_system) patch.code = v.code;
            await db.update<Role>('roles', editing.id, patch); await roles.reload();
          }
        }} />
    </div>
  );
}
