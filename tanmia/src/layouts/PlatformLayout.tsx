import { Outlet } from 'react-router';
import { Activity, Building2, ClipboardList, Gauge, Plug, Route, ScrollText, Settings, ShieldCheck, Sprout, Users, Layers } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { Shell, type NavGroup } from './Shell';
import { Badge } from '@/components/ui';

export function PlatformLayout() {
  const { tr } = useI18n();
  const groups: NavGroup[] = [
    { items: [{ to: '/platform', end: true, label: tr('نظرة عامة', 'Overview'), icon: <Gauge /> }] },
    { title: tr('المستأجرون والوصول', 'Tenants & access'), items: [
      { to: '/platform/organizations', label: tr('المؤسسات', 'Organizations'), icon: <Building2 /> },
      { to: '/platform/users', label: tr('المستخدمون', 'Users'), icon: <Users /> },
      { to: '/platform/roles', label: tr('الأدوار والصلاحيات', 'Roles & permissions'), icon: <ShieldCheck /> },
    ] },
    { title: tr('المحتوى المركزي', 'Central content'), items: [
      { to: '/platform/templates', label: tr('القوالب المركزية', 'Central templates'), icon: <ClipboardList /> },
      { to: '/platform/tracks', label: tr('مسارات البرامج', 'Program tracks'), icon: <Route /> },
      { to: '/platform/frameworks/maturity', label: tr('أطر النضج', 'Maturity frameworks'), icon: <Layers /> },
      { to: '/platform/frameworks/impact', label: tr('أطر الأثر', 'Impact frameworks'), icon: <Sprout /> },
    ] },
    { title: tr('التشغيل', 'Operations'), items: [
      { to: '/platform/integrations', label: tr('التكاملات', 'Integrations'), icon: <Plug /> },
      { to: '/platform/audit', label: tr('سجل التدقيق', 'Audit log'), icon: <ScrollText /> },
      { to: '/platform/settings', label: tr('إعدادات النظام', 'System settings'), icon: <Settings /> },
    ] },
  ];
  return (
    <Shell scope={<><b>{tr('إدارة المنصة', 'Platform administration')}</b><span className="tiny muted">{tr('صلاحية مالك المنصة', 'Platform owner authority')}</span></>}
      groups={groups} topbar={<><Badge tone="primary" icon={<Activity />}>{tr('مساحة مالك المنصة', 'Platform owner workspace')}</Badge><div className="grow" /></>}>
      <Outlet />
    </Shell>
  );
}
