// Tool builder logic: classification band validation, expert validation
// warnings (as engine Insights) and question-bank parsing.
import type { ClassBand, Insight, QuestionOption } from '@engine';
import type { AssessmentDimension, AssessmentQuestion, AssessmentTool } from '@/types/db';

export type Msg = [ar: string, en: string];

export function bandIssues(bands: ClassBand[]): Msg[] {
  const out: Msg[] = [];
  if (!bands.length) return [['لا توجد فئات تصنيف؛ لن تُصنف النتائج.', 'No classification bands; results will not be classified.']];
  const sorted = [...bands].sort((a, b) => Number(a.min) - Number(b.min));
  sorted.forEach((b, i) => {
    const n = i + 1;
    if (!(Number(b.min) < Number(b.max))) out.push([`الفئة ${n}: الحد الأدنى يجب أن يكون أقل من الأعلى`, `Band ${n}: minimum must be below maximum`]);
    if (Number(b.min) < 0 || Number(b.max) > 100) out.push([`الفئة ${n}: الحدود خارج 0–100`, `Band ${n}: bounds outside 0–100`]);
    if (!b.label_ar?.trim()) out.push([`الفئة ${n}: التسمية العربية مفقودة`, `Band ${n}: Arabic label missing`]);
    if (!b.label_en?.trim()) out.push([`الفئة ${n}: التسمية الإنجليزية مفقودة`, `Band ${n}: English label missing`]);
    if (i > 0) {
      const prev = sorted[i - 1];
      if (Number(b.min) > Number(prev.max)) out.push([`فجوة بين ${prev.max} و${b.min}`, `Gap between ${prev.max} and ${b.min}`]);
      if (Number(b.min) < Number(prev.max)) out.push([`تداخل بين الفئتين ${i} و${n} (${b.min} < ${prev.max})`, `Overlap between bands ${i} and ${n} (${b.min} < ${prev.max})`]);
    }
  });
  if (Number(sorted[0].min) > 0) out.push([`القيم من 0 إلى ${sorted[0].min} غير مغطاة`, `Values from 0 to ${sorted[0].min} are not covered`]);
  if (Number(sorted[sorted.length - 1].max) < 100) out.push([`القيم من ${sorted[sorted.length - 1].max} إلى 100 غير مغطاة`, `Values from ${sorted[sorted.length - 1].max} to 100 are not covered`]);
  return out;
}

const CHOICE = new Set(['single_choice', 'multiple_choice']);

function ins(rule: string, kind: Insight['kind'], severity: Insight['severity'], title: Msg, rationale: Msg, action: Msg, data: Record<string, unknown> = {}): Insight {
  return {
    rule_code: rule, kind, severity, area: 'measurement', title: { ar: title[0], en: title[1] }, rationale: { ar: rationale[0], en: rationale[1] },
    recommended_action: { ar: action[0], en: action[1] }, source_data: data, fingerprint: `${rule}:${JSON.stringify(data)}`,
  };
}

/** Expert validation of a tool's structure. */
export function toolInsights(tool: AssessmentTool, dims: AssessmentDimension[], questions: AssessmentQuestion[]): Insight[] {
  const out: Insight[] = [];
  const smin = Number(tool.scale_min); const smax = Number(tool.scale_max);
  if (!dims.length) out.push(ins('TOOL_NO_DIMENSIONS', 'missing_config', 'high', ['الأداة بلا أبعاد', 'The tool has no dimensions'],
    ['الدرجة الكلية تُحسب من درجات الأبعاد؛ دون أبعاد لن تُحسب أي نتيجة.', 'The total is computed from dimension scores; without dimensions no result is computed.'],
    ['أضف بعدًا واحدًا على الأقل مع وزن وسلم تقدير.', 'Add at least one dimension with a weight and rubric.']));
  const scored = questions.filter((q) => q.dimension_id);
  if (scored.length) {
    for (const d of dims) if (!questions.some((q) => q.dimension_id === d.id)) {
      out.push(ins('DIM_NO_QUESTIONS', 'gap', 'medium', [`البعد «${d.name}» بلا أسئلة`, `Dimension “${d.name_en || d.name}” has no questions`],
        ['في الأدوات المبنية على الأسئلة لن يحصل هذا البعد على درجة، فتُحسب الدرجة الكلية من الأبعاد الأخرى فقط.', 'In question-based tools this dimension never gets a score, so the total uses only the other dimensions.'],
        ['أضف أسئلة للبعد أو احذفه.', 'Add questions to the dimension or remove it.'], { dim: d.code }));
    }
  } else if (dims.length) {
    out.push(ins('TOOL_RUBRIC_ONLY', 'recommendation', 'info', ['أداة تقدير مباشر بالأبعاد', 'Direct dimension-rating tool'],
      ['لا توجد أسئلة مرتبطة بالأبعاد؛ سيُقدّر المقيّم كل بعد مباشرة عبر سلم التقدير.', 'No questions are linked to dimensions; assessors rate each dimension directly using the rubric.'],
      ['تأكد أن لكل بعد مستويات وصفية واضحة.', 'Make sure every dimension has clear level descriptors.']));
    for (const d of dims) if (!(d.rubric ?? []).length) out.push(ins('DIM_NO_RUBRIC', 'missing_config', 'medium', [`البعد «${d.name}» بلا سلم تقدير`, `Dimension “${d.name_en || d.name}” has no rubric`],
      ['التقدير المباشر دون أوصاف للمستويات يضعف اتساق المقيّمين.', 'Direct rating without level descriptors weakens inter-rater consistency.'], ['أضف مستويات بأوصاف عربية وإنجليزية.', 'Add levels with Arabic and English descriptors.'], { dim: d.code }));
  }
  for (const d of dims) if (Number(d.weight) === 0 && tool.scoring_method === 'weighted_average') {
    out.push(ins('DIM_ZERO_WEIGHT', 'inconsistency', 'medium', [`وزن البعد «${d.name}» صفر`, `Dimension “${d.name_en || d.name}” has zero weight`],
      ['في المتوسط الموزون لن يؤثر هذا البعد في الدرجة الكلية.', 'In a weighted average this dimension has no effect on the total.'], ['حدد وزنًا موجبًا أو احذف البعد.', 'Set a positive weight or remove the dimension.'], { dim: d.code }));
  }
  if (tool.scoring_method !== 'weighted_average' && new Set(dims.map((d) => Number(d.weight))).size > 1) {
    out.push(ins('WEIGHTS_IGNORED', 'inconsistency', 'low', ['أوزان الأبعاد غير مستخدمة', 'Dimension weights are ignored'],
      ['طريقة الاحتساب ليست «متوسطًا موزونًا»، لذلك لا تؤثر الأوزان المختلفة في الدرجة الكلية.', 'The scoring method is not “weighted average”, so differing weights do not affect the total.'],
      ['غيّر الطريقة إلى متوسط موزون أو وحّد الأوزان.', 'Switch to weighted average or equalize the weights.']));
  }
  const unassigned = questions.filter((q) => !q.dimension_id);
  if (unassigned.length) out.push(ins('Q_NO_DIMENSION', 'gap', 'medium', [`${unassigned.length} سؤال دون بعد`, `${unassigned.length} question(s) without a dimension`],
    ['الأسئلة غير المرتبطة ببعد لا تدخل في الاحتساب ولا تظهر في نموذج التسجيل.', 'Questions without a dimension are not scored and are hidden in the recording form.'], ['اربط كل سؤال ببعد.', 'Link each question to a dimension.'], { n: unassigned.length }));
  for (const q of questions) {
    const opts = Array.isArray(q.options) ? q.options : [];
    if (q.question_type === 'scale' && opts.length) out.push(ins('Q_SCALE_OPTIONS', 'inconsistency', 'low', [`السؤال ${q.code}: خيارات على سؤال مقياس`, `Question ${q.code}: options on a scale question`],
      ['أسئلة المقياس تستخدم مدى الأداة مباشرة وتتجاهل الخيارات.', 'Scale questions use the tool range directly and ignore options.'], ['احذف الخيارات أو غيّر النوع إلى اختيار.', 'Remove the options or change the type to a choice.'], { q: q.code }));
    if (CHOICE.has(q.question_type)) {
      if (!opts.length) out.push(ins('Q_CHOICE_NO_OPTIONS', 'missing_config', 'high', [`السؤال ${q.code}: لا خيارات`, `Question ${q.code}: no options`],
        ['سؤال اختيار دون خيارات لا يمكن الإجابة عنه.', 'A choice question without options cannot be answered.'], ['أضف الخيارات مع درجاتها.', 'Add options with scores.'], { q: q.code }));
      else if (opts.some((o) => o.score === null || o.score === undefined || Number.isNaN(Number(o.score)))) out.push(ins('Q_CHOICE_NO_SCORES', 'missing_config', 'high', [`السؤال ${q.code}: خيارات دون درجات`, `Question ${q.code}: options without scores`],
        ['الخيارات بلا درجة لا تُحتسب، فتضيع إجابات المستفيد.', 'Options without a score are not counted, so the answer is lost.'], ['حدد درجة لكل خيار ضمن مدى الأداة.', 'Set a score for every option within the tool range.'], { q: q.code }));
      else if (opts.some((o) => Number(o.score) < smin || Number(o.score) > smax)) out.push(ins('Q_SCORE_RANGE', 'inconsistency', 'medium', [`السؤال ${q.code}: درجات خارج المدى`, `Question ${q.code}: scores outside the range`],
        [`درجات الخيارات يجب أن تكون ضمن ${smin}–${smax}.`, `Option scores should be within ${smin}–${smax}.`], ['صحح درجات الخيارات.', 'Correct the option scores.'], { q: q.code }));
    }
    if (q.question_type === 'text' && q.dimension_id) out.push(ins('Q_TEXT_SCORED', 'inconsistency', 'low', [`السؤال ${q.code}: نصي داخل بعد`, `Question ${q.code}: text question inside a dimension`],
      ['الأسئلة النصية لا تُحتسب رقميًا.', 'Text questions are never scored numerically.'], ['استخدمها للملاحظات فقط أو غيّر النوع.', 'Use them for comments only or change the type.'], { q: q.code }));
    if (Number(q.weight) === 0) out.push(ins('Q_ZERO_WEIGHT', 'inconsistency', 'low', [`السؤال ${q.code}: وزن صفر`, `Question ${q.code}: zero weight`],
      ['لن يؤثر السؤال في درجة البعد.', 'The question will not affect its dimension score.'], ['حدد وزنًا موجبًا.', 'Set a positive weight.'], { q: q.code }));
  }
  const missingEn = questions.filter((q) => !q.text_en?.trim()).length;
  const missingAr = questions.filter((q) => !q.text_ar?.trim()).length;
  const machine = questions.filter((q) => q.translation_status === 'machine').length;
  if (missingEn || missingAr) out.push(ins('Q_MISSING_TRANSLATION', 'data_quality', 'low', ['ترجمات ناقصة', 'Missing translations'],
    [`${missingAr} سؤال بلا نص عربي و${missingEn} بلا نص إنجليزي؛ سيرى المستخدمون النص البديل.`, `${missingAr} question(s) lack Arabic and ${missingEn} lack English text; users will see the fallback.`],
    ['استخدم الترجمة الآلية ثم راجعها، أو أدخل الترجمة يدويًا.', 'Use machine translation then review it, or enter it manually.'], { missingAr, missingEn }));
  if (machine) out.push(ins('Q_MACHINE_UNVERIFIED', 'data_quality', 'low', [`${machine} ترجمة آلية غير مراجعة`, `${machine} unreviewed machine translation(s)`],
    ['الترجمة الآلية قد تغيّر معنى البند وتؤثر في صدق الأداة.', 'Machine translation may alter item meaning and affect validity.'], ['راجع الترجمات وعلّمها «متحقق منها».', 'Review the translations and mark them as verified.'], { machine }));
  const bi = bandIssues(Array.isArray(tool.classification) ? tool.classification : []);
  if (bi.length) out.push(ins('BANDS_INVALID', 'inconsistency', Array.isArray(tool.classification) && tool.classification.length ? 'high' : 'medium', ['فئات التصنيف غير مكتملة', 'Classification bands are incomplete'],
    [bi.map((x) => x[0]).join('؛ '), bi.map((x) => x[1]).join('; ')], ['صحح الفئات لتغطي 0–100 دون فجوات أو تداخل.', 'Fix the bands to cover 0–100 without gaps or overlaps.']));
  if (tool.pass_threshold === null) out.push(ins('NO_PASS_THRESHOLD', 'recommendation', 'info', ['لا يوجد حد نجاح', 'No pass threshold'],
    ['لن يُحدد نجاح/عدم نجاح للنتائج.', 'Results will have no pass/fail flag.'], ['حدد حد النجاح إذا كانت الأداة تُستخدم للفرز أو الاعتماد.', 'Set a pass threshold if the tool is used for screening or certification.']));
  if (tool.tool_type === 'external' && !tool.provider) out.push(ins('EXTERNAL_NO_PROVIDER', 'missing_config', 'low', ['أداة خارجية دون مزوّد', 'External tool without provider'],
    ['توثيق المزوّد ضروري لتتبع مصدر البيانات وحقوق الاستخدام.', 'Documenting the provider is needed for data provenance and licensing.'], ['أدخل اسم المزوّد في إعدادات الأداة.', 'Enter the provider in the tool settings.']));
  return out;
}

// ---------------------------------------------------------------------------
// Question bank CSV/TSV
// columns: dimension_code, code, text_ar, text_en, type, options, weight, reverse
// options: "value:score:label_ar:label_en|..."
// ---------------------------------------------------------------------------
export interface BankRow { line: number; row: Record<string, unknown> | null; errors: Msg[]; warnings: Msg[]; raw: Record<string, string> }
const TYPES = ['scale', 'single_choice', 'multiple_choice', 'number', 'boolean', 'text'];

export function parseOptions(s: string): { options: QuestionOption[]; error: Msg | null } {
  if (!s.trim()) return { options: [], error: null };
  const options: QuestionOption[] = [];
  for (const part of s.split('|').map((x) => x.trim()).filter(Boolean)) {
    const [value, score, ar, ...en] = part.split(':');
    if (!value?.trim()) return { options, error: [`خيار دون قيمة: «${part}»`, `Option without value: “${part}”`] };
    const sc = score === undefined || score.trim() === '' ? null : Number(score);
    if (sc !== null && !Number.isFinite(sc)) return { options, error: [`درجة غير رقمية في «${part}»`, `Non-numeric score in “${part}”`] };
    options.push({ value: value.trim(), score: sc, label_ar: ar?.trim() || value.trim(), label_en: en.join(':').trim() || undefined });
  }
  return { options, error: null };
}

export function parseBank(rows: string[][], dims: AssessmentDimension[], existingCodes: Set<string>, scale: [number, number]): { rows: BankRow[]; missingColumns: string[] } {
  if (!rows.length) return { rows: [], missingColumns: [] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const required = ['code', 'type'];
  const missingColumns = [...required, 'dimension_code'].filter((c) => !header.includes(c));
  const byCode = new Map(dims.map((d) => [d.code.toLowerCase(), d]));
  const seen = new Set<string>();
  const out: BankRow[] = rows.slice(1).map((cells, i) => {
    const raw: Record<string, string> = Object.fromEntries(header.map((h, j) => [h, (cells[j] ?? '').trim()]));
    const errors: Msg[] = []; const warnings: Msg[] = [];
    const code = raw.code ?? '';
    if (!code) errors.push(['الرمز مفقود', 'Missing code']);
    else if (existingCodes.has(code.toLowerCase())) errors.push([`الرمز ${code} موجود في الأداة`, `Code ${code} already exists in the tool`]);
    else if (seen.has(code.toLowerCase())) errors.push([`الرمز ${code} مكرر في الملف`, `Code ${code} is duplicated in the file`]);
    seen.add(code.toLowerCase());
    const dim = raw.dimension_code ? byCode.get(raw.dimension_code.toLowerCase()) : undefined;
    if (raw.dimension_code && !dim) errors.push([`البعد ${raw.dimension_code} غير موجود`, `Dimension ${raw.dimension_code} does not exist`]);
    if (!raw.dimension_code) warnings.push(['دون بعد: لن يُحتسب', 'No dimension: will not be scored']);
    if (!raw.text_ar && !raw.text_en) errors.push(['نص السؤال مفقود', 'Question text missing']);
    else if (!raw.text_ar || !raw.text_en) warnings.push(['ترجمة ناقصة', 'Missing translation']);
    const type = (raw.type || 'scale').toLowerCase();
    if (!TYPES.includes(type)) errors.push([`نوع غير معروف: ${raw.type}`, `Unknown type: ${raw.type}`]);
    const { options, error } = parseOptions(raw.options ?? '');
    if (error) errors.push(error);
    if ((type === 'single_choice' || type === 'multiple_choice') && !options.length) errors.push(['سؤال اختيار دون خيارات', 'Choice question without options']);
    if ((type === 'single_choice' || type === 'multiple_choice') && options.some((o) => o.score === null)) warnings.push(['خيارات دون درجات', 'Options without scores']);
    if (options.some((o) => o.score !== null && o.score !== undefined && (Number(o.score) < scale[0] || Number(o.score) > scale[1]))) warnings.push([`درجات خارج ${scale[0]}–${scale[1]}`, `Scores outside ${scale[0]}–${scale[1]}`]);
    if (type === 'scale' && options.length) warnings.push(['الخيارات تُتجاهل في أسئلة المقياس', 'Options are ignored for scale questions']);
    const weight = raw.weight ? Number(raw.weight) : 1;
    if (!Number.isFinite(weight) || weight < 0) errors.push(['وزن غير صالح', 'Invalid weight']);
    const rv = (raw.reverse ?? '').toLowerCase();
    if (rv && !['true', 'false', '1', '0', 'yes', 'no', 'نعم', 'لا'].includes(rv)) errors.push(['قيمة reverse غير صالحة', 'Invalid reverse value']);
    const reverse = ['true', '1', 'yes', 'نعم'].includes(rv);
    return {
      line: i + 2, raw, errors, warnings,
      row: errors.length ? null : {
        dimension_id: dim?.id ?? null, code, text_ar: raw.text_ar || null, text_en: raw.text_en || null, question_type: type,
        options: type === 'scale' ? [] : options, weight, reverse_scored: reverse, required: true, translation_status: 'none',
      },
    };
  });
  return { rows: out, missingColumns };
}
