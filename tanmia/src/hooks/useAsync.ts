import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { type AppError, errorOf } from '@/services/errors';

export interface AsyncState<T> {
  data: T | undefined; error: AppError | null; loading: boolean;
  reload: () => Promise<void>; setData: (updater: T | ((prev: T | undefined) => T)) => void;
}

/** Runs an async loader on mount / when deps change; exposes reload and local mutation. */
export function useAsync<T>(loader: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [data, setDataState] = useState<T>();
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const run = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true); setError(null);
    try {
      const v = await loaderRef.current();
      if (id === seq.current) setDataState(v);
    } catch (e) {
      if (id === seq.current) setError(errorOf(e));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void run(); }, deps);

  const setData = useCallback((u: T | ((prev: T | undefined) => T)) => {
    setDataState((prev) => (typeof u === 'function' ? (u as (p: T | undefined) => T)(prev) : u));
  }, []);
  return { data, error, loading, reload: run, setData };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
