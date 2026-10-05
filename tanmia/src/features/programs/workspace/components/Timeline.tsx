// Compact Gantt-style timeline: program period and stage planned dates with a
// "today" marker. Uses logical insets so it reads correctly in RTL and LTR.
import { useI18n } from '@/i18n/I18nProvider';
import type { Program, ProgramStage } from '@/types/db';

const DAY = 86400000;
const t = (d: string) => new Date(d + 'T00:00:00Z').getTime();

export function Timeline({ program, stages }: { program: Program; stages: ProgramStage[] }) {
  const { tr, pick, fmtDate } = useI18n();
  const dates = [program.start_date, program.end_date, ...stages.flatMap((s) => [s.planned_start, s.planned_end])].filter((x): x is string => !!x);
  if (dates.length < 2) {
    return <p className="small muted">{tr('أدخل تواريخ البرنامج والتواريخ المخططة للمراحل لعرض الخط الزمني.', 'Set program dates and stage planned dates to see the timeline.')}</p>;
  }
  const min = Math.min(...dates.map(t)); const max = Math.max(...dates.map(t)) + DAY;
  const span = Math.max(DAY, max - min);
  const pos = (d: string) => ((t(d) - min) / span) * 100;
  const today = Date.now();
  const todayPos = today >= min && today <= max ? ((today - min) / span) * 100 : null;
  const color = (s: ProgramStage) => (s.status === 'completed' || s.status === 'skipped' ? 'var(--primary)' : s.status === 'blocked' ? 'var(--danger)'
    : s.status === 'in_progress' ? 'var(--primary-soft)' : 'var(--neutral-soft)');
  const rows: { key: string; label: string; start: string | null; end: string | null; bg: string; border?: string; strong?: boolean }[] = [
    { key: 'program', label: tr('البرنامج', 'Program'), start: program.start_date, end: program.end_date, bg: 'var(--info-soft)', border: 'var(--info)', strong: true },
    ...stages.map((s) => ({ key: s.id, label: pick(s.name_ar, s.name_en), start: s.planned_start, end: s.planned_end, bg: color(s), border: s.status === 'in_progress' ? 'var(--primary)' : undefined })),
  ];
  return (
    <div className="stack-sm" style={{ gap: 4 }}>
      <div className="row between tiny muted"><span>{fmtDate(new Date(min))}</span><span>{fmtDate(new Date(max - DAY))}</span></div>
      {rows.map((r) => (
        <div key={r.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 26%) 1fr', gap: 8, alignItems: 'center' }}>
          <span className={r.strong ? 'small strong ellipsis' : 'small ellipsis'} title={r.label}>{r.label}</span>
          <div style={{ position: 'relative', height: 14, background: 'var(--bg)', borderRadius: 3 }}>
            {todayPos !== null && <span style={{ position: 'absolute', insetInlineStart: `${todayPos}%`, top: -2, bottom: -2, width: 2, background: 'var(--warning)' }} title={tr('اليوم', 'Today')} />}
            {r.start && r.end ? (
              <span title={`${fmtDate(r.start)} – ${fmtDate(r.end)}`} style={{
                position: 'absolute', insetInlineStart: `${pos(r.start)}%`, width: `${Math.max(1, ((t(r.end) + DAY - t(r.start)) / span) * 100)}%`,
                top: 2, bottom: 2, background: r.bg, borderRadius: 3, border: r.border ? `1px solid ${r.border}` : undefined,
              }} />
            ) : <span className="tiny muted" style={{ position: 'absolute', insetInlineStart: 4, top: -1 }}>{tr('غير مخطط', 'Not planned')}</span>}
          </div>
        </div>
      ))}
      <div className="row wrap tiny muted" style={{ gap: 12 }}>
        <span className="row" style={{ gap: 4 }}><i className="dot warning" />{tr('اليوم', 'Today')}</span>
        <span className="row" style={{ gap: 4 }}><i className="dot primary" />{tr('مكتملة', 'Completed')}</span>
        <span className="row" style={{ gap: 4 }}><i className="dot danger" />{tr('متوقفة', 'Blocked')}</span>
      </div>
    </div>
  );
}
