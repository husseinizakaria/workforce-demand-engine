// Dimensions & questions of a central assessment tool (organization_id NULL).
import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { QuestionOption } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { AsyncView, Badge, Button, Card, CardBody, CardHeader, Checkbox, Drawer, EmptyState, Field, Input, Modal, Notice, Select, Textarea, useConfirm } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { useAction } from '@/hooks/useAction';
import * as db from '@/services/db';
import { type AppError, errorOf } from '@/services/errors';
import type { AssessmentDimension, AssessmentQuestion, AssessmentTool } from '@/types/db';
import { PlatformFormModal, type PlatformFieldSpec } from './PlatformForm';
import { OptionsEditor, optionsProblems } from './OptionsEditor';
import { useErrText } from './common';

const CODE = /^[A-Za-z0-9_.-]{1,40}$/;
const CHOICE = ['single_choice', 'multiple_choice'];

interface Content { dims: AssessmentDimension[]; qs: AssessmentQuestion[] }

export function ToolContentDrawer({ tool, onClose, onChanged }: { tool: AssessmentTool | null; onClose: () => void; onChanged: () => void }) {
  const { tr, pick, enumLabel, fmtNumber } = useI18n();
  const confirm = useConfirm();
  const state = useAsync<Content>(async () => {
    if (!tool) return { dims: [], qs: [] };
    const [dims, qs] = await Promise.all([
      db.all<AssessmentDimension>('assessment_dimensions', { filters: [['tool_id', 'eq', tool.id]], order: { column: 'sort_order', ascending: true } }),
      db.all<AssessmentQuestion>('assessment_questions', { filters: [['tool_id', 'eq', tool.id]], order: { column: 'sort_order', ascending: true } }),
    ]);
    return { dims, qs };
  }, [tool?.id]);
  const [dimEdit, setDimEdit] = useState<AssessmentDimension | 'new' | null>(null);
  const [qEdit, setQEdit] = useState<{ q: AssessmentQuestion | null; dimension_id: string | null } | null>(null);

  const remove = useAction(async (table: 'assessment_dimensions' | 'assessment_questions', id: string) => {
    await db.remove(table, id); await state.reload(); onChanged();
  }, { success: ['تم الحذف', 'Deleted'] });

  if (!tool) return null;
  const reload = async () => { await state.reload(); onChanged(); };

  const dimFields: PlatformFieldSpec[] = [
    { name: 'code', label: ['الرمز', 'Code'], type: 'text', required: true, validate: (v) => (CODE.test(String(v)) ? null : ['رمز غير صالح', 'Invalid code']) },
    { name: 'sort_order', label: ['الترتيب', 'Order'], type: 'number', min: 0, step: 1 },
    { name: 'name', label: ['الاسم (عربي)', 'Name (Arabic)'], type: 'text', required: true },
    { name: 'name_en', label: ['الاسم (إنجليزي)', 'Name (English)'], type: 'text' },
    { name: 'weight', label: ['الوزن', 'Weight'], type: 'number', min: 0, required: true },
    { name: 'description', label: ['الوصف', 'Description'], type: 'textarea' },
  ];

  return (
    <Drawer wide open onClose={onClose} title={<>{pick(tool.name, tool.name_en)} <span className="mono tiny muted">{tool.code} v{tool.version}</span></>}>
      <AsyncView state={state}>
        {({ dims, qs }) => {
          const totalW = dims.reduce((a, d) => a + Number(d.weight), 0);
          const unassigned = qs.filter((q) => !q.dimension_id || !dims.some((d) => d.id === q.dimension_id));
          return (
            <div className="stack">
              <Notice tone="info">{tr(`المقياس ${tool.scale_min}–${tool.scale_max} · طريقة الاحتساب: ${enumLabel('scoringMethod', tool.scoring_method)}. تُحتسب الدرجات في قاعدة البيانات؛ المؤسسات تنسخ الأداة كاملة عبر copy_central_template.`,
                `Scale ${tool.scale_min}–${tool.scale_max} · scoring: ${enumLabel('scoringMethod', tool.scoring_method)}. Scores are computed in the database; organizations copy the whole tool via copy_central_template.`)}</Notice>
              {!dims.length && <Notice tone="warning">{tr('لا توجد أبعاد: لا يمكن احتساب درجات الأبعاد أو المقارنة بين نقاط القياس.', 'No dimensions: dimension scores and comparisons across measurement points cannot be computed.')}</Notice>}
              {unassigned.length > 0 && <Notice tone="warning">{tr(`${unassigned.length} أسئلة غير مرتبطة ببعد — لن تدخل في درجات الأبعاد.`, `${unassigned.length} questions are not linked to a dimension — they will not count in dimension scores.`)}</Notice>}
              <div className="row between">
                <span className="small muted">{tr(`${dims.length} أبعاد · ${qs.length} سؤال · مجموع الأوزان ${fmtNumber(totalW, 2)}`, `${dims.length} dimensions · ${qs.length} questions · total weight ${fmtNumber(totalW, 2)}`)}</span>
                <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setDimEdit('new')}>{tr('بعد جديد', 'New dimension')}</Button>
              </div>
              {[...dims, ...(unassigned.length ? [null] : [])].map((d) => {
                const list = d ? qs.filter((q) => q.dimension_id === d.id) : unassigned;
                return (
                  <Card key={d?.id ?? 'none'}>
                    <CardHeader title={d ? <>{pick(d.name, d.name_en)} <span className="mono tiny muted">{d.code}</span></> : tr('أسئلة بلا بعد', 'Questions without dimension')}
                      hint={d ? tr(`الوزن ${d.weight}${totalW ? ` (${Math.round((Number(d.weight) / totalW) * 100)}%)` : ''}`, `weight ${d.weight}${totalW ? ` (${Math.round((Number(d.weight) / totalW) * 100)}%)` : ''}`) : undefined}
                      actions={<>
                        <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setQEdit({ q: null, dimension_id: d?.id ?? null })}>{tr('سؤال', 'Question')}</Button>
                        {d && <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => setDimEdit(d)} />}
                        {d && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')} onClick={async () => {
                          if (await confirm({ title: tr('حذف البعد', 'Delete dimension'), message: tr('ستبقى أسئلته بلا بعد.', 'Its questions will remain without a dimension.'), danger: true })) await remove.run('assessment_dimensions', d.id);
                        }} />}
                      </>} />
                    <CardBody flush>
                      {list.length ? (
                        <ul className="list-plain" style={{ padding: '0 16px' }}>
                          {list.map((q) => (
                            <li key={q.id} className="row between start">
                              <div className="grow">
                                <div className="small"><span className="mono tiny muted">{q.code}</span> {q.text_ar ?? q.text_en}</div>
                                {q.text_ar && q.text_en && <div className="tiny muted ltr">{q.text_en}</div>}
                                <div className="row wrap" style={{ gap: 4, marginTop: 2 }}>
                                  <Badge tone="outline">{enumLabel('questionType', q.question_type)}</Badge>
                                  <Badge>{tr(`وزن ${q.weight}`, `weight ${q.weight}`)}</Badge>
                                  {q.reverse_scored && <Badge tone="warning">{tr('عكسي', 'Reverse')}</Badge>}
                                  {!q.required && <Badge>{tr('اختياري', 'Optional')}</Badge>}
                                  {!q.text_en && <Badge tone="info">{tr('بلا ترجمة', 'No English')}</Badge>}
                                </div>
                              </div>
                              <div className="row">
                                <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => setQEdit({ q, dimension_id: q.dimension_id })} />
                                <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')} onClick={async () => {
                                  if (await confirm({ title: tr('حذف السؤال', 'Delete question'), message: q.code, danger: true })) await remove.run('assessment_questions', q.id);
                                }} />
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : <EmptyState compact title={tr('لا توجد أسئلة', 'No questions')} />}
                    </CardBody>
                  </Card>
                );
              })}
              <PlatformFormModal open={!!dimEdit} onClose={() => setDimEdit(null)} fields={dimFields} title={dimEdit === 'new' ? tr('بعد جديد', 'New dimension') : tr('تعديل البعد', 'Edit dimension')}
                initial={dimEdit && dimEdit !== 'new' ? { code: dimEdit.code, name: dimEdit.name, name_en: dimEdit.name_en, description: dimEdit.description, weight: dimEdit.weight, sort_order: dimEdit.sort_order }
                  : { code: `D${dims.length + 1}`, weight: 1, sort_order: dims.length + 1 }}
                onSubmit={async (v) => {
                  if ((dims.some((x) => x.code === v.code && (dimEdit === 'new' || x.id !== dimEdit?.id)))) throw { code: 'dup', message_ar: 'رمز البعد مستخدم في هذه الأداة', message_en: 'Dimension code already used in this tool' } satisfies AppError;
                  if (dimEdit === 'new') await db.insert('assessment_dimensions', { ...v, organization_id: null, tool_id: tool.id, sort_order: v.sort_order ?? dims.length + 1 });
                  else if (dimEdit) await db.update('assessment_dimensions', dimEdit.id, v);
                  await reload();
                }} />
              {qEdit && <QuestionModal tool={tool} dims={dims} qs={qs} edit={qEdit} onClose={() => setQEdit(null)} onSaved={reload} />}
            </div>
          );
        }}
      </AsyncView>
    </Drawer>
  );
}

function QuestionModal({ tool, dims, qs, edit, onClose, onSaved }: {
  tool: AssessmentTool; dims: AssessmentDimension[]; qs: AssessmentQuestion[]; edit: { q: AssessmentQuestion | null; dimension_id: string | null };
  onClose: () => void; onSaved: () => Promise<void>;
}) {
  const { tr, pick, enumOptions } = useI18n();
  const errText = useErrText();
  const q = edit.q;
  const [v, setV] = useState({
    code: q?.code ?? `Q${qs.length + 1}`, dimension_id: q?.dimension_id ?? edit.dimension_id ?? '', text_ar: q?.text_ar ?? '', text_en: q?.text_en ?? '',
    question_type: q?.question_type ?? 'scale', options: (q?.options ?? []) as QuestionOption[], weight: String(q?.weight ?? 1),
    reverse_scored: q?.reverse_scored ?? false, required: q?.required ?? true, sort_order: String(q?.sort_order ?? qs.length + 1),
  });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setError(null); }, [edit]);

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!CODE.test(v.code.trim())) e.code = tr('رمز غير صالح', 'Invalid code');
    else if (qs.some((x) => x.code === v.code.trim() && x.id !== q?.id)) e.code = tr('الرمز مستخدم', 'Code already used');
    if (!v.text_ar.trim() && !v.text_en.trim()) e.text_ar = tr('أدخل نص السؤال بالعربية أو الإنجليزية', 'Enter the question text in Arabic or English');
    const w = Number(v.weight); if (!Number.isFinite(w) || w < 0) e.weight = tr('وزن غير صالح', 'Invalid weight');
    if (CHOICE.includes(v.question_type)) { const p = optionsProblems(v.options); if (p) e.options = tr(p[0], p[1]); }
    setErrs(e);
    if (Object.keys(e).length) return;
    const row = {
      code: v.code.trim(), dimension_id: v.dimension_id || null, text_ar: v.text_ar.trim() || null, text_en: v.text_en.trim() || null,
      question_type: v.question_type, options: CHOICE.includes(v.question_type) ? v.options.map((o) => ({ ...o, value: o.value.trim() })) : [],
      weight: w, reverse_scored: ['scale', 'number'].includes(v.question_type) ? v.reverse_scored : false, required: v.required, sort_order: Number(v.sort_order) || 0,
    };
    setBusy(true); setError(null);
    try {
      if (q) await db.update('assessment_questions', q.id, row);
      else await db.insert('assessment_questions', { ...row, organization_id: null, tool_id: tool.id });
      await onSaved(); onClose();
    } catch (err) { setError(errorOf(err)); } finally { setBusy(false); }
  };

  return (
    <Modal open size="wide" onClose={onClose} title={q ? tr('تعديل السؤال', 'Edit question') : tr('سؤال جديد', 'New question')}
      footer={<><Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} onClick={submit}>{tr('حفظ', 'Save')}</Button></>}>
      <div className="stack-sm">
        {error && <Notice tone="danger">{errText(error)}</Notice>}
        <div className="form-grid">
          <Field label={tr('الرمز', 'Code')} required error={errs.code}><Input dir="ltr" className="mono" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} /></Field>
          <Field label={tr('البعد', 'Dimension')}>
            <Select value={v.dimension_id} placeholder={tr('— بلا بعد —', '— None —')} onChange={(e) => setV({ ...v, dimension_id: e.target.value })} options={dims.map((d) => ({ value: d.id, label: `${d.code} · ${pick(d.name, d.name_en)}` }))} />
          </Field>
          <Field className="full" label={tr('نص السؤال (عربي)', 'Question text (Arabic)')} error={errs.text_ar}><Textarea value={v.text_ar} onChange={(e) => setV({ ...v, text_ar: e.target.value })} /></Field>
          <Field className="full" label={tr('نص السؤال (إنجليزي)', 'Question text (English)')}><Textarea dir="ltr" value={v.text_en} onChange={(e) => setV({ ...v, text_en: e.target.value })} /></Field>
          <Field label={tr('النوع', 'Type')}><Select value={v.question_type} onChange={(e) => setV({ ...v, question_type: e.target.value as AssessmentQuestion['question_type'] })} options={enumOptions('questionType')} /></Field>
          <Field label={tr('الوزن', 'Weight')} error={errs.weight}><Input type="number" min={0} step="any" dir="ltr" value={v.weight} onChange={(e) => setV({ ...v, weight: e.target.value })} /></Field>
          <Field label={tr('الترتيب', 'Order')}><Input type="number" min={0} dir="ltr" value={v.sort_order} onChange={(e) => setV({ ...v, sort_order: e.target.value })} /></Field>
          <div className="stack-sm" style={{ alignContent: 'end' }}>
            <Checkbox label={tr('إلزامي', 'Required')} checked={v.required} onChange={(c) => setV({ ...v, required: c })} />
            {['scale', 'number'].includes(v.question_type) && <Checkbox label={tr('احتساب عكسي', 'Reverse scored')} checked={v.reverse_scored} onChange={(c) => setV({ ...v, reverse_scored: c })} />}
          </div>
          {v.question_type === 'scale' && <p className="full tiny muted">{tr(`يُجاب على المقياس من ${tool.scale_min} إلى ${tool.scale_max}. الاحتساب العكسي يحوّل الدرجة إلى (الحد الأقصى + الحد الأدنى − الإجابة).`, `Answered on the ${tool.scale_min}–${tool.scale_max} scale. Reverse scoring maps an answer to (max + min − answer).`)}</p>}
          {CHOICE.includes(v.question_type) && (
            <Field className="full" label={tr('الخيارات (الدرجة على مقياس الأداة)', 'Options (score on the tool scale)')} error={errs.options}>
              <OptionsEditor value={v.options} onChange={(o) => setV({ ...v, options: o })} />
            </Field>
          )}
        </div>
      </div>
    </Modal>
  );
}
