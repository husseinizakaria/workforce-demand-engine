import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Building2, ExternalLink, Pencil, Power, ScrollText, ToggleLeft } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { AsyncView, Badge, Button, Card, CardBody, CardHeader, Checkbox, DataTable, Notice, PageHeader, Select, StatusBadge, Tabs, useConfirm } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { useAction } from '@/hooks/useAction';
import * as db from '@/services/db';
import { writeStoredOrg } from '@/routes/resolveHome';
import type { AuditLog, ModuleKey, Organization, OrganizationModule, Role } from '@/types/db';
import { MODULE_KEYS } from '../components/common';
import { PlatformFormModal, type PlatformFieldSpec } from '../components/PlatformForm';
import { OrgMembers } from '../components/OrgMembers';
import { OrgInvitations } from '../components/OrgInvitations';

interface Detail { org: Organization; modules: OrganizationModule[]; roles: Role[]; ttl: number; programs: number; members: number }

async function loadDetail(id: string): Promise<Detail> {
  const [org, modules, roles, platform, programs, members] = await Promise.all([
    db.get<Organization>('organizations', id),
    db.all<OrganizationModule>('organization_modules', { filters: [['organization_id', 'eq', id]], order: { column: 'module_key', ascending: true } }),
    db.all<Role>('roles', { filters: [['organization_id', 'eq', id]], order: { column: 'name_ar', ascending: true } }),
    db.maybe<{ setting_value: { invitation_ttl_days?: number } }>('system_settings', [['organization_id', 'is', null], ['setting_key', 'eq', 'platform']], 'setting_value'),
    db.count('programs', [['organization_id', 'eq', id]]),
    db.count('organization_members', [['organization_id', 'eq', id], ['active', 'eq', true]]),
  ]);
  const ttl = Number(platform?.setting_value?.invitation_ttl_days ?? 7);
  return { org, modules, roles, ttl: Number.isInteger(ttl) && ttl >= 1 && ttl <= 30 ? ttl : 7, programs, members };
}

const STATUS_TEXT: Record<Organization['status'], [string, string]> = {
  active: ['سيستعيد الأعضاء الوصول فورًا.', 'Members regain access immediately.'],
  suspended: ['سيُمنع جميع الأعضاء من الدخول مع الاحتفاظ بكل البيانات. استخدمه لإيقاف مؤقت (مثل انتهاء التعاقد).', 'All members are blocked from signing in; all data is kept. Use for a temporary stop (e.g. contract lapse).'],
  archived: ['ستُغلق المؤسسة ويُمنع الدخول، وتبقى البيانات للأرشفة والتدقيق.', 'The organization is closed and access blocked; data is retained for archive and audit.'],
};

export default function OrganizationDetailPage() {
  const { organizationId = '' } = useParams();
  const { tr, pick, enumLabel, fmtDate, fmtDateTime, fmtNumber } = useI18n();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const state = useAsync(() => loadDetail(organizationId), [organizationId]);
  const [tab, setTab] = useState('members');
  const [editing, setEditing] = useState(false);
  const audit = useAsync(() => db.list<AuditLog>('audit_log', { filters: [['organization_id', 'eq', organizationId]], pageSize: 25, order: { column: 'created_at', ascending: false } }), [organizationId]);

  const setStatus = useAction(async (status: Organization['status']) => {
    const org = await db.update<Organization>('organizations', organizationId, { status });
    state.setData((d) => ({ ...d!, org }));
  }, { success: ['تم تغيير حالة المؤسسة', 'Organization status changed'] });

  const toggleModule = useAction(async (key: ModuleKey, enabled: boolean) => {
    const row = await db.upsert<OrganizationModule>('organization_modules', { organization_id: organizationId, module_key: key, enabled }, 'organization_id,module_key');
    state.setData((d) => ({ ...d!, modules: [...d!.modules.filter((m) => m.module_key !== key), row] }));
  }, { success: ['تم تحديث الوحدة', 'Module updated'] });

  const fields: PlatformFieldSpec[] = [
    { name: 'name', label: ['الاسم (عربي)', 'Name (Arabic)'], type: 'text', required: true },
    { name: 'name_en', label: ['الاسم (إنجليزي)', 'Name (English)'], type: 'text' },
    { name: 'org_type', label: ['نوع الجهة', 'Organization type'], type: 'text' },
    { name: 'sector', label: ['القطاع', 'Sector'], type: 'text' },
    { name: 'city', label: ['المدينة', 'City'], type: 'text' },
    { name: 'contact_email', label: ['بريد التواصل', 'Contact email'], type: 'email' },
    { name: 'default_locale', label: ['اللغة الافتراضية', 'Default language'], type: 'select', required: true, options: [{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }] },
    { name: 'timezone', label: ['المنطقة الزمنية', 'Time zone'], type: 'text', required: true, hint: ['مثال: Asia/Riyadh', 'e.g. Asia/Riyadh'],
      validate: (v) => (/^[A-Za-z]+\/[A-Za-z_]+$/.test(String(v)) ? null : ['صيغة IANA غير صالحة', 'Invalid IANA time zone']) },
  ];

  return (
    <AsyncView state={state} rows={8}>
      {(d) => {
        const o = d.org;
        const enabled = (k: ModuleKey) => d.modules.find((m) => m.module_key === k)?.enabled ?? true;
        const changeStatus = async (s: Organization['status']) => {
          if (s === o.status) return;
          const ok = await confirm({
            title: tr(`تغيير الحالة إلى «${enumLabel('orgStatus', s)}»`, `Change status to “${enumLabel('orgStatus', s)}”`),
            message: <div className="stack-sm"><p>{tr(STATUS_TEXT[s][0], STATUS_TEXT[s][1])}</p><p className="small muted">{tr(`يؤثر على ${d.members} عضو نشط.`, `Affects ${d.members} active members.`)}</p></div>,
            danger: s !== 'active',
          });
          if (ok) await setStatus.run(s);
        };
        return (
          <div className="stack">
            <PageHeader title={pick(o.name, o.name_en)} badge={<><StatusBadge group="orgStatus" value={o.status} /><Badge tone="outline"><span className="mono">{o.code}</span></Badge></>}
              crumbs={[{ label: tr('إدارة المنصة', 'Platform'), to: '/platform' }, { label: tr('المؤسسات', 'Organizations'), to: '/platform/organizations' }, { label: o.code }]}
              subtitle={[o.org_type, o.sector, o.city].filter(Boolean).join(' · ') || undefined}
              actions={<>
                <Button icon={<Pencil />} onClick={() => setEditing(true)}>{tr('تعديل الملف', 'Edit profile')}</Button>
                <Button variant="primary" icon={<ExternalLink />} disabled={o.status !== 'active'}
                  title={o.status !== 'active' ? tr('المؤسسة غير نشطة', 'Organization is not active') : undefined}
                  onClick={() => { writeStoredOrg(o.id); navigate('/app/dashboard'); }}>{tr('فتح مساحة العمل', 'Open workspace')}</Button>
              </>} />

            {o.status !== 'active' && <Notice tone="warning">{tr('المؤسسة غير نشطة: لا يستطيع أعضاؤها تسجيل الدخول إليها.', 'This organization is not active: its members cannot sign in to it.')}</Notice>}

            <div className="grid g-2-1">
              <Card>
                <CardHeader icon={<Building2 />} title={tr('ملف المؤسسة', 'Organization profile')} />
                <CardBody>
                  <dl className="kv">
                    <dt>{tr('الاسم (عربي)', 'Name (Arabic)')}</dt><dd>{o.name}</dd>
                    <dt>{tr('الاسم (إنجليزي)', 'Name (English)')}</dt><dd>{o.name_en ?? '—'}</dd>
                    <dt>{tr('بريد التواصل', 'Contact email')}</dt><dd className="ltr">{o.contact_email ?? '—'}</dd>
                    <dt>{tr('اللغة / المنطقة الزمنية', 'Locale / time zone')}</dt><dd>{o.default_locale === 'ar' ? 'العربية' : 'English'} · <span className="mono">{o.timezone}</span></dd>
                    <dt>{tr('الأعضاء النشطون / البرامج', 'Active members / programs')}</dt><dd>{fmtNumber(d.members)} / {fmtNumber(d.programs)}</dd>
                    <dt>{tr('أُنشئت', 'Created')}</dt><dd>{fmtDate(o.created_at)}</dd>
                    <dt>{tr('آخر تحديث', 'Updated')}</dt><dd>{fmtDateTime(o.updated_at)}</dd>
                  </dl>
                </CardBody>
              </Card>
              <Card>
                <CardHeader icon={<Power />} title={tr('حالة المؤسسة', 'Organization status')} />
                <CardBody>
                  <div className="stack-sm">
                    <Select value={o.status} disabled={setStatus.busy} onChange={(e) => void changeStatus(e.target.value as Organization['status'])}
                      options={(['active', 'suspended', 'archived'] as const).map((s) => ({ value: s, label: enumLabel('orgStatus', s) }))} />
                    <p className="small muted">{tr(STATUS_TEXT[o.status][0], STATUS_TEXT[o.status][1])}</p>
                    <p className="tiny muted">{tr('تغيير الحالة متاح لمالك المنصة فقط ويُسجل في سجل التدقيق.', 'Only the platform owner can change status; every change is audited.')}</p>
                  </div>
                </CardBody>
              </Card>
            </div>

            <Card>
              <CardHeader icon={<ToggleLeft />} title={tr('الوحدات المفعلة', 'Enabled modules')}
                hint={tr('تعطيل وحدة يخفيها ويمنع الوصول لبياناتها (RLS) دون حذف أي بيانات.', 'Disabling a module hides it and blocks access to its data (RLS) without deleting anything.')} />
              <CardBody>
                <div className="grid g5" style={{ gap: 8 }}>
                  {MODULE_KEYS.map((k) => (
                    <Checkbox key={k} label={enumLabel('module', k)} checked={enabled(k)} disabled={toggleModule.busy}
                      onChange={async (c) => {
                        if (!c && !(await confirm({ title: tr('تعطيل الوحدة', 'Disable module'), message: tr(`سيفقد جميع أعضاء المؤسسة الوصول إلى «${enumLabel('module', k)}» فورًا.`, `All members lose access to “${enumLabel('module', k)}” immediately.`), danger: true }))) return;
                        await toggleModule.run(k, c);
                      }} />
                  ))}
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardBody>
                <Tabs value={tab} onChange={setTab} items={[
                  { key: 'members', label: tr('الأعضاء والأدوار', 'Members & roles') },
                  { key: 'invitations', label: tr('الدعوات', 'Invitations') },
                  { key: 'audit', label: tr('سجل التدقيق', 'Audit log'), icon: <ScrollText size={14} /> },
                ]} />
                <div style={{ marginTop: 12 }}>
                  {tab === 'members' && <OrgMembers orgId={o.id} roles={d.roles} />}
                  {tab === 'invitations' && <OrgInvitations orgId={o.id} roles={d.roles} defaultTtl={d.ttl} />}
                  {tab === 'audit' && (
                    <DataTable<AuditLog> rows={audit.data?.rows ?? []} rowKey={(r) => String(r.id)} loading={audit.loading} error={audit.error} onRetry={() => void audit.reload()}
                      empty={{ title: tr('لا توجد أحداث', 'No events') }}
                      toolbar={<Button size="sm" variant="ghost" onClick={() => navigate(`/platform/audit?organization=${o.id}`)}>{tr('عرض الكل في سجل التدقيق', 'View all in audit log')}</Button>}
                      columns={[
                        { key: 'time', header: tr('الوقت', 'Time'), render: (r) => <span className="nowrap small">{fmtDateTime(r.created_at)}</span> },
                        { key: 'action', header: tr('الإجراء', 'Action'), render: (r) => <span className="mono">{r.action}</span> },
                        { key: 'entity', header: tr('الكيان', 'Entity'), render: (r) => <span className="mono">{r.entity_type ?? '—'}</span> },
                        { key: 'source', header: tr('المصدر', 'Source'), render: (r) => <Badge tone="outline">{r.source}</Badge> },
                        { key: 'summary', header: tr('الملخص', 'Summary'), render: (r) => <span className="small">{r.summary ?? (r.new_data ? Object.keys(r.new_data).slice(0, 5).join(', ') : '—')}</span> },
                      ]} />
                  )}
                </div>
              </CardBody>
            </Card>

            <PlatformFormModal open={editing} onClose={() => setEditing(false)} title={tr('تعديل ملف المؤسسة', 'Edit organization profile')} fields={fields}
              initial={{ name: o.name, name_en: o.name_en, org_type: o.org_type, sector: o.sector, city: o.city, contact_email: o.contact_email, default_locale: o.default_locale, timezone: o.timezone }}
              onSubmit={async (v) => { const org = await db.update<Organization>('organizations', o.id, v); state.setData((x) => ({ ...x!, org })); }} />
          </div>
        );
      }}
    </AsyncView>
  );
}
