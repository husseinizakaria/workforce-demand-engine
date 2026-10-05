// Programs Center: registry of the organization's programs with reach,
// journey progress and on-demand engine health scores.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Activity, Download, FolderKanban, Plus, PlayCircle, ClipboardList, CheckCircle2 } from 'lucide-react';
import { programHealth } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { all, count, list, type Filter } from '@/services/db';
import { loadProgramBundle } from '@/services/programBundle';
import { errorOf } from '@/services/errors';
import { downloadCSV } from '@/utils/csv';
import { Badge, Button, Card, CardBody, DataTable, Kpi, Notice, PageHeader, Progress, Select, StatusBadge, scoreTone, useToast, type Column } from '@/components/ui';
import type { Program, ProgramEnrollment, ProgramStage } from '@/types/db';
import { errText } from '../lib';

const PAGE = 20;
type HealthCell = { score: number; grade: string; findings: number } | 'loading' | { error: string };

export default function ProgramsPage() {
  const { tr, enumLabel, enumOptions, fmtDate, fmtNumber, pick, locale } = useI18n();
  const { org, can } = useOrg();
  const navigate = useNavigate();
  const toast = useToast();
  const [term, setTerm] = useState('');
  const search = useDebounced(term, 300);
  const [track, setTrack] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [health, setHealth] = useState<Record<string, HealthCell>>({});
  const [computing, setComputing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const filters: Filter[] = [['organization_id', 'eq', org.id], ...(track ? [['track_code', 'eq', track] as Filter] : []), ...(status ? [['status', 'eq', status] as Filter] : [])];
  const searchOpt = search.trim() ? { columns: ['name', 'name_en', 'code', 'region'], term: search } : undefined;

  const kpis = useAsync(async () => {
    const base: Filter[] = [['organization_id', 'eq', org.id]];
    const [total, active, planning, completed] = await Promise.all([
      count('programs', base), count('programs', [...base, ['status', 'eq', 'active']]),
      count('programs', [...base, ['status', 'in', ['draft', 'planning']]]), count('programs', [...base, ['status', 'in', ['completed', 'closed']]]),
    ]);
    return { total, active, planning, completed };
  }, [org.id]);

  const state = useAsync(async () => {
    const res = await list<Program>('programs', { filters, search: searchOpt, order: { column: 'created_at' }, page, pageSize: PAGE, count: true });
    const ids = res.rows.map((r) => r.id);
    const [enrollments, stages] = ids.length ? await Promise.all([
      all<Pick<ProgramEnrollment, 'program_id' | 'status'>>('program_enrollments', { select: 'program_id,status', filters: [['program_id', 'in', ids]], order: { column: 'enrolled_at' } }).catch(() => []),
      all<Pick<ProgramStage, 'program_id' | 'status' | 'progress'>>('program_stages', { select: 'program_id,status,progress', filters: [['program_id', 'in', ids]], order: { column: 'stage_order', ascending: true } }).catch(() => []),
    ]) : [[], []];
    const stats = new Map<string, { enrolled: number; journey: number | null }>();
    for (const id of ids) {
      const en = enrollments.filter((e) => e.program_id === id && !['withdrawn', 'dropped'].includes(e.status)).length;
      const st = stages.filter((s) => s.program_id === id);
      const journey = st.length ? Math.round(st.reduce((a, s) => a + (['completed', 'skipped'].includes(s.status) ? 100 : s.progress), 0) / st.length) : null;
      stats.set(id, { enrolled: en, journey });
    }
    return { rows: res.rows, total: res.total, stats };
  }, [org.id, track, status, search, page]);

  const computeOne = async (id: string) => {
    setHealth((h) => ({ ...h, [id]: 'loading' }));
    try {
      const bundle = await loadProgramBundle(id);
      const r = programHealth(bundle);
      setHealth((h) => ({ ...h, [id]: { score: r.score, grade: r.grade, findings: r.insights.length } }));
    } catch (e) {
      setHealth((h) => ({ ...h, [id]: { error: errText(locale, errorOf(e)) } }));
    }
  };
  const computeVisible = async () => {
    const targets = (state.data?.rows ?? []).filter((p) => ['active', 'planning'].includes(p.status)).slice(0, 10);
    if (!targets.length) { toast.info(tr('لا توجد برامج نشطة أو قيد التخطيط في هذه الصفحة.', 'No active or planning programs on this page.')); return; }
    setComputing(true);
    for (const p of targets) await computeOne(p.id);
    setComputing(false);
  };
  const exportAll = async () => {
    setExporting(true);
    try {
      const rows = await all<Program>('programs', { filters, search: searchOpt, order: { column: 'created_at' } }, 5000);
      downloadCSV(`programs-${org.code}`, [tr('الرمز', 'Code'), tr('الاسم', 'Name'), tr('الاسم بالإنجليزية', 'English name'), tr('المسار', 'Track'), tr('الحالة', 'Status'),
        tr('البداية', 'Start'), tr('النهاية', 'End'), tr('المستهدف', 'Target'), tr('الميزانية', 'Budget'), tr('المنطقة', 'Region'), tr('طريقة التنفيذ', 'Delivery mode')],
      rows.map((p) => [p.code, p.name, p.name_en, enumLabel('track', p.track_code), enumLabel('programStatus', p.status), p.start_date, p.end_date, p.target_beneficiaries, p.budget_total, p.region, enumLabel('deliveryMode', p.delivery_mode)]));
    } catch (e) { toast.error(errText(locale, errorOf(e))); } finally { setExporting(false); }
  };

  const stats = state.data?.stats;
  const cols: Column<Program>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), render: (r) => <span className="mono">{r.code}</span>, value: (r) => r.code },
    { key: 'name', header: tr('البرنامج', 'Program'), render: (r) => <span><b>{pick(r.name, r.name_en)}</b>{r.region ? <span className="sub">{r.region}</span> : null}</span>, value: (r) => r.name },
    { key: 'track', header: tr('المسار', 'Track'), value: (r) => enumLabel('track', r.track_code), render: (r) => <Badge tone="outline">{enumLabel('track', r.track_code)}</Badge> },
    { key: 'status', header: tr('الحالة', 'Status'), value: (r) => enumLabel('programStatus', r.status), render: (r) => <StatusBadge group="programStatus" value={r.status} /> },
    { key: 'dates', header: tr('المدة', 'Period'), value: (r) => r.start_date, render: (r) => <span className="nowrap small">{fmtDate(r.start_date)} – {fmtDate(r.end_date)}</span> },
    { key: 'reach', header: tr('الملتحقون / المستهدف', 'Enrolled / target'), value: (r) => stats?.get(r.id)?.enrolled ?? null, render: (r) => {
      const n = stats?.get(r.id)?.enrolled ?? 0;
      return <div className="row"><Progress value={r.target_beneficiaries ? (n / r.target_beneficiaries) * 100 : 0} /><span className="tiny nowrap">{fmtNumber(n)} / {fmtNumber(r.target_beneficiaries)}</span></div>;
    } },
    { key: 'journey', header: tr('تقدم الرحلة', 'Journey'), value: (r) => stats?.get(r.id)?.journey ?? null, render: (r) => {
      const j = stats?.get(r.id)?.journey;
      return j === null || j === undefined ? <span className="muted">—</span> : <div className="row"><Progress value={j} /><span className="tiny">{j}%</span></div>;
    } },
    { key: 'health', header: tr('الصحة', 'Health'), hideInExport: true, render: (r) => {
      const h = health[r.id];
      if (h === 'loading') return <span className="tiny muted">{tr('جارٍ الحساب…', 'Computing…')}</span>;
      if (h && 'error' in h) return <Badge tone="danger" title={h.error}>{tr('تعذر', 'Failed')}</Badge>;
      if (h) return <Badge tone={scoreTone(h.score) ?? 'neutral'} title={tr(`${h.findings} ملاحظة`, `${h.findings} findings`)}>{h.score}/100</Badge>;
      return <button type="button" className="link-btn small" onClick={(e) => { e.stopPropagation(); void computeOne(r.id); }}>{tr('احسب', 'Compute')}</button>;
    } },
  ];

  return (
    <div className="stack">
      <PageHeader title={tr('مركز البرامج', 'Programs center')} subtitle={tr('كل برامج المؤسسة ومساراتها وتقدمها وصحتها', 'All organization programs, their tracks, progress and health')}
        actions={<>
          <Button icon={<Activity />} loading={computing} onClick={() => void computeVisible()}>{tr('حساب الصحة (حتى 10 برامج نشطة)', 'Compute health (up to 10 active)')}</Button>
          <Button icon={<Download />} loading={exporting} onClick={() => void exportAll()}>{tr('تصدير CSV', 'Export CSV')}</Button>
          {can('programs.create') && <Button variant="primary" icon={<Plus />} onClick={() => navigate('/app/programs/new')}>{tr('برنامج جديد', 'New program')}</Button>}
        </>} />
      <div className="grid g4">
        <Kpi label={tr('كل البرامج', 'All programs')} value={fmtNumber(kpis.data?.total)} icon={<FolderKanban />} />
        <Kpi label={tr('نشطة', 'Active')} value={fmtNumber(kpis.data?.active)} icon={<PlayCircle />} tone="primary" />
        <Kpi label={tr('مسودة / تخطيط', 'Draft / planning')} value={fmtNumber(kpis.data?.planning)} icon={<ClipboardList />} />
        <Kpi label={tr('مكتملة / مغلقة', 'Completed / closed')} value={fmtNumber(kpis.data?.completed)} icon={<CheckCircle2 />} tone="success" />
      </div>
      <Notice tone="info">{tr('درجة الصحة تُحسب عند الطلب من بيانات كل برنامج بقواعد المحرك (الإعداد، التنفيذ، القياس، الأدلة، المالية، المخاطر). افتح البرنامج لرؤية المبررات والتوصيات.',
        'Health is computed on demand from each program’s data with the engine rules (setup, delivery, measurement, evidence, finance, risk). Open a program to see rationale and recommendations.')}</Notice>
      <Card>
        <CardBody flush>
          <DataTable rows={state.data?.rows ?? []} rowKey={(r) => r.id} columns={cols} loading={state.loading} error={state.error} onRetry={state.reload}
            onRowClick={(r) => navigate(`/app/programs/${r.id}/overview`)}
            search={{ value: term, onChange: (v) => { setTerm(v); setPage(0); }, placeholder: tr('ابحث بالاسم أو الرمز أو المنطقة…', 'Search by name, code or region…') }}
            server={{ page, pageSize: PAGE, total: state.data?.total ?? null, onPage: setPage }}
            toolbar={<>
              <Select aria-label={tr('المسار', 'Track')} placeholder={tr('كل المسارات', 'All tracks')} options={enumOptions('track')} value={track} onChange={(e) => { setTrack(e.target.value); setPage(0); }} style={{ width: 170 }} />
              <Select aria-label={tr('الحالة', 'Status')} placeholder={tr('كل الحالات', 'All statuses')} options={enumOptions('programStatus')} value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} style={{ width: 150 }} />
            </>}
            empty={{
              title: search || track || status ? tr('لا توجد برامج مطابقة', 'No matching programs') : tr('لا توجد برامج بعد', 'No programs yet'),
              description: tr('أنشئ برنامجًا من أحد المسارات الستة؛ تُنسخ مراحل الرحلة تلقائيًا ويقترح المعالج إطار الأثر والمؤشرات.', 'Create a program from one of the six tracks; journey stages are copied automatically and the wizard proposes the impact framework and indicators.'),
              action: can('programs.create') ? <Button variant="primary" icon={<Plus />} onClick={() => navigate('/app/programs/new')}>{tr('برنامج جديد', 'New program')}</Button> : undefined,
            }} />
        </CardBody>
      </Card>
    </div>
  );
}
