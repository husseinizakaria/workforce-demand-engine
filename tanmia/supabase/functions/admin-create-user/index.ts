// admin-create-user — platform super admin, or users.create on organization_id.
// Creates (or reuses) an auth user, optionally adds organization membership
// and roles. Without a password an invite link is generated and emailed when
// email is configured, otherwise returned once as setup_link.
import { serve, readJson, fail, check } from '../_shared/http.ts';
import { appUrl, findUserIdByEmail, getCaller, isSuperAdmin, requireOrganization, requireOrgRoles, requirePermission } from '../_shared/auth.ts';
import { array, bool, email, object, optional, parse, string, uuid } from '../_shared/validate.ts';
import { audit } from '../_shared/audit.ts';
import { accountEmail, sendEmail } from '../_shared/notify.ts';
import { type EmailStatus, emailStatusOf } from '../_shared/invitations.ts';

const Body = object({
  email: email(),
  full_name: string({ min: 1, max: 200 }),
  job_title: optional(string({ max: 200 })),
  password: optional(string({ min: 8, max: 128, trim: false })),
  organization_id: optional(uuid()),
  role_ids: optional(array(uuid(), { max: 20, unique: true })),
  is_platform_super_admin: optional(bool()),
});

serve(async (req) => {
  const caller = await getCaller(req);
  const body = parse(Body, await readJson(req));
  const superAdmin = await isSuperAdmin(caller);
  const admin = caller.admin;
  const roleIds = body.role_ids ?? [];

  // ---- authorization -------------------------------------------------------
  if (body.organization_id) {
    await requirePermission(caller, body.organization_id, 'users.create');
    // Granting roles is a separate privilege (prevents users.create → org_admin escalation).
    if (roleIds.length) await requirePermission(caller, body.organization_id, 'users.assign');
  } else if (!superAdmin) {
    fail('forbidden', { detail: { reason: 'organization_id is required' } });
  }
  if (body.is_platform_super_admin && !superAdmin) fail('forbidden', { detail: { field: 'is_platform_super_admin' } });
  if (roleIds.length && !body.organization_id) fail('invalid_input', { field: 'organization_id', detail: { field: 'organization_id', reason: 'required with role_ids' } });

  const org = body.organization_id ? await requireOrganization(caller, body.organization_id) : null;
  const roles = org ? await requireOrgRoles(admin, org.id, roleIds) : [];

  // ---- create or reuse the auth user ---------------------------------------
  let userId = await findUserIdByEmail(admin, body.email);
  let created = false;
  let setupLink: string | null = null;
  let emailStatus: EmailStatus = 'not_applicable';

  if (!userId) {
    if (body.password) {
      const { data, error } = await admin.auth.admin.createUser({
        email: body.email, password: body.password, email_confirm: true, user_metadata: { full_name: body.full_name },
      });
      if (error || !data.user) {
        console.error('[admin-create-user] createUser failed', error?.status, error?.message);
        fail(error?.status === 422 ? 'already_exists' : 'invalid_input', { detail: { reason: error?.message } });
      }
      userId = data.user.id;
    } else {
      const { data, error } = await admin.auth.admin.generateLink({
        type: 'invite', email: body.email,
        options: { data: { full_name: body.full_name }, redirectTo: `${appUrl()}/reset-password` },
      });
      if (error || !data.user) {
        console.error('[admin-create-user] generateLink failed', error?.status, error?.message);
        fail(error?.status === 422 ? 'already_exists' : 'invalid_input', { detail: { reason: error?.message } });
      }
      userId = data.user.id;
      const link = data.properties?.action_link ?? null;
      if (link) {
        const mail = accountEmail('setup', { orgName: org?.name ?? null, fullName: body.full_name, link });
        const sent = await sendEmail({ to: body.email, ...mail });
        emailStatus = emailStatusOf(sent);
        // The link is returned only when it could not be delivered by email.
        setupLink = sent.status === 'sent' ? null : link;
      }
    }
    created = true;
    check(await admin.from('profiles').upsert({
      id: userId, email: body.email, full_name: body.full_name, job_title: body.job_title ?? null, status: 'active',
    }, { onConflict: 'id' }), 'profiles');
  }

  // ---- membership, roles, platform flag -------------------------------------
  if (org) {
    check(await admin.from('organization_members').upsert({
      organization_id: org.id, user_id: userId, active: true, title: body.job_title ?? null, invited_by: caller.userId,
    }, { onConflict: 'organization_id,user_id' }), 'organization_members');
    if (roles.length) {
      check(await admin.from('user_roles').upsert(roles.map((r) => ({ organization_id: org.id, user_id: userId, role_id: r.id })),
        { onConflict: 'organization_id,user_id,role_id', ignoreDuplicates: true }), 'user_roles');
    }
  }
  if (body.is_platform_super_admin) {
    check(await admin.from('platform_users').upsert({ user_id: userId, is_platform_super_admin: true, active: true }, { onConflict: 'user_id' }), 'platform_users');
  }

  await audit(admin, {
    organization_id: org?.id ?? null,
    actor_user_id: caller.userId,
    scope: org ? 'organization' : 'platform',
    action: created ? 'user_created' : 'user_membership_added',
    entity_type: 'auth.users',
    entity_id: userId,
    summary: body.email,
    new_data: { email: body.email, created, organization_id: org?.id ?? null, roles: roles.map((r) => r.code), is_platform_super_admin: !!body.is_platform_super_admin, email_status: emailStatus },
  });

  return { user_id: userId, created, setup_link: setupLink, email_status: emailStatus };
});
