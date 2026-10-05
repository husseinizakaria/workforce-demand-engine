// External assessment imports: local parse preview, column mapping, server
// dry run (matching) and the real import; plus import history.
import { useEffect, useMemo, useState } from 'react';
import { FileUp, PlayCircle, Upload } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAsync } from '@/hooks/useAsync';
import { useConfirm } from '@/components/ui';
import { all } from '@/services/db';
import { callFunction } from '@/services/functions';
import { uploadFile } from '@/services/storage';
import { errorOf, type AppError } from '@/services/errors';
import { parseDelimited } from '@/utils/csv';
import {
  AsyncView, Badge, Button, Card, CardBody, CardHeader, DataTable, Drawer, EmptyState, Field, FileDrop, Input, Kpi, Notice, Segmented, Select, Textarea, type Column,
} from '@/components/ui';
import type { ExternalAssessmentImport } from '@/types/db';
import { loadOrgTools, loadToolBundle, nameMap, type ProgramLite } from '../api';
import { FunctionError, useRichText } from './Shared';

type IdType = 'code' | 'email' | 'national_id';
interface ImportResponse {
  import_id: string | null; rows: number; matched: number; imported: number;
  unmatched: { row: number; identifier: string }[]; preview: { identifier: string; beneficiary_id: string | null; dimension_scores: Record<string, number> }[];
}
const ID_GUESS: Record<IdType, RegExp> = { code: /code|رمز|id$/i, email: /mail|بريد/i, national_id: /national|هوية|nid|iqama/i };

export function ImportsTab({ programs, initialProgram }: { programs: ProgramLite[]; initialProgram: string | null }) {
  const { tr, pick, enumOptions, fmtNumber, fmtDateTime } = useI18n();
  const { org, can } = useOrg();
  const confirm = useConfirm();
  const [source, setSource] = useState<'file' | 'paste'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<{ path: string; forFile: File } | null>(null);
  const [text, setText] = useState('');
  const [toolId, setToolId] = useState('');
  const [programId, setProgramId] = useState(initialProgram ?? '');
  const [point, setPoint] = useState('T0');
  const [provider, setProvider] = useState('');
  const [idType, setIdType] = useState<IdType>('code');
  const [idCol, setIdCol] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [srcMin, setSrcMin] = useState('');
  const [srcMax, setSrcMax] = useState('');
  const [busy, setBusy] = useState<'dry' | 'import' | null>(null);
  const [err, setErr] = useState<AppError | null>(null);
  const [result, setResult] = useState<{ dry: boolean; data: ImportResponse } | null>(null);
  const [fileText, setFileText] = useState('');
  const [openImport, setOpenImport] = useState<ExternalAssessmentImport | null>(null);

  const tools = useAsync(() => loadOrgTools(org.id), [org.id]);
  const usable = useMemo(() => (tools.data ?? []).filter((t) => t.status !== 'archived'), [tools.data]);
  const bundle = useAsync(async () => (toolId ? loadToolBundle(toolId) : null), [toolId]);
  const history = useAsync(() => all<ExternalAssessmentImport>('external_assessment_imports', { filters: [['organization_id', 'eq', org.id]], order: { column: 'created_at' } }, 500), [org.id]);

  useEffect(() => { if (file) file.text().then(setFileText).catch(() => setFileText('')); else setFileText(''); }, [file]);
  const raw = source === 'file' ? fileText : text;
  const parsed = useMemo(() => (raw.trim() ? parseDelimited(raw) : []), [raw]);
  const headers = parsed[0] ?? [];
  const body = parsed.slice(1);

  // Auto-map: identifier column and dimension columns by code / name.
  useEffect(() => {
    if (!headers.length) return;
    if (!idCol || !headers.includes(idCol)) setIdCol(headers.find((h) => ID_GUESS[idType].test(h)) ?? '');
    const b = bundle.data;
    if (b) {
      const next: Record<string, string> = {};
      for (const d of b.dims) {
        const hit = headers.find((h) => [d.code, d.name, d.name_en ?? ''].some((x) => x && h.trim().toLowerCase() === x.trim().toLowerCase()));
        next[d.id] = mapping[d.id] && headers.includes(mapping[d.id]) ? mapping[d.id] : hit ?? '';
      }
      setMapping(next);
    }
  }, [headers.join('\u0001'), bundle.data?.tool.id, idType]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = bundle.data?.tool;
    if (t) { setProvider(t.provider ?? ''); setSrcMin(String(t.scale_min)); setSrcMax(String(t.scale_max)); }
    setResult(null);
  }, [bundle.data?.tool.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const colNums = useMemo(() => {
    const out: Record<string, { min: number; max: number; nonNumeric: number }> = {};
    headers.forEach((h, i) => {
      const xs = body.map((r) => r[i]).filter((x) => x !== undefined && x !== '');
      const nums = xs.map(Number).filter(Number.isFinite);
      out[h] = { min: nums.length ? Math.min(...nums) : NaN, max: nums.length ? Math.max(...nums) : NaN, nonNumeric: xs.length - nums.length };
    });
    return out;
  }, [parsed]); // eslint-disable-line react-hooks/exhaustive-deps

  const mappedDims = Object.entries(mapping).filter(([, c]) => c);
  const problems: [string, string][] = [];
  if (!parsed.length) problems.push(['لا توجد بيانات مقروءة بعد', 'No readable data yet']);
  if (!toolId) problems.push(['اختر الأداة', 'Choose the tool']);
  if (!idCol) problems.push(['حدد عمود المعرّف', 'Choose the identifier column']);
  if (toolId && !mappedDims.length) problems.push(['اربط بعدًا واحدًا على الأقل بعمود', 'Map at least one dimension to a column']);
  const sMin = Number(srcMin); const sMax = Number(srcMax);
  if (srcMin === '' || srcMax === '' || !(sMax > sMin)) problems.push(['نطاق المقياس المصدر غير صالح', 'Invalid source scale range']);
  const warnings: [string, string][] = [];
  for (const [dimId, col] of mappedDims) {
    const st = colNums[col]; const d = bundle.data?.dims.find((x) => x.id === dimId);
    if (!st || !d) continue;
    if (st.nonNumeric) warnings.push([`العمود «${col}» يحوي ${st.nonNumeric} قيمة غير رقمية ستُهمل`, `Column “${col}” has ${st.nonNumeric} non-numeric value(s) that will be ignored`]);
    if (Number.isFinite(st.min) && (st.min < sMin || st.max > sMax)) warnings.push([`قيم «${col}» (${st.min}–${st.max}) خارج نطاق المصدر ${sMin}–${sMax}`, `Values of “${col}” (${st.min}–${st.max}) fall outside the source range ${sMin}–${sMax}`]);
  }
  const dupCols = mappedDims.map(([, c]) => c).filter((c, i, a) => a.indexOf(c) !== i);
  if (dupCols.length) warnings.push([`عمود مستخدم لأكثر من بعد: ${[...new Set(dupCols)].join('، ')}`, `Column mapped to several dimensions: ${[...new Set(dupCols)].join(', ')}`]);
  if (bundle.data?.tool.tool_type === 'internal') warnings.push(['الأداة داخلية؛ الاستيراد مناسب عادةً للأدوات الخارجية (مثل Hogan).', 'This is an internal tool; imports usually target external tools (e.g., Hogan).']);

  const run = async (dry: boolean) => {
    if (problems.length) return;
    if (!dry && !(await confirm({ title: tr('تأكيد الاستيراد', 'Confirm import'), message: tr(`سيتم إنشاء نتائج تقييم للسجلات المطابقة (${body.length} صف). لا يمكن التراجع إلا بحذف النتائج.`, `Assessment results will be created for matched rows (${body.length} rows). Undo requires deleting the results.`), confirmLabel: tr('استيراد', 'Import') }))) return;
    setBusy(dry ? 'dry' : 'import'); setErr(null);
    try {
      const payload: Record<string, unknown> = {
        organization_id: org.id, tool_id: toolId, program_id: programId || undefined, measurement_point: point, provider: provider.trim() || undefined,
        mapping: { identifier: idType, identifier_column: idCol, dimensions: Object.fromEntries(mappedDims) },
        source_scale: { min: sMin, max: sMax }, dry_run: dry,
      };
      if (source === 'file' && file) {
        let path = uploaded?.forFile === file ? uploaded.path : null;
        if (!path) { path = (await uploadFile('imports', org.id, 'assessments', file)).path; setUploaded({ path, forFile: file }); }
        payload.file_path = path;
      } else payload.csv_text = text;
      const data = await callFunction<ImportResponse>('import-external-assessment', payload);
      setResult({ dry, data });
      if (!dry) void history.reload();
    } catch (e) { setErr(errorOf(e)); } finally { setBusy(null); }
  };

  const previewNames = useAsync(() => nameMap('beneficiaries', (result?.data.preview ?? []).map((p) => p.beneficiary_id ?? '')), [result]);
  const dimName = (id: string) => { const d = bundle.data?.dims.find((x) => x.id === id); return d ? pick(d.name, d.name_en) : id.slice(0, 6); };
  const toolName = (id: string) => { const t = (tools.data ?? []).find((x) => x.id === id); return t ? `${pick(t.name, t.name_en)} · v${t.version}` : '—'; };

  const histCols: Column<ExternalAssessmentImport>[] = [
    { key: 'date', header: tr('التاريخ', 'Date'), value: (r) => r.created_at, render: (r) => fmtDateTime(r.created_at) },
    { key: 'file', header: tr('الملف', 'File'), value: (r) => r.original_filename ?? '', render: (r) => r.original_filename ?? <span className="muted">{tr('نص ملصق', 'Pasted text')}</span> },
    { key: 'tool', header: tr('الأداة', 'Tool'), value: (r) => toolName(r.tool_id) },
    { key: 'provider', header: tr('المزوّد', 'Provider'), value: (r) => r.provider ?? '' },
    { key: 'point', header: tr('النقطة', 'Point'), value: (r) => r.measurement_point ?? '' },
    { key: 'status', header: tr('الحالة', 'Status'), value: (r) => r.status, render: (r) => <Badge tone={r.status === 'imported' ? 'success' : r.status === 'failed' ? 'danger' : r.status === 'partially_imported' ? 'warning' : 'info'}>{importStatus(r.status, tr)}</Badge> },
    { key: 'rows', header: tr('الصفوف', 'Rows'), align: 'end', value: (r) => r.row_count },
    { key: 'imported', header: tr('المستورد', 'Imported'), align: 'end', value: (r) => r.imported_count },
    { key: 'unmatched', header: tr('غير المطابق', 'Unmatched'), align: 'end', value: (r) => (Array.isArray(r.unmatched) ? r.unmatched.length : 0) },
  ];

  return (
    <div className="stack">
      {!can('assessments.create') && <Notice tone="info">{tr('الاستيراد يتطلب صلاحية assessments.create؛ يمكنك عرض السجل فقط.', 'Importing requires assessments.create; you can view the history only.')}</Notice>}
      {can('assessments.create') && (
        <div className="grid g-2-1">
          <Card>
            <CardHeader icon={<FileUp size={16} />} title={tr('استيراد نتائج تقييم خارجي', 'Import external assessment results')} hint={tr('CSV أو TSV بصف عناوين', 'CSV or TSV with a header row')} />
            <CardBody>
              <div className="stack">
                <Segmented value={source} onChange={(v) => { setSource(v); setResult(null); }} options={[{ value: 'file', label: tr('رفع ملف', 'Upload file') }, { value: 'paste', label: tr('لصق نص', 'Paste text') }]} />
                {source === 'file'
                  ? <FileDrop accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" file={file} onFiles={(fs) => { setFile(fs[0] ?? null); setResult(null); }} />
                  : <Textarea rows={6} className="mono" value={text} onChange={(e) => { setText(e.target.value); setResult(null); }} placeholder={'code,D1,D2\nBEN-2026-0001,72,64'} dir="ltr" />}
                <div className="form-grid">
                  <Field label={tr('الأداة', 'Tool')} required>
                    <Select value={toolId} onChange={(e) => setToolId(e.target.value)} placeholder={tr('— اختر —', '— Select —')}
                      options={usable.map((t) => ({ value: t.id, label: `${pick(t.name, t.name_en)} · v${t.version} (${t.tool_type === 'external' ? tr('خارجية', 'external') : tr('داخلية', 'internal')})` }))} />
                  </Field>
                  <Field label={tr('البرنامج', 'Program')}>
                    <Select value={programId} onChange={(e) => setProgramId(e.target.value)} placeholder={tr('— دون برنامج —', '— No program —')} options={programs.map((p) => ({ value: p.id, label: pick(p.name, p.name_en) }))} />
                  </Field>
                  <Field label={tr('نقطة القياس', 'Measurement point')} required><Select value={point} onChange={(e) => setPoint(e.target.value)} options={enumOptions('measurementPoint')} /></Field>
                  <Field label={tr('المزوّد', 'Provider')}><Input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Hogan, SHL…" /></Field>
                  <Field label={tr('نوع المعرّف', 'Identifier type')} required hint={tr('تتم المطابقة مع سجلات المستفيدين', 'Matched against beneficiary records')}>
                    <Select value={idType} onChange={(e) => setIdType(e.target.value as IdType)} options={[{ value: 'code', label: tr('رمز المستفيد', 'Beneficiary code') }, { value: 'email', label: tr('البريد الإلكتروني', 'Email') }, { value: 'national_id', label: tr('رقم الهوية', 'National ID') }]} />
                  </Field>
                  <Field label={tr('عمود المعرّف', 'Identifier column')} required>
                    <Select value={idCol} onChange={(e) => setIdCol(e.target.value)} placeholder={tr('— اختر —', '— Select —')} options={headers.map((h) => ({ value: h, label: h }))} />
                  </Field>
                  <Field label={tr('أدنى قيمة في المصدر', 'Source scale min')} hint={tr('مثال: Hogan بالمئينات 0', 'e.g. Hogan percentiles 0')}><Input type="number" className="ltr" value={srcMin} onChange={(e) => setSrcMin(e.target.value)} /></Field>
                  <Field label={tr('أعلى قيمة في المصدر', 'Source scale max')} hint={bundle.data ? tr(`تُحوَّل خطيًا إلى مقياس الأداة ${bundle.data.tool.scale_min}–${bundle.data.tool.scale_max}`, `Linearly rescaled to the tool scale ${bundle.data.tool.scale_min}–${bundle.data.tool.scale_max}`) : undefined}>
                    <Input type="number" className="ltr" value={srcMax} onChange={(e) => setSrcMax(e.target.value)} />
                  </Field>
                </div>
                {bundle.data && (
                  <div className="stack-sm">
                    <b className="small">{tr('ربط الأبعاد بالأعمدة', 'Map dimensions to columns')}</b>
                    {!bundle.data.dims.length && <Notice tone="danger">{tr('الأداة بلا أبعاد.', 'The tool has no dimensions.')}</Notice>}
                    <div className="form-grid">
                      {bundle.data.dims.map((d) => (
                        <Field key={d.id} label={`${pick(d.name, d.name_en)} (${d.code})`}>
                          <Select value={mapping[d.id] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [d.id]: e.target.value }))} placeholder={tr('— غير مستورد —', '— Not imported —')} options={headers.map((h) => ({ value: h, label: h }))} />
                        </Field>
                      ))}
                    </div>
                  </div>
                )}
                {problems.length > 0 && parsed.length > 0 && <Notice tone="warning"><ul style={{ margin: 0, paddingInlineStart: 16 }}>{problems.map((p, i) => <li key={i}>{tr(p[0], p[1])}</li>)}</ul></Notice>}
                {warnings.length > 0 && <Notice tone="info"><ul style={{ margin: 0, paddingInlineStart: 16 }}>{warnings.map((p, i) => <li key={i}>{tr(p[0], p[1])}</li>)}</ul></Notice>}
                {err && <FunctionError error={err} />}
                <div className="row">
                  <Button icon={<PlayCircle />} loading={busy === 'dry'} disabled={!!problems.length || !!busy} onClick={() => run(true)}>{tr('تشغيل تجريبي', 'Dry run')}</Button>
                  <Button variant="primary" icon={<Upload />} loading={busy === 'import'} disabled={!!problems.length || !!busy} onClick={() => run(false)}>{tr('استيراد', 'Import')}</Button>
                  {!result?.dry && <span className="tiny muted">{tr('يُنصح بالتشغيل التجريبي أولًا لمراجعة المطابقة', 'Run a dry run first to review matching')}</span>}
                </div>
              </div>
            </CardBody>
          </Card>
          <div className="stack">
            <Card>
              <CardHeader title={tr('معاينة محلية للملف', 'Local file preview')} hint={parsed.length ? tr(`${body.length} صف · ${headers.length} عمود`, `${body.length} rows · ${headers.length} columns`) : undefined} />
              <CardBody flush>
                {!parsed.length ? <EmptyState compact title={tr('لم تُقرأ بيانات بعد', 'Nothing parsed yet')} /> : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr>{headers.map((h) => <th key={h}>{h}{h === idCol && <Badge tone="primary">ID</Badge>}{mappedDims.some(([, c]) => c === h) && <Badge tone="success">{tr('بعد', 'dim')}</Badge>}</th>)}</tr></thead>
                      <tbody>{body.slice(0, 6).map((r, i) => <tr key={i}>{headers.map((_, j) => <td key={j} className="small">{r[j] ?? ''}</td>)}</tr>)}</tbody>
                    </table>
                  </div>
                )}
              </CardBody>
            </Card>
            {result && (
              <Card>
                <CardHeader title={result.dry ? tr('نتيجة التشغيل التجريبي', 'Dry-run result') : tr('نتيجة الاستيراد', 'Import result')} />
                <CardBody>
                  <div className="grid g3">
                    <Kpi label={tr('الصفوف', 'Rows')} value={result.data.rows} />
                    <Kpi label={tr('المطابقة', 'Matched')} value={result.data.matched} tone="success" />
                    <Kpi label={result.dry ? tr('غير المطابقة', 'Unmatched') : tr('المستوردة', 'Imported')} value={result.dry ? result.data.unmatched.length : result.data.imported} tone={result.dry && result.data.unmatched.length ? 'warning' : undefined} />
                  </div>
                  {result.data.unmatched.length > 0 && (
                    <details style={{ marginTop: 8 }} open={result.data.unmatched.length <= 10}>
                      <summary className="small">{tr('الصفوف غير المطابقة', 'Unmatched rows')} ({result.data.unmatched.length})</summary>
                      <ul className="small mono" style={{ margin: 0 }}>{result.data.unmatched.slice(0, 200).map((u, i) => <li key={i}>#{u.row}: {u.identifier || '—'}</li>)}</ul>
                    </details>
                  )}
                  {result.data.preview?.length > 0 && (
                    <div className="table-wrap" style={{ marginTop: 8 }}>
                      <table className="table">
                        <thead><tr><th>{tr('المعرّف', 'Identifier')}</th><th>{tr('المستفيد', 'Beneficiary')}</th><th>{tr('الدرجات بعد التحويل', 'Rescaled scores')}</th></tr></thead>
                        <tbody>{result.data.preview.slice(0, 20).map((p, i) => (
                          <tr key={i}><td className="mono small">{p.identifier}</td>
                            <td className="small">{p.beneficiary_id ? previewNames.data?.[p.beneficiary_id] ?? p.beneficiary_id.slice(0, 8) : <Badge tone="danger">{tr('غير مطابق', 'Unmatched')}</Badge>}</td>
                            <td className="small">{Object.entries(p.dimension_scores ?? {}).map(([k, v]) => `${dimName(k)}: ${fmtNumber(Number(v), 2)}`).join(' · ')}</td></tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                  {result.dry && result.data.matched > 0 && <p className="tiny muted" style={{ marginTop: 6 }}>{tr('لم يُحفظ شيء بعد. راجع المطابقة ثم اضغط «استيراد».', 'Nothing has been saved yet. Review the matching, then press “Import”.')}</p>}
                </CardBody>
              </Card>
            )}
          </div>
        </div>
      )}
      <Card>
        <CardHeader title={tr('سجل الاستيراد', 'Import history')} />
        <CardBody flush>
          <DataTable columns={histCols} rows={history.data ?? []} rowKey={(r) => r.id} loading={history.loading} error={history.error} onRetry={history.reload}
            onRowClick={setOpenImport} pageSize={15} exportName="assessment-imports" empty={{ title: tr('لا توجد عمليات استيراد', 'No imports yet') }} />
        </CardBody>
      </Card>
      {openImport && <ImportDrawer imp={openImport} toolName={toolName(openImport.tool_id)} programName={(() => { const p = programs.find((x) => x.id === openImport.program_id); return p ? pick(p.name, p.name_en) : '—'; })()} onClose={() => setOpenImport(null)} />}
    </div>
  );
}

function importStatus(s: ExternalAssessmentImport['status'], tr: (a: string, e: string) => string): string {
  return ({ uploaded: tr('مرفوع', 'Uploaded'), parsed: tr('مقروء', 'Parsed'), imported: tr('مستورد', 'Imported'), partially_imported: tr('مستورد جزئيًا', 'Partially imported'), failed: tr('فشل', 'Failed') } as const)[s] ?? s;
}

function ImportDrawer({ imp, toolName, programName, onClose }: { imp: ExternalAssessmentImport; toolName: string; programName: string; onClose: () => void }) {
  const { tr, fmtDateTime } = useI18n();
  const text = useRichText();
  const unmatched = Array.isArray(imp.unmatched) ? imp.unmatched : [];
  const results = useAsync(() => all<{ id: string; status: string }>('assessment_results', { select: 'id,status', filters: [['import_id', 'eq', imp.id]] }), [imp.id]);
  return (
    <Drawer open title={`${tr('استيراد', 'Import')} · ${imp.original_filename ?? imp.id.slice(0, 8)}`} onClose={onClose}>
      <div className="stack">
        <dl className="kv">
          <dt>{tr('الأداة', 'Tool')}</dt><dd>{toolName}</dd>
          <dt>{tr('البرنامج', 'Program')}</dt><dd>{programName}</dd>
          <dt>{tr('المزوّد', 'Provider')}</dt><dd>{imp.provider ?? '—'}</dd>
          <dt>{tr('النقطة', 'Point')}</dt><dd>{imp.measurement_point ?? '—'}</dd>
          <dt>{tr('الحالة', 'Status')}</dt><dd>{importStatus(imp.status, tr)}</dd>
          <dt>{tr('الصفوف / المستورد', 'Rows / imported')}</dt><dd>{imp.row_count} / {imp.imported_count}</dd>
          <dt>{tr('التاريخ', 'Date')}</dt><dd>{fmtDateTime(imp.created_at)}</dd>
          <dt>{tr('النتائج المرتبطة', 'Linked results')}</dt><dd><AsyncView state={results} rows={1}>{(rs) => <span>{rs.length}</span>}</AsyncView></dd>
        </dl>
        {imp.error && <Notice tone="danger">{imp.error}</Notice>}
        <div className="stack-sm"><b className="small">{tr('ربط الأعمدة', 'Column mapping')}</b><pre className="mono tiny" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(imp.column_mapping, null, 2)}</pre></div>
        <div className="stack-sm">
          <b className="small">{tr('غير المطابق', 'Unmatched')} ({unmatched.length})</b>
          {unmatched.length ? <ul className="small mono" style={{ margin: 0 }}>{unmatched.slice(0, 300).map((u, i) => <li key={i}>{text(u)}</li>)}</ul> : <span className="small muted">—</span>}
          {unmatched.length > 0 && <p className="tiny muted">{tr('أضف المستفيدين المفقودين أو صحح معرفاتهم ثم أعد الاستيراد للصفوف غير المطابقة فقط.', 'Add the missing beneficiaries or fix their identifiers, then re-import only the unmatched rows.')}</p>}
        </div>
      </div>
    </Drawer>
  );
}
