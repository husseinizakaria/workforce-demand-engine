// Visual journey + stage editor for a program track template.
import { ArrowDown, ArrowUp, FileCheck2, Link2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { RECORD_TYPES } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, MultiCheck, Textarea } from '@/components/ui';
import type { TrackStageTemplate } from '@/types/db';
import { cx } from '@/utils/cx';
import { newStage, type Problem } from './trackModel';
import { toKey } from './common';

export function TrackStagesEditor({ stages, onChange, selected, onSelect, problems }: {
  stages: TrackStageTemplate[]; onChange: (s: TrackStageTemplate[]) => void; selected: number; onSelect: (i: number) => void; problems: Problem[];
}) {
  const { tr, pick, enumOptions, enumLabel } = useI18n();
  const s = stages[selected];
  const set = (patch: Partial<TrackStageTemplate>) => onChange(stages.map((x, i) => (i === selected ? { ...x, ...patch } : x)));
  const rename = (oldKey: string, newKey: string) => onChange(stages.map((x, i) => ({
    ...(i === selected ? { ...x, key: newKey } : x),
    depends_on: x.depends_on.map((d) => (d === oldKey ? newKey : d)),
  })));
  const move = (d: -1 | 1) => {
    const j = selected + d; if (j < 0 || j >= stages.length) return;
    const n = [...stages]; [n[selected], n[j]] = [n[j], n[selected]]; onChange(n); onSelect(j);
  };
  const add = () => {
    const st = newStage(stages.map((x) => x.key));
    if (stages.length) st.depends_on = [stages[Math.min(selected, stages.length - 1)].key];
    const at = Math.min(selected + 1, stages.length);
    const n = [...stages]; n.splice(at, 0, st); onChange(n); onSelect(at);
  };
  const remove = () => {
    if (!s) return;
    const n = stages.filter((_, i) => i !== selected).map((x) => ({ ...x, depends_on: x.depends_on.filter((d) => d !== s.key) }));
    onChange(n); onSelect(Math.max(0, selected - 1));
  };
  const stageProblems = (k: string) => problems.filter((p) => p.stage === k && p.level === 'error').length;
  const recordOptions = Object.values(RECORD_TYPES).map((r) => ({ value: r.key, label: pick(r.name_ar, r.name_en) }));

  return (
    <Card>
      <CardHeader title={tr('رحلة المسار', 'Track journey')} hint={tr(`${stages.length} مراحل`, `${stages.length} stages`)}
        actions={<Button size="sm" icon={<Plus />} onClick={add}>{tr('إضافة مرحلة بعد المحددة', 'Add stage after selected')}</Button>} />
      <CardBody>
        <div className="journey" role="list">
          {stages.map((st, i) => (
            <div key={i} role="listitem" className={cx('j-stage', i === selected && 'selected', stageProblems(st.key) > 0 && 'blocked')} onClick={() => onSelect(i)}
              tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onSelect(i); }}>
              <div className="j-node"><span className="j-circle">{i + 1}</span>{i < stages.length - 1 && <span className="j-line" />}</div>
              <div className="j-card">
                <span className="j-name">{pick(st.name_ar, st.name_en) || <span className="muted">{tr('بلا اسم', 'Unnamed')}</span>}</span>
                <span className="tiny muted mono">{st.key}</span>
                <span className="j-flags">
                  {st.requires_approval && <Badge tone="warning" icon={<ShieldCheck />} title={tr('تتطلب اعتمادًا', 'Requires approval')}>{tr('اعتماد', 'Approval')}</Badge>}
                  {st.required_evidence.length > 0 && <Badge tone="info" icon={<FileCheck2 />} title={st.required_evidence.map((e) => enumLabel('evidenceType', e)).join('، ')}>{st.required_evidence.length}</Badge>}
                  {st.depends_on.length > 0 && <Badge icon={<Link2 />} title={st.depends_on.join(', ')}>{st.depends_on.length}</Badge>}
                  {stageProblems(st.key) > 0 && <Badge tone="danger">!</Badge>}
                </span>
              </div>
            </div>
          ))}
        </div>

        {s && (
          <div className="stack-sm" style={{ marginTop: 12 }}>
            <div className="row between">
              <b>{tr(`المرحلة ${selected + 1}`, `Stage ${selected + 1}`)}</b>
              <div className="row">
                <Button size="sm" variant="ghost" icon={<ArrowUp />} disabled={selected === 0} onClick={() => move(-1)}>{tr('تقديم', 'Move up')}</Button>
                <Button size="sm" variant="ghost" icon={<ArrowDown />} disabled={selected === stages.length - 1} onClick={() => move(1)}>{tr('تأخير', 'Move down')}</Button>
                <Button size="sm" variant="danger" icon={<Trash2 />} disabled={stages.length <= 1} onClick={remove}>{tr('حذف المرحلة', 'Remove stage')}</Button>
              </div>
            </div>
            <div className="form-grid">
              <Field label={tr('المفتاح', 'Key')} hint={tr('يُنسخ إلى البرامج الجديدة كـ stage_key؛ تغييره يحدّث الاعتماديات تلقائيًا', 'Copied to new programs as stage_key; renaming updates dependencies automatically')}>
                <Input dir="ltr" className="mono" value={s.key} onChange={(e) => rename(s.key, e.target.value)} onBlur={(e) => { const k = toKey(e.target.value); if (k && k !== s.key) rename(s.key, k); }} />
              </Field>
              <div className="stack-sm" style={{ alignContent: 'end' }}>
                <Checkbox label={tr('تتطلب اعتمادًا قبل الإكمال', 'Requires approval before completion')} checked={s.requires_approval} onChange={(c) => set({ requires_approval: c })} />
              </div>
              <Field label={tr('الاسم (عربي)', 'Name (Arabic)')} required><Input value={s.name_ar} onChange={(e) => set({ name_ar: e.target.value })} /></Field>
              <Field label={tr('الاسم (إنجليزي)', 'Name (English)')}><Input dir="ltr" value={s.name_en} onChange={(e) => set({ name_en: e.target.value })} /></Field>
              <Field label={tr('الوصف (عربي)', 'Description (Arabic)')}><Textarea rows={2} value={s.description_ar ?? ''} onChange={(e) => set({ description_ar: e.target.value })} /></Field>
              <Field label={tr('الوصف (إنجليزي)', 'Description (English)')}><Textarea rows={2} dir="ltr" value={s.description_en ?? ''} onChange={(e) => set({ description_en: e.target.value })} /></Field>
              <Field className="full" label={tr('تعتمد على (مراحل سابقة فقط)', 'Depends on (earlier stages only)')}>
                {selected === 0 ? <span className="small muted">{tr('المرحلة الأولى لا تعتمد على غيرها.', 'The first stage has no dependencies.')}</span> : (
                  <MultiCheck value={s.depends_on} onChange={(v) => set({ depends_on: v })}
                    options={stages.slice(0, selected).map((x, i) => ({ value: x.key, label: `${i + 1}. ${pick(x.name_ar, x.name_en) || x.key}` }))} />
                )}
                {s.depends_on.filter((d) => !stages.slice(0, selected).some((x) => x.key === d)).map((d) => <Badge key={d} tone="danger">{tr(`اعتماد غير صالح: ${d}`, `Invalid dependency: ${d}`)}</Badge>)}
              </Field>
              <Field className="full" label={tr('الأدلة المطلوبة لإكمال المرحلة', 'Evidence required to complete the stage')}>
                <MultiCheck options={enumOptions('evidenceType')} value={s.required_evidence} onChange={(v) => set({ required_evidence: v })} />
              </Field>
              <Field className="full" label={tr('أنواع السجلات في المرحلة', 'Record types in the stage')} hint={tr('نماذج تسجيل خاصة بالمرحلة (من محرك المسارات)', 'Stage-specific record forms (from the track engine)')}>
                <MultiCheck options={recordOptions} value={s.record_types} onChange={(v) => set({ record_types: v })} />
              </Field>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
