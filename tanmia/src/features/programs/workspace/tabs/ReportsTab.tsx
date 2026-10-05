// Reports for this program: list with versions/status and quick creation that
// opens the report detail page for generation and review.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { FileText, Plus } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAsync } from '@/hooks/useAsync';
import { all, insert } from '@/services/db';
import { Button, Card, CardBody, CardHeader, DataTable, Notice, StatusBadge } from '@/components/ui';
import { RecordFormModal, type FieldSpec } from '@/components/forms/RecordForm';
import type { Report, ReportType } from '@/types/db';
import { dateOrderError, errText } from '../../lib';
import { useWorkspace } from '../context';

export default function ReportsTab() {
  const { tr, enumLabel, fmtDate, fmtDateTime, locale, pick } = useI18n();
  const { can, org } = useOrg();
  const ws = useWorkspace();
  const navigate = useNavigate();
  const p = ws.bundle.program;
  const [open, setOpen] = useState(false);
  const state = useAsync(async () => {
    const reports = await all<Report>('reports', { filters: [['organization_id', 'eq', org.id], ['program_id', 'eq', p.id]], order: { column: 'updated_at' } });
    const ids = reports.map((r) => r.id);
    const versions = ids.length ? await all<{ report_id: string }>('report_versions', { select: 'report_id', filters: [['report_id', 'in', ids]], order: { column: 'generated_at' } }) : [];
    const counts = new Map<string, number>();
    for (const v of versions) counts.set(v.report_id, (counts.get(v.report_id) ?? 0) + 1);
    return { reports, counts };
  }, [p.id, org.id]);
  const fields: FieldSpec[] = [
    { name: 'report_type', label: ['نوع التقرير', 'Report type'], type: 'enum', enumGroup: 'reportType', required: true },
    { name: 'title', label: ['العنوان', 'Title'], type: 'text', hint: ['يُولّد من النوع واسم البرنامج إن تُرك فارغًا', 'Generated from type and program name when empty'] },
    { name: 'period_start', label: ['بداية الفترة', 'Period start'], type: 'date' },
    { name: 'period_end', label: ['نهاية الفترة', 'Period end'], type: 'date', validate: (v, a) => dateOrderError(a.period_start, v) },
  ];
  const data = state.data ?? { reports: [], counts: new Map<string, number>() };
  return (
    <div className="stack">
      {state.error && <Notice tone="danger">{errText(locale, state.error)}</Notice>}
      <Card>
        <CardHeader icon={<FileText />} title={tr('تقارير البرنامج', 'Program reports')} hint={tr('انقر على تقرير لتوليده ومراجعته واعتماده', 'Click a report to generate, review and approve it')}
          actions={can('reports.create') ? <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setOpen(true)}>{tr('تقرير جديد', 'New report')}</Button> : undefined} />
        <CardBody flush>
          <DataTable rows={data.reports} loading={state.loading} rowKey={(r) => r.id} onRowClick={(r) => navigate(`/app/reports/${r.id}`)} searchable exportName={`${p.code}-reports`}
            empty={{ title: tr('لا توجد تقارير للبرنامج', 'No reports for this program'), description: tr('ابدأ بتقرير تقدم دوري، ثم تقرير ختامي شامل عند الإغلاق.', 'Start with a periodic progress report, then a final comprehensive report at closure.') }}
            columns={[
              { key: 'code', header: tr('الرمز', 'Code'), render: (r) => <span className="mono">{r.code}</span>, value: (r) => r.code },
              { key: 'title', header: tr('العنوان', 'Title'), sortable: true },
              { key: 'type', header: tr('النوع', 'Type'), value: (r) => enumLabel('reportType', r.report_type) },
              { key: 'period', header: tr('الفترة', 'Period'), value: (r) => r.period_start, render: (r) => `${fmtDate(r.period_start)} – ${fmtDate(r.period_end)}` },
              { key: 'status', header: tr('الحالة', 'Status'), value: (r) => r.status, render: (r) => <StatusBadge group="reportStatus" value={r.status} /> },
              { key: 'versions', header: tr('الإصدارات', 'Versions'), align: 'end', value: (r) => data.counts.get(r.id) ?? 0, render: (r) => `${data.counts.get(r.id) ?? 0} (v${r.current_version})` },
              { key: 'updated', header: tr('آخر تحديث', 'Updated'), sortable: true, value: (r) => r.updated_at, render: (r) => fmtDateTime(r.updated_at) },
            ]} />
        </CardBody>
      </Card>
      <RecordFormModal open={open} onClose={() => setOpen(false)} title={tr('تقرير جديد', 'New report')} fields={fields}
        initial={{ report_type: 'progress', period_start: p.start_date, period_end: p.end_date }}
        onSubmit={async (v) => {
          const type = v.report_type as ReportType;
          const title = (v.title as string | null) || `${enumLabel('reportType', type)} — ${pick(p.name, p.name_en)}`;
          const r = await insert<Report>('reports', {
            organization_id: org.id, program_id: p.id, report_type: type, title, period_start: v.period_start, period_end: v.period_end,
            configuration: { sections: ws.track?.report_sections ?? [], comparisons: { points: ['T0', 'T1'] }, detail_level: 'detailed' },
          });
          navigate(`/app/reports/${r.id}`);
        }} />
    </div>
  );
}
