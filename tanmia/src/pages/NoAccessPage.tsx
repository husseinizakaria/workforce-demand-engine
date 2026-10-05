import { useSearchParams } from 'react-router';
import { LogOut, ShieldOff } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useAuth } from '@/app/AuthProvider';
import { Button, EmptyState } from '@/components/ui';

export default function NoAccessPage() {
  const { tr } = useI18n();
  const { signOut, user, refreshAccess } = useAuth();
  const [sp] = useSearchParams();
  const reason = sp.get('reason') ?? 'no_membership';
  const text: Record<string, [string, string]> = {
    no_membership: ['حسابك غير مرتبط بأي مؤسسة بعد. اطلب دعوة من مدير مؤسستك ثم افتح رابط الدعوة.', 'Your account is not linked to any organization yet. Ask your organization admin for an invitation and open its link.'],
    inactive_membership: ['تم إيقاف عضويتك في المؤسسة. تواصل مع مدير المؤسسة.', 'Your organization membership is deactivated. Contact your organization admin.'],
    organization_suspended: ['المؤسسة المرتبط بها حسابك موقوفة حاليًا. تواصل مع مالك المنصة.', 'Your organization is currently suspended. Contact the platform owner.'],
  };
  const t = text[reason] ?? text.no_membership;
  return (
    <div className="stack">
      <EmptyState icon={<ShieldOff />} title={tr('لا يوجد وصول إلى مؤسسة', 'No organization access')} description={tr(t[0], t[1])} />
      <p className="tiny muted" style={{ textAlign: 'center' }}><span className="ltr">{user?.email}</span></p>
      <Button onClick={() => void refreshAccess().then(() => window.location.assign('/'))}>{tr('إعادة التحقق', 'Check again')}</Button>
      <Button variant="ghost" icon={<LogOut />} onClick={() => void signOut()}>{tr('تسجيل الخروج', 'Sign out')}</Button>
    </div>
  );
}
