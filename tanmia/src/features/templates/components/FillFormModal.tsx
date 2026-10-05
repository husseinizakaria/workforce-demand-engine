// Staff "fill / submit" mode: complete a published form on behalf of a
// beneficiary and create a form_submissions row (server scores it).
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { Button, EntityPicker, Field, Modal, Notice, Select } from '@/components/ui';
import { all, insert } from '@/services/db';
import { errorOf, type AppError } from '@/services/errors';
import type { FormSubmission, FormTemplate, Program } from '@/types/db';
import { FormRenderer } from './FormRenderer';
import { extractSignature, validateFormAnswers, visibleAnswers, type Msg } from '../formUtils';

export function FillFormModal({ template, defaultProgramId, defaultBeneficiaryId, onClose, onSubmitted }: {
  template: FormTemplate; defaultProgramId?: string | null; defaultBeneficiaryId?: string | null; onClose: () => void; onSubmitted?: (s: FormSubmission) => void;
}) {
  const { tr, pick, locale, fmtNumber } = useI18n();
  const { org } = useOrg();
  const fields = template.schema?.fields ?? [];
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, Msg>>({});
  const [beneficiary, setBeneficiary] = useState<string | null>(defaultBeneficiaryId ?? null);
  const [programId, setProgramId] = useState<string>(template.program_id ?? defaultProgramId ?? '');
  const [programs, setPrograms] = useState<Pick<Program, 'id' | 'name' | 'name_en' | 'code'>[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<AppError | null>(null);
  const [done, setDone] = useState<FormSubmission | null>(null);

  useEffect(() => {
    all<Pick<Program, 'id' | 'name' | 'name_en' | 'code'>>('programs', { select: 'id,name,name_en,code', filters: [['organization_id', 'eq', org.id]], order: { column: 'name', ascending: true } }, 2000)
      .then(setPrograms).catch(() => setPrograms([]));
  }, [org.id]);

  const submit = async () => {
    const errs = validateFormAnswers(fields, answers);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (['application', 'registration', 'assessment', 'stage_form', 'follow_up'].includes(template.form_type) && !beneficiary) {
      setErr({ code: 'x', message_ar: 'هذا النوع من النماذج يتطلب تحديد المستفيد', message_en: 'This form type requires a beneficiary' }); return;
    }
    setBusy(true); setErr(null);
    try {
      const row = await insert<FormSubmission>('form_submissions', {
        organization_id: org.id, template_id: template.id, program_id: programId || null, beneficiary_id: beneficiary, stage_key: template.stage_key,
        answers: visibleAnswers(fields, answers), signature: extractSignature(fields, answers), status: 'submitted',
      });
      setDone(row); onSubmitted?.(row);
    } catch (e) { setErr(errorOf(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open size="wide" onClose={onClose} title={`${tr('تعبئة', 'Fill')}: ${pick(template.title, template.title_en)}`}
      footer={done ? <Button variant="primary" onClick={onClose}>{tr('إغلاق', 'Close')}</Button>
        : <><Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} onClick={submit}>{tr('إرسال', 'Submit')}</Button></>}>
      {done ? (
        <Notice tone="success">
          {tr('تم إرسال النموذج.', 'The form was submitted.')} {template.scoring_enabled && <>{tr('الدرجة المحفوظة (من الخادم)', 'Stored score (server)')}: <b className="mono">{done.score === null ? '—' : fmtNumber(Number(done.score), 2)}</b></>}
          {template.requires_review && <div>{tr('يتطلب النموذج مراجعة واعتمادًا من صندوق الوارد.', 'This form requires review and approval from the inbox.')}</div>}
        </Notice>
      ) : (
        <div className="stack">
          <Notice tone="info">{tr('تعبئة نيابة عن مستفيد: سيُسجل اسمك كمقدّم للنموذج.', 'Filling on behalf of a beneficiary: you are recorded as the submitter.')}</Notice>
          <div className="form-grid">
            <Field label={tr('المستفيد', 'Beneficiary')}><EntityPicker kind="beneficiaries" organizationId={org.id} value={beneficiary} onChange={(id) => setBeneficiary(id)} /></Field>
            <Field label={tr('البرنامج', 'Program')}>
              <Select value={programId} disabled={!!template.program_id} onChange={(e) => setProgramId(e.target.value)} placeholder={tr('— دون برنامج —', '— No program —')}
                options={programs.map((p) => ({ value: p.id, label: `${pick(p.name, p.name_en)} · ${p.code}` }))} />
            </Field>
          </div>
          {err && <Notice tone="danger">{locale === 'ar' ? err.message_ar : err.message_en}</Notice>}
          {Object.keys(errors).length > 0 && <Notice tone="warning">{tr(`${Object.keys(errors).length} حقل يحتاج إلى استكمال`, `${Object.keys(errors).length} field(s) need attention`)}</Notice>}
          <FormRenderer fields={fields} answers={answers} onChange={(a) => { setAnswers(a); if (Object.keys(errors).length) setErrors(validateFormAnswers(fields, a)); }}
            errors={errors} organizationId={org.id} scoringEnabled={template.scoring_enabled} />
        </div>
      )}
    </Modal>
  );
}
