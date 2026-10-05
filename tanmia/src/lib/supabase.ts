import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

/** True when the build was produced with the two public Supabase variables. */
export const isConfigured = Boolean(url && anonKey && /^https?:\/\//.test(url));

function jwtRole(key: string): string | null {
  try {
    const part = key.split('.')[1];
    if (!part) return null;
    return (JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string }).role ?? null;
  } catch {
    return null;
  }
}

// The anon/publishable key is public by design; every table is protected by RLS.
// A service-role / secret key must never reach the browser: refuse to start.
export const isServiceKeyMisconfigured = Boolean(anonKey && (anonKey.startsWith('sb_secret_') || jwtRole(anonKey) === 'service_role'));

export const supabase: SupabaseClient = isConfigured && !isServiceKeyMisconfigured
  ? createClient(url!, anonKey!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } })
  : (null as unknown as SupabaseClient);

export const appUrl = (import.meta.env.VITE_PUBLIC_APP_URL?.trim() || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '');
