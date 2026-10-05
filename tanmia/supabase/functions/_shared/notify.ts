// Outbound delivery providers. Nothing is faked: an unconfigured provider
// returns { status: 'skipped', reason: 'not_configured' }.
//   Email    → Resend REST API          (RESEND_API_KEY, EMAIL_FROM)
//   SMS      → Twilio Messages REST API (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_SMS_FROM)
//   WhatsApp → Twilio Messages REST API (… , TWILIO_WHATSAPP_FROM)
import { env } from './auth.ts';

export type DeliveryStatus = 'sent' | 'failed' | 'skipped';
export interface DeliveryResult { status: DeliveryStatus; reason: string | null; provider?: string; provider_id?: string | null }

const TIMEOUT_MS = 15_000;

export function providerStatus(): { email: boolean; sms: boolean; whatsapp: boolean } {
  const twilio = !!env('TWILIO_ACCOUNT_SID') && !!env('TWILIO_AUTH_TOKEN');
  return {
    email: !!env('RESEND_API_KEY') && !!env('EMAIL_FROM'),
    sms: twilio && !!env('TWILIO_SMS_FROM'),
    whatsapp: twilio && !!env('TWILIO_WHATSAPP_FROM'),
  };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function safeText(res: Response): Promise<string> {
  try { return (await res.text()).slice(0, 300); } catch { return ''; }
}

export interface EmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: string; content_type?: string }[];
}

export async function sendEmail(input: EmailInput): Promise<DeliveryResult> {
  const key = env('RESEND_API_KEY'); const from = env('EMAIL_FROM');
  if (!key || !from) return { status: 'skipped', reason: 'not_configured', provider: 'resend' };
  if (!input.to) return { status: 'skipped', reason: 'no_recipient_email', provider: 'resend' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to: [input.to], subject: input.subject.slice(0, 250), text: input.text,
        html: input.html ?? textToHtml(input.text),
        attachments: input.attachments?.map((a) => ({ filename: a.filename, content: toBase64(a.content), content_type: a.content_type })),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { status: 'failed', reason: `http_${res.status}: ${await safeText(res)}`, provider: 'resend' };
    const body = await res.json().catch(() => ({})) as { id?: string };
    return { status: 'sent', reason: null, provider: 'resend', provider_id: body.id ?? null };
  } catch (e) {
    return { status: 'failed', reason: e instanceof Error ? e.name + ': ' + e.message : 'network_error', provider: 'resend' };
  }
}

async function twilioSend(to: string, from: string, body: string): Promise<DeliveryResult> {
  const sid = env('TWILIO_ACCOUNT_SID'); const token = env('TWILIO_AUTH_TOKEN');
  if (!sid || !token) return { status: 'skipped', reason: 'not_configured', provider: 'twilio' };
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: from, Body: body.slice(0, 1500) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { status: 'failed', reason: `http_${res.status}: ${await safeText(res)}`, provider: 'twilio' };
    const json = await res.json().catch(() => ({})) as { sid?: string };
    return { status: 'sent', reason: null, provider: 'twilio', provider_id: json.sid ?? null };
  } catch (e) {
    return { status: 'failed', reason: e instanceof Error ? e.name + ': ' + e.message : 'network_error', provider: 'twilio' };
  }
}

/** E.164 normalisation with a Saudi default for local numbers (05xxxxxxxx). */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.replace(/[\s\-()]/g, '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (/^05\d{8}$/.test(s)) s = '+966' + s.slice(1);
  if (/^5\d{8}$/.test(s)) s = '+966' + s;
  return /^\+\d{8,15}$/.test(s) ? s : null;
}

export async function sendSms(toRaw: string | null, body: string): Promise<DeliveryResult> {
  const from = env('TWILIO_SMS_FROM');
  if (!from || !env('TWILIO_ACCOUNT_SID') || !env('TWILIO_AUTH_TOKEN')) return { status: 'skipped', reason: 'not_configured', provider: 'twilio' };
  const to = normalizePhone(toRaw);
  if (!to) return { status: 'skipped', reason: 'no_valid_phone', provider: 'twilio' };
  return await twilioSend(to, from, body);
}

export async function sendWhatsApp(toRaw: string | null, body: string): Promise<DeliveryResult> {
  const from = env('TWILIO_WHATSAPP_FROM');
  if (!from || !env('TWILIO_ACCOUNT_SID') || !env('TWILIO_AUTH_TOKEN')) return { status: 'skipped', reason: 'not_configured', provider: 'twilio' };
  const to = normalizePhone(toRaw);
  if (!to) return { status: 'skipped', reason: 'no_valid_phone', provider: 'twilio' };
  return await twilioSend(`whatsapp:${to}`, from.startsWith('whatsapp:') ? from : `whatsapp:${from}`, body);
}

export function textToHtml(text: string): string {
  const body = escapeHtml(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>');
  return `<!doctype html><html><body style="font-family:Tahoma,Arial,sans-serif;line-height:1.7"><div dir="auto">${body}</div></body></html>`;
}

/** Bilingual (Arabic first) invitation / account setup email. */
export function accountEmail(kind: 'invitation' | 'setup' | 'reset', p: { orgName?: string | null; fullName?: string | null; link: string; expiresAt?: string | null }): { subject: string; text: string } {
  const name = p.fullName ? ` ${p.fullName}` : '';
  const org = p.orgName ?? 'TANMIA';
  const subjects = {
    invitation: `دعوة للانضمام إلى ${org} | Invitation to join ${org}`,
    setup: `إعداد حسابك في تنمية | Set up your TANMIA account`,
    reset: `إعادة تعيين كلمة المرور | Reset your password`,
  } as const;
  const ar = {
    invitation: `مرحبًا${name}،\n\nتمت دعوتك للانضمام إلى «${org}» على منصة تنمية. لقبول الدعوة افتح الرابط التالي وسجّل الدخول بنفس البريد الإلكتروني:\n${p.link}`,
    setup: `مرحبًا${name}،\n\nتم إنشاء حساب لك على منصة تنمية${p.orgName ? ` ضمن «${org}»` : ''}. لتعيين كلمة المرور افتح الرابط التالي:\n${p.link}`,
    reset: `مرحبًا${name}،\n\nلإعادة تعيين كلمة المرور افتح الرابط التالي:\n${p.link}`,
  }[kind];
  const en = {
    invitation: `Hello${name},\n\nYou have been invited to join "${org}" on TANMIA. Open the link below and sign in with this email address to accept:\n${p.link}`,
    setup: `Hello${name},\n\nAn account has been created for you on TANMIA${p.orgName ? ` (${org})` : ''}. Open the link below to set your password:\n${p.link}`,
    reset: `Hello${name},\n\nOpen the link below to reset your password:\n${p.link}`,
  }[kind];
  const exp = p.expiresAt ? `\n\nصالح حتى / Valid until: ${p.expiresAt.slice(0, 16).replace('T', ' ')} UTC` : '';
  return { subject: subjects[kind], text: `${ar}\n\n———\n\n${en}${exp}\n\nإذا لم تكن تتوقع هذه الرسالة فتجاهلها. / If you did not expect this email, ignore it.` };
}
