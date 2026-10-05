import type { ReactNode } from 'react';
import { cx } from '@/utils/cx';

export function Kpi({ label, value, hint, icon, tone }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'danger' | 'warning' | 'success' | 'primary' }) {
  return (
    <div className={cx('card kpi', tone && `tone-${tone}`)}>
      <span className="label">{icon}{label}</span>
      <span className="value">{value}</span>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Progress({ value, tone, large, label }: { value: number | null | undefined; tone?: 'success' | 'warning' | 'danger'; large?: boolean; label?: string }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className={cx('progress', tone, large && 'lg')} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <i style={{ width: `${v}%` }} />
    </div>
  );
}

export function ScoreRing({ value, tone }: { value: number | null; tone?: 'danger' | 'warning' | 'success' }) {
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'warning' ? 'var(--warning)' : tone === 'success' ? 'var(--success)' : 'var(--primary)';
  return (
    <div className="score-ring" style={{ ['--v' as string]: value ?? 0, ['--ring' as string]: color }} aria-label={`${value ?? '—'}/100`}>
      <b>{value ?? '—'}</b>
    </div>
  );
}

export function scoreTone(v: number | null | undefined): 'danger' | 'warning' | 'success' | undefined {
  if (v === null || v === undefined) return undefined;
  return v < 50 ? 'danger' : v < 75 ? 'warning' : 'success';
}
