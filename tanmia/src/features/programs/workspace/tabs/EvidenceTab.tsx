// Evidence: program evidence registry with filters, upload/link, signed file
// access and the completeness checklist computed by the engine.
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, CheckCircle2, ExternalLink, Paperclip, Upload } from 'lucide-react';
import { evidenceCompleteness } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { Button, Card, CardBody, CardHeader, DataTable, Kpi, Progress, Select, StatusBadge, scoreTone, type Column } from '@/components/ui';
import type { Evidence } from '@/types/db';
import { useWorkspace } from '../context';
import { EvidenceUploadModal } from '../components/EvidenceUploadModal';
import { FileLink, TabInsights } from '../components/common';

type LinkFilter = '' | 'stage' | 'session' | 'beneficiary' | 'indicator' | 'output' | 'outcome' | 'none';

export default function EvidenceTab() {
  const { tr, enumLabel, enumOptions, fmtDate, L, fmtNumber } = useI18n();
  const { can } = useOrg();
  const ws = useWorkspace();
  const b = ws.bundle;
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [stage, setStage] = useState('');
  const [linked, setLinked] = useState<LinkFilter>('');
  const [upload, setUpload] = useState(false);
  const ev = useMemo(() => evidenceCompleteness(b), [b]);
  const links = (e: Evidence): string[] => [
    e.stage_key ? `${tr('مرحلة', 'Stage')}: ${ws.stageName(e.stage_key)}` : null,
    e.session_id ? `${tr('جلسة', 'Session')}: ${b.sessions.find((s) => s.id === e.session_id)?.code ?? '—'}` : null,
    e.beneficiary_id ? `${tr('مستفيد', 'Beneficiary')}: ${ws.benName(e.beneficiary_id)}` : null,
    e.indicator_id ? `${tr('مؤشر', 'Indicator')}: ${b.indicators.find((i) => i.id === e.indicator_id)?.code ?? '—'}` : null,
    e.output_id ? `${tr('مخرج', 'Output')}: ${b.outputs.find((o) => o.id === e.output_id)?.code ?? '—'}` : null,
    e.outcome_id ? `${tr('نتيجة', 'Outcome')}: ${b.outcomes.find((o) => o.id === e.outcome_id)?.code ?? '—'}` : null,
  ].filter((x): x is string => !!x);
  const rows = b.evidence.filter((e) => {
    if (type && e.evidence_type !== type) return false;
    if (status && e.verification_status !== status) return false;
    if (stage && e.stage_key !== stage) return false;
    if (linked === 'none') return !e.stage_key && !e.session_id && !e.beneficiary_id && !e.indicator_id && !e.output_id && !e.outcome_id;
    if (linked === 'stage') return !!e.stage_key;
    if (linked) return !!e[`${linked}_id` as keyof Evidence];
    return true;
  }).sort((a, c) => c.created_at.localeCompare(a.created_at));
  const cols: Column<Evidence>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), render: (r) => <span className="mono">{r.code}</span>, value: (r) => r.code },
    { key: 'title', header: tr('العنوان', 'Title'), sortable: true },
    { key: 'type', header: tr('النوع', 'Type'), value: (r) => enumLabel('evidenceType', r.evidence_type) },
    { key: 'links', header: tr('مرتبط بـ', 'Linked to'), value: (r) => links(r).join(' | '), render: (r) => { const l = links(r); return l.length ? <span className="small">{l.join(' · ')}</span> : <span className="muted small">{tr('غير مرتبط', 'Unlinked')}</span>; } },
    { key: 'status', header: tr('التحقق', 'Verification'), value: (r) => enumLabel('verification', r.verification_status), render: (r) => <StatusBadge group="verification" value={r.verification_status} /> },
    { key: 'collected', header: tr('تاريخ الجمع', 'Collected'), value: (r) => r.collected_at, render: (r) => fmtDate(r.collected_at) },
    { key: 'created', header: tr('الرفع', 'Uploaded'), sortable: true, value: (r) => r.created_at, render: (r) => fmtDate(r.created_at) },
    { key: 'file', header: '', hideInExport: true, render: (r) => <FileLink bucket="evidence" path={r.file_path} url={r.source_url} /> },
  ];
  const verified = b.evidence.filter((e) => e.verification_status === 'verified').length;
  const pending = b.evidence.filter((e) => e.verification_status === 'pending').length;
  const rejected = b.evidence.filter((e) => ['rejected', 'needs_info'].includes(e.verification_status)).length;
  return (
    <div className="stack">
      <div className="grid g4">
        <Kpi label={tr('اكتمال الأدلة', 'Evidence completeness')} value={`${ev.score}%`} icon={<Paperclip />} tone={scoreTone(ev.score)} hint={`${ev.satisfied}/${ev.required} ${tr('متطلب', 'requirements')}`} />
        <Kpi label={tr('متحقق منها', 'Verified')} value={fmtNumber(verified)} tone="success" hint={b.evidence.length ? `${Math.round((verified / b.evidence.length) * 100)}%` : undefined} />
        <Kpi label={tr('بانتظار التحقق', 'Pending verification')} value={fmtNumber(pending)} tone={pending ? 'warning' : undefined} />
        <Kpi label={tr('مرفوضة / تحتاج معلومات', 'Rejected / needs info')} value={fmtNumber(rejected)} tone={rejected ? 'danger' : undefined} />
      </div>
      <div className="grid g-1-2">
        <Card>
          <CardHeader title={tr('قائمة اكتمال الأدلة', 'Evidence completeness checklist')} hint={tr('مشتقة من إعداد البرنامج', 'Derived from program configuration')} />
          <CardBody>
            <div className="row" style={{ marginBottom: 8 }}><Progress large value={ev.score} tone={scoreTone(ev.score)} /><b>{ev.score}%</b></div>
            {!ev.items.length ? <p className="small muted">{tr('لا توجد متطلبات أدلة حاليًا (تظهر عند بدء المراحل وتسجيل القياسات وإكمال الجلسات).', 'No evidence requirements yet (they appear as stages start, measurements are recorded and sessions complete).')}</p> : (
              <ul className="list-plain small">
                {[...ev.missing, ...ev.items.filter((i) => i.satisfied)].map((i) => (
                  <li key={i.key} className="row">{i.satisfied ? <CheckCircle2 size={15} color="var(--success)" /> : <AlertTriangle size={15} color="var(--warning)" />}<span>{L(i.label)}</span></li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <TabInsights links={['evidence']} title={tr('فجوات الأدلة والتحقق', 'Evidence gaps & verification')} />
      </div>
      <Card>
        <CardHeader icon={<Paperclip />} title={tr('سجل أدلة البرنامج', 'Program evidence registry')}
          actions={<>
            <Link className="small" to={`/app/evidence?program=${ws.programId}`}><ExternalLink size={12} /> {tr('التحقق في وحدة الأدلة', 'Verify in Evidence module')}</Link>
            {can('evidence.create') && <Button size="sm" variant="primary" icon={<Upload />} onClick={() => setUpload(true)}>{tr('رفع دليل', 'Upload evidence')}</Button>}
          </>} />
        <CardBody flush>
          <DataTable rows={rows} rowKey={(r) => r.id} columns={cols} searchable exportName={`${b.program.code}-evidence`}
            toolbar={<>
              <Select aria-label={tr('النوع', 'Type')} placeholder={tr('كل الأنواع', 'All types')} options={enumOptions('evidenceType')} value={type} onChange={(e) => setType(e.target.value)} style={{ width: 150 }} />
              <Select aria-label={tr('التحقق', 'Verification')} placeholder={tr('كل الحالات', 'All statuses')} options={enumOptions('verification')} value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 150 }} />
              <Select aria-label={tr('المرحلة', 'Stage')} placeholder={tr('كل المراحل', 'All stages')} options={b.stages.map((s) => ({ value: s.stage_key, label: ws.stageName(s.stage_key) }))} value={stage} onChange={(e) => setStage(e.target.value)} style={{ width: 160 }} />
              <Select aria-label={tr('الارتباط', 'Linked entity')} value={linked} onChange={(e) => setLinked(e.target.value as LinkFilter)} style={{ width: 160 }}
                options={[{ value: '', label: tr('أي ارتباط', 'Any link') }, { value: 'stage', label: tr('مرحلة', 'Stage') }, { value: 'session', label: tr('جلسة', 'Session') },
                  { value: 'beneficiary', label: tr('مستفيد', 'Beneficiary') }, { value: 'indicator', label: tr('مؤشر', 'Indicator') }, { value: 'output', label: tr('مخرج', 'Output') },
                  { value: 'outcome', label: tr('نتيجة', 'Outcome') }, { value: 'none', label: tr('غير مرتبط', 'Unlinked') }]} />
            </>}
            empty={{ title: tr('لا توجد أدلة مطابقة', 'No matching evidence') }} />
        </CardBody>
      </Card>
      <EvidenceUploadModal open={upload} onClose={() => setUpload(false)} />
    </div>
  );
}
