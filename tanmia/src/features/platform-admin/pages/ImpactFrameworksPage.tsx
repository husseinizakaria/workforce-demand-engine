import { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Sprout } from 'lucide-react';
import { TOC_KEYS, TRACKS, resultsChainCompleteness, type TocKey } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { AsyncView, Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Notice, PageHeader, Progress, Select, Textarea, scoreTone, toneOf } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { useAction } from '@/hooks/useAction';
import * as db from '@/services/db';
import type { ImpactFramework } from '@/types/db';
import { cx } from '@/utils/cx';
import { StringListEditor } from '../components/common';

type Draft = Pick<ImpactFramework, 'name' | 'track_code' | 'problem_statement' | 'target_population' | 'baseline_summary' | 'intended_impact' | 'evaluation_design' | 'attribution_approach' | 'status'>
  & { theory_of_change: Record<TocKey, string[]> };

const emptyToc = (): Record<TocKey, string[]> => Object.fromEntries(TOC_KEYS.map((k) => [k.key, []])) as unknown as Record<TocKey, string[]>;
const toDraft = (f: ImpactFramework): Draft => ({
  name: f.name, track_code: f.track_code, problem_statement: f.problem_statement ?? '', target_population: f.target_population ?? '', baseline_summary: f.baseline_summary ?? '',
  intended_impact: f.intended_impact ?? '', evaluation_design: f.evaluation_design, attribution_approach: f.attribution_approach, status: f.status,
  theory_of_change: { ...emptyToc(), ...Object.fromEntries(Object.entries(f.theory_of_change ?? {}).map(([k, v]) => [k, [...(v ?? [])]])) },
});
const newDraft = (track: string | null, name: string): Draft => ({
  name, track_code: track, problem_statement: '', target_population: '', baseline_summary: '', intended_impact: '', evaluation_design: 'pre_post',
  attribution_approach: 'contribution', status: 'draft', theory_of_change: emptyToc(),
});

export default function ImpactFrameworksPage() {
  const { tr, pick, enumLabel, enumOptions, L } = useI18n();
  const state = useAsync(() => db.all<ImpactFramework>('impact_frameworks', { filters: [['organization_id', 'is', null], ['program_id', 'is', null]], order: { column: 'created_at', ascending: true } }), []);
  const [selId, setSelId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<string>('');

  const selected = selId && selId !== 'new' ? state.data?.find((f) => f.id === selId) ?? null : null;
  useEffect(() => { if (selected) { const d = toDraft(selected); setDraft(d); setSaved(JSON.stringify(d)); } }, [selected]);
  useEffect(() => { if (!selId && state.data?.length) setSelId(state.data[0].id); }, [state.data, selId]);

  const save = useAction(async () => {
    if (!draft) return;
    const row = {
      ...draft, name: draft.name.trim(),
      problem_statement: draft.problem_statement?.trim() || null, target_population: draft.target_population?.trim() || null, baseline_summary: draft.baseline_summary?.trim() || null,
      intended_impact: draft.intended_impact?.trim() || null,
      theory_of_change: Object.fromEntries(Object.entries(draft.theory_of_change).map(([k, v]) => [k, v.map((x) => x.trim()).filter(Boolean)])),
    };
    if (selId === 'new') {
      const f = await db.insert<ImpactFramework>('impact_frameworks', { ...row, organization_id: null, program_id: null });
      await state.reload(); setSelId(f.id);
    } else if (selected) {
      const f = await db.update<ImpactFramework>('impact_frameworks', selected.id, { ...row, version: selected.version + (selected.status === 'approved' ? 1 : 0) });
      state.setData((all) => (all ?? []).map((x) => (x.id === f.id ? f : x)));
    }
  }, { success: ['حُفظ إطار الأثر', 'Impact framework saved'] });

  const completeness = useMemo(() => {
    if (!draft) return null;
    const c = resultsChainCompleteness({ id: '', ...draft }, []);
    const gaps = c.gaps.filter((g) => !g.key.startsWith('ind_'));
    const w = { high: 15, medium: 6, low: 2 };
    return { gaps, score: Math.max(0, 100 - gaps.reduce((a, g) => a + w[g.severity], 0)) };
  }, [draft]);

  const statusLabel = (s: string) => (s === 'approved' ? enumLabel('approvalStatus', s) : enumLabel('toolStatus', s));
  const designWarning = draft && draft.attribution_approach === 'attribution' && !['rct', 'quasi_experimental'].includes(draft.evaluation_design);
  const dirty = !!draft && (selId === 'new' || JSON.stringify(draft) !== saved);
  const setToc = (k: TocKey, v: string[]) => draft && setDraft({ ...draft, theory_of_change: { ...draft.theory_of_change, [k]: v } });
  const tocLabel = (k: TocKey) => { const x = TOC_KEYS.find((t) => t.key === k)!; return tr(x.ar, x.en); };
  const items = (k: TocKey) => (draft?.theory_of_change[k] ?? []).filter((x) => x.trim());

  return (
    <div className="stack">
      <PageHeader title={tr('أطر الأثر المركزية (نظرية التغيير)', 'Central impact frameworks (Theory of Change)')} crumbs={[{ label: tr('إدارة المنصة', 'Platform'), to: '/platform' }, { label: tr('أطر الأثر', 'Impact frameworks') }]}
        subtitle={tr('قالب نظرية تغيير لكل مسار يُقترح على البرامج الجديدة. لا يُدّعى الأثر السببي إلا بتصميم تقييم يدعمه.', 'A Theory of Change template per track, suggested to new programs. Causal impact is only claimed with an evaluation design that supports it.')} />
      <AsyncView state={state}>
        {(list) => (
          <div className="grid g-1-2" style={{ alignItems: 'start' }}>
            <Card>
              <CardHeader icon={<Sprout />} title={tr('المسارات', 'Tracks')} />
              <CardBody>
                <div className="stack-sm">
                  {[...TRACKS.map((t) => ({ code: t.code as string | null, name: pick(t.name_ar, t.name_en), raw: t })), { code: null, name: tr('عام (بلا مسار)', 'General (no track)'), raw: null }].map((t) => {
                    const fws = list.filter((f) => (f.track_code ?? null) === t.code);
                    return (
                      <div key={t.code ?? 'general'} className="stack-sm" style={{ gap: 4, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                        <div className="row between">
                          <b className="small">{t.name}</b>
                          <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => { setSelId('new'); setDraft(newDraft(t.code, t.raw ? tr(`نظرية التغيير — ${t.raw.name_ar}`, `Theory of Change — ${t.raw.name_en}`) : tr('نظرية تغيير عامة', 'General Theory of Change'))); setSaved(''); }}>{tr('جديد', 'New')}</Button>
                        </div>
                        {fws.length ? fws.map((f) => (
                          <button key={f.id} type="button" className={cx('row between')} onClick={() => setSelId(f.id)}
                            style={{ textAlign: 'start', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: f.id === selId ? 'var(--primary-tint)' : 'var(--card)', cursor: 'pointer' }}>
                            <span className="small grow ellipsis">{f.name}</span><Badge tone={toneOf(f.status)}>{statusLabel(f.status)}</Badge>
                          </button>
                        )) : t.code && <span className="tiny" style={{ color: 'var(--warning)' }}>{tr('لا يوجد قالب — البرامج ستبدأ بنظرية تغيير فارغة', 'No template — programs will start with an empty Theory of Change')}</span>}
                      </div>
                    );
                  })}
                </div>
              </CardBody>
            </Card>

            {!draft ? <Card><CardBody><EmptyState compact title={tr('اختر إطارًا أو أنشئ واحدًا لمسار', 'Select a framework or create one for a track')} /></CardBody></Card> : (
              <div className="stack">
                <Card>
                  <CardHeader title={selId === 'new' ? tr('إطار جديد', 'New framework') : draft.name}
                    hint={selected ? <><span className="mono">{selected.code}</span> v{selected.version}</> : undefined}
                    actions={<Button variant="primary" size="sm" icon={<Save />} loading={save.busy} disabled={!dirty || !draft.name.trim()} onClick={() => void save.run()}>{tr('حفظ', 'Save')}</Button>} />
                  <CardBody>
                    <div className="form-grid">
                      <Field label={tr('الاسم', 'Name')} required><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
                      <Field label={tr('المسار', 'Track')}>
                        <Select value={draft.track_code ?? ''} placeholder={tr('عام', 'General')} onChange={(e) => setDraft({ ...draft, track_code: e.target.value || null })} options={TRACKS.map((t) => ({ value: t.code, label: pick(t.name_ar, t.name_en) }))} />
                      </Field>
                      <Field className="full" label={tr('المشكلة الاجتماعية', 'Social problem')}><Textarea rows={2} value={draft.problem_statement ?? ''} onChange={(e) => setDraft({ ...draft, problem_statement: e.target.value })} /></Field>
                      <Field label={tr('الفئة المستهدفة', 'Target population')}><Textarea rows={2} value={draft.target_population ?? ''} onChange={(e) => setDraft({ ...draft, target_population: e.target.value })} /></Field>
                      <Field label={tr('وصف خط الأساس المتوقع', 'Expected baseline description')}><Textarea rows={2} value={draft.baseline_summary ?? ''} onChange={(e) => setDraft({ ...draft, baseline_summary: e.target.value })} /></Field>
                      <Field className="full" label={tr('الأثر المقصود', 'Intended impact')}><Textarea rows={2} value={draft.intended_impact ?? ''} onChange={(e) => setDraft({ ...draft, intended_impact: e.target.value })} /></Field>
                      <Field label={tr('تصميم التقييم', 'Evaluation design')}><Select value={draft.evaluation_design} options={enumOptions('evaluationDesign')} onChange={(e) => setDraft({ ...draft, evaluation_design: e.target.value as Draft['evaluation_design'] })} /></Field>
                      <Field label={tr('منهج الإسناد', 'Attribution approach')}><Select value={draft.attribution_approach} options={enumOptions('attribution')} onChange={(e) => setDraft({ ...draft, attribution_approach: e.target.value as Draft['attribution_approach'] })} /></Field>
                      <Field label={tr('الحالة', 'Status')}><Select value={draft.status} options={(['draft', 'approved', 'archived'] as const).map((s) => ({ value: s, label: statusLabel(s) }))} onChange={(e) => setDraft({ ...draft, status: e.target.value as Draft['status'] })} /></Field>
                    </div>
                    {designWarning && <div style={{ marginTop: 10 }}><Notice tone="warning">{tr(`الإسناد السببي يتطلب تصميمًا تجريبيًا أو شبه تجريبي؛ مع «${enumLabel('evaluationDesign', draft.evaluation_design)}» يمكن ادعاء التغير الملاحظ أو المساهمة فقط.`, `Causal attribution requires an experimental or quasi-experimental design; with “${enumLabel('evaluationDesign', draft.evaluation_design)}” only observed change or contribution can be claimed.`)}</Notice></div>}
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader title={tr('معاينة سلسلة النتائج', 'Results chain preview')} hint={completeness ? tr(`اكتمال ${completeness.score}%`, `${completeness.score}% complete`) : undefined} />
                  <CardBody>
                    {completeness && <div style={{ marginBottom: 10 }}><Progress value={completeness.score} tone={scoreTone(completeness.score)} label={tr('اكتمال نظرية التغيير', 'Theory of Change completeness')} /></div>}
                    <div className="chain">
                      {(['inputs', 'activities', 'outputs'] as TocKey[]).map((k) => (
                        <div key={k} className="chain-col"><h4>{tocLabel(k)}<span>{items(k).length}</span></h4>{items(k).map((x, i) => <span key={i} className="small">• {x}</span>)}{!items(k).length && <span className="tiny muted">—</span>}</div>
                      ))}
                      <div className="chain-col">
                        <h4>{tr('النتائج', 'Outcomes')}<span>{items('outcomes_short').length + items('outcomes_medium').length + items('outcomes_long').length}</span></h4>
                        {(['outcomes_short', 'outcomes_medium', 'outcomes_long'] as TocKey[]).map((k) => items(k).length > 0 && (
                          <div key={k} className="stack-sm" style={{ gap: 2 }}><span className="tiny muted strong">{tocLabel(k)}</span>{items(k).map((x, i) => <span key={i} className="small">• {x}</span>)}</div>
                        ))}
                      </div>
                      <div className="chain-col"><h4>{tocLabel('impact')}<span>{items('impact').length}</span></h4>{items('impact').map((x, i) => <span key={i} className="small">• {x}</span>)}</div>
                    </div>
                    <div className="grid g2" style={{ marginTop: 8 }}>
                      <div className="small"><b>{tocLabel('assumptions')}:</b> {items('assumptions').join(' · ') || '—'}</div>
                      <div className="small"><b>{tocLabel('external_factors')}:</b> {items('external_factors').join(' · ') || '—'}</div>
                    </div>
                    {completeness && completeness.gaps.length > 0 && (
                      <div className="row wrap" style={{ gap: 4, marginTop: 10 }}>
                        {completeness.gaps.map((g) => <Badge key={g.key} tone={g.severity === 'high' ? 'danger' : g.severity === 'medium' ? 'warning' : 'neutral'}>{L(g.label)}</Badge>)}
                      </div>
                    )}
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader title={tr('عناصر نظرية التغيير', 'Theory of Change elements')} />
                  <CardBody>
                    <div className="grid g2">
                      {TOC_KEYS.map((k) => (
                        <Field key={k.key} label={<>{tr(k.ar, k.en)}{k.required && <span className="req" aria-hidden>*</span>}</>}>
                          <StringListEditor value={draft.theory_of_change[k.key]} onChange={(v) => setToc(k.key, v)} />
                        </Field>
                      ))}
                    </div>
                  </CardBody>
                </Card>
              </div>
            )}
          </div>
        )}
      </AsyncView>
    </div>
  );
}
