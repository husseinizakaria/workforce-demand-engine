// Upload / register evidence: file (org-scoped storage) or source URL, with
// links to program entities. Storage object is removed if the row insert fails.
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { all, insert } from '@/services/db';
import { removeFile, uploadFile } from '@/services/storage';
import { errorOf, type AppError } from '@/services/errors';
import { Button, EntityPicker, Field, FileDrop, Input, Modal, Notice, Segmented, Select, Textarea } from '@/components/ui';
import type { Evidence, EvidenceType, ProgramMilestone, ProgramOutcome, ProgramOutput, ProgramStage } from '@/types/db';
import { todayISO } from '@/utils/dates';

export interface EvidencePrefill {
  program_id?: string | null; stage_key?: string | null; evidence_type?: EvidenceType; indicator_id?: string | null; session_id?: string | null;
  output_id?: string | null; outcome_id?: string | null; beneficiary_id?: string | null; title?: string; gapLabel?: string;
}
export type ProgramOpt = { id: string; name: string; name_en: string | null; code: string };

interface Links { cohort_id: string | null; beneficiary_id: string | null; expert_id: string | null; session_id: string | null; indicator_id: string | null; output_id: string | null; outcome_id: string | null; milestone_id: string | null }

export function EvidenceUploadModal({ programs, prefill, onClose, onCreated }: { programs: ProgramOpt[]; prefill?: EvidencePrefill; onClose: () => void; onCreated: (e: Evidence) => void }) {
  const { tr, pick, enumOptions, enumLabel, locale } = useI18n();
  const { org } = useOrg();
  const [mode, setMode] = useState<'file' | 'url'>(prefill?.evidence_type === 'link' ? 'url' : 'file');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState(prefill?.title ?? '');
  const [type, setType] = useState<EvidenceType>(prefill?.evidence_type ?? 'document');
  const [description, setDescription] = useState('');
  const [collected, setCollected] = useState(todayISO());
  const [programId, setProgramId] = useState(prefill?.program_id ?? '');
  const [stageKey, setStageKey] = useState(prefill?.stage_key ?? '');
  const [links, setLinks] = useState<Links>({
    cohort_id: null, beneficiary_id: prefill?.beneficiary_id ?? null, expert_id: null, session_id: prefill?.session_id ?? null, indicator_id: prefill?.indicator_id ?? null,
    output_id: prefill?.output_id ?? null, outcome_id: prefill?.outcome_id ?? null, milestone_id: null,
  });
  const [ref, setRef] = useState<{ stages: ProgramStage[]; outputs: ProgramOutput[]; outcomes: ProgramOutcome[]; milestones: ProgramMilestone[] }>({ stages: [], outputs: [], outcomes: [], milestones: [] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<AppError | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!programId) { setRef({ stages: [], outputs: [], outcomes: [], milestones: [] }); return; }
    let alive = true;
    const f = { filters: [['program_id', 'eq', programId]] as [string, 'eq', string][] };
    const safe = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);
    Promise.all([
      safe(all<ProgramStage>('program_stages', { ...f, order: { column: 'stage_order', ascending: true } })),
      safe(all<ProgramOutput>('program_outputs', { ...f, order: { column: 'code', ascending: true } })),
      safe(all<ProgramOutcome>('program_outcomes', { ...f, order: { column: 'code', ascending: true } })),
      safe(all<ProgramMilestone>('program_milestones', { ...f, order: { column: 'due_date', ascending: true } })),
    ]).then(([stages, outputs, outcomes, milestones]) => { if (alive) setRef({ stages, outputs, outcomes, milestones }); });
    return () => { alive = false; };
  }, [programId]);

  const stage = ref.stages.find((s) => s.stage_key === stageKey);
  const setLink = (k: keyof Links, v: string | null) => setLinks((l) => ({ ...l, [k]: v }));
  const urlOk = /^https?:\/\/\S+$/i.test(url.trim());
  const problems: [string, string][] = [];
  if (!title.trim()) problems.push(['العنوان إلزامي', 'Title is required']);
  if (mode === 'file' && !file) problems.push(['اختر ملفًا', 'Choose a file']);
  if (mode === 'url' && !urlOk) problems.push(['أدخل رابطًا يبدأ بـ http(s)://', 'Enter a link starting with http(s)://']);
  const progLinks = ['cohort_id', 'session_id', 'indicator_id', 'output_id', 'outcome_id', 'milestone_id'] as const;
  if (!programId && progLinks.some((k) => links[k])) problems.push(['الروابط بعناصر البرنامج تتطلب اختيار البرنامج', 'Links to program items require choosing the program']);

  const submit = async () => {
    setTouched(true);
    if (problems.length) return;
    setBusy(true); setErr(null);
    let path: string | null = null;
    try {
      let meta: { file_path?: string; file_name?: string; mime_type?: string | null; file_size?: number } = {};
      if (mode === 'file' && file) {
        const up = await uploadFile('evidence', org.id, `${programId || 'general'}/${stageKey || 'misc'}`, file);
        path = up.path;
        meta = { file_path: up.path, file_name: up.name, mime_type: up.type || null, file_size: up.size };
      }
      const cleanLinks = programId ? links : { ...links, cohort_id: null, session_id: null, indicator_id: null, output_id: null, outcome_id: null, milestone_id: null };
      const row = await insert<Evidence>('evidence', {
        organization_id: org.id, title: title.trim(), evidence_type: type, description: description.trim() || null, collected_at: collected || null,
        source_url: mode === 'url' ? url.trim() : null, program_id: programId || null, stage_key: stageKey || null, ...cleanLinks, ...meta,
        metadata: prefill?.gapLabel ? { uploaded_for_gap: prefill.gapLabel } : {},
      });
      onCreated(row);
    } catch (e) {
      if (path) { try { await removeFile('evidence', path); } catch { /* best effort rollback */ } }
      setErr(errorOf(e));
    } finally { setBusy(false); }
  };

  const pf: [string, 'eq', unknown][] | undefined = programId ? [['program_id', 'eq', programId]] : undefined;
  return (
    <Modal open size="wide" onClose={onClose} title={tr('إضافة دليل', 'Add evidence')}
      footer={<><Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} onClick={submit}>{tr('رفع وتسجيل', 'Upload & register')}</Button></>}>
      <div className="stack">
        {prefill?.gapLabel && <Notice tone="info">{tr('رفع لسد فجوة', 'Uploading for gap')}: {prefill.gapLabel}</Notice>}
        <Segmented value={mode} onChange={setMode} options={[{ value: 'file', label: tr('ملف', 'File') }, { value: 'url', label: tr('رابط مصدر', 'Source URL') }]} />
        {mode === 'file' ? <FileDrop file={file} onFiles={(f) => { const x = f[0] ?? null; setFile(x); if (x && !title.trim()) setTitle(x.name.replace(/\.[^.]+$/, '')); }} />
          : <Field label={tr('الرابط', 'URL')} required><Input dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></Field>}
        <div className="form-grid">
          <Field label={tr('العنوان', 'Title')} required><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label={tr('نوع الدليل', 'Evidence type')} required><Select value={type} onChange={(e) => setType(e.target.value as EvidenceType)} options={enumOptions('evidenceType')} /></Field>
          <Field label={tr('تاريخ الجمع', 'Collected on')}><Input type="date" value={collected} onChange={(e) => setCollected(e.target.value)} /></Field>
          <Field label={tr('البرنامج', 'Program')}>
            <Select value={programId} onChange={(e) => { setProgramId(e.target.value); setStageKey(''); }} placeholder={tr('— دليل عام —', '— General evidence —')} options={programs.map((p) => ({ value: p.id, label: `${pick(p.name, p.name_en)} · ${p.code}` }))} />
          </Field>
          <Field className="full" label={tr('الوصف', 'Description')}><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        </div>
        <b className="small">{tr('الربط', 'Links')}</b>
        <div className="form-grid">
          <Field label={tr('المرحلة', 'Stage')} hint={stage?.required_evidence?.length ? `${tr('الأدلة المطلوبة', 'Required evidence')}: ${stage.required_evidence.map((t) => enumLabel('evidenceType', t)).join('، ')}` : undefined}>
            <Select value={stageKey} disabled={!programId} onChange={(e) => setStageKey(e.target.value)} placeholder={tr('— دون مرحلة —', '— No stage —')} options={ref.stages.map((s) => ({ value: s.stage_key, label: pick(s.name_ar, s.name_en) }))} />
          </Field>
          <Field label={tr('الدفعة', 'Cohort')}>{programId ? <EntityPicker kind="program_cohorts" organizationId={org.id} filters={pf} value={links.cohort_id} onChange={(v) => setLink('cohort_id', v)} /> : <span className="tiny muted">{tr('اختر البرنامج أولًا', 'Choose a program first')}</span>}</Field>
          <Field label={tr('المستفيد', 'Beneficiary')}><EntityPicker kind="beneficiaries" organizationId={org.id} value={links.beneficiary_id} onChange={(v) => setLink('beneficiary_id', v)} /></Field>
          <Field label={tr('الخبير', 'Expert')}><EntityPicker kind="experts" organizationId={org.id} value={links.expert_id} onChange={(v) => setLink('expert_id', v)} /></Field>
          <Field label={tr('الجلسة', 'Session')}>{programId ? <EntityPicker kind="sessions" organizationId={org.id} filters={pf} value={links.session_id} onChange={(v) => setLink('session_id', v)} /> : <span className="tiny muted">{tr('اختر البرنامج أولًا', 'Choose a program first')}</span>}</Field>
          <Field label={tr('المؤشر', 'Indicator')}>{programId ? <EntityPicker kind="indicators" organizationId={org.id} filters={pf} value={links.indicator_id} onChange={(v) => setLink('indicator_id', v)} /> : <span className="tiny muted">{tr('اختر البرنامج أولًا', 'Choose a program first')}</span>}</Field>
          <Field label={tr('المخرج', 'Output')}>
            <Select value={links.output_id ?? ''} disabled={!programId} onChange={(e) => setLink('output_id', e.target.value || null)} placeholder="—" options={ref.outputs.map((o) => ({ value: o.id, label: `${o.code} · ${o.description}` }))} />
          </Field>
          <Field label={tr('النتيجة', 'Outcome')}>
            <Select value={links.outcome_id ?? ''} disabled={!programId} onChange={(e) => setLink('outcome_id', e.target.value || null)} placeholder="—" options={ref.outcomes.map((o) => ({ value: o.id, label: `${o.code} · ${o.description}` }))} />
          </Field>
          <Field label={tr('المعلم', 'Milestone')}>
            <Select value={links.milestone_id ?? ''} disabled={!programId} onChange={(e) => setLink('milestone_id', e.target.value || null)} placeholder="—" options={ref.milestones.map((m) => ({ value: m.id, label: m.title }))} />
          </Field>
        </div>
        {stage && stage.required_evidence.length > 0 && !stage.required_evidence.includes(type) && <Notice tone="info">{tr('نوع الدليل لا يطابق الأنواع المطلوبة لهذه المرحلة؛ لن يسد متطلب المرحلة.', 'This evidence type does not match the stage’s required types; it will not satisfy the stage requirement.')}</Notice>}
        {touched && problems.length > 0 && <Notice tone="warning"><ul style={{ margin: 0, paddingInlineStart: 16 }}>{problems.map((p, i) => <li key={i}>{tr(p[0], p[1])}</li>)}</ul></Notice>}
        {err && <Notice tone="danger">{locale === 'ar' ? err.message_ar : err.message_en}</Notice>}
        <span className="tiny muted">{tr('يدخل الدليل قائمة التحقق بحالة «بانتظار التحقق»؛ لا يمكن لمن رفعه التحقق منه.', 'Evidence enters the verification queue as “pending”; the uploader cannot verify it.')}</span>
      </div>
    </Modal>
  );
}
