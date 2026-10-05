// schedule-notification — notifications.create or operations.edit on the org.
// Applies the organization's active notification_rules for an event and
// queues one notification per (rule, recipient, channel), de-duplicated by
// dedupe_key = rule:entity:recipient:channel:event.
import { serve, readJson, check } from '../_shared/http.ts';
import { appUrl, getCaller, requireOrgRow, requirePermission } from '../_shared/auth.ts';
import { enumOf, jsonObject, object, optional, parse, uuid } from '../_shared/validate.ts';
import { audit } from '../_shared/audit.ts';
import { fetchAll, fetchIn } from '../_shared/bundle.ts';
import { type QueueRow, enqueue, orgAdminUserIds, profilesOf } from '../_shared/notifications.ts';
import type { Db } from '../_shared/auth.ts';

const EVENT_TYPES = ['session_scheduled', 'session_reminder', 'session_cancelled', 'session_rescheduled', 'assessment_due', 'evidence_rejected',
  'evidence_verified', 'approval_requested', 'approval_decided', 'stage_blocked', 'action_due', 'invitation_sent', 'report_ready', 'health_alert'] as const;
type EventType = typeof EVENT_TYPES[number];

const ENTITY_TABLES = {
  session: 'sessions', evidence: 'evidence', approval: 'approval_requests', approval_request: 'approval_requests', report: 'reports',
  action: 'program_actions', program_action: 'program_actions', program_stage: 'program_stages', stage: 'program_stages', program: 'programs',
  assessment_result: 'assessment_results', invitation: 'user_invitations', ai_insight: 'ai_insights',
} as const;
type EntityType = keyof typeof ENTITY_TABLES;

const Body = object({
  organization_id: uuid(),
  event_type: enumOf(EVENT_TYPES),
  entity_type: enumOf(Object.keys(ENTITY_TABLES) as unknown as readonly EntityType[]),
  entity_id: uuid(),
  payload: optional(jsonObject(16 * 1024)),
});

interface Rule {
  id: string; event_type: string; audience: string; channels: string[]; offset_minutes: number; conditions: Record<string, unknown>;
  subject_template: string | null; body_template: string | null;
}
interface Recipient { key: string; user_id: string | null; email: string | null; phone: string | null; name: string | null }

const DEFAULT_TITLES: Record<EventType, [string, string]> = {
  session_scheduled: ['تمت جدولة جلسة: {{title}}', 'Session scheduled: {{title}}'],
  session_reminder: ['تذكير بجلسة: {{title}} — {{starts_at}}', 'Reminder: {{title}} — {{starts_at}}'],
  session_cancelled: ['أُلغيت الجلسة: {{title}}', 'Session cancelled: {{title}}'],
  session_rescheduled: ['تم تغيير موعد الجلسة: {{title}} — {{starts_at}}', 'Session rescheduled: {{title}} — {{starts_at}}'],
  assessment_due: ['تقييم مستحق: {{title}}', 'Assessment due: {{title}}'],
  evidence_rejected: ['رُفض دليل: {{title}}', 'Evidence rejected: {{title}}'],
  evidence_verified: ['تم التحقق من دليل: {{title}}', 'Evidence verified: {{title}}'],
  approval_requested: ['طلب اعتماد: {{title}}', 'Approval requested: {{title}}'],
  approval_decided: ['تم البت في طلب الاعتماد: {{title}}', 'Approval decided: {{title}}'],
  stage_blocked: ['مرحلة متوقفة: {{title}}', 'Stage blocked: {{title}}'],
  action_due: ['إجراء مستحق: {{title}}', 'Action due: {{title}}'],
  invitation_sent: ['دعوة جديدة', 'New invitation'],
  report_ready: ['التقرير جاهز: {{title}}', 'Report ready: {{title}}'],
  health_alert: ['تنبيه صحة البرنامج: {{title}}', 'Program health alert: {{title}}'],
};

function render(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k: string) => vars[k] ?? '');
}

function riyadh(iso: string): string {
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

async function usersAsRecipients(admin: Db, org: string, userIds: (string | null | undefined)[]): Promise<Recipient[]> {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return [];
  // Only active members of this organization receive notifications.
  const members = await fetchIn<{ user_id: string }>(admin, 'organization_members', 'user_id', ids, [['organization_id', 'eq', org], ['active', 'eq', true]],
    { columns: 'user_id', key: ['user_id'] });
  const active = new Set(members.map((m) => m.user_id));
  const profiles = await profilesOf(admin, ids.filter((id) => active.has(id)));
  return ids.filter((id) => active.has(id)).map((id) => {
    const p = profiles.get(id);
    return { key: `u:${id}`, user_id: id, email: p?.email ?? null, phone: p?.phone ?? null, name: p?.full_name ?? null };
  });
}

serve(async (req) => {
  const caller = await getCaller(req);
  const b = parse(Body, await readJson(req));
  await requirePermission(caller, b.organization_id, ['notifications.create', 'operations.edit']);
  const admin = caller.admin;
  const org = b.organization_id;
  const table = ENTITY_TABLES[b.entity_type];
  // deno-lint-ignore no-explicit-any
  const entity = await requireOrgRow<Record<string, any>>(admin, table, b.entity_id, org);

  const rules = check(await admin.from('notification_rules').select('*').eq('organization_id', org).eq('event_type', b.event_type).eq('status', 'active'),
    'notification_rules') as Rule[];

  // A cancelled / rescheduled session invalidates reminders queued for the old time.
  let cancelledReminders = 0;
  if (table === 'sessions' && (b.event_type === 'session_cancelled' || b.event_type === 'session_rescheduled')) {
    const res = check(await admin.from('notifications').update({ status: 'cancelled', dedupe_key: null })
      .eq('organization_id', org).eq('entity_id', b.entity_id).eq('event_type', 'session_reminder').in('status', ['queued', 'scheduled']).select('id'),
      'notifications') as { id: string }[];
    cancelledReminders = res.length;
  }
  if (!rules.length) return { created: 0, skipped: 0, rules: 0, cancelled_reminders: cancelledReminders };

  // ---- context ---------------------------------------------------------------
  const programId: string | null = table === 'programs' ? entity.id : (entity.program_id ?? null);
  const program = programId
    ? check(await admin.from('programs').select('id, name, manager_user_id').eq('id', programId).eq('organization_id', org).maybeSingle(), 'programs') as
      { id: string; name: string; manager_user_id: string | null } | null
    : null;

  const title = String(entity.title ?? entity.name ?? entity.code ?? b.payload?.title ?? '');
  const vars: Record<string, string> = {
    title, code: String(entity.code ?? ''), program: program?.name ?? '', location: String(entity.location ?? ''),
    starts_at: entity.starts_at ? riyadh(entity.starts_at) : '', meeting_url: String(entity.meeting_url ?? ''),
    ...Object.fromEntries(Object.entries(b.payload ?? {}).filter(([, v]) => typeof v === 'string' || typeof v === 'number').map(([k, v]) => [k, String(v)])),
  };

  const linkByTable: Record<string, string> = {
    sessions: '/app/operations', evidence: '/app/evidence', reports: `/app/reports/${entity.id}`, approval_requests: '/app/governance',
    program_actions: programId ? `/app/programs/${programId}` : '/app/dashboard', program_stages: programId ? `/app/programs/${programId}/journey` : '/app/dashboard',
    programs: `/app/programs/${entity.id}`, assessment_results: '/app/assessments', user_invitations: '/app/governance', ai_insights: programId ? `/app/programs/${programId}` : '/app/dashboard',
  };
  const link = linkByTable[table] ?? '/app/dashboard';

  // ---- audiences -------------------------------------------------------------
  const audienceCache = new Map<string, Recipient[]>();
  async function audience(kind: string): Promise<Recipient[]> {
    if (audienceCache.has(kind)) return audienceCache.get(kind)!;
    let out: Recipient[] = [];
    if (kind === 'participants' && table === 'sessions') {
      const parts = await fetchAll<{ beneficiary_id: string; attendance_status: string }>(admin, 'session_participants',
        [['organization_id', 'eq', org], ['session_id', 'eq', entity.id]], { columns: 'id, beneficiary_id, attendance_status' });
      const bens = await fetchIn<{ id: string; user_id: string | null; email: string | null; mobile: string | null; full_name: string }>(admin, 'beneficiaries', 'id',
        parts.map((p) => p.beneficiary_id), [['organization_id', 'eq', org]], { columns: 'id, user_id, email, mobile, full_name' });
      const linked = await usersAsRecipients(admin, org, bens.map((x) => x.user_id));
      const byUser = new Map(linked.map((r) => [r.user_id, r]));
      out = bens.map((x) => {
        const u = x.user_id ? byUser.get(x.user_id) : undefined;
        return { key: `b:${x.id}`, user_id: u?.user_id ?? null, email: x.email?.toLowerCase() ?? u?.email ?? null, phone: x.mobile ?? u?.phone ?? null, name: x.full_name };
      });
    } else if (kind === 'expert' && entity.expert_id) {
      const ex = check(await admin.from('experts').select('id, user_id, email, mobile, full_name').eq('id', entity.expert_id).eq('organization_id', org).maybeSingle(),
        'experts') as { id: string; user_id: string | null; email: string | null; mobile: string | null; full_name: string } | null;
      if (ex) {
        const [u] = await usersAsRecipients(admin, org, [ex.user_id]);
        out = [{ key: `e:${ex.id}`, user_id: u?.user_id ?? null, email: ex.email?.toLowerCase() ?? u?.email ?? null, phone: ex.mobile ?? u?.phone ?? null, name: ex.full_name }];
      }
    } else if (kind === 'program_manager') {
      out = await usersAsRecipients(admin, org, [program?.manager_user_id]);
    } else if (kind === 'org_admins') {
      out = await usersAsRecipients(admin, org, await orgAdminUserIds(admin, org));
    } else if (kind === 'assignee') {
      out = await usersAsRecipients(admin, org, [entity.owner_user_id, entity.approver_user_id, entity.responsible_user_id]);
    } else if (kind === 'requester') {
      out = await usersAsRecipients(admin, org, [entity.requested_by, entity.uploaded_by, entity.created_by, entity.invited_by]);
    }
    audienceCache.set(kind, out);
    return out;
  }

  // ---- build queue rows ------------------------------------------------------
  const now = Date.now();
  const rows: QueueRow[] = [];
  let skipped = 0;
  for (const rule of rules) {
    const baseIso = b.event_type === 'session_reminder' && entity.starts_at ? entity.starts_at as string : new Date(now).toISOString();
    const when = new Date(new Date(baseIso).getTime() + rule.offset_minutes * 60_000);
    if (b.event_type === 'session_reminder' && entity.starts_at && new Date(entity.starts_at).getTime() <= now) { skipped++; continue; }
    if (b.event_type === 'session_reminder' && entity.status === 'cancelled') { skipped++; continue; }
    const [arT, enT] = DEFAULT_TITLES[b.event_type];
    const subject = render(rule.subject_template ?? arT, vars).slice(0, 300);
    const bodyText = rule.body_template
      ? render(rule.body_template, vars)
      : [render(arT, vars), render(enT, vars), vars.program ? `${vars.program}` : '', vars.location ? `الموقع / Location: ${vars.location}` : '', `${appUrl()}${link}`]
        .filter(Boolean).join('\n');
    for (const r of await audience(rule.audience)) {
      for (const channel of rule.channels as QueueRow['channel'][]) {
        const reachable = channel === 'in_app' ? !!r.user_id : channel === 'email' || channel === 'calendar' ? !!r.email : !!r.phone;
        if (!reachable) { skipped++; continue; }
        if (channel === 'calendar' && table !== 'sessions') { skipped++; continue; }
        rows.push({
          organization_id: org, user_id: r.user_id, recipient_email: r.email, recipient_phone: r.phone, channel, event_type: b.event_type,
          title: subject, body: bodyText, link, entity_type: b.entity_type, entity_id: b.entity_id, rule_id: rule.id,
          status: when.getTime() > now ? 'scheduled' : 'queued', scheduled_for: when.toISOString(),
          dedupe_key: `${rule.id}:${b.entity_id}:${r.key}:${channel}:${b.event_type}`,
        });
      }
    }
  }
  const created = await enqueue(admin, rows);
  skipped += rows.length - created;

  await audit(admin, {
    organization_id: org, actor_user_id: caller.userId, action: 'notifications_scheduled', entity_type: table, entity_id: b.entity_id,
    summary: b.event_type, new_data: { created, skipped, rules: rules.length, cancelled_reminders: cancelledReminders },
  });
  return { created, skipped, rules: rules.length, cancelled_reminders: cancelledReminders };
});

