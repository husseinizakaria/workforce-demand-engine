// Report builder & viewer: configuration, generation (Edge Function, or a
// clearly labelled local rules preview), versions, rendering, print/CSV and the
// approval workflow (decisions are taken in Governance → Approvals).
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ArrowDown, ArrowUp, CheckCircle2, Cpu, Eye, FileText, Globe2, History, Play, Plus, Printer, Save, Send, Settings2, X,
} from 'lucide-react';
import { MEASUREMENT_POINTS, SECTION_CATALOG, buildReport, type ReportContent, type ReportType } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAuth } from '@/app/AuthProvider';
import {
  AsyncView, Badge, Button, Card, CardBody, CardHeader, Checkbox, DataTable, EmptyState, Field, Input, MultiCheck, Notice, PageHeader, Segmented,
  Select, StatusBadge, Tabs, Textarea, useConfirm, useToast, type Column,
} from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { all, get, insert, list, update } from '@/services/db';
import { callFunction } from '@/services/functions';
import { errorOf, type AppError } from '@/services/errors';
import { loadProgramBundle } from '@/services/programBundle';
import type { ApprovalRequest, Indicator, Program, Report, ReportVersion } from '@/types/db';
import { MANUAL_SECTIONS, ReportView, isReportContent, narrativeBlocks, parseConfig, type ReportConfig } from '../reportView';

interface Loaded { report: Report; program: Program | null; versions: ReportVersion[]; approval: ApprovalRequest | null }
const UNAVAILABLE = new Set(['function_unavailable', 'not_configured', '404']);

export default function ReportDetailPage() {
  const { reportId = '' } = useParams();
  const { tr } = useI18n();
  const { org } = useOrg();
  const state = useAsync<Loaded>(async () => {
    const report = await get<Report>('reports', reportId);
    const [program, versions, approval] = await Promise.all([
      report.program_id ? get<Program>('programs', report.program_id).catch(() => null) : Promise.resolve(null),
      all<ReportVersion>('report_versions', { filters: [['organization_id', 'eq', org.id], ['report_id', 'eq', reportId]], order: { column: 'version', ascending: false } }, 200),
      list<ApprovalRequest>('approval_requests', { filters: [['organization_id', 'eq', org.id], ['entity_type', 'eq', 'report'], ['entity_id', 'eq', reportId]], order: { column: 'created_at' }, pageSize: 1 })
        .then((r) => r.rows[0] ?? null).catch(() => null),
    ]);
    return { report, program, versions, approval };
  }, [reportId, org.id]);
  return (
    <AsyncView state={state}>
      {(d) => d.report.organization_id !== org.id
        ? <EmptyState title={tr('التقرير غير موجود في هذه المؤسسة', 'Report not found in this organization')} />
        : <ReportWorkspace d={d} reload={() => void state.reload()} />}
    </AsyncView>
  );
}

function ReportWorkspace({ d, reload }: { d: Loaded; reload: () => void }) {
  const { tr, pick, enumLabel, fmtDate, fmtDateTime, locale, L } = useI18n();
  const { org, can } = useOrg();
  const { user } = useAuth();
  const toast = useToast(); const confirm = useConfirm();
  const { report, program, versions, approval } = d;
  const config = useMemo(() => parseConfig(report.configuration), [report.configuration]);
  const [tab, setTab] = useState('report');
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [useLlm, setUseLlm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [fnUnavailable, setFnUnavailable] = useState<AppError | null>(null);
  const [preview, setPreview] = useState<ReportContent | null>(null);

  useEffect(() => { setSelectedVersion(null); }, [report.current_version]);
  const version = versions.find((v) => v.version === (selectedVersion ?? report.current_version)) ?? versions[0] ?? null;
  const msg = (e: unknown) => { const ae = errorOf(e); return locale === 'ar' ? ae.message_ar : ae.message_en; };
  const canGenerate = can('reports.create');
  const canEdit = can('reports.edit');
  const locked = ['in_review', 'approved', 'published'].includes(report.status);

  const confirmRegenerate = async () => {
    if (!['approved', 'published', 'in_review'].includes(report.status)) return true;
    return confirm({ title: tr('توليد إصدار جديد؟', 'Generate a new version?'), message: tr('التقرير قيد المراجعة أو معتمد؛ إصدار جديد يعيده إلى حالة «مُولّد» ويتطلب اعتمادًا جديدًا.', 'The report is in review or approved; a new version returns it to “generated” and requires a new approval.') });
  };

  const generate = async () => {
    if (!(await confirmRegenerate())) return;
    setBusy('generate');
    try {
      const manual_text = Object.fromEntries(Object.entries(config.narrative).filter(([, v]) => v.ar || v.en));
      const r = await callFunction<{ version: number; generator: string }>('generate-report', { report_id: report.id, use_llm: useLlm, manual_text });
      toast.success(tr(`تم توليد الإصدار ${r?.version ?? ''}`, `Version ${r?.version ?? ''} generated`));
      setPreview(null); setFnUnavailable(null); reload();
    } catch (e) {
      const ae = errorOf(e);
      if (UNAVAILABLE.has(ae.code)) setFnUnavailable(ae); else toast.error(msg(e));
    } finally { setBusy(null); }
  };

  const localPreview = async () => {
    if (!report.program_id) return;
    setBusy('preview');
    try {
      const b = await loadProgramBundle(report.program_id);
      if (config.indicators.length) {
        const keep = new Set(config.indicators);
        b.indicators = b.indicators.filter((i) => keep.has(i.id));
        b.measurements = b.measurements.filter((m) => keep.has(m.indicator_id));
      }
      const sections = config.sections.length ? [...config.sections] : undefined;
      if (sections && config.include_attachments && !sections.includes('appendices')) sections.push('appendices');
      const content = buildReport(report.report_type as ReportType, b, {
        sections, period_start: report.period_start, period_end: report.period_end, detail_level: config.detail_level,
        manual_text: config.narrative, compare_from: config.comparisons.points[0], compare_to: config.comparisons.points[1],
      });
      setPreview(content); setTab('report');
    } catch (e) { toast.error(msg(e)); } finally { setBusy(null); }
  };

  const savePreview = async () => {
    if (!preview || !(await confirmRegenerate())) return;
    setBusy('save');
    try {
      const next = Math.max(report.current_version, ...versions.map((v) => v.version), 0) + 1;
      await insert('report_versions', { organization_id: org.id, report_id: report.id, version: next, content: preview, narrative: {}, generator: 'rules', generated_by: user?.id ?? null });
      await update('reports', report.id, { current_version: next, status: 'generated', approved_by: null, approved_at: null });
      toast.success(tr(`حُفظت المعاينة كإصدار ${next} (مولّد بالقواعد)`, `Preview saved as version ${next} (rules-generated)`));
      setPreview(null); reload();
    } catch (e) { toast.error(msg(e)); } finally { setBusy(null); }
  };

  const submitForApproval = async () => {
    if (!(await confirm({ title: tr('إرسال التقرير للاعتماد؟', 'Submit report for approval?'), message: tr('سيُقفل التقرير للمراجعة، ويتخذ القرار من لديه صلاحية الاعتماد في الحوكمة (لا يمكن لمقدم الطلب اعتماد طلبه).', 'The report is locked for review; the decision is taken in Governance by an approver (requesters cannot approve their own request).') }))) return;
    setBusy('submit');
    try {
      await update('reports', report.id, { status: 'in_review' });
      try {
        await insert('approval_requests', {
          organization_id: org.id, program_id: report.program_id, entity_type: 'report', entity_id: report.id,
          title: `${tr('اعتماد تقرير', 'Report approval')}: ${report.title} (v${report.current_version})`,
          details: `${enumLabel('reportType', report.report_type)} · ${report.code}`,
        });
      } catch (e) { await update('reports', report.id, { status: report.status }).catch(() => undefined); throw e; }
      toast.success(tr('أُرسل التقرير للاعتماد', 'Report submitted for approval')); reload();
    } catch (e) { toast.error(msg(e)); } finally { setBusy(null); }
  };

  const publish = async () => {
    if (!(await confirm({ title: tr('نشر التقرير؟', 'Publish report?'), message: tr('يصبح الإصدار المعتمد هو الإصدار المنشور.', 'The approved version becomes the published version.') }))) return;
    setBusy('publish');
    try { await update('reports', report.id, { status: 'published' }); toast.success(tr('تم النشر', 'Published')); reload(); }
    catch (e) { toast.error(msg(e)); } finally { setBusy(null); }
  };

  const content = preview ?? (version && isReportContent(version.content) ? version.content : null);
  const narrative = preview ? {} : narrativeBlocks(version?.narrative, locale);
  const pendingApproval = approval?.status === 'pending';

  const header = content && (
    <Card className="report-title">
      <CardBody>
        <div className="stack-sm" style={{ textAlign: 'center', padding: '12px 0' }}>
          <span className="small muted">{pick(org.name, org.name_en)}</span>
          <h1 style={{ fontSize: 22, margin: 0 }}>{report.title}</h1>
          <span className="small">{program ? `${pick(program.name, program.name_en)} · ${program.code}` : content.program.name} · {L(content.program.track)}</span>
          <span className="small muted">{tr('الفترة', 'Period')}: {report.period_start || report.period_end ? `${fmtDate(report.period_start)} – ${fmtDate(report.period_end)}` : `${fmtDate(content.program.start_date)} – ${fmtDate(content.program.end_date)}`}</span>
          <div className="row wrap" style={{ justifyContent: 'center', gap: 6 }}>
            {preview ? <Badge tone="warning">{tr('معاينة محلية — غير محفوظة', 'Local preview — not saved')}</Badge> : <Badge tone="outline">{tr('الإصدار', 'Version')} {version?.version}</Badge>}
            {!preview && <StatusBadge group="reportStatus" value={report.status} />}
            <Badge tone="outline">{tr('وُلّد في', 'Generated')} {fmtDateTime(preview ? preview.generated_at : version?.generated_at)}</Badge>
            <Badge tone="outline">{generatorLabel(preview ? 'rules' : version?.generator ?? 'rules', tr)}</Badge>
          </div>
        </div>
      </CardBody>
    </Card>
  );

  return (
    <div className="stack">
      <PageHeader title={report.title} crumbs={[{ label: tr('التقارير', 'Reports'), to: '/app/reports' }, { label: report.code }]}
        badge={<StatusBadge group="reportStatus" value={report.status} />}
        subtitle={<>{enumLabel('reportType', report.report_type)} · {program ? <Link to={`/app/programs/${program.id}`}>{pick(program.name, program.name_en)}</Link> : '—'} · {tr('الإصدار الحالي', 'Current version')} {report.current_version || '—'}</>}
        actions={<div className="row wrap no-print">
          <Button icon={<Printer />} onClick={() => window.print()} disabled={!content}>{tr('طباعة / PDF', 'Print / PDF')}</Button>
          {canGenerate && <Checkbox label={tr('صياغة بالذكاء الاصطناعي', 'AI drafting')} checked={useLlm} onChange={setUseLlm} />}
          {canGenerate && <Button variant="primary" icon={<Play />} loading={busy === 'generate'} onClick={generate} disabled={!report.program_id}>{tr('توليد', 'Generate')}</Button>}
          {canEdit && report.status === 'generated' && report.current_version > 0 && !pendingApproval && <Button icon={<Send />} loading={busy === 'submit'} onClick={submitForApproval}>{tr('إرسال للاعتماد', 'Submit for approval')}</Button>}
          {canEdit && report.status === 'approved' && <Button icon={<Globe2 />} loading={busy === 'publish'} onClick={publish}>{tr('نشر', 'Publish')}</Button>}
        </div>} />

      <div className="no-print stack">
        {fnUnavailable && (
          <Notice tone="warning">
            <div className="stack-sm">
              <span>{locale === 'ar' ? fnUnavailable.message_ar : fnUnavailable.message_en} {tr('خدمة توليد التقارير على الخادم غير متاحة؛ لم يُنشأ أي إصدار.', 'The server report generator is unavailable; no version was created.')}</span>
              <span className="small">{tr('يمكنك توليد معاينة محلية بمحرك القواعد نفسه (دون ذكاء اصطناعي) ثم حفظها كإصدار مُعلَّم «مولّد بالقواعد».', 'You can generate a local preview with the same rules engine (no AI) and save it as a version labelled “rules-generated”.')}</span>
              <div><Button size="sm" icon={<Cpu />} loading={busy === 'preview'} onClick={localPreview} disabled={!report.program_id}>{tr('توليد معاينة محليًا', 'Generate preview locally')}</Button></div>
            </div>
          </Notice>
        )}
        {!report.program_id && <Notice tone="danger">{tr('التقرير غير مرتبط ببرنامج؛ لا يمكن توليده.', 'The report is not linked to a program; it cannot be generated.')}</Notice>}
        <ApprovalState report={report} approval={approval} />
        <Tabs value={tab} onChange={setTab} items={[
          { key: 'report', label: tr('التقرير', 'Report'), icon: <FileText /> },
          { key: 'config', label: tr('الإعداد', 'Configuration'), icon: <Settings2 /> },
          { key: 'versions', label: tr('الإصدارات', 'Versions'), icon: <History />, badge: versions.length ? <Badge>{versions.length}</Badge> : undefined },
        ]} />
      </div>

      {tab === 'report' && (content ? (
        <ReportView content={content} narrative={narrative} header={header}
          banner={preview ? (
            <div className="no-print">
              <Notice tone="warning">
                <div className="row between wrap">
                  <span>{tr('معاينة محلية مولّدة بمحرك القواعد في المتصفح — غير محفوظة ولا تتضمن صياغة ذكاء اصطناعي.', 'Local preview generated by the rules engine in your browser — not saved and without AI drafting.')}</span>
                  <span className="row">
                    <Button size="sm" icon={<X />} onClick={() => setPreview(null)}>{tr('تجاهل', 'Discard')}</Button>
                    {canGenerate && canEdit && <Button size="sm" variant="primary" icon={<Save />} loading={busy === 'save'} onClick={savePreview}>{tr('حفظ كإصدار', 'Save as version')}</Button>}
                  </span>
                </div>
              </Notice>
            </div>
          ) : selectedVersion !== null && selectedVersion !== report.current_version ? (
            <div className="no-print"><Notice tone="info">{tr(`تعرض إصدارًا سابقًا (v${selectedVersion}). الإصدار الحالي v${report.current_version}.`, `Viewing an earlier version (v${selectedVersion}). Current version is v${report.current_version}.`)} <button className="link-btn" onClick={() => setSelectedVersion(null)}>{tr('عرض الحالي', 'Show current')}</button></Notice></div>
          ) : undefined} />
      ) : (
        <Card><EmptyState icon={<FileText />} title={tr('لم يُولّد التقرير بعد', 'The report has not been generated yet')}
          description={tr('راجع الإعداد ثم اضغط «توليد». المحتوى يُبنى من بيانات البرنامج الفعلية فقط.', 'Review the configuration, then press “Generate”. Content is built from actual program data only.')}
          action={canGenerate && report.program_id ? <Button variant="primary" icon={<Play />} loading={busy === 'generate'} onClick={generate}>{tr('توليد', 'Generate')}</Button> : undefined} /></Card>
      ))}
      {tab === 'config' && <ConfigEditor report={report} config={config} canEdit={canEdit && !locked} locked={locked} onSaved={reload} />}
      {tab === 'versions' && <Versions versions={versions} current={report.current_version} selected={version?.version ?? null} onSelect={(v) => { setSelectedVersion(v); setPreview(null); setTab('report'); }} />}
    </div>
  );
}

function generatorLabel(g: string, tr: (a: string, e: string) => string): string {
  if (g === 'rules+llm') return tr('قواعد + مسودة ذكاء اصطناعي', 'Rules + AI draft');
  if (g === 'manual') return tr('يدوي', 'Manual');
  return tr('مولّد بالقواعد', 'Rules-generated');
}

function ApprovalState({ report, approval }: { report: Report; approval: ApprovalRequest | null }) {
  const { tr, fmtDateTime, enumLabel } = useI18n();
  if (report.status === 'published') return <Notice tone="success" icon={<Globe2 />}>{tr('التقرير منشور.', 'This report is published.')} {report.approved_at && `${tr('اعتُمد في', 'Approved on')} ${fmtDateTime(report.approved_at)}.`}</Notice>;
  if (!approval) return null;
  if (approval.status === 'pending') return (
    <Notice tone="info">{tr('بانتظار قرار الاعتماد منذ', 'Awaiting an approval decision since')} {fmtDateTime(approval.created_at)}. <Link to="/app/governance/approvals">{tr('الحوكمة ← الاعتمادات', 'Governance → Approvals')}</Link></Notice>
  );
  return (
    <Notice tone={approval.status === 'approved' ? 'success' : 'warning'} icon={<CheckCircle2 />}>
      {tr('آخر قرار اعتماد', 'Last approval decision')}: <b>{enumLabel('approvalStatus', approval.status)}</b> · {fmtDateTime(approval.decided_at)}
      {approval.decision_note && <> — «{approval.decision_note}»</>}
      {approval.status === 'rejected' && <> {tr('عُدّل التقرير إلى «مسودة»؛ عالج الملاحظات وأعد التوليد ثم الإرسال.', 'The report returned to “draft”; address the notes, regenerate and resubmit.')}</>}
    </Notice>
  );
}

// ----------------------------------------------------------------------------- Configuration editor
function ConfigEditor({ report, config, canEdit, locked, onSaved }: { report: Report; config: ReportConfig; canEdit: boolean; locked: boolean; onSaved: () => void }) {
  const { tr, L, pick, enumLabel, locale } = useI18n();
  const { org } = useOrg();
  const toast = useToast();
  const [sections, setSections] = useState<string[]>(config.sections);
  const [periodStart, setPeriodStart] = useState(report.period_start ?? '');
  const [periodEnd, setPeriodEnd] = useState(report.period_end ?? '');
  const [detail, setDetail] = useState(config.detail_level);
  const [from, setFrom] = useState(config.comparisons.points[0]);
  const [to, setTo] = useState(config.comparisons.points[1]);
  const [attach, setAttach] = useState(config.include_attachments);
  const [indicators, setIndicators] = useState<string[]>(config.indicators);
  const [narr, setNarr] = useState(config.narrative);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const inds = useAsync(async () => (report.program_id
    ? all<Indicator>('indicators', { select: 'id,code,name,name_en,indicator_type,status', filters: [['organization_id', 'eq', org.id], ['program_id', 'eq', report.program_id]], order: { column: 'code', ascending: true } }).catch(() => [] as Indicator[])
    : [] as Indicator[]), [report.program_id, org.id]);

  const move = (i: number, dir: -1 | 1) => setSections((s) => { const n = [...s]; const j = i + dir; if (j < 0 || j >= n.length) return s; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const unselected = Object.keys(SECTION_CATALOG).filter((k) => !sections.includes(k));
  const periodErr = !!periodStart && !!periodEnd && periodEnd < periodStart;
  const points = MEASUREMENT_POINTS.map((p) => ({ value: p.key, label: enumLabel('measurementPoint', p.key) }));
  const save = async () => {
    if (periodErr || !sections.length || from === to) return;
    setBusy(true);
    try {
      const cleanNarr = Object.fromEntries(Object.entries(narr).filter(([, v]) => (v.ar ?? '').trim() || (v.en ?? '').trim()));
      await update('reports', report.id, {
        period_start: periodStart || null, period_end: periodEnd || null,
        configuration: { ...(report.configuration ?? {}), sections, indicators, comparisons: { points: [from, to] }, detail_level: detail, include_attachments: attach, narrative: cleanNarr },
      });
      toast.success(tr('حُفظ الإعداد — أعد التوليد لتطبيقه على المحتوى', 'Configuration saved — regenerate to apply it to the content'));
      onSaved();
    } catch (e) { const ae = errorOf(e); toast.error(locale === 'ar' ? ae.message_ar : ae.message_en); } finally { setBusy(false); }
  };
  const manualSections = sections.filter((s) => MANUAL_SECTIONS.includes(s));
  return (
    <div className="stack">
      {locked && <Notice tone="info">{tr('التقرير قيد المراجعة أو معتمد أو منشور؛ الإعداد للقراءة فقط.', 'The report is in review, approved or published; the configuration is read-only.')}</Notice>}
      <div className="grid g-3-2">
        <Card>
          <CardHeader title={tr('الأقسام وترتيبها', 'Sections & order')} />
          <CardBody>
            <ol className="list-plain">
              {sections.map((s, i) => (
                <li key={s} className="row between">
                  <span className="small">{i + 1}. {SECTION_CATALOG[s] ? L(SECTION_CATALOG[s]) : s}{MANUAL_SECTIONS.includes(s) && <span className="tiny muted"> · {tr('يقبل نصًا يدويًا', 'accepts manual text')}</span>}</span>
                  {canEdit && <span className="row" style={{ gap: 2 }}>
                    <Button size="sm" variant="ghost" iconOnly icon={<ArrowUp />} disabled={i === 0} onClick={() => move(i, -1)} aria-label={tr('أعلى', 'Up')} />
                    <Button size="sm" variant="ghost" iconOnly icon={<ArrowDown />} disabled={i === sections.length - 1} onClick={() => move(i, 1)} aria-label={tr('أسفل', 'Down')} />
                    <Button size="sm" variant="ghost" iconOnly icon={<X />} onClick={() => setSections((x) => x.filter((k) => k !== s))} aria-label={tr('إزالة', 'Remove')} />
                  </span>}
                </li>
              ))}
            </ol>
            {!sections.length && <Notice tone="warning">{tr('اختر قسمًا واحدًا على الأقل.', 'Select at least one section.')}</Notice>}
            {canEdit && unselected.length > 0 && (
              <div className="row" style={{ marginTop: 8 }}>
                <Select options={unselected.map((k) => ({ value: k, label: L(SECTION_CATALOG[k]) }))} placeholder={tr('إضافة قسم…', 'Add section…')} value={adding} onChange={(e) => setAdding(e.target.value)} />
                <Button size="sm" icon={<Plus />} disabled={!adding} onClick={() => { setSections((x) => [...x, adding]); setAdding(''); }}>{tr('إضافة', 'Add')}</Button>
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={tr('النطاق والخيارات', 'Scope & options')} />
          <CardBody>
            <div className="stack">
              <div className="grid g2">
                <Field label={tr('بداية الفترة', 'Period start')}><Input type="date" value={periodStart} disabled={!canEdit} onChange={(e) => setPeriodStart(e.target.value)} /></Field>
                <Field label={tr('نهاية الفترة', 'Period end')} error={periodErr ? tr('النهاية قبل البداية', 'End is before start') : undefined}><Input type="date" value={periodEnd} disabled={!canEdit} onChange={(e) => setPeriodEnd(e.target.value)} /></Field>
              </div>
              <Field label={tr('مستوى التفصيل', 'Detail level')}>
                <Segmented value={detail} onChange={(v) => canEdit && setDetail(v)} options={[{ value: 'summary', label: tr('ملخص', 'Summary') }, { value: 'detailed', label: tr('مفصل', 'Detailed') }]} />
              </Field>
              <Field label={tr('المقارنة (النضج)', 'Comparison (maturity)')} error={from === to ? tr('اختر نقطتين مختلفتين', 'Choose two different points') : undefined}>
                <div className="row"><Select options={points} value={from} disabled={!canEdit} onChange={(e) => setFrom(e.target.value)} /><span>→</span><Select options={points} value={to} disabled={!canEdit} onChange={(e) => setTo(e.target.value)} /></div>
              </Field>
              <Checkbox label={tr('تضمين المرفقات (سجل الأدلة)', 'Include attachments (evidence register)')} checked={attach} disabled={!canEdit} onChange={setAttach} />
              <Field label={tr('المؤشرات المشمولة', 'Indicators included')} hint={tr('بدون اختيار تُشمل كل المؤشرات', 'None selected = all indicators')}>
                {!(inds.data ?? []).length ? <span className="small muted">{tr('لا توجد مؤشرات متاحة.', 'No indicators available.')}</span>
                  : <MultiCheck options={(inds.data ?? []).map((i) => ({ value: i.id, label: `${i.code} · ${pick(i.name, i.name_en)}`, disabled: !canEdit }))} value={indicators} onChange={(v) => canEdit && setIndicators(v)} />}
              </Field>
            </div>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title={tr('النصوص اليدوية', 'Manual narrative')} hint={tr('قصص النجاح والتحديات والدروس المستفادة لا تُستنتج من البيانات — يكتبها فريق البرنامج', 'Success stories, challenges and lessons learned cannot be derived from data — the program team writes them')} />
        <CardBody>
          {!manualSections.length ? <p className="small muted">{tr('لا توجد أقسام يدوية ضمن الأقسام المختارة.', 'No manual sections among the selected sections.')}</p> : (
            <div className="stack">
              {manualSections.map((s) => (
                <div key={s} className="grid g2">
                  <Field label={`${L(SECTION_CATALOG[s])} — ${tr('عربي', 'Arabic')}`}><Textarea dir="rtl" rows={3} value={narr[s]?.ar ?? ''} disabled={!canEdit} onChange={(e) => setNarr((n) => ({ ...n, [s]: { ...n[s], ar: e.target.value } }))} /></Field>
                  <Field label={`${L(SECTION_CATALOG[s])} — ${tr('إنجليزي', 'English')}`}><Textarea dir="ltr" rows={3} value={narr[s]?.en ?? ''} disabled={!canEdit} onChange={(e) => setNarr((n) => ({ ...n, [s]: { ...n[s], en: e.target.value } }))} /></Field>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
      {canEdit && <div className="row"><Button variant="primary" icon={<Save />} loading={busy} disabled={periodErr || !sections.length || from === to} onClick={save}>{tr('حفظ الإعداد', 'Save configuration')}</Button></div>}
    </div>
  );
}

// ----------------------------------------------------------------------------- Versions
function Versions({ versions, current, selected, onSelect }: { versions: ReportVersion[]; current: number; selected: number | null; onSelect: (v: number) => void }) {
  const { tr, fmtDateTime } = useI18n();
  const columns: Column<ReportVersion>[] = [
    { key: 'version', header: tr('الإصدار', 'Version'), sortable: true, render: (v) => <span className="row" style={{ gap: 4 }}><b>v{v.version}</b>{v.version === current && <Badge tone="primary">{tr('الحالي', 'Current')}</Badge>}{v.version === selected && <Badge tone="outline">{tr('معروض', 'Viewing')}</Badge>}</span> },
    { key: 'generated_at', header: tr('وقت التوليد', 'Generated at'), sortable: true, render: (v) => fmtDateTime(v.generated_at) },
    { key: 'generator', header: tr('المولّد', 'Generator'), value: (v) => v.generator, render: (v) => <Badge tone={v.generator === 'rules+llm' ? 'warning' : 'outline'}>{generatorLabel(v.generator, tr)}</Badge> },
    { key: 'sections', header: tr('الأقسام', 'Sections'), align: 'end', value: (v) => (isReportContent(v.content) ? v.content.sections.length : null) },
    { key: 'view', header: '', hideInExport: true, render: (v) => <Button size="sm" variant="ghost" icon={<Eye />} onClick={() => onSelect(v.version)}>{tr('عرض', 'View')}</Button> },
  ];
  return (
    <Card>
      <CardHeader title={tr('سجل الإصدارات', 'Version history')} hint={tr('كل توليد ينشئ إصدارًا جديدًا ولا يستبدل السابق', 'Each generation creates a new version and never overwrites the previous one')} />
      <CardBody flush>
        <DataTable columns={columns} rows={versions} rowKey={(v) => v.id} empty={{ title: tr('لا توجد إصدارات', 'No versions') }} />
      </CardBody>
    </Card>
  );
}
