import { lazy, Suspense, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { RequireAuth, RequireSuperAdmin, RootRedirect } from './guards';
import { OrgProvider } from '@/app/OrgProvider';
import { OrgLayout } from '@/layouts/OrgLayout';
import { PlatformLayout } from '@/layouts/PlatformLayout';
import { AuthLayout } from '@/pages/auth/AuthLayout';
import { ModuleGate } from '@/components/ModuleGate';
import { NotFoundPage, Splash } from '@/pages/MiscPages';
import { useI18n } from '@/i18n/I18nProvider';
import type { ModuleKey } from '@/types/db';

const L = (f: () => Promise<{ default: ComponentType }>): LazyExoticComponent<ComponentType> => lazy(f);

const LoginPage = L(() => import('@/pages/auth/LoginPage'));
const ForgotPasswordPage = L(() => import('@/pages/auth/ForgotPasswordPage'));
const ResetPasswordPage = L(() => import('@/pages/auth/ResetPasswordPage'));
const AcceptInvitationPage = L(() => import('@/pages/auth/AcceptInvitationPage'));
const SelectOrganizationPage = L(() => import('@/pages/SelectOrganizationPage'));
const NoAccessPage = L(() => import('@/pages/NoAccessPage'));

const PlatformOverviewPage = L(() => import('@/features/platform-admin/pages/PlatformOverviewPage'));
const OrganizationsPage = L(() => import('@/features/platform-admin/pages/OrganizationsPage'));
const OrganizationDetailPage = L(() => import('@/features/platform-admin/pages/OrganizationDetailPage'));
const PlatformUsersPage = L(() => import('@/features/platform-admin/pages/PlatformUsersPage'));
const RolesPermissionsPage = L(() => import('@/features/platform-admin/pages/RolesPermissionsPage'));
const CentralTemplatesPage = L(() => import('@/features/platform-admin/pages/CentralTemplatesPage'));
const ProgramTracksPage = L(() => import('@/features/platform-admin/pages/ProgramTracksPage'));
const MaturityFrameworksPage = L(() => import('@/features/platform-admin/pages/MaturityFrameworksPage'));
const ImpactFrameworksPage = L(() => import('@/features/platform-admin/pages/ImpactFrameworksPage'));
const IntegrationsPage = L(() => import('@/features/platform-admin/pages/IntegrationsPage'));
const PlatformAuditPage = L(() => import('@/features/platform-admin/pages/PlatformAuditPage'));
const SystemSettingsPage = L(() => import('@/features/platform-admin/pages/SystemSettingsPage'));

const DashboardPage = L(() => import('@/features/dashboard/pages/DashboardPage'));
const ProgramsPage = L(() => import('@/features/programs/pages/ProgramsPage'));
const ProgramCreatePage = L(() => import('@/features/programs/pages/ProgramCreatePage'));
const ProgramWorkspace = L(() => import('@/features/programs/workspace/ProgramWorkspace'));
const BeneficiariesPage = L(() => import('@/features/beneficiaries/pages/BeneficiariesPage'));
const Beneficiary360Page = L(() => import('@/features/beneficiaries/pages/Beneficiary360Page'));
const ExpertsPage = L(() => import('@/features/experts/pages/ExpertsPage'));
const Expert360Page = L(() => import('@/features/experts/pages/Expert360Page'));
const VendorsPage = L(() => import('@/features/vendors/pages/VendorsPage'));
const PartnersPage = L(() => import('@/features/partners/pages/PartnersPage'));
const OperationsPage = L(() => import('@/features/operations/pages/OperationsPage'));
const AssessmentsPage = L(() => import('@/features/assessments/pages/AssessmentsPage'));
const ToolBuilderPage = L(() => import('@/features/assessments/pages/ToolBuilderPage'));
const EvidencePage = L(() => import('@/features/evidence/pages/EvidencePage'));
const OutcomesPage = L(() => import('@/features/outcomes/pages/OutcomesPage'));
const ImpactPage = L(() => import('@/features/impact/pages/ImpactPage'));
const TemplatesPage = L(() => import('@/features/templates/pages/TemplatesPage'));
const FormBuilderPage = L(() => import('@/features/templates/pages/FormBuilderPage'));
const ReportsPage = L(() => import('@/features/reports/pages/ReportsPage'));
const ReportDetailPage = L(() => import('@/features/reports/pages/ReportDetailPage'));
const GovernancePage = L(() => import('@/features/governance/pages/GovernancePage'));
const NotificationsPage = L(() => import('@/features/notifications/pages/NotificationsPage'));

function Auth({ title, sub, children }: { title: [string, string]; sub?: [string, string]; children: ReactNode }) {
  const { tr } = useI18n();
  return <AuthLayout title={tr(title[0], title[1])} subtitle={sub ? tr(sub[0], sub[1]) : undefined}>{children}</AuthLayout>;
}

const gate = (m: ModuleKey, el: ReactNode) => <ModuleGate module={m}>{el}</ModuleGate>;

export function AppRoutes() {
  return (
    <Suspense fallback={<Splash />}>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<Auth title={['تسجيل الدخول', 'Sign in']}><LoginPage /></Auth>} />
        <Route path="/forgot-password" element={<Auth title={['استعادة كلمة المرور', 'Reset your password']}><ForgotPasswordPage /></Auth>} />
        <Route path="/reset-password" element={<Auth title={['تعيين كلمة مرور جديدة', 'Set a new password']}><ResetPasswordPage /></Auth>} />
        <Route path="/invite/:token" element={<Auth title={['قبول الدعوة', 'Accept invitation']}><AcceptInvitationPage /></Auth>} />
        <Route path="/invite" element={<Auth title={['قبول الدعوة', 'Accept invitation']}><AcceptInvitationPage /></Auth>} />
        <Route path="/select-organization" element={<RequireAuth><Auth title={['اختيار المؤسسة', 'Choose organization']}><SelectOrganizationPage /></Auth></RequireAuth>} />
        <Route path="/no-access" element={<RequireAuth><Auth title={['لا يوجد وصول', 'No access']}><NoAccessPage /></Auth></RequireAuth>} />

        <Route path="/platform" element={<RequireAuth><RequireSuperAdmin><PlatformLayout /></RequireSuperAdmin></RequireAuth>}>
          <Route index element={<PlatformOverviewPage />} />
          <Route path="organizations" element={<OrganizationsPage />} />
          <Route path="organizations/:organizationId" element={<OrganizationDetailPage />} />
          <Route path="users" element={<PlatformUsersPage />} />
          <Route path="roles" element={<RolesPermissionsPage />} />
          <Route path="templates" element={<CentralTemplatesPage />} />
          <Route path="tracks" element={<ProgramTracksPage />} />
          <Route path="frameworks" element={<Navigate to="maturity" replace />} />
          <Route path="frameworks/maturity" element={<MaturityFrameworksPage />} />
          <Route path="frameworks/impact" element={<ImpactFrameworksPage />} />
          <Route path="integrations" element={<IntegrationsPage />} />
          <Route path="audit" element={<PlatformAuditPage />} />
          <Route path="settings" element={<SystemSettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>

        <Route path="/app" element={<RequireAuth><OrgProvider fallback={<Splash />} onMissing={() => <Navigate to="/" replace />}><OrgLayout /></OrgProvider></RequireAuth>}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="programs" element={gate('programs', <ProgramsPage />)} />
          <Route path="programs/new" element={gate('programs', <ProgramCreatePage />)} />
          <Route path="programs/:programId/*" element={gate('programs', <ProgramWorkspace />)} />
          <Route path="beneficiaries" element={gate('beneficiaries', <BeneficiariesPage />)} />
          <Route path="beneficiaries/:beneficiaryId/*" element={gate('beneficiaries', <Beneficiary360Page />)} />
          <Route path="experts" element={gate('experts', <ExpertsPage />)} />
          <Route path="experts/:expertId/*" element={gate('experts', <Expert360Page />)} />
          <Route path="vendors" element={gate('vendors', <VendorsPage />)} />
          <Route path="partners" element={gate('partners', <PartnersPage />)} />
          <Route path="operations" element={gate('operations', <OperationsPage />)} />
          <Route path="assessments" element={gate('assessments', <AssessmentsPage />)} />
          <Route path="assessments/tools/:toolId" element={gate('assessments', <ToolBuilderPage />)} />
          <Route path="evidence" element={gate('evidence', <EvidencePage />)} />
          <Route path="outcomes" element={gate('outcomes', <OutcomesPage />)} />
          <Route path="impact" element={gate('impact', <ImpactPage />)} />
          <Route path="templates" element={gate('templates', <TemplatesPage />)} />
          <Route path="templates/:templateId" element={gate('templates', <FormBuilderPage />)} />
          <Route path="reports" element={gate('reports', <ReportsPage />)} />
          <Route path="reports/:reportId" element={gate('reports', <ReportDetailPage />)} />
          <Route path="governance/*" element={<GovernancePage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
