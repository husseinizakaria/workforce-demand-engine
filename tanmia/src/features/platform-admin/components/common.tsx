// Shared building blocks for the Platform Super Admin workspace.
// These pages run WITHOUT an OrgProvider, so nothing here may call useOrg().
import { useCallback, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Check, Copy, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { Badge, Button, Input, useToast } from '@/components/ui';
import { type AppError, errorOf } from '@/services/errors';
import type { ModuleKey, PermissionAction, PermissionModule } from '@/types/db';

export const MODULE_KEYS: ModuleKey[] = ['programs', 'beneficiaries', 'experts', 'vendors', 'partners', 'operations', 'assessments',
  'evidence', 'outcomes', 'impact', 'templates', 'reports', 'governance', 'notifications'];
export const PERMISSION_MODULES: PermissionModule[] = [...MODULE_KEYS, 'users'];
export const PERMISSION_ACTIONS: PermissionAction[] = ['view', 'create', 'edit', 'delete', 'approve', 'assign', 'export', 'configure', 'verify'];

export const KEY_PATTERN = /^[a-z][a-z0-9_]{0,59}$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Localized message of an AppError. */
export function useErrText(): (e: AppError | null | undefined) => string {
  const { locale } = useI18n();
  return useCallback((e) => (e ? (locale === 'ar' ? e.message_ar : e.message_en) : ''), [locale]);
}

/** True when an Edge Function is not deployed / not reachable. */
export function isUnavailable(e: unknown): boolean {
  const c = errorOf(e).code;
  return c === 'function_unavailable' || c === '404' || c === 'not_configured';
}

/** Read-only value with a copy button (invitation / setup links shown once). */
export function CopyField({ value, label }: { value: string; label?: ReactNode }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true); setTimeout(() => setDone(false), 1800);
      toast.success(tr('تم النسخ', 'Copied'));
    } catch {
      toast.error(tr('تعذر النسخ تلقائيًا، انسخ الرابط يدويًا', 'Could not copy automatically; copy the link manually'));
    }
  };
  return (
    <div className="stack-sm" style={{ gap: 4 }}>
      {label && <span className="small muted">{label}</span>}
      <div className="row">
        <Input readOnly value={value} dir="ltr" className="grow mono" onFocus={(e) => e.currentTarget.select()} />
        <Button size="sm" icon={done ? <Check /> : <Copy />} onClick={copy}>{tr('نسخ', 'Copy')}</Button>
      </div>
    </div>
  );
}

export function EmailStatusBadge({ status }: { status: string | null | undefined }) {
  const { tr } = useI18n();
  if (!status) return null;
  const map: Record<string, [string, string, 'success' | 'warning' | 'danger' | 'neutral']> = {
    sent: ['أُرسل البريد', 'Email sent', 'success'],
    not_configured: ['البريد غير مهيأ — شارك الرابط يدويًا', 'Email not configured — share the link manually', 'warning'],
    failed: ['فشل إرسال البريد — شارك الرابط يدويًا', 'Email failed — share the link manually', 'danger'],
    skipped: ['لم يُرسل بريد', 'No email sent', 'neutral'],
  };
  const m = map[status];
  return <Badge tone={m?.[2] ?? 'neutral'}>{m ? tr(m[0], m[1]) : status}</Badge>;
}

/** Status of a server-side provider probe. */
export type ProbeState = 'loading' | 'configured' | 'not_configured' | 'unavailable' | 'error';
export function ProbeBadge({ state }: { state: ProbeState }) {
  const { tr } = useI18n();
  switch (state) {
    case 'loading': return <Badge>{tr('جارٍ الفحص…', 'Checking…')}</Badge>;
    case 'configured': return <Badge tone="success">{tr('مهيأ', 'Configured')}</Badge>;
    case 'not_configured': return <Badge tone="warning">{tr('غير مهيأ', 'Not configured')}</Badge>;
    case 'unavailable': return <Badge tone="danger">{tr('الدالة غير منشورة', 'Function not deployed')}</Badge>;
    default: return <Badge tone="danger">{tr('تعذر الفحص', 'Check failed')}</Badge>;
  }
}

/** Editable ordered list of strings (Theory of Change items, report sections…). */
export function StringListEditor({ value, onChange, placeholder, addLabel, dir }: {
  value: string[]; onChange: (v: string[]) => void; placeholder?: string; addLabel?: string; dir?: 'ltr' | 'rtl';
}) {
  const { tr } = useI18n();
  const set = (i: number, v: string) => onChange(value.map((x, j) => (j === i ? v : x)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d; if (j < 0 || j >= value.length) return;
    const next = [...value]; [next[i], next[j]] = [next[j], next[i]]; onChange(next);
  };
  return (
    <div className="stack-sm" style={{ gap: 6 }}>
      {value.map((v, i) => (
        <div key={i} className="row">
          <span className="tiny muted mono" style={{ width: 18 }}>{i + 1}</span>
          <Input className="grow" value={v} dir={dir} placeholder={placeholder} onChange={(e) => set(i, e.target.value)} />
          <Button size="sm" variant="ghost" iconOnly icon={<ArrowUp />} disabled={i === 0} onClick={() => move(i, -1)} aria-label={tr('أعلى', 'Up')} />
          <Button size="sm" variant="ghost" iconOnly icon={<ArrowDown />} disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label={tr('أسفل', 'Down')} />
          <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={tr('حذف', 'Remove')} />
        </div>
      ))}
      <div><Button size="sm" variant="ghost" icon={<Plus />} onClick={() => onChange([...value, ''])}>{addLabel ?? tr('إضافة بند', 'Add item')}</Button></div>
    </div>
  );
}

/** Compact JSON value rendering for audit diffs. */
export function jsonText(v: unknown): string {
  if (v === undefined) return '';
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v, null, 1); } catch { return String(v); }
}

export function JsonDiff({ oldData, newData }: { oldData: Record<string, unknown> | null; newData: Record<string, unknown> | null }) {
  const { tr } = useI18n();
  const keys = [...new Set([...Object.keys(oldData ?? {}), ...Object.keys(newData ?? {})])].sort();
  if (!keys.length) return <p className="small muted">{tr('لا توجد بيانات تفصيلية لهذا الحدث.', 'No detailed data for this event.')}</p>;
  const cell = { whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const, maxWidth: 320 };
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>{tr('الحقل', 'Field')}</th><th>{tr('القيمة السابقة', 'Old value')}</th><th>{tr('القيمة الجديدة', 'New value')}</th></tr></thead>
        <tbody>
          {keys.map((k) => {
            const o = oldData ? oldData[k] : undefined; const n = newData ? newData[k] : undefined;
            const changed = JSON.stringify(o) !== JSON.stringify(n);
            return (
              <tr key={k}>
                <td className="mono">{k}{changed && oldData && newData && <> <Badge tone="warning">{tr('تغيّر', 'changed')}</Badge></>}</td>
                <td className="mono tiny" style={cell}>{oldData ? jsonText(o) : '—'}</td>
                <td className="mono tiny" style={cell}>{newData ? jsonText(n) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Pre-formatted command / snippet block (no new CSS: inline layout only). */
export function CodeBlock({ children }: { children: string }) {
  const { tr } = useI18n();
  const toast = useToast();
  return (
    <div className="card" style={{ position: 'relative', background: 'var(--bg)' }}>
      <pre className="mono" style={{ margin: 0, padding: '10px 12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12 }}>{children}</pre>
      <div style={{ position: 'absolute', top: 4, insetInlineEnd: 4 }}>
        <Button size="sm" variant="ghost" iconOnly icon={<Copy />} aria-label={tr('نسخ', 'Copy')}
          onClick={() => { void navigator.clipboard.writeText(children).then(() => toast.success(tr('تم النسخ', 'Copied')), () => toast.error(tr('تعذر النسخ', 'Copy failed'))); }} />
      </div>
    </div>
  );
}

/** Find duplicated keys in a list. */
export function duplicates(keys: string[]): string[] {
  const seen = new Set<string>(); const dup = new Set<string>();
  for (const k of keys) { if (seen.has(k)) dup.add(k); seen.add(k); }
  return [...dup];
}

/** Turn free text into a safe snake_case key. */
export function toKey(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^([0-9])/, 'k_$1').slice(0, 60);
}
