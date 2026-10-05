// /app/evidence — organization evidence registry, verification queue and
// per-program evidence gaps (engine: evidenceCompleteness).
import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Download, ExternalLink, FileSearch, HelpCircle, Plus, ShieldCheck, Upload, XCircle } from 'lucide-react';
import { evidenceCompleteness } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAuth } from '@/app/AuthProvider';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { all, count, list, update, type Filter } from '@/services/db';
import { callFunction } from '@/services/functions';
import { signedUrl } from '@/services/storage';
import { errorOf, type AppError } from '@/services/errors';
import { loadProgramBundle } from '@/services/programBundle';
import { downloadCSV } from '@/utils/csv';
import {
  AsyncView, Badge, Button, Card, CardBody, CardHeader, DataTable, Drawer, EmptyState, Field, Kpi, Notice, PageHeader, Progress, Select, StatusBadge, Tabs, Textarea, scoreTone, type Column,
} from '@/components/ui';
import type { Evidence } from '@/types/db';
import { EvidenceUploadModal, type EvidencePrefill, type ProgramOpt } from '../components/EvidenceUpload';

const PAGE = 25;
const NIL = '00000000-0000-0000-0000-000000000000';
const LINK_KINDS = ['program', 'cohort', 'beneficiary', 'expert', 'session', 'indicator', 'output', 'outcome', 'milestone', 'assessment_result'] as const;
type LinkKind = (typeof LINK_KINDS)[number];
const daysAgo = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

async function profileNames(ids: (string | null)[]): Promise<Record<string, string>> {
  const u = [...new Set(ids.filter((x): x is string => !!x))];
  if (!u.length) return {};
  try {
    const rows = await all<{ id: string; full_name: string | null; email: string | null }>('profiles', { select: 'id,full_name,email', filters: [['id', 'in', u]], order: { column: 'id', ascending: true } });
    return Object.fromEntries(rows.map((r) => [r.id, r.full_name || r.email || r.id.slice(0, 8)]));
  } catch { return {}; }
}

export default function EvidencePage() {
  const { tr, fmtNumber } = useI18n();
  const { org, can } = useOrg();
  const [tab, setTab] = useState('registry');
  const [upload, setUpload] = useState<EvidencePrefill | null>(null);
  const [open, setOpen] = useState<Evidence | null>(null);
  const [version, setVersion] = useState(0);
  const programs = useAsync(() => all<ProgramOpt>('programs', { select: 'id,name,name_en,code', filters: [['organization_id', 'eq', org.id]], order: { column: 'name', ascending: true } }, 3000), [org.id]);
  const kpis = useAsync(async () => {
    const base: Filter[] = [['organization_id', 'eq', org.id]];
    const cutoff = new Date(Date.now() - 14 * 86400000).toISOString();
    const [total, verified, stale, rejected, needsInfo] = await Promise.all([
      count('evidence', base), count('evidence', [...base, ['verification_status', 'eq', 'verified']]),
      count('evidence', [...base, ['verification_status', 'eq', 'pending'], ['created_at', 'lt', cutoff]]),
      count('evidence', [...base, ['verification_status', 'eq', 'rejected']]), count('evidence', [...base, ['verification_status', 'eq', 'needs_info']]),
    ]);
    return { total, verified, stale, rejected, needsInfo };
  }, [org.id, version]);
  const refresh = () => setVersion((v) => v + 1);
  const progs = programs.data ?? [];

  return (
    <div className="stack">
      <PageHeader title={tr('سجل الأدلة', 'Evidence registry')} subtitle={tr('أدلة التنفيذ والنتائج مع التحقق المستقل وتتبع فجوات الأدلة لكل برنامج', 'Delivery and results evidence with independent verification and per-program gap tracking')}
        actions={can('evidence.create') && <Button variant="primary" icon={<Plus />} onClick={() => setUpload({})}>{tr('إضافة دليل', 'Add evidence')}</Button>} />
      <AsyncView state={kpis} rows={1}>{(k) => (
        <div className="grid g4">
          <Kpi label={tr('إجمالي الأدلة', 'Total evidence')} value={fmtNumber(k.total)} icon={<FileSearch />} />
          <Kpi label={tr('نسبة المتحقق منه', 'Verified share')} value={k.total ? `${fmtNumber((k.verified / k.total) * 100, 0)}%` : '—'} hint={`${fmtNumber(k.verified)} / ${fmtNumber(k.total)}`} icon={<ShieldCheck />} tone={scoreTone(k.total ? (k.verified / k.total) * 100 : null)} />
          <Kpi label={tr('معلقة أكثر من 14 يومًا', 'Pending > 14 days')} value={fmtNumber(k.stale)} icon={<Clock />} tone={k.stale ? 'warning' : undefined} hint={k.needsInfo ? tr(`${k.needsInfo} تحتاج معلومات`, `${k.needsInfo} need info`) : undefined} />
          <Kpi label={tr('مرفوضة', 'Rejected')} value={fmtNumber(k.rejected)} icon={<XCircle />} tone={k.rejected ? 'danger' : undefined} />
        </div>
      )}</AsyncView>
      <Tabs value={tab} onChange={setTab} items={[
        { key: 'registry', label: tr('السجل', 'Registry'), icon: <FileSearch size={15} /> },
        { key: 'queue', label: tr('قائمة التحقق', 'Verification queue'), icon: <ShieldCheck size={15} />, hidden: !can('evidence.verify') },
        { key: 'gaps', label: tr('فجوات البرامج', 'Program gaps'), icon: <AlertTriangle size={15} /> },
      ]} />
      {tab === 'registry' && <RegistryTab programs={progs} version={version} onOpen={setOpen} />}
      {tab === 'queue' && can('evidence.verify') && <QueueTab programs={progs} version={version} onOpen={setOpen} />}
      {tab === 'gaps' && <GapsTab programs={progs} version={version} onUpload={(p) => setUpload(p)} />}
      {upload && <EvidenceUploadModal programs={progs} prefill={upload} onClose={() => setUpload(null)} onCreated={() => { setUpload(null); refresh(); }} />}
      {open && <EvidenceDrawer evidence={open} programs={progs} onClose={() => setOpen(null)} onChanged={(e) => { setOpen(e); refresh(); }} />}
    </div>
  );
}

function useNames(rows: Evidence[] | undefined) {
  return useAsync(() => profileNames((rows ?? []).flatMap((r) => [r.verified_by, r.uploaded_by])), [rows]);
}

function linkedKinds(e: Evidence): LinkKind[] {
  return LINK_KINDS.filter((k) => (e as unknown as Record<string, unknown>)[`${k}_id`]);
}

function useColumns(programs: ProgramOpt[], names: Record<string, string>): Column<Evidence>[] {
  const { tr, pick, enumLabel, fmtDate } = useI18n();
  const prog = (id: string | null) => { const p = programs.find((x) => x.id === id); return p ? pick(p.name, p.name_en) : tr('عام', 'General'); };
  const kindLabel = useKindLabel();
  return [
    { key: 'code', header: tr('الرمز', 'Code'), value: (e) => e.code, render: (e) => <span className="mono">{e.code}</span> },
    { key: 'title', header: tr('العنوان', 'Title'), value: (e) => e.title, render: (e) => <div><b>{e.title}</b>{e.file_name && <div className="tiny muted ellipsis" style={{ maxWidth: 260 }}>{e.file_name}</div>}</div> },
    { key: 'type', header: tr('النوع', 'Type'), value: (e) => enumLabel('evidenceType', e.evidence_type) },
    { key: 'program', header: tr('البرنامج', 'Program'), value: (e) => prog(e.program_id) },
    { key: 'linked', header: tr('مرتبط بـ', 'Linked to'), value: (e) => linkedKinds(e).filter((k) => k !== 'program').map(kindLabel).join(', '),
      render: (e) => <div className="row wrap" style={{ gap: 3 }}>{linkedKinds(e).filter((k) => k !== 'program').map((k) => <Badge key={k} tone="outline">{kindLabel(k)}</Badge>)}</div> },
    { key: 'stage', header: tr('المرحلة', 'Stage'), value: (e) => e.stage_key ?? '', render: (e) => (e.stage_key ? <span className="mono tiny">{e.stage_key}</span> : '—') },
    { key: 'status', header: tr('التحقق', 'Verification'), value: (e) => enumLabel('verification', e.verification_status), render: (e) => <StatusBadge group="verification" value={e.verification_status} /> },
    { key: 'uploaded', header: tr('الرفع', 'Uploaded'), value: (e) => e.created_at, render: (e) => <div className="small">{fmtDate(e.created_at)}{e.uploaded_by && <div className="tiny muted">{names[e.uploaded_by] ?? ''}</div>}</div> },
    { key: 'verified', header: tr('تحقق بواسطة', 'Verified by / at'), value: (e) => (e.verified_at ? `${names[e.verified_by ?? ''] ?? ''} ${e.verified_at}` : ''),
      render: (e) => (e.verified_at ? <div className="small">{names[e.verified_by ?? ''] ?? '—'}<div className="tiny muted">{fmtDate(e.verified_at)}</div></div> : <span className="muted">—</span>) },
  ];
}

function useKindLabel() {
  const { tr } = useI18n();
  const L: Record<LinkKind, [string, string]> = {
    program: ['برنامج', 'Program'], cohort: ['دفعة', 'Cohort'], beneficiary: ['مستفيد', 'Beneficiary'], expert: ['خبير', 'Expert'], session: ['جلسة', 'Session'],
    indicator: ['مؤشر', 'Indicator'], output: ['مخرج', 'Output'], outcome: ['نتيجة', 'Outcome'], milestone: ['معلم', 'Milestone'], assessment_result: ['نتيجة تقييم', 'Assessment result'],
  };
  return (k: LinkKind) => tr(L[k][0], L[k][1]);
}

function RegistryTab({ programs, version, onOpen }: { programs: ProgramOpt[]; version: number; onOpen: (e: Evidence) => void }) {
  const { tr, pick, enumOptions, enumLabel } = useI18n();
  const { org } = useOrg();
  const kindLabel = useKindLabel();
  const [f, setF] = useState({ program: '', type: '', status: '', linked: '' });
  const [q, setQ] = useState('');
  const term = useDebounced(q, 300);
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const filters = (): Filter[] => [['organization_id', 'eq', org.id],
    ...(f.program === 'none' ? [['program_id', 'is', null] as Filter] : f.program ? [['program_id', 'eq', f.program] as Filter] : []),
    ...(f.type ? [['evidence_type', 'eq', f.type] as Filter] : []), ...(f.status ? [['verification_status', 'eq', f.status] as Filter] : []),
    ...(f.linked ? [[`${f.linked}_id`, 'gt', NIL] as Filter] : [])];
  const data = useAsync(() => list<Evidence>('evidence', { filters: filters(), search: term ? { columns: ['title', 'code', 'file_name'], term } : undefined, page, pageSize: PAGE, count: true }),
    [org.id, f.program, f.type, f.status, f.linked, term, page, version]);
  const names = useNames(data.data?.rows);
  const cols = useColumns(programs, names.data ?? {});
  const setFilter = (k: keyof typeof f, v: string) => { setF((s) => ({ ...s, [k]: v })); setPage(0); };
  const exportAll = async () => {
    setExporting(true);
    try {
      const rows = await all<Evidence>('evidence', { filters: filters(), search: term ? { columns: ['title', 'code', 'file_name'], term } : undefined, order: { column: 'created_at' } });
      const nm = await profileNames(rows.flatMap((r) => [r.verified_by, r.uploaded_by]));
      const prog = (id: string | null) => { const p = programs.find((x) => x.id === id); return p ? pick(p.name, p.name_en) : ''; };
      downloadCSV('evidence-registry', ['code', 'title', 'type', 'program', 'stage', 'linked', 'status', 'file', 'source_url', 'collected_at', 'uploaded_at', 'uploaded_by', 'verified_by', 'verified_at', 'notes'],
        rows.map((e) => [e.code, e.title, enumLabel('evidenceType', e.evidence_type), prog(e.program_id), e.stage_key, linkedKinds(e).join('|'), e.verification_status, e.file_name, e.source_url,
          e.collected_at, e.created_at, nm[e.uploaded_by ?? ''] ?? e.uploaded_by, nm[e.verified_by ?? ''] ?? e.verified_by, e.verified_at, e.verification_notes]));
    } finally { setExporting(false); }
  };
  return (
    <Card>
      <CardBody flush>
        <DataTable columns={cols} rows={data.data?.rows ?? []} rowKey={(e) => e.id} loading={data.loading} error={data.error} onRetry={data.reload} onRowClick={onOpen}
          search={{ value: q, onChange: (v) => { setQ(v); setPage(0); }, placeholder: tr('بحث بالعنوان أو الرمز…', 'Search title or code…') }}
          server={{ page, pageSize: PAGE, total: data.data?.total ?? null, onPage: setPage }}
          toolbar={<>
            <Select value={f.program} onChange={(e) => setFilter('program', e.target.value)} placeholder={tr('كل البرامج', 'All programs')}
              options={[{ value: 'none', label: tr('أدلة عامة (دون برنامج)', 'General (no program)') }, ...programs.map((p) => ({ value: p.id, label: pick(p.name, p.name_en) }))]} />
            <Select value={f.type} onChange={(e) => setFilter('type', e.target.value)} placeholder={tr('كل الأنواع', 'All types')} options={enumOptions('evidenceType')} />
            <Select value={f.status} onChange={(e) => setFilter('status', e.target.value)} placeholder={tr('كل الحالات', 'All statuses')} options={enumOptions('verification')} />
            <Select value={f.linked} onChange={(e) => setFilter('linked', e.target.value)} placeholder={tr('مرتبط بأي عنصر', 'Linked to anything')} options={LINK_KINDS.map((k) => ({ value: k, label: kindLabel(k) }))} />
            <Button size="sm" icon={<Download />} loading={exporting} onClick={exportAll}>{tr('تصدير CSV', 'Export CSV')}</Button>
          </>}
          empty={{ title: tr('لا توجد أدلة مطابقة', 'No matching evidence') }} />
      </CardBody>
    </Card>
  );
}

function QueueTab({ programs, version, onOpen }: { programs: ProgramOpt[]; version: number; onOpen: (e: Evidence) => void }) {
  const { tr, fmtNumber } = useI18n();
  const { org } = useOrg();
  const { user } = useAuth();
  const data = useAsync(() => all<Evidence>('evidence', { filters: [['organization_id', 'eq', org.id], ['verification_status', 'in', ['pending', 'needs_info']]], order: { column: 'created_at', ascending: true } }, 2000), [org.id, version]);
  const names = useNames(data.data);
  const base = useColumns(programs, names.data ?? {});
  const cols: Column<Evidence>[] = [
    { key: 'age', header: tr('العمر (يوم)', 'Age (days)'), align: 'end', value: (e) => daysAgo(e.created_at), sortable: true,
      render: (e) => { const d = daysAgo(e.created_at); return <Badge tone={d > 14 ? 'danger' : d > 7 ? 'warning' : 'neutral'}>{fmtNumber(d)}</Badge>; } },
    ...base.filter((c) => c.key !== 'verified'),
    { key: 'own', header: '', hideInExport: true, render: (e) => (e.uploaded_by && e.uploaded_by === user?.id ? <Badge tone="outline" title={tr('رفعته أنت؛ لا يمكنك التحقق منه', 'You uploaded it; you cannot verify it')}>{tr('رفعك', 'Yours')}</Badge> : null) },
  ];
  const stale = (data.data ?? []).filter((e) => daysAgo(e.created_at) > 14).length;
  return (
    <Card>
      <CardHeader title={tr('بانتظار التحقق', 'Awaiting verification')} hint={tr('الأقدم أولًا', 'Oldest first')} />
      <CardBody flush>
        {stale > 0 && <div style={{ padding: '10px 16px 0' }}><Notice tone="warning">{tr(`${stale} دليل معلق لأكثر من 14 يومًا؛ التأخير يعطل بوابات المراحل التي تتطلب أدلة.`, `${stale} item(s) pending for more than 14 days; delays block stage gates that require evidence.`)}</Notice></div>}
        <DataTable columns={cols} rows={data.data ?? []} rowKey={(e) => e.id} loading={data.loading} error={data.error} onRetry={data.reload} onRowClick={onOpen} pageSize={20} searchable
          exportName="evidence-verification-queue" empty={{ title: tr('لا توجد أدلة بانتظار التحقق', 'Nothing awaiting verification') }} />
      </CardBody>
    </Card>
  );
}

function GapsTab({ programs, version, onUpload }: { programs: ProgramOpt[]; version: number; onUpload: (p: EvidencePrefill) => void }) {
  const { tr, pick, L, fmtDate, enumLabel } = useI18n();
  const { can } = useOrg();
  const [programId, setProgramId] = useState('');
  const data = useAsync(async () => {
    if (!programId) return null;
    const b = await loadProgramBundle(programId);
    return { b, c: evidenceCompleteness(b) };
  }, [programId, version]);
  const prefillFor = (key: string, label: string): EvidencePrefill => {
    const [kind, a, t] = key.split(':');
    if (kind === 'stage') return { program_id: programId, stage_key: a, evidence_type: (t || 'document') as EvidencePrefill['evidence_type'], gapLabel: label };
    if (kind === 'indicator') return { program_id: programId, indicator_id: a, evidence_type: 'dataset', gapLabel: label };
    if (kind === 'output') return { program_id: programId, output_id: a, gapLabel: label };
    return { program_id: programId, evidence_type: 'attendance_sheet', gapLabel: label };
  };
  const sessionsWithoutProof = useMemo(() => {
    const b = data.data?.b;
    if (!b) return [];
    return b.sessions.filter((s) => s.status === 'completed' && !b.evidence.some((e) => e.session_id === s.id && ['pending', 'verified'].includes(e.verification_status)));
  }, [data.data]);
  return (
    <Card>
      <CardHeader title={tr('فجوات الأدلة حسب البرنامج', 'Evidence gaps by program')} hint={tr('محسوبة محليًا بمحرك التحليل من إعدادات البرنامج', 'Computed locally by the analysis engine from the program configuration')}
        actions={<Select value={programId} onChange={(e) => setProgramId(e.target.value)} placeholder={tr('— اختر برنامجًا —', '— Choose a program —')} options={programs.map((p) => ({ value: p.id, label: pick(p.name, p.name_en) }))} />} />
      <CardBody>
        {!programId ? <EmptyState compact title={tr('اختر برنامجًا لعرض فجوات الأدلة', 'Choose a program to see its evidence gaps')} /> : (
          <AsyncView state={data}>{(d) => !d ? null : (
            <div className="stack">
              <div className="grid g4">
                <Kpi label={tr('اكتمال الأدلة', 'Evidence completeness')} value={`${d.c.score}%`} tone={scoreTone(d.c.score)} />
                <Kpi label={tr('متطلبات مستوفاة', 'Requirements met')} value={`${d.c.satisfied}/${d.c.required}`} />
                <Kpi label={tr('فجوات', 'Gaps')} value={d.c.missing.length} tone={d.c.missing.length ? 'warning' : 'success'} />
                <Kpi label={tr('نسبة المتحقق منه', 'Verified share')} value={d.c.verified_share === null ? '—' : `${Math.round(d.c.verified_share * 100)}%`} hint={`${d.b.evidence.length} ${tr('دليل', 'items')}`} />
              </div>
              <Progress value={d.c.score} tone={scoreTone(d.c.score)} large />
              {d.c.required === 0 && <Notice tone="info">{tr('لا توجد متطلبات أدلة مستحقة بعد (مراحل جارية/مكتملة، مؤشرات تتطلب أدلة ولها قياسات، جلسات مكتملة، مخرجات منجزة).', 'No evidence requirements are due yet (active/completed stages, indicators requiring evidence with measurements, completed sessions, achieved outputs).')}</Notice>}
              {d.c.missing.length > 0 && (
                <div className="stack-sm">
                  <b className="small">{tr('العناصر الناقصة', 'Missing items')}</b>
                  <ul className="list-plain">
                    {d.c.missing.map((m) => (
                      <li key={m.key} className="row between">
                        <span className="small"><Badge tone="warning">{m.kind === 'stage' ? tr('مرحلة', 'Stage') : m.kind === 'indicator' ? tr('مؤشر', 'Indicator') : m.kind === 'session' ? tr('جلسات', 'Sessions') : tr('مخرج', 'Output')}</Badge> {L(m.label)}
                          {m.kind === 'stage' && <span className="tiny muted"> ({enumLabel('evidenceType', m.key.split(':')[2])})</span>}</span>
                        {can('evidence.create') && <Button size="sm" icon={<Upload />} onClick={() => onUpload(prefillFor(m.key, L(m.label)))}>{tr('رفع لهذه الفجوة', 'Upload for this gap')}</Button>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {sessionsWithoutProof.length > 0 && (
                <details>
                  <summary className="small strong">{tr('الجلسات المكتملة دون دليل', 'Completed sessions without proof')} ({sessionsWithoutProof.length})</summary>
                  <ul className="list-plain">
                    {sessionsWithoutProof.slice(0, 100).map((s) => (
                      <li key={s.id} className="row between">
                        <span className="small"><span className="mono tiny">{s.code}</span> {s.title} · <span className="muted">{fmtDate(s.starts_at)}</span></span>
                        {can('evidence.create') && <Button size="sm" variant="ghost" icon={<Upload />} onClick={() => onUpload({ program_id: programId, session_id: s.id, stage_key: s.stage_key, evidence_type: 'attendance_sheet', title: `${tr('كشف حضور', 'Attendance')} — ${s.title}`, gapLabel: `${s.code} ${s.title}` })}>{tr('رفع', 'Upload')}</Button>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {d.c.items.some((i) => i.satisfied) && (
                <details>
                  <summary className="small">{tr('المتطلبات المستوفاة', 'Satisfied requirements')} ({d.c.satisfied})</summary>
                  <ul className="small">{d.c.items.filter((i) => i.satisfied).map((i) => <li key={i.key}><CheckCircle2 size={12} color="var(--success)" /> {L(i.label)}</li>)}</ul>
                </details>
              )}
              <span className="tiny muted">{tr('الأدلة المعلقة تُحتسب مؤقتًا لسد المتطلب؛ الأدلة المرفوضة لا تُحتسب.', 'Pending evidence counts provisionally toward a requirement; rejected evidence does not.')}</span>
            </div>
          )}</AsyncView>
        )}
      </CardBody>
    </Card>
  );
}

function EvidenceDrawer({ evidence: e, programs, onClose, onChanged }: { evidence: Evidence; programs: ProgramOpt[]; onClose: () => void; onChanged: (e: Evidence) => void }) {
  const { tr, pick, enumLabel, fmtDate, fmtDateTime, fmtNumber, locale } = useI18n();
  const { org, can } = useOrg();
  const { user } = useAuth();
  const kindLabel = useKindLabel();
  const [note, setNote] = useState(e.verification_notes ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<AppError | null>(null);
  const [fallback, setFallback] = useState(false);
  const names = useAsync(() => profileNames([e.uploaded_by, e.verified_by]), [e.uploaded_by, e.verified_by]);
  const preview = useAsync(async () => (e.file_path && e.mime_type?.startsWith('image/') ? signedUrl('evidence', e.file_path) : null), [e.file_path]);
  const own = !!user && e.uploaded_by === user.id;
  const program = programs.find((p) => p.id === e.program_id);

  const openFile = async () => {
    if (!e.file_path) return;
    try { window.open(await signedUrl('evidence', e.file_path), '_blank', 'noopener'); } catch (x) { setErr(errorOf(x)); }
  };
  const decide = async (action: 'verify' | 'reject' | 'needs_info') => {
    if (action !== 'verify' && !note.trim()) { setErr({ code: 'x', message_ar: 'الملاحظات إلزامية للرفض أو طلب المعلومات', message_en: 'Notes are required to reject or request information' }); return; }
    setBusy(action); setErr(null); setFallback(false);
    try {
      let updated: Evidence;
      try {
        const r = await callFunction<{ evidence: Evidence }>('evidence-verification', { action, organization_id: org.id, evidence_id: e.id, notes: note.trim() || undefined });
        updated = r.evidence;
      } catch (x) {
        const ae = errorOf(x);
        if (ae.code !== 'function_unavailable' && ae.code !== '404') throw x;
        // Function not deployed: direct update; the database trigger still enforces the verification rules.
        setFallback(true);
        updated = await update<Evidence>('evidence', e.id, { verification_status: action === 'verify' ? 'verified' : action === 'reject' ? 'rejected' : 'needs_info', verification_notes: note.trim() || null });
      }
      onChanged(updated);
    } catch (x) { setErr(errorOf(x)); } finally { setBusy(null); }
  };

  return (
    <Drawer open wide title={`${e.code} · ${e.title}`} onClose={onClose}>
      <div className="stack">
        <div className="row wrap"><StatusBadge group="verification" value={e.verification_status} /><Badge tone="outline">{enumLabel('evidenceType', e.evidence_type)}</Badge>{own && <Badge tone="info">{tr('رفعته أنت', 'Uploaded by you')}</Badge>}</div>
        <dl className="kv">
          <dt>{tr('البرنامج', 'Program')}</dt><dd>{program ? pick(program.name, program.name_en) : tr('عام', 'General')}</dd>
          <dt>{tr('المرحلة', 'Stage')}</dt><dd>{e.stage_key ?? '—'}</dd>
          <dt>{tr('مرتبط بـ', 'Linked to')}</dt><dd>{linkedKinds(e).map(kindLabel).join('، ') || '—'}</dd>
          <dt>{tr('الوصف', 'Description')}</dt><dd className="small">{e.description ?? '—'}</dd>
          <dt>{tr('تاريخ الجمع', 'Collected')}</dt><dd>{fmtDate(e.collected_at)}</dd>
          <dt>{tr('رُفع', 'Uploaded')}</dt><dd>{fmtDateTime(e.created_at)} · {names.data?.[e.uploaded_by ?? ''] ?? '—'}</dd>
          {e.file_name && <><dt>{tr('الملف', 'File')}</dt><dd>{e.file_name}{e.file_size ? ` · ${fmtNumber(e.file_size / 1024, 0)} KB` : ''}</dd></>}
          {e.verified_at && <><dt>{tr('القرار', 'Decision')}</dt><dd>{names.data?.[e.verified_by ?? ''] ?? '—'} · {fmtDateTime(e.verified_at)}</dd></>}
          {e.verification_notes && <><dt>{tr('ملاحظات التحقق', 'Verification notes')}</dt><dd className="small" style={{ whiteSpace: 'pre-wrap' }}>{e.verification_notes}</dd></>}
        </dl>
        <div className="row">
          {e.file_path && <Button icon={<Download />} onClick={openFile}>{tr('معاينة / تنزيل', 'Preview / download')}</Button>}
          {e.source_url && <a className="btn" href={e.source_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} /> {tr('فتح المصدر', 'Open source')}</a>}
        </div>
        {preview.data && <img src={preview.data} alt={e.title} style={{ maxWidth: '100%', maxHeight: 360, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 6 }} />}
        {can('evidence.verify') && e.verification_status !== 'verified' && (
          <Card>
            <CardHeader title={tr('التحقق', 'Verification')} hint={tr('تحقق مستقل: لا يمكن لمن رفع الدليل التحقق منه', 'Independent check: the uploader cannot verify it')} />
            <CardBody>
              <Field label={tr('ملاحظات (إلزامية للرفض أو طلب المعلومات)', 'Notes (required to reject or request info)')}><Textarea rows={3} value={note} onChange={(x) => setNote(x.target.value)} /></Field>
              {own && <Notice tone="info">{tr('رفعت هذا الدليل بنفسك؛ يمكنك طلب معلومات أو رفضه لكن لا يمكنك التحقق منه.', 'You uploaded this evidence; you may request info or reject it, but you cannot verify it.')}</Notice>}
              {err && <Notice tone="danger">{locale === 'ar' ? err.message_ar : err.message_en}</Notice>}
              <div className="row wrap" style={{ marginTop: 8 }}>
                <Button variant="primary" icon={<CheckCircle2 />} loading={busy === 'verify'} disabled={own} onClick={() => decide('verify')}>{tr('تحقق', 'Verify')}</Button>
                <Button icon={<HelpCircle />} loading={busy === 'needs_info'} onClick={() => decide('needs_info')}>{tr('يحتاج معلومات', 'Needs info')}</Button>
                <Button variant="danger" icon={<XCircle />} loading={busy === 'reject'} onClick={() => decide('reject')}>{tr('رفض', 'Reject')}</Button>
              </div>
            </CardBody>
          </Card>
        )}
        {fallback && <Notice tone="warning">{tr('خدمة التحقق في الخادم غير منشورة؛ نُفذ التحديث مباشرة وطبقت قاعدة البيانات قواعد التحقق، لكن لم يُرسل إشعار للرافع.', 'The verification service is not deployed; the update was applied directly with database rules enforced, but the uploader was not notified.')}</Notice>}
        {!can('evidence.verify') && err && <Notice tone="danger">{locale === 'ar' ? err.message_ar : err.message_en}</Notice>}
      </div>
    </Drawer>
  );
}
