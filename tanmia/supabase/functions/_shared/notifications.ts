// Notification queue helpers shared by several functions.
import type { Db } from './auth.ts';
import { check } from './http.ts';
import { fetchIn } from './bundle.ts';

/** Active members of the organization holding the org_admin role. */
export async function orgAdminUserIds(admin: Db, org: string): Promise<string[]> {
  const roles = check(await admin.from('roles').select('id').eq('organization_id', org).eq('code', 'org_admin').eq('active', true), 'roles') as { id: string }[];
  if (!roles.length) return [];
  const ur = await fetchIn<{ user_id: string }>(admin, 'user_roles', 'role_id', roles.map((r) => r.id), [['organization_id', 'eq', org]], { columns: 'user_id, role_id', key: ['user_id', 'role_id'] });
  const ids = [...new Set(ur.map((r) => r.user_id))];
  if (!ids.length) return [];
  const members = await fetchIn<{ user_id: string }>(admin, 'organization_members', 'user_id', ids, [['organization_id', 'eq', org], ['active', 'eq', true]],
    { columns: 'user_id, organization_id', key: ['user_id'] });
  return [...new Set(members.map((m) => m.user_id))];
}

export interface QueueRow {
  organization_id: string;
  user_id?: string | null;
  recipient_email?: string | null;
  recipient_phone?: string | null;
  channel: 'in_app' | 'email' | 'sms' | 'whatsapp' | 'calendar';
  event_type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  rule_id?: string | null;
  status?: 'queued' | 'scheduled' | 'sent';
  scheduled_for?: string;
  sent_at?: string | null;
  dedupe_key?: string | null;
}

/** Inserts notifications, silently skipping rows whose dedupe_key already exists. Returns inserted count. */
export async function enqueue(admin: Db, rows: QueueRow[]): Promise<number> {
  if (!rows.length) return 0;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const withKey = chunk.filter((r) => r.dedupe_key);
    const noKey = chunk.filter((r) => !r.dedupe_key);
    if (withKey.length) {
      const res = check(await admin.from('notifications').upsert(withKey, { onConflict: 'dedupe_key', ignoreDuplicates: true }).select('id'), 'notifications');
      inserted += (res ?? []).length;
    }
    if (noKey.length) {
      const res = check(await admin.from('notifications').insert(noKey).select('id'), 'notifications');
      inserted += (res ?? []).length;
    }
  }
  return inserted;
}

/** Profiles (email/phone/name) for a set of users. */
export async function profilesOf(admin: Db, userIds: string[]): Promise<Map<string, { email: string | null; phone: string | null; full_name: string | null; preferred_locale: string }>> {
  const rows = userIds.length
    ? await fetchIn<{ id: string; email: string | null; phone: string | null; full_name: string | null; preferred_locale: string }>(admin, 'profiles', 'id', userIds, [],
      { columns: 'id, email, phone, full_name, preferred_locale' })
    : [];
  return new Map(rows.map((r) => [r.id, r]));
}

