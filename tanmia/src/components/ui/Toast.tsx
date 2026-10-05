import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { cx } from '@/utils/cx';

type Kind = 'info' | 'success' | 'error';
interface ToastItem { id: number; kind: Kind; text: string }
interface ToastApi { info: (t: string) => void; success: (t: string) => void; error: (t: string) => void }
const Ctx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((kind: Kind, text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  const api = useMemo<ToastApi>(() => ({ info: (t) => push('info', t), success: (t) => push('success', t), error: (t) => push('error', t) }), [push]);
  return (
    <Ctx.Provider value={api}>
      {children}
      {createPortal(
        <div className="toasts" role="status" aria-live="polite">
          {items.map((i) => (
            <div key={i.id} className={cx('toast', i.kind)}>
              {i.kind === 'success' ? <CheckCircle2 size={16} /> : i.kind === 'error' ? <AlertTriangle size={16} /> : <Info size={16} />}
              <span>{i.text}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast outside ToastProvider');
  return v;
}
