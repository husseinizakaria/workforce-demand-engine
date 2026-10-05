// Guided program creation: choose a track, enter basics, then accept expert
// setup recommendations (impact framework, indicators, maturity, first cohort).
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronLeft, ChevronRight, Gauge, Lightbulb, Network, Rocket, Target, Users, XCircle } from 'lucide-react';
import { TRACKS, type TrackDef } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAsync } from '@/hooks/useAsync';
import { all, insert } from '@/services/db';
import { errorOf, type AppError } from '@/services/errors';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, Notice, PageHeader, Segmented } from '@/components/ui';
import { RecordFields, normalizeRecord, validateRecord } from '@/components/forms/RecordForm';
import type { ImpactFramework, MaturityFramework, Program, ProgramTrackTemplate } from '@/types/db';
import { errText } from '../lib';
import { PROGRAM_FIELDS } from '../programFields';
import {
  createCohort, createDefaultIndicators, createImpactFramework, defaultIndicatorSeeds, findCentralImpactFramework, findCentralMaturityFramework, linkMaturityFramework,
} from '../setup';
import { cx } from '@/utils/cx';

type StepResult = { key: string; label: string; ok: boolean; error?: string };

export default function ProgramCreatePage() {
  const { tr, locale, L, pick, enumLabel, dir } = useI18n();
  const { org, can } = useOrg();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [trackCode, setTrackCode] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({ delivery_mode: 'onsite' });
  const [errors, setErrors] = useState<Record<string, [string, string]>>({});
  const [initialStatus, setInitialStatus] = useState<'draft' | 'planning'>('planning');
  const [opts, setOpts] = useState({ impact: true, indicators: true, maturity: true, cohort: true });
  const [cohort, setCohort] = useState({ name: '', capacity: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [results, setResults] = useState<{ program: Program; steps: StepResult[] } | null>(null);

  const templates = useAsync(() => all<ProgramTrackTemplate>('program_track_templates', { select: 'id,code,name_ar,name_en,stages,version,active', order: { column: 'code', ascending: true } }), []);
  const central = useAsync(async () => {
    if (!trackCode) return { impact: null as ImpactFramework | null, maturity: null as MaturityFramework | null };
    const [impact, maturity] = await Promise.all([findCentralImpactFramework(trackCode).catch(() => null), findCentralMaturityFramework(trackCode).catch(() => null)]);
    return { impact, maturity };
  }, [trackCode]);

  const tracks = useMemo(() => TRACKS.map((t) => {
    const db = templates.data?.find((x) => x.code === t.code);
    return { def: t, db, available: templates.data ? !!db && db.active : true };
  }), [templates.data]);
  const track: TrackDef | undefined = TRACKS.find((t) => t.code === trackCode);
  const dbStages = templates.data?.find((x) => x.code === trackCode)?.stages;
  const seeds = trackCode ? defaultIndicatorSeeds(trackCode) : [];

  const goStep2 = () => { if (trackCode) setStep(2); };
  const goStep3 = () => {
    const errs = validateRecord(PROGRAM_FIELDS, values);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (!cohort.name) setCohort({ name: tr('الدفعة الأولى', 'Cohort 1'), capacity: values.target_beneficiaries ? String(values.target_beneficiaries) : '' });
    setStep(3);
  };

  const create = async () => {
    if (!trackCode) return;
    setBusy(true); setError(null);
    let program: Program;
    try {
      program = await insert<Program>('programs', { ...normalizeRecord(PROGRAM_FIELDS, values), organization_id: org.id, track_code: trackCode, status: initialStatus });
    } catch (e) { setError(errorOf(e)); setBusy(false); return; }
    const steps: StepResult[] = [];
    const run = async (key: string, label: string, fn: () => Promise<unknown>) => {
      try { await fn(); steps.push({ key, label, ok: true }); } catch (e) { steps.push({ key, label, ok: false, error: errText(locale, errorOf(e)) }); }
    };
    let fwId: string | null = null;
    if (opts.impact && can('impact.create')) {
      await run('impact', tr('إطار الأثر (نظرية التغيير)', 'Impact framework (Theory of Change)'), async () => {
        const fw = await createImpactFramework(org.id, program, central.data?.impact ?? null); fwId = fw.id;
      });
    }
    if (opts.indicators && can('impact.create') && seeds.length) {
      await run('indicators', tr('المؤشرات الافتراضية', 'Default indicators'), () => createDefaultIndicators(org.id, program.id, trackCode, fwId));
    }
    if (opts.maturity && can('assessments.create') && central.data?.maturity) {
      const mid = central.data.maturity.id;
      await run('maturity', tr('إطار النضج', 'Maturity framework'), () => linkMaturityFramework(org.id, program.id, mid));
    }
    if (opts.cohort && cohort.name.trim()) {
      await run('cohort', tr('الدفعة الأولى', 'First cohort'), () => createCohort(org.id, program.id, {
        name: cohort.name.trim(), capacity: cohort.capacity ? Number(cohort.capacity) : null,
        start_date: (values.start_date as string) || null, end_date: (values.end_date as string) || null,
      }));
    }
    setBusy(false);
    if (steps.every((s) => s.ok)) navigate(`/app/programs/${program.id}/overview`);
    else setResults({ program, steps });
  };

  if (!can('programs.create')) {
    return <div className="stack"><PageHeader title={tr('برنامج جديد', 'New program')} /><Notice tone="warning">{tr('لا تملك صلاحية إنشاء البرامج.', 'You do not have permission to create programs.')}</Notice></div>;
  }
  const Next = dir === 'rtl' ? ChevronLeft : ChevronRight;
  const Prev = dir === 'rtl' ? ArrowRight : ArrowLeft;

  if (results) {
    return (
      <div className="stack">
        <PageHeader title={tr('تم إنشاء البرنامج', 'Program created')} subtitle={`${results.program.code} · ${results.program.name}`} />
        <Card>
          <CardHeader title={tr('نتيجة خطوات الإعداد', 'Setup steps result')} />
          <CardBody>
            <ul className="list-plain">
              <li className="row"><CheckCircle2 size={16} color="var(--success)" />{tr('البرنامج ومراحل الرحلة (منسوخة من قالب المسار)', 'Program and journey stages (copied from the track template)')}</li>
              {results.steps.map((s) => (
                <li key={s.key} className="row start">{s.ok ? <CheckCircle2 size={16} color="var(--success)" /> : <XCircle size={16} color="var(--danger)" />}
                  <span>{s.label}{s.error && <span className="small" style={{ color: 'var(--danger)', display: 'block' }}>{s.error}</span>}</span></li>
              ))}
            </ul>
            <Notice tone="info">{tr('يمكن إكمال الخطوات المتعثرة لاحقًا من تبويبات الأثر والتقييم والمشاركين.', 'Failed steps can be completed later from the Impact, Assessments and Participants tabs.')}</Notice>
          </CardBody>
          <div className="card-foot"><Button variant="primary" onClick={() => navigate(`/app/programs/${results.program.id}/overview`)}>{tr('فتح البرنامج', 'Open program')}</Button></div>
        </Card>
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHeader crumbs={[{ label: tr('البرامج', 'Programs'), to: '/app/programs' }, { label: tr('جديد', 'New') }]} title={tr('برنامج جديد', 'New program')}
        subtitle={tr('ثلاث خطوات: المسار، البيانات الأساسية، ثم توصيات الإعداد.', 'Three steps: track, basics, then setup recommendations.')} />
      <div className="row wrap" style={{ gap: 16 }}>
        {[tr('اختيار المسار', 'Choose track'), tr('البيانات الأساسية', 'Basics'), tr('توصيات الإعداد', 'Setup recommendations')].map((label, i) => (
          <span key={label} className="row" style={{ gap: 6 }}>
            <span className="badge" style={{ background: step > i + 1 ? 'var(--primary)' : step === i + 1 ? 'var(--primary-soft)' : undefined, color: step > i + 1 ? '#fff' : undefined }}>{step > i + 1 ? <Check /> : i + 1}</span>
            <span className={step === i + 1 ? 'strong' : 'muted'}>{label}</span>
          </span>
        ))}
      </div>

      {step === 1 && (
        <>
          {templates.error && <Notice tone="warning">{errText(locale, templates.error)}</Notice>}
          <div className="grid g3">
            {tracks.map(({ def, db, available }) => {
              const stages = (db?.stages?.length ? db.stages.map((s) => ({ key: s.key, ar: s.name_ar, en: s.name_en })) : def.stages.map((s) => ({ key: s.key, ar: s.name_ar, en: s.name_en })));
              const selected = trackCode === def.code;
              return (
                <button key={def.code} type="button" disabled={!available} onClick={() => setTrackCode(def.code)}
                  className={cx('card card-pad stack-sm')} aria-pressed={selected}
                  style={{ textAlign: 'start', cursor: available ? 'pointer' : 'not-allowed', opacity: available ? 1 : 0.55, font: 'inherit', color: 'inherit',
                    borderColor: selected ? 'var(--primary)' : undefined, boxShadow: selected ? '0 0 0 2px rgba(40, 125, 120, .18)' : undefined }}>
                  <div className="row between"><h3>{pick(def.name_ar, def.name_en)}</h3>{selected && <Badge tone="primary" icon={<Check />}>{tr('مختار', 'Selected')}</Badge>}</div>
                  <p className="small muted">{locale === 'ar' ? def.description_ar : def.description_en}</p>
                  <div className="row wrap" style={{ gap: 4 }}>
                    <Badge tone="info">{stages.length} {tr('مرحلة', 'stages')}</Badge>
                    <Badge>{def.maturity_dimensions.length} {tr('أبعاد نضج', 'maturity dims')}</Badge>
                    <Badge>{def.default_indicators.length} {tr('مؤشرات افتراضية', 'default indicators')}</Badge>
                    {!available && <Badge tone="danger">{tr('غير متاح', 'Unavailable')}</Badge>}
                  </div>
                  <div className="tiny muted" style={{ lineHeight: 1.8 }}>
                    {stages.map((s, i) => <span key={s.key}>{locale === 'ar' ? s.ar : s.en}{i < stages.length - 1 ? ' › ' : ''}</span>)}
                  </div>
                  <div className="tiny muted">{tr('أنواع الجلسات', 'Session types')}: {def.session_types.map((x) => enumLabel('sessionType', x)).join(locale === 'ar' ? '، ' : ', ')}</div>
                </button>
              );
            })}
          </div>
          <div className="row"><Button variant="primary" icon={<Next />} disabled={!trackCode} onClick={goStep2}>{tr('التالي', 'Next')}</Button></div>
        </>
      )}

      {step === 2 && track && (
        <div className="grid g-2-1">
          <Card>
            <CardHeader title={`${tr('البيانات الأساسية', 'Basics')} · ${pick(track.name_ar, track.name_en)}`} />
            <CardBody>
              <RecordFields fields={PROGRAM_FIELDS} values={values} errors={errors} onChange={(n, v) => setValues((s) => ({ ...s, [n]: v }))} />
              <div style={{ marginTop: 12 }}>
                <Field label={tr('الحالة الابتدائية', 'Initial status')} hint={tr('«تخطيط» يُفعّل فحوص الجاهزية في المحرك؛ «مسودة» للبرامج قيد الإعداد الأولي.', '“Planning” enables readiness checks in the engine; “draft” is for early setup.')}>
                  <Segmented value={initialStatus} onChange={setInitialStatus} options={[{ value: 'planning', label: enumLabel('programStatus', 'planning') }, { value: 'draft', label: enumLabel('programStatus', 'draft') }]} />
                </Field>
              </div>
            </CardBody>
            <div className="card-foot">
              <Button icon={<Prev />} onClick={() => setStep(1)}>{tr('السابق', 'Back')}</Button>
              <Button variant="primary" icon={<Next />} onClick={goStep3}>{tr('التالي', 'Next')}</Button>
            </div>
          </Card>
          <Card tinted>
            <CardHeader icon={<Lightbulb />} title={tr('إرشادات الخبير', 'Expert guidance')} />
            <CardBody>
              <ul className="small" style={{ margin: 0, paddingInlineStart: 16, display: 'grid', gap: 6 }}>
                <li>{tr('تاريخا البداية والنهاية يحددان نقاط القياس T0–T5؛ بدونهما لا يمكن تقييم التقدم مقابل الزمن.', 'Start and end dates define measurement points T0–T5; without them progress cannot be assessed against time.')}</li>
                <li>{tr('المستهدف من المستفيدين أساس مؤشر الوصول وتنبيهات الطاقة الاستيعابية.', 'The beneficiary target drives the reach indicator and capacity alerts.')}</li>
                <li>{tr('الميزانية الإجمالية تُقارن ببنود الصرف ومعدل الصرف مقابل الزمن.', 'The total budget is compared to spending lines and burn vs time.')}</li>
                <li>{tr('الراعي يدخل في فحص تعارض المصالح عند ترشيح الخبراء والمحكّمين.', 'The sponsor is included in conflict-of-interest checks when matching experts and judges.')}</li>
                <li>{tr('صِغ الأهداف بشكل قابل للقياس؛ ستُربط بالمؤشرات في نظرية التغيير.', 'Write measurable objectives; they will be linked to indicators in the Theory of Change.')}</li>
              </ul>
            </CardBody>
          </Card>
        </div>
      )}

      {step === 3 && track && (
        <div className="stack">
          {error && <Notice tone="danger">{errText(locale, error)}</Notice>}
          <Notice tone="info">{tr('عند الإنشاء تُنسخ مراحل رحلة المسار تلقائيًا إلى البرنامج (يمكن تهيئتها لاحقًا دون تغيير القالب المركزي). اختر ما تريد إعداده الآن:', 'On creation the track journey stages are copied to the program automatically (configurable later without changing the central template). Choose what to set up now:')}</Notice>
          <div className="grid g2">
            <SetupCard icon={<Network />} title={tr('إطار الأثر (نظرية التغيير)', 'Impact framework (Theory of Change)')} checked={opts.impact && can('impact.create')}
              disabled={!can('impact.create')} onChange={(v) => setOpts({ ...opts, impact: v })}
              why={tr('يربط المدخلات والأنشطة بالمخرجات والنتائج والأثر، ويحدد تصميم التقييم. دونه لا يمكن تجاوز مستوى «تغير مُلاحظ» في قوة الادعاء.', 'Links inputs and activities to outputs, outcomes and impact and sets the evaluation design. Without it claims cannot go beyond “observed change”.')}
              detail={central.loading ? tr('جارٍ البحث عن القالب المركزي…', 'Looking up the central template…') : central.data?.impact
                ? tr(`سيُنسخ القالب المركزي «${central.data.impact.name}» كمسودة للبرنامج.`, `The central template “${central.data.impact.name}” will be copied as a program draft.`)
                : tr('لا يوجد قالب مركزي لهذا المسار؛ سيُنشأ إطار فارغ.', 'No central template for this track; a blank framework will be created.')}
              noPerm={!can('impact.create')} />
            <SetupCard icon={<Target />} title={tr('المؤشرات الافتراضية للمسار', 'Default track indicators')} checked={opts.indicators && can('impact.create') && seeds.length > 0}
              disabled={!can('impact.create') || !seeds.length} onChange={(v) => setOpts({ ...opts, indicators: v })}
              why={tr('مؤشرات مجربة لكل مستوى (تشغيلي، مخرجات، نتائج، أثر) مع نقاط قياسها؛ تضمن عدم الاكتفاء بقياس حجم التنفيذ.', 'Proven indicators for each level (operational, output, outcome, impact) with measurement points; ensures you measure change, not only delivery volume.')}
              detail={<ul className="tiny" style={{ margin: 0, paddingInlineStart: 16 }}>{seeds.map((s) => <li key={s.key}><Badge tone="outline">{enumLabel('indicatorType', s.indicator_type)}</Badge> {L({ ar: s.name_ar, en: s.name_en })} · {s.measurement_points.join('/')}</li>)}</ul>}
              noPerm={!can('impact.create')} />
            <SetupCard icon={<Gauge />} title={tr('إطار النضج', 'Maturity framework')} checked={opts.maturity && can('assessments.create') && !!central.data?.maturity}
              disabled={!can('assessments.create') || !central.data?.maturity} onChange={(v) => setOpts({ ...opts, maturity: v })}
              why={tr('يقيس تطور المستفيدين عبر أبعاد المسار بين خط الأساس T0 والنهاية T1 والمتابعات؛ أساس تقرير النضج قبل/بعد.', 'Measures beneficiary progress across track dimensions from baseline T0 to end T1 and follow-ups; the basis of the before/after maturity report.')}
              detail={central.data?.maturity ? `${pick(central.data.maturity.name, central.data.maturity.name_en)} · ${track.maturity_dimensions.map((d) => pick(d.name_ar, d.name_en)).join(' · ')}` : tr('لا يوجد إطار نضج مركزي لهذا المسار.', 'No central maturity framework for this track.')}
              noPerm={!can('assessments.create')} />
            <SetupCard icon={<Users />} title={tr('الدفعة الأولى', 'First cohort')} checked={opts.cohort} onChange={(v) => setOpts({ ...opts, cohort: v })}
              why={['bootcamp', 'vocational', 'graduate'].includes(track.code)
                ? tr('هذا المسار يعتمد على الدفعات لتنظيم الجلسات والقياس؛ غيابها يُرصد كنقص في الإعداد.', 'This track relies on cohorts to organize sessions and measurement; missing cohorts are flagged as a setup gap.')
                : tr('الدفعة تنظم المستفيدين والجلسات وتتيح فحص الطاقة الاستيعابية.', 'A cohort organizes beneficiaries and sessions and enables capacity checks.')}
              detail={opts.cohort ? (
                <div className="row wrap">
                  <Field label={tr('اسم الدفعة', 'Cohort name')}><Input value={cohort.name} onChange={(e) => setCohort({ ...cohort, name: e.target.value })} /></Field>
                  <Field label={tr('الطاقة', 'Capacity')}><Input type="number" min={0} dir="ltr" value={cohort.capacity} onChange={(e) => setCohort({ ...cohort, capacity: e.target.value })} /></Field>
                </div>
              ) : null} />
          </div>
          <div className="row">
            <Button icon={<Prev />} onClick={() => setStep(2)} disabled={busy}>{tr('السابق', 'Back')}</Button>
            <Button variant="primary" icon={<Rocket />} loading={busy} onClick={() => void create()}>{tr('إنشاء البرنامج', 'Create program')}</Button>
          </div>
        </div>
      )}
      {step > 1 && !track && <Notice tone="warning">{tr('اختر مسارًا أولًا.', 'Choose a track first.')}</Notice>}
      {dbStages && dbStages.length === 0 && step === 1 && <Notice tone="warning">{tr('قالب المسار لا يحتوي مراحل في قاعدة البيانات.', 'The track template has no stages in the database.')}</Notice>}
    </div>
  );
}

function SetupCard({ icon, title, why, detail, checked, onChange, disabled, noPerm }: {
  icon: ReactNode; title: string; why: string; detail?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; noPerm?: boolean;
}) {
  const { tr } = useI18n();
  return (
    <Card>
      <CardHeader icon={icon} title={title} actions={<Checkbox checked={checked} disabled={disabled} onChange={onChange} label={<span className="small">{tr('إعداد الآن', 'Set up now')}</span>} />} />
      <CardBody>
        <div className="stack-sm">
          <p className="small"><Lightbulb size={13} color="var(--warning)" /> <b>{tr('لماذا؟', 'Why?')}</b> {why}</p>
          {detail && <div className="small muted">{detail}</div>}
          {noPerm && <span className="tiny" style={{ color: 'var(--warning)' }}>{tr('لا تملك الصلاحية اللازمة لهذا الإعداد.', 'You lack the permission required for this step.')}</span>}
        </div>
      </CardBody>
    </Card>
  );
}
