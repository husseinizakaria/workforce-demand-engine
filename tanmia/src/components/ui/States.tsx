import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Lock, RefreshCw } from 'lucide-react';
import type { AppError } from '@/services/errors';
import { useI18n } from '@/i18n/I18nProvider';
import { Button } from './Button';
import { cx } from '@/utils/cx';

export function Loading({ rows = 4, label }: { rows?: number; label?: string }) {
  const { tr } = useI18n();
  return (
    <div className="stack-sm" style={{ padding: 16 }} role="status" aria-label={label ?? tr('جارٍ التحميل', 'Loading')}>
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton" style={{ width: `${92 - i * 11}%` }} />)}
    </div>
  );
}

export function EmptyState({ icon, title, description, action, compact }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className="state" style={compact ? { padding: 16 } : undefined}>
      {icon ?? <Inbox />}
      <h4>{title}</h4>
      {description && <p className="small" style={{ maxWidth: 520 }}>{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, compact }: { error: AppError | null; onRetry?: () => void; compact?: boolean }) {
  const { locale, tr } = useI18n();
  if (!error) return null;
  const denied = error.code === '42501';
  return (
    <div className={cx('state', 'error')} style={compact ? { padding: 14 } : undefined} role="alert">
      {denied ? <Lock /> : <AlertTriangle />}
      <h4>{denied ? tr('لا تملك صلاحية الوصول', 'Access denied') : tr('تعذر تحميل البيانات', 'Could not load data')}</h4>
      <p className="small">{locale === 'ar' ? error.message_ar : error.message_en}</p>
      {onRetry && !denied && <Button size="sm" icon={<RefreshCw />} onClick={onRetry}>{tr('إعادة المحاولة', 'Retry')}</Button>}
    </div>
  );
}

export function Notice({ tone = 'info', icon, children }: { tone?: 'info' | 'warning' | 'danger' | 'success'; icon?: ReactNode; children: ReactNode }) {
  return <div className={cx('notice', tone)} role={tone === 'danger' ? 'alert' : undefined}>{icon ?? <AlertTriangle />}<div>{children}</div></div>;
}

/** Renders loading / error / content for a useAsync result. */
export function AsyncView<T>({ state, children, rows }: { state: { data: T | undefined; error: AppError | null; loading: boolean; reload: () => void }; children: (data: T) => ReactNode; rows?: number }) {
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  if (state.loading && state.data === undefined) return <Loading rows={rows} />;
  if (state.data === undefined) return null;
  return <>{children(state.data)}</>;
}
