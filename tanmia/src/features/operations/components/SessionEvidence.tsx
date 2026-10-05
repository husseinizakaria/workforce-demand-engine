import { useState } from 'react';
import { ExternalLink, Upload } from 'lucide-react';
import { Button, Field, FileDrop, Input, Notice, Select, StatusBadge, useToast } from '@/components/ui';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { insert } from '@/services/db';
import { signedUrl, uploadFile } from '@/services/storage';
import { riyadhDate } from '@/utils/dates';
import type { Evidence, Session } from '@/types/db';
import { errMsg } from '@/features/beneficiaries/components/dataUtils';

const TYPES = ['attendance_sheet', 'photo', 'minutes', 'video', 'document'];

export function SessionEvidence({ session, evidence, onChanged }: { session: Session; evidence: Evidence[]; onChanged: () => void }) {
  const { org, can } = useOrg();
  const { tr, enumLabel, fmtDate, locale } = useI18n();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState('attendance_sheet');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const scope = `${session.program_id ?? 'general'}/sessions/${session.id}`;
      const up = await uploadFile('evidence', org.id, scope, file);
      await insert<Evidence>('evidence', {
        organization_id: org.id, program_id: session.program_id, cohort_id: session.cohort_id, session_id: session.id, expert_id: session.expert_id,
        stage_key: session.stage_key, title: title.trim() || `${enumLabel('evidenceType', type)} — ${session.code}`, evidence_type: type,
        file_path: up.path, file_name: up.name, mime_type: up.type || null, file_size: up.size, collected_at: riyadhDate(session.starts_at),
      });
      toast.success(tr('رُفع الدليل وهو بانتظار التحقق', 'Evidence uploaded and awaiting verification'));
      setFile(null); setTitle(''); onChanged();
    } catch (e) { toast.error(errMsg(e, locale)); } finally { setBusy(false); }
  };
  const open = async (e: Evidence) => {
    try {
      if (e.file_path) window.open(await signedUrl('evidence', e.file_path), '_blank', 'noopener');
      else if (e.source_url) window.open(e.source_url, '_blank', 'noopener');
    } catch (x) { toast.error(errMsg(x, locale)); }
  };
  const hasSheet = evidence.some((e) => e.evidence_type === 'attendance_sheet');
  return (
    <div className="stack-sm">
      {session.status === 'completed' && !hasSheet && <Notice tone="warning">{tr('لا يوجد كشف حضور مرفوع لجلسة مكتملة؛ قد يُطلب كدليل على التنفيذ.', 'No attendance sheet uploaded for a completed session; it may be required as delivery evidence.')}</Notice>}
      <ul className="list-plain small">
        {evidence.length === 0 && <li className="muted">{tr('لا توجد أدلة لهذه الجلسة', 'No evidence for this session')}</li>}
        {evidence.map((e) => (
          <li key={e.id} className="row between">
            <span><span className="mono">{e.code}</span> {e.title} · {enumLabel('evidenceType', e.evidence_type)} · {fmtDate(e.created_at)}</span>
            <span className="row"><StatusBadge group="verification" value={e.verification_status} />{(e.file_path || e.source_url) && <Button size="sm" variant="ghost" iconOnly icon={<ExternalLink />} aria-label={tr('فتح', 'Open')} onClick={() => void open(e)} />}</span>
          </li>
        ))}
      </ul>
      {can('evidence.create') ? (
        <div className="card card-pad stack-sm">
          <FileDrop file={file} onFiles={(f) => setFile(f[0] ?? null)} />
          <div className="form-grid">
            <Field label={tr('نوع الدليل', 'Evidence type')}><Select options={TYPES.map((t) => ({ value: t, label: enumLabel('evidenceType', t) }))} value={type} onChange={(e) => setType(e.target.value)} /></Field>
            <Field label={tr('العنوان', 'Title')}><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${enumLabel('evidenceType', type)} — ${session.code}`} /></Field>
          </div>
          <div><Button variant="primary" icon={<Upload />} loading={busy} disabled={!file} onClick={() => void upload()}>{tr('رفع الدليل', 'Upload evidence')}</Button></div>
        </div>
      ) : <span className="tiny muted">{tr('رفع الأدلة يتطلب صلاحية «الأدلة ← إنشاء».', 'Uploading evidence requires “Evidence → Create”.')}</span>}
    </div>
  );
}
