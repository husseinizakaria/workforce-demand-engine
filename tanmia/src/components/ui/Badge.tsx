import type { ReactNode } from 'react';
import { cx } from '@/utils/cx';
import { useI18n } from '@/i18n/I18nProvider';
import type { EnumGroup } from '@/i18n/enums';

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'outline';

export function Badge({ tone = 'neutral', children, icon, title }: { tone?: Tone; children: ReactNode; icon?: ReactNode; title?: string }) {
  return <span className={cx('badge', tone !== 'neutral' && tone)} title={title}>{icon}{children}</span>;
}

const TONES: Record<string, Tone> = {
  active: 'success', completed: 'success', achieved: 'success', verified: 'success', approved: 'success', accepted: 'success', done: 'success',
  graduated: 'success', present: 'success', published: 'success', issued: 'success', on_track: 'success', delivered: 'success', sent: 'success', resolved: 'success',
  in_progress: 'primary', scheduled: 'primary', confirmed: 'primary', generated: 'primary', planning: 'primary', shortlisted: 'primary', eligible: 'primary',
  mitigating: 'primary', contracted: 'primary', delivering: 'primary', submitted: 'info', screening: 'info', in_review: 'info', reviewed: 'info',
  pending: 'warning', at_risk: 'warning', late: 'warning', on_hold: 'warning', waitlisted: 'warning', needs_info: 'warning', partially_achieved: 'warning',
  pending_approval: 'warning', not_requested: 'warning', proposed: 'info', queued: 'info', escalated: 'danger', medium: 'warning',
  blocked: 'danger', rejected: 'danger', cancelled: 'neutral', failed: 'danger', absent: 'danger', off_track: 'danger', not_achieved: 'danger',
  missed: 'danger', dropped: 'danger', ineligible: 'danger', suspended: 'danger', terminated: 'danger', critical: 'danger', high: 'danger',
  low: 'info', info: 'primary', open: 'warning', draft: 'neutral', not_started: 'neutral', unknown: 'neutral', archived: 'neutral', inactive: 'neutral',
};

export function toneOf(value: string | null | undefined): Tone { return (value && TONES[value]) || 'neutral'; }

export function StatusBadge({ group, value }: { group: EnumGroup; value: string | null | undefined }) {
  const { enumLabel } = useI18n();
  if (!value) return <span className="muted">—</span>;
  return <Badge tone={toneOf(value)}>{enumLabel(group, value)}</Badge>;
}
