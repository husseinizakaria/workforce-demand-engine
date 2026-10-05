import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '@/app/AuthProvider';
import { Splash } from '@/pages/MiscPages';
import { readStoredOrg, resolveHome, writeStoredOrg } from './resolveHome';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const loc = useLocation();
  if (status === 'loading') return <Splash />;
  if (status === 'signed_out') return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

export function RequireSuperAdmin({ children }: { children: ReactNode }) {
  const { access } = useAuth();
  if (!access) return <Splash />;
  if (!access.is_platform_super_admin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** "/" — restores the session and applies the post-login routing rules. */
export function RootRedirect() {
  const { status, access } = useAuth();
  if (status === 'loading') return <Splash />;
  if (status === 'signed_out') return <Navigate to="/login" replace />;
  const d = resolveHome(access, { storedOrgId: readStoredOrg(), preferStored: true });
  if (d.kind === 'organization') writeStoredOrg(d.organizationId);
  return <Navigate to={d.kind === 'no_access' ? `${d.path}?reason=${d.reason}` : d.path} replace />;
}

/** Signed-in users visiting /login are sent home. */
export function PublicOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <Splash />;
  return <>{children}</>;
}
