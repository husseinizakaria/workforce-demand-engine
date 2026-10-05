// Results registry (server-paged), verification workflow, server interpretation
// and cohort analysis (distribution, dimension heatmap across T0..T5, paired change).
import { useMemo, useState } from 'react';
import { BarChart3, CheckCircle2, Download, Sparkles, XCircle } from 'lucide-react';
import { classify, type ClassBand } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAsync } from '@/hooks/useAsync';
import { all, list, update, type Filter } from '@/services/db';
import { callFunction } from '@/services/functions';
import { errorOf, type AppError } from '@/services/errors';
import { downloadCSV } from '@/utils/csv';
import {
  AsyncView, Badge, BarList, Button, Card, CardBody, CardHeader, DataTable, Drawer, EmptyState, Field, Heatmap, Kpi, Notice, Select, StatusBadge, Textarea, type Column,
} from '@/components/ui';
import type { AssessmentDimension, AssessmentResult, AssessmentTool } from '@/types/db';
import { loadOrgTools, loadToolBundle, MEASUREMENT_KEYS, nameMap, num, profileNames, toolLike, type ProgramLite } from '../api';
import { FunctionError, GeneratedBy, RichList, useRichText } from './Shared';

interface Names { ben: Record<string, string>; team: Record<string, string>; exp: Record<string, string>; users: Record<string, string> }
const PAGE = 25;

function useSubjectLabel(programs: ProgramLite[]) {
  const { pick, tr } = useI18n();
  return (r: AssessmentResult, n: Names | undefined) => {
    if (r.beneficiary_id) return n?.ben[r.beneficiary_id] ?? tr('مستفيد', 'Beneficiary');
    if (r.team_id) return `${tr('فريق', 'Team')}: ${n?.team[r.team_id] ?? '—'}`;
    if (r.expert_id) return `${tr('خبير', 'Expert')}: ${n?.exp[r.expert_id] ?? '—'}`;
    const p = programs.find((x) => x.id === r.program_id);
    return p ? `${tr('برنامج', 'Program')}: ${pick(p.name, p.name_en)}` : '—';
  };
}

export function ResultsTab({ programs, initialProgram }: { programs: ProgramLite[]; initialProgram: string | null }) {
  const { tr, pick, enumOptions, enumLabel, fmtNumber, fmtDate } = useI18n();
  const { org } = useOrg();
  const [f, setF] = useState({ program: initialProgram ?? '', tool: '', point: '', status: '' });
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<AssessmentResult | null>(null);
  const [exporting, setExporting] = useState(false);
  const tools = useAsync(() => loadOrgTools(org.id), [org.id]);
  const toolMap = useMemo(() => Object.fromEntries((tools.data ?? []).map((t) => [t.id, t])), [tools.data]);
  const subjectLabel = useSubjectLabel(programs);

  const filters = (): Filter[] => [
    ['organization_id', 'eq', org.id],
    ...(f.program ? [['program_id', 'eq', f.program] as Filter] : []),
    ...(f.tool ? [['tool_id', 'eq', f.tool] as Filter] : []),
    ...(f.point ? [['measurement_point', 'eq', f.point] as Filter] : []),
    ...(f.status ? [['status', 'eq', f.status] as Filter] : []),
  ];
  const resolveNames = async (rows: AssessmentResult[]): Promise<Names> => {
    const [ben, team, exp, users] = await Promise.all([
      nameMap('beneficiaries', rows.map((r) => r.beneficiary_id ?? '')), nameMap('program_teams', rows.map((r) => r.team_id ?? '')),
      nameMap('experts', rows.map((r) => r.expert_id ?? '')), profileNames(rows.flatMap((r) => [r.verified_by, r.assessor_user_id])),
    ]);
    return { ben, team, exp, users };
  };
  const data = useAsync(async () => {
    const res = await list<AssessmentResult>('assessment_results', { filters: filters(), order: { column: 'assessed_at' }, page, pageSize: PAGE, count: true });
    return { ...res, names: await resolveNames(res.rows) };
  }, [org.id, f.program, f.tool, f.point, f.status, page]);

  const setFilter = (k: keyof typeof f, v: string) => { setF((s) => ({ ...s, [k]: v })); setPage(0); };
  const label = (r: AssessmentResult) => pick(r.interpretation?.label_ar as string | undefined, r.interpretation?.label_en as string | undefined) || r.classification_label || '—';
  const toolName = (id: string) => { const t = toolMap[id]; return t ? pick(t.name, t.name_en) : '—'; };
  const progName = (id: string | null) => { const p = programs.find((x) => x.id === id); return p ? pick(p.name, p.name_en) : '—'; };

  const cols: Column<AssessmentResult>[] = [
    { key: 'subject', header: tr('المُقيَّم', 'Subject'), value: (r) => subjectLabel(r, data.data?.names) },
    { key: 'tool', header: tr('الأداة', 'Tool'), value: (r) => toolName(r.tool_id) },
    { key: 'version', header: tr('الإصدار', 'Ver.'), value: (r) => r.tool_version, render: (r) => <span className="mono">v{r.tool_version ?? '—'}</span> },
    { key: 'point', header: tr('النقطة', 'Point'), value: (r) => r.measurement_point, render: (r) => <Badge tone="outline">{r.measurement_point}</Badge> },
    { key: 'norm', header: tr('الموحدة %', 'Normalized %'), align: 'end', value: (r) => num(r.normalized_score), render: (r) => <span className="mono">{num(r.normalized_score) === null ? '—' : fmtNumber(num(r.normalized_score), 1)}</span> },
    { key: 'class', header: tr('التصنيف', 'Classification'), value: label },
    { key: 'passed', header: tr('النجاح', 'Passed'), value: (r) => (r.passed === null ? '' : r.passed ? 'yes' : 'no'),
      render: (r) => (r.passed === null ? <span className="muted">—</span> : r.passed ? <Badge tone="success">{tr('ناجح', 'Passed')}</Badge> : <Badge tone="danger">{tr('لم يجتز', 'Not passed')}</Badge>) },
    { key: 'status', header: tr('الحالة', 'Status'), value: (r) => enumLabel('resultStatus', r.status), render: (r) => <StatusBadge group="resultStatus" value={r.status} /> },
    { key: 'source', header: tr('المصدر', 'Source'), value: (r) => r.source, render: (r) => <Badge tone={r.source === 'external_import' ? 'info' : 'outline'}>{r.source === 'external_import' ? tr('استيراد خارجي', 'External import') : tr('داخلي', 'Internal')}</Badge> },
    { key: 'date', header: tr('التاريخ', 'Date'), value: (r) => r.assessed_at, render: (r) => fmtDate(r.assessed_at) },
  ];

  const exportAll = async () => {
    setExporting(true);
    try {
      const rows = await all<AssessmentResult>('assessment_results', { filters: filters(), order: { column: 'assessed_at' } });
      const names = await resolveNames(rows);
      downloadCSV('assessment-results', ['subject', 'program', 'tool', 'version', 'point', 'total', 'normalized', 'classification', 'passed', 'status', 'source', 'assessed_at'],
        rows.map((r) => [subjectLabel(r, names), progName(r.program_id), toolName(r.tool_id), r.tool_version, r.measurement_point, num(r.total_score), num(r.normalized_score), label(r), r.passed, r.status, r.source, r.assessed_at]));
    } finally { setExporting(false); }
  };

  return (
    <div className="stack">
      <Card>
        <CardHeader title={tr('سجل النتائج', 'Results registry')} hint={tr('الدرجات محسوبة في الخادم عند الحفظ', 'Scores are computed server-side on save')}
          actions={<Button size="sm" icon={<Download />} loading={exporting} onClick={exportAll}>{tr('تصدير كل النتائج المصفاة', 'Export all filtered')}</Button>} />
        <CardBody flush>
          <DataTable columns={cols} rows={data.data?.rows ?? []} rowKey={(r) => r.id} loading={data.loading} error={data.error} onRetry={data.reload}
            onRowClick={setOpen} server={{ page, pageSize: PAGE, total: data.data?.total ?? null, onPage: setPage }}
            toolbar={<>
              <Select value={f.program} onChange={(e) => setFilter('program', e.target.value)} placeholder={tr('كل البرامج', 'All programs')} options={programs.map((p) => ({ value: p.id, label: pick(p.name, p.name_en) }))} />
              <Select value={f.tool} onChange={(e) => setFilter('tool', e.target.value)} placeholder={tr('كل الأدوات', 'All tools')} options={(tools.data ?? []).map((t) => ({ value: t.id, label: `${pick(t.name, t.name_en)} · v${t.version}` }))} />
              <Select value={f.point} onChange={(e) => setFilter('point', e.target.value)} placeholder={tr('كل النقاط', 'All points')} options={enumOptions('measurementPoint')} />
              <Select value={f.status} onChange={(e) => setFilter('status', e.target.value)} placeholder={tr('كل الحالات', 'All statuses')} options={enumOptions('resultStatus')} />
            </>}
            empty={{ title: tr('لا توجد نتائج مطابقة', 'No matching results') }} />
        </CardBody>
      </Card>

      <CohortPanel programs={programs} tools={tools.data ?? []} initial={{ program: f.program, tool: f.tool, point: f.point || 'T1' }} />

      {open && <ResultDrawer result={open} tool={toolMap[open.tool_id]} subject={subjectLabel(open, data.data?.names)} users={data.data?.names.users ?? {}}
        programName={progName(open.program_id)} onClose={() => setOpen(null)} onChanged={(r) => { setOpen(r); void data.reload(); }} />}
    </div>
  );
}

interface InterpretResponse { result?: unknown; strengths?: unknown; development_areas?: unknown; recommendations?: unknown; narrative?: unknown; generated_by?: string }

function ResultDrawer({ result, tool, subject, programName, users, onClose, onChanged }: {
  result: AssessmentResult; tool: AssessmentTool | undefined; subject: string; programName: string; users: Record<string, string>;
  onClose: () => void; onChanged: (r: AssessmentResult) => void;
}) {
  const { tr, pick, fmtNumber, fmtDateTime, locale } = useI18n();
  const { org, can } = useOrg();
  const text = useRichText();
  const dims = useAsync(() => all<AssessmentDimension>('assessment_dimensions', { filters: [['tool_id', 'eq', result.tool_id]], order: { column: 'sort_order', ascending: true } }), [result.tool_id]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<AppError | null>(null);
  const [interp, setInterp] = useState<InterpretResponse | null>(null);
  const [interpErr, setInterpErr] = useState<AppError | null>(null);

  const decide = async (status: 'verified' | 'rejected') => {
    if (status === 'rejected' && !note.trim()) { setErr({ code: 'note', message_ar: 'سبب الرفض إلزامي', message_en: 'A rejection reason is required' }); return; }
    setBusy(status); setErr(null);
    try {
      const stamp = `${status === 'verified' ? tr('تحقق', 'Verified') : tr('رفض', 'Rejected')} ${new Date().toISOString().slice(0, 10)}`;
      const notes = note.trim() ? [result.notes, `— ${stamp}: ${note.trim()}`].filter(Boolean).join('\n') : result.notes;
      const r = await update<AssessmentResult>('assessment_results', result.id, { status, notes });
      setNote(''); onChanged(r);
    } catch (e) { setErr(errorOf(e)); } finally { setBusy(null); }
  };
  const interpret = async () => {
    setBusy('interp'); setInterpErr(null);
    try { setInterp(await callFunction<InterpretResponse>('ai-assessment-interpretation', { mode: 'result', organization_id: org.id, result_id: result.id })); }
    catch (e) { setInterpErr(errorOf(e)); } finally { setBusy(null); }
  };
  const scale = tool ? toolLike(tool) : null;
  const canVerify = can('assessments.verify') && result.status === 'submitted';

  return (
    <Drawer open title={`${subject} · ${result.measurement_point}`} onClose={onClose} wide>
      <div className="stack">
        <dl className="kv">
          <dt>{tr('الأداة', 'Tool')}</dt><dd>{tool ? `${pick(tool.name, tool.name_en)} · v${result.tool_version ?? tool.version}` : '—'}</dd>
          <dt>{tr('البرنامج', 'Program')}</dt><dd>{programName}</dd>
          <dt>{tr('الدرجة الكلية', 'Total')}</dt><dd className="mono">{result.total_score ?? '—'}</dd>
          <dt>{tr('الموحدة', 'Normalized')}</dt><dd className="mono">{num(result.normalized_score) === null ? '—' : `${fmtNumber(num(result.normalized_score), 1)}%`}</dd>
          <dt>{tr('التصنيف', 'Classification')}</dt><dd>{pick(result.interpretation?.label_ar as string | undefined, result.interpretation?.label_en as string | undefined) || result.classification_label || '—'}</dd>
          <dt>{tr('التفسير', 'Interpretation')}</dt><dd className="small">{pick(result.interpretation?.interpretation_ar as string | undefined, result.interpretation?.interpretation_en as string | undefined) || '—'}</dd>
          <dt>{tr('الحالة', 'Status')}</dt><dd><StatusBadge group="resultStatus" value={result.status} /></dd>
          <dt>{tr('المقيّم', 'Assessor')}</dt><dd>{result.assessor_user_id ? users[result.assessor_user_id] ?? result.assessor_user_id.slice(0, 8) : '—'} · {fmtDateTime(result.assessed_at)}</dd>
          {result.verified_at && <><dt>{tr('تحقق/قرار بواسطة', 'Decided by')}</dt><dd>{result.verified_by ? users[result.verified_by] ?? result.verified_by.slice(0, 8) : '—'} · {fmtDateTime(result.verified_at)}</dd></>}
          {result.notes && <><dt>{tr('ملاحظات', 'Notes')}</dt><dd className="small" style={{ whiteSpace: 'pre-wrap' }}>{result.notes}</dd></>}
        </dl>
        <Card>
          <CardHeader title={tr('درجات الأبعاد', 'Dimension scores')} />
          <CardBody>
            <AsyncView state={dims}>{(ds) => (
              <BarList max={scale?.scale_max} format={(v) => fmtNumber(v, 2)}
                items={ds.filter((d) => result.dimension_scores?.[d.id] !== undefined).map((d) => ({ label: pick(d.name, d.name_en), value: Number(result.dimension_scores[d.id]) }))} />
            )}</AsyncView>
          </CardBody>
        </Card>
        {result.external_raw && <details><summary className="small">{tr('البيانات الخام المستوردة', 'Raw imported data')}</summary><pre className="mono tiny" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(result.external_raw, null, 2)}</pre></details>}

        {canVerify && (
          <Card>
            <CardHeader title={tr('التحقق من النتيجة', 'Verify result')} hint={tr('تتطلب assessments.verify؛ يسجل الخادم المتحقق والوقت', 'Requires assessments.verify; the server stamps verifier and time')} />
            <CardBody>
              <Field label={tr('ملاحظة التحقق (إلزامية عند الرفض)', 'Verification note (required to reject)')}><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></Field>
              {err && <Notice tone="danger">{locale === 'ar' ? err.message_ar : err.message_en}</Notice>}
              <div className="row" style={{ marginTop: 8 }}>
                <Button variant="primary" icon={<CheckCircle2 />} loading={busy === 'verified'} onClick={() => decide('verified')}>{tr('تحقق', 'Verify')}</Button>
                <Button variant="danger" icon={<XCircle />} loading={busy === 'rejected'} onClick={() => decide('rejected')}>{tr('رفض', 'Reject')}</Button>
              </div>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader icon={<Sparkles size={16} />} title={tr('التفسير من الخادم', 'Server interpretation')}
            actions={<Button size="sm" loading={busy === 'interp'} onClick={interpret}>{tr('تفسير', 'Interpret')}</Button>} />
          <CardBody>
            <FunctionError error={interpErr} />
            {!interp && !interpErr && <p className="small muted">{tr('يولّد الخادم نقاط القوة ومجالات التطوير والتوصيات بناءً على الأبعاد والتصنيف.', 'The server derives strengths, development areas and recommendations from the dimensions and classification.')}</p>}
            {interp && (
              <div className="stack-sm">
                <GeneratedBy value={interp.generated_by} />
                <b className="small">{tr('نقاط القوة', 'Strengths')}</b><RichList items={interp.strengths} />
                <b className="small">{tr('مجالات التطوير', 'Development areas')}</b><RichList items={interp.development_areas} />
                <b className="small">{tr('التوصيات', 'Recommendations')}</b><RichList items={interp.recommendations} />
                {interp.narrative ? <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{text(interp.narrative)}</p> : null}
                <p className="tiny muted">{tr('توصيات استرشادية لا تُطبّق تلقائيًا.', 'Advisory recommendations; nothing is applied automatically.')}</p>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </Drawer>
  );
}

interface CohortResponse { n?: number; mean?: number | null; distribution?: unknown; dimensions?: unknown; narrative?: unknown; generated_by?: string }

function CohortPanel({ programs, tools, initial }: { programs: ProgramLite[]; tools: AssessmentTool[]; initial: { program: string; tool: string; point: string } }) {
  const { tr, pick, fmtNumber, enumOptions } = useI18n();
  const { org } = useOrg();
  const text = useRichText();
  const [sel, setSel] = useState(initial);
  const [server, setServer] = useState<CohortResponse | null>(null);
  const [serverErr, setServerErr] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  const data = useAsync(async () => {
    if (!sel.tool || !sel.program) return null;
    const [bundle, rows] = await Promise.all([
      loadToolBundle(sel.tool),
      all<AssessmentResult>('assessment_results', { filters: [['organization_id', 'eq', org.id], ['tool_id', 'eq', sel.tool], ['program_id', 'eq', sel.program], ['status', 'neq', 'rejected']], order: { column: 'assessed_at', ascending: true } }),
    ]);
    return { bundle, rows };
  }, [sel.tool, sel.program, org.id]);

  const analysis = useMemo(() => {
    const d = data.data;
    if (!d) return null;
    const bands: ClassBand[] = Array.isArray(d.bundle.tool.classification) ? d.bundle.tool.classification : [];
    const at = d.rows.filter((r) => r.measurement_point === sel.point);
    const norms = at.map((r) => num(r.normalized_score)).filter((x): x is number => x !== null);
    const mean = norms.length ? norms.reduce((a, b) => a + b, 0) / norms.length : null;
    const dist = bands.map((bd) => ({ band: bd, n: norms.filter((x) => classify(bands, x) === bd).length }));
    const unclassified = norms.filter((x) => !classify(bands, x)).length;
    const passN = at.filter((r) => r.passed === true).length;
    const passKnown = at.filter((r) => r.passed !== null).length;
    const heat = d.bundle.dims.map((dim) => MEASUREMENT_KEYS.map((p) => {
      const xs = d.rows.filter((r) => r.measurement_point === p && r.dimension_scores?.[dim.id] !== undefined).map((r) => Number(r.dimension_scores[dim.id]));
      return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null;
    }));
    const key = (r: AssessmentResult) => r.beneficiary_id ?? r.team_id ?? r.expert_id ?? '';
    const latestBy = (p: string) => { const m = new Map<string, AssessmentResult>(); for (const r of d.rows.filter((x) => x.measurement_point === p && key(x))) m.set(key(r), r); return m; };
    const t0 = latestBy('T0'); const t1 = latestBy('T1');
    const pairedKeys = [...t0.keys()].filter((k) => t1.has(k));
    const paired = d.bundle.dims.map((dim) => {
      const pairs = pairedKeys.map((k) => [t0.get(k)!.dimension_scores?.[dim.id], t1.get(k)!.dimension_scores?.[dim.id]]).filter((p): p is [number, number] => p[0] !== undefined && p[1] !== undefined).map(([a, b]) => [Number(a), Number(b)] as [number, number]);
      const mb = pairs.length ? pairs.reduce((s, p) => s + p[0], 0) / pairs.length : null;
      const ma = pairs.length ? pairs.reduce((s, p) => s + p[1], 0) / pairs.length : null;
      return { dim, n: pairs.length, before: mb, after: ma, change: mb !== null && ma !== null ? ma - mb : null, improved: pairs.filter((p) => p[1] - p[0] > 0).length };
    });
    return { n: at.length, mean, dist, unclassified, passN, passKnown, heat, paired, pairedN: pairedKeys.length, bands };
  }, [data.data, sel.point]);

  const runServer = async () => {
    setBusy(true); setServerErr(null);
    try { setServer(await callFunction<CohortResponse>('ai-assessment-interpretation', { mode: 'cohort', organization_id: org.id, tool_id: sel.tool, program_id: sel.program || undefined, measurement_point: sel.point || undefined })); }
    catch (e) { setServerErr(errorOf(e)); } finally { setBusy(false); }
  };
  const bandTone = (b: ClassBand): 'success' | 'warning' | 'danger' | undefined => (b.min >= 60 ? 'success' : b.min >= 40 ? 'warning' : 'danger');

  return (
    <Card>
      <CardHeader icon={<BarChart3 size={16} />} title={tr('تحليل الدفعة', 'Cohort analysis')} hint={tr('محسوب محليًا من النتائج غير المرفوضة', 'Computed locally from non-rejected results')}
        actions={<div className="row wrap">
          <Select value={sel.program} onChange={(e) => { setSel((s) => ({ ...s, program: e.target.value })); setServer(null); }} placeholder={tr('— البرنامج —', '— Program —')} options={programs.map((p) => ({ value: p.id, label: pick(p.name, p.name_en) }))} />
          <Select value={sel.tool} onChange={(e) => { setSel((s) => ({ ...s, tool: e.target.value })); setServer(null); }} placeholder={tr('— الأداة —', '— Tool —')} options={tools.map((t) => ({ value: t.id, label: `${pick(t.name, t.name_en)} · v${t.version}` }))} />
          <Select value={sel.point} onChange={(e) => { setSel((s) => ({ ...s, point: e.target.value })); setServer(null); }} options={enumOptions('measurementPoint')} />
        </div>} />
      <CardBody>
        {!sel.tool || !sel.program ? <EmptyState compact title={tr('اختر البرنامج والأداة لتحليل الدفعة', 'Choose a program and tool to analyse the cohort')} /> : (
          <AsyncView state={data}>{() => !analysis ? null : (
            <div className="stack">
              <div className="grid g4">
                <Kpi label={tr('عدد النتائج', 'Results (n)')} value={analysis.n} hint={sel.point} />
                <Kpi label={tr('المتوسط الموحد', 'Mean normalized')} value={analysis.mean === null ? '—' : `${fmtNumber(analysis.mean, 1)}%`} />
                <Kpi label={tr('نسبة النجاح', 'Pass rate')} value={analysis.passKnown ? `${fmtNumber((analysis.passN / analysis.passKnown) * 100, 0)}%` : '—'} hint={`${analysis.passN}/${analysis.passKnown}`} />
                <Kpi label={tr('أزواج T0/T1', 'T0/T1 pairs')} value={analysis.pairedN} tone={analysis.pairedN < 5 ? 'warning' : undefined} />
              </div>
              {analysis.n > 0 && analysis.n < 5 && <Notice tone="warning">{tr('العينة صغيرة جدًا (أقل من 5)؛ عامل المتوسطات كمؤشرات فقط.', 'Very small sample (< 5); treat averages as indicative only.')}</Notice>}
              <div className="grid g2">
                <div className="stack-sm">
                  <b className="small">{tr('التوزيع على فئات التصنيف', 'Distribution across classification bands')}</b>
                  {analysis.bands.length ? <BarList items={analysis.dist.map((x) => ({ label: `${pick(x.band.label_ar, x.band.label_en)} (${x.band.min}–${x.band.max})`, value: x.n, tone: bandTone(x.band) }))} /> : <Notice tone="warning">{tr('الأداة بلا فئات تصنيف.', 'The tool has no classification bands.')}</Notice>}
                  {analysis.unclassified > 0 && <span className="tiny muted">{tr('غير مصنفة', 'Unclassified')}: {analysis.unclassified}</span>}
                </div>
                <div className="stack-sm">
                  <b className="small">{tr('متوسط الأبعاد عبر نقاط القياس', 'Dimension means across measurement points')}</b>
                  {data.data && data.data.bundle.dims.length ? (
                    <Heatmap rows={data.data.bundle.dims.map((d) => pick(d.name, d.name_en))} columns={[...MEASUREMENT_KEYS]} values={analysis.heat}
                      max={Number(data.data.bundle.tool.scale_max)} format={(v) => fmtNumber(v, 2)} />
                  ) : <span className="small muted">—</span>}
                </div>
              </div>
              <div className="stack-sm">
                <b className="small">{tr('التغير المقترن T0 → T1 لكل بعد', 'Paired change T0 → T1 per dimension')}</b>
                {analysis.pairedN === 0 ? <Notice tone="info">{tr('لا توجد أزواج لنفس المُقيَّم في T0 وT1 بعد.', 'No subjects have both T0 and T1 results yet.')}</Notice> : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>{tr('البعد', 'Dimension')}</th><th className="num">n</th><th className="num">T0</th><th className="num">T1</th><th className="num">{tr('التغير', 'Change')}</th><th className="num">{tr('تحسّن', 'Improved')}</th></tr></thead>
                      <tbody>{analysis.paired.map((p) => (
                        <tr key={p.dim.id}>
                          <td>{pick(p.dim.name, p.dim.name_en)}</td><td className="num">{p.n}</td>
                          <td className="num">{fmtNumber(p.before, 2)}</td><td className="num">{fmtNumber(p.after, 2)}</td>
                          <td className="num"><b style={{ color: p.change === null ? undefined : p.change > 0 ? 'var(--success)' : p.change < 0 ? 'var(--danger)' : undefined }}>{p.change === null ? '—' : `${p.change > 0 ? '+' : ''}${fmtNumber(p.change, 2)}`}</b></td>
                          <td className="num">{p.n ? `${p.improved}/${p.n}` : '—'}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
                <p className="tiny muted">{tr('تغير مُلاحظ قبل/بعد؛ لا يثبت وحده أن البرنامج سبّبه.', 'Observed before/after change; on its own it does not prove the program caused it.')}</p>
              </div>
              <div className="stack-sm">
                <div className="row between"><b className="small">{tr('تفسير الخادم للدفعة', 'Server cohort interpretation')}</b>
                  <Button size="sm" icon={<Sparkles />} loading={busy} onClick={runServer}>{tr('تفسير من الخادم', 'Server interpretation')}</Button></div>
                <FunctionError error={serverErr} />
                {server && (
                  <div className="stack-sm">
                    <GeneratedBy value={server.generated_by} />
                    <div className="small">n = {server.n ?? '—'} · {tr('المتوسط', 'mean')} = {server.mean === null || server.mean === undefined ? '—' : fmtNumber(Number(server.mean), 2)}</div>
                    {server.distribution ? <div className="small"><b>{tr('التوزيع', 'Distribution')}: </b>{text(server.distribution)}</div> : null}
                    {server.dimensions ? <div className="small"><b>{tr('الأبعاد', 'Dimensions')}: </b><RichList items={server.dimensions} /></div> : null}
                    {server.narrative ? <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{text(server.narrative)}</p> : null}
                  </div>
                )}
              </div>
            </div>
          )}</AsyncView>
        )}
      </CardBody>
    </Card>
  );
}
