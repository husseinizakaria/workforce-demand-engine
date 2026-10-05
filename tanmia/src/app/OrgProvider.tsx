import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './AuthProvider';
import { all, get } from '@/services/db';
import type { AccessMembership, ModuleKey, Organization, PermissionCode } from '@/types/db';
import { readStoredOrg, writeStoredOrg } from '@/routes/resolveHome';

export interface OrgContextValue {
  org: AccessMembership['organization'];
  membership: AccessMembership | null;   // null when a platform super admin opens a workspace
  isPlatformAdmin: boolean;
  can: (perm: PermissionCode) => boolean;
  moduleEnabled: (m: ModuleKey) => boolean;
  /** Module visible in navigation: enabled and the user can view it. */
  hasModule: (m: ModuleKey) => boolean;
  roleCodes: string[];
  switchOrg: (id: string) => void;
  refresh: () => Promise<void>;
}
const Ctx = createContext<OrgContextValue | null>(null);

/** Resolves the current organization for /app/* routes. Authorization is still enforced by RLS. */
export function OrgProvider({ children, fallback, onMissing }: { children: ReactNode; fallback: ReactNode; onMissing: () => ReactNode }) {
  const { access, refreshAccess } = useAuth();
  const [orgId, setOrgId] = useState<string | null>(() => readStoredOrg());
  const [adminFetch, setAdminFetch] = useState<{ id: string; org: Organization | null; modules: Partial<Record<ModuleKey, boolean>> } | null>(null);

  const memberships = useMemo(() => access?.memberships.filter((m) => m.active) ?? [], [access]);
  const membership = memberships.find((m) => m.organization.id === orgId) ?? (memberships.length === 1 && !orgId ? memberships[0] : null);
  const isPlatformAdmin = !!access?.is_platform_super_admin;

  useEffect(() => {
    if (!membership && memberships.length === 1 && !isPlatformAdmin) { setOrgId(memberships[0].organization.id); writeStoredOrg(memberships[0].organization.id); }
  }, [membership, memberships, isPlatformAdmin]);

  // Platform owners may open any organization's workspace.
  const needAdminOrg = isPlatformAdmin && !membership && !!orgId;
  useEffect(() => {
    if (!needAdminOrg || !orgId) return;
    let alive = true;
    Promise.all([
      get<Organization>('organizations', orgId),
      all<{ module_key: ModuleKey; enabled: boolean }>('organization_modules', { filters: [['organization_id', 'eq', orgId]], order: { column: 'module_key', ascending: true } }),
    ]).then(([o, mods]) => { if (alive) setAdminFetch({ id: orgId, org: o, modules: Object.fromEntries(mods.map((m) => [m.module_key, m.enabled])) }); })
      .catch(() => { if (alive) setAdminFetch({ id: orgId, org: null, modules: {} }); });
    return () => { alive = false; };
  }, [needAdminOrg, orgId]);
  const adminOrg = needAdminOrg && adminFetch?.id === orgId ? adminFetch.org : null;
  const adminModules = adminFetch?.modules ?? {};
  const pendingAdmin = needAdminOrg && adminFetch?.id !== orgId;

  const switchOrg = useCallback((id: string) => { writeStoredOrg(id); setOrgId(id); }, []);
  const refresh = useCallback(async () => { await refreshAccess(); }, [refreshAccess]);

  const value = useMemo<OrgContextValue | null>(() => {
    const org = membership?.organization ?? (adminOrg ? { id: adminOrg.id, code: adminOrg.code, name: adminOrg.name, name_en: adminOrg.name_en, status: adminOrg.status, default_locale: adminOrg.default_locale, timezone: adminOrg.timezone } : null);
    if (!org) return null;
    const modules = membership?.modules ?? adminModules;
    const perms = new Set(membership?.permissions ?? []);
    const moduleEnabled = (m: ModuleKey) => modules[m] !== false;
    const can = (p: PermissionCode) => {
      if (isPlatformAdmin) return true;
      const mod = p.split('.')[0] as ModuleKey;
      return (mod === ('users' as ModuleKey) || moduleEnabled(mod)) && perms.has(p);
    };
    return {
      org, membership, isPlatformAdmin, can, moduleEnabled,
      hasModule: (m) => moduleEnabled(m) && (isPlatformAdmin || perms.has(`${m}.view` as PermissionCode)),
      roleCodes: membership?.roles.map((r) => r.code) ?? (isPlatformAdmin ? ['platform_super_admin'] : []),
      switchOrg, refresh,
    };
  }, [membership, adminOrg, adminModules, isPlatformAdmin, switchOrg, refresh]);

  if (!value) return <>{pendingAdmin ? fallback : onMissing()}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOrg(): OrgContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOrg outside OrgProvider');
  return v;
}
