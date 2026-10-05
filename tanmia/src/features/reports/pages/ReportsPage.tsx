// Reports registry and report creation (configuration only — content is
// generated on the report page).
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { FileText, Plus } from 'lucide-react';
import { DEFAULT_SECTIONS, MEASUREMENT_POINTS, REPORT_TYPES, SECTION_CATALOG, type ReportType } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import {
  AsyncView, Badge, Button, Card, CardBody, Checkbox, DataTable, Field, Input, Modal, MultiCheck, Notice, PageHeader, Segmented, Select, StatusBadge,
  type Column,
} from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { all, insert } from '@/services/db';
import { type AppError, errorOf } from '@/services/errors';
import type { Indicator, Program, Report } from '@/types/db';

type ProgMin = Pick<Program, 'id' | 'code' | 'name' | 'name_en' | 'status' | 'start_date' | 'end_date'>;

export default function ReportsPage() {
  const { tr, pick, enumLabel, fmtDate, fmtDateTime } = useI18n();
  const { org, can } = useOrg();
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const state = useAsync(async () => {
    const orgF: [string, 'eq', string] = ['organization_id', 'eq', org.id];
    const [reports, programs] = await Promise.all([
      all<Report>('reports', { filters: [orgF], order: { column: 'updated_at' } }, 3000),
      all<Program>('programs', { select: 'id,code,name,name_en,status,start_date,end_date', filters: [orgF], order: { column: 'name', ascending: true } }),
    ]);
    return { reports, programs: programs as ProgMin[] };
  }, [org.id]);

  return (
    <div className="stack">
      <PageHeader title={tr('التقارير', 'Reports')} subtitle={tr('تقارير مبنية من بيانات البرامج الفعلية، بإصدارات قابلة للمراجعة والاعتماد.', 'Reports built from actual program data, with versions for review and approval.')}
        actions={can('reports.create') ? <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>{tr('تقرير جديد', 'New report')}</Button> : undefined} />
      <AsyncView state={state}>
        {(d) => {
          const pmap = new Map(d.programs.map((p) => [p.id, p]));
          const rows = d.reports.filter((r) => (!type || r.report_type === type) && (!status || r.status === status));
          const columns: Column<Report>[] = [
            { key: 'code', header: tr('الرمز', 'Code'), sortable: true, render: (r) => <span className="mono small">{r.code}</span> },
            { key: 'title', header: tr('العنوان', 'Title'), sortable: true, render: (r) => <b className="small">{r.title}</b> },
            { key: 'program', header: tr('البرنامج', 'Program'), sortable: true, value: (r) => { const p = r.program_id ? pmap.get(r.program_id) : undefined; return p ? pick(p.name, p.name_en) : '—'; } },
            { key: 'type', header: tr('النوع', 'Type'), sortable: true, value: (r) => enumLabel('reportType', r.report_type) },
            { key: 'period', header: tr('الفترة', 'Period'), value: (r) => r.period_start, render: (r) => r.period_start || r.period_end ? <span className="small nowrap">{fmtDate(r.period_start)} – {fmtDate(r.period_end)}</span> : <span className="muted small">{tr('كامل المدة', 'Full period')}</span> },
            { key: 'status', header: tr('الحالة', 'Status'), sortable: true, value: (r) => enumLabel('reportStatus', r.status), render: (r) => <StatusBadge group="reportStatus" value={r.status} /> },
            { key: 'version', header: tr('الإصدار', 'Version'), align: 'end', sortable: true, value: (r) => r.current_version, render: (r) => r.current_version ? `v${r.current_version}` : <Badge tone="outline">{tr('لم يُولّد', 'Not generated')}</Badge> },
            { key: 'approved', header: tr('الاعتماد', 'Approved'), value: (r) => r.approved_at, render: (r) => r.approved_at ? <span className="small">{fmtDateTime(r.approved_at)}</span> : '—' },
            { key: 'updated', header: tr('آخر تحديث', 'Updated'), sortable: true, value: (r) => r.updated_at, render: (r) => <span className="small">{fmtDate(r.updated_at)}</span> },
          ];
          return (
            <Card>
              <CardBody flush>
                <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} searchable exportName="reports" pageSize={20} onRowClick={(r) => nav(`/app/reports/${r.id}`)}
                  toolbar={<>
                    <Select aria-label={tr('النوع', 'Type')} options={REPORT_TYPES.map((t) => ({ value: t.key, label: tr(t.ar, t.en) }))} placeholder={tr('كل الأنواع', 'All types')} value={type} onChange={(e) => setType(e.target.value)} style={{ maxWidth: 200 }} />
                    <Select aria-label={tr('الحالة', 'Status')} options={['draft', 'generated', 'in_review', 'approved', 'published'].map((s) => ({ value: s, label: enumLabel('reportStatus', s) }))} placeholder={tr('كل الحالات', 'All statuses')} value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 170 }} />
                  </>}
                  empty={{ title: tr('لا توجد تقارير', 'No reports'), description: tr('أنشئ تقريرًا لبرنامج ثم ولّده من بياناته.', 'Create a report for a program, then generate it from its data.'),
                    action: can('reports.create') ? <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>{tr('تقرير جديد', 'New report')}</Button> : undefined }} />
              </CardBody>
            </Card>
          );
        }}
      </AsyncView>
      {creating && state.data && <CreateReportModal programs={state.data.programs} onClose={() => setCreating(false)} onCreated={(id) => nav(`/app/reports/${id}`)} />}
    </div>
  );
}

function CreateReportModal({ programs, onClose, onCreated }: { programs: ProgMin[]; onClose: () => void; onCreated: (id: string) => void }) {
  const { tr, pick, L, locale, enumLabel } = useI18n();
  const { org } = useOrg();
  const [programId, setProgramId] = useState('');
  const [type, setType] = useState<ReportType>('progress');
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [sections, setSections] = useState<string[]>(DEFAULT_SECTIONS.progress);
  const [detail, setDetail] = useState<'summary' | 'detailed'>('summary');
  const [indicators, setIndicators] = useState<string[]>([]);
  const [compareFrom, setCompareFrom] = useState('T0');
  const [compareTo, setCompareTo] = useState('T1');
  const [attachments, setAttachments] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const program = programs.find((p) => p.id === programId);
  const rt = REPORT_TYPES.find((t) => t.key === type)!;
  useEffect(() => { setSections(DEFAULT_SECTIONS[type]); }, [type]);
  useEffect(() => {
    if (titleTouched) return;
    setTitle(program ? `${tr(rt.ar, rt.en)} — ${pick(program.name, program.name_en)}` : '');
  }, [program, rt, titleTouched, tr, pick]);

  const inds = useAsync(async () => (programId
    ? all<Indicator>('indicators', { select: 'id,code,name,name_en,indicator_type,status', filters: [['organization_id', 'eq', org.id], ['program_id', 'eq', programId]], order: { column: 'code', ascending: true } }).catch(() => [] as Indicator[])
    : [] as Indicator[]), [programId, org.id]);
  useEffect(() => { setIndicators([]); }, [programId]);

  const points = MEASUREMENT_POINTS.map((p) => ({ value: p.key, label: enumLabel('measurementPoint', p.key) }));
  const periodErr = periodStart && periodEnd && periodEnd < periodStart;
  const compareErr = compareFrom === compareTo;
  const warnOutside = program && periodStart && program.end_date && periodStart > program.end_date;
  const sectionOptions = useMemo(() => Object.entries(SECTION_CATALOG).map(([k, v]) => ({ value: k, label: L(v) })), [L]);

  const submit = async () => {
    setSubmitted(true);
    if (!programId || !title.trim() || !sections.length || periodErr || compareErr) return;
    setBusy(true); setError(null);
    try {
      const orderedSections = Object.keys(SECTION_CATALOG).filter((k) => sections.includes(k));
      const r = await insert<Report>('reports', {
        organization_id: org.id, program_id: programId, report_type: type, title: title.trim(),
        period_start: periodStart || null, period_end: periodEnd || null,
        configuration: { sections: orderedSections, indicators, comparisons: { points: [compareFrom, compareTo] }, detail_level: detail, include_attachments: attachments, narrative: {} },
      });
      onCreated(r.id);
    } catch (e) { setError(errorOf(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} size="wide" title={tr('تقرير جديد', 'New report')}
      footer={<><Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" icon={<FileText />} loading={busy} onClick={submit}>{tr('إنشاء ومتابعة', 'Create & continue')}</Button></>}>
      <div className="stack">
        {error && <Notice tone="danger">{locale === 'ar' ? error.message_ar : error.message_en}</Notice>}
        <div className="form-grid">
          <Field label={tr('البرنامج', 'Program')} required error={submitted && !programId ? tr('اختر البرنامج', 'Select a program') : undefined}>
            <Select options={programs.map((p) => ({ value: p.id, label: `${pick(p.name, p.name_en)} · ${p.code}` }))} placeholder={tr('— اختر —', '— Select —')} value={programId} onChange={(e) => setProgramId(e.target.value)} />
          </Field>
          <Field label={tr('نوع التقرير', 'Report type')} required>
            <Select options={REPORT_TYPES.map((t) => ({ value: t.key, label: tr(t.ar, t.en) }))} value={type} onChange={(e) => setType(e.target.value as ReportType)} />
          </Field>
          <Field label={tr('العنوان', 'Title')} required className="full" error={submitted && !title.trim() ? tr('العنوان إلزامي', 'Title is required') : undefined}>
            <Input value={title} onChange={(e) => { setTitle(e.target.value); setTitleTouched(true); }} />
          </Field>
          <Field label={tr('بداية الفترة', 'Period start')} hint={tr('اتركه فارغًا لكامل مدة البرنامج', 'Leave empty for the full program period')}>
            <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </Field>
          <Field label={tr('نهاية الفترة', 'Period end')} error={periodErr ? tr('النهاية قبل البداية', 'End is before start') : undefined}>
            <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </Field>
          <Field label={tr('مستوى التفصيل', 'Detail level')}>
            <Segmented value={detail} onChange={setDetail} options={[{ value: 'summary', label: tr('ملخص', 'Summary') }, { value: 'detailed', label: tr('مفصل', 'Detailed') }]} />
          </Field>
          <Field label={tr('نقاط المقارنة (النضج)', 'Comparison points (maturity)')} error={compareErr ? tr('اختر نقطتين مختلفتين', 'Choose two different points') : undefined}>
            <div className="row"><Select options={points} value={compareFrom} onChange={(e) => setCompareFrom(e.target.value)} /><span>→</span><Select options={points} value={compareTo} onChange={(e) => setCompareTo(e.target.value)} /></div>
          </Field>
          <Field label={tr('الأقسام', 'Sections')} required className="full" hint={tr(`الافتراضي لنوع «${tr(rt.ar, rt.en)}» محدد مسبقًا؛ يمكن إعادة الترتيب لاحقًا`, `Defaults for “${rt.en}” are preselected; you can reorder later`)}
            error={submitted && !sections.length ? tr('اختر قسمًا واحدًا على الأقل', 'Select at least one section') : undefined}>
            <MultiCheck options={sectionOptions} value={sections} onChange={setSections} />
          </Field>
          <Field label={tr('المؤشرات المشمولة', 'Indicators included')} className="full" hint={tr('بدون اختيار تُشمل كل مؤشرات البرنامج', 'With none selected, all program indicators are included')}>
            {!programId ? <span className="small muted">{tr('اختر البرنامج أولًا', 'Select a program first')}</span>
              : inds.loading ? <span className="small muted">{tr('جارٍ التحميل…', 'Loading…')}</span>
              : !(inds.data ?? []).length ? <span className="small muted">{tr('لا توجد مؤشرات لهذا البرنامج (أو لا تملك صلاحية عرضها).', 'No indicators for this program (or you cannot view them).')}</span>
              : <MultiCheck options={(inds.data ?? []).filter((i) => i.status !== 'retired').map((i) => ({ value: i.id, label: `${i.code} · ${pick(i.name, i.name_en)} (${enumLabel('indicatorType', i.indicator_type)})` }))} value={indicators} onChange={setIndicators} />}
          </Field>
          <div className="full"><Checkbox label={tr('تضمين المرفقات (سجل الأدلة)', 'Include attachments (evidence register)')} checked={attachments} onChange={setAttachments} /></div>
        </div>
        {warnOutside && <Notice tone="warning">{tr('بداية الفترة بعد انتهاء البرنامج؛ قد لا توجد بيانات في هذه الفترة.', 'The period starts after the program ended; there may be no data in this period.')}</Notice>}
        {(['impact', 'outcomes', 'final_comprehensive'] as ReportType[]).includes(type) && (
          <Notice tone="info">{tr('أقسام النتائج والأثر تعرض مستوى الادعاء لكل مؤشر؛ الفرق القبلي/البعدي وحده لا يُعرض كأثر سببي.', 'Outcome and impact sections show the claim level per indicator; a pre/post difference alone is never presented as causal impact.')}</Notice>
        )}
      </div>
    </Modal>
  );
}
