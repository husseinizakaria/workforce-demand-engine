import { Link } from 'react-router';
import { Check, Lock, MapPin, X } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, DataTable, EmptyState, Progress, StatusBadge, type Column } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { cx } from '@/utils/cx';
import type { ProgramApplication, ProgramEnrollment, ProgramStageRecord } from '@/types/db';
import { payloadSummary, recordTypeName } from '../dataUtils';
import { type B360, programName } from './data';

export function JourneyTab({ d }: { d: B360 }) {
  const { tr, pick, locale, fmtDate, enumLabel } = useI18n();
  if (!d.enrollments.length) return <Card><EmptyState title={tr('غير ملتحق بأي برنامج', 'Not enrolled in any program')} description={tr('يظهر مسار المستفيد بعد قبوله في برنامج.', 'The journey appears once the beneficiary is accepted into a program.')} /></Card>;
  return (
    <div className="stack">
      {d.enrollments.map((e) => {
        const p = d.programs.get(e.program_id);
        const stages = d.stages.filter((s) => s.program_id === e.program_id).sort((a, b) => a.stage_order - b.stage_order);
        const currentIdx = stages.findIndex((s) => s.stage_key === e.current_stage_key);
        const records = d.stageRecords.filter((r) => r.program_id === e.program_id);
        const recCols: Column<ProgramStageRecord>[] = [
          { key: 'stage', header: tr('المرحلة', 'Stage'), value: (r) => { const s = stages.find((x) => x.stage_key === r.stage_key); return s ? pick(s.name_ar, s.name_en) : r.stage_key; } },
          { key: 'type', header: tr('النوع', 'Type'), value: (r) => recordTypeName(r.record_type, locale) },
          { key: 'title', header: tr('العنوان', 'Title'), value: (r) => r.title },
          { key: 'payload', header: tr('التفاصيل', 'Details'), value: (r) => payloadSummary(r.record_type, r.payload, locale), render: (r) => <span className="small">{payloadSummary(r.record_type, r.payload, locale) || '—'}</span> },
          { key: 'score', header: tr('الدرجة', 'Score'), align: 'end', value: (r) => r.score },
          { key: 'status', header: tr('الحالة', 'Status'), value: (r) => r.status, render: (r) => <StatusBadge group="actionStatus" value={r.status} /> },
          { key: 'date', header: tr('التاريخ', 'Date'), value: (r) => r.created_at, render: (r) => fmtDate(r.created_at) },
        ];
        return (
          <Card key={e.id}>
            <CardHeader title={<Link to={`/app/programs/${e.program_id}`}>{p ? pick(p.name, p.name_en) : tr('برنامج', 'Program')}</Link>} icon={<MapPin />}
              hint={[p?.code, e.cohort_id ? d.cohorts.get(e.cohort_id)?.name : null, p ? enumLabel('track', p.track_code) : null].filter(Boolean).join(' · ')}
              actions={<><StatusBadge group="enrollmentStatus" value={e.status} /><span className="small muted">{Math.round(e.progress)}%</span></>} />
            <CardBody>
              {stages.length === 0 ? <p className="muted small">{tr('لا توجد مراحل معرّفة لهذا البرنامج أو لا تملك صلاحية عرضها.', 'No stages defined for this program, or you cannot view them.')}</p> : (
                <div className="journey">
                  {stages.map((s, i) => {
                    const isCurrent = s.stage_key === e.current_stage_key;
                    const passed = currentIdx >= 0 && i < currentIdx;
                    const nRec = records.filter((r) => r.stage_key === s.stage_key).length;
                    return (
                      <div key={s.id} className={cx('j-stage', passed ? 'completed' : isCurrent ? 'in_progress' : s.status === 'blocked' ? 'blocked' : '', isCurrent && 'selected', !passed && !isCurrent && s.status === 'not_started' && 'locked')}>
                        <div className="j-node"><span className="j-circle">{passed ? <Check /> : s.status === 'blocked' ? <X /> : !isCurrent && s.status === 'not_started' ? <Lock /> : i + 1}</span>{i < stages.length - 1 && <span className="j-line" />}</div>
                        <div className="j-card">
                          <span className="j-name">{pick(s.name_ar, s.name_en)}</span>
                          <div className="j-flags">
                            {isCurrent && <Badge tone="primary">{tr('موقع المستفيد', 'Beneficiary is here')}</Badge>}
                            <StatusBadge group="stageStatus" value={s.status} />
                          </div>
                          {nRec > 0 && <span className="tiny muted">{tr(`${nRec} سجل`, `${nRec} records`)}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {!e.current_stage_key && stages.length > 0 && <p className="tiny muted">{tr('لم تُحدد المرحلة الحالية للمستفيد في هذا البرنامج.', 'The beneficiary’s current stage is not set in this program.')}</p>}
              <div style={{ marginTop: 10 }}><Progress value={e.progress} label={tr('تقدم المستفيد', 'Beneficiary progress')} /></div>
            </CardBody>
            <CardBody flush>
              <DataTable columns={recCols} rows={records} rowKey={(r) => r.id} pageSize={10} empty={{ title: tr('لا توجد سجلات مراحل لهذا المستفيد', 'No stage records for this beneficiary') }} />
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

export function ProgramsTab({ d }: { d: B360 }) {
  const { tr, pick, fmtDate } = useI18n();
  const enCols: Column<ProgramEnrollment>[] = [
    { key: 'program', header: tr('البرنامج', 'Program'), value: (e) => programName(d, e.program_id, pick), render: (e) => <Link to={`/app/programs/${e.program_id}`}>{programName(d, e.program_id, pick)}</Link> },
    { key: 'cohort', header: tr('الدفعة', 'Cohort'), value: (e) => (e.cohort_id ? d.cohorts.get(e.cohort_id)?.name ?? '—' : '—') },
    { key: 'status', header: tr('الحالة', 'Status'), value: (e) => e.status, render: (e) => <StatusBadge group="enrollmentStatus" value={e.status} /> },
    { key: 'stage', header: tr('المرحلة الحالية', 'Current stage'), value: (e) => { const s = d.stages.find((x) => x.program_id === e.program_id && x.stage_key === e.current_stage_key); return s ? pick(s.name_ar, s.name_en) : e.current_stage_key ?? '—'; } },
    { key: 'progress', header: tr('التقدم', 'Progress'), align: 'end', value: (e) => Math.round(e.progress), render: (e) => `${Math.round(e.progress)}%` },
    { key: 'enrolled_at', header: tr('تاريخ الالتحاق', 'Enrolled'), value: (e) => e.enrolled_at, render: (e) => fmtDate(e.enrolled_at) },
    { key: 'completed_at', header: tr('الإكمال', 'Completed'), value: (e) => e.completed_at, render: (e) => fmtDate(e.completed_at) },
    { key: 'exit', header: tr('سبب الخروج', 'Exit reason'), value: (e) => e.exit_reason ?? '' },
  ];
  const apCols: Column<ProgramApplication>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), render: (a) => <span className="mono">{a.code}</span>, value: (a) => a.code },
    { key: 'program', header: tr('البرنامج', 'Program'), value: (a) => programName(d, a.program_id, pick) },
    { key: 'status', header: tr('الحالة', 'Status'), value: (a) => a.status, render: (a) => <StatusBadge group="applicationStatus" value={a.status} /> },
    { key: 'score', header: tr('درجة الفرز', 'Screening score'), align: 'end', value: (a) => a.screening_score },
    { key: 'applied', header: tr('تاريخ التقديم', 'Applied'), value: (a) => a.applied_at, render: (a) => fmtDate(a.applied_at) },
    { key: 'note', header: tr('ملاحظة القرار', 'Decision note'), value: (a) => a.decision_note ?? a.eligibility_notes ?? '' },
  ];
  return (
    <div className="stack">
      <Card><CardHeader title={tr('الالتحاقات', 'Enrollments')} /><CardBody flush>
        <DataTable columns={enCols} rows={d.enrollments} rowKey={(e) => e.id} exportName="beneficiary-enrollments" empty={{ title: tr('لا توجد التحاقات', 'No enrollments') }} />
      </CardBody></Card>
      <Card><CardHeader title={tr('طلبات الالتحاق', 'Applications')} /><CardBody flush>
        <DataTable columns={apCols} rows={d.applications} rowKey={(a) => a.id} empty={{ title: tr('لا توجد طلبات', 'No applications') }} />
      </CardBody></Card>
      {d.certificates.length > 0 && (
        <Card><CardHeader title={tr('الشهادات', 'Certificates')} /><CardBody>
          <ul className="list-plain small">{d.certificates.map((c) => <li key={c.id} className="row between"><span>{c.title} · {programName(d, c.program_id, pick)}</span><span className="row"><span className="mono">{c.code}</span>{fmtDate(c.issued_on)}<Badge tone={c.status === 'issued' ? 'success' : 'danger'}>{c.status === 'issued' ? tr('صادرة', 'Issued') : tr('ملغاة', 'Revoked')}</Badge></span></li>)}</ul>
        </CardBody></Card>
      )}
    </div>
  );
}
