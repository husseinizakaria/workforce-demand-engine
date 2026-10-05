// Documents attached to a registry entity (beneficiary, expert, vendor, partner).
// Files go to the org-scoped 'documents' bucket; the row goes to public.documents.
import { useState } from 'react';
import { ExternalLink, FileText, Upload } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, Field, FileDrop, Input, Modal, Notice, Select, type Column } from '@/components/ui';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { useAsync } from '@/hooks/useAsync';
import { useAction } from '@/hooks/useAction';
import { all, insert } from '@/services/db';
import { signedUrl, uploadFile } from '@/services/storage';
import type { DocumentRow } from '@/types/db';
import { errMsg } from './dataUtils';

export type DocOwner = 'beneficiary_id' | 'expert_id' | 'vendor_id' | 'partner_id';

export function EntityDocuments({ owner, ownerId, defaultType = 'other', title }: { owner: DocOwner; ownerId: string; defaultType?: DocumentRow['doc_type']; title?: string }) {
  const { org, can } = useOrg();
  const { tr, fmtDate, fmtNumber, enumOptions, enumLabel, locale } = useI18n();
  const state = useAsync(() => all<DocumentRow>('documents', {
    filters: [['organization_id', 'eq', org.id], [owner, 'eq', ownerId]], order: { column: 'created_at', ascending: false },
  }, 500), [org.id, owner, ownerId]);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [docTitle, setDocTitle] = useState('');
  const [docType, setDocType] = useState<string>(defaultType);
  const [err, setErr] = useState<string | null>(null);

  const upload = useAction(async () => {
    if (!file) throw { code: '23502', message_ar: 'اختر ملفًا أولًا', message_en: 'Choose a file first' };
    const up = await uploadFile('documents', org.id, `${owner.replace('_id', '')}/${ownerId}`, file);
    return insert<DocumentRow>('documents', {
      organization_id: org.id, [owner]: ownerId, title: docTitle.trim() || file.name, doc_type: docType,
      file_path: up.path, file_name: up.name, mime_type: up.type || null, file_size: up.size,
    });
  }, { success: ['تم رفع المستند', 'Document uploaded'], onDone: () => { setOpen(false); setFile(null); setDocTitle(''); void state.reload(); } });

  const openFile = async (d: DocumentRow) => {
    setErr(null);
    try { window.open(await signedUrl('documents', d.file_path), '_blank', 'noopener'); } catch (e) { setErr(errMsg(e, locale)); }
  };

  const cols: Column<DocumentRow>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), render: (d) => <span className="mono">{d.code}</span>, sortable: true },
    { key: 'title', header: tr('العنوان', 'Title'), sortable: true, render: (d) => <span className="row"><FileText size={14} />{d.title}</span> },
    { key: 'doc_type', header: tr('النوع', 'Type'), value: (d) => enumLabel('docType', d.doc_type) },
    { key: 'file_size', header: tr('الحجم', 'Size'), align: 'end', value: (d) => d.file_size, render: (d) => (d.file_size ? `${fmtNumber(d.file_size / 1024, 0)} KB` : '—') },
    { key: 'status', header: tr('الحالة', 'Status'), value: (d) => d.status,
      render: (d) => <Badge tone={d.status === 'active' ? 'success' : 'neutral'}>{d.status === 'active' ? tr('ساري', 'Active') : d.status === 'superseded' ? tr('مستبدل', 'Superseded') : tr('مؤرشف', 'Archived')}</Badge> },
    { key: 'created_at', header: tr('تاريخ الرفع', 'Uploaded'), value: (d) => d.created_at, render: (d) => fmtDate(d.created_at), sortable: true },
    { key: 'open', header: '', hideInExport: true, render: (d) => <Button size="sm" variant="ghost" icon={<ExternalLink />} onClick={(e) => { e.stopPropagation(); void openFile(d); }}>{tr('فتح', 'Open')}</Button> },
  ];

  if (!can('evidence.view')) {
    return <Notice tone="info">{tr('عرض المستندات يتطلب صلاحية «الأدلة ← عرض».', 'Viewing documents requires the “Evidence → View” permission.')}</Notice>;
  }
  return (
    <Card>
      <CardHeader title={title ?? tr('المستندات', 'Documents')} icon={<FileText />}
        actions={can('evidence.create') ? <Button size="sm" variant="primary" icon={<Upload />} onClick={() => setOpen(true)}>{tr('رفع مستند', 'Upload document')}</Button> : undefined} />
      <CardBody flush>
        {err && <div className="card-pad"><Notice tone="danger">{err}</Notice></div>}
        <DataTable columns={cols} rows={state.data ?? []} rowKey={(d) => d.id} loading={state.loading} error={state.error} onRetry={state.reload}
          empty={{ title: tr('لا توجد مستندات', 'No documents yet'), description: tr('ارفع العقود والهويات والشهادات المرتبطة بهذا السجل.', 'Upload contracts, IDs and certificates related to this record.') }} />
      </CardBody>
      <Modal open={open} onClose={() => setOpen(false)} title={tr('رفع مستند', 'Upload document')}
        footer={<><Button onClick={() => setOpen(false)}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={upload.busy} disabled={!file} onClick={() => void upload.run()}>{tr('رفع', 'Upload')}</Button></>}>
        <div className="stack-sm">
          <FileDrop file={file} onFiles={(f) => { setFile(f[0] ?? null); if (f[0] && !docTitle) setDocTitle(f[0].name.replace(/\.[^.]+$/, '')); }} />
          <div className="form-grid">
            <Field label={tr('العنوان', 'Title')}><Input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} /></Field>
            <Field label={tr('نوع المستند', 'Document type')}><Select options={enumOptions('docType')} value={docType} onChange={(e) => setDocType(e.target.value)} /></Field>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
