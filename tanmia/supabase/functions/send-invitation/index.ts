// send-invitation — users.create on the organization (granting roles also
// requires users.assign). Actions: create (default), revoke, resend.
// The raw token only ever exists in the returned link / email.
import { serve, readJson, fail, check } from '../_shared/http.ts';
import { type Caller, getCaller, requireOrganization, requireOrgRoles, requireOrgRow, requirePermission } from '../_shared/auth.ts';
import { array, email, enumOf, int, object, optional, parse, string, uuid, withDefault } from '../_shared/validate.ts';
import { audit } from '../_shared/audit.ts';
import { createInvitation, rotateInvitation } from '../_shared/invitations.ts';

const Action = object({ action: withDefault(enumOf(['create', 'revoke', 'resend'] as const), 'create') });
const CreateBody = object({
  organization_id: uuid(),
  email: email(),
  full_name: optional(string({ max: 200 })),
  job_title: optional(string({ max: 200 })),
  role_ids: withDefault(array(uuid(), { max: 20, unique: true }), [] as string[]),
  link_beneficiary_id: optional(uuid()),
  link_expert_id: optional(uuid()),
  expires_in_days: withDefault(int({ min: 1, max: 30 }), 7),
});
const ByIdBody = object({
  invitation_id: optional(uuid()),
  organization_id: optional(uuid()),
  email: optional(email()),
  expires_in_days: withDefault(int({ min: 1, max: 30 }), 7),
});

interface InvitationRow { id: string; organization_id: string; email: string; full_name: string | null; status: string; expires_at: string }

async function findInvitation(caller: Caller, b: ReturnType<typeof ByIdBody>): Promise<InvitationRow> {
  const cols = 'id, organization_id, email, full_name, status, expires_at';
  if (b.invitation_id) {
    // Locate first (service role), then authorize against the invitation's own organization.
    const row = check(await caller.admin.from('user_invitations').select(cols).eq('id', b.invitation_id).maybeSingle(), 'user_invitations') as InvitationRow | null;
    if (!row) fail('not_found', { detail: { entity: 'invitation' } });
    await requirePermission(caller, row.organization_id, 'users.create');
    if (b.organization_id && b.organization_id !== row.organization_id) fail('not_found', { detail: { entity: 'invitation' } });
    return row;
  }
  if (!b.organization_id || !b.email) fail('invalid_input', { field: 'invitation_id', detail: { field: 'invitation_id', reason: 'invitation_id or organization_id + email required' } });
  await requirePermission(caller, b.organization_id, 'users.create');
  const rows = check(await caller.admin.from('user_invitations').select(cols).eq('organization_id', b.organization_id).eq('email', b.email)
    .in('status', ['pending', 'expired']).order('created_at', { ascending: false }).limit(1), 'user_invitations') as InvitationRow[];
  if (!rows.length) fail('not_found', { detail: { entity: 'invitation' } });
  return rows[0];
}

serve(async (req) => {
  const caller = await getCaller(req);
  const raw = await readJson(req);
  const { action } = parse(Action, raw);
  const admin = caller.admin;

  if (action === 'revoke') {
    const b = parse(ByIdBody, raw);
    const inv = await findInvitation(caller, b);
    if (inv.status !== 'pending') fail('invitation_not_pending');
    check(await admin.from('user_invitations').update({ status: 'revoked' }).eq('id', inv.id).eq('organization_id', inv.organization_id).eq('status', 'pending'),
      'user_invitations');
    await audit(admin, { organization_id: inv.organization_id, actor_user_id: caller.userId, action: 'invitation_revoked', entity_type: 'user_invitations', entity_id: inv.id, summary: inv.email });
    return { invitation_id: inv.id, status: 'revoked', link: null, expires_at: inv.expires_at, email_status: 'not_applicable' };
  }

  if (action === 'resend') {
    const b = parse(ByIdBody, raw);
    const inv = await findInvitation(caller, b);
    if (!['pending', 'expired'].includes(inv.status)) fail('invitation_not_pending');
    const org = await requireOrganization(caller, inv.organization_id);
    const out = await rotateInvitation(admin, inv, org.name, b.expires_in_days);
    await audit(admin, { organization_id: inv.organization_id, actor_user_id: caller.userId, action: 'invitation_resent', entity_type: 'user_invitations', entity_id: inv.id,
      summary: inv.email, new_data: { expires_at: out.expires_at, email_status: out.email_status } });
    return out;
  }

  // ---- create ----------------------------------------------------------------
  const b = parse(CreateBody, raw);
  await requirePermission(caller, b.organization_id, 'users.create');
  if (b.role_ids.length) await requirePermission(caller, b.organization_id, 'users.assign');
  const org = await requireOrganization(caller, b.organization_id);
  if (org.status !== 'active') fail('organization_inactive');
  await requireOrgRoles(admin, b.organization_id, b.role_ids);
  if (b.link_beneficiary_id) {
    const ben = await requireOrgRow<{ user_id: string | null }>(admin, 'beneficiaries', b.link_beneficiary_id, b.organization_id, 'id, user_id');
    if (ben.user_id) fail('already_linked', { detail: { entity: 'beneficiary' } });
  }
  if (b.link_expert_id) {
    const ex = await requireOrgRow<{ user_id: string | null }>(admin, 'experts', b.link_expert_id, b.organization_id, 'id, user_id');
    if (ex.user_id) fail('already_linked', { detail: { entity: 'expert' } });
  }

  const out = await createInvitation(admin, {
    organization_id: b.organization_id, organization_name: org.name, email: b.email, full_name: b.full_name, job_title: b.job_title,
    role_ids: b.role_ids, link_beneficiary_id: b.link_beneficiary_id, link_expert_id: b.link_expert_id, expires_in_days: b.expires_in_days,
    invited_by: caller.userId,
  });
  await audit(admin, {
    organization_id: b.organization_id, actor_user_id: caller.userId, action: 'invitation_created', entity_type: 'user_invitations', entity_id: out.invitation_id,
    summary: b.email, new_data: { role_ids: b.role_ids, link_beneficiary_id: b.link_beneficiary_id ?? null, link_expert_id: b.link_expert_id ?? null, expires_at: out.expires_at,
      email_status: out.email_status },
  });
  return out;
});
