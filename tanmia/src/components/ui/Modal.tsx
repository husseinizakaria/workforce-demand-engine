import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cx } from '@/utils/cx';
import { useI18n } from '@/i18n/I18nProvider';
import { Button } from './Button';

function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);
}

export function Modal({ title, open, onClose, children, footer, size }: {
  title: ReactNode; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'narrow' | 'wide';
}) {
  const { tr } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
    first?.focus();
    return () => prev?.focus();
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={cx('modal', size)} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} ref={ref}>
        <div className="modal-head">
          <h3>{title}</h3>
          <Button variant="ghost" size="sm" iconOnly icon={<X />} onClick={onClose} aria-label={tr('إغلاق', 'Close')} data-close />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ title, open, onClose, children, footer, wide }: { title: ReactNode; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const { tr } = useI18n();
  useEscape(onClose);
  if (!open) return null;
  return createPortal(
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className={cx('drawer', wide && 'wide')} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <Button variant="ghost" size="sm" iconOnly icon={<X />} onClick={onClose} aria-label={tr('إغلاق', 'Close')} />
        </div>
        <div className="modal-body" style={{ flex: 1 }}>{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </aside>
    </>,
    document.body,
  );
}
