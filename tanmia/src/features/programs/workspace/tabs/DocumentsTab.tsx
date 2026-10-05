// Documents: program document library with versioning (a new version
// supersedes the previous one) and signed downloads.
import { useState } from 'react';
import { Archive, FileUp, FolderOpen, History } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAsync } from '@/hooks/useAsync';
import { useAction } from '@/hooks/useAction';
import { all, insert, update } from '@/services/db';
import { removeFile, uploadFile } from '@/services/storage';
import { errorOf, type AppError } from '@/services/errors';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, DataTable, Field, FileDrop, Input, Modal, Notice, Select, type Column } from '@/components/ui';
import type { DocumentRow } from '@/types/db';
import { errText } from '../../lib';
import { useWorkspace } from '../context';
import { FileLink, RowActions } from '../components/common';

export default function DocumentsTab() {
  const { tr, enumLabel, fmtDate, fmtNumber, locale } = useI18n();
  const { can, org } = useOrg();
  const ws = useWorkspace();
  const [showAll, setShowAll] = useState(false);
  const [upload, setUpload] = useState<DocumentRow | 'new' | null>(null);
  const state = useAsync(() => all<DocumentRow>('documents', { filters: [['organization_id', 'eq', org.id], ['program_id', 'eq', ws.programId]], order: { column: 'created_at' } }), [ws.programId]);
  const docs = state.data ?? [];
  const rows = showAll ? docs : docs.filter((d) => d.status === 'active');
  const versions = (d: DocumentRow) => docs.filter((x) => x.title === d.title && x.doc_type === d.doc_type).length;
  const archive = useAction(async (d: DocumentRow) => { await update<DocumentRow>('documents', d.id, { status: 'archived' }); await state.reload(); }, { success: ['تمت الأرشفة', 'Archived'] });
  const cols: Column<DocumentRow>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), render: (r) => <span className="mono">{r.code}</span>, value: (r) => r.code },
    { key: 'title', header: tr('العنوان', 'Title'), sortable: true, render: (r) => <span>{r.title}<span className="sub">{r.file_name ?? ''}</span></span>, value: (r) => r.title },
    { key: 'type', header: tr('النوع', 'Type'), value: (r) => enumLabel('docType', r.doc_type) },
    { key: 'version', header: tr('الإصدار', 'Version'), align: 'end', value: (r) => r.version, render: (r) => <span>v{r.version}{versions(r) > 1 && <span className="tiny muted"> / {versions(r)}</span>}</span> },
    { key: 'status', header: tr('الحالة', 'Status'), value: (r) => r.status, render: (r) => <Badge tone={r.status === 'active' ? 'success' : 'neutral'}>{r.status === 'active' ? tr('ساري', 'Active') : r.status === 'superseded' ? tr('إصدار سابق', 'Superseded') : tr('مؤرشف', 'Archived')}</Badge> },
    { key: 'size', header: tr('الحجم', 'Size'), align: 'end', value: (r) => r.file_size, render: (r) => (r.file_size ? `${fmtNumber(r.file_size / 1024, 0)} KB` : '—') },
    { key: 'created', header: tr('الرفع', 'Uploaded'), sortable: true, value: (r) => r.created_at, render: (r) => fmtDate(r.created_at) },
    { key: 'actions', header: '', hideInExport: true, render: (r) => (
      <RowActions>
        <FileLink bucket="documents" path={r.file_path} label={tr('تنزيل', 'Download')} />
        {r.status === 'active' && can('evidence.create') && <Button size="sm" variant="ghost" icon={<History />} onClick={() => setUpload(r)}>{tr('إصدار جديد', 'New version')}</Button>}
        {r.status === 'active' && can('evidence.edit') && <Button size="sm" variant="ghost" iconOnly icon={<Archive />} aria-label={tr('أرشفة', 'Archive')} onClick={() => void archive.run(r)} />}
      </RowActions>
    ) },
  ];
  return (
    <div className="stack">
      {state.error && <Notice tone="danger">{errText(locale, state.error)}</Notice>}
      <Card>
        <CardHeader icon={<FolderOpen />} title={tr('مستندات البرنامج', 'Program documents')} hint={tr('الخطط والاتفاقيات والمحاضر والتقارير', 'Plans, agreements, minutes and reports')}
          actions={<>
            <Checkbox checked={showAll} onChange={setShowAll} label={<span className="small">{tr('إظهار الإصدارات السابقة والمؤرشفة', 'Show superseded & archived')}</span>} />
            {can('evidence.create') && <Button size="sm" variant="primary" icon={<FileUp />} onClick={() => setUpload('new')}>{tr('رفع مستند', 'Upload document')}</Button>}
          </>} />
        <CardBody flush>
          <DataTable rows={rows} loading={state.loading} rowKey={(r) => r.id} columns={cols} searchable exportName={`${ws.bundle.program.code}-documents`}
            empty={{ title: tr('لا توجد مستندات', 'No documents') }} />
        </CardBody>
      </Card>
      {upload && <UploadDocModal previous={upload === 'new' ? null : upload} onClose={() => setUpload(null)} onDone={state.reload} />}
    </div>
  );
}

function UploadDocModal({ previous, onClose, onDone }: { previous: DocumentRow | null; onClose: () => void; onDone: () => Promise<void> }) {
  const { tr, enumOptions, locale } = useI18n();
  const { org } = useOrg();
  const ws = useWorkspace();
  const [title, setTitle] = useState(previous?.title ?? '');
  const [docType, setDocType] = useState<string>(previous?.doc_type ?? 'plan');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const submit = async () => {
    if (!title.trim() || !file) { setError({ code: 'invalid', message_ar: 'العنوان والملف مطلوبان', message_en: 'Title and file are required' }); return; }
    setBusy(true); setError(null);
    let path: string | null = null;
    try {
      const up = await uploadFile('documents', org.id, ws.programId, file);
      path = up.path;
      await insert<DocumentRow>('documents', {
        organization_id: org.id, program_id: ws.programId, title: title.trim(), doc_type: docType, file_path: up.path, file_name: up.name,
        mime_type: up.type || null, file_size: up.size, version: previous ? previous.version + 1 : 1, status: 'active',
      });
      if (previous) await update<DocumentRow>('documents', previous.id, { status: 'superseded' });
      await onDone(); onClose();
    } catch (e) {
      if (path) { try { await removeFile('documents', path); } catch { /* best effort */ } }
      setError(errorOf(e));
    } finally { setBusy(false); }
  };
  return (
    <Modal open title={previous ? `${tr('إصدار جديد', 'New version')}: ${previous.title} (v${previous.version + 1})` : tr('رفع مستند', 'Upload document')} onClose={onClose}
      footer={<><Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} onClick={() => void submit()}>{tr('رفع', 'Upload')}</Button></>}>
      {error && <Notice tone="danger">{errText(locale, error)}</Notice>}
      {previous && <Notice tone="info">{tr(`سيُعلَّم الإصدار v${previous.version} كإصدار سابق ويبقى متاحًا للرجوع إليه.`, `Version v${previous.version} will be marked superseded and kept for reference.`)}</Notice>}
      <Field label={tr('العنوان', 'Title')} required><Input value={title} disabled={!!previous} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label={tr('النوع', 'Type')}><Select options={enumOptions('docType')} value={docType} disabled={!!previous} onChange={(e) => setDocType(e.target.value)} /></Field>
      <FileDrop file={file} onFiles={(f) => setFile(f[0] ?? null)} />
    </Modal>
  );
}
