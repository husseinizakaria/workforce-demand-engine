import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Mail } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { Button, Field, Input, Notice } from '@/components/ui';
import { appUrl, supabase } from '@/lib/supabase';

export default function ForgotPasswordPage() {
  const { tr } = useI18n();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    // The response is intentionally identical whether or not the account exists.
    await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${appUrl}/reset-password` }).catch(() => undefined);
    setBusy(false); setSent(true);
  };
  return (
    <form onSubmit={submit} className="stack">
      {sent ? <Notice tone="success">{tr('إذا كان البريد مسجلًا فستصلك رسالة تحتوي رابط إعادة التعيين.', 'If the email is registered, you will receive a reset link.')}</Notice> : (
        <>
          <Field label={tr('البريد الإلكتروني', 'Email')} htmlFor="email" required><Input id="email" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Button type="submit" variant="primary" icon={<Mail />} loading={busy}>{tr('إرسال رابط إعادة التعيين', 'Send reset link')}</Button>
        </>
      )}
      <Link to="/login" className="small">{tr('العودة لتسجيل الدخول', 'Back to sign in')}</Link>
    </form>
  );
}
