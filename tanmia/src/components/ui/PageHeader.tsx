import type { ReactNode } from 'react';
import { Link } from 'react-router';

export function PageHeader({ title, subtitle, actions, crumbs, badge }: {
  title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; crumbs?: { label: string; to?: string }[]; badge?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="titles">
        {crumbs && crumbs.length > 0 && (
          <nav className="crumbs" aria-label="breadcrumb">
            {crumbs.map((c, i) => (
              <span key={i} className="row" style={{ gap: 6 }}>{c.to ? <Link to={c.to}>{c.label}</Link> : c.label}{i < crumbs.length - 1 && <span aria-hidden>›</span>}</span>
            ))}
          </nav>
        )}
        <div className="row wrap"><h1>{title}</h1>{badge}</div>
        {subtitle && <p className="sub">{subtitle}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}
