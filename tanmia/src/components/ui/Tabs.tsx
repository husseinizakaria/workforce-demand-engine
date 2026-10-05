import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { cx } from '@/utils/cx';

export interface TabItem { key: string; label: string; icon?: ReactNode; badge?: ReactNode; hidden?: boolean }

/** Route-driven tabs: each tab is a link relative to `base`. */
export function LinkTabs({ items, base }: { items: TabItem[]; base: string }) {
  return (
    <nav className="tabs" role="tablist">
      {items.filter((i) => !i.hidden).map((i) => (
        <NavLink key={i.key} to={`${base}/${i.key}`} role="tab" className={({ isActive }) => cx(isActive && 'active')}>
          {i.icon}{i.label}{i.badge}
        </NavLink>
      ))}
    </nav>
  );
}

/** Local-state tabs. */
export function Tabs({ items, value, onChange }: { items: TabItem[]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {items.filter((i) => !i.hidden).map((i) => (
        <button key={i.key} type="button" role="tab" aria-selected={value === i.key} className={cx(value === i.key && 'active')} onClick={() => onChange(i.key)}>
          {i.icon}{i.label}{i.badge}
        </button>
      ))}
    </div>
  );
}
