import { useEffect, useMemo, useState } from 'react';
import { History, RotateCcw, Route, Save } from 'lucide-react';
import { TRACK_BY_CODE } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { AsyncView, Badge, Button, Card, CardBody, CardHeader, Checkbox, EmptyState, Field, Input, Notice, PageHeader, Textarea, useConfirm } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { useAction } from '@/hooks/useAction';
import * as db from '@/services/db';
import type { ProgramTrackTemplate } from '@/types/db';
import { cx } from '@/utils/cx';
import { fromDraft, toDraft, validateTrack, type TrackDraft } from '../components/trackModel';
import { TrackStagesEditor } from '../components/TrackStagesEditor';
import { TrackExtrasEditor } from '../components/TrackExtrasEditor';

export default function ProgramTracksPage() {
  const { tr, pick, fmtDateTime, L } = useI18n();
  const confirm = useConfirm();
  const state = useAsync(() => db.all<ProgramTrackTemplate>('program_track_templates', { order: { column: 'code', ascending: true } }), []);
  const usage = useAsync(async () => {
    const rows = await db.all<{ track_code: string }>('programs', { select: 'track_code' });
    const m: Record<string, number> = {};
    for (const r of rows) m[r.track_code] = (m[r.track_code] ?? 0) + 1;
    return m;
  }, []);
  const [code, setCode] = useState<string | null>(null);
  const tpl = state.data?.find((t) => t.code === code) ?? null;
  const [draft, setDraft] = useState<TrackDraft | null>(null);
  const [sel, setSel] = useState(0);
  useEffect(() => { if (!code && state.data?.length) setCode(state.data[0].code); }, [state.data, code]);
  useEffect(() => { setDraft(tpl ? toDraft(tpl) : null); setSel(0); }, [tpl]);

  const problems = useMemo(() => (draft ? validateTrack(draft) : []), [draft]);
  const errors = problems.filter((p) => p.level === 'error');
  const dirty = !!tpl && !!draft && JSON.stringify(fromDraft(draft)) !== JSON.stringify(fromDraft(toDraft(tpl)));

  const save = useAction(async () => {
    if (!tpl || !draft) return;
    const updated = await db.update<ProgramTrackTemplate>('program_track_templates', tpl.id, { ...fromDraft(draft), version: tpl.version + 1 });
    state.setData((all) => (all ?? []).map((t) => (t.id === updated.id ? updated : t)));
  }, { success: ['حُفظ القالب وزاد رقم الإصدار', 'Template saved and version incremented'] });

  const ref = code ? TRACK_BY_CODE[code] : undefined;
  const confirmSave = async () => {
    if (!tpl) return;
    const ok = await confirm({
      title: tr('حفظ قالب المسار', 'Save track template'),
      message: <div className="stack-sm">
        <p>{tr(`سيُحفظ القالب كإصدار ${tpl.version + 1}.`, `The template will be saved as version ${tpl.version + 1}.`)}</p>
        <p className="small">{tr('البرامج الموجودة تحتفظ بنسختها الخاصة من الرحلة ولن تتغير؛ يُطبق الإصدار الجديد على البرامج التي تُنشأ بعد الحفظ فقط.', 'Existing programs keep their own copied journey and will not change; the new version applies only to programs created after saving.')}</p>
      </div>,
    });
    if (ok) await save.run();
  };

  return (
    <div className="stack">
      <PageHeader title={tr('مسارات البرامج', 'Program tracks')} crumbs={[{ label: tr('إدارة المنصة', 'Platform'), to: '/platform' }, { label: tr('مسارات البرامج', 'Program tracks') }]}
        subtitle={tr('القوالب الستة التي تُبنى عليها رحلات البرامج: المراحل والاعتماديات وبوابات الأدلة والاعتماد وأبعاد النضج والمؤشرات.', 'The six templates program journeys are built from: stages, dependencies, evidence and approval gates, maturity dimensions and indicators.')} />
      <Notice tone="info">{tr('عند إنشاء برنامج تُنسخ رحلة المسار إليه. تعديل القالب هنا لا يغير البرامج الموجودة — كل برنامج يحتفظ بنسخته.', 'When a program is created, the track journey is copied into it. Editing a template here never changes existing programs — each keeps its own copy.')}</Notice>
      <AsyncView state={state}>
        {(list) => !list.length ? <EmptyState title={tr('لا توجد قوالب مسارات', 'No track templates')} description={tr('طبّق ملف بيانات المرجع (reference_data) في قاعدة البيانات.', 'Apply the reference_data migration to the database.')} /> : (
          <div className="stack">
            <div className="grid g6">
              {list.map((t) => (
                <button key={t.id} type="button" className={cx('card card-pad')} onClick={() => setCode(t.code)} aria-pressed={t.code === code}
                  style={{ textAlign: 'start', cursor: 'pointer', borderColor: t.code === code ? 'var(--primary)' : undefined, background: t.code === code ? 'var(--primary-tint)' : undefined }}>
                  <div className="row between"><b className="small">{pick(t.name_ar, t.name_en)}</b><Badge tone="outline">v{t.version}</Badge></div>
                  <div className="tiny muted">{tr(`${t.stages.length} مراحل · ${usage.data?.[t.code] ?? 0} برنامج`, `${t.stages.length} stages · ${usage.data?.[t.code] ?? 0} programs`)}</div>
                  {!t.active && <Badge>{tr('غير نشط', 'Inactive')}</Badge>}
                </button>
              ))}
            </div>
            {tpl && draft && (
              <>
                <Card>
                  <CardHeader icon={<Route />} title={pick(tpl.name_ar, tpl.name_en)} hint={<><span className="mono">{tpl.code}</span> · {tr('آخر تحديث', 'updated')} {fmtDateTime(tpl.updated_at)}</>}
                    actions={<>
                      <Badge tone="primary" icon={<History size={12} />}>{tr(`الإصدار ${tpl.version}`, `Version ${tpl.version}`)}{dirty && ` → ${tpl.version + 1}`}</Badge>
                      {ref && <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={async () => {
                        if (await confirm({ title: tr('استعادة المرجع الافتراضي', 'Restore engine reference'), message: tr('ستُستبدل المسودة بتعريف المسار المرجعي في المحرك (لن يُحفظ قبل الضغط على حفظ).', 'The draft will be replaced by the engine’s reference definition (not saved until you click Save).') }))
                          setDraft({ ...draft, name_ar: ref.name_ar, name_en: ref.name_en, description_ar: ref.description_ar, description_en: ref.description_en,
                            stages: ref.stages.map((s, i) => ({ ...s, order: i + 1, required_evidence: [...s.required_evidence], depends_on: [...s.depends_on], record_types: [...s.record_types] })),
                            maturity_dimensions: ref.maturity_dimensions.map((d) => ({ ...d })), default_indicators: ref.default_indicators.map((x) => ({ ...x, measurement_points: [...x.measurement_points] })),
                            report_sections: [...ref.report_sections], session_types: [...ref.session_types] });
                      }}>{tr('المرجع الافتراضي', 'Engine reference')}</Button>}
                      <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => setDraft(toDraft(tpl))}>{tr('تجاهل التغييرات', 'Discard')}</Button>
                      <Button size="sm" variant="primary" icon={<Save />} disabled={!dirty || errors.length > 0} loading={save.busy} onClick={() => void confirmSave()}>{tr('حفظ', 'Save')}</Button>
                    </>} />
                  <CardBody>
                    <div className="form-grid">
                      <Field label={tr('الاسم (عربي)', 'Name (Arabic)')} required><Input value={draft.name_ar} onChange={(e) => setDraft({ ...draft, name_ar: e.target.value })} /></Field>
                      <Field label={tr('الاسم (إنجليزي)', 'Name (English)')} required><Input dir="ltr" value={draft.name_en} onChange={(e) => setDraft({ ...draft, name_en: e.target.value })} /></Field>
                      <Field label={tr('الوصف (عربي)', 'Description (Arabic)')}><Textarea rows={2} value={draft.description_ar} onChange={(e) => setDraft({ ...draft, description_ar: e.target.value })} /></Field>
                      <Field label={tr('الوصف (إنجليزي)', 'Description (English)')}><Textarea rows={2} dir="ltr" value={draft.description_en} onChange={(e) => setDraft({ ...draft, description_en: e.target.value })} /></Field>
                      <Checkbox label={tr('المسار نشط (متاح لإنشاء برامج جديدة)', 'Track active (available for new programs)')} checked={draft.active} onChange={(c) => setDraft({ ...draft, active: c })} />
                    </div>
                    {problems.length > 0 && (
                      <div className="stack-sm" style={{ marginTop: 10 }}>
                        {errors.length > 0 && <Notice tone="danger"><b>{tr('يجب إصلاح ما يلي قبل الحفظ:', 'Fix the following before saving:')}</b><ul style={{ margin: 0, paddingInlineStart: 16 }}>{errors.slice(0, 10).map((p, i) => <li key={i}>{L(p.text)}</li>)}</ul></Notice>}
                        {problems.some((p) => p.level === 'warning') && <Notice tone="warning"><ul style={{ margin: 0, paddingInlineStart: 16 }}>{problems.filter((p) => p.level === 'warning').slice(0, 8).map((p, i) => <li key={i}>{L(p.text)}</li>)}</ul></Notice>}
                      </div>
                    )}
                  </CardBody>
                </Card>
                <TrackStagesEditor stages={draft.stages} onChange={(stages) => setDraft({ ...draft, stages })} selected={Math.min(sel, Math.max(0, draft.stages.length - 1))} onSelect={setSel} problems={problems} />
                <TrackExtrasEditor draft={draft} onChange={(p) => setDraft({ ...draft, ...p })} />
              </>
            )}
          </div>
        )}
      </AsyncView>
    </div>
  );
}
