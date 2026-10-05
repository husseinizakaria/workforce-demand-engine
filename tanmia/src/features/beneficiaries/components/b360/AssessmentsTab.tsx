import { useState } from 'react';
import { Brain, ClipboardCheck } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, Notice, StatusBadge, scoreTone, type Column } from '@/components/ui';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { callFunction } from '@/services/functions';
import { errorOf } from '@/services/errors';
import type { AssessmentResult } from '@/types/db';
import { asList, textOf } from '../dataUtils';
import { type B360, programName } from './data';

interface Interpretation { strengths?: unknown; development_areas?: unknown; recommendations?: unknown; narrative?: unknown; generated_by?: string }

export function AssessmentsTab({ d }: { d: B360 }) {
  const { org, can } = useOrg();
  const { tr, pick, fmtDate, locale } = useI18n();
  const [selected, setSelected] = useState<AssessmentResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [out, setOut] = useState<Record<string, Interpretation>>({});
  const [err, setErr] = useState<{ id: string; code: string; msg: string } | null>(null);

  const interpret = async (r: AssessmentResult) => {
    setBusy(r.id); setErr(null); setSelected(r);
    try {
      const res = await callFunction<Interpretation>('ai-assessment-interpretation', { mode: 'result', organization_id: org.id, result_id: r.id });
      setOut((o) => ({ ...o, [r.id]: res }));
    } catch (e) {
      const ae = errorOf(e);
      setErr({ id: r.id, code: ae.code, msg: locale === 'ar' ? ae.message_ar : ae.message_en });
    } finally { setBusy(null); }
  };

  const toolName = (id: string) => { const t = d.tools.get(id); return t ? pick(t.name, t.name_en) : '—'; };
  const storedText = (r: AssessmentResult) => textOf(r.interpretation?.summary ?? r.interpretation?.narrative ?? (Object.keys(r.interpretation ?? {}).length ? r.interpretation : ''), locale);
  const cols: Column<AssessmentResult>[] = [
    { key: 'tool', header: tr('الأداة', 'Tool'), value: (r) => toolName(r.tool_id), render: (r) => <div><b>{toolName(r.tool_id)}</b><span className="sub">{programName(d, r.program_id, pick)}</span></div> },
    { key: 'point', header: tr('نقطة القياس', 'Point'), value: (r) => r.measurement_point, render: (r) => <Badge tone="outline">{r.measurement_point}</Badge> },
    { key: 'score', header: tr('الدرجة المعيارية', 'Normalized score'), align: 'end', value: (r) => r.normalized_score, render: (r) => r.normalized_score === null ? '—' : <Badge tone={scoreTone(r.normalized_score) ?? 'neutral'}>{Math.round(r.normalized_score)}</Badge> },
    { key: 'class', header: tr('التصنيف', 'Classification'), value: (r) => r.classification_label ?? '', render: (r) => <span>{r.classification_label ?? '—'}{r.passed !== null && <> {r.passed ? <Badge tone="success">{tr('ناجح', 'Pass')}</Badge> : <Badge tone="danger">{tr('لم يجتز', 'Below')}</Badge>}</>}</span> },
    { key: 'source', header: tr('المصدر', 'Source'), value: (r) => (r.source === 'internal' ? tr('داخلي', 'Internal') : tr('استيراد خارجي', 'External import')) },
    { key: 'status', header: tr('الحالة', 'Status'), value: (r) => r.status, render: (r) => <StatusBadge group="resultStatus" value={r.status} /> },
    { key: 'date', header: tr('التاريخ', 'Date'), value: (r) => r.assessed_at, render: (r) => fmtDate(r.assessed_at) },
    { key: 'interp', header: tr('التفسير المحفوظ', 'Stored interpretation'), value: (r) => storedText(r), render: (r) => <span className="small ellipsis" style={{ maxWidth: 260, display: 'inline-block' }} title={storedText(r)}>{storedText(r) || '—'}</span> },
    { key: 'act', header: '', hideInExport: true, render: (r) => can('assessments.view') ? <Button size="sm" icon={<Brain />} loading={busy === r.id} onClick={(e) => { e.stopPropagation(); void interpret(r); }}>{tr('تفسير', 'Interpret')}</Button> : null },
  ];
  const res = selected ? out[selected.id] : undefined;
  const Section = ({ title, v }: { title: string; v: unknown }) => {
    const items = asList(v);
    if (!items.length) return null;
    return <div className="stack-sm"><b className="small">{title}</b><ul style={{ margin: 0, paddingInlineStart: 18 }}>{items.map((x, i) => <li key={i} className="small">{textOf(x, locale)}</li>)}</ul></div>;
  };
  return (
    <div className="stack">
      <Card><CardHeader title={tr('نتائج أدوات التقييم', 'Assessment tool results')} icon={<ClipboardCheck />} /><CardBody flush>
        <DataTable columns={cols} rows={d.results} rowKey={(r) => r.id} exportName="beneficiary-assessments" onRowClick={setSelected}
          empty={{ title: tr('لا توجد نتائج تقييم', 'No assessment results') }} />
      </CardBody></Card>
      {selected && (
        <Card tinted>
          <CardHeader title={`${tr('تفسير', 'Interpretation')} · ${toolName(selected.tool_id)} · ${selected.measurement_point}`} icon={<Brain />}
            hint={res?.generated_by ? `${tr('المولّد', 'Generator')}: ${res.generated_by === 'rules' ? tr('قواعد', 'rules') : res.generated_by}` : undefined} />
          <CardBody>
            {err?.id === selected.id && (
              <Notice tone={err.code === 'function_unavailable' ? 'warning' : 'danger'}>
                {err.code === 'function_unavailable' ? tr('خدمة التفسير غير منشورة حاليًا. يعرض الجدول التفسير المحفوظ إن وُجد.', 'The interpretation service is not deployed. The table shows the stored interpretation if any.') : err.msg}
              </Notice>
            )}
            {!res && !err && busy !== selected.id && <p className="small muted">{tr('اضغط «تفسير» لتوليد نقاط القوة ومجالات التطوير والتوصيات.', 'Press “Interpret” to generate strengths, development areas and recommendations.')}</p>}
            {res && (
              <div className="grid g3">
                <Section title={tr('نقاط القوة', 'Strengths')} v={res.strengths} />
                <Section title={tr('مجالات التطوير', 'Development areas')} v={res.development_areas} />
                <Section title={tr('التوصيات', 'Recommendations')} v={res.recommendations} />
                {!!textOf(res.narrative, locale) && <p className="small span-all" style={{ whiteSpace: 'pre-wrap' }}>{textOf(res.narrative, locale)}</p>}
                <p className="tiny muted span-all">{tr('التفسير إرشادي لدعم الحكم المهني ولا يُعد قرارًا.', 'The interpretation is guidance to support professional judgement, not a decision.')}</p>
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
