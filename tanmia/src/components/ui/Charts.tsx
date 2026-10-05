// Dependency-free charts (SVG/CSS) for dashboards. Values are labelled
// directly so the charts remain readable when printed.
import type { ReactNode } from 'react';
import { Progress } from './Kpi';
import { useI18n } from '@/i18n/I18nProvider';

export function BarList({ items, max, format }: { items: { label: ReactNode; value: number; tone?: 'success' | 'warning' | 'danger' }[]; max?: number; format?: (v: number) => string }) {
  const m = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="barlist">
      {items.map((i, idx) => (
        <div key={idx} className="bl-row">
          <span className="ellipsis">{i.label}</span>
          <Progress value={(i.value / m) * 100} tone={i.tone} />
          <span className="bl-val">{format ? format(i.value) : i.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Vertical grouped columns, e.g. before/after per dimension. */
export function ColumnChart({ categories, series, max, height = 160 }: {
  categories: string[]; series: { name: string; values: (number | null)[]; color: string }[]; max: number; height?: number;
}) {
  const { dir } = useI18n();
  const groupW = 56; const barW = Math.max(8, Math.floor((groupW - 12) / Math.max(1, series.length)));
  const width = Math.max(240, categories.length * groupW + 20);
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={width} height={height + 46} role="img" style={{ display: 'block', direction: 'ltr' }}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={20} x2={width} y1={10 + height * (1 - f)} y2={10 + height * (1 - f)} stroke="#E1E5E1" />
            <text x={0} y={14 + height * (1 - f)} fontSize={10} fill="#6D7471">{Math.round(max * f * 10) / 10}</text>
          </g>
        ))}
        {(dir === 'rtl' ? [...categories].reverse() : categories).map((c, ci) => {
          const idx = dir === 'rtl' ? categories.length - 1 - ci : ci;
          return (
            <g key={c} transform={`translate(${24 + ci * groupW},0)`}>
              {series.map((s, si) => {
                const v = s.values[idx];
                const h = v === null ? 0 : (Math.max(0, v) / max) * height;
                return (
                  <g key={s.name}>
                    <rect x={si * barW} y={10 + height - h} width={barW - 2} height={h} fill={s.color} rx={2}><title>{`${s.name}: ${v ?? '—'}`}</title></rect>
                    {v !== null && <text x={si * barW + (barW - 2) / 2} y={6 + height - h} fontSize={9} textAnchor="middle" fill="#303634">{v}</text>}
                  </g>
                );
              })}
              <text x={(barW * series.length) / 2} y={height + 24} fontSize={10.5} textAnchor="middle" fill="#303634">{c.length > 11 ? c.slice(0, 10) + '…' : c}<title>{c}</title></text>
            </g>
          );
        })}
      </svg>
      <div className="row wrap small" style={{ gap: 12 }}>
        {series.map((s) => <span key={s.name} className="row" style={{ gap: 5 }}><i className="dot" style={{ background: s.color }} />{s.name}</span>)}
      </div>
    </div>
  );
}

/** Heatmap: rows × columns of numeric values on a 0..max scale. */
export function Heatmap({ rows, columns, values, max, format }: { rows: string[]; columns: string[]; values: (number | null)[][]; max: number; format?: (v: number) => string }) {
  const color = (v: number | null) => {
    if (v === null) return '#F1F2EF';
    const t = Math.max(0, Math.min(1, v / max));
    const a = 0.12 + t * 0.78;
    return `rgba(40, 125, 120, ${a.toFixed(2)})`;
  };
  return (
    <div className="heatmap" style={{ gridTemplateColumns: `minmax(110px, 1.4fr) repeat(${columns.length}, minmax(44px, 1fr))` }}>
      <div />
      {columns.map((c) => <div key={c} className="hm-head">{c}</div>)}
      {rows.map((r, ri) => (
        <div key={r} style={{ display: 'contents' }}>
          <div className="hm-row ellipsis" title={r}>{r}</div>
          {columns.map((c, ci) => {
            const v = values[ri]?.[ci] ?? null;
            return <div key={c} className="hm-cell" style={{ background: color(v), color: v !== null && v / max > 0.6 ? '#fff' : 'var(--text)' }}>{v === null ? '—' : format ? format(v) : v}</div>;
          })}
        </div>
      ))}
    </div>
  );
}

export function Distribution({ levels, total }: { levels: Record<number, number>; total: number }) {
  const keys = Object.keys(levels).map(Number).sort((a, b) => a - b);
  const shades = ['#E3E7E3', '#BFD9D6', '#8CBFBA', '#4F9C96', '#287D78', '#1D5F5B'];
  return (
    <div>
      <div style={{ display: 'flex', height: 18, borderRadius: 4, overflow: 'hidden', background: '#EEF0EC' }}>
        {keys.map((k, i) => {
          const n = levels[k] ?? 0;
          return n ? <div key={k} title={`L${k}: ${n}`} style={{ width: `${(n / Math.max(1, total)) * 100}%`, background: shades[Math.min(i + 1, shades.length - 1)] }} /> : null;
        })}
      </div>
      <div className="row wrap tiny muted" style={{ gap: 10, marginTop: 4 }}>
        {keys.map((k, i) => <span key={k} className="row" style={{ gap: 4 }}><i className="dot" style={{ background: shades[Math.min(i + 1, shades.length - 1)] }} />L{k}: {levels[k] ?? 0}</span>)}
      </div>
    </div>
  );
}
