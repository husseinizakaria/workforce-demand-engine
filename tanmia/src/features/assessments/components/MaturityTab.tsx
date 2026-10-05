// Maturity model: frameworks (org + central library), the T0..T5 measurement
// matrix per program, recording/editing assessments, and before/after comparison.
import { useMemo, useState } from 'react';
import { Copy, Grid3x3, LineChart, Plus } from 'lucide-react';
import { compareMaturity, duePoints, MATURITY_LEVELS, maturityOverall, type MaturityFrameworkLike } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAsync } from '@/hooks/useAsync';
import { useAction } from '@/hooks/useAction';
import { all, insert, rpc, update } from '@/services/db';
import { errorOf, type AppError } from '@/services/errors';
import {
  AsyncView, Badge, BarList, Button, Card, CardBody, CardHeader, ColumnChart, DataTable, Distribution, EmptyState, EntityPicker, Field, Kpi, Modal, Notice, Select, Textarea, type Column,
} from '@/components/ui';
import type { MaturityAssessment, MaturityFramework, ProgramEnrollment } from '@/types/db';
import { MEASUREMENT_KEYS, nameMap, num, type ProgramLite } from '../api';

interface Subject { key: string; kind: 'beneficiary' | 'team'; id: string; name: string; cohort_id: string | null; status?: string }
interface EditState { subject: Subject | null; point: string; existing: MaturityAssessment | null }

const fwLike = (f: MaturityFramework): MaturityFrameworkLike => ({ id: f.id, name: f.name, scale_min: Number(f.scale_min), scale_max: Number(f.scale_max), weighted: f.weighted, dimensions: Array.isArray(f.dimensions) ? f.dimensions : [] });

export function MaturityTab({ programs, initialProgram }: { programs: ProgramLite[]; initialProgram: string | null }) {
  const { tr, pick, fmtNumber, enumLabel, L } = useI18n();
  const { org, can } = useOrg();
  const [fwId, setFwId] = useState('');
  const [programId, setProgramId] = useState(initialProgram ?? '');
  const [edit, setEdit] = useState<EditState | null>(null);
  const [from, setFrom] = useState('T0');
  const [to, setTo] = useState('T1');

  const frameworks = useAsync(async () => {
    const [own, central] = await Promise.all([
      all<MaturityFramework>('maturity_frameworks', { filters: [['organization_id', 'eq', org.id]], order: [{ column: 'code', ascending: true }, { column: 'version', ascending: false }] }),
      all<MaturityFramework>('maturity_frameworks', { filters: [['organization_id', 'is', null], ['status', 'eq', 'active']], order: { column: 'code', ascending: true } }),
    ]);
    return { own, central };
  }, [org.id]);
  const fw = frameworks.data?.own.find((f) => f.id === fwId) ?? null;
  const program = programs.find((p) => p.id === programId) ?? null;

  const copy = useAction(async (f: MaturityFramework) => rpc<string>('copy_central_template', { p_kind: 'maturity_framework', p_id: f.id, p_org: org.id }), {
    success: ['تم نسخ الإطار إلى المؤسسة', 'Framework copied into the organization'],
    onDone: (id) => { void frameworks.reload().then(() => { if (id) setFwId(id); }); },
  });

  const matrix = useAsync(async () => {
    if (!fwId || !programId) return null;
    const [rows, enrollments, teams] = await Promise.all([
      all<MaturityAssessment>('maturity_assessments', { filters: [['organization_id', 'eq', org.id], ['framework_id', 'eq', fwId], ['program_id', 'eq', programId]], order: { column: 'assessed_at', ascending: true } }),
      all<ProgramEnrollment>('program_enrollments', { filters: [['organization_id', 'eq', org.id], ['program_id', 'eq', programId]], order: { column: 'enrolled_at', ascending: true } }).catch(() => [] as ProgramEnrollment[]),
      all<{ id: string; name: string; code: string; cohort_id: string | null }>('program_teams', { select: 'id,name,code,cohort_id', filters: [['program_id', 'eq', programId]], order: { column: 'name', ascending: true } }).catch(() => []),
    ]);
    const benIds = [...new Set([...enrollments.map((e) => e.beneficiary_id), ...rows.map((r) => r.beneficiary_id).filter((x): x is string => !!x)])];
    const names = await nameMap('beneficiaries', benIds);
    const subjects: Subject[] = benIds.map((id) => {
      const en = enrollments.find((e) => e.beneficiary_id === id);
      return { key: id, kind: 'beneficiary', id, name: names[id] ?? id.slice(0, 8), cohort_id: en?.cohort_id ?? null, status: en?.status };
    });
    const teamIds = new Set(rows.map((r) => r.team_id).filter(Boolean));
    for (const t of teams) if (teamIds.has(t.id)) subjects.push({ key: t.id, kind: 'team', id: t.id, name: `${t.name} · ${t.code}`, cohort_id: t.cohort_id });
    subjects.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    return { rows: rows.map((r) => ({ ...r, overall_score: num(r.overall_score) })), subjects, teams };
  }, [fwId, programId, org.id]);

  const due = useMemo(() => duePoints(program?.end_date ?? null), [program?.end_date]);
  const cell = (s: Subject, p: string) => matrix.data?.rows.find((r) => (s.kind === 'beneficiary' ? r.beneficiary_id === s.id : r.team_id === s.id) && r.measurement_point === p) ?? null;
  const comparison = useMemo(() => (fw && matrix.data ? compareMaturity(fwLike(fw), matrix.data.rows, from, to) : null), [fw, matrix.data, from, to]);
  const subjectName = (key: string) => matrix.data?.subjects.find((s) => s.key === key)?.name ?? key.slice(0, 8);
  const canRecord = can('assessments.create');
  const canEdit = can('assessments.edit');

  const centralCols: Column<MaturityFramework>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), render: (f) => <span className="mono">{f.code}</span> },
    { key: 'name', header: tr('الإطار', 'Framework'), value: (f) => pick(f.name, f.name_en) },
    { key: 'track', header: tr('المسار', 'Track'), value: (f) => (f.track_code ? enumLabel('track', f.track_code) : '—') },
    { key: 'dims', header: tr('الأبعاد', 'Dimensions'), value: (f) => (Array.isArray(f.dimensions) ? f.dimensions.length : 0), align: 'end' },
    { key: 'act', header: '', hideInExport: true, render: (f) => {
      const has = frameworks.data?.own.some((o) => o.code === f.code);
      return (
        <div className="row" style={{ gap: 6 }}>
          {has && <Badge tone="success">{tr('مستخدم', 'In use')}</Badge>}
          {can('assessments.create') && <Button size="sm" icon={<Copy />} loading={copy.busy} onClick={() => void copy.run(f)}>{has ? tr('نسخ إصدار جديد', 'Copy new version') : tr('استخدام في المؤسسة', 'Use in organization')}</Button>}
        </div>
      );
    } },
  ];

  return (
    <div className="stack">
      <Card>
        <CardHeader icon={<Grid3x3 size={16} />} title={tr('مصفوفة قياس النضج', 'Maturity measurement matrix')}
          actions={<div className="row wrap">
            <Select value={fwId} onChange={(e) => { setFwId(e.target.value); const f = frameworks.data?.own.find((x) => x.id === e.target.value); if (f?.program_id) setProgramId(f.program_id); }}
              placeholder={tr('— إطار النضج —', '— Maturity framework —')}
              options={(frameworks.data?.own ?? []).filter((f) => f.status !== 'archived').map((f) => ({ value: f.id, label: `${pick(f.name, f.name_en)} · v${f.version}${f.status === 'draft' ? ` (${tr('مسودة', 'draft')})` : ''}` }))} />
            <Select value={programId} onChange={(e) => setProgramId(e.target.value)} placeholder={tr('— البرنامج —', '— Program —')} options={programs.map((p) => ({ value: p.id, label: pick(p.name, p.name_en) }))} />
            {canRecord && fw && program && <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setEdit({ subject: null, point: due[due.length - 1] ?? 'T0', existing: null })}>{tr('تسجيل تقييم', 'Record assessment')}</Button>}
          </div>} />
        <CardBody>
          {frameworks.data && !frameworks.data.own.length && <Notice tone="info">{tr('لا توجد أطر نضج في مؤسستك بعد؛ انسخ إطارًا من المكتبة المركزية أدناه.', 'Your organization has no maturity frameworks yet; copy one from the central library below.')}</Notice>}
          {!fwId || !programId ? <EmptyState compact title={tr('اختر إطار النضج والبرنامج', 'Choose a maturity framework and a program')} /> : (
            <AsyncView state={matrix}>{(m) => !m || !fw ? null : (
              <div className="stack-sm">
                {fw.track_code && program && fw.track_code !== program.track_code && <Notice tone="warning">{tr(`الإطار مصمم لمسار «${enumLabel('track', fw.track_code)}» بينما البرنامج من مسار «${enumLabel('track', program.track_code)}».`, `The framework targets the “${enumLabel('track', fw.track_code)}” track while the program is “${enumLabel('track', program.track_code)}”.`)}</Notice>}
                <div className="row wrap small">
                  <span className="muted">{tr('نقاط القياس المستحقة', 'Due measurement points')}:</span>
                  {due.map((p) => <Badge key={p} tone="primary">{p}</Badge>)}
                  {!program?.end_date && <span className="tiny muted">{tr('(لم يُحدد تاريخ نهاية البرنامج؛ T0 فقط مستحقة)', '(no program end date; only T0 is due)')}</span>}
                </div>
                <div className="grid g6">
                  {MEASUREMENT_KEYS.map((p) => {
                    const n = m.rows.filter((r) => r.measurement_point === p).length;
                    const isDue = due.includes(p);
                    const pct = m.subjects.length ? Math.round((n / m.subjects.length) * 100) : 0;
                    return <Kpi key={p} label={enumLabel('measurementPoint', p)} value={`${n}/${m.subjects.length}`} hint={isDue ? `${pct}%` : tr('غير مستحقة بعد', 'not yet due')} tone={isDue && pct < 80 ? 'warning' : undefined} />;
                  })}
                </div>
                {!m.subjects.length ? <EmptyState compact title={tr('لا يوجد مستفيدون ملتحقون بالبرنامج', 'No beneficiaries are enrolled in the program')} /> : (
                  <div className="table-wrap" style={{ maxHeight: 480, overflowY: 'auto' }}>
                    <table className="table">
                      <thead><tr><th>{tr('المُقيَّم', 'Subject')}</th>{MEASUREMENT_KEYS.map((p) => <th key={p} className="num">{p}{due.includes(p) && <span className="dot primary" style={{ marginInlineStart: 4 }} />}</th>)}</tr></thead>
                      <tbody>{m.subjects.map((s) => (
                        <tr key={s.key}>
                          <td className="small">{s.name}{s.kind === 'team' && <Badge tone="outline">{tr('فريق', 'Team')}</Badge>}{s.status && ['withdrawn', 'dropped'].includes(s.status) && <Badge tone="danger">{enumLabel('enrollmentStatus', s.status)}</Badge>}</td>
                          {MEASUREMENT_KEYS.map((p) => {
                            const a = cell(s, p);
                            const isDue = due.includes(p);
                            const clickable = a ? canEdit : canRecord;
                            const bg = a ? undefined : isDue ? 'var(--warning-soft)' : undefined;
                            return (
                              <td key={p} className="num" style={{ background: bg }}>
                                {clickable ? (
                                  <button type="button" className="link-btn" onClick={() => setEdit({ subject: s, point: p, existing: a })} title={a ? tr('تعديل', 'Edit') : tr('تسجيل', 'Record')}>
                                    {a ? <span className="mono">{fmtNumber(a.overall_score, 2)}</span> : isDue ? <span className="tiny" style={{ color: 'var(--warning)' }}>{tr('ناقص', 'missing')}</span> : <span className="muted">+</span>}
                                  </button>
                                ) : a ? <span className="mono">{fmtNumber(a.overall_score, 2)}</span> : isDue ? <span className="tiny" style={{ color: 'var(--warning)' }}>{tr('ناقص', 'missing')}</span> : <span className="muted">—</span>}
                                {a && a.data_quality !== 'assessor_rated' && <div className="tiny muted">{enumLabel('dataQuality', a.data_quality)}</div>}
                              </td>
                            );
                          })}
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
                <span className="tiny muted">{tr('الخلايا المظللة: نقطة قياس مستحقة دون تقييم.', 'Shaded cells: a due measurement point without an assessment.')}</span>
              </div>
            )}</AsyncView>
          )}
        </CardBody>
      </Card>

      {fw && comparison && matrix.data && (
        <Card>
          <CardHeader icon={<LineChart size={16} />} title={tr('مقارنة قبل / بعد', 'Before / after comparison')}
            actions={<div className="row">
              <Select value={from} onChange={(e) => setFrom(e.target.value)} options={MEASUREMENT_KEYS.map((p) => ({ value: p, label: `${tr('من', 'From')} ${p}` }))} />
              <Select value={to} onChange={(e) => setTo(e.target.value)} options={MEASUREMENT_KEYS.map((p) => ({ value: p, label: `${tr('إلى', 'To')} ${p}` }))} />
            </div>} />
          <CardBody>
            {from === to ? <Notice tone="warning">{tr('اختر نقطتي قياس مختلفتين.', 'Choose two different measurement points.')}</Notice> : (
              <div className="stack">
                <div className="grid g6">
                  <Kpi label={tr('قبل', 'Before')} value={fmtNumber(comparison.overall_before, 2)} hint={`${from} · n=${comparison.subjects_before}`} />
                  <Kpi label={tr('بعد', 'After')} value={fmtNumber(comparison.overall_after, 2)} hint={`${to} · n=${comparison.subjects_after}`} />
                  <Kpi label={tr('التغير', 'Change')} value={comparison.overall_change === null ? '—' : `${comparison.overall_change > 0 ? '+' : ''}${fmtNumber(comparison.overall_change, 2)}`}
                    tone={comparison.overall_change === null ? undefined : comparison.overall_change > 0 ? 'success' : comparison.overall_change < 0 ? 'danger' : undefined} />
                  <Kpi label={tr('حجم الأثر (d)', 'Effect size (d)')} value={comparison.effect_size ?? '—'} hint={tr('كوهين المقترن', 'paired Cohen’s d')} />
                  <Kpi label={tr('أزواج مقترنة', 'Paired n')} value={comparison.paired} hint={comparison.missing_follow_up ? tr(`${comparison.missing_follow_up} دون متابعة`, `${comparison.missing_follow_up} without follow-up`) : undefined} />
                  <Kpi label={tr('الثقة', 'Confidence')} value={comparison.confidence === 'moderate' ? tr('متوسطة', 'Moderate') : comparison.confidence === 'indicative' ? tr('مؤشرة', 'Indicative') : tr('غير كافية', 'Insufficient')}
                    tone={comparison.confidence === 'insufficient' ? 'danger' : comparison.confidence === 'indicative' ? 'warning' : 'success'} />
                </div>
                <Notice tone="info">{tr('التغير المعروض تغير مُلاحظ بين نقطتي قياس، وليس دليلًا سببيًا على أن البرنامج أحدثه؛ إثبات الإسناد يتطلب مجموعة مقارنة أو تصميمًا تقييميًا أقوى.', 'The change shown is observed between two measurement points, not causal proof that the program produced it; attribution requires a comparison group or a stronger evaluation design.')}</Notice>
                <div className="grid g2">
                  <div className="stack-sm">
                    <b className="small">{tr('متوسط الأبعاد (أزواج مقترنة)', 'Dimension means (paired)')}</b>
                    <ColumnChart categories={comparison.dimensions.map((d) => L(d.name))} max={Number(fw.scale_max)}
                      series={[{ name: from, values: comparison.dimensions.map((d) => d.before), color: '#8CBFBA' }, { name: to, values: comparison.dimensions.map((d) => d.after), color: '#287D78' }]} />
                  </div>
                  <div className="stack">
                    {comparison.distribution.map((d) => (
                      <div key={d.point} className="stack-sm"><b className="small">{tr('توزيع المستويات', 'Level distribution')} · {d.point}</b>
                        <Distribution levels={d.levels} total={Object.values(d.levels).reduce((a, b) => a + b, 0)} /></div>
                    ))}
                    <div className="stack-sm">
                      <b className="small">{tr('اتجاه التغير لكل مُقيَّم', 'Direction of change per subject')}</b>
                      <BarList items={[{ label: tr('تحسّن', 'Improved'), value: comparison.improved, tone: 'success' }, { label: tr('دون تغير', 'Unchanged'), value: comparison.unchanged }, { label: tr('تراجع', 'Declined'), value: comparison.declined, tone: 'danger' }]} />
                    </div>
                    <div className="small">
                      {tr('جودة البيانات', 'Data quality')}: {tr('متحقق', 'verified')} {comparison.data_quality.verified_share === null ? '—' : `${Math.round(comparison.data_quality.verified_share * 100)}%`} · {tr('ذاتي', 'self-reported')} {comparison.data_quality.self_reported_share === null ? '—' : `${Math.round(comparison.data_quality.self_reported_share * 100)}%`}
                    </div>
                  </div>
                </div>
                <ul className="small" style={{ margin: 0, paddingInlineStart: 18 }}>{comparison.interpretation.map((x, i) => <li key={i}>{L(x)}</li>)}</ul>
                <details>
                  <summary className="small strong">{tr('التفاصيل لكل مُقيَّم', 'Per-subject drill-down')} ({comparison.per_subject.length})</summary>
                  <DataTable rows={comparison.per_subject} rowKey={(r) => r.subject_id} pageSize={20} exportName={`maturity-${from}-${to}`}
                    columns={[
                      { key: 'name', header: tr('المُقيَّم', 'Subject'), value: (r) => subjectName(r.subject_id) },
                      { key: 'before', header: from, align: 'end', value: (r) => r.before, sortable: true },
                      { key: 'after', header: to, align: 'end', value: (r) => r.after, sortable: true },
                      { key: 'change', header: tr('التغير', 'Change'), align: 'end', value: (r) => r.change, sortable: true,
                        render: (r) => (r.change === null ? <span className="muted">—</span> : <b style={{ color: r.change >= 0.25 ? 'var(--success)' : r.change <= -0.25 ? 'var(--danger)' : undefined }}>{r.change > 0 ? '+' : ''}{fmtNumber(r.change, 2)}</b>) },
                    ]} />
                </details>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title={tr('مكتبة أطر النضج المركزية', 'Central maturity framework library')} />
        <CardBody flush>
          <DataTable columns={centralCols} rows={frameworks.data?.central ?? []} rowKey={(f) => f.id} loading={frameworks.loading} error={frameworks.error} onRetry={frameworks.reload}
            empty={{ title: tr('لا توجد أطر مركزية', 'No central frameworks') }} />
        </CardBody>
      </Card>

      {edit && fw && program && matrix.data && (
        <MaturityModal fw={fw} program={program} state={edit} subjects={matrix.data.subjects} teams={matrix.data.teams}
          onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void matrix.reload(); }} />
      )}
    </div>
  );
}

function MaturityModal({ fw, program, state, subjects, teams, onClose, onSaved }: {
  fw: MaturityFramework; program: ProgramLite; state: EditState; subjects: Subject[]; teams: { id: string; name: string; code: string; cohort_id: string | null }[];
  onClose: () => void; onSaved: () => void;
}) {
  const { tr, pick, enumOptions, locale, fmtNumber } = useI18n();
  const { org } = useOrg();
  const [kind, setKind] = useState<'beneficiary' | 'team'>(state.subject?.kind ?? 'beneficiary');
  const [subjectId, setSubjectId] = useState<string | null>(state.subject?.id ?? null);
  const [point, setPoint] = useState(state.point);
  const [scores, setScores] = useState<Record<string, number>>(() => Object.fromEntries(Object.entries(state.existing?.dimension_scores ?? {}).map(([k, v]) => [k, Number(v)])));
  const [quality, setQuality] = useState<string>(state.existing?.data_quality ?? 'assessor_rated');
  const [notes, setNotes] = useState(state.existing?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<AppError | null>(null);
  const dims = Array.isArray(fw.dimensions) ? fw.dimensions : [];
  const levels: number[] = [];
  for (let i = Math.ceil(Number(fw.scale_min)); i <= Math.floor(Number(fw.scale_max)); i++) levels.push(i);
  const overall = maturityOverall(fwLike(fw), scores);
  const descriptor = (d: (typeof dims)[number], lv: number): string => {
    const x = d.levels?.[String(lv)];
    if (x) return locale === 'ar' ? x.ar || x.en : x.en || x.ar;
    const g = MATURITY_LEVELS.find((m) => m.level === lv);
    return g ? (locale === 'ar' ? g.ar : g.en) : '';
  };
  const missing = dims.filter((d) => scores[d.key] === undefined);

  const save = async () => {
    if (!subjectId) { setErr({ code: 'x', message_ar: 'اختر المُقيَّم', message_en: 'Choose the subject' }); return; }
    if (!Object.keys(scores).length) { setErr({ code: 'x', message_ar: 'أدخل درجة بعد واحد على الأقل', message_en: 'Enter at least one dimension score' }); return; }
    setBusy(true); setErr(null);
    try {
      const patch = { dimension_scores: scores, data_quality: quality, notes: notes.trim() || null };
      if (state.existing) await update('maturity_assessments', state.existing.id, patch);
      else {
        const subj = subjects.find((s) => s.id === subjectId);
        const cohort = kind === 'team' ? teams.find((t) => t.id === subjectId)?.cohort_id ?? null : subj?.cohort_id ?? null;
        await insert('maturity_assessments', {
          ...patch, organization_id: org.id, framework_id: fw.id, program_id: program.id, measurement_point: point, cohort_id: cohort,
          [kind === 'team' ? 'team_id' : 'beneficiary_id']: subjectId,
        });
      }
      onSaved();
    } catch (e) { setErr(errorOf(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open size="wide" onClose={onClose} title={state.existing ? tr('تعديل تقييم النضج', 'Edit maturity assessment') : tr('تسجيل تقييم نضج', 'Record maturity assessment')}
      footer={<><Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} onClick={save}>{tr('حفظ', 'Save')}</Button></>}>
      <div className="stack">
        {err && <Notice tone="danger">{locale === 'ar' ? err.message_ar : err.message_en}</Notice>}
        <div className="form-grid">
          {state.subject ? (
            <Field label={tr('المُقيَّم', 'Subject')}><div className="small strong">{state.subject.name}</div></Field>
          ) : (
            <>
              <Field label={tr('نوع المُقيَّم', 'Subject type')}>
                <Select value={kind} onChange={(e) => { setKind(e.target.value as 'beneficiary' | 'team'); setSubjectId(null); }} options={[{ value: 'beneficiary', label: tr('مستفيد', 'Beneficiary') }, { value: 'team', label: tr('فريق', 'Team') }]} />
              </Field>
              <Field label={tr('المُقيَّم', 'Subject')} required>
                {kind === 'beneficiary'
                  ? <Select value={subjectId ?? ''} onChange={(e) => setSubjectId(e.target.value || null)} placeholder={tr('— اختر من الملتحقين —', '— Choose an enrolled beneficiary —')} options={subjects.filter((s) => s.kind === 'beneficiary').map((s) => ({ value: s.id, label: s.name }))} />
                  : <EntityPicker kind="program_teams" organizationId={org.id} value={subjectId} onChange={(id) => setSubjectId(id)} filters={[['program_id', 'eq', program.id]]} />}
              </Field>
            </>
          )}
          <Field label={tr('نقطة القياس', 'Measurement point')} required>
            <Select value={point} disabled={!!state.existing} onChange={(e) => setPoint(e.target.value)} options={enumOptions('measurementPoint').filter((o) => o.value !== 'other')} />
          </Field>
          <Field label={tr('جودة البيانات', 'Data quality')} required hint={tr('التقييم الذاتي أضعف دلالة من تقييم المقيّم أو المتحقق منه', 'Self-reports carry less weight than assessor-rated or verified data')}>
            <Select value={quality} onChange={(e) => setQuality(e.target.value)} options={enumOptions('dataQuality').filter((o) => ['self_reported', 'assessor_rated', 'verified'].includes(o.value))} />
          </Field>
        </div>
        <div className="stack-sm">
          {dims.map((d) => (
            <Field key={d.key} label={`${pick(d.name_ar, d.name_en)}${fw.weighted ? ` · w=${d.weight ?? 1}` : ''}`}>
              <Select value={scores[d.key] === undefined ? '' : String(scores[d.key])} placeholder={tr('— غير مقيّم —', '— Not rated —')}
                onChange={(e) => setScores((s) => { const n = { ...s }; if (e.target.value === '') delete n[d.key]; else n[d.key] = Number(e.target.value); return n; })}
                options={levels.map((lv) => ({ value: String(lv), label: `${lv} · ${descriptor(d, lv)}` }))} />
            </Field>
          ))}
        </div>
        <div className="row between">
          <span className="small">{tr('الدرجة الكلية (معاينة)', 'Overall (preview)')}: <b className="mono">{fmtNumber(overall.score, 2)}</b> · {tr('المستوى', 'Level')} <b>{overall.level ?? '—'}</b></span>
          {missing.length > 0 && <span className="tiny" style={{ color: 'var(--warning)' }}>{tr(`${missing.length} بعد دون درجة`, `${missing.length} dimension(s) unrated`)}</span>}
        </div>
        <Field label={tr('ملاحظات / مبررات التقدير', 'Notes / rating rationale')}><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
