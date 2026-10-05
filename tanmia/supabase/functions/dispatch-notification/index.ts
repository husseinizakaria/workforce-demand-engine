// dispatch-notification (verify_jwt = false at the gateway; validated here)
//   x-cron-secret                → all organizations (optionally one)
//   JWT + notifications.configure → one organization
//   {action:'status'}             → provider configuration booleans (any signed-in user or cron)
// Delivers due notifications: in_app → sent; email → Resend; sms/whatsapp →
// Twilio; calendar → email with an .ics attachment. Unconfigured → skipped.
import { serve, readJson, fail, check } from '../_shared/http.ts';
import { adminClient, getCaller, isCron, requirePermission } from '../_shared/auth.ts';
import { enumOf, int, object, optional, parse, uuid, withDefault } from '../_shared/validate.ts';
import { type DeliveryResult, providerStatus, sendEmail, sendSms, sendWhatsApp } from '../_shared/notify.ts';
import { buildCalendar, sessionToEvent } from '../_shared/ics.ts';
import { profilesOf } from '../_shared/notifications.ts';
import { audit } from '../_shared/audit.ts';

const Body = object({
  action: withDefault(enumOf(['dispatch', 'status'] as const), 'dispatch'),
  organization_id: optional(uuid()),
  limit: withDefault(int({ min: 1, max: 500 }), 100),
});

const MAX_ATTEMPTS = 3;

interface Row {
  id: string; organization_id: string; user_id: string | null; recipient_email: string | null; recipient_phone: string | null; channel: string;
  event_type: string; title: string; body: string | null; link: string | null; entity_type: string | null; entity_id: string | null; status: string; attempts: number;
}

serve(async (req) => {
  const raw = await readJson(req);
  const b = parse(Body, raw);
  const cron = await isCron(req);
  let actor: string | null = null;

  if (b.action === 'status') {
    if (!cron) await getCaller(req);
    return providerStatus();
  }
  if (!cron) {
    const caller = await getCaller(req);
    if (!b.organization_id) fail('invalid_input', { field: 'organization_id', detail: { field: 'organization_id', reason: 'required without cron secret' } });
    await requirePermission(caller, b.organization_id, 'notifications.configure');
    actor = caller.userId;
  }
  const admin = adminClient();

  let q = admin.from('notifications').select('id, organization_id, user_id, recipient_email, recipient_phone, channel, event_type, title, body, link, entity_type, entity_id, status, attempts')
    .in('status', ['queued', 'scheduled']).lte('scheduled_for', new Date().toISOString()).order('scheduled_for', { ascending: true }).limit(b.limit);
  if (b.organization_id) q = q.eq('organization_id', b.organization_id);
  const due = check(await q, 'notifications') as Row[];

  const needProfiles = due.filter((n) => n.user_id && ((['email', 'calendar'].includes(n.channel) && !n.recipient_email) || (['sms', 'whatsapp'].includes(n.channel) && !n.recipient_phone)));
  const profiles = await profilesOf(admin, [...new Set(needProfiles.map((n) => n.user_id!))]);
  const sessionCache = new Map<string, string | null>();
  const appDomain = (Deno.env.get('APP_URL') ?? 'tanmia.app').replace(/^https?:\/\//, '').replace(/\/.*$/, '') || 'tanmia.app';

  async function sessionIcs(n: Row): Promise<string | null> {
    if (n.entity_type !== 'session' || !n.entity_id) return null;
    const key = `${n.organization_id}:${n.entity_id}`;
    if (sessionCache.has(key)) return sessionCache.get(key)!;
    const s = check(await admin.from('sessions').select('id, code, title, starts_at, ends_at, status, location, meeting_url, agenda, session_type, delivery_mode, updated_at')
      .eq('id', n.entity_id).eq('organization_id', n.organization_id).maybeSingle(), 'sessions');
    const ics = s ? buildCalendar({ name: s.title, events: [sessionToEvent(s, appDomain)] }) : null;
    sessionCache.set(key, ics);
    return ics;
  }

  let sent = 0, failed = 0, skipped = 0, processed = 0;
  for (const n of due) {
    // Optimistic claim: only one dispatcher may bump attempts from this value.
    const claim = check(await admin.from('notifications').update({ attempts: n.attempts + 1 })
      .eq('id', n.id).eq('attempts', n.attempts).in('status', ['queued', 'scheduled']).select('id'), 'notifications') as { id: string }[];
    if (!claim.length) continue;
    processed++;

    const prof = n.user_id ? profiles.get(n.user_id) : undefined;
    const email = n.recipient_email ?? prof?.email ?? null;
    const phone = n.recipient_phone ?? prof?.phone ?? null;
    const text = [n.title, n.body ?? ''].filter(Boolean).join('\n\n');
    let r: DeliveryResult;
    try {
      switch (n.channel) {
        case 'in_app':
          r = n.user_id ? { status: 'sent', reason: null, provider: 'in_app' } : { status: 'skipped', reason: 'no_user' };
          break;
        case 'email':
          r = email ? await sendEmail({ to: email, subject: n.title, text: n.body ?? n.title }) : { status: 'skipped', reason: 'no_recipient_email' };
          break;
        case 'calendar': {
          const ics = await sessionIcs(n);
          if (!email) r = { status: 'skipped', reason: 'no_recipient_email' };
          else if (!ics) r = { status: 'skipped', reason: 'no_calendar_entity' };
          else r = await sendEmail({ to: email, subject: n.title, text: n.body ?? n.title, attachments: [{ filename: 'session.ics', content: ics, content_type: 'text/calendar; charset=utf-8; method=PUBLISH' }] });
          break;
        }
        case 'sms':
          r = await sendSms(phone, text);
          break;
        case 'whatsapp':
          r = await sendWhatsApp(phone, text);
          break;
        default:
          r = { status: 'skipped', reason: 'unknown_channel' };
      }
    } catch (e) {
      r = { status: 'failed', reason: e instanceof Error ? e.message : 'error' };
    }

    const attempts = n.attempts + 1;
    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> = { delivery_result: { ...r, at: nowIso, attempt: attempts } };
    if (r.status === 'sent') { patch.status = 'sent'; patch.sent_at = nowIso; sent++; }
    else if (r.status === 'skipped') { patch.status = 'skipped'; skipped++; }
    else if (attempts >= MAX_ATTEMPTS) { patch.status = 'failed'; failed++; }
    else {
      // Retry later with linear back-off.
      patch.status = 'queued';
      patch.scheduled_for = new Date(Date.now() + attempts * 5 * 60_000).toISOString();
      failed++;
    }
    check(await admin.from('notifications').update(patch).eq('id', n.id), 'notifications');
  }

  if (!cron && processed) {
    await audit(admin, { organization_id: b.organization_id ?? null, actor_user_id: actor, action: 'notifications_dispatched', entity_type: 'notifications',
      summary: `processed ${processed}`, new_data: { processed, sent, failed, skipped } });
  }
  return { processed, sent, failed, skipped };
});
