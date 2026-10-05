// program-health-check (verify_jwt = false at the gateway; validated here)
//   x-cron-secret                 → every active organization (or the one given)
//   JWT + programs.view on the org → that organization (optionally one program)
// Runs the engine's programHealth per program, persists ai_insights (dedupe
// by fingerprint, auto-resolve vanished ones) and notifies organization
// admins in-app about NEW high/critical insights.
import { serve, readJson, fail } from '../_shared/http.ts';
import { type Db, adminClient, getCaller, isCron, requireOrgRow, requirePermission } from '../_shared/auth.ts';
import { object, optional, parse, uuid } from '../_shared/validate.ts';
import { audit } from '../_shared/audit.ts';
import { fetchAll, loadProgramBundle } from '../_shared/bundle.ts';
import { persistInsights } from '../_shared/insights.ts';
import { type QueueRow, enqueue, orgAdminUserIds } from '../_shared/notifications.ts';
import { programHealth } from '../_shared/engine/index.ts';

const Body = object({ organization_id: optional(uuid()), program_id: optional(uuid()) });
const CHECKED_STATUSES = ['draft', 'planning', 'active', 'on_hold'];

interface ProgramResult { organization_id: string; program_id: string; score: number; grade: string; insights_open: number; created: number; resolved: number; notified: number }

async function runProgram(admin: Db, org: string, program: { id: string; name: string }, admins: () => Promise<string[]>): Promise<ProgramResult> {
  const bundle = await loadProgramBundle(admin, org, program.id);
  const health = programHealth(bundle);
  const r = await persistInsights(admin, org, program.id, health.insights);
  const urgent = r.created.filter((c) => c.severity === 'high' || c.severity === 'critical');
  let notified = 0;
  if (urgent.length) {
    const recipients = await admins();
    const rows: QueueRow[] = [];
    for (const ins of urgent) {
      const source = health.insights.find((i) => i.fingerprint === ins.fingerprint);
      for (const uid of recipients) {
        rows.push({
          organization_id: org, user_id: uid, channel: 'in_app', event_type: 'health_alert',
          title: `${ins.severity === 'critical' ? 'حرج' : 'مرتفع'} — ${program.name}: ${ins.title}`,
          body: source ? `${source.rationale.ar}\n${source.recommended_action.ar}\n\n${source.title.en}: ${source.recommended_action.en}` : null,
          link: `/app/programs/${program.id}${source?.link ? `/${source.link}` : ''}`,
          entity_type: 'ai_insight', entity_id: ins.id, status: 'sent', scheduled_for: new Date().toISOString(), sent_at: new Date().toISOString(),
          dedupe_key: `health:${ins.id}:${uid}:in_app:health_alert`,
        });
      }
    }
    notified = await enqueue(admin, rows);
  }
  return { organization_id: org, program_id: program.id, score: health.score, grade: health.grade, insights_open: r.open, created: r.created.length, resolved: r.resolved, notified };
}

serve(async (req) => {
  const b = parse(Body, await readJson(req));
  const cron = await isCron(req);
  let actor: string | null = null;
  if (!cron) {
    const caller = await getCaller(req);
    if (!b.organization_id) fail('invalid_input', { field: 'organization_id', detail: { field: 'organization_id', reason: 'required without cron secret' } });
    await requirePermission(caller, b.organization_id, 'programs.view');
    actor = caller.userId;
  }
  if (b.program_id && !b.organization_id) fail('invalid_input', { field: 'organization_id', detail: { field: 'organization_id', reason: 'required with program_id' } });
  const admin = adminClient();

  const orgs = b.organization_id
    ? [b.organization_id]
    : (await fetchAll<{ id: string }>(admin, 'organizations', [['status', 'eq', 'active']], { columns: 'id' })).map((o) => o.id);

  const programs: ProgramResult[] = [];
  const errors: { organization_id: string; program_id: string; error: string }[] = [];
  for (const org of orgs) {
    let targets: { id: string; name: string }[];
    if (b.program_id) {
      targets = [await requireOrgRow<{ id: string; name: string }>(admin, 'programs', b.program_id, org, 'id, name')];
    } else {
      targets = await fetchAll<{ id: string; name: string }>(admin, 'programs', [['organization_id', 'eq', org], ['status', 'in', CHECKED_STATUSES]], { columns: 'id, name' });
    }
    let adminIds: string[] | null = null;
    const admins = async () => (adminIds ??= await orgAdminUserIds(admin, org));
    for (const p of targets) {
      try {
        programs.push(await runProgram(admin, org, p, admins));
      } catch (e) {
        // One failing program must not stop a cron sweep.
        if (!cron || b.program_id) throw e;
        console.error('[program-health-check] program failed', org, p.id, e instanceof Error ? e.message : e);
        errors.push({ organization_id: org, program_id: p.id, error: e instanceof Error ? e.message.slice(0, 200) : 'error' });
      }
    }
  }

  if (!cron && b.organization_id) {
    await audit(admin, { organization_id: b.organization_id, actor_user_id: actor, action: 'health_check_run', entity_type: 'programs', entity_id: b.program_id ?? null,
      summary: `${programs.length} program(s)`, new_data: { created: programs.reduce((a, p) => a + p.created, 0), resolved: programs.reduce((a, p) => a + p.resolved, 0) } });
  }
  return { programs, ...(errors.length ? { errors } : {}) };
});

