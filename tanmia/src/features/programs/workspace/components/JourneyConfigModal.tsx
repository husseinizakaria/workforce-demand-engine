// Configure this program's journey (program_stages only). The central track
// template is never modified.
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import { RECORD_TYPES } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { Badge, Button, Checkbox, Field, Input, Modal, MultiCheck, Notice, Select, Textarea } from '@/components/ui';
import { insert, remove, update } from '@/services/db';
import { errorOf, type AppError } from '@/services/errors';
import type { ProgramStage } from '@/types/db';
import { errText } from '../../lib';
import { useWorkspace } from '../context';

interface Draft {
  id: string | null; stage_key: string; name_ar: string; name_en: string; description: string; requires_approval: boolean;
  required_evidence: string[]; depends_on: string[]; record_types: string[]; original?: ProgramStage; removed?: boolean;
}

const KEY_RE = /^[a-z][a-z0-9_]{1,40}$/;

export function JourneyConfigModal({ onClose }: { onClose: () => void }) {
  const { tr, pick, enumOptions, locale, L } = useI18n();
  const { org } = useOrg();
  const ws = useWorkspace();
  const templateKeys = useMemo(() => new Set(ws.track?.stages.map((s) => s.key) ?? []), [ws.track]);
  const [drafts, setDrafts] = useState<Draft[]>(() => ws.bundle.stages.map((s) => ({
    id: s.id, stage_key: s.stage_key, name_ar: s.name_ar, name_en: s.name_en ?? '', description: s.description ?? '', requires_approval: s.requires_approval,
    required_evidence: [...s.required_evidence], depends_on: [...s.depends_on], record_types: [...s.record_types], original: s,
  })));
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState({ stage_key: '', name_ar: '', name_en: '' });
  const [addErr, setAddErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const live = drafts.filter((d) => !d.removed);
  const patch = (key: string, p: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.stage_key === key ? { ...d, ...p } : d)));
  const move = (key: string, dir: -1 | 1) => setDrafts((ds) => {
    const vis = ds.filter((d) => !d.removed); const i = vis.findIndex((d) => d.stage_key === key); const j = i + dir;
    if (i < 0 || j < 0 || j >= vis.length) return ds;
    const next = [...vis]; [next[i], next[j]] = [next[j], next[i]];
    return [...next, ...ds.filter((d) => d.removed)];
  });

  const issues = useMemo(() => {
    const out: string[] = [];
    live.forEach((d, idx) => {
      if (!d.name_ar.trim()) out.push(tr(`المرحلة ${d.stage_key}: الاسم العربي مطلوب`, `Stage ${d.stage_key}: Arabic name is required`));
      for (const dep of d.depends_on) {
        const j = live.findIndex((x) => x.stage_key === dep);
        if (j < 0) out.push(tr(`«${d.name_ar}» تعتمد على مرحلة محذوفة (${dep})`, `“${d.name_en || d.name_ar}” depends on a removed stage (${dep})`));
        else if (j >= idx) out.push(tr(`«${d.name_ar}» تعتمد على مرحلة لاحقة لها في الترتيب (${live[j].name_ar}) — قد يسبب ذلك دورة أو قفلًا دائمًا`, `“${d.name_en || d.name_ar}” depends on a later stage (${live[j].name_en || live[j].name_ar}) — this may cause a cycle or a permanent lock`));
      }
    });
    return out;
  }, [live, tr]);

  const addStage = () => {
    const key = adding.stage_key.trim();
    if (!KEY_RE.test(key)) { setAddErr(tr('المفتاح: أحرف إنجليزية صغيرة وأرقام و _ ويبدأ بحرف', 'Key: lowercase letters, digits and _, starting with a letter')); return; }
    if (drafts.some((d) => d.stage_key === key && !d.removed)) { setAddErr(tr('المفتاح مستخدم', 'Key already used')); return; }
    if (!adding.name_ar.trim()) { setAddErr(tr('الاسم العربي مطلوب', 'Arabic name is required')); return; }
    const last = live[live.length - 1];
    setDrafts((ds) => [...ds.filter((d) => d.stage_key !== key), { id: null, stage_key: key, name_ar: adding.name_ar.trim(), name_en: adding.name_en.trim(), description: '',
      requires_approval: false, required_evidence: [], depends_on: last ? [last.stage_key] : [], record_types: [] }]);
    setAdding({ stage_key: '', name_ar: '', name_en: '' }); setAddErr(null); setOpen(key);
  };

  const save = async () => {
    if (issues.length) return;
    setBusy(true); setError(null);
    try {
      for (const d of drafts.filter((x) => x.removed && x.id)) await remove('program_stages', d.id!);
      for (const [i, d] of live.entries()) {
        const order = i + 1;
        const o = d.original;
        const approval_status = d.requires_approval
          ? (o && o.requires_approval ? o.approval_status : 'not_requested')
          : (o && o.approval_status === 'pending' ? 'pending' : 'not_required');
        const row = {
          name_ar: d.name_ar.trim(), name_en: d.name_en.trim() || null, description: d.description.trim() || null, stage_order: order,
          requires_approval: d.requires_approval, approval_status, required_evidence: d.required_evidence, depends_on: d.depends_on, record_types: d.record_types,
        };
        if (!d.id) {
          await insert<ProgramStage>('program_stages', { ...row, organization_id: org.id, program_id: ws.programId, stage_key: d.stage_key });
        } else if (o) {
          const changed = o.name_ar !== row.name_ar || (o.name_en ?? null) !== row.name_en || (o.description ?? null) !== row.description || o.stage_order !== order
            || o.requires_approval !== row.requires_approval || o.approval_status !== approval_status
            || JSON.stringify(o.required_evidence) !== JSON.stringify(row.required_evidence) || JSON.stringify(o.depends_on) !== JSON.stringify(row.depends_on)
            || JSON.stringify(o.record_types) !== JSON.stringify(row.record_types);
          if (changed) await update<ProgramStage>('program_stages', d.id, row);
        }
      }
      await ws.reload();
      onClose();
    } catch (e) { setError(errorOf(e)); await ws.reload(); } finally { setBusy(false); }
  };

  const usage = (key: string) => ws.bundle.stageRecords.filter((r) => r.stage_key === key).length + ws.bundle.evidence.filter((e) => e.stage_key === key).length
    + ws.bundle.enrollments.filter((e) => e.current_stage_key === key).length;
  const rtOptions = Object.values(RECORD_TYPES).map((r) => ({ value: r.key, label: L({ ar: r.name_ar, en: r.name_en }) }));

  return (
    <Modal open size="wide" title={tr('تهيئة رحلة البرنامج', 'Configure program journey')} onClose={onClose}
      footer={<><Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} disabled={issues.length > 0} onClick={() => void save()}>{tr('حفظ الرحلة', 'Save journey')}</Button></>}>
      <Notice tone="info">
        {tr('التعديلات هنا تخص رحلة هذا البرنامج فقط (جدول مراحل البرنامج). قالب المسار المركزي لا يتغير ولا تتأثر البرامج الأخرى.',
          'Changes apply to this program’s journey only (its program stages). The central track template is unchanged and other programs are unaffected.')}
      </Notice>
      {error && <Notice tone="danger">{errText(locale, error)}</Notice>}
      {issues.length > 0 && <Notice tone="warning"><ul style={{ margin: 0, paddingInlineStart: 16 }}>{issues.map((x) => <li key={x}>{x}</li>)}</ul></Notice>}
      <div className="stack-sm">
        {live.map((d, i) => {
          const custom = !templateKeys.has(d.stage_key);
          const used = usage(d.stage_key);
          return (
            <div key={d.stage_key} className="card card-pad stack-sm">
              <div className="row between wrap">
                <div className="row wrap">
                  <Badge tone="outline">{i + 1}</Badge>
                  <b>{pick(d.name_ar, d.name_en)}</b>
                  <span className="mono tiny muted">{d.stage_key}</span>
                  {custom && <Badge tone="info">{tr('مرحلة مخصصة', 'Custom stage')}</Badge>}
                  {d.requires_approval && <Badge tone="warning">{tr('تتطلب اعتمادًا', 'Requires approval')}</Badge>}
                  {d.required_evidence.length > 0 && <Badge>{tr('أدلة', 'Evidence')}: {d.required_evidence.length}</Badge>}
                </div>
                <div className="row">
                  <Button size="sm" variant="ghost" iconOnly icon={<ArrowUp />} disabled={i === 0} aria-label={tr('أعلى', 'Up')} onClick={() => move(d.stage_key, -1)} />
                  <Button size="sm" variant="ghost" iconOnly icon={<ArrowDown />} disabled={i === live.length - 1} aria-label={tr('أسفل', 'Down')} onClick={() => move(d.stage_key, 1)} />
                  <Button size="sm" onClick={() => setOpen(open === d.stage_key ? null : d.stage_key)}>{open === d.stage_key ? tr('طي', 'Collapse') : tr('تعديل', 'Edit')}</Button>
                  {custom && (
                    <Button size="sm" variant="danger" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Remove')} disabled={used > 0}
                      title={used > 0 ? tr('مرتبطة بسجلات أو أدلة أو مستفيدين', 'Linked to records, evidence or beneficiaries') : undefined}
                      onClick={() => setDrafts((ds) => (d.id ? ds.map((x) => (x.stage_key === d.stage_key ? { ...x, removed: true } : x)) : ds.filter((x) => x.stage_key !== d.stage_key)))} />
                  )}
                </div>
              </div>
              {open === d.stage_key && (
                <div className="form-grid">
                  <Field label={tr('الاسم بالعربية', 'Arabic name')} required><Input value={d.name_ar} onChange={(e) => patch(d.stage_key, { name_ar: e.target.value })} /></Field>
                  <Field label={tr('الاسم بالإنجليزية', 'English name')}><Input value={d.name_en} onChange={(e) => patch(d.stage_key, { name_en: e.target.value })} /></Field>
                  <Field label={tr('الوصف', 'Description')} className="full"><Textarea value={d.description} onChange={(e) => patch(d.stage_key, { description: e.target.value })} /></Field>
                  <Field className="full">
                    <Checkbox checked={d.requires_approval} onChange={(v) => patch(d.stage_key, { requires_approval: v })}
                      label={tr('إكمال المرحلة يتطلب اعتمادًا (بوابة حوكمة)', 'Completing the stage requires approval (governance gate)')} />
                  </Field>
                  {d.original?.approval_status === 'pending' && !d.requires_approval && (
                    <Notice tone="warning">{tr('يوجد طلب اعتماد معلق؛ سيبقى معلقًا حتى يُقرر.', 'An approval request is pending; it stays pending until decided.')}</Notice>
                  )}
                  <Field label={tr('الأدلة المطلوبة للإكمال', 'Evidence required for completion')} className="full">
                    <MultiCheck options={enumOptions('evidenceType')} value={d.required_evidence} onChange={(v) => patch(d.stage_key, { required_evidence: v })} />
                  </Field>
                  <Field label={tr('تعتمد على', 'Depends on')} className="full" hint={tr('لا تبدأ المرحلة قبل اكتمال هذه المراحل أو تجاوزها', 'The stage cannot start before these are completed or skipped')}>
                    <MultiCheck options={live.filter((x) => x.stage_key !== d.stage_key).map((x) => ({ value: x.stage_key, label: pick(x.name_ar, x.name_en) }))}
                      value={d.depends_on} onChange={(v) => patch(d.stage_key, { depends_on: v })} />
                  </Field>
                  <Field label={tr('نماذج سجلات المرحلة', 'Stage record forms')} className="full">
                    <div className="row wrap">
                      {d.record_types.map((rt) => (
                        <span key={rt} className="tag">{rtOptions.find((o) => o.value === rt)?.label ?? rt}
                          <button type="button" aria-label={tr('إزالة', 'Remove')} onClick={() => patch(d.stage_key, { record_types: d.record_types.filter((x) => x !== rt) })}><X size={12} /></button>
                        </span>
                      ))}
                      <Select style={{ width: 240 }} value="" placeholder={tr('+ إضافة نموذج', '+ Add form')} aria-label={tr('إضافة نموذج', 'Add form')}
                        options={rtOptions.filter((o) => !d.record_types.includes(o.value))}
                        onChange={(e) => { if (e.target.value) patch(d.stage_key, { record_types: [...d.record_types, e.target.value] }); }} />
                    </div>
                  </Field>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="card card-pad stack-sm">
        <b className="small">{tr('إضافة مرحلة مخصصة', 'Add a custom stage')}</b>
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <Field label={tr('المفتاح', 'Key')}><Input dir="ltr" value={adding.stage_key} placeholder="site_visit" onChange={(e) => setAdding({ ...adding, stage_key: e.target.value.toLowerCase() })} /></Field>
          <Field label={tr('الاسم بالعربية', 'Arabic name')}><Input value={adding.name_ar} onChange={(e) => setAdding({ ...adding, name_ar: e.target.value })} /></Field>
          <Field label={tr('الاسم بالإنجليزية', 'English name')}><Input value={adding.name_en} onChange={(e) => setAdding({ ...adding, name_en: e.target.value })} /></Field>
          <Button icon={<Plus />} onClick={addStage}>{tr('إضافة', 'Add')}</Button>
        </div>
        {addErr && <span className="small" style={{ color: 'var(--danger)' }}>{addErr}</span>}
      </div>
    </Modal>
  );
}
