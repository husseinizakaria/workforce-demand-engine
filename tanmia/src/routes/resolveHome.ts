// Post-login routing — implements the specification exactly:
//  1. no session → /login
//  2. platform super admin → /platform (no invitation code, no organization required)
//  3. otherwise active memberships: one → enter it; several → selector; none → controlled no-access state
import type { AccessContext } from '@/types/db';

export type HomeDecision =
  | { kind: 'login'; path: '/login' }
  | { kind: 'platform'; path: '/platform' }
  | { kind: 'organization'; path: '/app/dashboard'; organizationId: string }
  | { kind: 'select'; path: '/select-organization' }
  | { kind: 'no_access'; path: '/no-access'; reason: 'no_membership' | 'inactive_membership' | 'organization_suspended' };

export function resolveHome(access: AccessContext | null, opts: { storedOrgId?: string | null; preferStored?: boolean } = {}): HomeDecision {
  if (!access) return { kind: 'login', path: '/login' };
  if (access.is_platform_super_admin) return { kind: 'platform', path: '/platform' };
  const active = access.memberships.filter((m) => m.active);
  if (active.length === 1) return { kind: 'organization', path: '/app/dashboard', organizationId: active[0].organization.id };
  if (active.length > 1) {
    if (opts.preferStored && opts.storedOrgId && active.some((m) => m.organization.id === opts.storedOrgId)) {
      return { kind: 'organization', path: '/app/dashboard', organizationId: opts.storedOrgId };
    }
    return { kind: 'select', path: '/select-organization' };
  }
  if (access.memberships.some((m) => m.organization.status !== 'active')) return { kind: 'no_access', path: '/no-access', reason: 'organization_suspended' };
  if (access.memberships.length > 0) return { kind: 'no_access', path: '/no-access', reason: 'inactive_membership' };
  return { kind: 'no_access', path: '/no-access', reason: 'no_membership' };
}

export const ORG_STORAGE_KEY = 'tanmia.organization';
export function readStoredOrg(): string | null { try { return localStorage.getItem(ORG_STORAGE_KEY); } catch { return null; } }
export function writeStoredOrg(id: string | null): void {
  try { if (id) localStorage.setItem(ORG_STORAGE_KEY, id); else localStorage.removeItem(ORG_STORAGE_KEY); } catch { /* ignore */ }
}

/** Only allow same-origin relative redirects after login (prevents open redirects). */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/login')) return null;
  return next;
}
