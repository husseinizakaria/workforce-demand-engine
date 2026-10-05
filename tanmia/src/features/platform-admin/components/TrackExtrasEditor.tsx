// Maturity dimensions, default indicators, report sections and session types of a track template.
import { Plus, Trash2 } from 'lucide-react';
import { MEASUREMENT_POINTS } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { Button, Card, CardBody, CardHeader, EmptyState, Input, MultiCheck, Select, TagInput } from '@/components/ui';
import type { DimensionDraft, IndicatorDraft, TrackDraft } from './trackModel';

export function TrackExtrasEditor({ draft, onChange }: { draft: TrackDraft; onChange: (patch: Partial<TrackDraft>) => void }) {
  const { tr, fmtNumber, enumOptions } = useI18n();
  const dims = draft.maturity_dimensions;
  const inds = draft.default_indicators;
  const totalW = dims.reduce((a, d) => a + (Number(d.weight) || 0), 0);
  const setDim = (i: number, p: Partial<DimensionDraft>) => onChange({ maturity_dimensions: dims.map((d, j) => (j === i ? { ...d, ...p } : d)) });
  const setInd = (i: number, p: Partial<IndicatorDraft>) => onChange({ default_indicators: inds.map((d, j) => (j === i ? { ...d, ...p } : d)) });
  const mpOptions = MEASUREMENT_POINTS.map((m) => ({ value: m.key, label: m.key }));

  return (
    <>
      <div className="grid g2">
        <Card>
          <CardHeader title={tr('أبعاد النضج وأوزانها', 'Maturity dimensions & weights')} hint={tr(`مجموع الأوزان ${fmtNumber(totalW, 2)}`, `total weight ${fmtNumber(totalW, 2)}`)}
            actions={<Button size="sm" variant="ghost" icon={<Plus />} onClick={() => onChange({ maturity_dimensions: [...dims, { key: `dim_${dims.length + 1}`, name_ar: '', name_en: '', weight: 1 }] })}>{tr('بعد', 'Dimension')}</Button>} />
          <CardBody>
            {!dims.length ? <EmptyState compact title={tr('لا توجد أبعاد', 'No dimensions')} /> : (
              <div className="stack-sm" style={{ gap: 6 }}>
                <div className="row tiny muted"><span style={{ width: 120 }}>{tr('المفتاح', 'Key')}</span><span className="grow">{tr('عربي', 'Arabic')}</span><span className="grow">{tr('إنجليزي', 'English')}</span><span style={{ width: 70 }}>{tr('الوزن', 'Weight')}</span><span style={{ width: 50 }}>%</span><span style={{ width: 32 }} /></div>
                {dims.map((d, i) => (
                  <div key={i} className="row">
                    <Input style={{ width: 120 }} dir="ltr" className="mono" value={d.key} onChange={(e) => setDim(i, { key: e.target.value })} />
                    <Input className="grow" value={d.name_ar} onChange={(e) => setDim(i, { name_ar: e.target.value })} />
                    <Input className="grow" dir="ltr" value={d.name_en} onChange={(e) => setDim(i, { name_en: e.target.value })} />
                    <Input style={{ width: 70 }} type="number" min={0} step="any" dir="ltr" value={d.weight} onChange={(e) => setDim(i, { weight: Number(e.target.value) })} />
                    <span className="tiny muted" style={{ width: 50 }}>{totalW ? `${Math.round(((Number(d.weight) || 0) / totalW) * 100)}%` : '—'}</span>
                    <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Remove')} onClick={() => onChange({ maturity_dimensions: dims.filter((_, j) => j !== i) })} />
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={tr('أقسام التقرير وأنواع الجلسات', 'Report sections & session types')} />
          <CardBody>
            <div className="stack-sm">
              <span className="small strong">{tr('أقسام التقرير الختامي (بالترتيب)', 'Final report sections (in order)')}</span>
              <TagInput value={draft.report_sections} onChange={(v) => onChange({ report_sections: v })} placeholder={tr('مفتاح القسم ثم Enter', 'Section key then Enter')} />
              <span className="small strong" style={{ marginTop: 8 }}>{tr('أنواع الجلسات المقترحة', 'Suggested session types')}</span>
              <MultiCheck options={enumOptions('sessionType')} value={draft.session_types} onChange={(v) => onChange({ session_types: v })} />
            </div>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title={tr('المؤشرات الافتراضية', 'Default indicators')} hint={tr('تُقترح عند إنشاء برنامج على هذا المسار', 'Suggested when a program is created on this track')}
          actions={<Button size="sm" variant="ghost" icon={<Plus />} onClick={() => onChange({ default_indicators: [...inds, { key: `ind_${inds.length + 1}`, name_ar: '', name_en: '', indicator_type: 'output', chain_level: 'output', unit: '', direction: 'increase', measurement_points: ['T1'] }] })}>{tr('مؤشر', 'Indicator')}</Button>} />
        <CardBody flush>
          {!inds.length ? <EmptyState compact title={tr('لا توجد مؤشرات افتراضية', 'No default indicators')} /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr>
                  <th>{tr('المفتاح', 'Key')}</th><th>{tr('الاسم (عربي)', 'Name (AR)')}</th><th>{tr('الاسم (إنجليزي)', 'Name (EN)')}</th><th>{tr('النوع', 'Type')}</th>
                  <th>{tr('مستوى السلسلة', 'Chain level')}</th><th>{tr('المدى', 'Term')}</th><th>{tr('الوحدة', 'Unit')}</th><th>{tr('الاتجاه', 'Direction')}</th><th>{tr('نقاط القياس', 'Points')}</th><th />
                </tr></thead>
                <tbody>
                  {inds.map((x, i) => (
                    <tr key={i}>
                      <td><Input style={{ width: 120 }} dir="ltr" className="mono" value={x.key} onChange={(e) => setInd(i, { key: e.target.value })} /></td>
                      <td><Input style={{ minWidth: 150 }} value={x.name_ar} onChange={(e) => setInd(i, { name_ar: e.target.value })} /></td>
                      <td><Input style={{ minWidth: 150 }} dir="ltr" value={x.name_en} onChange={(e) => setInd(i, { name_en: e.target.value })} /></td>
                      <td><Select value={x.indicator_type} options={enumOptions('indicatorType')} onChange={(e) => setInd(i, { indicator_type: e.target.value as IndicatorDraft['indicator_type'] })} /></td>
                      <td><Select value={x.chain_level} options={enumOptions('chainLevel')} onChange={(e) => setInd(i, { chain_level: e.target.value as IndicatorDraft['chain_level'] })} /></td>
                      <td>{x.indicator_type === 'outcome' ? <Select value={x.outcome_term ?? ''} placeholder="—" options={enumOptions('outcomeTerm')} onChange={(e) => setInd(i, { outcome_term: (e.target.value || undefined) as IndicatorDraft['outcome_term'] })} /> : <span className="muted">—</span>}</td>
                      <td><Input style={{ width: 90 }} value={x.unit} onChange={(e) => setInd(i, { unit: e.target.value })} /></td>
                      <td><Select value={x.direction} options={enumOptions('direction')} onChange={(e) => setInd(i, { direction: e.target.value as IndicatorDraft['direction'] })} /></td>
                      <td style={{ minWidth: 200 }}><MultiCheck options={mpOptions} value={x.measurement_points ?? []} onChange={(v) => setInd(i, { measurement_points: v })} /></td>
                      <td><Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Remove')} onClick={() => onChange({ default_indicators: inds.filter((_, j) => j !== i) })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </>
  );
}
