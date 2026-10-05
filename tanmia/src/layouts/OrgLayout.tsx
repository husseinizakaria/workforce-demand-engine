import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router';
import {
  Bell, Building2, CalendarDays, ClipboardCheck, FileCheck2, FileStack, FileText, FolderKanban, Handshake, LayoutDashboard,
  Search, ShieldCheck, Sprout, Target, Truck, UserRoundCog, Users, ArrowLeftRight, Crown,
} from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAuth } from '@/app/AuthProvider';
import { Shell, type NavGroup } from './Shell';
import { AskPlatformButton } from '@/features/ai/AskPlatform';
import { NotificationsBell } from '@/features/notifications/NotificationsBell';
import { list } from '@/services/db';
import { useDebounced } from '@/hooks/useAsync';
import type { ModuleKey } from '@/types/db';
import { Badge, Button } from '@/components/ui';

export function OrgLayout() {
  const { tr, pick } = useI18n();
  const { org, hasModule, isPlatformAdmin, membership } = useOrg();
  const { access } = useAuth();
  const nav = useNavigate();
  const m = (key: ModuleKey) => hasModule(key);
  const groups: NavGroup[] = [
    { items: [{ to: '/app/dashboard', label: tr('لوحة القيادة', 'Dashboard'), icon: <LayoutDashboard /> }] },
    { title: tr('التنفيذ', 'Delivery'), items: [
      m('programs') && { to: '/app/programs', label: tr('البرامج', 'Programs'), icon: <FolderKanban /> },
      m('beneficiaries') && { to: '/app/beneficiaries', label: tr('المستفيدون', 'Beneficiaries'), icon: <Users /> },
      m('experts') && { to: '/app/experts', label: tr('الخبراء', 'Experts'), icon: <UserRoundCog /> },
      m('vendors') && { to: '/app/vendors', label: tr('الموردون', 'Vendors'), icon: <Truck /> },
      m('partners') && { to: '/app/partners', label: tr('الشركاء', 'Partners'), icon: <Handshake /> },
      m('operations') && { to: '/app/operations', label: tr('التشغيل والجدولة', 'Operations'), icon: <CalendarDays /> },
    ].filter(Boolean) as NavGroup['items'] },
    { title: tr('القياس والأثر', 'Measurement & impact'), items: [
      m('assessments') && { to: '/app/assessments', label: tr('التقييم والجودة', 'Assessments'), icon: <ClipboardCheck /> },
      m('evidence') && { to: '/app/evidence', label: tr('الأدلة', 'Evidence'), icon: <FileCheck2 /> },
      m('outcomes') && { to: '/app/outcomes', label: tr('المخرجات والنتائج', 'Outputs & outcomes'), icon: <Target /> },
      m('impact') && { to: '/app/impact', label: tr('الأثر', 'Impact'), icon: <Sprout /> },
    ].filter(Boolean) as NavGroup['items'] },
    { title: tr('الإدارة', 'Administration'), items: [
      m('templates') && { to: '/app/templates', label: tr('القوالب والنماذج', 'Templates'), icon: <FileStack /> },
      m('reports') && { to: '/app/reports', label: tr('التقارير', 'Reports'), icon: <FileText /> },
      (m('governance') || membership?.permissions.some((p) => p.startsWith('users.'))) && { to: '/app/governance', label: tr('الحوكمة', 'Governance'), icon: <ShieldCheck /> },
      { to: '/app/notifications', label: tr('الإشعارات', 'Notifications'), icon: <Bell /> },
    ].filter(Boolean) as NavGroup['items'] },
  ];
  const multi = (access?.memberships.filter((x) => x.active).length ?? 0) > 1;
  const roles = membership?.roles.map((r) => pick(r.name_ar, r.name_en)).join('، ');
  return (
    <Shell
      scope={<>
        <b className="ellipsis">{pick(org.name, org.name_en)}</b>
        <span className="tiny muted mono">{org.code}</span>
        <div className="tiny muted ellipsis" title={roles}>{isPlatformAdmin && !membership ? tr('مالك المنصة', 'Platform owner') : roles}</div>
        {(multi || isPlatformAdmin) && (
          <div className="row" style={{ marginTop: 4 }}>
            {multi && <Link className="tiny" to="/select-organization"><ArrowLeftRight size={12} /> {tr('تبديل المؤسسة', 'Switch organization')}</Link>}
            {isPlatformAdmin && <Link className="tiny" to="/platform"><Crown size={12} /> {tr('إدارة المنصة', 'Platform admin')}</Link>}
          </div>
        )}
      </>}
      groups={groups}
      topbar={<>
        <GlobalSearch onPick={(to) => nav(to)} />
        <div className="grow" />
        {isPlatformAdmin && !membership && <Badge tone="warning" icon={<Building2 />}>{tr('عرض بصلاحية مالك المنصة', 'Viewing as platform owner')}</Badge>}
        <AskPlatformButton />
        <NotificationsBell />
      </>}>
      <Outlet />
    </Shell>
  );
}

function GlobalSearch({ onPick }: { onPick: (to: string) => void }) {
  const { tr } = useI18n();
  const { org, hasModule } = useOrg();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const term = useDebounced(q, 250);
  const [res, setRes] = useState<{ to: string; label: string; kind: string }[]>([]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (term.trim().length < 2) { setRes([]); return; }
    let alive = true;
    const base = { filters: [['organization_id', 'eq', org.id]] as [string, 'eq', string][], pageSize: 5 };
    Promise.all([
      hasModule('programs') ? list<{ id: string; code: string; name: string }>('programs', { ...base, select: 'id,code,name', search: { columns: ['name', 'code'], term } }) : Promise.resolve({ rows: [] }),
      hasModule('beneficiaries') ? list<{ id: string; code: string; full_name: string }>('beneficiaries', { ...base, select: 'id,code,full_name', search: { columns: ['full_name', 'code', 'email', 'mobile'], term } }) : Promise.resolve({ rows: [] }),
      hasModule('experts') ? list<{ id: string; code: string; full_name: string }>('experts', { ...base, select: 'id,code,full_name', search: { columns: ['full_name', 'code'], term } }) : Promise.resolve({ rows: [] }),
    ]).then(([p, b, e]) => {
      if (!alive) return;
      setRes([
        ...p.rows.map((r) => ({ to: `/app/programs/${r.id}/overview`, label: `${r.name} · ${r.code}`, kind: tr('برنامج', 'Program') })),
        ...b.rows.map((r) => ({ to: `/app/beneficiaries/${r.id}/overview`, label: `${r.full_name} · ${r.code}`, kind: tr('مستفيد', 'Beneficiary') })),
        ...e.rows.map((r) => ({ to: `/app/experts/${r.id}/profile`, label: `${r.full_name} · ${r.code}`, kind: tr('خبير', 'Expert') })),
      ]);
    }).catch(() => setRes([]));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, org.id]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div className="search" ref={box}>
      <Search aria-hidden />
      <input className="input" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        placeholder={tr('بحث في البرامج والمستفيدين والخبراء…', 'Search programs, beneficiaries, experts…')} aria-label={tr('بحث شامل', 'Global search')} />
      {open && res.length > 0 && (
        <div className="popover menu" style={{ top: 38, insetInlineStart: 0, width: '100%' }}>
          {res.map((r) => <button key={r.to} type="button" onClick={() => { setOpen(false); setQ(''); onPick(r.to); }}><Badge tone="outline">{r.kind}</Badge><span className="ellipsis">{r.label}</span></button>)}
        </div>
      )}
      {open && term.length >= 2 && !res.length && <div className="popover small muted" style={{ top: 38, insetInlineStart: 0, width: '100%', padding: 10 }}>{tr('لا نتائج', 'No results')}</div>}
      <Button className="sr-only" onClick={() => setOpen(false)}>close</Button>
    </div>
  );
}
