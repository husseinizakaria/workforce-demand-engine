// Helpers shared by the governance tabs (members, programs, error messages).
import { useState } from 'react';
import { Copy } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAuth } from '@/app/AuthProvider';
import { Button, Input, Notice, useToast, type Option } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { all } from '@/services/db';
import { errorOf } from '@/services/errors';
import type { OrganizationMember, Profile, Program } from '@/types/db';

export const UNAVAILABLE = new Set(['function_unavailable', 'not_configured', '404']);

export interface Member {
  user_id: string; active: boolean; title: string | null; joined_at: string;
  full_name: string | null; email: string | null; job_title: string | null; last_login_at: string | null;
}

/** Organization members with profile data. Without users.view only the caller's own row is visible (RLS). */
export function useMembers() {
  const { org } = useOrg();
  const { user, access } = useAuth();
  return useAsync<Member[]>(async () => {
    let members: OrganizationMember[] = [];
    try { members = await all<OrganizationMember>('organization_members', { filters: [['organization_id', 'eq', org.id]], order: { column: 'joined_at', ascending: true } }); }
    catch { members = []; }
    const ids = members.map((m) => m.user_id);
    const profiles = ids.length ? await all<Profile>('profiles', { filters: [['id', 'in', ids]], order: { column: 'full_name', ascending: true } }).catch(() => [] as Profile[]) : [];
    const pmap = new Map(profiles.map((p) => [p.id, p]));
    const out: Member[] = members.map((m) => {
      const p = pmap.get(m.user_id);
      return { user_id: m.user_id, active: m.active, title: m.title, joined_at: m.joined_at, full_name: p?.full_name ?? null, email: p?.email ?? null, job_title: p?.job_title ?? null, last_login_at: p?.last_login_at ?? null };
    });
    if (user && !out.some((m) => m.user_id === user.id)) {
      out.push({ user_id: user.id, active: true, title: null, joined_at: '', full_name: access?.profile?.full_name ?? null, email: user.email ?? null, job_title: null, last_login_at: null });
    }
    return out.sort((a, b) => (a.full_name ?? a.email ?? '').localeCompare(b.full_name ?? b.email ?? '', 'ar'));
  }, [org.id, user?.id]);
}

export const memberLabel = (m: Member | undefined): string => (m ? m.full_name || m.email || m.user_id.slice(0, 8) : '—');
export const memberOptions = (ms: Member[] | undefined): Option[] => (ms ?? []).filter((m) => m.active).map((m) => ({ value: m.user_id, label: `${memberLabel(m)}${m.email && m.full_name ? ` · ${m.email}` : ''}` }));

export type ProgMin = Pick<Program, 'id' | 'code' | 'name' | 'name_en' | 'status' | 'budget_total' | 'currency' | 'start_date' | 'end_date'>;
export function usePrograms() {
  const { org } = useOrg();
  return useAsync<ProgMin[]>(() => all<Program>('programs', {
    select: 'id,code,name,name_en,status,budget_total,currency,start_date,end_date', filters: [['organization_id', 'eq', org.id]], order: { column: 'name', ascending: true },
  }).catch(() => [] as Program[]), [org.id]);
}

export function useErrMsg() {
  const { locale } = useI18n();
  return (e: unknown) => { const ae = errorOf(e); return locale === 'ar' ? ae.message_ar : ae.message_en; };
}

/** One-time secret display (invitation link, calendar feed URL). */
export function ShowOnce({ value, note }: { value: string; note: string }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <div className="stack-sm">
      <Notice tone="warning">{note}</Notice>
      <div className="row">
        <Input readOnly value={value} dir="ltr" onFocus={(e) => e.currentTarget.select()} aria-label={tr('الرابط', 'Link')} />
        <Button icon={<Copy />} onClick={async () => {
          try { await navigator.clipboard.writeText(value); setCopied(true); toast.success(tr('تم النسخ', 'Copied')); }
          catch { toast.error(tr('تعذر النسخ؛ انسخ الرابط يدويًا', 'Could not copy; copy the link manually')); }
        }}>{copied ? tr('نُسخ', 'Copied') : tr('نسخ', 'Copy')}</Button>
      </div>
    </div>
  );
}
