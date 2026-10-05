import type { ReactNode } from 'react';
import { Globe } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { Button } from '@/components/ui';

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const { tr, locale, setLocale } = useI18n();
  return (
    <div className="auth-shell">
      <div className="auth-panel">
        <div className="auth-card">
          <div className="row between">
            <div className="row"><div className="brand-mark" aria-hidden>ن</div><div className="brand-text"><b>{tr('نماء', 'TANMIA')}</b><span>{tr('منصة البرامج وقياس الأثر', 'Programs & impact platform')}</span></div></div>
            <Button variant="ghost" size="sm" icon={<Globe />} onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}>{locale === 'ar' ? 'English' : 'العربية'}</Button>
          </div>
          <div className="card card-pad stack">
            <div className="stack-sm" style={{ gap: 2 }}><h1>{title}</h1>{subtitle && <p className="muted small">{subtitle}</p>}</div>
            {children}
          </div>
          <p className="tiny muted" style={{ textAlign: 'center' }}>{tr('الوصول مخصص للمستخدمين المصرح لهم. جميع العمليات مسجلة.', 'Access is restricted to authorized users. All activity is audited.')}</p>
        </div>
      </div>
      <aside className="auth-aside">
        <div className="stack">
          <h2>{tr('من التنفيذ إلى الأثر', 'From delivery to impact')}</h2>
          <ul>
            <li>{tr('رحلات تفاعلية لستة مسارات برامج', 'Interactive journeys for six program tracks')}</li>
            <li>{tr('تقييم ونضج T0–T5 مع تفسير النتائج', 'Assessment and T0–T5 maturity with interpretation')}</li>
            <li>{tr('سلسلة نتائج ونظرية تغيير ومؤشرات موثقة بالأدلة', 'Results chain, Theory of Change and evidence-backed indicators')}</li>
            <li>{tr('تحليل يرصد الفجوات والعوائق ويوصي بالخطوة التالية', 'Analysis that detects gaps and blockers and recommends next steps')}</li>
          </ul>
        </div>
        <p className="small">{tr('بيانات كل مؤسسة معزولة بسياسات أمان على مستوى الصفوف.', 'Each organization’s data is isolated by row-level security.')}</p>
      </aside>
    </div>
  );
}
