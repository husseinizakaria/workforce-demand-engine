// Record an assessment result with a live scoring preview (engine mirror of
// the database trigger). The database trigger is authoritative: after insert
// the stored row is re-read and compared with the preview.
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Send } from 'lucide-react';
import { scoreResult, type ResponseValue } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAsync } from '@/hooks/useAsync';
import { count, get, insert } from '@/services/db';
import { errorOf, type AppError } from '@/services/errors';
import {
  AsyncView, Badge, Button, Card, CardBody, CardHeader, EmptyState, EntityPicker, Field, Kpi, Notice, Progress, Select, Textarea, scoreTone, type EntityKind,
} from '@/components/ui';
import type { AssessmentResult, AssessmentTool } from '@/types/db';
import { errText, loadOrgTools, loadToolBundle, num, questionLike, questionText, toolLike, type ProgramLite } from '../api';
import { BandBadge, QuestionInput } from './Shared';

type SubjectKind = 'beneficiary' | 'team' | 'expert' | 'program';
const SUBJECT_COL: Record<SubjectKind, 'beneficiary_id' | 'team_id' | 'expert_id' | 'program_id'> = { beneficiary: 'beneficiary_id', team: 'team_id', expert: 'expert_id', program: 'program_id' };
const SUBJECT_ENTITY: Record<Exclude<SubjectKind, 'program'>, EntityKind> = { beneficiary: 'beneficiaries', team: 'program_teams', expert: 'experts' };
const subjectFor = (t: AssessmentTool | undefined): SubjectKind => (t?.subject_type === 'team' ? 'team' : t?.subject_type === 'expert' ? 'expert' : t?.subject_type === 'program' ? 'program' : 'beneficiary');

export function RecordResultTab({ programs, initialProgram }: { programs: ProgramLite[]; initialProgram: string | null }) {
  const { tr, pick, enumOptions, locale, fmtNumber, enumLabel } = useI18n();
  const { org, can } = useOrg();
  const [programId, setProgramId] = useState<string>(initialProgram ?? '');
  const [toolId, setToolId] = useState('');
  const [subjectKind, setSubjectKind] = useState<SubjectKind>('beneficiary');
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [point, setPoint] = useState('T0');
  const [responses, setResponses] = useState<Record<string, ResponseValue>>({});
  const [dimScores, setDimScores] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [stored, setStored] = useState<{ row: AssessmentResult; preview: ReturnType<typeof scoreResult> } | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => { if (initialProgram) setProgramId(initialProgram); }, [initialProgram]);

  const tools = useAsync(() => loadOrgTools(org.id), [org.id]);
  const activeTools = useMemo(() => (tools.data ?? []).filter((t) => t.status === 'active'), [tools.data]);
  const bundle = useAsync(async () => (toolId ? loadToolBundle(toolId) : null), [toolId]);
  const b = bundle.data ?? null;

  useEffect(() => { setResponses({}); setDimScores({}); setStored(null); setShowErrors(false); setSubjectKind(subjectFor(b?.tool)); setSubjectId(null); }, [b?.tool.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const scoredQuestions = useMemo(() => (b?.questions ?? []).filter((q) => q.dimension_id), [b]);
  const mode: 'questions' | 'direct' = scoredQuestions.length ? 'questions' : 'direct';
  const tl = b ? toolLike(b.tool) : null;
  const preview = useMemo(() => {
    if (!b || !tl) return null;
    const dims = b.dims.map((d) => ({ id: d.id, weight: Number(d.weight) }));
    return mode === 'questions'
      ? scoreResult(tl, dims, b.questions.map(questionLike), { responses })
      : scoreResult(tl, dims, [], { dimension_scores: dimScores });
  }, [b, tl, mode, responses, dimScores]); // eslint-disable-line react-hooks/exhaustive-deps

  const missingRequired = useMemo(() => (mode === 'questions' ? (b?.questions ?? []).filter((q) => q.required && q.question_type !== 'text' && q.dimension_id) : [])
    .filter((q) => { const v = responses[q.id]; return v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length); }), [b, mode, responses]);

  const subjectValue = subjectKind === 'program' ? programId || null : subjectId;
  const duplicate = useAsync(async () => {
    if (!toolId || !subjectValue) return 0;
    return count('assessment_results', [['organization_id', 'eq', org.id], ['tool_id', 'eq', toolId], ['measurement_point', 'eq', point], [SUBJECT_COL[subjectKind], 'eq', subjectValue], ['status', 'neq', 'rejected']]);
  }, [toolId, subjectValue, point, subjectKind]);

  const submit = async () => {
    if (!b || !preview) return;
    setShowErrors(true);
    if (!subjectValue || missingRequired.length || (mode === 'direct' && !Object.keys(dimScores).length)) return;
    setBusy(true); setError(null);
    try {
      const row: Record<string, unknown> = {
        organization_id: org.id, tool_id: b.tool.id, program_id: programId || null, measurement_point: point, notes: notes.trim() || null, status: 'submitted',
        [SUBJECT_COL[subjectKind]]: subjectValue,
      };
      if (mode === 'questions') {
        row.responses = Object.fromEntries(Object.entries(responses).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)));
      } else row.dimension_scores = dimScores;
      const created = await insert<AssessmentResult>('assessment_results', row);
      const fresh = await get<AssessmentResult>('assessment_results', created.id);
      setStored({ row: fresh, preview });
      setResponses({}); setDimScores({}); setNotes(''); setShowErrors(false);
      void duplicate.reload();
    } catch (e) { setError(errorOf(e)); } finally { setBusy(false); }
  };

  if (!can('assessments.create')) {
    return <Card><EmptyState title={tr('لا تملك صلاحية تسجيل نتائج التقييم', 'You cannot record assessment results')} description={tr('تتطلب هذه العملية صلاحية assessments.create.', 'This requires the assessments.create permission.')} /></Card>;
  }

  const dimName = (id: string) => { const d = b?.dims.find((x) => x.id === id); return d ? pick(d.name, d.name_en) : id; };
  const mismatch = stored && (num(stored.row.normalized_score) !== stored.preview.normalized_score || num(stored.row.total_score) !== stored.preview.total_score);

  return (
    <div className="grid g-2-1">
      <div className="stack">
        <Card>
          <CardHeader icon={<ClipboardCheck size={16} />} title={tr('بيانات القياس', 'Measurement details')} />
          <CardBody>
            <div className="form-grid">
              <Field label={tr('البرنامج (اختياري)', 'Program (optional)')}>
                <Select value={programId} onChange={(e) => setProgramId(e.target.value)} placeholder={tr('— دون برنامج —', '— No program —')}
                  options={programs.map((p) => ({ value: p.id, label: `${pick(p.name, p.name_en)} · ${p.code}` }))} />
              </Field>
              <Field label={tr('أداة التقييم (النشطة)', 'Assessment tool (active)')} required hint={!activeTools.length && !tools.loading ? tr('لا توجد أدوات نشطة — فعّل أداة من تبويب الأدوات', 'No active tools — activate one in the Tools tab') : undefined}>
                <Select value={toolId} onChange={(e) => setToolId(e.target.value)} placeholder={tr('— اختر —', '— Select —')}
                  options={activeTools.map((t) => ({ value: t.id, label: `${pick(t.name, t.name_en)} · v${t.version}${t.tool_type === 'external' ? ` (${enumLabel('toolType', 'external')})` : ''}` }))} />
              </Field>
              <Field label={tr('نقطة القياس', 'Measurement point')} required>
                <Select value={point} onChange={(e) => setPoint(e.target.value)} options={enumOptions('measurementPoint')} />
              </Field>
              <Field label={tr('نوع المُقيَّم', 'Subject type')} required>
                <Select value={subjectKind} onChange={(e) => { setSubjectKind(e.target.value as SubjectKind); setSubjectId(null); }}
                  options={[{ value: 'beneficiary', label: tr('مستفيد', 'Beneficiary') }, { value: 'team', label: tr('فريق', 'Team') }, { value: 'expert', label: tr('خبير', 'Expert') }, { value: 'program', label: tr('البرنامج نفسه', 'The program itself') }]} />
              </Field>
              <Field className="full" label={subjectKind === 'program' ? tr('البرنامج المُقيَّم', 'Program assessed') : tr('المُقيَّم', 'Subject')} required
                error={showErrors && !subjectValue ? tr('اختر المُقيَّم', 'Choose the subject') : undefined}>
                {subjectKind === 'program'
                  ? <span className="small muted">{programId ? tr('سيُسجل التقييم على مستوى البرنامج المختار.', 'The result is recorded at the level of the selected program.') : tr('اختر البرنامج أعلاه.', 'Choose the program above.')}</span>
                  : <EntityPicker kind={SUBJECT_ENTITY[subjectKind]} organizationId={org.id} value={subjectId} onChange={(id) => setSubjectId(id)}
                      filters={subjectKind === 'team' && programId ? [['program_id', 'eq', programId]] : undefined} />}
              </Field>
            </div>
            {b && subjectFor(b.tool) !== subjectKind && <div style={{ marginTop: 8 }}><Notice tone="warning">{tr(`الأداة مصممة لتقييم «${enumLabel('subjectType', b.tool.subject_type)}»؛ تأكد من ملاءمتها للمُقيَّم المختار.`, `This tool is designed for “${enumLabel('subjectType', b.tool.subject_type)}” subjects; confirm it fits the chosen subject.`)}</Notice></div>}
            {(duplicate.data ?? 0) > 0 && <div style={{ marginTop: 8 }}><Notice tone="warning">{tr(`يوجد ${duplicate.data} نتيجة سابقة لنفس المُقيَّم والأداة ونقطة القياس. التسجيل مرة أخرى قد يضاعف القياس في التحليل.`, `${duplicate.data} existing result(s) for this subject, tool and point. Recording again may double-count in analysis.`)}</Notice></div>}
            {b && programId && b.tool.track_codes.length > 0 && (() => {
              const p = programs.find((x) => x.id === programId);
              return p && !b.tool.track_codes.includes(p.track_code)
                ? <div style={{ marginTop: 8 }}><Notice tone="info">{tr(`الأداة غير مصنفة لمسار «${enumLabel('track', p.track_code)}». يُفضّل أداة مصممة لهذا المسار.`, `This tool is not tagged for the “${enumLabel('track', p.track_code)}” track. A track-specific tool is preferable.`)}</Notice></div> : null;
            })()}
          </CardBody>
        </Card>

        {!toolId ? <Card><EmptyState title={tr('اختر أداة لعرض أسئلتها', 'Choose a tool to show its questions')} /></Card> : (
          <AsyncView state={bundle}>{(bd) => !bd ? null : (
            <Card>
              <CardHeader title={mode === 'questions' ? tr('الأسئلة حسب البعد', 'Questions by dimension') : tr('تقدير مباشر للأبعاد (سلم التقدير)', 'Direct dimension rating (rubric)')}
                hint={`${tr('المقياس', 'Scale')} ${bd.tool.scale_min}–${bd.tool.scale_max}`} />
              <CardBody>
                {!bd.dims.length && <Notice tone="danger">{tr('الأداة بلا أبعاد؛ لا يمكن احتساب أي درجة. أكمل إعدادها في منشئ الأداة.', 'The tool has no dimensions; no score can be computed. Complete it in the tool builder.')}</Notice>}
                <div className="stack">
                  {bd.dims.map((d) => {
                    const qs = bd.questions.filter((q) => q.dimension_id === d.id);
                    if (mode === 'questions') {
                      if (!qs.length) return <div key={d.id} className="small muted">{pick(d.name, d.name_en)} — {tr('لا أسئلة في هذا البعد', 'no questions in this dimension')}</div>;
                      return (
                        <fieldset key={d.id} className="card card-pad" style={{ margin: 0 }}>
                          <legend className="strong small" style={{ padding: '0 6px' }}>{pick(d.name, d.name_en)} <span className="tiny muted mono">{d.code}</span>
                            {preview?.dimension_scores[d.id] !== undefined && <Badge tone="primary">{fmtNumber(preview.dimension_scores[d.id], 2)}</Badge>}</legend>
                          <div className="stack-sm">
                            {qs.map((q, i) => {
                              const t = questionText(q, locale);
                              const missing = showErrors && missingRequired.some((m) => m.id === q.id);
                              return (
                                <div key={q.id} className="stack-sm" style={{ gap: 4, paddingBottom: 8, borderBottom: i < qs.length - 1 ? '1px solid var(--border)' : undefined }}>
                                  <div className="row between start">
                                    <span className="small"><span className="mono tiny muted">{q.code}</span> {t.text}{q.required && <span className="req" aria-hidden style={{ color: 'var(--danger)' }}> *</span>}</span>
                                    <div className="row" style={{ gap: 4 }}>
                                      {t.fallback && <Badge tone="warning">{tr('بلا ترجمة', 'Untranslated')}</Badge>}
                                      {q.reverse_scored && <Badge tone="outline" title={tr('تُعكس الدرجة عند الاحتساب', 'Score is reversed when computed')}>{tr('معكوس', 'Reversed')}</Badge>}
                                    </div>
                                  </div>
                                  <QuestionInput q={q} value={responses[q.id]} scaleMin={Number(bd.tool.scale_min)} scaleMax={Number(bd.tool.scale_max)} rubric={d.rubric}
                                    onChange={(v) => setResponses((r) => ({ ...r, [q.id]: v }))} />
                                  {missing && <span className="err small" style={{ color: 'var(--danger)' }}>{tr('إجابة إلزامية', 'Answer required')}</span>}
                                </div>
                              );
                            })}
                          </div>
                        </fieldset>
                      );
                    }
                    const levels = [...(d.rubric ?? [])].sort((a, b2) => Number(a.score) - Number(b2.score));
                    const val = dimScores[d.id];
                    return (
                      <div key={d.id} className="card card-pad stack-sm">
                        <div className="row between"><b>{pick(d.name, d.name_en)}</b><span className="mono tiny muted">{d.code} · w={d.weight}</span></div>
                        {levels.length ? (
                          <div className="stack-sm" style={{ gap: 4 }}>
                            {levels.map((lv) => (
                              <label key={lv.score} className="check" style={{ alignItems: 'flex-start', padding: 6, borderRadius: 6, background: val === Number(lv.score) ? 'var(--primary-soft)' : undefined }}>
                                <input type="radio" name={`dim-${d.id}`} checked={val === Number(lv.score)} onChange={() => setDimScores((s) => ({ ...s, [d.id]: Number(lv.score) }))} />
                                <span><b className="mono">{lv.score}</b> · <b>{pick(lv.label_ar, lv.label_en)}</b>{(lv.descriptor_ar || lv.descriptor_en) && <span className="small muted"> — {pick(lv.descriptor_ar, lv.descriptor_en)}</span>}</span>
                              </label>
                            ))}
                          </div>
                        ) : (
                          <input className="input ltr" type="number" step="any" min={bd.tool.scale_min} max={bd.tool.scale_max} style={{ maxWidth: 160 }} value={val ?? ''}
                            onChange={(e) => setDimScores((s) => { const n = { ...s }; if (e.target.value === '') delete n[d.id]; else n[d.id] = Number(e.target.value); return n; })} />
                        )}
                      </div>
                    );
                  })}
                  {mode === 'questions' && bd.questions.some((q) => !q.dimension_id) && (
                    <Notice tone="info">{tr('بعض الأسئلة غير مرتبطة ببعد ولا تدخل في الاحتساب؛ لذلك لا تظهر هنا.', 'Some questions are not linked to a dimension and are not scored, so they are not shown here.')}</Notice>
                  )}
                  <Field label={tr('ملاحظات المقيّم', 'Assessor notes')}><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
                </div>
              </CardBody>
            </Card>
          )}</AsyncView>
        )}
      </div>

      <div className="stack">
        <Card>
          <CardHeader title={tr('معاينة الاحتساب المباشرة', 'Live scoring preview')} hint={tr('نسخة مطابقة لمحرك قاعدة البيانات', 'Mirror of the database engine')} />
          <CardBody>
            {!preview ? <p className="small muted">{tr('ستظهر الدرجات عند اختيار أداة والإجابة.', 'Scores appear once a tool is chosen and answered.')}</p> : (
              <div className="stack-sm">
                <div className="grid g2">
                  <Kpi label={tr('الدرجة الكلية', 'Total score')} value={preview.total_score ?? '—'} hint={`${tr('على مقياس', 'on scale')} ${b?.tool.scale_min}–${b?.tool.scale_max}${b?.tool.scoring_method === 'sum' ? ` (${enumLabel('scoringMethod', 'sum')})` : ''}`} />
                  <Kpi label={tr('الدرجة الموحدة', 'Normalized')} value={preview.normalized_score === null ? '—' : `${fmtNumber(preview.normalized_score, 1)}%`} tone={scoreTone(preview.normalized_score)} />
                </div>
                <Progress value={preview.normalized_score} tone={scoreTone(preview.normalized_score)} />
                <div className="row between"><span className="small">{tr('التصنيف', 'Classification')}</span><BandBadge band={preview.classification} /></div>
                {preview.classification && <p className="small muted">{pick(preview.classification.interpretation_ar, preview.classification.interpretation_en)}</p>}
                <div className="row between">
                  <span className="small">{tr('النجاح', 'Pass')}{b?.tool.pass_threshold !== null && b?.tool.pass_threshold !== undefined && <span className="muted"> (≥ {b.tool.pass_threshold}%)</span>}</span>
                  {preview.passed === null ? <span className="muted">—</span> : preview.passed ? <Badge tone="success">{tr('ناجح', 'Passed')}</Badge> : <Badge tone="danger">{tr('لم يجتز', 'Not passed')}</Badge>}
                </div>
                <div className="divider" />
                <span className="small strong">{tr('درجات الأبعاد', 'Dimension scores')} ({preview.dimensions_scored}/{b?.dims.length ?? 0})</span>
                {(b?.dims ?? []).map((d) => {
                  const v = preview.dimension_scores[d.id];
                  const pct = v === undefined || !tl ? null : ((v - tl.scale_min) / (tl.scale_max - tl.scale_min)) * 100;
                  return (
                    <div key={d.id} className="stack-sm" style={{ gap: 2 }}>
                      <div className="row between small"><span className="ellipsis">{pick(d.name, d.name_en)}</span><span className="mono">{v === undefined ? '—' : fmtNumber(v, 2)}</span></div>
                      <Progress value={pct} tone={scoreTone(pct)} />
                    </div>
                  );
                })}
                {mode === 'questions' && missingRequired.length > 0 && <Notice tone="warning">{tr(`${missingRequired.length} سؤال إلزامي دون إجابة`, `${missingRequired.length} required question(s) unanswered`)}</Notice>}
                {preview.dimensions_scored > 0 && b && preview.dimensions_scored < b.dims.length && <Notice tone="info">{tr('بعض الأبعاد بلا درجة؛ ستُحتسب الدرجة الكلية من الأبعاد المقاسة فقط.', 'Some dimensions have no score; the total uses only the measured dimensions.')}</Notice>}
              </div>
            )}
          </CardBody>
          <div className="card-foot" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            {error ? <span className="small" style={{ color: 'var(--danger)' }}>{errText(error, locale)}</span> : <span className="tiny muted">{tr('يحسب الخادم الدرجات النهائية عند الحفظ', 'The server computes the final scores on save')}</span>}
            <Button variant="primary" icon={<Send />} loading={busy} disabled={!b} onClick={submit}>{tr('حفظ النتيجة', 'Save result')}</Button>
          </div>
        </Card>

        {stored && (
          <Card>
            <CardHeader icon={<CheckCircle2 size={16} />} title={tr('النتيجة المحفوظة (من قاعدة البيانات)', 'Stored result (from the database)')} />
            <CardBody>
              <dl className="kv">
                <dt>{tr('الدرجة الكلية', 'Total')}</dt><dd className="mono">{stored.row.total_score ?? '—'}</dd>
                <dt>{tr('الموحدة', 'Normalized')}</dt><dd className="mono">{stored.row.normalized_score ?? '—'}</dd>
                <dt>{tr('التصنيف', 'Classification')}</dt><dd>{pick(stored.row.interpretation?.label_ar as string | undefined, stored.row.interpretation?.label_en as string | undefined) || stored.row.classification_label || '—'}</dd>
                <dt>{tr('النجاح', 'Passed')}</dt><dd>{stored.row.passed === null ? '—' : stored.row.passed ? tr('نعم', 'Yes') : tr('لا', 'No')}</dd>
                <dt>{tr('الإصدار', 'Version')}</dt><dd>v{stored.row.tool_version}</dd>
                {Object.entries(stored.row.dimension_scores ?? {}).map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{dimName(k)}</dt><dd className="mono">{fmtNumber(Number(v), 2)}</dd></div>)}
              </dl>
              <div style={{ marginTop: 8 }}>
                {mismatch
                  ? <Notice tone="warning">{tr(`اختلفت قيم الخادم عن المعاينة (المعاينة: ${stored.preview.total_score ?? '—'} / ${stored.preview.normalized_score ?? '—'}%). القيم المحفوظة هي المعتمدة؛ قد تكون الأداة عُدّلت أثناء الإدخال.`, `Server values differ from the preview (preview: ${stored.preview.total_score ?? '—'} / ${stored.preview.normalized_score ?? '—'}%). Stored values are authoritative; the tool may have changed during entry.`)}</Notice>
                  : <Notice tone="success">{tr('تطابقت درجات الخادم مع المعاينة.', 'Server scores match the preview.')}</Notice>}
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
