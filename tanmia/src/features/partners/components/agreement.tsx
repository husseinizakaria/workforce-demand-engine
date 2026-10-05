import { Badge } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { addDaysISO, todayISO } from '@/utils/dates';
import type { Partner } from '@/types/db';

export type AgreementState = 'none' | 'not_started' | 'valid' | 'expiring' | 'expired' | 'open_ended';

export function agreementState(p: Pick<Partner, 'agreement_start' | 'agreement_end'>, today = todayISO()): AgreementState {
  if (!p.agreement_start && !p.agreement_end) return 'none';
  if (p.agreement_start && p.agreement_start > today) return 'not_started';
  if (!p.agreement_end) return 'open_ended';
  if (p.agreement_end < today) return 'expired';
  if (p.agreement_end <= addDaysISO(today, 60)) return 'expiring';
  return 'valid';
}

export function daysLeft(end: string | null, today = todayISO()): number | null {
  if (!end) return null;
  return Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
}

export function AgreementBadge({ p }: { p: Pick<Partner, 'agreement_start' | 'agreement_end'> }) {
  const { tr } = useI18n();
  const s = agreementState(p);
  const left = daysLeft(p.agreement_end);
  switch (s) {
    case 'none': return <Badge tone="outline">{tr('بلا اتفاقية', 'No agreement')}</Badge>;
    case 'not_started': return <Badge tone="info">{tr('لم تبدأ', 'Not started')}</Badge>;
    case 'open_ended': return <Badge tone="success">{tr('سارية (مفتوحة)', 'Valid (open-ended)')}</Badge>;
    case 'expired': return <Badge tone="danger">{tr('منتهية', 'Expired')}</Badge>;
    case 'expiring': return <Badge tone="warning">{tr(`تنتهي خلال ${left} يومًا`, `Expires in ${left} days`)}</Badge>;
    default: return <Badge tone="success">{tr('سارية', 'Valid')}</Badge>;
  }
}
