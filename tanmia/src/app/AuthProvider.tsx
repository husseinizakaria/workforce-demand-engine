import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { isConfigured, supabase } from '@/lib/supabase';
import { rpc } from '@/services/db';
import { type AppError, errorOf } from '@/services/errors';
import type { AccessContext } from '@/types/db';
import { writeStoredOrg } from '@/routes/resolveHome';

export type AuthStatus = 'loading' | 'signed_out' | 'signed_in';
interface AuthState {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  access: AccessContext | null;
  accessError: AppError | null;
  passwordRecovery: boolean;
  refreshAccess: () => Promise<AccessContext | null>;
  signIn: (email: string, password: string) => Promise<AccessContext | null>;
  signOut: () => Promise<void>;
}
const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [access, setAccess] = useState<AccessContext | null>(null);
  const [accessError, setAccessError] = useState<AppError | null>(null);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const lastUser = useRef<string | null>(null);

  const loadAccess = useCallback(async (): Promise<AccessContext | null> => {
    try {
      const a = await rpc<AccessContext>('my_access');
      setAccess(a); setAccessError(null);
      return a;
    } catch (e) {
      setAccess(null); setAccessError(errorOf(e));
      return null;
    }
  }, []);

  useEffect(() => {
    if (!isConfigured) { setStatus('signed_out'); return; }
    let alive = true;
    // 1) Restore an existing session (persisted by supabase-js).
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      if (data.session) {
        lastUser.current = data.session.user.id;
        await loadAccess();
        if (alive) setStatus('signed_in');
      } else setStatus('signed_out');
    });
    // 2) React to sign-in, sign-out, token refresh and password-recovery links.
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      if (event === 'SIGNED_OUT' || !s) {
        lastUser.current = null; setAccess(null); setStatus('signed_out');
        return;
      }
      if (event === 'SIGNED_IN' && s.user.id !== lastUser.current) {
        lastUser.current = s.user.id;
        // Defer: supabase-js forbids awaiting other auth calls inside this callback.
        setTimeout(() => { void loadAccess().then(() => setStatus('signed_in')); }, 0);
      }
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [loadAccess]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw error;
    lastUser.current = data.user.id;
    setSession(data.session);
    const a = await loadAccess();
    setStatus('signed_in');
    void supabase.rpc('touch_last_login');
    return a;
  }, [loadAccess]);

  const signOut = useCallback(async () => {
    writeStoredOrg(null);
    await supabase.auth.signOut();
    setAccess(null); setStatus('signed_out');
  }, []);

  const value = useMemo<AuthState>(() => ({
    status, session, user: session?.user ?? null, access, accessError, passwordRecovery,
    refreshAccess: loadAccess, signIn, signOut,
  }), [status, session, access, accessError, passwordRecovery, loadAccess, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
