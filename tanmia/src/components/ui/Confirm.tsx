import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { Modal } from './Modal';
import { Button } from './Button';

interface ConfirmOptions { title: string; message?: ReactNode; confirmLabel?: string; danger?: boolean }
type ConfirmFn = (o: ConfirmOptions) => Promise<boolean>;
const Ctx = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { tr } = useI18n();
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback<ConfirmFn>((o) => new Promise((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Modal open={!!state} title={state?.title ?? ''} onClose={() => close(false)} size="narrow"
        footer={<>
          <Button onClick={() => close(false)}>{tr('إلغاء', 'Cancel')}</Button>
          <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{state?.confirmLabel ?? tr('تأكيد', 'Confirm')}</Button>
        </>}>
        {state?.message && <div>{state.message}</div>}
      </Modal>
    </Ctx.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const v = useContext(Ctx);
  if (!v) throw new Error('useConfirm outside ConfirmProvider');
  return v;
}
