import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDownUp, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { downloadCSV, type CsvValue } from '@/utils/csv';
import { cx } from '@/utils/cx';
import { Button } from './Button';
import { EmptyState, ErrorState, Loading } from './States';
import type { AppError } from '@/services/errors';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  value?: (row: T) => CsvValue;      // used for sorting, client search and CSV export
  sortable?: boolean;
  align?: 'start' | 'end';
  width?: number | string;
  hideInExport?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: AppError | null;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  empty?: { title: string; description?: string; action?: ReactNode };
  toolbar?: ReactNode;
  searchable?: boolean;               // client-side search over value()
  search?: { value: string; onChange: (v: string) => void; placeholder?: string }; // server-side search
  pageSize?: number;                  // client-side paging
  server?: { page: number; pageSize: number; total: number | null; onPage: (p: number) => void };
  exportName?: string;
  dense?: boolean;
}

export function DataTable<T>(p: DataTableProps<T>) {
  const { tr, fmtNumber } = useI18n();
  const [sort, setSort] = useState<{ key: string; asc: boolean } | null>(null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const valueOf = (c: Column<T>, r: T): CsvValue => (c.value ? c.value(r) : (r as Record<string, unknown>)[c.key] as CsvValue);

  const filtered = useMemo(() => {
    let rows = p.rows;
    if (p.searchable && q.trim()) {
      const needle = q.trim().toLowerCase();
      rows = rows.filter((r) => p.columns.some((c) => String(valueOf(c, r) ?? '').toLowerCase().includes(needle)));
    }
    if (sort) {
      const col = p.columns.find((c) => c.key === sort.key);
      if (col) rows = [...rows].sort((a, b) => {
        const va = valueOf(col, a); const vb = valueOf(col, b);
        if (va === vb) return 0;
        if (va === null || va === undefined) return 1;
        if (vb === null || vb === undefined) return -1;
        const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'ar');
        return sort.asc ? cmp : -cmp;
      });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.rows, q, sort, p.searchable]);

  const size = p.pageSize ?? 25;
  const clientPaged = !p.server && filtered.length > size;
  const visible = clientPaged ? filtered.slice(page * size, page * size + size) : filtered;
  const pages = clientPaged ? Math.ceil(filtered.length / size) : 0;

  const exportCsv = () => {
    const cols = p.columns.filter((c) => !c.hideInExport);
    downloadCSV(p.exportName ?? 'export', cols.map((c) => c.header), filtered.map((r) => cols.map((c) => valueOf(c, r))));
  };

  const showToolbar = p.toolbar || p.searchable || p.search || p.exportName;
  return (
    <div>
      {showToolbar && (
        <div className="table-toolbar">
          {(p.searchable || p.search) && (
            <div style={{ position: 'relative' }}>
              <input className="input" style={{ paddingInlineStart: 30 }} value={p.search ? p.search.value : q}
                onChange={(e) => { if (p.search) p.search.onChange(e.target.value); else { setQ(e.target.value); setPage(0); } }}
                placeholder={p.search?.placeholder ?? tr('بحث…', 'Search…')} aria-label={tr('بحث', 'Search')} />
              <Search size={15} style={{ position: 'absolute', insetInlineStart: 9, top: 9, color: 'var(--text-2)' }} />
            </div>
          )}
          <div className="row grow wrap">{p.toolbar}</div>
          {p.exportName && <Button size="sm" icon={<Download />} onClick={exportCsv} disabled={!filtered.length}>{tr('تصدير CSV', 'Export CSV')}</Button>}
        </div>
      )}
      {p.error ? <ErrorState error={p.error} onRetry={p.onRetry} compact /> : p.loading && !p.rows.length ? <Loading /> : !filtered.length ? (
        <EmptyState compact title={p.empty?.title ?? tr('لا توجد سجلات', 'No records')} description={p.empty?.description} action={p.empty?.action} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {p.columns.map((c) => (
                  <th key={c.key} className={cx(c.align === 'end' && 'num')} style={{ width: c.width }}>
                    {c.sortable ? (
                      <button type="button" onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, asc: !s.asc } : { key: c.key, asc: true }))}>
                        {c.header}<ArrowDownUp size={12} aria-hidden />
                      </button>
                    ) : c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={p.rowKey(r)} className={cx(p.onRowClick && 'clickable')} onClick={p.onRowClick ? () => p.onRowClick!(r) : undefined}
                  tabIndex={p.onRowClick ? 0 : undefined} onKeyDown={p.onRowClick ? (e) => { if (e.key === 'Enter') p.onRowClick!(r); } : undefined}>
                  {p.columns.map((c) => (
                    <td key={c.key} className={cx(c.align === 'end' && 'num')}>{c.render ? c.render(r) : String(valueOf(c, r) ?? '—')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {clientPaged && (
        <div className="pager">
          <span>{fmtNumber(filtered.length)} {tr('سجل', 'records')}</span>
          <div className="row">
            <Button size="sm" iconOnly icon={<ChevronRight />} disabled={page === 0} onClick={() => setPage(page - 1)} aria-label={tr('السابق', 'Previous')} />
            <span>{page + 1} / {pages}</span>
            <Button size="sm" iconOnly icon={<ChevronLeft />} disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label={tr('التالي', 'Next')} />
          </div>
        </div>
      )}
      {p.server && (p.server.total ?? 0) > p.server.pageSize && (
        <div className="pager">
          <span>{fmtNumber(p.server.total)} {tr('سجل', 'records')}</span>
          <div className="row">
            <Button size="sm" iconOnly icon={<ChevronRight />} disabled={p.server.page === 0} onClick={() => p.server!.onPage(p.server!.page - 1)} aria-label={tr('السابق', 'Previous')} />
            <span>{p.server.page + 1} / {Math.ceil((p.server.total ?? 0) / p.server.pageSize)}</span>
            <Button size="sm" iconOnly icon={<ChevronLeft />} disabled={(p.server.page + 1) * p.server.pageSize >= (p.server.total ?? 0)} onClick={() => p.server!.onPage(p.server!.page + 1)} aria-label={tr('التالي', 'Next')} />
          </div>
        </div>
      )}
    </div>
  );
}
