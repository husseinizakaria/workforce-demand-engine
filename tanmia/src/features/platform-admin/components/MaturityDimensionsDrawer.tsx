// Dimension editor (key, names, weight, level descriptors) for a central maturity framework.
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Download, Plus, Save, Trash2, Wand2 } from 'lucide-react';
import { MATURITY_LEVELS, TRACK_BY_CODE, type MaturityDimension } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { Badge, Button, Card, CardBody, Drawer, EmptyState, Field, Input, Notice } from '@/components/ui';
import { useAction } from '@/hooks/useAction';
import * as db from '@/services/db';
import type { MaturityFramework } from '@/types/db';
import { KEY_PATTERN, duplicates } from './common';

export function levelRange(fw: Pick<MaturityFramework, 'scale_min' | 'scale_max'>): number[] {
  const lo = Math.ceil(Number(fw.scale_min)); const hi = Math.floor(Number(fw.scale_max));
  const out: number[] = [];
  for (let i = lo; i <= hi && out.length < 10; i++) out.push(i);
  return out;
}

export function dimensionProblems(dims: MaturityDimension[], weighted: boolean): { ar: string; en: string }[] {
  const out: { ar: string; en: string }[] = [];
  for (const k of duplicates(dims.map((d) => d.key))) out.push({ ar: `المفتاح «${k}» مكرر`, en: `Key “${k}” is duplicated` });
  dims.forEach((d, i) => {
    if (!KEY_PATTERN.test(d.key)) out.push({ ar: `البعد ${i + 1}: مفتاح غير صالح`, en: `Dimension ${i + 1}: invalid key` });
    if (!d.name_ar.trim()) out.push({ ar: `البعد ${i + 1}: الاسم العربي إلزامي`, en: `Dimension ${i + 1}: Arabic name required` });
    if (weighted && !(Number(d.weight) > 0)) out.push({ ar: `البعد ${i + 1}: الوزن يجب أن يكون أكبر من صفر`, en: `Dimension ${i + 1}: weight must be > 0` });
  });
  return out;
}

export function MaturityDimensionsDrawer({ fw, onClose, onSaved }: { fw: MaturityFramework | null; onClose: () => void; onSaved: () => void }) {
  const { tr, L, fmtNumber } = useI18n();
  const [dims, setDims] = useState<MaturityDimension[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setDims(structuredClone(fw?.dimensions ?? [])); setDirty(false); setOpen(null); }, [fw]);
  const save = useAction(async () => {
    if (!fw) return;
    await db.update('maturity_frameworks', fw.id, { dimensions: dims.map((d) => ({ ...d, weight: Number(d.weight ?? 1) })) });
    setDirty(false); onSaved();
  }, { success: ['حُفظت الأبعاد', 'Dimensions saved'] });
  if (!fw) return null;

  const levels = levelRange(fw);
  const problems = dimensionProblems(dims, fw.weighted);
  const totalW = dims.reduce((a, d) => a + (Number(d.weight) || 0), 0);
  const update = (next: MaturityDimension[]) => { setDims(next); setDirty(true); };
  const set = (i: number, p: Partial<MaturityDimension>) => update(dims.map((d, j) => (j === i ? { ...d, ...p } : d)));
  const setLevel = (i: number, lvl: number, lang: 'ar' | 'en', text: string) => {
    const cur = dims[i].levels ?? {};
    const l = cur[String(lvl)] ?? { ar: '', en: '' };
    set(i, { levels: { ...cur, [String(lvl)]: { ...l, [lang]: text } } });
  };
  const track = fw.track_code ? TRACK_BY_CODE[fw.track_code] : undefined;
  const genericOk = levels.join(',') === '1,2,3,4,5';
  const missingLevels = dims.reduce((a, d) => a + levels.filter((l) => !d.levels?.[String(l)]?.ar?.trim()).length, 0);

  return (
    <Drawer wide open onClose={onClose} title={<>{tr('أبعاد النضج', 'Maturity dimensions')} · {fw.name}</>}
      footer={<>
        <span className="small muted grow">{dirty ? tr('تغييرات غير محفوظة', 'Unsaved changes') : ''}</span>
        <Button onClick={onClose}>{tr('إغلاق', 'Close')}</Button>
        <Button variant="primary" icon={<Save />} loading={save.busy} disabled={!dirty || problems.length > 0} onClick={() => void save.run()}>{tr('حفظ', 'Save')}</Button>
      </>}>
      <div className="stack">
        <div className="row wrap">
          <span className="small muted grow">{tr(`المقياس ${fw.scale_min}–${fw.scale_max} · ${dims.length} أبعاد · مجموع الأوزان ${fmtNumber(totalW, 2)}`, `Scale ${fw.scale_min}–${fw.scale_max} · ${dims.length} dimensions · total weight ${fmtNumber(totalW, 2)}`)}</span>
          {track && <Button size="sm" variant="ghost" icon={<Download />} onClick={() => {
            const have = new Set(dims.map((d) => d.key));
            update([...dims, ...track.maturity_dimensions.filter((d) => !have.has(d.key)).map((d) => ({ key: d.key, name_ar: d.name_ar, name_en: d.name_en, weight: d.weight, levels: {} }))]);
          }}>{tr('استيراد أبعاد المسار', 'Import track dimensions')}</Button>}
          {genericOk && missingLevels > 0 && <Button size="sm" variant="ghost" icon={<Wand2 />} onClick={() => update(dims.map((d) => {
            const lv = { ...(d.levels ?? {}) };
            for (const m of MATURITY_LEVELS) if (!lv[String(m.level)]?.ar?.trim()) lv[String(m.level)] = { ar: `${m.ar}: ${m.desc_ar}`, en: `${m.en}: ${m.desc_en}` };
            return { ...d, levels: lv };
          }))}>{tr('ملء الواصفات الفارغة بالمستويات العامة', 'Fill empty descriptors with generic levels')}</Button>}
          <Button size="sm" icon={<Plus />} onClick={() => { update([...dims, { key: `dim_${dims.length + 1}`, name_ar: '', name_en: '', weight: 1, levels: {} }]); setOpen(dims.length); }}>{tr('بعد جديد', 'New dimension')}</Button>
        </div>
        {problems.length > 0 && <Notice tone="danger"><ul style={{ margin: 0, paddingInlineStart: 16 }}>{problems.map((p, i) => <li key={i}>{L(p)}</li>)}</ul></Notice>}
        {missingLevels > 0 && <Notice tone="warning">{tr(`${missingLevels} واصفات مستوى فارغة — الواصفات تجعل التقييم قابلًا للتكرار بين المقيّمين.`, `${missingLevels} empty level descriptors — descriptors make ratings repeatable across assessors.`)}</Notice>}
        {!dims.length && <EmptyState compact title={tr('لا توجد أبعاد', 'No dimensions')} />}
        {dims.map((d, i) => (
          <Card key={i}>
            <CardBody>
              <div className="row">
                <Input style={{ width: 140 }} dir="ltr" className="mono" value={d.key} onChange={(e) => set(i, { key: e.target.value })} aria-label={tr('المفتاح', 'Key')} />
                <Input className="grow" value={d.name_ar} placeholder={tr('الاسم (عربي)', 'Name (Arabic)')} onChange={(e) => set(i, { name_ar: e.target.value })} />
                <Input className="grow" dir="ltr" value={d.name_en} placeholder="Name (English)" onChange={(e) => set(i, { name_en: e.target.value })} />
                {fw.weighted && <Input style={{ width: 80 }} type="number" min={0} step="any" dir="ltr" value={d.weight ?? 1} aria-label={tr('الوزن', 'Weight')} onChange={(e) => set(i, { weight: Number(e.target.value) })} />}
                {fw.weighted && <span className="tiny muted" style={{ width: 40 }}>{totalW ? `${Math.round(((Number(d.weight) || 0) / totalW) * 100)}%` : ''}</span>}
                <Button size="sm" variant="ghost" iconOnly icon={open === i ? <ChevronUp /> : <ChevronDown />} aria-label={tr('واصفات المستويات', 'Level descriptors')} onClick={() => setOpen(open === i ? null : i)} />
                <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Remove')} onClick={() => update(dims.filter((_, j) => j !== i))} />
              </div>
              <div className="row" style={{ gap: 4, marginTop: 6 }}>
                {levels.map((l) => <Badge key={l} tone={d.levels?.[String(l)]?.ar?.trim() ? 'success' : 'neutral'}>{l}</Badge>)}
              </div>
              {open === i && (
                <div className="stack-sm" style={{ marginTop: 10 }}>
                  {levels.map((l) => (
                    <div key={l} className="grid g2" style={{ gap: 8 }}>
                      <Field label={tr(`المستوى ${l} (عربي)`, `Level ${l} (Arabic)`)}><Input value={d.levels?.[String(l)]?.ar ?? ''} onChange={(e) => setLevel(i, l, 'ar', e.target.value)} /></Field>
                      <Field label={`Level ${l} (English)`}><Input dir="ltr" value={d.levels?.[String(l)]?.en ?? ''} onChange={(e) => setLevel(i, l, 'en', e.target.value)} /></Field>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        ))}
      </div>
    </Drawer>
  );
}
