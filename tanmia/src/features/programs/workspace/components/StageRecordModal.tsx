// Dynamic stage-record form driven by the engine's RECORD_TYPES definitions
// (judging scores, diagnostics, IDP items, placements, ...).
import { useEffect, useMemo, useState } from 'react';
import { RECORD_TYPES, type RecordField } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { Button, Field, Input, Modal, Notice, Select, Textarea } from '@/components/ui';
import { insert, update } from '@/services/db';
import { errorOf, type AppError } from '@/services/errors';
import type { ProgramStageRecord, ProgramTeam } from '@/types/db';
import { avg, errText, round1 } from '../../lib';
import { useWorkspace } from '../context';

export function recordScore(fields: RecordField[], payload: Record<string, unknown>): number | null {
  const nums = fields.filter((f) => f.type === 'number' && f.scored)
    .map((f) => payload[f.key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return round1(avg(nums));
}

export function StageRecordModal({ open, onClose, stageKey, recordType, existing, teams }: {
  open: boolean; onClose: () => void; stageKey: string; recordType: string; existing?: ProgramStageRecord | null; teams: ProgramTeam[];
}) {
  const { tr, locale, L, enumOptions } = useI18n();
  const { org } = useOrg();
  const ws = useWorkspace();
  const def = RECORD_TYPES[recordType];
  const [values, setValues] = useState<Record<string, string>>({});
  const [meta, setMeta] = useState({ title: '', status: 'open', due_date: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  useEffect(() => {
    if (!open) return;
    const p = existing?.payload ?? {};
    setValues(Object.fromEntries((def?.fields ?? []).map((f) => [f.key, p[f.key] === undefined || p[f.key] === null ? '' : String(p[f.key])])));
    setMeta({ title: existing?.title ?? '', status: existing?.status ?? 'open', due_date: existing?.due_date ?? '' });
    setErrors({}); setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.id, recordType]);

  const liveScore = useMemo(() => {
    if (!def) return null;
    const payload: Record<string, unknown> = {};
    for (const f of def.fields) if (f.type === 'number' && values[f.key] !== '' && values[f.key] !== undefined) payload[f.key] = Number(values[f.key]);
    return recordScore(def.fields, payload);
  }, [def, values]);

  if (!def) {
    return (
      <Modal open={open} onClose={onClose} title={tr('نوع سجل غير معروف', 'Unknown record type')}>
        <Notice tone="warning">{tr(`نوع السجل «${recordType}» غير معرّف في المحرك.`, `Record type “${recordType}” is not defined in the engine.`)}</Notice>
      </Modal>
    );
  }
  const label = (f: RecordField) => (locale === 'ar' ? f.label_ar : f.label_en);
  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));

  const submit = async () => {
    const errs: Record<string, string> = {};
    const payload: Record<string, unknown> = {};
    for (const f of def.fields) {
      const raw = (values[f.key] ?? '').trim();
      if (!raw) { if (f.required) errs[f.key] = tr('حقل إلزامي', 'Required'); continue; }
      if (f.type === 'number') {
        const n = Number(raw);
        if (!Number.isFinite(n)) { errs[f.key] = tr('رقم غير صالح', 'Invalid number'); continue; }
        if (f.min !== undefined && n < f.min) { errs[f.key] = tr(`الحد الأدنى ${f.min}`, `Minimum ${f.min}`); continue; }
        if (f.max !== undefined && n > f.max) { errs[f.key] = tr(`الحد الأقصى ${f.max}`, `Maximum ${f.max}`); continue; }
        payload[f.key] = n;
      } else payload[f.key] = raw;
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const idOf = (type: RecordField['type']) => {
      const f = def.fields.find((x) => x.type === type);
      return f ? ((payload[f.key] as string | undefined) ?? null) : null;
    };
    const beneficiary_id = idOf('beneficiary'); const team_id = idOf('team'); const expert_id = idOf('expert');
    const subject = beneficiary_id ? ws.benName(beneficiary_id) : team_id ? teams.find((t) => t.id === team_id)?.name : expert_id ? ws.expertName(expert_id) : null;
    const title = meta.title.trim() || [locale === 'ar' ? def.name_ar : def.name_en, subject].filter(Boolean).join(' · ');
    const row = {
      title, status: meta.status, due_date: meta.due_date || null, payload, score: recordScore(def.fields, payload),
      beneficiary_id, team_id, expert_id,
    };
    setBusy(true); setError(null);
    try {
      if (existing) await update<ProgramStageRecord>('program_stage_records', existing.id, row);
      else await insert<ProgramStageRecord>('program_stage_records', { ...row, organization_id: org.id, program_id: ws.programId, stage_key: stageKey, record_type: recordType });
      await ws.reload();
      onClose();
    } catch (e) { setError(errorOf(e)); } finally { setBusy(false); }
  };

  const control = (f: RecordField) => {
    const v = values[f.key] ?? '';
    const invalid = !!errors[f.key];
    switch (f.type) {
      case 'textarea': return <Textarea value={v} onChange={(e) => set(f.key, e.target.value)} invalid={invalid} />;
      case 'number': return <Input type="number" dir="ltr" value={v} min={f.min} max={f.max} step="any" onChange={(e) => set(f.key, e.target.value)} invalid={invalid} />;
      case 'date': return <Input type="date" value={v} onChange={(e) => set(f.key, e.target.value)} invalid={invalid} />;
      case 'select': return <Select value={v} invalid={invalid} placeholder={tr('— اختر —', '— Select —')} onChange={(e) => set(f.key, e.target.value)}
        options={(f.options ?? []).map((o) => ({ value: o.value, label: locale === 'ar' ? o.label_ar : o.label_en }))} />;
      case 'beneficiary': return <Select value={v} invalid={invalid} placeholder={tr('— اختر مستفيدًا مسجلًا —', '— Select an enrolled beneficiary —')} onChange={(e) => set(f.key, e.target.value)}
        options={ws.enrolled.map((b) => ({ value: b.id, label: `${b.full_name} · ${b.code}` }))} />;
      case 'team': return <Select value={v} invalid={invalid} placeholder={tr('— اختر فريقًا —', '— Select a team —')} onChange={(e) => set(f.key, e.target.value)}
        options={teams.map((t) => ({ value: t.id, label: `${t.name} · ${t.code}` }))} />;
      case 'expert': return <Select value={v} invalid={invalid} placeholder={tr('— اختر خبيرًا مسندًا —', '— Select an assigned expert —')} onChange={(e) => set(f.key, e.target.value)}
        options={ws.bundle.experts.map((x) => ({ value: x.id, label: `${x.full_name} · ${x.code}` }))} />;
      default: return <Input value={v} onChange={(e) => set(f.key, e.target.value)} invalid={invalid} />;
    }
  };
  const needsTeams = def.fields.some((f) => f.type === 'team') && !teams.length;
  const needsExperts = def.fields.some((f) => f.type === 'expert') && !ws.bundle.experts.length;
  const needsBen = def.fields.some((f) => f.type === 'beneficiary' && f.required) && !ws.enrolled.length;

  return (
    <Modal open={open} onClose={onClose} size="wide"
      title={`${existing ? tr('تعديل سجل', 'Edit record') : tr('سجل جديد', 'New record')}: ${L({ ar: def.name_ar, en: def.name_en })} · ${ws.stageName(stageKey)}`}
      footer={<><Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} onClick={() => void submit()}>{tr('حفظ', 'Save')}</Button></>}>
      {error && <Notice tone="danger">{errText(locale, error)}</Notice>}
      {needsTeams && <Notice tone="warning">{tr('لا توجد فرق في البرنامج بعد؛ أنشئ الفرق من تبويب المشاركين.', 'No teams exist yet; create teams in the Participants tab.')}</Notice>}
      {needsExperts && <Notice tone="warning">{tr('لا يوجد خبراء مسندون للبرنامج؛ أسند خبيرًا من تبويب الخبراء.', 'No experts are assigned to the program; assign one in the Experts tab.')}</Notice>}
      {needsBen && <Notice tone="warning">{tr('لا يوجد مستفيدون مسجلون في البرنامج.', 'No beneficiaries are enrolled in the program.')}</Notice>}
      <div className="form-grid">
        <Field label={tr('العنوان', 'Title')} hint={tr('يُولّد تلقائيًا إن تُرك فارغًا', 'Generated automatically when left empty')}>
          <Input value={meta.title} onChange={(e) => setMeta((m) => ({ ...m, title: e.target.value }))} />
        </Field>
        <div className="form-grid" style={{ gap: 8 }}>
          <Field label={tr('الحالة', 'Status')}>
            <Select options={enumOptions('actionStatus')} value={meta.status} onChange={(e) => setMeta((m) => ({ ...m, status: e.target.value }))} />
          </Field>
          <Field label={tr('تاريخ الاستحقاق', 'Due date')}>
            <Input type="date" value={meta.due_date} onChange={(e) => setMeta((m) => ({ ...m, due_date: e.target.value }))} />
          </Field>
        </div>
        {def.fields.map((f) => (
          <Field key={f.key} label={label(f)} required={f.required} className={f.type === 'textarea' ? 'full' : undefined} error={errors[f.key]}
            hint={f.type === 'number' && (f.min !== undefined || f.max !== undefined) ? `${f.min ?? ''} – ${f.max ?? ''}${f.scored ? ' · ' + tr('يدخل في الدرجة', 'counts toward score') : ''}` : undefined}>
            {control(f)}
          </Field>
        ))}
      </div>
      {def.fields.some((f) => f.scored) && (
        <p className="small muted">{tr('الدرجة = متوسط الحقول الرقمية المحتسبة', 'Score = average of scored numeric fields')}: <b>{liveScore ?? '—'}</b></p>
      )}
    </Modal>
  );
}
