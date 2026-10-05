// calendar-sync (verify_jwt = false at the gateway)
//   GET  ?feed=<token>                         → public ICS subscription (token hashed in DB;
//                                                the owner's access is re-checked on every fetch)
//   POST {action:'ics', organization_id, scope, id?}           → {filename, ics}   (JWT)
//   POST {action:'create_feed', organization_id, scope, scope_id?} → {feed_url}    (JWT)
// Scopes: session | program | expert | me (+ organization for feeds).
import { serve, readJson, fail, check, corsHeaders, errResponse, AppError } from '../_shared/http.ts';
import { type Db, adminClient, getCaller, hasPermission, requireEnv, requireMember, requireOrgRow, userPermissions, appUrl } from '../_shared/auth.ts';
import { enumOf, object, optional, parse, uuid } from '../_shared/validate.ts';
import { TOKEN_RE, randomToken, sha256Hex } from '../_shared/crypto.ts';
import { audit } from '../_shared/audit.ts';
import { fetchAll, fetchIn } from '../_shared/bundle.ts';
import { buildCalendar, sessionToEvent } from '../_shared/ics.ts';

type Scope = 'session' | 'program' | 'expert' | 'me' | 'organization';

const Action = object({ action: enumOf(['ics', 'create_feed'] as const) });
const IcsBody = object({ organization_id: uuid(), scope: enumOf(['session', 'program', 'expert', 'me'] as const), id: optional(uuid()) });
const FeedBody = object({ organization_id: uuid(), scope: enumOf(['me', 'expert', 'program', 'organization'] as const), scope_id: optional(uuid()) });

const SESSION_COLS = 'id, code, title, starts_at, ends_at, status, location, meeting_url, agenda, session_type, delivery_mode, updated_at, expert_id, program_id';
interface SessionRow {
  id: string; code: string; title: string; starts_at: string; ends_at: string; status: string; location: string | null; meeting_url: string | null;
  agenda: string | null; session_type: string; delivery_mode: string; updated_at: string | null; expert_id: string | null; program_id: string | null;
}

/** Access predicate shared by the authenticated and the public feed paths. */
interface Access { userId: string; can: (perm: string) => boolean }

async function linkedIds(admin: Db, org: string, userId: string): Promise<{ experts: string[]; beneficiaries: string[] }> {
  const [ex, ben] = await Promise.all([
    check(await admin.from('experts').select('id').eq('organization_id', org).eq('user_id', userId), 'experts') as { id: string }[],
    check(await admin.from('beneficiaries').select('id').eq('organization_id', org).eq('user_id', userId), 'beneficiaries') as { id: string }[],
  ]);
  return { experts: ex.map((x) => x.id), beneficiaries: ben.map((x) => x.id) };
}

async function mySessionIds(admin: Db, org: string, userId: string): Promise<string[]> {
  const mine = await linkedIds(admin, org, userId);
  const ids = new Set<string>();
  if (mine.experts.length) {
    for (const s of await fetchIn<{ id: string }>(admin, 'sessions', 'expert_id', mine.experts, [['organization_id', 'eq', org]], { columns: 'id' })) ids.add(s.id);
  }
  if (mine.beneficiaries.length) {
    for (const p of await fetchIn<{ session_id: string }>(admin, 'session_participants', 'beneficiary_id', mine.beneficiaries, [['organization_id', 'eq', org]],
      { columns: 'id, session_id' })) ids.add(p.session_id);
  }
  return [...ids];
}

/** Authorizes the scope and returns the matching sessions (never drafts). */
async function sessionsFor(admin: Db, org: string, scope: Scope, id: string | undefined, access: Access, window?: { from: string; to: string }): Promise<{ name: string; sessions: SessionRow[] }> {
  const base: [string, 'eq' | 'neq' | 'in' | 'gte' | 'lte', unknown][] = [['organization_id', 'eq', org], ['status', 'neq', 'draft']];
  if (window) base.push(['starts_at', 'gte', window.from], ['starts_at', 'lte', window.to]);
  const opsView = access.can('operations.view');

  if (scope === 'session') {
    if (!id) fail('invalid_input', { field: 'id', detail: { field: 'id', reason: 'required for this scope' } });
    const s = await requireOrgRow<SessionRow>(admin, 'sessions', id, org, SESSION_COLS);
    if (!opsView && !(await mySessionIds(admin, org, access.userId)).includes(s.id)) fail('forbidden');
    if (s.status === 'draft') fail('not_found', { detail: { entity: 'session' } });
    return { name: s.title, sessions: [s] };
  }
  if (scope === 'program') {
    if (!id) fail('invalid_input', { field: 'id', detail: { field: 'id', reason: 'required for this scope' } });
    const p = await requireOrgRow<{ name: string }>(admin, 'programs', id, org, 'id, name');
    if (!opsView) fail('forbidden');
    return { name: p.name, sessions: await fetchAll<SessionRow>(admin, 'sessions', [...base, ['program_id', 'eq', id]], { columns: SESSION_COLS, order: 'starts_at' }) };
  }
  if (scope === 'expert') {
    if (!id) fail('invalid_input', { field: 'id', detail: { field: 'id', reason: 'required for this scope' } });
    const e = await requireOrgRow<{ full_name: string; user_id: string | null }>(admin, 'experts', id, org, 'id, full_name, user_id');
    if (!access.can('experts.view') && e.user_id !== access.userId) fail('forbidden');
    return { name: e.full_name, sessions: await fetchAll<SessionRow>(admin, 'sessions', [...base, ['expert_id', 'eq', id]], { columns: SESSION_COLS, order: 'starts_at' }) };
  }
  if (scope === 'organization') {
    if (!opsView) fail('forbidden');
    const o = check(await admin.from('organizations').select('name').eq('id', org).single(), 'organizations') as { name: string };
    return { name: o.name, sessions: await fetchAll<SessionRow>(admin, 'sessions', base, { columns: SESSION_COLS, order: 'starts_at' }) };
  }
  // me
  const ids = await mySessionIds(admin, org, access.userId);
  const sessions = ids.length ? await fetchIn<SessionRow>(admin, 'sessions', 'id', ids, base, { columns: SESSION_COLS }) : [];
  sessions.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return { name: 'جلساتي / My sessions', sessions };
}

function domain(): string {
  return appUrl().replace(/^https?:\/\//, '').replace(/[/:].*$/, '') || 'tanmia.app';
}

function safeFilename(name: string): string {
  return (name.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'calendar') + '.ics';
}

async function publicFeed(url: URL): Promise<Response> {
  try {
    const token = url.searchParams.get('feed') ?? '';
    if (!TOKEN_RE.test(token)) fail('not_found');
    const admin = adminClient();
    const feed = check(await admin.from('calendar_feed_tokens').select('organization_id, user_id, scope, scope_id, revoked_at')
      .eq('token_hash', await sha256Hex(token)).maybeSingle(), 'calendar_feed_tokens') as
      { organization_id: string; user_id: string; scope: Scope; scope_id: string | null; revoked_at: string | null } | null;
    if (!feed || feed.revoked_at) fail('not_found');
    // Re-check the owner's current access: removed members / revoked roles stop the feed.
    const perms = await userPermissions(admin, feed.organization_id, feed.user_id);
    if (!perms.active) fail('not_found');
    const access: Access = { userId: feed.user_id, can: (p) => perms.superAdmin || perms.codes.has(p) };
    const now = Date.now();
    const window = { from: new Date(now - 90 * 86_400_000).toISOString(), to: new Date(now + 400 * 86_400_000).toISOString() };
    const { name, sessions } = await sessionsFor(admin, feed.organization_id, feed.scope, feed.scope_id ?? undefined, access, window);
    const ics = buildCalendar({ name, events: sessions.map((s) => sessionToEvent(s, domain())), refreshMinutes: 60 });
    return new Response(ics, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `inline; filename="${encodeURIComponent(safeFilename(name))}"`,
        'Cache-Control': 'private, max-age=300' },
    });
  } catch (e) {
    // Any failure on the public feed is reported as a plain 404 (no information leak).
    if (!(e instanceof AppError)) return errResponse(e);
    return new Response('Not found', { status: 404, headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

serve(async (req) => {
  if (req.method === 'GET') {
    const url = new URL(req.url);
    if (!url.searchParams.has('feed')) fail('not_found');
    return publicFeed(url);
  }

  const caller = await getCaller(req);
  const raw = await readJson(req);
  const { action } = parse(Action, raw);

  if (action === 'ics') {
    const b = parse(IcsBody, raw);
    await requireMember(caller, b.organization_id);
    const granted = new Map<string, boolean>();
    for (const p of ['operations.view', 'experts.view']) granted.set(p, await hasPermission(caller, b.organization_id, p));
    const access: Access = { userId: caller.userId, can: (p) => granted.get(p) ?? false };
    const { name, sessions } = await sessionsFor(caller.admin, b.organization_id, b.scope, b.id, access);
    return { filename: safeFilename(name), ics: buildCalendar({ name, events: sessions.map((s) => sessionToEvent(s, domain())) }), count: sessions.length };
  }

  // create_feed
  const b = parse(FeedBody, raw);
  await requireMember(caller, b.organization_id);
  const granted = new Map<string, boolean>();
  for (const p of ['operations.view', 'experts.view']) granted.set(p, await hasPermission(caller, b.organization_id, p));
  const access: Access = { userId: caller.userId, can: (p) => granted.get(p) ?? false };
  if ((b.scope === 'expert' || b.scope === 'program') && !b.scope_id) fail('invalid_input', { field: 'scope_id', detail: { field: 'scope_id', reason: 'required for this scope' } });
  // Authorize exactly as the feed will be evaluated (also validates scope_id ownership).
  await sessionsFor(caller.admin, b.organization_id, b.scope, b.scope_id, access, { from: new Date().toISOString(), to: new Date().toISOString() });

  const token = randomToken(32);
  const row = check(await caller.admin.from('calendar_feed_tokens').insert({
    organization_id: b.organization_id, user_id: caller.userId, scope: b.scope, scope_id: b.scope === 'me' || b.scope === 'organization' ? null : b.scope_id,
    token_hash: await sha256Hex(token),
  }).select('id').single(), 'calendar_feed_tokens') as { id: string };
  await audit(caller.admin, { organization_id: b.organization_id, actor_user_id: caller.userId, action: 'calendar_feed_created', entity_type: 'calendar_feed_tokens',
    entity_id: row.id, summary: b.scope, new_data: { scope: b.scope, scope_id: b.scope_id ?? null } });
  const feed_url = `${requireEnv('SUPABASE_URL').replace(/\/+$/, '')}/functions/v1/calendar-sync?feed=${token}`;
  return { feed_url, feed_id: row.id };
}, { methods: ['GET', 'POST'] });
