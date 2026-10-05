// Caller identity and authorization. Authorization always uses the database's
// own helpers (has_permission, is_platform_super_admin, module_enabled,
// is_org_member) executed AS THE CALLER through a user-scoped client.
// The service-role client is returned for privileged work that must only
// happen after these checks pass.
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';
import { AppError, check, fail } from './http.ts';
import { timingSafeEqual } from './crypto.ts';

export type Db = SupabaseClient;

export function env(name: string): string | undefined {
  const v = Deno.env.get(name);
  return v && v.trim() ? v.trim() : undefined;
}

export function requireEnv(name: string): string {
  const v = env(name);
  if (!v) {
    console.error(`[config] missing required environment variable ${name}`);
    throw new AppError('internal', { detail: { reason: 'server_misconfigured' } });
  }
  return v;
}

export function appUrl(): string {
  return (env('APP_URL') ?? 'http://localhost:5173').replace(/\/+$/, '');
}

const clientOpts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

let adminSingleton: Db | null = null;
/** Service-role client. Use ONLY after the caller has been authorized. */
export function adminClient(): Db {
  if (!adminSingleton) adminSingleton = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), clientOpts);
  return adminSingleton;
}

export interface Caller {
  user: User;
  userId: string;
  email: string | null;
  /** Anon key + the caller's JWT: every query/RPC runs under RLS as the caller. */
  userClient: Db;
  /** Service role: bypasses RLS. */
  admin: Db;
  cache: Map<string, boolean>;
}

function bearer(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

export function hasBearer(req: Request): boolean {
  return !!bearer(req);
}

/** Verifies the JWT with Supabase Auth and returns the caller context. 401 otherwise. */
export async function getCaller(req: Request): Promise<Caller> {
  const jwt = bearer(req);
  if (!jwt) fail('unauthorized');
  const userClient = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
    ...clientOpts,
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data, error } = await userClient.auth.getUser(jwt);
  if (error || !data?.user) fail('unauthorized');
  const user = data.user;
  return { user, userId: user.id, email: user.email?.toLowerCase() ?? null, userClient, admin: adminClient(), cache: new Map() };
}

async function rpcBool(c: Caller, key: string, fn: string, args: Record<string, unknown>): Promise<boolean> {
  const hit = c.cache.get(key);
  if (hit !== undefined) return hit;
  const { data, error } = await c.userClient.rpc(fn, args);
  if (error) {
    console.error(`[auth] rpc ${fn} failed`, error.code, error.message);
    throw new AppError('internal');
  }
  const v = data === true;
  c.cache.set(key, v);
  return v;
}

export function isSuperAdmin(c: Caller): Promise<boolean> {
  return rpcBool(c, 'super', 'is_platform_super_admin', {});
}

export async function requireSuperAdmin(c: Caller): Promise<void> {
  if (!(await isSuperAdmin(c))) fail('forbidden');
}

export function isOrgMember(c: Caller, org: string): Promise<boolean> {
  return rpcBool(c, `member:${org}`, 'is_org_member', { org });
}

/** Organization must exist (checked with the service role) — 404 otherwise. */
export async function requireOrganization(c: Caller, org: string): Promise<{ id: string; name: string; name_en: string | null; code: string; status: string; default_locale: string }> {
  const row = check(await c.admin.from('organizations').select('id, name, name_en, code, status, default_locale').eq('id', org).maybeSingle(), 'organization');
  if (!row) fail('not_found', { detail: { entity: 'organization' } });
  return row;
}

export async function requireMember(c: Caller, org: string): Promise<void> {
  if (!(await isOrgMember(c, org))) fail('forbidden');
}

/**
 * True when the caller holds `permission` on `org` AND the permission's module
 * is enabled for the organization (mirrors tenant_can). Super admins pass.
 */
export async function hasPermission(c: Caller, org: string, permission: string): Promise<boolean> {
  if (await isSuperAdmin(c)) return true;
  const granted = await rpcBool(c, `perm:${org}:${permission}`, 'has_permission', { org, permission_code: permission });
  if (!granted) return false;
  const module = permission.split('.')[0];
  if (module === 'users') return true;
  return rpcBool(c, `module:${org}:${module}`, 'module_enabled', { org, module });
}

/** Requires at least one of the given permissions on the organization. */
export async function requirePermission(c: Caller, org: string, permission: string | string[]): Promise<void> {
  const list = Array.isArray(permission) ? permission : [permission];
  for (const p of list) if (await hasPermission(c, org, p)) return;
  fail('forbidden', { detail: { required: list } });
}

/** Cron calls carry x-cron-secret; compared in constant time. */
export async function isCron(req: Request): Promise<boolean> {
  const given = req.headers.get('x-cron-secret');
  const secret = env('CRON_SECRET');
  if (!given || !secret) return false;
  return await timingSafeEqual(given, secret);
}

export async function requireCron(req: Request): Promise<void> {
  if (!(await isCron(req))) fail('unauthorized');
}

// ---------------------------------------------------------------------------
// Service-side permission resolution for a user WITHOUT a JWT (public ICS
// feed). Mirrors has_permission + module_enabled using the service role.
// ---------------------------------------------------------------------------
export async function userPermissions(admin: Db, org: string, userId: string): Promise<{ superAdmin: boolean; active: boolean; codes: Set<string> }> {
  const [pu, member, orgRow] = await Promise.all([
    admin.from('platform_users').select('is_platform_super_admin, active').eq('user_id', userId).maybeSingle(),
    admin.from('organization_members').select('active').eq('organization_id', org).eq('user_id', userId).maybeSingle(),
    admin.from('organizations').select('status').eq('id', org).maybeSingle(),
  ]);
  const superAdmin = !!(pu.data?.is_platform_super_admin && pu.data?.active);
  const active = superAdmin || (!!member.data?.active && orgRow.data?.status === 'active');
  const codes = new Set<string>();
  if (!active || superAdmin) return { superAdmin, active, codes };
  const ur = check(await admin.from('user_roles').select('role_id').eq('organization_id', org).eq('user_id', userId), 'user_roles') as { role_id: string }[];
  if (!ur.length) return { superAdmin, active, codes };
  const roles = check(await admin.from('roles').select('id').in('id', ur.map((r) => r.role_id)).eq('active', true), 'roles') as { id: string }[];
  if (!roles.length) return { superAdmin, active, codes };
  const rp = check(await admin.from('role_permissions').select('permissions(code)').in('role_id', roles.map((r) => r.id)), 'role_permissions') as
    unknown as { permissions: { code: string } | { code: string }[] | null }[];
  const disabled = new Set(
    (check(await admin.from('organization_modules').select('module_key').eq('organization_id', org).eq('enabled', false), 'modules') as { module_key: string }[])
      .map((m) => m.module_key),
  );
  for (const r of rp) {
    const perms = Array.isArray(r.permissions) ? r.permissions : r.permissions ? [r.permissions] : [];
    for (const p of perms) if (!disabled.has(p.code.split('.')[0])) codes.add(p.code);
  }
  return { superAdmin, active, codes };
}

/** Finds an existing auth user by email (profiles mirror auth.users.email in lower case). */
export async function findUserIdByEmail(admin: Db, email: string): Promise<string | null> {
  const lower = email.trim().toLowerCase();
  const prof = check(await admin.from('profiles').select('id').eq('email', lower).limit(1), 'profiles') as { id: string }[];
  if (prof.length) {
    const { data } = await admin.auth.admin.getUserById(prof[0].id);
    if (data?.user && data.user.email?.toLowerCase() === lower) return data.user.id;
  }
  // Fallback: page through auth users (profiles may be stale after an email change).
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) { console.error('[auth] listUsers failed', error.message); return null; }
    const hit = data.users.find((u) => u.email?.toLowerCase() === lower);
    if (hit) return hit.id;
    if (data.users.length < 1000) break;
  }
  return null;
}

/** Validates that every role id belongs to the organization and is active. Returns role rows. */
export async function requireOrgRoles(admin: Db, org: string, roleIds: string[]): Promise<{ id: string; code: string; name_ar: string; name_en: string }[]> {
  if (!roleIds.length) return [];
  const rows = check(await admin.from('roles').select('id, code, name_ar, name_en').eq('organization_id', org).eq('active', true).in('id', roleIds), 'roles') as
    { id: string; code: string; name_ar: string; name_en: string }[];
  if (rows.length !== new Set(roleIds).size) fail('invalid_input', { field: 'role_ids', detail: { field: 'role_ids', reason: 'unknown role for this organization' } });
  return rows;
}

/** Fetches one row by id that must belong to the organization; 404 otherwise. */
export async function requireOrgRow<T = Record<string, unknown>>(admin: Db, table: string, id: string, org: string, columns = '*'): Promise<T> {
  const row = check(await admin.from(table).select(columns).eq('id', id).eq('organization_id', org).maybeSingle(), table);
  if (!row) fail('not_found', { detail: { entity: table } });
  return row as T;
}
