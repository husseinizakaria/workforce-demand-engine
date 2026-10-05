import { useMemo, useState } from 'react';
import { BadgeCheck, Briefcase, CalendarClock, ExternalLink, FileCheck2 } from 'lucide-react';
import { duePoints, MEASUREMENT_POINTS } from '@engine';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, Notice, StatusBadge, type Column } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { signedUrl } from '@/services/storage';
import { addDaysISO, todayISO } from '@/utils/dates';
import type { Evidence, ProgramStageRecord } from '@/types/db';
import { errMsg, payloadSummary, recordTypeName } from '../dataUtils';
import { type B360, programName } from './data';

const IMPACT_TYPES = ['employment_status', 'placement', 'retention_check', 'follow_up', 'graduation_decision', 'certification', 'growth_metric'];

interface FollowUp { key: string; program_id: string; point: string; due: string; isDue: boolean; done: boolean; via: string | null }

export function ImpactTab({ d }: { d: B360 }) {
  const { tr, pick, locale, fmtDate, enumLabel } = useI18n();
  const records = d.stageRecords.filter((r) => IMPACT_TYPES.includes(r.record_type));
  const followUps = useMemo<FollowUp[]>(() => {
    const out: FollowUp[] = [];
    const today = todayISO();
    for (const e of d.enrollments.filter((x) => ['completed', 'graduated', 'active'].includes(x.status))) {
      const p = d.programs.get(e.program_id);
      if (!p?.end_date) continue;
      const due = new Set(duePoints(p.end_date));
      for (const mp of MEASUREMENT_POINTS.filter((m) => ['T2', 'T3', 'T4', 'T5'].includes(m.key))) {
        const dueDate = addDaysISO(p.end_date, mp.offsetDays ?? 0);
        const rec = d.stageRecords.find((r) => r.program_id === p.id && ['follow_up', 'retention_check', 'employment_status'].includes(r.record_type) && r.payload.point === mp.key);
        const mat = d.maturity.find((m) => m.program_id === p.id && m.measurement_point === mp.key);
        const res = d.results.find((r) => r.program_id === p.id && r.measurement_point === mp.key);
        const via = rec ? recordTypeName(rec.record_type, locale) : mat ? tr('قياس نضج', 'Maturity measurement') : res ? tr('نتيجة تقييم', 'Assessment result') : null;
        out.push({ key: `${p.id}:${mp.key}`, program_id: p.id, point: mp.key, due: dueDate, isDue: due.has(mp.key) || dueDate <= today, done: !!via, via });
      }
    }
    return out;
  }, [d, locale, tr]);
  const overdue = followUps.filter((f) => f.isDue && !f.done);
  const fCols: Column<FollowUp>[] = [
    { key: 'program', header: tr('البرنامج', 'Program'), value: (f) => programName(d, f.program_id, pick) },
    { key: 'point', header: tr('نقطة المتابعة', 'Follow-up point'), value: (f) => f.point, render: (f) => enumLabel('measurementPoint', f.point) },
    { key: 'due', header: tr('تاريخ الاستحقاق', 'Due date'), value: (f) => f.due, render: (f) => fmtDate(f.due) },
    { key: 'status', header: tr('الحالة', 'Status'), value: (f) => (f.done ? 'done' : f.isDue ? 'overdue' : 'upcoming'), render: (f) => f.done
      ? <Badge tone="success">{tr('منجزة', 'Done')} · {f.via}</Badge>
      : f.isDue ? <Badge tone="danger">{tr('مستحقة ولم تُنفذ', 'Due, not done')}</Badge> : <Badge tone="outline">{tr('قادمة', 'Upcoming')}</Badge> },
  ];
  const rCols: Column<ProgramStageRecord>[] = [
    { key: 'date', header: tr('التاريخ', 'Date'), value: (r) => r.created_at, render: (r) => fmtDate(r.created_at) },
    { key: 'program', header: tr('البرنامج', 'Program'), value: (r) => programName(d, r.program_id, pick) },
    { key: 'type', header: tr('النوع', 'Type'), value: (r) => recordTypeName(r.record_type, locale) },
    { key: 'point', header: tr('النقطة', 'Point'), value: (r) => String(r.payload.point ?? ''), render: (r) => (r.payload.point ? <Badge tone="outline">{String(r.payload.point)}</Badge> : '—') },
    { key: 'details', header: tr('التفاصيل', 'Details'), value: (r) => payloadSummary(r.record_type, r.payload, locale), render: (r) => <span className="small">{payloadSummary(r.record_type, r.payload, locale) || r.title}</span> },
  ];
  return (
    <div className="stack">
      <Notice tone="info">{tr('مؤشرات الأثر تُقاس على مستوى البرنامج؛ هنا تظهر سجلات المستفيد الفردية (التوظيف، التسكين، الاستمرار، المتابعات T2–T5).', 'Impact indicators are measured at program level; this view shows the beneficiary’s individual records (employment, placement, retention, T2–T5 follow-ups).')}</Notice>
      <div className="grid g3">
        <div className="card card-pad"><div className="small muted">{tr('الحالة الوظيفية في السجل', 'Registry employment status')}</div><b><Briefcase size={14} /> {enumLabel('employment', d.ben.employment_status)}</b></div>
        <div className="card card-pad"><div className="small muted">{tr('سجلات الأثر', 'Impact records')}</div><b>{records.length}</b></div>
        <div className="card card-pad"><div className="small muted">{tr('متابعات مستحقة لم تُنفذ', 'Due follow-ups not done')}</div><b style={{ color: overdue.length ? 'var(--danger)' : undefined }}>{overdue.length}</b></div>
      </div>
      <Card><CardHeader title={tr('جدول المتابعات بعد البرنامج', 'Post-program follow-up schedule')} icon={<CalendarClock />} hint={tr('محسوبة من تاريخ نهاية كل برنامج', 'Computed from each program’s end date')} /><CardBody flush>
        <DataTable columns={fCols} rows={followUps} rowKey={(f) => f.key} empty={{ title: tr('لا توجد برامج منتهية بتاريخ محدد', 'No programs with an end date'), description: tr('تظهر المتابعات T2–T5 بعد تحديد تاريخ نهاية البرنامج.', 'T2–T5 follow-ups appear once the program end date is set.') }} />
      </CardBody></Card>
      <Card><CardHeader title={tr('سجلات التوظيف والمتابعة', 'Employment & follow-up records')} icon={<Briefcase />} /><CardBody flush>
        <DataTable columns={rCols} rows={records} rowKey={(r) => r.id} exportName="beneficiary-impact-records" empty={{ title: tr('لا توجد سجلات', 'No records') }} />
      </CardBody></Card>
    </div>
  );
}

export function EvidenceTab({ d }: { d: B360 }) {
  const { tr, pick, fmtDate, enumLabel, locale } = useI18n();
  const [err, setErr] = useState<string | null>(null);
  const open = async (e: Evidence) => {
    setErr(null);
    try {
      if (e.file_path) window.open(await signedUrl('evidence', e.file_path), '_blank', 'noopener');
      else if (e.source_url) window.open(e.source_url, '_blank', 'noopener');
    } catch (x) { setErr(errMsg(x, locale)); }
  };
  const cols: Column<Evidence>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), value: (e) => e.code, render: (e) => <span className="mono">{e.code}</span> },
    { key: 'title', header: tr('العنوان', 'Title'), value: (e) => e.title },
    { key: 'type', header: tr('النوع', 'Type'), value: (e) => enumLabel('evidenceType', e.evidence_type) },
    { key: 'program', header: tr('البرنامج', 'Program'), value: (e) => programName(d, e.program_id, pick) },
    { key: 'stage', header: tr('المرحلة', 'Stage'), value: (e) => e.stage_key ?? '' },
    { key: 'status', header: tr('التحقق', 'Verification'), value: (e) => e.verification_status, render: (e) => <StatusBadge group="verification" value={e.verification_status} /> },
    { key: 'date', header: tr('التاريخ', 'Date'), value: (e) => e.created_at, render: (e) => fmtDate(e.collected_at ?? e.created_at) },
    { key: 'open', header: '', hideInExport: true, render: (e) => (e.file_path || e.source_url ? <Button size="sm" variant="ghost" icon={<ExternalLink />} onClick={(x) => { x.stopPropagation(); void open(e); }}>{tr('فتح', 'Open')}</Button> : null) },
  ];
  const verified = d.evidence.filter((e) => e.verification_status === 'verified').length;
  return (
    <Card>
      <CardHeader title={tr('الأدلة المرتبطة بالمستفيد', 'Evidence linked to this beneficiary')} icon={<FileCheck2 />}
        actions={<Badge tone="success" icon={<BadgeCheck size={13} />}>{verified}/{d.evidence.length} {tr('متحقق', 'verified')}</Badge>} />
      <CardBody flush>
        {err && <div className="card-pad"><Notice tone="danger">{err}</Notice></div>}
        <DataTable columns={cols} rows={d.evidence} rowKey={(e) => e.id} exportName="beneficiary-evidence" empty={{ title: tr('لا توجد أدلة', 'No evidence') }} />
      </CardBody>
    </Card>
  );
}
