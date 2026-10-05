// Week calendar (Sun–Sat, 07:00–22:00 Riyadh) of sessions across programs.
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { riyadhParts, riyadhToUtc } from '@engine';
import { Button, Card, CardBody, ErrorState, Select } from '@/components/ui';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { useAsync } from '@/hooks/useAsync';
import { addDaysISO, startOfWeekISO, todayISO } from '@/utils/dates';
import type { Filter } from '@/services/db';
import type { Session } from '@/types/db';
import { isOpenStatus, loadSessionsRange, type OpsRefs } from './ops';

const START_H = 7;
const END_H = 22;
const ROW = 44;

interface Placed { s: Session; day: number; top: number; height: number; lane: number; lanes: number; conflict: boolean; clipped: boolean }

export function CalendarTab({ refs, onOpen, version }: { refs: OpsRefs; onOpen: (id: string) => void; version: number }) {
  const { org } = useOrg();
  const { tr, enumLabel, enumOptions, fmtDate, fmtTime, pick } = useI18n();
  const [week, setWeek] = useState(() => startOfWeekISO(todayISO()));
  const [program, setProgram] = useState('');
  const [expert, setExpert] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const state = useAsync(() => {
    const extra: Filter[] = [];
    if (program) extra.push(['program_id', 'eq', program]);
    if (expert) extra.push(['expert_id', 'eq', expert]);
    if (type) extra.push(['session_type', 'eq', type]);
    if (status) extra.push(['status', 'eq', status]);
    return loadSessionsRange(org.id, riyadhToUtc(week, '00:00'), riyadhToUtc(addDaysISO(week, 7), '00:00'), extra, 2000);
  }, [org.id, week, program, expert, type, status, version]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysISO(week, i)), [week]);
  const placed = useMemo<Placed[]>(() => {
    const rows = state.data ?? [];
    const active = rows.filter((s) => isOpenStatus(s.status));
    const ov = (a: Session, b: Session) => new Date(a.starts_at) < new Date(b.ends_at) && new Date(b.starts_at) < new Date(a.ends_at);
    const conflictIds = new Set<string>();
    for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
      const a = active[i]; const b = active[j];
      const sameExpert = a.expert_id && a.expert_id === b.expert_id;
      const sameLoc = a.location && b.location && a.delivery_mode !== 'online' && b.delivery_mode !== 'online' && a.location.trim().toLowerCase() === b.location.trim().toLowerCase();
      if ((sameExpert || sameLoc) && ov(a, b)) { conflictIds.add(a.id); conflictIds.add(b.id); }
    }
    const out: Placed[] = [];
    for (let d = 0; d < 7; d++) {
      const dayRows = rows.filter((s) => riyadhParts(s.starts_at).date === days[d]).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      const laneEnds: number[] = [];
      const items = dayRows.map((s) => {
        const ps = riyadhParts(s.starts_at);
        const durMin = (new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 60000;
        let startMin = ps.minutes; let endMin = ps.minutes + durMin;
        const clipped = startMin < START_H * 60 || endMin > END_H * 60;
        startMin = Math.max(START_H * 60, Math.min(startMin, END_H * 60 - 15));
        endMin = Math.min(END_H * 60, Math.max(endMin, startMin + 15));
        let lane = laneEnds.findIndex((e) => e <= startMin);
        if (lane < 0) { lane = laneEnds.length; laneEnds.push(endMin); } else laneEnds[lane] = endMin;
        return { s, day: d, top: ((startMin - START_H * 60) / 60) * ROW, height: Math.max(16, ((endMin - startMin) / 60) * ROW - 2), lane, lanes: 1, conflict: conflictIds.has(s.id), clipped };
      });
      for (const it of items) it.lanes = Math.max(1, laneEnds.length);
      out.push(...items);
    }
    return out;
  }, [state.data, days]);

  const hours = Array.from({ length: END_H - START_H }, (_, i) => START_H + i);
  const today = todayISO();
  const total = state.data?.length ?? 0;
  const clipped = placed.filter((p) => p.clipped).length;
  return (
    <Card>
      <CardBody>
        <div className="row wrap between" style={{ marginBottom: 10 }}>
          <div className="row">
            <Button size="sm" iconOnly icon={<ChevronRight />} aria-label={tr('الأسبوع السابق', 'Previous week')} onClick={() => setWeek(addDaysISO(week, -7))} />
            <Button size="sm" onClick={() => setWeek(startOfWeekISO(todayISO()))}>{tr('هذا الأسبوع', 'This week')}</Button>
            <Button size="sm" iconOnly icon={<ChevronLeft />} aria-label={tr('الأسبوع التالي', 'Next week')} onClick={() => setWeek(addDaysISO(week, 7))} />
            <b className="small">{fmtDate(week)} – {fmtDate(addDaysISO(week, 6))}</b>
            <Button size="sm" variant="ghost" iconOnly icon={<RefreshCw />} aria-label={tr('تحديث', 'Refresh')} loading={state.loading} onClick={() => void state.reload()} />
          </div>
          <div className="row wrap">
            <Select options={refs.programs.map((p) => ({ value: p.id, label: pick(p.name, p.name_en) }))} placeholder={tr('كل البرامج', 'All programs')} value={program} onChange={(e) => setProgram(e.target.value)} style={{ width: 170 }} />
            <Select options={refs.experts.map((x) => ({ value: x.id, label: pick(x.full_name, x.full_name_en) }))} placeholder={tr('كل الخبراء', 'All experts')} value={expert} onChange={(e) => setExpert(e.target.value)} style={{ width: 150 }} />
            <Select options={enumOptions('sessionType')} placeholder={tr('كل الأنواع', 'All types')} value={type} onChange={(e) => setType(e.target.value)} style={{ width: 120 }} />
            <Select options={enumOptions('sessionStatus')} placeholder={tr('كل الحالات', 'All statuses')} value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 120 }} />
          </div>
        </div>
        {state.error ? <ErrorState error={state.error} onRetry={state.reload} compact /> : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <div className="calendar" style={{ minWidth: 760 }}>
                <div className="cal-h" />
                {days.map((d, i) => (
                  <div key={d} className="cal-h" style={d === today ? { color: 'var(--primary-dark)', background: 'var(--primary-tint)' } : undefined}>
                    {enumLabel('weekday', String(i))}<div className="tiny muted">{fmtDate(d, { year: undefined })}</div>
                  </div>
                ))}
                {hours.map((h) => (
                  <div key={h} style={{ display: 'contents' }}>
                    <div className="cal-t mono">{String(h).padStart(2, '0')}:00</div>
                    {days.map((d, di) => (
                      <div key={d} className="cal-c">
                        {h === START_H && placed.filter((p) => p.day === di).map((p) => (
                          <div key={p.s.id} role="button" tabIndex={0} className={p.conflict ? 'cal-ev conflict' : 'cal-ev'}
                            onClick={() => onOpen(p.s.id)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(p.s.id); }}
                            title={`${p.s.code} · ${p.s.title}\n${fmtTime(p.s.starts_at)}–${fmtTime(p.s.ends_at)}\n${enumLabel('sessionStatus', p.s.status)}${p.s.expert_id ? `\n${pick(refs.expertMap.get(p.s.expert_id)?.full_name, refs.expertMap.get(p.s.expert_id)?.full_name_en)}` : ''}${p.s.location ? `\n${p.s.location}` : ''}${p.conflict ? `\n⚠ ${tr('تداخل خبير/مكان', 'Expert/location overlap')}` : ''}`}
                            style={{
                              top: p.top, height: p.height, insetInlineStart: `calc(${(p.lane / p.lanes) * 100}% + 2px)`, insetInlineEnd: 'auto', width: `calc(${100 / p.lanes}% - 4px)`,
                              opacity: ['cancelled', 'rescheduled'].includes(p.s.status) ? 0.45 : 1, textDecoration: p.s.status === 'cancelled' ? 'line-through' : undefined,
                              borderInlineStartColor: p.conflict ? undefined : p.s.status === 'completed' ? 'var(--success)' : undefined,
                            }}>
                            <b>{fmtTime(p.s.starts_at)}</b> {p.s.title}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="row wrap small muted" style={{ marginTop: 8, gap: 14 }}>
              <span>{tr(`${total} جلسة هذا الأسبوع`, `${total} sessions this week`)}</span>
              <span className="row" style={{ gap: 4 }}><i className="dot primary" />{tr('مجدولة', 'Scheduled')}</span>
              <span className="row" style={{ gap: 4 }}><i className="dot success" />{tr('مكتملة', 'Completed')}</span>
              <span className="row" style={{ gap: 4 }}><i className="dot danger" />{tr('تداخل خبير أو مكان', 'Expert or location overlap')}</span>
              {clipped > 0 && <span>{tr(`${clipped} جلسة خارج نطاق 07:00–22:00 (معروضة عند الحافة)`, `${clipped} sessions outside 07:00–22:00 (shown at the edge)`)}</span>}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
