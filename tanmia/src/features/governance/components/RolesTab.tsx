import { useEffect, useMemo, useState } from 'react';
import { KeyRound, Plus, Save } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { AsyncView, Badge, Button, Card, CardBody, CardHeader, Checkbox, Notice, useToast } from '@/components/ui';
import { RecordFormModal, type FieldSpec } from '@/components/forms/RecordForm';
import { useAsync } from '@/hooks/useAsync';
import { all, insert, insertMany, removeWhere, update } from '@/services/db';
import type { Permission, PermissionAction, PermissionModule, Role, RolePermission } from '@/types/db';
import { useErrMsg } from '../shared';

const MODULES: PermissionModule[] = ['programs', 'beneficiaries', 'experts', 'vendors', 'partners', 'operations', 'assessments', 'evidence', 'outcomes', 'impact', 'templates', 'reports', 'governance', 'notifications', 'users'];
const ACTIONS: PermissionAction[] = ['view', 'create', 'edit', 'delete', 'approve', 'assign', 'export', 'configure', 'verify'];

export function RolesTab() {
  const { tr, pick, enumLabel } = useI18n();
  const { org, can, membership, refresh } = useOrg();
  const toast = useToast(); const errMsg = useErrMsg();
  const editable = can('users.configure');
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const state = useAsync(async () => {
    const roles = await all<Role>('roles', { filters: [['organization_id', 'eq', org.id]], order: { column: 'name_ar', ascending: true } });
    const [permissions, rp] = await Promise.all([
      all<Permission>('permissions', { order: { column: 'code', ascending: true } }),
      roles.length ? all<RolePermission>('role_permissions', { filters: [['role_id', 'in', roles.map((r) => r.id)]], order: { column: 'role_id', ascending: true } }) : Promise.resolve([] as RolePermission[]),
    ]);
    return { roles, permissions, rp };
  }, [org.id]);
  const role = state.data?.roles.find((r) => r.id === selected) ?? null;
  const current = useMemo(() => new Set((state.data?.rp ?? []).filter((x) => x.role_id === selected).map((x) => x.permission_id)), [state.data, selected]);
  useEffect(() => { setDraft(new Set(current)); }, [current]);
  useEffect(() => { if (!selected && state.data?.roles.length) setSelected(state.data.roles[0].id); }, [state.data, selected]);
  const permByCode = useMemo(() => new Map((state.data?.permissions ?? []).map((p) => [p.code, p])), [state.data]);
  const dirty = draft.size !== current.size || [...draft].some((x) => !current.has(x));
  const mine = !!role && !!membership?.roles.some((r) => r.id === role.id);

  const toggle = (pid: string, on: boolean) => setDraft((s) => { const n = new Set(s); if (on) n.add(pid); else n.delete(pid); return n; });
  const toggleRow = (m: PermissionModule, on: boolean) => setDraft((s) => {
    const n = new Set(s);
    for (const a of ACTIONS) { const p = permByCode.get(`${m}.${a}`); if (p) { if (on) n.add(p.id); else n.delete(p.id); } }
    return n;
  });
  const save = async () => {
    if (!role) return;
    const add = [...draft].filter((x) => !current.has(x)); const del = [...current].filter((x) => !draft.has(x));
    const usersConf = permByCode.get('users.configure')?.id;
    if (mine && usersConf && del.includes(usersConf)) {
      toast.error(tr('لا يمكنك إزالة «تهيئة المستخدمين» من دور تحمله أنت؛ ستفقد صلاحية هذه الشاشة.', 'You cannot remove “users.configure” from a role you hold; you would lose access to this screen.'));
      return;
    }
    setBusy(true);
    try {
      if (add.length) await insertMany('role_permissions', add.map((permission_id) => ({ role_id: role.id, permission_id })));
      if (del.length) await removeWhere('role_permissions', [['role_id', 'eq', role.id], ['permission_id', 'in', del]]);
      toast.success(tr('حُفظت الصلاحيات', 'Permissions saved'));
      await state.reload();
      if (mine) void refresh();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const toggleActive = async () => {
    if (!role) return;
    try { await update('roles', role.id, { active: !role.active }); void state.reload(); if (mine) void refresh(); } catch (e) { toast.error(errMsg(e)); }
  };
  const createFields: FieldSpec[] = [
    { name: 'code', label: ['الرمز', 'Code'], type: 'text', required: true, hint: ['أحرف لاتينية صغيرة وأرقام و _', 'lowercase letters, digits and _'],
      validate: (v) => (/^[a-z][a-z0-9_]{2,40}$/.test(String(v)) ? (state.data?.roles.some((r) => r.code === v) ? ['الرمز مستخدم', 'Code already used'] : null) : ['صيغة غير صالحة', 'Invalid format']) },
    { name: 'name_ar', label: ['الاسم بالعربية', 'Arabic name'], type: 'text', required: true },
    { name: 'name_en', label: ['الاسم بالإنجليزية', 'English name'], type: 'text', required: true },
    { name: 'description', label: ['الوصف', 'Description'], type: 'textarea' },
  ];
  const create = async (v: Record<string, unknown>) => {
    const r = await insert<Role>('roles', { ...v, organization_id: org.id, is_system: false, active: true });
    toast.success(tr('أُنشئ الدور — حدد صلاحياته الآن', 'Role created — set its permissions now'));
    await state.reload(); setSelected(r.id);
  };

  return (
    <AsyncView state={state}>
      {(d) => {
        const sensitive = role ? [...draft].map((id) => d.permissions.find((p) => p.id === id)?.code).filter((c) => c && /\.(delete|configure|approve)$|^users\./.test(c)) : [];
        return (
          <div className="grid g-1-2" style={{ alignItems: 'start' }}>
            <Card>
              <CardHeader title={tr('الأدوار', 'Roles')} icon={<KeyRound />} actions={editable ? <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>{tr('دور مخصص', 'Custom role')}</Button> : undefined} />
              <CardBody flush>
                <ul className="list-plain">
                  {d.roles.map((r) => (
                    <li key={r.id} style={{ padding: 0 }}>
                      <button type="button" className="link-btn" style={{ display: 'flex', width: '100%', justifyContent: 'space-between', padding: '9px 14px', background: r.id === selected ? 'var(--primary-tint)' : undefined, color: 'var(--text)' }} onClick={() => setSelected(r.id)}>
                        <span className="stack-sm" style={{ gap: 0, textAlign: 'start' }}><b className="small">{pick(r.name_ar, r.name_en)}</b><span className="tiny muted mono">{r.code}</span></span>
                        <span className="row" style={{ gap: 3 }}>{r.is_system && <Badge tone="outline">{tr('نظامي', 'System')}</Badge>}{!r.active && <Badge>{tr('غير نشط', 'Inactive')}</Badge>}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={role ? `${tr('مصفوفة الصلاحيات', 'Permission matrix')}: ${pick(role.name_ar, role.name_en)}` : tr('اختر دورًا', 'Select a role')}
                actions={role && editable ? <>
                  <Button size="sm" onClick={() => void toggleActive()}>{role.active ? tr('تعطيل الدور', 'Deactivate role') : tr('تفعيل الدور', 'Activate role')}</Button>
                  <Button size="sm" variant="primary" icon={<Save />} loading={busy} disabled={!dirty} onClick={save}>{tr('حفظ', 'Save')}</Button>
                </> : undefined} />
              <CardBody>
                {!role ? null : (
                  <div className="stack">
                    {!editable && <Notice tone="info">{tr('للعرض فقط — التعديل يتطلب «تهيئة المستخدمين».', 'Read-only — editing requires “users.configure”.')}</Notice>}
                    {role.is_system && editable && <Notice tone="info">{tr('دور نظامي منسوخ من قالب المنصة؛ التعديل يؤثر على كل من يحمله في مؤسستك فقط.', 'A system role copied from the platform template; changes affect only holders in your organization.')}</Notice>}
                    {mine && <Notice tone="warning">{tr('أنت تحمل هذا الدور؛ تغيير صلاحياته يغيّر ما تراه أنت.', 'You hold this role; changing it changes what you can see.')}</Notice>}
                    {role.description && <p className="small muted">{role.description}</p>}
                    <div className="table-wrap">
                      <table className="table">
                        <thead><tr><th>{tr('الوحدة', 'Module')}</th>{ACTIONS.map((a) => <th key={a} style={{ textAlign: 'center' }}>{enumLabel('permAction', a)}</th>)}{editable && <th />}</tr></thead>
                        <tbody>
                          {MODULES.map((m) => {
                            const all2 = ACTIONS.map((a) => permByCode.get(`${m}.${a}`)).filter(Boolean) as Permission[];
                            const allOn = all2.length > 0 && all2.every((p) => draft.has(p.id));
                            return (
                              <tr key={m}>
                                <td className="small strong">{enumLabel('module', m)}</td>
                                {ACTIONS.map((a) => {
                                  const p = permByCode.get(`${m}.${a}`);
                                  return <td key={a} style={{ textAlign: 'center' }}>{p ? <input type="checkbox" aria-label={`${m}.${a}`} checked={draft.has(p.id)} disabled={!editable} onChange={(e) => toggle(p.id, e.target.checked)} /> : <span className="muted">·</span>}</td>;
                                })}
                                {editable && <td><Checkbox label={tr('الكل', 'All')} checked={allOn} onChange={(on) => toggleRow(m, on)} /></td>}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {draft.size > 0 && ![...draft].some((id) => d.permissions.find((p) => p.id === id)?.action === 'view') && <Notice tone="warning">{tr('الدور لا يتضمن أي صلاحية «عرض»؛ لن يرى حاملوه أي وحدة.', 'The role has no “view” permission; holders will not see any module.')}</Notice>}
                    {sensitive.length > 0 && <p className="tiny muted">{tr('صلاحيات حساسة', 'Sensitive permissions')}: <span className="mono ltr">{sensitive.join(', ')}</span></p>}
                  </div>
                )}
              </CardBody>
            </Card>
            <RecordFormModal open={creating} title={tr('دور مخصص جديد', 'New custom role')} fields={createFields} initial={{}} onClose={() => setCreating(false)} onSubmit={create} />
          </div>
        );
      }}
    </AsyncView>
  );
}
