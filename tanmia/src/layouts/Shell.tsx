import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';
import { Globe, LogOut, Menu } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useAuth } from '@/app/AuthProvider';
import { Button } from '@/components/ui';
import { cx } from '@/utils/cx';
import { useEffect } from 'react';

export interface NavItem { to: string; label: string; icon: ReactNode; end?: boolean; count?: number }
export interface NavGroup { title?: string; items: NavItem[] }

/** Application shell: right-side navigation in Arabic (logical CSS flips it for English). */
export function Shell({ scope, groups, topbar, children }: { scope: ReactNode; groups: NavGroup[]; topbar: ReactNode; children: ReactNode }) {
  const { tr, locale, setLocale } = useI18n();
  const { user, access, signOut } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setNavOpen(false), [loc.pathname]);
  const name = access?.profile?.full_name || user?.email || '';
  return (
    <div className={cx('shell', navOpen && 'nav-open')}>
      <aside className="sidebar" aria-label={tr('القائمة الرئيسية', 'Main navigation')}>
        <div className="sidebar-brand">
          <div className="brand-mark" aria-hidden>ن</div>
          <div className="brand-text"><b>{tr('نماء', 'TANMIA')}</b><span>{tr('البرامج وقياس الأثر', 'Programs & impact')}</span></div>
        </div>
        <div className="sidebar-scope">{scope}</div>
        <nav className="nav">
          {groups.map((g, gi) => (
            <div key={gi} style={{ display: 'contents' }}>
              {g.title && <div className="nav-group">{g.title}</div>}
              {g.items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => cx(isActive && 'active')}>
                  {i.icon}<span className="ellipsis">{i.label}</span>{!!i.count && <span className="count">{i.count}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="row small" style={{ padding: '4px 8px' }}>
            <div className="brand-mark" style={{ width: 28, height: 28, fontSize: 13, background: '#C9D6D3', color: 'var(--primary-dark)' }} aria-hidden>{name.slice(0, 1).toUpperCase()}</div>
            <div className="grow" style={{ minWidth: 0 }}><div className="ellipsis strong">{name}</div><div className="tiny muted ellipsis ltr">{user?.email}</div></div>
          </div>
          <div className="row">
            <Button variant="ghost" size="sm" icon={<Globe />} onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}>{locale === 'ar' ? 'English' : 'العربية'}</Button>
            <Button variant="ghost" size="sm" icon={<LogOut />} onClick={() => void signOut()}>{tr('خروج', 'Sign out')}</Button>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <Button variant="ghost" iconOnly icon={<Menu />} className="only-mobile" onClick={() => setNavOpen((o) => !o)} aria-label={tr('القائمة', 'Menu')} />
          {topbar}
        </header>
        <main className="content" id="main">{children}</main>
      </div>
    </div>
  );
}
