// Invitation acceptance is a separate workflow from login (never replaces it).
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { CheckCircle2, MailCheck, UserPlus } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useAuth } from '@/app/AuthProvider';
import { Badge, Button, Field, Input, Loading, Notice } from '@/components/ui';
import { callFunction } from '@/services/functions';
import { appUrl, supabase } from '@/lib/supabase';
import { errorOf } from '@/services/errors';
import { writeStoredOrg } from '@/routes/resolveHome';

interface Preview { organization: { name: string; name_en: string | null; code: string }; email_masked: string; full_name: string | null; roles: { name_ar: string; name_en: string }[]; expires_at: string; status: string }

export default function AcceptInvitationPage() {
  const { tr, locale, pick, fmtDate } = useI18n();
  const params = useParams();
  const [sp] = useSearchParams();
  const token = params.token ?? sp.get('token') ?? '';
  const { status, user, refreshAccess, signOut } = useAuth();
  const nav = useNavigate();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'choose' | 'signup'>('choose');
  const [form, setForm] = useState({ full_name: '', email: '', password: '' });
  const [signupDone, setSignupDone] = useState(false);
  const msg = (e: unknown) => { const ae = errorOf(e); return locale === 'ar' ? ae.message_ar : ae.message_en; };

  useEffect(() => {
    if (!token) { setError(tr('رابط الدعوة غير مكتمل.', 'The invitation link is incomplete.')); return; }
    callFunction<Preview>('accept-invitation', { action: 'preview', token }).then(setPreview).catch((e) => setError(msg(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const accept = async () => {
    setBusy(true); setError(null);
    try {
      const r = await callFunction<{ organization_id: string }>('accept-invitation', { action: 'accept', token });
      await refreshAccess();
      writeStoredOrg(r.organization_id);
      nav('/app/dashboard', { replace: true });
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  };

  const signup = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    const { data, error: err } = await supabase.auth.signUp({ email: form.email.trim().toLowerCase(), password: form.password,
      options: { data: { full_name: form.full_name }, emailRedirectTo: `${appUrl}/invite/${encodeURIComponent(token)}` } });
    setBusy(false);
    if (err) { setError(msg(err)); return; }
    if (!data.session) setSignupDone(true); // email confirmation required; the link returns here
  };

  if (error && !preview) return <div className="stack"><Notice tone="danger">{error}</Notice><Link to="/login">{tr('الذهاب لتسجيل الدخول', 'Go to sign in')}</Link></div>;
  if (!preview || status === 'loading') return <Loading rows={3} />;

  return (
    <div className="stack">
      <div className="card card-pad tinted stack-sm">
        <span className="small muted">{tr('دعوة للانضمام إلى', 'Invitation to join')}</span>
        <b style={{ fontSize: 16 }}>{pick(preview.organization.name, preview.organization.name_en)}</b>
        <div className="row wrap">{preview.roles.map((r) => <Badge key={r.name_en} tone="primary">{pick(r.name_ar, r.name_en)}</Badge>)}</div>
        <span className="tiny muted">{tr('مرسلة إلى', 'Sent to')} <span className="ltr">{preview.email_masked}</span> · {tr('تنتهي', 'Expires')} {fmtDate(preview.expires_at)}</span>
      </div>
      {preview.status !== 'pending' && <Notice tone="warning">{tr('هذه الدعوة لم تعد صالحة.', 'This invitation is no longer valid.')}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      {preview.status === 'pending' && (status === 'signed_in' ? (
        <div className="stack">
          <p className="small">{tr('أنت مسجل الدخول بالحساب', 'You are signed in as')} <b className="ltr">{user?.email}</b>. {tr('يجب أن يطابق بريد الدعوة.', 'It must match the invited email.')}</p>
          <Button variant="primary" icon={<CheckCircle2 />} loading={busy} onClick={accept}>{tr('قبول الدعوة والانضمام', 'Accept invitation and join')}</Button>
          <Button variant="ghost" onClick={() => void signOut()}>{tr('تسجيل الدخول بحساب آخر', 'Use a different account')}</Button>
        </div>
      ) : signupDone ? (
        <Notice tone="success" icon={<MailCheck />}>{tr('أُرسل رابط تأكيد إلى بريدك. بعد التأكيد ستعود لهذه الصفحة لقبول الدعوة.', 'A confirmation link was sent to your email. After confirming you will return here to accept.')}</Notice>
      ) : mode === 'choose' ? (
        <div className="stack">
          <Link className="btn primary" to={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>{tr('لدي حساب — تسجيل الدخول', 'I have an account — sign in')}</Link>
          <Button icon={<UserPlus />} onClick={() => setMode('signup')}>{tr('إنشاء حساب جديد بالبريد المدعو', 'Create an account with the invited email')}</Button>
        </div>
      ) : (
        <form className="stack" onSubmit={signup}>
          <Field label={tr('الاسم الكامل', 'Full name')} required><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></Field>
          <Field label={tr('البريد الإلكتروني المدعو', 'Invited email')} required><Input type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></Field>
          <Field label={tr('كلمة المرور', 'Password')} required hint={tr('10 أحرف على الأقل', 'At least 10 characters')}><Input type="password" dir="ltr" minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></Field>
          <Button type="submit" variant="primary" loading={busy}>{tr('إنشاء الحساب', 'Create account')}</Button>
        </form>
      ))}
    </div>
  );
}
