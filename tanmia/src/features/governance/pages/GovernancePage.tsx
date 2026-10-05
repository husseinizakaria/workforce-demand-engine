// Governance: approvals, risks, budgets, contracts, actions, users & roles,
// module activation, data stewardship, audit log and organization settings.
import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import {
  Blocks, ClipboardCheck, Database, FileSignature, History, KeyRound, ListChecks, Lock, Settings, ShieldAlert, Users, Wallet,
} from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { Card, EmptyState, LinkTabs, PageHeader, type TabItem } from '@/components/ui';
import { NotFoundPage } from '@/pages/MiscPages';
import { ApprovalsTab } from '../components/ApprovalsTab';
import { RisksTab } from '../components/RisksTab';
import { BudgetsTab } from '../components/BudgetsTab';
import { ContractsTab } from '../components/ContractsTab';
import { ActionsTab } from '../components/ActionsTab';
import { UsersTab } from '../components/UsersTab';
import { RolesTab } from '../components/RolesTab';
import { ModulesTab } from '../components/ModulesTab';
import { StewardshipTab } from '../components/StewardshipTab';
import { AuditTab } from '../components/AuditTab';
import { SettingsTab } from '../components/SettingsTab';

export default function GovernancePage() {
  const { tr } = useI18n();
  const { hasModule, can } = useOrg();
  const gov = hasModule('governance');
  const usersView = can('users.view');
  const configure = can('governance.configure');
  const tabs: (TabItem & { el: ReactNode; allowed: boolean })[] = [
    { key: 'approvals', label: tr('الاعتمادات', 'Approvals'), icon: <ClipboardCheck />, el: <ApprovalsTab />, allowed: gov },
    { key: 'risks', label: tr('المخاطر والقضايا', 'Risks & issues'), icon: <ShieldAlert />, el: <RisksTab />, allowed: gov },
    { key: 'budgets', label: tr('الميزانيات', 'Budgets'), icon: <Wallet />, el: <BudgetsTab />, allowed: gov },
    { key: 'contracts', label: tr('العقود', 'Contracts'), icon: <FileSignature />, el: <ContractsTab />, allowed: gov },
    { key: 'actions', label: tr('الإجراءات', 'Actions'), icon: <ListChecks />, el: <ActionsTab />, allowed: gov && can('operations.view') },
    { key: 'users', label: tr('المستخدمون', 'Users'), icon: <Users />, el: <UsersTab />, allowed: usersView },
    { key: 'roles', label: tr('الأدوار والصلاحيات', 'Roles & permissions'), icon: <KeyRound />, el: <RolesTab />, allowed: usersView },
    { key: 'modules', label: tr('الوحدات', 'Modules'), icon: <Blocks />, el: <ModulesTab />, allowed: configure },
    { key: 'stewardship', label: tr('إشراف البيانات', 'Data stewardship'), icon: <Database />, el: <StewardshipTab />, allowed: gov },
    { key: 'audit', label: tr('سجل التدقيق', 'Audit log'), icon: <History />, el: <AuditTab />, allowed: gov },
    { key: 'settings', label: tr('الإعدادات', 'Settings'), icon: <Settings />, el: <SettingsTab />, allowed: configure },
  ];
  const visible = tabs.filter((t) => t.allowed);
  if (!visible.length) {
    return <div className="card"><EmptyState icon={<Lock />} title={tr('لا تملك صلاحية الوصول إلى الحوكمة', 'You do not have access to Governance')}
      description={tr('تواصل مع مدير المؤسسة لطلب الصلاحية المناسبة.', 'Contact your organization admin to request access.')} /></div>;
  }
  return (
    <div className="stack">
      <PageHeader title={tr('الحوكمة', 'Governance')} subtitle={tr('الاعتمادات والمخاطر والمالية والعقود والمستخدمون والصلاحيات وسجل التدقيق.', 'Approvals, risks, finance, contracts, users, permissions and the audit trail.')} />
      <LinkTabs base="/app/governance" items={tabs.map(({ key, label, icon, allowed }) => ({ key, label, icon, hidden: !allowed }))} />
      <Routes>
        <Route index element={<Navigate to={visible[0].key} replace />} />
        {tabs.map((t) => (
          <Route key={t.key} path={t.key} element={t.allowed ? t.el : <Card><EmptyState icon={<Lock />} title={tr('لا تملك صلاحية هذا القسم', 'You do not have access to this section')} /></Card>} />
        ))}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </div>
  );
}
