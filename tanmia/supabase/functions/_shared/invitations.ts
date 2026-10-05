// Invitation creation shared by send-invitation and admin-create-organization.
// Only sha256(token) is stored; the raw token is returned once, inside the link.
import type { Db } from './auth.ts';
import { appUrl } from './auth.ts';
import { check } from './http.ts';
import { randomToken, sha256Hex } from './crypto.ts';
import { accountEmail, sendEmail } from './notify.ts';

export type EmailStatus = 'sent' | 'failed' | 'not_configured' | 'not_applicable';

export function emailStatusOf(r: { status: string; reason: string | null }): EmailStatus {
  if (r.status === 'sent') return 'sent';
  if (r.status === 'skipped' && r.reason === 'not_configured') return 'not_configured';
  return 'failed';
}

export function inviteLink(token: string): string {
  return `${appUrl()}/invite/${token}`;
}

export interface InvitationInput {
  organization_id: string;
  organization_name: string;
  email: string;
  full_name?: string | null;
  job_title?: string | null;
  role_ids: string[];
  link_beneficiary_id?: string | null;
  link_expert_id?: string | null;
  expires_in_days: number;
  invited_by: string;
}

export interface InvitationOutput { invitation_id: string; link: string; expires_at: string; email_status: EmailStatus }

export async function createInvitation(admin: Db, input: InvitationInput): Promise<InvitationOutput> {
  // Supersede earlier pending invitations for the same address in this organization.
  check(await admin.from('user_invitations').update({ status: 'revoked' })
    .eq('organization_id', input.organization_id).eq('email', input.email).eq('status', 'pending'), 'user_invitations');

  const token = randomToken(32);
  const expires_at = new Date(Date.now() + input.expires_in_days * 86_400_000).toISOString();
  const inv = check(await admin.from('user_invitations').insert({
    organization_id: input.organization_id,
    email: input.email,
    full_name: input.full_name ?? null,
    job_title: input.job_title ?? null,
    token_hash: await sha256Hex(token),
    status: 'pending',
    expires_at,
    link_beneficiary_id: input.link_beneficiary_id ?? null,
    link_expert_id: input.link_expert_id ?? null,
    invited_by: input.invited_by,
  }).select('id').single(), 'user_invitations') as { id: string };

  if (input.role_ids.length) {
    const ins = await admin.from('invitation_roles').insert(input.role_ids.map((role_id) => ({ invitation_id: inv.id, role_id })));
    if (ins.error) {
      await admin.from('user_invitations').delete().eq('id', inv.id);
      check(ins, 'invitation_roles');
    }
  }

  const link = inviteLink(token);
  const mail = accountEmail('invitation', { orgName: input.organization_name, fullName: input.full_name, link, expiresAt: expires_at });
  const sent = await sendEmail({ to: input.email, ...mail });
  if (sent.status === 'failed') console.error('[invitation] email failed', sent.reason);
  return { invitation_id: inv.id, link, expires_at, email_status: emailStatusOf(sent) };
}

/** Rotates the token of a pending invitation (raw tokens are never stored, so a resend needs a new one). */
export async function rotateInvitation(admin: Db, inv: { id: string; organization_id: string; email: string; full_name: string | null }, orgName: string, expiresInDays: number):
  Promise<InvitationOutput> {
  const token = randomToken(32);
  const expires_at = new Date(Date.now() + expiresInDays * 86_400_000).toISOString();
  check(await admin.from('user_invitations').update({ token_hash: await sha256Hex(token), expires_at, status: 'pending' })
    .eq('id', inv.id).eq('organization_id', inv.organization_id), 'user_invitations');
  const link = inviteLink(token);
  const mail = accountEmail('invitation', { orgName, fullName: inv.full_name, link, expiresAt: expires_at });
  const sent = await sendEmail({ to: inv.email, ...mail });
  if (sent.status === 'failed') console.error('[invitation] email failed', sent.reason);
  return { invitation_id: inv.id, link, expires_at, email_status: emailStatusOf(sent) };
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}
