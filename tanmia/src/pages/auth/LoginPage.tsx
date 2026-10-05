import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { LogIn } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useAuth } from '@/app/AuthProvider';
import { Button, Field, Input, Notice } from '@/components/ui';
import { errorOf } from '@/services/errors';
import { readStoredOrg, resolveHome, safeNext, writeStoredOrg } from '@/routes/resolveHome';

export default function LoginPage() {
  const { tr, locale } = useI18n();
  const { signIn, status } = useAuth();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = safeNext(params.get('next'));

  if (status === 'signed_in' && !busy) return <Navigate to={next ?? '/'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const access = await signIn(email, password);
      if (next) { nav(next, { replace: true }); return; }
      // Platform owner → /platform; one org → enter; several → selector; none → no-access.
      const d = resolveHome(access, { storedOrgId: readStoredOrg(), preferStored: false });
      if (d.kind === 'organization') writeStoredOrg(d.organizationId);
      nav(d.kind === 'no_access' ? `${d.path}?reason=${d.reason}` : d.path, { replace: true });
    } catch (err) {
      const ae = errorOf(err);
      setError(locale === 'ar' ? ae.message_ar : ae.message_en);
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="stack">
      {error && <Notice tone="danger">{error}</Notice>}
      <Field label={tr('البريد الإلكتروني', 'Email')} htmlFor="email" required>
        <Input id="email" type="email" dir="ltr" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Field label={tr('كلمة المرور', 'Password')} htmlFor="password" required>
        <Input id="password" type="password" dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      <Button type="submit" variant="primary" icon={<LogIn />} loading={busy}>{tr('تسجيل الدخول', 'Sign in')}</Button>
      <div className="row between small">
        <Link to="/forgot-password">{tr('نسيت كلمة المرور؟', 'Forgot password?')}</Link>
        <span className="muted">{tr('لديك دعوة؟ افتح رابط الدعوة', 'Have an invitation? Open its link')}</span>
      </div>
    </form>
  );
}
