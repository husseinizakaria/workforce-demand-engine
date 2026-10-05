// Cross-tenant data loaders for the platform workspace. The platform super
// admin passes RLS on every table, so these queries intentionally span all
// organizations (the only place in the app where that is correct).
import * as db from '@/services/db';
import type { Organization, OrganizationMember, Profile, Role, UserRole } from '@/types/db';

export interface OrgStat {
  org: Organization;
  members: number;
  activeMembers: number;
  admins: number;          // active members holding the org_admin role
  programs: number;
  activePrograms: number;
  pendingInvites: number;
  expiredInvites: number;  // still 'pending' but past expires_at
  openHighInsights: number;
}

type MemberLite = Pick<OrganizationMember, 'organization_id' | 'user_id' | 'active'>;
type ProgramLite = { organization_id: string; status: string };
type InviteLite = { organization_id: string; status: string; expires_at: string };
type InsightLite = { organization_id: string; severity: string };
type AdminRoleLite = { organization_id: string; user_id: string; role: { code: string } | null };

export async function loadOrgStats(): Promise<OrgStat[]> {
  const [orgs, members, programs, invites, insights, adminRoles] = await Promise.all([
    db.all<Organization>('organizations', { order: { column: 'created_at', ascending: false } }),
    db.all<MemberLite>('organization_members', { select: 'organization_id,user_id,active', order: { column: 'joined_at' } }),
    db.all<ProgramLite>('programs', { select: 'organization_id,status' }),
    db.all<InviteLite>('user_invitations', { select: 'organization_id,status,expires_at', filters: [['status', 'eq', 'pending']] }),
    db.all<InsightLite>('ai_insights', { select: 'organization_id,severity', filters: [['status', 'eq', 'open'], ['severity', 'in', ['high', 'critical']]] }),
    db.all<AdminRoleLite>('user_roles', { select: 'organization_id,user_id,role:roles!inner(code)', filters: [['role.code', 'eq', 'org_admin']] }),
  ]);
  const now = Date.now();
  const activeByOrg = new Map<string, Set<string>>();
  for (const m of members) if (m.active) {
    if (!activeByOrg.has(m.organization_id)) activeByOrg.set(m.organization_id, new Set());
    activeByOrg.get(m.organization_id)!.add(m.user_id);
  }
  return orgs.map((org) => {
    const mem = members.filter((m) => m.organization_id === org.id);
    const act = activeByOrg.get(org.id) ?? new Set<string>();
    const prg = programs.filter((p) => p.organization_id === org.id);
    const inv = invites.filter((i) => i.organization_id === org.id);
    return {
      org,
      members: mem.length,
      activeMembers: act.size,
      admins: new Set(adminRoles.filter((r) => r.organization_id === org.id && act.has(r.user_id)).map((r) => r.user_id)).size,
      programs: prg.length,
      activePrograms: prg.filter((p) => p.status === 'active').length,
      pendingInvites: inv.filter((i) => new Date(i.expires_at).getTime() >= now).length,
      expiredInvites: inv.filter((i) => new Date(i.expires_at).getTime() < now).length,
      openHighInsights: insights.filter((i) => i.organization_id === org.id).length,
    };
  });
}

export interface OrgMemberRow extends OrganizationMember {
  profile: Profile | null;
  roles: Pick<Role, 'id' | 'code' | 'name_ar' | 'name_en'>[];
}

export async function loadOrgMembers(orgId: string): Promise<OrgMemberRow[]> {
  const [members, roles] = await Promise.all([
    db.all<OrganizationMember>('organization_members', { filters: [['organization_id', 'eq', orgId]], order: { column: 'joined_at' } }),
    db.all<UserRole & { role: Pick<Role, 'id' | 'code' | 'name_ar' | 'name_en'> | null }>('user_roles', {
      select: 'organization_id,user_id,role_id,created_at,role:roles(id,code,name_ar,name_en)', filters: [['organization_id', 'eq', orgId]],
    }),
  ]);
  const profiles = await loadProfiles(members.map((m) => m.user_id));
  return members.map((m) => ({
    ...m,
    profile: profiles.get(m.user_id) ?? null,
    roles: roles.filter((r) => r.user_id === m.user_id && r.role).map((r) => r.role!),
  }));
}

/** Profiles by id, fetched in chunks (URL length safety). */
export async function loadProfiles(ids: string[]): Promise<Map<string, Profile>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, Profile>();
  for (let i = 0; i < uniq.length; i += 150) {
    const rows = await db.all<Profile>('profiles', { filters: [['id', 'in', uniq.slice(i, i + 150)]] });
    for (const p of rows) out.set(p.id, p);
  }
  return out;
}

export async function loadOrgOptions(): Promise<Pick<Organization, 'id' | 'code' | 'name' | 'name_en' | 'status'>[]> {
  return db.all('organizations', { select: 'id,code,name,name_en,status', order: { column: 'name', ascending: true } });
}
