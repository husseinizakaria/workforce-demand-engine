// Tool builder sections: classification bands, dimensions (with rubric),
// questions (with options), translation tools and question-bank upload.
import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCheck, Languages, Pencil, Plus, Trash2, Upload, Wand2 } from 'lucide-react';
import { DEFAULT_BANDS, MATURITY_LEVELS, type ClassBand, type QuestionOption } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { insert, insertMany, remove, update, updateWhere } from '@/services/db';
import { callFunction } from '@/services/functions';
import { errorOf, type AppError } from '@/services/errors';
import { parseDelimited } from '@/utils/csv';
import {
  Badge, Button, Card, CardBody, CardHeader, Checkbox, EmptyState, Field, FileDrop, Input, Modal, Notice, Progress, Segmented, Select, Textarea, useConfirm, useToast,
} from '@/components/ui';
import type { AssessmentDimension, AssessmentQuestion, AssessmentTool, RubricLevel } from '@/types/db';
import { bandIssues, parseBank, type BankRow } from '../builder';
import { errText } from '../api';
import { FunctionError } from './Shared';

// ---------------------------------------------------------------- bands
export function BandsEditor({ tool, editable, onSaved }: { tool: AssessmentTool; editable: boolean; onSaved: () => void }) {
  const { tr, locale } = useI18n();
  const toast = useToast();
  const initial = Array.isArray(tool.classification) ? tool.classification : [];
  const [bands, setBands] = useState<ClassBand[]>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<AppError | null>(null);
  useEffect(() => { setBands(Array.isArray(tool.classification) ? tool.classification : []); }, [tool.id, tool.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  const issues = bandIssues(bands);
  const dirty = JSON.stringify(bands) !== JSON.stringify(initial);
  const set = (i: number, patch: Partial<ClassBand>) => setBands((b) => b.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const clean = [...bands].sort((a, b) => a.min - b.min).map((b) => ({ ...b, min: Number(b.min), max: Number(b.max) }));
      await update('assessment_tools', tool.id, { classification: clean });
      toast.success(tr('تم حفظ فئات التصنيف', 'Classification bands saved')); onSaved();
    } catch (e) { setErr(errorOf(e)); } finally { setBusy(false); }
  };
  return (
    <Card>
      <CardHeader title={tr('فئات التصنيف (0–100)', 'Classification bands (0–100)')} hint={tr('تُطبق على الدرجة الموحدة', 'Applied to the normalized score')}
        actions={editable && <>
          <Button size="sm" icon={<Wand2 />} onClick={() => setBands(DEFAULT_BANDS.map((b) => ({ ...b })))}>{tr('استخدام الفئات الافتراضية', 'Use default bands')}</Button>
          <Button size="sm" icon={<Plus />} onClick={() => { const last = bands[bands.length - 1]; setBands([...bands, { min: last ? Number(last.max) : 0, max: 100, label_ar: '', label_en: '' }]); }}>{tr('فئة', 'Band')}</Button>
          <Button size="sm" variant="primary" loading={busy} disabled={!dirty || issues.length > 0} onClick={save}>{tr('حفظ', 'Save')}</Button>
        </>} />
      <CardBody>
        {!bands.length ? <EmptyState compact title={tr('لا توجد فئات', 'No bands')} /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{tr('من', 'Min')}</th><th>{tr('إلى', 'Max')}</th><th>{tr('التسمية (ع)', 'Label (AR)')}</th><th>{tr('التسمية (En)', 'Label (EN)')}</th><th>{tr('التفسير (ع)', 'Interpretation (AR)')}</th><th>{tr('التفسير (En)', 'Interpretation (EN)')}</th>{editable && <th />}</tr></thead>
              <tbody>{bands.map((b, i) => (
                <tr key={i}>
                  <td style={{ width: 80 }}><Input type="number" className="ltr" disabled={!editable} value={b.min} onChange={(e) => set(i, { min: Number(e.target.value) })} /></td>
                  <td style={{ width: 80 }}><Input type="number" className="ltr" disabled={!editable} value={b.max} onChange={(e) => set(i, { max: Number(e.target.value) })} /></td>
                  <td><Input disabled={!editable} value={b.label_ar} onChange={(e) => set(i, { label_ar: e.target.value })} /></td>
                  <td><Input dir="ltr" disabled={!editable} value={b.label_en} onChange={(e) => set(i, { label_en: e.target.value })} /></td>
                  <td><Textarea rows={1} disabled={!editable} value={b.interpretation_ar ?? ''} onChange={(e) => set(i, { interpretation_ar: e.target.value })} /></td>
                  <td><Textarea rows={1} dir="ltr" disabled={!editable} value={b.interpretation_en ?? ''} onChange={(e) => set(i, { interpretation_en: e.target.value })} /></td>
                  {editable && <td><Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')} onClick={() => setBands(bands.filter((_, j) => j !== i))} /></td>}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {issues.length > 0 && <div style={{ marginTop: 8 }}><Notice tone="warning"><ul style={{ margin: 0, paddingInlineStart: 16 }}>{issues.map((x, i) => <li key={i}>{tr(x[0], x[1])}</li>)}</ul></Notice></div>}
        {issues.length === 0 && bands.length > 0 && <p className="tiny muted" style={{ marginTop: 6 }}>{tr('التغطية كاملة 0–100 دون فجوات أو تداخل.', 'Full 0–100 coverage without gaps or overlaps.')}</p>}
        {err && <Notice tone="danger">{errText(err, locale)}</Notice>}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------- dimensions
interface DimDraft { id?: string; code: string; name: string; name_en: string; description: string; weight: string; sort_order: string; rubric: RubricLevel[] }

export function DimensionsCard({ tool, dims, questions, editable, onChanged }: { tool: AssessmentTool; dims: AssessmentDimension[]; questions: AssessmentQuestion[]; editable: boolean; onChanged: () => void }) {
  const { tr, pick, fmtNumber, locale } = useI18n();
  const confirm = useConfirm();
  const toast = useToast();
  const [draft, setDraft] = useState<DimDraft | null>(null);
  const weighted = tool.scoring_method === 'weighted_average';
  const wsum = dims.reduce((a, d) => a + Number(d.weight), 0);
  const share = (d: AssessmentDimension) => (weighted ? (wsum > 0 ? (Number(d.weight) / wsum) * 100 : 0) : dims.length ? 100 / dims.length : 0);

  const del = async (d: AssessmentDimension) => {
    const n = questions.filter((q) => q.dimension_id === d.id).length;
    if (!(await confirm({ title: tr('حذف البعد', 'Delete dimension'), danger: true, message: n ? tr(`سيبقى ${n} سؤال دون بعد ولن يُحتسب.`, `${n} question(s) will be left without a dimension and not scored.`) : undefined }))) return;
    try { await remove('assessment_dimensions', d.id); onChanged(); } catch (e) { toast.error(errText(errorOf(e), locale)); }
  };
  const open = (d?: AssessmentDimension) => setDraft(d
    ? { id: d.id, code: d.code, name: d.name, name_en: d.name_en ?? '', description: d.description ?? '', weight: String(d.weight), sort_order: String(d.sort_order), rubric: Array.isArray(d.rubric) ? d.rubric : [] }
    : { code: `D${dims.length + 1}`, name: '', name_en: '', description: '', weight: '1', sort_order: String(dims.length + 1), rubric: [] });

  return (
    <Card>
      <CardHeader title={tr('الأبعاد والأوزان', 'Dimensions & weights')}
        hint={weighted ? tr('الحصة = وزن البعد ÷ مجموع الأوزان', 'Share = dimension weight ÷ total weight') : tr('الأوزان لا تُستخدم في هذه الطريقة؛ الأبعاد متساوية', 'Weights are not used by this method; dimensions are equal')}
        actions={editable && <Button size="sm" variant="primary" icon={<Plus />} onClick={() => open()}>{tr('بعد', 'Dimension')}</Button>} />
      <CardBody flush>
        {!dims.length ? <EmptyState compact title={tr('لا توجد أبعاد', 'No dimensions')} /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{tr('الرمز', 'Code')}</th><th>{tr('البعد', 'Dimension')}</th><th className="num">{tr('الوزن', 'Weight')}</th><th style={{ width: 160 }}>{tr('الحصة', 'Share')}</th><th className="num">{tr('الأسئلة', 'Questions')}</th><th className="num">{tr('المستويات', 'Levels')}</th><th className="num">{tr('الترتيب', 'Order')}</th>{editable && <th />}</tr></thead>
              <tbody>{dims.map((d) => (
                <tr key={d.id}>
                  <td className="mono">{d.code}</td>
                  <td><b>{pick(d.name, d.name_en)}</b>{d.description && <div className="tiny muted">{d.description}</div>}</td>
                  <td className="num">{d.weight}</td>
                  <td><div className="row"><Progress value={share(d)} /><span className="mono tiny">{fmtNumber(share(d), 1)}%</span></div></td>
                  <td className="num">{questions.filter((q) => q.dimension_id === d.id).length}</td>
                  <td className="num">{(d.rubric ?? []).length}</td>
                  <td className="num">{d.sort_order}</td>
                  {editable && <td><div className="row" style={{ gap: 2 }}>
                    <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => open(d)} />
                    <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')} onClick={() => del(d)} />
                  </div></td>}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </CardBody>
      {draft && <DimensionModal tool={tool} dims={dims} draft={draft} onClose={() => setDraft(null)} onSaved={() => { setDraft(null); onChanged(); }} />}
    </Card>
  );
}

function DimensionModal({ tool, dims, draft: init, onClose, onSaved }: { tool: AssessmentTool; dims: AssessmentDimension[]; draft: DimDraft; onClose: () => void; onSaved: () => void }) {
  const { tr, locale } = useI18n();
  const [d, setD] = useState<DimDraft>(init);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<AppError | null>(null);
  const smin = Number(tool.scale_min); const smax = Number(tool.scale_max);
  const codeTaken = dims.some((x) => x.code.toLowerCase() === d.code.trim().toLowerCase() && x.id !== d.id);
  const problems: [string, string][] = [];
  if (!d.code.trim()) problems.push(['الرمز إلزامي', 'Code is required']);
  if (codeTaken) problems.push(['الرمز مستخدم لبعد آخر', 'Code is used by another dimension']);
  if (!d.name.trim()) problems.push(['الاسم العربي إلزامي', 'Arabic name is required']);
  if (!(Number(d.weight) >= 0) || d.weight === '') problems.push(['الوزن يجب أن يكون صفرًا أو أكثر', 'Weight must be zero or more']);
  if (d.rubric.some((r) => !Number.isFinite(Number(r.score)) || Number(r.score) < smin || Number(r.score) > smax)) problems.push([`درجات المستويات يجب أن تكون ضمن ${smin}–${smax}`, `Level scores must be within ${smin}–${smax}`]);
  if (new Set(d.rubric.map((r) => Number(r.score))).size !== d.rubric.length) problems.push(['درجات المستويات مكررة', 'Duplicate level scores']);
  const setLevel = (i: number, p: Partial<RubricLevel>) => setD((x) => ({ ...x, rubric: x.rubric.map((r, j) => (j === i ? { ...r, ...p } : r)) }));
  const generate = () => {
    const lv: RubricLevel[] = [];
    for (let s = Math.ceil(smin); s <= Math.floor(smax); s++) {
      const g = smin === 1 && smax === 5 ? MATURITY_LEVELS.find((m) => m.level === s) : undefined;
      lv.push({ score: s, label_ar: g?.ar ?? String(s), label_en: g?.en ?? String(s), descriptor_ar: g?.desc_ar ?? '', descriptor_en: g?.desc_en ?? '' });
    }
    setD((x) => ({ ...x, rubric: lv }));
  };
  const save = async () => {
    if (problems.length) return;
    setBusy(true); setErr(null);
    const row = {
      code: d.code.trim(), name: d.name.trim(), name_en: d.name_en.trim() || null, description: d.description.trim() || null, weight: Number(d.weight),
      sort_order: Number(d.sort_order) || 0, rubric: [...d.rubric].sort((a, b) => Number(a.score) - Number(b.score)).map((r) => ({ ...r, score: Number(r.score) })),
    };
    try {
      if (d.id) await update('assessment_dimensions', d.id, row);
      else await insert('assessment_dimensions', { ...row, organization_id: tool.organization_id, tool_id: tool.id });
      onSaved();
    } catch (e) { setErr(errorOf(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open size="wide" onClose={onClose} title={d.id ? tr('تعديل البعد', 'Edit dimension') : tr('بعد جديد', 'New dimension')}
      footer={<><Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} disabled={problems.length > 0} onClick={save}>{tr('حفظ', 'Save')}</Button></>}>
      <div className="stack">
        {err && <Notice tone="danger">{errText(err, locale)}</Notice>}
        <div className="form-grid">
          <Field label={tr('الرمز', 'Code')} required><Input className="ltr" value={d.code} onChange={(e) => setD({ ...d, code: e.target.value })} /></Field>
          <Field label={tr('الوزن', 'Weight')} required><Input type="number" min={0} step="any" className="ltr" value={d.weight} onChange={(e) => setD({ ...d, weight: e.target.value })} /></Field>
          <Field label={tr('الاسم (ع)', 'Name (AR)')} required><Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
          <Field label={tr('الاسم (En)', 'Name (EN)')}><Input dir="ltr" value={d.name_en} onChange={(e) => setD({ ...d, name_en: e.target.value })} /></Field>
          <Field label={tr('الترتيب', 'Sort order')}><Input type="number" className="ltr" value={d.sort_order} onChange={(e) => setD({ ...d, sort_order: e.target.value })} /></Field>
          <Field label={tr('الوصف', 'Description')}><Input value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} /></Field>
        </div>
        <div className="row between"><b className="small">{tr('سلم التقدير (المستويات)', 'Rubric levels')}</b>
          <div className="row">
            <Button size="sm" icon={<Wand2 />} onClick={generate}>{tr('توليد من المقياس', 'Generate from scale')}</Button>
            <Button size="sm" icon={<Plus />} onClick={() => setD((x) => ({ ...x, rubric: [...x.rubric, { score: x.rubric.length ? Math.min(smax, Number(x.rubric[x.rubric.length - 1].score) + 1) : smin, label_ar: '', label_en: '' }] }))}>{tr('مستوى', 'Level')}</Button>
          </div>
        </div>
        {d.rubric.length === 0 ? <p className="small muted">{tr('بلا مستويات. المستويات الوصفية ضرورية للتقدير المباشر وتحسّن اتساق المقيّمين.', 'No levels. Descriptive levels are needed for direct rating and improve rater consistency.')}</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{tr('الدرجة', 'Score')}</th><th>{tr('التسمية (ع)', 'Label (AR)')}</th><th>{tr('التسمية (En)', 'Label (EN)')}</th><th>{tr('الوصف (ع)', 'Descriptor (AR)')}</th><th>{tr('الوصف (En)', 'Descriptor (EN)')}</th><th /></tr></thead>
              <tbody>{d.rubric.map((r, i) => (
                <tr key={i}>
                  <td style={{ width: 70 }}><Input type="number" className="ltr" value={r.score} onChange={(e) => setLevel(i, { score: Number(e.target.value) })} /></td>
                  <td><Input value={r.label_ar} onChange={(e) => setLevel(i, { label_ar: e.target.value })} /></td>
                  <td><Input dir="ltr" value={r.label_en} onChange={(e) => setLevel(i, { label_en: e.target.value })} /></td>
                  <td><Textarea rows={1} value={r.descriptor_ar ?? ''} onChange={(e) => setLevel(i, { descriptor_ar: e.target.value })} /></td>
                  <td><Textarea rows={1} dir="ltr" value={r.descriptor_en ?? ''} onChange={(e) => setLevel(i, { descriptor_en: e.target.value })} /></td>
                  <td><Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')} onClick={() => setD((x) => ({ ...x, rubric: x.rubric.filter((_, j) => j !== i) }))} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {problems.length > 0 && <Notice tone="warning"><ul style={{ margin: 0, paddingInlineStart: 16 }}>{problems.map((p, i) => <li key={i}>{tr(p[0], p[1])}</li>)}</ul></Notice>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- questions
interface QDraft { id?: string; code: string; dimension_id: string; text_ar: string; text_en: string; question_type: AssessmentQuestion['question_type']; options: QuestionOption[]; weight: string; reverse_scored: boolean; required: boolean; sort_order: string; orig?: AssessmentQuestion }

export function QuestionsCard({ tool, dims, questions, editable, textEditable, onChanged }: {
  tool: AssessmentTool; dims: AssessmentDimension[]; questions: AssessmentQuestion[]; editable: boolean; textEditable: boolean; onChanged: () => void;
}) {
  const { tr, pick, enumLabel, locale } = useI18n();
  const { org } = useOrg();
  const confirm = useConfirm();
  const toast = useToast();
  const [draft, setDraft] = useState<QDraft | null>(null);
  const [bank, setBank] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [fnErr, setFnErr] = useState<AppError | null>(null);
  const missingEn = questions.filter((q) => !q.text_en?.trim()).length;
  const missingAr = questions.filter((q) => !q.text_ar?.trim()).length;
  const machine = questions.filter((q) => q.translation_status === 'machine');

  const groups = [...dims.map((d) => ({ key: d.id, title: `${pick(d.name, d.name_en)} (${d.code})`, qs: questions.filter((q) => q.dimension_id === d.id) })),
    { key: 'none', title: tr('دون بعد (غير محتسبة)', 'No dimension (not scored)'), qs: questions.filter((q) => !q.dimension_id) }].filter((g) => g.key !== 'none' || g.qs.length);

  const translate = async (target: 'ar' | 'en') => {
    setBusy(target); setFnErr(null);
    try {
      const r = await callFunction<{ updated: number }>('ai-assessment-interpretation', { mode: 'translate_questions', organization_id: org.id, tool_id: tool.id, target });
      toast.success(tr(`تمت ترجمة ${r?.updated ?? 0} سؤال (ترجمة آلية تحتاج مراجعة)`, `${r?.updated ?? 0} question(s) translated (machine translation — review needed)`));
      onChanged();
    } catch (e) { setFnErr(errorOf(e)); } finally { setBusy(null); }
  };
  const verify = async (ids: string[]) => {
    setBusy('verify');
    try { await updateWhere('assessment_questions', [['tool_id', 'eq', tool.id], ['id', 'in', ids]], { translation_status: 'verified' }); onChanged(); }
    catch (e) { toast.error(errText(errorOf(e), locale)); } finally { setBusy(null); }
  };
  const del = async (q: AssessmentQuestion) => {
    if (!(await confirm({ title: tr('حذف السؤال', 'Delete question'), message: q.code, danger: true }))) return;
    try { await remove('assessment_questions', q.id); onChanged(); } catch (e) { toast.error(errText(errorOf(e), locale)); }
  };
  const move = async (q: AssessmentQuestion, dir: -1 | 1, list: AssessmentQuestion[]) => {
    const i = list.findIndex((x) => x.id === q.id); const other = list[i + dir];
    if (!other) return;
    try {
      const a = q.sort_order === other.sort_order ? i + 1 : other.sort_order; const b = q.sort_order === other.sort_order ? i + 1 + dir : q.sort_order;
      await Promise.all([update('assessment_questions', q.id, { sort_order: a }), update('assessment_questions', other.id, { sort_order: b })]);
      onChanged();
    } catch (e) { toast.error(errText(errorOf(e), locale)); }
  };
  const open = (q?: AssessmentQuestion, dimId?: string) => setDraft(q
    ? { id: q.id, code: q.code, dimension_id: q.dimension_id ?? '', text_ar: q.text_ar ?? '', text_en: q.text_en ?? '', question_type: q.question_type, options: Array.isArray(q.options) ? q.options : [], weight: String(q.weight), reverse_scored: q.reverse_scored, required: q.required, sort_order: String(q.sort_order), orig: q }
    : { code: '', dimension_id: dimId ?? dims[0]?.id ?? '', text_ar: '', text_en: '', question_type: 'scale', options: [], weight: '1', reverse_scored: false, required: true, sort_order: String(questions.filter((x) => x.dimension_id === (dimId ?? dims[0]?.id)).length + 1) });

  const trBadge = (q: AssessmentQuestion) => {
    if (!q.text_ar?.trim() || !q.text_en?.trim()) return <Badge tone="warning">{!q.text_en?.trim() ? tr('ينقصه En', 'EN missing') : tr('ينقصه ع', 'AR missing')}</Badge>;
    if (q.translation_status === 'machine') return <Badge tone="info">{tr('آلية', 'Machine')}</Badge>;
    if (q.translation_status === 'verified') return <Badge tone="success">{tr('متحقق', 'Verified')}</Badge>;
    return <Badge tone="outline">{tr('يدوية', 'Manual')}</Badge>;
  };

  return (
    <Card>
      <CardHeader title={tr('الأسئلة', 'Questions')} hint={`${questions.length} ${tr('سؤال', 'questions')}`}
        actions={<>
          {textEditable && missingEn > 0 && <Button size="sm" icon={<Languages />} loading={busy === 'en'} onClick={() => translate('en')}>{tr(`ترجمة الناقص للإنجليزية (${missingEn})`, `Translate missing to English (${missingEn})`)}</Button>}
          {textEditable && missingAr > 0 && <Button size="sm" icon={<Languages />} loading={busy === 'ar'} onClick={() => translate('ar')}>{tr(`ترجمة الناقص للعربية (${missingAr})`, `Translate missing to Arabic (${missingAr})`)}</Button>}
          {textEditable && machine.length > 0 && <Button size="sm" icon={<CheckCheck />} loading={busy === 'verify'} onClick={() => verify(machine.map((q) => q.id))}>{tr(`اعتماد كل الترجمات الآلية (${machine.length})`, `Mark all machine translations verified (${machine.length})`)}</Button>}
          {editable && <Button size="sm" icon={<Upload />} onClick={() => setBank(true)}>{tr('رفع بنك أسئلة', 'Upload question bank')}</Button>}
          {editable && <Button size="sm" variant="primary" icon={<Plus />} disabled={!dims.length} onClick={() => open()}>{tr('سؤال', 'Question')}</Button>}
        </>} />
      <CardBody>
        <FunctionError error={fnErr} />
        {!questions.length ? <EmptyState compact title={tr('لا توجد أسئلة', 'No questions')} description={tr('بدون أسئلة تُستخدم الأداة بالتقدير المباشر للأبعاد عبر سلم التقدير.', 'Without questions the tool is used by rating dimensions directly with the rubric.')} /> : (
          <div className="stack">
            {groups.map((g) => (
              <div key={g.key} className="stack-sm">
                <div className="row between"><b className="small">{g.title}</b>{editable && g.key !== 'none' && <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => open(undefined, g.key)}>{tr('سؤال هنا', 'Add here')}</Button>}</div>
                {!g.qs.length ? <span className="tiny" style={{ color: 'var(--warning)' }}>{tr('لا أسئلة في هذا البعد', 'No questions in this dimension')}</span> : (
                  <div className="table-wrap">
                    <table className="table">
                      <tbody>{g.qs.map((q, i) => (
                        <tr key={q.id}>
                          <td className="mono tiny" style={{ width: 70 }}>{q.code}</td>
                          <td className="small"><div>{q.text_ar || <span className="muted">—</span>}</div><div className="muted ltr" style={{ textAlign: 'start' }}>{q.text_en || '—'}</div></td>
                          <td style={{ width: 120 }}><Badge tone="outline">{enumLabel('questionType', q.question_type)}</Badge>{(q.options ?? []).length > 0 && <div className="tiny muted">{(q.options ?? []).length} {tr('خيارات', 'options')}</div>}</td>
                          <td className="tiny" style={{ width: 120 }}>w={q.weight}{q.reverse_scored && <> · <Badge tone="warning">{tr('معكوس', 'Rev.')}</Badge></>}{!q.required && <div className="muted">{tr('اختياري', 'optional')}</div>}</td>
                          <td style={{ width: 120 }}>{trBadge(q)}{textEditable && q.translation_status === 'machine' && <button type="button" className="link-btn tiny" onClick={() => verify([q.id])}> {tr('اعتماد', 'Verify')}</button>}</td>
                          {(editable || textEditable) && <td style={{ width: 130 }}><div className="row" style={{ gap: 2 }}>
                            {editable && <Button size="sm" variant="ghost" iconOnly icon={<ArrowUp />} disabled={i === 0} aria-label={tr('لأعلى', 'Up')} onClick={() => move(q, -1, g.qs)} />}
                            {editable && <Button size="sm" variant="ghost" iconOnly icon={<ArrowDown />} disabled={i === g.qs.length - 1} aria-label={tr('لأسفل', 'Down')} onClick={() => move(q, 1, g.qs)} />}
                            <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => open(q)} />
                            {editable && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')} onClick={() => del(q)} />}
                          </div></td>}
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardBody>
      {draft && <QuestionModal tool={tool} dims={dims} questions={questions} draft={draft} textOnly={!editable} onClose={() => setDraft(null)} onSaved={() => { setDraft(null); onChanged(); }} />}
      {bank && <BankModal tool={tool} dims={dims} questions={questions} onClose={() => setBank(false)} onDone={() => { setBank(false); onChanged(); }} />}
    </Card>
  );
}

function OptionsEditor({ options, onChange, scale }: { options: QuestionOption[]; onChange: (o: QuestionOption[]) => void; scale: [number, number] }) {
  const { tr } = useI18n();
  const set = (i: number, p: Partial<QuestionOption>) => onChange(options.map((o, j) => (j === i ? { ...o, ...p } : o)));
  return (
    <div className="stack-sm">
      <div className="row between"><b className="small">{tr('الخيارات ودرجاتها', 'Options & scores')}</b>
        <Button size="sm" icon={<Plus />} onClick={() => onChange([...options, { value: `o${options.length + 1}`, score: scale[0], label_ar: '', label_en: '' }])}>{tr('خيار', 'Option')}</Button></div>
      {options.length > 0 && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{tr('القيمة', 'Value')}</th><th>{tr('الدرجة', 'Score')}</th><th>{tr('التسمية (ع)', 'Label (AR)')}</th><th>{tr('التسمية (En)', 'Label (EN)')}</th><th /></tr></thead>
          <tbody>{options.map((o, i) => (
            <tr key={i}>
              <td style={{ width: 110 }}><Input className="ltr" value={o.value} onChange={(e) => set(i, { value: e.target.value })} /></td>
              <td style={{ width: 90 }}><Input type="number" step="any" className="ltr" value={o.score ?? ''} onChange={(e) => set(i, { score: e.target.value === '' ? null : Number(e.target.value) })} /></td>
              <td><Input value={o.label_ar ?? ''} onChange={(e) => set(i, { label_ar: e.target.value })} /></td>
              <td><Input dir="ltr" value={o.label_en ?? ''} onChange={(e) => set(i, { label_en: e.target.value })} /></td>
              <td><Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')} onClick={() => onChange(options.filter((_, j) => j !== i))} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

function QuestionModal({ tool, dims, questions, draft: init, textOnly, onClose, onSaved }: {
  tool: AssessmentTool; dims: AssessmentDimension[]; questions: AssessmentQuestion[]; draft: QDraft; textOnly: boolean; onClose: () => void; onSaved: () => void;
}) {
  const { tr, enumOptions, locale } = useI18n();
  const [q, setQ] = useState<QDraft>(init);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<AppError | null>(null);
  const scale: [number, number] = [Number(tool.scale_min), Number(tool.scale_max)];
  const choice = q.question_type === 'single_choice' || q.question_type === 'multiple_choice';
  const problems: [string, string][] = [];
  if (!q.code.trim()) problems.push(['الرمز إلزامي', 'Code is required']);
  if (questions.some((x) => x.code.toLowerCase() === q.code.trim().toLowerCase() && x.id !== q.id)) problems.push(['الرمز مستخدم لسؤال آخر', 'Code used by another question']);
  if (!q.text_ar.trim() && !q.text_en.trim()) problems.push(['أدخل نص السؤال بلغة واحدة على الأقل', 'Enter the question text in at least one language']);
  if (choice && !q.options.length) problems.push(['أضف خيارات', 'Add options']);
  if (choice && new Set(q.options.map((o) => o.value)).size !== q.options.length) problems.push(['قيم الخيارات مكررة', 'Duplicate option values']);
  if (choice && q.options.some((o) => !o.value.trim())) problems.push(['خيار دون قيمة', 'Option without value']);
  if (!(Number(q.weight) >= 0) || q.weight === '') problems.push(['وزن غير صالح', 'Invalid weight']);
  const warns: [string, string][] = [];
  if (choice && q.options.some((o) => o.score === null || o.score === undefined)) warns.push(['خيارات دون درجات لن تُحتسب', 'Options without scores will not be counted']);
  if (choice && q.options.some((o) => o.score !== null && o.score !== undefined && (Number(o.score) < scale[0] || Number(o.score) > scale[1]))) warns.push([`درجات خارج ${scale[0]}–${scale[1]}`, `Scores outside ${scale[0]}–${scale[1]}`]);
  if (!q.dimension_id) warns.push(['السؤال دون بعد لن يُحتسب', 'A question without a dimension is not scored']);
  if (q.question_type === 'text' && q.dimension_id) warns.push(['الأسئلة النصية لا تُحتسب رقميًا', 'Text questions are not scored']);
  if (q.question_type === 'number') warns.push([`القيم الرقمية تُقص إلى مدى الأداة ${scale[0]}–${scale[1]}`, `Numeric answers are clamped to the tool range ${scale[0]}–${scale[1]}`]);

  const save = async () => {
    if (problems.length) return;
    setBusy(true); setErr(null);
    const textChanged = !q.orig || (q.orig.text_ar ?? '') !== q.text_ar.trim() || (q.orig.text_en ?? '') !== q.text_en.trim();
    const both = !!q.text_ar.trim() && !!q.text_en.trim();
    const translation_status = !both ? 'none' : textChanged && q.orig ? 'verified' : q.orig?.translation_status ?? 'none';
    const textRow = { text_ar: q.text_ar.trim() || null, text_en: q.text_en.trim() || null, translation_status };
    const row = textOnly ? textRow : {
      ...textRow, code: q.code.trim(), dimension_id: q.dimension_id || null, question_type: q.question_type, options: choice ? q.options.map((o) => ({ ...o, value: o.value.trim() })) : [],
      weight: Number(q.weight), reverse_scored: q.reverse_scored, required: q.required, sort_order: Number(q.sort_order) || 0,
    };
    try {
      if (q.id) await update('assessment_questions', q.id, row);
      else await insert('assessment_questions', { ...row, organization_id: tool.organization_id, tool_id: tool.id });
      onSaved();
    } catch (e) { setErr(errorOf(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open size="wide" onClose={onClose} title={q.id ? tr('تعديل السؤال', 'Edit question') : tr('سؤال جديد', 'New question')}
      footer={<><Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} disabled={problems.length > 0} onClick={save}>{tr('حفظ', 'Save')}</Button></>}>
      <div className="stack">
        {err && <Notice tone="danger">{errText(err, locale)}</Notice>}
        {textOnly && <Notice tone="info">{tr('بنية الأداة مقفلة؛ يمكن تعديل النصوص والترجمة فقط.', 'The tool structure is locked; only texts and translations can be edited.')}</Notice>}
        <div className="form-grid">
          <Field label={tr('الرمز', 'Code')} required><Input className="ltr" disabled={textOnly} value={q.code} onChange={(e) => setQ({ ...q, code: e.target.value })} /></Field>
          <Field label={tr('البعد', 'Dimension')}>
            <Select value={q.dimension_id} disabled={textOnly} onChange={(e) => setQ({ ...q, dimension_id: e.target.value })} placeholder={tr('— دون بعد —', '— No dimension —')} options={dims.map((d) => ({ value: d.id, label: `${d.code} · ${d.name}` }))} />
          </Field>
          <Field className="full" label={tr('نص السؤال (ع)', 'Question text (AR)')}><Textarea rows={2} value={q.text_ar} onChange={(e) => setQ({ ...q, text_ar: e.target.value })} /></Field>
          <Field className="full" label={tr('نص السؤال (En)', 'Question text (EN)')}><Textarea rows={2} dir="ltr" value={q.text_en} onChange={(e) => setQ({ ...q, text_en: e.target.value })} /></Field>
          <Field label={tr('النوع', 'Type')} required>
            <Select value={q.question_type} disabled={textOnly} onChange={(e) => setQ({ ...q, question_type: e.target.value as QDraft['question_type'] })} options={enumOptions('questionType')} />
          </Field>
          <Field label={tr('الوزن', 'Weight')}><Input type="number" min={0} step="any" className="ltr" disabled={textOnly} value={q.weight} onChange={(e) => setQ({ ...q, weight: e.target.value })} /></Field>
          <Field label={tr('الترتيب', 'Sort order')}><Input type="number" className="ltr" disabled={textOnly} value={q.sort_order} onChange={(e) => setQ({ ...q, sort_order: e.target.value })} /></Field>
          <div className="stack-sm" style={{ alignContent: 'end' }}>
            <Checkbox label={tr('معكوس الدرجة', 'Reverse scored')} checked={q.reverse_scored} disabled={textOnly} onChange={(v) => setQ({ ...q, reverse_scored: v })} />
            <Checkbox label={tr('إلزامي', 'Required')} checked={q.required} disabled={textOnly} onChange={(v) => setQ({ ...q, required: v })} />
          </div>
        </div>
        {choice && !textOnly && <OptionsEditor options={q.options} scale={scale} onChange={(o) => setQ({ ...q, options: o })} />}
        {problems.length > 0 && <Notice tone="warning"><ul style={{ margin: 0, paddingInlineStart: 16 }}>{problems.map((p, i) => <li key={i}>{tr(p[0], p[1])}</li>)}</ul></Notice>}
        {warns.length > 0 && <Notice tone="info"><ul style={{ margin: 0, paddingInlineStart: 16 }}>{warns.map((p, i) => <li key={i}>{tr(p[0], p[1])}</li>)}</ul></Notice>}
      </div>
    </Modal>
  );
}

function BankModal({ tool, dims, questions, onClose, onDone }: { tool: AssessmentTool; dims: AssessmentDimension[]; questions: AssessmentQuestion[]; onClose: () => void; onDone: () => void }) {
  const { tr, locale } = useI18n();
  const toast = useToast();
  const [src, setSrc] = useState<'file' | 'paste'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [fileText, setFileText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<AppError | null>(null);
  useEffect(() => { if (file) file.text().then(setFileText).catch(() => setFileText('')); }, [file]);
  const raw = src === 'file' ? fileText : text;
  const parsed = useMemo(() => {
    const rows = raw.trim() ? parseDelimited(raw) : [];
    return parseBank(rows, dims, new Set(questions.map((q) => q.code.toLowerCase())), [Number(tool.scale_min), Number(tool.scale_max)]);
  }, [raw, dims, questions, tool.scale_min, tool.scale_max]);
  const header = raw.trim() ? (parseDelimited(raw)[0] ?? []).map((h) => h.trim().toLowerCase()) : [];
  const blocking = raw.trim() && (!header.includes('code') || (!header.includes('text_ar') && !header.includes('text_en')));
  const valid = parsed.rows.filter((r) => r.row);
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const startAt = questions.reduce((m, q) => Math.max(m, q.sort_order), 0);
      await insertMany('assessment_questions', valid.map((r, i) => ({ ...(r.row as Record<string, unknown>), organization_id: tool.organization_id, tool_id: tool.id, sort_order: startAt + i + 1 })));
      toast.success(tr(`أضيف ${valid.length} سؤال`, `${valid.length} question(s) added`));
      onDone();
    } catch (e) { setErr(errorOf(e)); } finally { setBusy(false); }
  };
  const status = (r: BankRow) => (r.errors.length ? <Badge tone="danger">{tr('خطأ', 'Error')}</Badge> : r.warnings.length ? <Badge tone="warning">{tr('تنبيه', 'Warning')}</Badge> : <Badge tone="success">{tr('صالح', 'Valid')}</Badge>);
  return (
    <Modal open size="wide" onClose={onClose} title={tr('رفع بنك أسئلة (CSV/TSV)', 'Upload question bank (CSV/TSV)')}
      footer={<><Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} disabled={!valid.length || !!blocking} onClick={run}>{tr(`استيراد ${valid.length} سؤال صالح`, `Import ${valid.length} valid question(s)`)}</Button></>}>
      <div className="stack">
        <Notice tone="info">
          <div className="small">{tr('الأعمدة:', 'Columns:')} <code>dimension_code, code, text_ar, text_en, type, options, weight, reverse</code></div>
          <div className="small">{tr('الخيارات:', 'Options:')} <code>value:score:label_ar:label_en|…</code> · {tr('الأنواع:', 'Types:')} <code>scale, single_choice, multiple_choice, number, boolean, text</code></div>
        </Notice>
        <Segmented value={src} onChange={setSrc} options={[{ value: 'file', label: tr('ملف', 'File') }, { value: 'paste', label: tr('لصق', 'Paste') }]} />
        {src === 'file' ? <FileDrop accept=".csv,.tsv,.txt" file={file} onFiles={(f) => setFile(f[0] ?? null)} /> : <Textarea rows={6} dir="ltr" className="mono" value={text} onChange={(e) => setText(e.target.value)} />}
        {blocking && <Notice tone="danger">{tr('صف العناوين يجب أن يحتوي code وعمود نص واحد على الأقل (text_ar أو text_en).', 'The header must include code and at least one text column (text_ar or text_en).')}</Notice>}
        {!header.includes('dimension_code') && raw.trim() && !blocking && <Notice tone="warning">{tr('لا يوجد عمود dimension_code؛ ستُضاف الأسئلة دون بعد ولن تُحتسب.', 'No dimension_code column; questions will be added without a dimension and will not be scored.')}</Notice>}
        {parsed.rows.length > 0 && (
          <>
            <div className="small">{tr('الصفوف', 'Rows')}: {parsed.rows.length} · {tr('صالحة', 'valid')}: {valid.length} · {tr('بأخطاء', 'with errors')}: {parsed.rows.length - valid.length}</div>
            <div className="table-wrap" style={{ maxHeight: 340, overflowY: 'auto' }}>
              <table className="table">
                <thead><tr><th>#</th><th>{tr('الحالة', 'Status')}</th><th>code</th><th>dim</th><th>type</th><th>{tr('النص', 'Text')}</th><th>{tr('الملاحظات', 'Notes')}</th></tr></thead>
                <tbody>{parsed.rows.slice(0, 300).map((r) => (
                  <tr key={r.line}>
                    <td className="mono tiny">{r.line}</td><td>{status(r)}</td><td className="mono tiny">{r.raw.code}</td><td className="mono tiny">{r.raw.dimension_code}</td><td className="tiny">{r.raw.type || 'scale'}</td>
                    <td className="tiny">{r.raw.text_ar || r.raw.text_en}</td>
                    <td className="tiny">{[...r.errors, ...r.warnings].map((m) => tr(m[0], m[1])).join(' · ')}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </>
        )}
        {err && <Notice tone="danger">{errText(err, locale)}</Notice>}
      </div>
    </Modal>
  );
}
