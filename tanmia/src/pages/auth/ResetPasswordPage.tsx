import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { KeyRound } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useAuth } from '@/app/AuthProvider';
import { Button, Field, Input, Notice } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { errorOf } from '@/services/errors';

export default function ResetPasswordPage() {
  const { tr, locale } = useI18n();
  const { session, status } = useAuth();
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const weak = pw.length > 0 && (pw.length < 10 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw));

  if (status !== 'loading' && !session) {
    return <div className="stack"><Notice tone="warning">{tr('رابط إعادة التعيين غير صالح أو منتهي. اطلب رابطًا جديدًا.', 'The reset link is invalid or expired. Request a new one.')}</Notice><Link to="/forgot-password">{tr('طلب رابط جديد', 'Request a new link')}</Link></div>;
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (weak) return;
    if (pw !== pw2) { setError(tr('كلمتا المرور غير متطابقتين', 'Passwords do not match')); return; }
    setBusy(true); setError(null);
    const { error: err } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (err) { const ae = errorOf(err); setError(locale === 'ar' ? ae.message_ar : ae.message_en); return; }
    nav('/', { replace: true });
  };
  return (
    <form onSubmit={submit} className="stack">
      {error && <Notice tone="danger">{error}</Notice>}
      <Field label={tr('كلمة المرور الجديدة', 'New password')} htmlFor="pw" required error={weak ? tr('10 أحرف على الأقل وتشمل حروفًا وأرقامًا', 'At least 10 characters including letters and digits') : undefined}>
        <Input id="pw" type="password" dir="ltr" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required invalid={weak} />
      </Field>
      <Field label={tr('تأكيد كلمة المرور', 'Confirm password')} htmlFor="pw2" required>
        <Input id="pw2" type="password" dir="ltr" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
      </Field>
      <Button type="submit" variant="primary" icon={<KeyRound />} loading={busy}>{tr('حفظ كلمة المرور', 'Save password')}</Button>
    </form>
  );
}
