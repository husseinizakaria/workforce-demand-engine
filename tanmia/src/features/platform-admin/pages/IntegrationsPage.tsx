import { useEffect, useState, type ReactNode } from 'react';
import { Bot, CalendarDays, Clock, Mail, MessageCircle, MessageSquare, Plus, RefreshCw, Save, ServerCog, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { AsyncView, Badge, Button, Card, CardBody, CardHeader, Checkbox, Input, Notice, PageHeader, useConfirm } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { useAction } from '@/hooks/useAction';
import * as db from '@/services/db';
import { callFunction } from '@/services/functions';
import { errorOf } from '@/services/errors';
import { isConfigured } from '@/lib/supabase';
import type { IntegrationSetting } from '@/types/db';
import { CodeBlock, ProbeBadge, isUnavailable, type ProbeState } from '../components/common';

type Provider = IntegrationSetting['provider'];
const PROVIDERS: Provider[] = ['email', 'sms', 'whatsapp', 'calendar_ics', 'ai'];
const SECRET_KEY = /(key|secret|token|password|passwd|sid|auth|credential|bearer)/i;

const SECRETS: Record<Provider, { name: string; required: boolean; ar: string; en: string }[]> = {
  email: [
    { name: 'RESEND_API_KEY', required: true, ar: 'مفتاح Resend لإرسال البريد', en: 'Resend API key for sending email' },
    { name: 'EMAIL_FROM', required: true, ar: 'عنوان المرسل الموثّق، مثل noreply@example.sa', en: 'Verified sender address, e.g. noreply@example.sa' },
  ],
  sms: [
    { name: 'TWILIO_ACCOUNT_SID', required: true, ar: 'معرّف حساب Twilio', en: 'Twilio account SID' },
    { name: 'TWILIO_AUTH_TOKEN', required: true, ar: 'رمز مصادقة Twilio', en: 'Twilio auth token' },
    { name: 'TWILIO_SMS_FROM', required: true, ar: 'رقم أو اسم المرسل للرسائل النصية', en: 'SMS sender number / ID' },
  ],
  whatsapp: [
    { name: 'TWILIO_ACCOUNT_SID', required: true, ar: 'معرّف حساب Twilio', en: 'Twilio account SID' },
    { name: 'TWILIO_AUTH_TOKEN', required: true, ar: 'رمز مصادقة Twilio', en: 'Twilio auth token' },
    { name: 'TWILIO_WHATSAPP_FROM', required: true, ar: 'رقم واتساب المعتمد، مثل whatsapp:+9665…', en: 'Approved WhatsApp sender, e.g. whatsapp:+9665…' },
  ],
  calendar_ics: [],
  ai: [
    { name: 'ANTHROPIC_API_KEY', required: true, ar: 'مفتاح نموذج اللغة (اختياري للمنصة)', en: 'LLM API key (optional for the platform)' },
    { name: 'AI_MODEL', required: false, ar: 'اسم النموذج (الافتراضي claude-opus-5-5)', en: 'Model name (default claude-opus-5-5)' },
  ],
};

const SUGGESTED: Record<Provider, { key: string; ar: string; en: string }[]> = {
  email: [{ key: 'from_name', ar: 'اسم المرسل الظاهر', en: 'Display sender name' }, { key: 'reply_to', ar: 'عنوان الرد', en: 'Reply-to address' }],
  sms: [{ key: 'sender_label', ar: 'وسم المرسل', en: 'Sender label' }],
  whatsapp: [{ key: 'sender_label', ar: 'وسم المرسل', en: 'Sender label' }],
  calendar_ics: [{ key: 'calendar_name', ar: 'اسم التقويم في التطبيقات', en: 'Calendar name shown in apps' }],
  ai: [{ key: 'narrative_note', ar: 'ملاحظة سياسة البيانات', en: 'Data policy note' }],
};

interface Probes { email: ProbeState; sms: ProbeState; whatsapp: ProbeState; ai: ProbeState; model: string | null; dispatchErr?: string; aiErr?: string }

export default function IntegrationsPage() {
  const { tr, enumLabel } = useI18n();
  const [probes, setProbes] = useState<Probes>({ email: 'loading', sms: 'loading', whatsapp: 'loading', ai: 'loading', model: null });
  const rows = useAsync(() => db.all<IntegrationSetting>('integration_settings', { filters: [['organization_id', 'is', null]], order: { column: 'provider', ascending: true } }), []);

  const probe = async () => {
    setProbes({ email: 'loading', sms: 'loading', whatsapp: 'loading', ai: 'loading', model: null });
    const [d, a] = await Promise.allSettled([
      callFunction<{ email: boolean; sms: boolean; whatsapp: boolean }>('dispatch-notification', { action: 'status' }),
      callFunction<{ llm: boolean; model: string | null }>('ai-program-analysis', { mode: 'status' }),
    ]);
    const fail = (e: unknown): ProbeState => (isUnavailable(e) ? 'unavailable' : 'error');
    setProbes({
      email: d.status === 'fulfilled' ? (d.value.email ? 'configured' : 'not_configured') : fail(d.reason),
      sms: d.status === 'fulfilled' ? (d.value.sms ? 'configured' : 'not_configured') : fail(d.reason),
      whatsapp: d.status === 'fulfilled' ? (d.value.whatsapp ? 'configured' : 'not_configured') : fail(d.reason),
      ai: a.status === 'fulfilled' ? (a.value.llm ? 'configured' : 'not_configured') : fail(a.reason),
      model: a.status === 'fulfilled' ? a.value.model : null,
      dispatchErr: d.status === 'rejected' ? errorOf(d.reason).code : undefined,
      aiErr: a.status === 'rejected' ? errorOf(a.reason).code : undefined,
    });
  };
  useEffect(() => { void probe(); }, []);

  const server = (p: Provider): ProbeState => (p === 'calendar_ics' ? 'configured' : probes[p]);
  const icon: Record<Provider, ReactNode> = { email: <Mail />, sms: <MessageSquare />, whatsapp: <MessageCircle />, calendar_ics: <CalendarDays />, ai: <Bot /> };
  const fnUrl = (name: string) => `${(import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '') ?? 'https://<project-ref>.supabase.co'}/functions/v1/${name}`;

  return (
    <div className="stack">
      <PageHeader title={tr('التكاملات', 'Integrations')} crumbs={[{ label: tr('إدارة المنصة', 'Platform'), to: '/platform' }, { label: tr('التكاملات', 'Integrations') }]}
        subtitle={tr('حالة مزودي الخدمة على الخادم والإعدادات غير السرية. الأسرار تُضبط في بيئة الدوال الخلفية فقط ولا تُدخل في الواجهة إطلاقًا.', 'Server-side provider status and non-secret settings. Secrets are set only in the Edge Function environment and are never entered in the UI.')}
        actions={<Button icon={<RefreshCw />} onClick={() => void probe()}>{tr('إعادة الفحص', 'Re-check')}</Button>} />

      {!isConfigured && <Notice tone="danger">{tr('الواجهة غير مهيأة بمتغيرات Supabase.', 'The frontend is not configured with Supabase variables.')}</Notice>}
      {(probes.dispatchErr || probes.aiErr) && (
        <Notice tone="warning">{tr('تعذر فحص بعض الدوال. إن كانت «غير منشورة» فانشرها بالأمر: ', 'Some functions could not be checked. If “not deployed”, deploy them with: ')}<code>npx supabase functions deploy</code></Notice>
      )}

      <AsyncView state={rows}>
        {(list) => (
          <div className="grid g2">
            {PROVIDERS.map((p) => (
              <ProviderCard key={p} provider={p} icon={icon[p]} row={list.find((r) => r.provider === p) ?? null} server={server(p)}
                model={p === 'ai' ? probes.model : null} title={enumLabel('provider', p)} onSaved={() => void rows.reload()} />
            ))}
            <Card>
              <CardHeader icon={<ServerCog />} title={tr('أسرار البيئة الأساسية', 'Core environment secrets')} />
              <CardBody>
                <ul className="list-plain small">
                  <li><code>APP_URL</code> — {tr('عنوان التطبيق المنشور (لروابط الدعوات وإعادة التعيين)', 'Deployed app URL (for invitation and reset links)')}</li>
                  <li><code>CRON_SECRET</code> — {tr('سر طويل عشوائي تستخدمه المهام المجدولة في الترويسة x-cron-secret', 'Long random secret used by scheduled jobs in the x-cron-secret header')}</li>
                  <li><code>SUPABASE_URL</code> · <code>SUPABASE_ANON_KEY</code> · <code>SUPABASE_SERVICE_ROLE_KEY</code> — {tr('توفرها Supabase تلقائيًا للدوال', 'Provided automatically by Supabase to functions')}</li>
                </ul>
                <CodeBlock>{'npx supabase secrets set APP_URL=https://app.example.sa CRON_SECRET=$(openssl rand -hex 32)'}</CodeBlock>
                <p className="tiny muted" style={{ marginTop: 6 }}>{tr('لا تضع مفتاح service-role في متغيرات الواجهة أبدًا؛ التطبيق يرفض العمل إن وُجد.', 'Never put the service-role key in frontend variables; the app refuses to start if it finds one.')}</p>
              </CardBody>
            </Card>
          </div>
        )}
      </AsyncView>

      <div className="grid g2">
        <Card>
          <CardHeader icon={<CalendarDays />} title={tr('موجز التقويم (ICS)', 'Calendar feed (ICS)')} />
          <CardBody>
            <div className="stack-sm small">
              <p>{tr('يستطيع كل عضو إنشاء رابط اشتراك تقويم (جلساته أو جلسات برنامج/خبير) من صفحة التشغيل عبر الدالة calendar-sync. الرابط يحوي رمزًا مُجزّأ في قاعدة البيانات ويمكن إلغاؤه.', 'Each member can create a calendar subscription link (their sessions, or a program/expert) from Operations via the calendar-sync function. The link carries a token stored hashed and can be revoked.')}</p>
              <p>{tr('يُضاف الرابط في Google Calendar (من رابط) أو Outlook (اشتراك من الويب) أو Apple Calendar. التحديث يتم حسب جدول التطبيق (عادةً كل بضع ساعات).', 'Add the link in Google Calendar (From URL), Outlook (Subscribe from web) or Apple Calendar. Refresh follows the client’s schedule (typically every few hours).')}</p>
              <CodeBlock>{`GET ${fnUrl('calendar-sync')}?feed=<token>`}</CodeBlock>
              <p className="tiny muted">{tr('لا يتطلب أسرارًا إضافية؛ يكفي نشر الدالة calendar-sync وضبط APP_URL.', 'Needs no extra secrets; deploying calendar-sync and setting APP_URL is enough.')}</p>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<Clock />} title={tr('المهام المجدولة (Cron)', 'Scheduled jobs (cron)')} />
          <CardBody>
            <div className="stack-sm small">
              <p>{tr('تحتاج دالتان إلى استدعاء دوري بترويسة x-cron-secret. فعّل الامتدادين pg_cron و pg_net ثم نفّذ في محرر SQL:', 'Two functions need periodic calls with the x-cron-secret header. Enable the pg_cron and pg_net extensions, then run in the SQL editor:')}</p>
              <b>{tr('إرسال الإشعارات كل 5 دقائق', 'Dispatch notifications every 5 minutes')}</b>
              <CodeBlock>{`select cron.schedule('tanmia-dispatch', '*/5 * * * *', $$
  select net.http_post(
    url := '${fnUrl('dispatch-notification')}',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
    body := '{"limit":200}'::jsonb);
$$);`}</CodeBlock>
              <b>{tr('فحص صحة البرامج يوميًا (05:00 بتوقيت الرياض = 02:00 UTC)', 'Daily program health check (05:00 Riyadh = 02:00 UTC)')}</b>
              <CodeBlock>{`select cron.schedule('tanmia-health', '0 2 * * *', $$
  select net.http_post(
    url := '${fnUrl('program-health-check')}',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
    body := '{}'::jsonb);
$$);`}</CodeBlock>
              <p className="tiny muted">{tr('بديل خارجي: أي مجدول (مثل cron على خادم) يرسل POST بنفس الترويسة. لا تضع CRON_SECRET في الواجهة.', 'External alternative: any scheduler (e.g. server cron) sending a POST with the same header. Never put CRON_SECRET in the frontend.')}</p>
              <CodeBlock>{`curl -X POST '${fnUrl('dispatch-notification')}' -H 'x-cron-secret: <CRON_SECRET>' -H 'Content-Type: application/json' -d '{}'`}</CodeBlock>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function ProviderCard({ provider, icon, row, server, model, title, onSaved }: {
  provider: Provider; icon: ReactNode; row: IntegrationSetting | null; server: ProbeState; model: string | null; title: string; onSaved: () => void;
}) {
  const { tr } = useI18n();
  const confirm = useConfirm();
  const toPairs = (r: IntegrationSetting | null) => Object.entries(r?.config ?? {}).map(([k, v]) => ({ k, v: typeof v === 'string' ? v : JSON.stringify(v) }));
  const [enabled, setEnabled] = useState(row?.enabled ?? false);
  const [pairs, setPairs] = useState(toPairs(row));
  useEffect(() => { setEnabled(row?.enabled ?? false); setPairs(toPairs(row)); }, [row]);

  const badKeys = pairs.filter((p) => SECRET_KEY.test(p.k));
  const dupKeys = pairs.filter((p, i) => p.k && pairs.findIndex((x) => x.k === p.k) !== i);
  const dirty = enabled !== (row?.enabled ?? false) || JSON.stringify(pairs) !== JSON.stringify(toPairs(row));

  const save = useAction(async () => {
    const config = Object.fromEntries(pairs.filter((p) => p.k.trim()).map((p) => [p.k.trim(), p.v]));
    if (row) await db.update('integration_settings', row.id, { enabled, config });
    else await db.insert('integration_settings', { organization_id: null, provider, enabled, config });
    onSaved();
  }, { success: ['حُفظ الإعداد', 'Setting saved'] });

  const mismatch = enabled && (server === 'not_configured' || server === 'unavailable');
  return (
    <Card>
      <CardHeader icon={icon} title={title} actions={<><span className="tiny muted">{tr('الخادم:', 'Server:')}</span><ProbeBadge state={server} /></>} />
      <CardBody>
        <div className="stack-sm">
          {provider === 'ai' && model && <span className="small muted">{tr('النموذج:', 'Model:')} <code>{model}</code></span>}
          {provider === 'ai' && <p className="tiny muted">{tr('المحرك القائم على القواعد يعمل دائمًا؛ الذكاء الاصطناعي يضيف صياغة سردية فقط. عطّله إذا كانت البيانات لا يجوز أن تغادر المملكة.', 'The rules engine always works; AI only adds narrative wording. Keep it disabled if data may not leave the Kingdom.')}</p>}
          <Checkbox label={tr('مفعّل على مستوى المنصة', 'Enabled platform-wide')} checked={enabled} onChange={async (c) => {
            if (c && provider === 'ai' && !(await confirm({ title: tr('تفعيل الذكاء الاصطناعي', 'Enable AI'), message: tr('سيُرسل ملخص بيانات البرامج إلى مزود النموذج عند طلب التحليل. تأكد من توافق ذلك مع سياسة إقامة البيانات.', 'Program data summaries will be sent to the model provider when analysis is requested. Make sure this complies with your data residency policy.') }))) return;
            setEnabled(c);
          }} />
          {mismatch && <Notice tone="warning">{server === 'unavailable' ? tr('مفعّل لكن الدالة غير منشورة.', 'Enabled but the function is not deployed.') : tr('مفعّل لكن الأسرار غير مضبوطة على الخادم — سيُتخطى الإرسال مع السبب.', 'Enabled but secrets are not set on the server — deliveries will be skipped with a reason.')}</Notice>}

          <span className="small strong">{tr('إعدادات غير سرية', 'Non-secret settings')}</span>
          {pairs.map((p, i) => (
            <div key={i} className="row">
              <Input style={{ width: 150 }} dir="ltr" className="mono" value={p.k} placeholder="key" invalid={SECRET_KEY.test(p.k)} onChange={(e) => setPairs(pairs.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} />
              <Input className="grow" value={p.v} onChange={(e) => setPairs(pairs.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} />
              <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Remove')} onClick={() => setPairs(pairs.filter((_, j) => j !== i))} />
            </div>
          ))}
          <div className="row wrap" style={{ gap: 4 }}>
            {SUGGESTED[provider].filter((s) => !pairs.some((p) => p.k === s.key)).map((s) => (
              <Button key={s.key} size="sm" variant="ghost" icon={<Plus />} title={tr(s.ar, s.en)} onClick={() => setPairs([...pairs, { k: s.key, v: '' }])}><code>{s.key}</code></Button>
            ))}
            <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setPairs([...pairs, { k: '', v: '' }])}>{tr('مفتاح آخر', 'Other key')}</Button>
          </div>
          {badKeys.length > 0 && <Notice tone="danger">{tr('لا تحفظ الأسرار هنا. المفاتيح التي تشبه الأسرار مرفوضة: ', 'Do not store secrets here. Secret-like keys are rejected: ')}{badKeys.map((b) => b.k).join(', ')}</Notice>}
          {dupKeys.length > 0 && <Notice tone="danger">{tr('مفاتيح مكررة', 'Duplicate keys')}</Notice>}

          {SECRETS[provider].length > 0 && (
            <>
              <span className="small strong">{tr('الأسرار المطلوبة على الخادم', 'Secrets required on the server')}</span>
              <ul className="list-plain small">
                {SECRETS[provider].map((s) => <li key={s.name}><code>{s.name}</code>{!s.required && <> <Badge>{tr('اختياري', 'optional')}</Badge></>} — {tr(s.ar, s.en)}</li>)}
              </ul>
              <CodeBlock>{`npx supabase secrets set ${SECRETS[provider].filter((s) => s.required).map((s) => `${s.name}=…`).join(' ')}`}</CodeBlock>
            </>
          )}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button size="sm" variant="primary" icon={<Save />} loading={save.busy} disabled={!dirty || badKeys.length > 0 || dupKeys.length > 0} onClick={() => void save.run()}>{tr('حفظ', 'Save')}</Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
