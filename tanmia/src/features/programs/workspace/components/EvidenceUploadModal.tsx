// Upload evidence (file to the private evidence bucket, or an external URL) and
// link it to a stage, session, beneficiary, indicator, output or outcome.
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { Button, Field, FileDrop, Input, Modal, Notice, Segmented, Select, Textarea } from '@/components/ui';
import { insert } from '@/services/db';
import { removeFile, uploadFile } from '@/services/storage';
import { errorOf, type AppError } from '@/services/errors';
import type { Evidence, EvidenceType } from '@/types/db';
import { errText } from '../../lib';
import { useWorkspace } from '../context';

export interface EvidencePreset {
  stage_key?: string | null; evidence_type?: EvidenceType; session_id?: string | null; beneficiary_id?: string | null;
  indicator_id?: string | null; output_id?: string | null; outcome_id?: string | null; title?: string;
}

const EMPTY = { title: '', evidence_type: 'document', description: '', source_url: '', collected_at: '', stage_key: '', session_id: '', beneficiary_id: '', indicator_id: '', output_id: '', outcome_id: '' };

export function EvidenceUploadModal({ open, onClose, preset, onSaved, lock }: {
  open: boolean; onClose: () => void; preset?: EvidencePreset; onSaved?: (e: Evidence) => void; lock?: ('stage_key' | 'evidence_type')[];
}) {
  const { tr, enumOptions, locale, fmtDateTime } = useI18n();
  const { org } = useOrg();
  const ws = useWorkspace();
  const { bundle } = ws;
  const [mode, setMode] = useState<'file' | 'url'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [v, setV] = useState<Record<string, string>>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    const p = preset ?? {};
    setV({
      ...EMPTY, title: p.title ?? '', evidence_type: p.evidence_type ?? 'document', stage_key: p.stage_key ?? '', session_id: p.session_id ?? '',
      beneficiary_id: p.beneficiary_id ?? '', indicator_id: p.indicator_id ?? '', output_id: p.output_id ?? '', outcome_id: p.outcome_id ?? '',
    });
    setFile(null); setError(null); setErrors({}); setMode(p.evidence_type === 'link' ? 'url' : 'file');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (k: string, val: string) => setV((s) => ({ ...s, [k]: val }));
  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!v.title.trim()) errs.title = tr('العنوان إلزامي', 'Title is required');
    if (mode === 'file' && !file) errs.file = tr('اختر ملفًا', 'Choose a file');
    if (mode === 'url' && !/^https?:\/\//i.test(v.source_url.trim())) errs.source_url = tr('أدخل رابطًا يبدأ بـ http(s)://', 'Enter a URL starting with http(s)://');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    let uploaded: string | null = null;
    try {
      let fileFields: Record<string, unknown> = {};
      if (mode === 'file' && file) {
        const up = await uploadFile('evidence', org.id, `${ws.programId}/${v.stage_key || 'general'}`, file);
        uploaded = up.path;
        fileFields = { file_path: up.path, file_name: up.name, file_size: up.size, mime_type: up.type || null };
      }
      const row = await insert<Evidence>('evidence', {
        organization_id: org.id, program_id: ws.programId, title: v.title.trim(), evidence_type: v.evidence_type,
        description: v.description.trim() || null, source_url: mode === 'url' ? v.source_url.trim() : null, collected_at: v.collected_at || null,
        stage_key: v.stage_key || null, session_id: v.session_id || null, beneficiary_id: v.beneficiary_id || null,
        indicator_id: v.indicator_id || null, output_id: v.output_id || null, outcome_id: v.outcome_id || null, ...fileFields,
      });
      onSaved?.(row);
      await ws.reload();
      onClose();
    } catch (e) {
      if (uploaded) { try { await removeFile('evidence', uploaded); } catch { /* best effort cleanup */ } }
      setError(errorOf(e));
    } finally { setBusy(false); }
  };

  const opt = (rows: { id: string; label: string }[]) => rows.map((r) => ({ value: r.id, label: r.label }));
  return (
    <Modal open={open} onClose={onClose} size="wide" title={tr('رفع دليل', 'Upload evidence')}
      footer={<><Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} onClick={() => void submit()}>{tr('رفع وحفظ', 'Upload & save')}</Button></>}>
      {error && <Notice tone="danger">{errText(locale, error)}</Notice>}
      <Notice tone="info">{tr('يُحفظ الدليل بحالة «بانتظار التحقق». لا يمكن لرافع الدليل التحقق منه بنفسه؛ يتحقق منه صاحب صلاحية التحقق.', 'Evidence is saved as “pending verification”. The uploader cannot verify their own evidence; a verifier reviews it.')}</Notice>
      <div className="form-grid">
        <Field label={tr('العنوان', 'Title')} required error={errors.title}><Input value={v.title} onChange={(e) => set('title', e.target.value)} invalid={!!errors.title} /></Field>
        <Field label={tr('نوع الدليل', 'Evidence type')} required>
          <Select options={enumOptions('evidenceType')} value={v.evidence_type} disabled={lock?.includes('evidence_type')} onChange={(e) => set('evidence_type', e.target.value)} />
        </Field>
        <Field label={tr('المصدر', 'Source')} className="full">
          <Segmented options={[{ value: 'file', label: tr('ملف', 'File') }, { value: 'url', label: tr('رابط', 'URL') }]} value={mode} onChange={setMode} />
        </Field>
        {mode === 'file' ? (
          <Field className="full" error={errors.file}><FileDrop file={file} onFiles={(f) => setFile(f[0] ?? null)} /></Field>
        ) : (
          <Field label={tr('الرابط', 'URL')} className="full" required error={errors.source_url}>
            <Input dir="ltr" value={v.source_url} onChange={(e) => set('source_url', e.target.value)} placeholder="https://" invalid={!!errors.source_url} />
          </Field>
        )}
        <Field label={tr('تاريخ الجمع', 'Collected on')}><Input type="date" value={v.collected_at} onChange={(e) => set('collected_at', e.target.value)} /></Field>
        <Field label={tr('المرحلة', 'Stage')}>
          <Select placeholder={tr('— بدون —', '— None —')} disabled={lock?.includes('stage_key')} value={v.stage_key} onChange={(e) => set('stage_key', e.target.value)}
            options={bundle.stages.map((s) => ({ value: s.stage_key, label: ws.stageName(s.stage_key) }))} />
        </Field>
        <Field label={tr('الجلسة', 'Session')}>
          <Select placeholder={tr('— بدون —', '— None —')} value={v.session_id} onChange={(e) => set('session_id', e.target.value)}
            options={opt(bundle.sessions.map((s) => ({ id: s.id, label: `${s.code} · ${s.title} · ${fmtDateTime(s.starts_at)}` })))} />
        </Field>
        <Field label={tr('المستفيد', 'Beneficiary')}>
          <Select placeholder={tr('— بدون —', '— None —')} value={v.beneficiary_id} onChange={(e) => set('beneficiary_id', e.target.value)}
            options={opt(ws.enrolled.map((b) => ({ id: b.id, label: `${b.full_name} · ${b.code}` })))} />
        </Field>
        <Field label={tr('المؤشر', 'Indicator')}>
          <Select placeholder={tr('— بدون —', '— None —')} value={v.indicator_id} onChange={(e) => set('indicator_id', e.target.value)}
            options={opt(bundle.indicators.map((i) => ({ id: i.id, label: `${i.code} · ${i.name}` })))} />
        </Field>
        <Field label={tr('المخرج', 'Output')}>
          <Select placeholder={tr('— بدون —', '— None —')} value={v.output_id} onChange={(e) => set('output_id', e.target.value)}
            options={opt(bundle.outputs.map((o) => ({ id: o.id, label: `${o.code} · ${o.description}` })))} />
        </Field>
        <Field label={tr('النتيجة', 'Outcome')}>
          <Select placeholder={tr('— بدون —', '— None —')} value={v.outcome_id} onChange={(e) => set('outcome_id', e.target.value)}
            options={opt(bundle.outcomes.map((o) => ({ id: o.id, label: `${o.code} · ${o.description}` })))} />
        </Field>
        <Field label={tr('الوصف', 'Description')} className="full"><Textarea value={v.description} onChange={(e) => set('description', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
