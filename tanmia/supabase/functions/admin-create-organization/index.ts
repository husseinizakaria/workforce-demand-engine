// admin-create-organization — platform super admin only.
// Inserts the organization (DB trigger seeds roles + modules), applies module
// switches and assigns an organization admin (existing user → membership,
// otherwise an invitation with the org_admin role).
import { serve, readJson, fail, check } from '../_shared/http.ts';
import { findUserIdByEmail, getCaller, requireSuperAdmin } from '../_shared/auth.ts';
import { bool, email, enumOf, object, optional, parse, record, string } from '../_shared/validate.ts';
import { audit } from '../_shared/audit.ts';
import { type EmailStatus, createInvitation } from '../_shared/invitations.ts';

const MODULE_KEYS = ['programs', 'beneficiaries', 'experts', 'vendors', 'partners', 'operations', 'assessments',
  'evidence', 'outcomes', 'impact', 'templates', 'reports', 'governance', 'notifications'] as const;

const Body = object({
  name: string({ min: 2, max: 200 }),
  name_en: optional(string({ max: 200 })),
  org_type: optional(string({ max: 100 })),
  sector: optional(string({ max: 100 })),
  city: optional(string({ max: 100 })),
  contact_email: optional(email()),
  default_locale: optional(enumOf(['ar', 'en'] as const)),
  modules: optional(record(bool(), { maxKeys: MODULE_KEYS.length, key: enumOf(MODULE_KEYS) })),
  admin: optional(object({ email: email(), full_name: string({ min: 1, max: 200 }) })),
});

serve(async (req) => {
  const caller = await getCaller(req);
  await requireSuperAdmin(caller);
  const b = parse(Body, await readJson(req));
  const admin = caller.admin;

  const organization = check(await admin.from('organizations').insert({
    name: b.name, name_en: b.name_en ?? null, org_type: b.org_type ?? null, sector: b.sector ?? null, city: b.city ?? null,
    contact_email: b.contact_email ?? null, default_locale: b.default_locale ?? 'ar', created_by: caller.userId,
  }).select('*').single(), 'organizations') as { id: string; name: string; code: string };

  const modules = Object.entries(b.modules ?? {});
  if (modules.length) {
    check(await admin.from('organization_modules').upsert(
      modules.map(([module_key, enabled]) => ({ organization_id: organization.id, module_key, enabled, updated_by: caller.userId, updated_at: new Date().toISOString() })),
      { onConflict: 'organization_id,module_key' },
    ), 'organization_modules');
  }

  let adminResult: { user_id: string | null; invitation_link: string | null; email_status: EmailStatus } | null = null;
  if (b.admin) {
    const role = check(await admin.from('roles').select('id').eq('organization_id', organization.id).eq('code', 'org_admin').maybeSingle(), 'roles') as { id: string } | null;
    if (!role) {
      console.error('[admin-create-organization] org_admin role was not seeded for', organization.id);
      fail('internal', { detail: { reason: 'org_admin role missing' } });
    }
    const existing = await findUserIdByEmail(admin, b.admin.email);
    if (existing) {
      check(await admin.from('organization_members').upsert({ organization_id: organization.id, user_id: existing, active: true, invited_by: caller.userId },
        { onConflict: 'organization_id,user_id' }), 'organization_members');
      check(await admin.from('user_roles').upsert({ organization_id: organization.id, user_id: existing, role_id: role.id },
        { onConflict: 'organization_id,user_id,role_id', ignoreDuplicates: true }), 'user_roles');
      adminResult = { user_id: existing, invitation_link: null, email_status: 'not_applicable' };
    } else {
      const inv = await createInvitation(admin, {
        organization_id: organization.id, organization_name: organization.name, email: b.admin.email, full_name: b.admin.full_name,
        role_ids: [role.id], expires_in_days: 14, invited_by: caller.userId,
      });
      adminResult = { user_id: null, invitation_link: inv.link, email_status: inv.email_status };
    }
  }

  await audit(admin, {
    organization_id: organization.id,
    actor_user_id: caller.userId,
    scope: 'platform',
    action: 'organization_created',
    entity_type: 'organizations',
    entity_id: organization.id,
    summary: `${organization.code} ${organization.name}`,
    new_data: { modules: b.modules ?? {}, admin_email: b.admin?.email ?? null, admin_existing_user: !!adminResult?.user_id },
  });

  return { organization, admin: adminResult };
});
