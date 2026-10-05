import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '@/utils/cx';

export function Card({ className, children, tinted, ...rest }: HTMLAttributes<HTMLDivElement> & { tinted?: boolean }) {
  return <section className={cx('card', tinted && 'tinted', className)} {...rest}>{children}</section>;
}

export function CardHeader({ title, icon, hint, actions }: { title: ReactNode; icon?: ReactNode; hint?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="card-head">
      <div className="row grow" style={{ minWidth: 0 }}>
        <h3>{icon}{title}</h3>
        {hint && <span className="hint ellipsis">{hint}</span>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function CardBody({ children, flush, className }: { children: ReactNode; flush?: boolean; className?: string }) {
  return <div className={cx('card-body', flush && 'flush', className)}>{children}</div>;
}
