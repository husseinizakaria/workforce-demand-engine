import { Link } from 'react-router';
import { Compass, Settings2, ShieldAlert } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { EmptyState, Loading } from '@/components/ui';
import { isServiceKeyMisconfigured } from '@/lib/supabase';

export function Splash() {
  return <div style={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}><div style={{ width: 260 }}><Loading rows={3} /></div></div>;
}

export function NotFoundPage() {
  const { tr } = useI18n();
  return <div className="card"><EmptyState icon={<Compass />} title={tr('الصفحة غير موجودة', 'Page not found')} action={<Link to="/">{tr('العودة للرئيسية', 'Back home')}</Link>} /></div>;
}

export function ConfigurationRequiredPage() {
  const { tr } = useI18n();
  return (
    <div style={{ maxWidth: 640, margin: '10vh auto', padding: 16 }} className="card">
      <EmptyState icon={isServiceKeyMisconfigured ? <ShieldAlert /> : <Settings2 />}
        title={isServiceKeyMisconfigured ? tr('مفتاح غير آمن في إعدادات الواجهة', 'Unsafe key in frontend configuration') : tr('المنصة غير مهيأة', 'Platform not configured')}
        description={isServiceKeyMisconfigured
          ? tr('تم إيقاف التشغيل لأن VITE_SUPABASE_ANON_KEY يحتوي مفتاح service_role. استخدم مفتاح anon/publishable فقط وأعد البناء.', 'Startup was blocked because VITE_SUPABASE_ANON_KEY contains a service-role key. Use the anon/publishable key only and rebuild.')
          : tr('هذا الإصدار بُني دون VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY. أضفهما في ملف .env ثم نفّذ npm run build.', 'This build has no VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Add them to .env and run npm run build.')} />
    </div>
  );
}
