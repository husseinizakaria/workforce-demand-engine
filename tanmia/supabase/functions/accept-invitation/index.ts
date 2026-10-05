// accept-invitation (verify_jwt = false at the gateway)
//   preview → anyone holding the token (token is the credential)
//   accept  → signed-in user whose email equals the invitation email; the JWT
//             is verified here with auth.getUser.
import { serve, readJson, fail, check } from '../_shared/http.ts';
import { adminClient, getCaller } from '../_shared/auth.ts';
import { enumOf, object, parse, string } from '../_shared/validate.ts';
import { TOKEN_RE, sha256Hex } from '../_shared/crypto.ts';
import { audit } from '../_shared/audit.ts';
import { maskEmail } from '../_shared/invitations.ts';

const Body = object({
  action: enumOf(['preview', 'accept'] as const),
  token: string({ min: 32, max: 128, pattern: TOKEN_RE }),
});

interface Invitation {
  id: string; organization_id: string; email: string; full_name: string | null; job_title: string | null; status: string; expires_at: string;
  link_beneficiary_id: string | null; link_expert_id: string | null; invited_by: string | null;
  organizations: { name: string; name_en: string | null; code: string; status: string } | null;
}

serve(async (req) => {
  const b = parse(Body, await readJson(req));
  const admin = adminClient();
  const tokenHash = await sha256Hex(b.token);
  const inv = check(await admin.from('user_invitations')
    .select('id, organization_id, email, full_name, job_title, status, expires_at, link_beneficiary_id, link_expert_id, invited_by, organizations(name, name_en, code, status)')
    .eq('token_hash', tokenHash).maybeSingle(), 'user_invitations') as Invitation | null;
  if (!inv) fail('invitation_invalid');

  const expired = inv.status === 'pending' && new Date(inv.expires_at).getTime() < Date.now();
  if (expired) {
    await admin.from('user_invitations').update({ status: 'expired' }).eq('id', inv.id).eq('status', 'pending');
  }
  const status = expired ? 'expired' : inv.status;

  if (b.action === 'preview') {
    const roles = check(await admin.from('invitation_roles').select('roles(name_ar, name_en)').eq('invitation_id', inv.id), 'invitation_roles') as
      unknown as { roles: { name_ar: string; name_en: string } | null }[];
    return {
      organization: inv.organizations ? { name: inv.organizations.name, name_en: inv.organizations.name_en, code: inv.organizations.code } : null,
      email_masked: maskEmail(inv.email),
      full_name: inv.full_name,
      roles: roles.filter((r) => r.roles).map((r) => r.roles!),
      expires_at: inv.expires_at,
      status,
    };
  }

  // ---- accept (authenticated) -----------------------------------------------
  const caller = await getCaller(req);
  if (status === 'expired') fail('invitation_expired');
  if (status !== 'pending') fail('invitation_not_pending');
  if (!caller.email || caller.email !== inv.email.toLowerCase()) fail('email_mismatch');
  // The address must be proven: an unconfirmed sign-up cannot claim an invitation.
  if (!caller.user.email_confirmed_at) fail('email_mismatch', { detail: { reason: 'email_not_confirmed' } });
  if (inv.organizations?.status !== 'active') fail('organization_inactive');
  const org = inv.organization_id;
  const uid = caller.userId;

  // Pre-flight checks for self-service links (fail before changing anything).
  const linkChecks: [string, string | null][] = [['beneficiaries', inv.link_beneficiary_id], ['experts', inv.link_expert_id]];
  for (const [table, id] of linkChecks) {
    if (!id) continue;
    const row = check(await admin.from(table).select('id, user_id').eq('id', id).eq('organization_id', org).maybeSingle(), table) as { user_id: string | null } | null;
    if (!row) fail('not_found', { detail: { entity: table } });
    if (row.user_id && row.user_id !== uid) fail('already_linked', { detail: { entity: table } });
    const other = check(await admin.from(table).select('id').eq('organization_id', org).eq('user_id', uid).neq('id', id).limit(1), table) as { id: string }[];
    if (other.length) fail('already_linked', { detail: { entity: table, reason: 'user already linked to another record' } });
  }

  // Claim the invitation atomically (prevents double acceptance).
  const claimed = check(await admin.from('user_invitations')
    .update({ status: 'accepted', accepted_by: uid, accepted_at: new Date().toISOString() })
    .eq('id', inv.id).eq('status', 'pending').select('id'), 'user_invitations') as { id: string }[];
  if (!claimed.length) fail('invitation_not_pending');

  check(await admin.from('organization_members').upsert({
    organization_id: org, user_id: uid, active: true, title: inv.job_title, invited_by: inv.invited_by,
  }, { onConflict: 'organization_id,user_id' }), 'organization_members');

  const roleRows = check(await admin.from('invitation_roles').select('role_id').eq('invitation_id', inv.id), 'invitation_roles') as { role_id: string }[];
  if (roleRows.length) {
    // Only roles that still belong to this organization and are active.
    const valid = check(await admin.from('roles').select('id').eq('organization_id', org).eq('active', true).in('id', roleRows.map((r) => r.role_id)), 'roles') as
      { id: string }[];
    if (valid.length) {
      check(await admin.from('user_roles').upsert(valid.map((r) => ({ organization_id: org, user_id: uid, role_id: r.id })),
        { onConflict: 'organization_id,user_id,role_id', ignoreDuplicates: true }), 'user_roles');
    }
  }
  for (const [table, id] of linkChecks) {
    if (id) check(await admin.from(table).update({ user_id: uid }).eq('id', id).eq('organization_id', org), table);
  }

  const profile = check(await admin.from('profiles').select('full_name, job_title').eq('id', uid).maybeSingle(), 'profiles') as
    { full_name: string | null; job_title: string | null } | null;
  const patch: Record<string, unknown> = {};
  if (inv.full_name && (!profile?.full_name || profile.full_name === caller.email?.split('@')[0])) patch.full_name = inv.full_name;
  if (inv.job_title && !profile?.job_title) patch.job_title = inv.job_title;
  if (Object.keys(patch).length) check(await admin.from('profiles').update(patch).eq('id', uid), 'profiles');

  await audit(admin, {
    organization_id: org, actor_user_id: uid, action: 'invitation_accepted', entity_type: 'user_invitations', entity_id: inv.id, summary: inv.email,
    new_data: { roles: roleRows.map((r) => r.role_id), link_beneficiary_id: inv.link_beneficiary_id, link_expert_id: inv.link_expert_id },
  });
  return { organization_id: org };
});
