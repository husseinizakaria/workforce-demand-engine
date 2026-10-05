// admin-update-user
//   action 'list' / 'get' → platform super admin
//   action 'update'       → super admin, or users.edit on organization_id
//                           (role_ids additionally needs users.assign;
//                            banned / is_platform_super_admin need super admin)
import { serve, readJson, fail, check } from '../_shared/http.ts';
import { type Caller, type Db, appUrl, getCaller, isSuperAdmin, requireOrganization, requireOrgRoles, requirePermission, requireSuperAdmin } from '../_shared/auth.ts';
import { array, bool, enumOf, int, object, optional, parse, string, uuid, withDefault } from '../_shared/validate.ts';
import { audit } from '../_shared/audit.ts';
import { fetchIn } from '../_shared/bundle.ts';
import { accountEmail, sendEmail } from '../_shared/notify.ts';
import { type EmailStatus, emailStatusOf } from '../_shared/invitations.ts';
import type { User } from 'npm:@supabase/supabase-js@2';

const Action = object({ action: withDefault(enumOf(['list', 'get', 'update'] as const), 'update') });
const ListBody = object({
  page: withDefault(int({ min: 1, max: 10_000 }), 1),
  per_page: withDefault(int({ min: 1, max: 200 }), 50),
  search: optional(string({ max: 200 })),
});
const GetBody = object({ user_id: uuid() });
const UpdateBody = object({
  user_id: uuid(),
  organization_id: optional(uuid()),
  full_name: optional(string({ min: 1, max: 200 })),
  job_title: optional(string({ max: 200 })),
  phone: optional(string({ max: 40 })),
  member_active: optional(bool()),
  role_ids: optional(array(uuid(), { max: 20, unique: true })),
  banned: optional(bool()),
  is_platform_super_admin: optional(bool()),
  send_password_reset: optional(bool()),
});

interface UserView {
  id: string; email: string | null; full_name: string | null; last_sign_in_at: string | null; created_at: string; banned: boolean;
  is_platform_super_admin: boolean;
  memberships: { organization_id: string; organization_name: string | null; active: boolean; roles: string[] }[];
}

async function describeUsers(admin: Db, users: User[]): Promise<UserView[]> {
  const ids = users.map((u) => u.id);
  if (!ids.length) return [];
  const [profiles, platform, members, userRoles] = await Promise.all([
    fetchIn<{ id: string; full_name: string | null }>(admin, 'profiles', 'id', ids, [], { columns: 'id, full_name' }),
    fetchIn<{ user_id: string; is_platform_super_admin: boolean; active: boolean }>(admin, 'platform_users', 'user_id', ids, [],
      { columns: 'user_id, is_platform_super_admin, active', key: ['user_id'] }),
    fetchIn<{ user_id: string; organization_id: string; active: boolean; organizations: { name: string } | null }>(admin, 'organization_members', 'user_id', ids, [],
      { columns: 'user_id, organization_id, active, organizations(name)', key: ['organization_id', 'user_id'] }),
    fetchIn<{ user_id: string; organization_id: string; roles: { code: string } | null }>(admin, 'user_roles', 'user_id', ids, [],
      { columns: 'user_id, organization_id, role_id, roles(code)', key: ['organization_id', 'user_id', 'role_id'] }),
  ]);
  const name = new Map(profiles.map((p) => [p.id, p.full_name]));
  const sup = new Map(platform.map((p) => [p.user_id, p.is_platform_super_admin && p.active]));
  const now = Date.now();
  return users.map((u) => {
    const bannedUntil = (u as User & { banned_until?: string | null }).banned_until;
    return {
      id: u.id,
      email: u.email ?? null,
      full_name: name.get(u.id) ?? (u.user_metadata?.full_name as string | undefined) ?? null,
      last_sign_in_at: u.last_sign_in_at ?? null,
      created_at: u.created_at,
      banned: !!bannedUntil && new Date(bannedUntil).getTime() > now,
      is_platform_super_admin: sup.get(u.id) ?? false,
      memberships: members.filter((m) => m.user_id === u.id).map((m) => ({
        organization_id: m.organization_id,
        organization_name: m.organizations?.name ?? null,
        active: m.active,
        roles: userRoles.filter((r) => r.user_id === u.id && r.organization_id === m.organization_id && r.roles).map((r) => r.roles!.code),
      })),
    };
  });
}

async function list(caller: Caller, raw: Record<string, unknown>) {
  await requireSuperAdmin(caller);
  const b = parse(ListBody, raw);
  const admin = caller.admin;
  if (b.search) {
    // PostgREST or-filter: strip characters that carry syntax meaning.
    const term = b.search.replace(/[,()*%\\"':]/g, ' ').trim();
    if (!term) return { users: [], total: 0 };
    const from = (b.page - 1) * b.per_page;
    const res = await admin.from('profiles').select('id', { count: 'exact' })
      .or(`email.ilike.*${term}*,full_name.ilike.*${term}*`).order('created_at', { ascending: false }).range(from, from + b.per_page - 1);
    const rows = check(res, 'profiles') as { id: string }[];
    const users: User[] = [];
    for (const r of rows) {
      const { data } = await admin.auth.admin.getUserById(r.id);
      if (data?.user) users.push(data.user);
    }
    return { users: await describeUsers(admin, users), total: res.count ?? users.length };
  }
  const { data, error } = await admin.auth.admin.listUsers({ page: b.page, perPage: b.per_page });
  if (error) { console.error('[admin-update-user] listUsers', error.message); fail('internal'); }
  const total = (data as unknown as { total?: number }).total ?? data.users.length;
  return { users: await describeUsers(admin, data.users), total };
}

async function get(caller: Caller, raw: Record<string, unknown>) {
  await requireSuperAdmin(caller);
  const b = parse(GetBody, raw);
  const { data, error } = await caller.admin.auth.admin.getUserById(b.user_id);
  if (error || !data?.user) fail('not_found', { detail: { entity: 'user' } });
  const [view] = await describeUsers(caller.admin, [data.user]);
  return { user: view };
}

async function update(caller: Caller, raw: Record<string, unknown>) {
  const b = parse(UpdateBody, raw);
  const admin = caller.admin;
  const superAdmin = await isSuperAdmin(caller);
  const self = b.user_id === caller.userId;

  // ---- authorization -------------------------------------------------------
  if (b.organization_id) {
    await requirePermission(caller, b.organization_id, 'users.edit');
    await requireOrganization(caller, b.organization_id);
  } else if (!superAdmin) {
    fail('forbidden', { detail: { reason: 'organization_id is required' } });
  }
  if ((b.banned !== undefined || b.is_platform_super_admin !== undefined) && !superAdmin) fail('forbidden');
  if ((b.member_active !== undefined || b.role_ids !== undefined) && !b.organization_id) {
    fail('invalid_input', { field: 'organization_id', detail: { field: 'organization_id', reason: 'required for membership changes' } });
  }
  if (b.role_ids !== undefined) await requirePermission(caller, b.organization_id!, 'users.assign');
  if (self && b.is_platform_super_admin === false) fail('cannot_modify_self', { detail: { reason: 'cannot demote yourself' } });
  if (self && b.banned === true) fail('cannot_modify_self', { detail: { reason: 'cannot ban yourself' } });
  if (self && b.member_active === false) fail('cannot_modify_self', { detail: { reason: 'cannot deactivate your own membership' } });

  const { data: target, error: targetErr } = await admin.auth.admin.getUserById(b.user_id);
  if (targetErr || !target?.user) fail('not_found', { detail: { entity: 'user' } });

  let membership: { active: boolean } | null = null;
  if (b.organization_id) {
    membership = check(await admin.from('organization_members').select('active').eq('organization_id', b.organization_id).eq('user_id', b.user_id).maybeSingle(),
      'organization_members');
    // Organization admins may only manage members of their own organization.
    if (!membership && !superAdmin) fail('not_found', { detail: { entity: 'membership' } });
  }

  const updated: string[] = [];
  const before: Record<string, unknown> = {};

  // ---- profile -------------------------------------------------------------
  const profilePatch: Record<string, unknown> = {};
  if (b.full_name !== undefined) profilePatch.full_name = b.full_name;
  if (b.job_title !== undefined) profilePatch.job_title = b.job_title || null;
  if (b.phone !== undefined) profilePatch.phone = b.phone || null;
  if (Object.keys(profilePatch).length) {
    check(await admin.from('profiles').update(profilePatch).eq('id', b.user_id), 'profiles');
    updated.push(...Object.keys(profilePatch));
  }

  // ---- membership / roles --------------------------------------------------
  if (b.organization_id && (b.member_active !== undefined || b.role_ids !== undefined || b.job_title !== undefined)) {
    if (!membership) {
      // Super admin attaching a user to an organization.
      check(await admin.from('organization_members').insert({
        organization_id: b.organization_id, user_id: b.user_id, active: b.member_active ?? true, title: b.job_title ?? null, invited_by: caller.userId,
      }), 'organization_members');
      updated.push('membership');
    } else {
      const patch: Record<string, unknown> = {};
      if (b.member_active !== undefined && b.member_active !== membership.active) { patch.active = b.member_active; before.member_active = membership.active; }
      if (b.job_title !== undefined) patch.title = b.job_title || null;
      if (Object.keys(patch).length) {
        check(await admin.from('organization_members').update(patch).eq('organization_id', b.organization_id).eq('user_id', b.user_id), 'organization_members');
        if ('active' in patch) updated.push('member_active');
      }
    }
  }
  if (b.role_ids !== undefined && b.organization_id) {
    const roles = await requireOrgRoles(admin, b.organization_id, b.role_ids);
    const current = check(await admin.from('user_roles').select('role_id').eq('organization_id', b.organization_id).eq('user_id', b.user_id), 'user_roles') as
      { role_id: string }[];
    const want = new Set(roles.map((r) => r.id));
    const have = new Set(current.map((r) => r.role_id));
    const remove = [...have].filter((id) => !want.has(id));
    const add = [...want].filter((id) => !have.has(id));
    if (self && !superAdmin && remove.length) {
      // Never let an org admin strip their own admin role by accident.
      const removed = check(await admin.from('roles').select('code').in('id', remove), 'roles') as { code: string }[];
      if (removed.some((r) => r.code === 'org_admin')) fail('cannot_modify_self', { detail: { reason: 'cannot remove your own org_admin role' } });
    }
    if (remove.length) check(await admin.from('user_roles').delete().eq('organization_id', b.organization_id).eq('user_id', b.user_id).in('role_id', remove), 'user_roles');
    if (add.length) check(await admin.from('user_roles').insert(add.map((role_id) => ({ organization_id: b.organization_id, user_id: b.user_id, role_id }))), 'user_roles');
    before.role_ids = [...have];
    updated.push('role_ids');
  }

  // ---- platform-level (super admin only) -----------------------------------
  if (b.banned !== undefined) {
    const { error } = await admin.auth.admin.updateUserById(b.user_id, { ban_duration: b.banned ? '876000h' : 'none' });
    if (error) { console.error('[admin-update-user] ban', error.message); fail('internal'); }
    updated.push('banned');
  }
  if (b.is_platform_super_admin !== undefined) {
    check(await admin.from('platform_users').upsert({ user_id: b.user_id, is_platform_super_admin: b.is_platform_super_admin, active: true }, { onConflict: 'user_id' }),
      'platform_users');
    updated.push('is_platform_super_admin');
  }

  // ---- password reset --------------------------------------------------------
  let emailStatus: EmailStatus | undefined;
  let resetLink: string | null = null;
  if (b.send_password_reset) {
    const email = target.user.email;
    if (!email) fail('invalid_input', { field: 'send_password_reset', detail: { reason: 'user has no email' } });
    const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: `${appUrl()}/reset-password` } });
    if (error || !data.properties?.action_link) { console.error('[admin-update-user] recovery link', error?.message); fail('internal'); }
    const mail = accountEmail('reset', { fullName: (target.user.user_metadata?.full_name as string | undefined) ?? null, link: data.properties.action_link });
    const sent = await sendEmail({ to: email, ...mail });
    emailStatus = emailStatusOf(sent);
    // A recovery link grants account access: only a platform super admin may receive it directly.
    if (sent.status !== 'sent' && superAdmin) resetLink = data.properties.action_link;
    updated.push('password_reset');
  }

  await audit(admin, {
    organization_id: b.organization_id ?? null,
    actor_user_id: caller.userId,
    scope: b.organization_id ? 'organization' : 'platform',
    action: 'user_updated',
    entity_type: 'auth.users',
    entity_id: b.user_id,
    summary: target.user.email ?? b.user_id,
    old_data: before,
    new_data: { updated, ...profilePatch, member_active: b.member_active, role_ids: b.role_ids, banned: b.banned, is_platform_super_admin: b.is_platform_super_admin },
  });

  return { user_id: b.user_id, updated, ...(emailStatus ? { email_status: emailStatus, reset_link: resetLink } : {}) };
}

serve(async (req) => {
  const caller = await getCaller(req);
  const raw = await readJson(req);
  const { action } = parse(Action, raw);
  if (action === 'list') return list(caller, raw);
  if (action === 'get') return get(caller, raw);
  return update(caller, raw);
});
