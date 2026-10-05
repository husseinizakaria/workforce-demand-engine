import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Badge, Button, Card, CardBody, DataTable, Input, Notice, Select, StatusBadge, type Column } from '@/components/ui';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { all, list, type Filter } from '@/services/db';
import { downloadCSV } from '@/utils/csv';
import { riyadhToUtc } from '@engine';
import { addDaysISO } from '@/utils/dates';
import type { Session, SessionParticipant } from '@/types/db';
import { allIn, errMsg } from '@/features/beneficiaries/components/dataUtils';
import type { OpsRefs } from './ops';

const PAGE = 50;

export function SessionsListTab({ refs, onOpen, version }: { refs: OpsRefs; onOpen: (id: string) => void; version: number }) {
  const { org, can } = useOrg();
  const { tr, pick, enumLabel, enumOptions, fmtDateTime, fmtTime, locale } = useI18n();
  const [page, setPage] = useState(0);
  const [term, setTerm] = useState('');
  const [program, setProgram] = useState('');
  const [expert, setExpert] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const q = useDebounced(term, 300);

  const filters = useMemo<Filter[]>(() => {
    const f: Filter[] = [['organization_id', 'eq', org.id]];
    if (program) f.push(['program_id', 'eq', program]);
    if (expert) f.push(['expert_id', 'eq', expert]);
    if (type) f.push(['session_type', 'eq', type]);
    if (status) f.push(['status', 'eq', status]);
    if (from) f.push(['starts_at', 'gte', riyadhToUtc(from, '00:00')]);
    if (to) f.push(['starts_at', 'lt', riyadhToUtc(addDaysISO(to, 1), '00:00')]);
    return f;
  }, [org.id, program, expert, type, status, from, to]);
  const search = q ? { columns: ['title', 'code', 'location'], term: q } : undefined;
  const state = useAsync(async () => {
    const res = await list<Session>('sessions', { filters, search, order: { column: 'starts_at', ascending: false }, page, pageSize: PAGE, count: true });
    const parts = await allIn<Pick<SessionParticipant, 'session_id' | 'attendance_status'>>('session_participants', 'session_id', res.rows.map((r) => r.id), { select: 'session_id,attendance_status' }).catch(() => []);
    const counts = new Map<string, { n: number; recorded: number }>();
    for (const p of parts) { const c = counts.get(p.session_id) ?? { n: 0, recorded: 0 }; c.n++; if (p.attendance_status !== 'unknown') c.recorded++; counts.set(p.session_id, c); }
    return { ...res, counts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, q, page, version]);
  const reset = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(0); };
  const pn = (id: string | null) => (id ? pick(refs.programMap.get(id)?.name, refs.programMap.get(id)?.name_en) || '—' : '—');
  const en = (id: string | null) => (id ? pick(refs.expertMap.get(id)?.full_name, refs.expertMap.get(id)?.full_name_en) || '—' : '—');

  const exportAll = async () => {
    setExporting(true); setExportErr(null);
    try {
      const rows = await all<Session>('sessions', { filters, search, order: { column: 'starts_at', ascending: true } }, 20000);
      downloadCSV('sessions', ['code', 'title', 'type', 'status', 'program', 'expert', 'starts_at', 'ends_at', 'delivery_mode', 'location', 'capacity'],
        rows.map((s) => [s.code, s.title, s.session_type, s.status, pn(s.program_id), en(s.expert_id), s.starts_at, s.ends_at, s.delivery_mode, s.location, s.capacity]));
    } catch (e) { setExportErr(errMsg(e, locale)); } finally { setExporting(false); }
  };

  const cols: Column<Session>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), value: (s) => s.code, render: (s) => <span className="mono">{s.code}</span> },
    { key: 'when', header: tr('الموعد', 'When'), value: (s) => s.starts_at, render: (s) => <span className="small">{fmtDateTime(s.starts_at)}–{fmtTime(s.ends_at)}</span> },
    { key: 'title', header: tr('الجلسة', 'Session'), value: (s) => s.title, render: (s) => <div><b>{s.title}</b><span className="sub">{enumLabel('sessionType', s.session_type)} · {enumLabel('deliveryMode', s.delivery_mode)}{s.location ? ` · ${s.location}` : ''}</span></div> },
    { key: 'program', header: tr('البرنامج', 'Program'), value: (s) => pn(s.program_id) },
    { key: 'expert', header: tr('الخبير', 'Expert'), value: (s) => en(s.expert_id) },
    { key: 'participants', header: tr('المشاركون', 'Participants'), align: 'end', value: (s) => state.data?.counts.get(s.id)?.n ?? 0, render: (s) => {
      const c = state.data?.counts.get(s.id);
      if (!c) return '0';
      return <span>{c.n}{s.status === 'completed' && c.recorded < c.n ? <> <Badge tone="warning">{tr(`${c.n - c.recorded} بلا حضور`, `${c.n - c.recorded} unrecorded`)}</Badge></> : null}</span>;
    } },
    { key: 'status', header: tr('الحالة', 'Status'), value: (s) => s.status, render: (s) => <div className="row" style={{ gap: 4 }}><StatusBadge group="sessionStatus" value={s.status} />
      {s.status === 'scheduled' && new Date(s.ends_at).getTime() < Date.now() && <Badge tone="danger">{tr('لم تُغلق', 'Not closed')}</Badge>}</div> },
  ];
  return (
    <Card><CardBody flush>
      {exportErr && <div className="card-pad"><Notice tone="danger">{exportErr}</Notice></div>}
      <DataTable columns={cols} rows={state.data?.rows ?? []} rowKey={(s) => s.id} loading={state.loading} error={state.error} onRetry={state.reload}
        onRowClick={(s) => onOpen(s.id)} server={{ page, pageSize: PAGE, total: state.data?.total ?? null, onPage: setPage }}
        search={{ value: term, onChange: reset(setTerm), placeholder: tr('بحث بالعنوان أو الرمز أو المكان…', 'Search title, code or location…') }}
        toolbar={<>
          <Select options={refs.programs.map((p) => ({ value: p.id, label: pick(p.name, p.name_en) }))} placeholder={tr('كل البرامج', 'All programs')} value={program} onChange={(e) => reset(setProgram)(e.target.value)} style={{ width: 160 }} />
          <Select options={refs.experts.map((x) => ({ value: x.id, label: pick(x.full_name, x.full_name_en) }))} placeholder={tr('كل الخبراء', 'All experts')} value={expert} onChange={(e) => reset(setExpert)(e.target.value)} style={{ width: 140 }} />
          <Select options={enumOptions('sessionType')} placeholder={tr('كل الأنواع', 'All types')} value={type} onChange={(e) => reset(setType)(e.target.value)} style={{ width: 110 }} />
          <Select options={enumOptions('sessionStatus')} placeholder={tr('كل الحالات', 'All statuses')} value={status} onChange={(e) => reset(setStatus)(e.target.value)} style={{ width: 120 }} />
          <Input type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} style={{ width: 140 }} aria-label={tr('من', 'From')} />
          <Input type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} style={{ width: 140 }} aria-label={tr('إلى', 'To')} />
          {can('operations.export') && <Button size="sm" icon={<Download />} loading={exporting} onClick={() => void exportAll()}>{tr('تصدير الكل', 'Export all')}</Button>}
        </>}
        exportName={can('operations.export') ? 'sessions-page' : undefined}
        empty={{ title: tr('لا توجد جلسات مطابقة', 'No matching sessions') }} />
    </CardBody></Card>
  );
}
