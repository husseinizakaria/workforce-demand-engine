import { useEffect, useState } from 'react';
import { list } from '@/services/db';
import { useI18n } from '@/i18n/I18nProvider';
import { useDebounced } from '@/hooks/useAsync';
import type { Option } from './Field';

export type EntityKind = 'beneficiaries' | 'experts' | 'program_teams' | 'vendors' | 'partners' | 'programs' | 'sessions' | 'indicators' | 'program_cohorts';

const LABEL: Record<EntityKind, { select: string; label: (r: Record<string, unknown>) => string; search: string[]; order: string }> = {
  beneficiaries: { select: 'id,code,full_name', label: (r) => `${r.full_name} · ${r.code}`, search: ['full_name', 'code', 'email', 'mobile'], order: 'full_name' },
  experts: { select: 'id,code,full_name', label: (r) => `${r.full_name} · ${r.code}`, search: ['full_name', 'code'], order: 'full_name' },
  program_teams: { select: 'id,code,name', label: (r) => `${r.name} · ${r.code}`, search: ['name', 'code'], order: 'name' },
  vendors: { select: 'id,code,name', label: (r) => `${r.name} · ${r.code}`, search: ['name', 'code'], order: 'name' },
  partners: { select: 'id,code,name', label: (r) => `${r.name} · ${r.code}`, search: ['name', 'code'], order: 'name' },
  programs: { select: 'id,code,name', label: (r) => `${r.name} · ${r.code}`, search: ['name', 'code'], order: 'name' },
  sessions: { select: 'id,code,title,starts_at', label: (r) => `${r.title} · ${r.code}`, search: ['title', 'code'], order: 'starts_at' },
  indicators: { select: 'id,code,name', label: (r) => `${r.code} · ${r.name}`, search: ['name', 'code'], order: 'code' },
  program_cohorts: { select: 'id,code,name', label: (r) => `${r.name} · ${r.code}`, search: ['name', 'code'], order: 'name' },
};

/** Searchable select over an organization table (RLS-scoped). Optional fixed filters, e.g. program_id. */
export function EntityPicker({ kind, value, onChange, organizationId, filters, placeholder, disabled, allowEmpty = true }: {
  kind: EntityKind; value: string | null | undefined; onChange: (id: string | null, label?: string) => void; organizationId: string;
  filters?: [string, 'eq', unknown][]; placeholder?: string; disabled?: boolean; allowEmpty?: boolean;
}) {
  const { tr } = useI18n();
  const [term, setTerm] = useState('');
  const debounced = useDebounced(term, 250);
  const [options, setOptions] = useState<Option[]>([]);
  const cfg = LABEL[kind];
  const filterKey = JSON.stringify(filters ?? []);

  useEffect(() => {
    let alive = true;
    list<Record<string, unknown>>(kind, {
      select: cfg.select, filters: [['organization_id', 'eq', organizationId], ...(filters ?? [])],
      search: debounced ? { columns: cfg.search, term: debounced } : undefined, order: { column: cfg.order, ascending: true }, pageSize: 50,
    }).then(async ({ rows }) => {
      let opts = rows.map((r) => ({ value: String(r.id), label: cfg.label(r) }));
      if (value && !opts.some((o) => o.value === value)) {
        try {
          const cur = await list<Record<string, unknown>>(kind, { select: cfg.select, filters: [['id', 'eq', value]], pageSize: 1 });
          if (cur.rows[0]) opts = [{ value, label: cfg.label(cur.rows[0]) }, ...opts];
        } catch { /* ignore */ }
      }
      if (alive) setOptions(opts);
    }).catch(() => { if (alive) setOptions([]); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, organizationId, debounced, filterKey, value]);

  return (
    <div className="stack-sm" style={{ gap: 4 }}>
      <input className="input" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={tr('ابحث…', 'Search…')} disabled={disabled} aria-label={tr('بحث', 'Search')} />
      <select className="select" value={value ?? ''} disabled={disabled}
        onChange={(e) => onChange(e.target.value || null, options.find((o) => o.value === e.target.value)?.label)}>
        {allowEmpty && <option value="">{placeholder ?? tr('— اختر —', '— Select —')}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
