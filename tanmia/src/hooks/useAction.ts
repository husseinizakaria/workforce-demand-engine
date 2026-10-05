import { useCallback, useState } from 'react';
import { type AppError, errorOf } from '@/services/errors';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/I18nProvider';

/** Wraps a mutation: tracks busy state, shows localized error / success toasts. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>, opts: { success?: [string, string]; onDone?: (r: R) => void } = {}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const toast = useToast();
  const { tr, locale } = useI18n();
  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    setBusy(true); setError(null);
    try {
      const r = await fn(...args);
      if (opts.success) toast.success(tr(opts.success[0], opts.success[1]));
      opts.onDone?.(r);
      return r;
    } catch (e) {
      const err = errorOf(e);
      setError(err);
      toast.error(locale === 'ar' ? err.message_ar : err.message_en);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [fn, opts, toast, tr, locale]);
  return { run, busy, error, setError };
}
