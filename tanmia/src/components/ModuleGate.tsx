import type { ReactNode } from 'react';
import { Lock, PowerOff } from 'lucide-react';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { EmptyState } from '@/components/ui';
import type { ModuleKey } from '@/types/db';

/** Shows a controlled state when a module is deactivated or not permitted. RLS enforces the same rule server-side. */
export function ModuleGate({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const { moduleEnabled, hasModule } = useOrg();
  const { tr, enumLabel } = useI18n();
  if (!moduleEnabled(module)) return <div className="card"><EmptyState icon={<PowerOff />} title={tr(`وحدة «${enumLabel('module', module)}» غير مفعّلة لهذه المؤسسة`, `The “${enumLabel('module', module)}” module is deactivated for this organization`)} description={tr('يمكن لمدير المؤسسة تفعيلها من الحوكمة ← الوحدات.', 'An organization admin can activate it from Governance → Modules.')} /></div>;
  if (!hasModule(module)) return <div className="card"><EmptyState icon={<Lock />} title={tr('لا تملك صلاحية عرض هذه الوحدة', 'You do not have permission to view this module')} description={tr('تواصل مع مدير المؤسسة لطلب الصلاحية المناسبة.', 'Contact your organization admin to request access.')} /></div>;
  return <>{children}</>;
}
