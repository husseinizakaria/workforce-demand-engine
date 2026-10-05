// Rendering of a generated report (ReportContent from the engine / Edge Function).
import type { ReactNode } from 'react';
import { Download, Sparkles } from 'lucide-react';
import type { L10n, ReportContent, ReportSection } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { Badge, Button, Card, CardBody, Notice } from '@/components/ui';
import { downloadCSV } from '@/utils/csv';

export const MANUAL_SECTIONS = ['executive_summary', 'success_stories', 'challenges', 'lessons_learned', 'recommendations'];

export interface ReportConfig {
  sections: string[]; indicators: string[]; comparisons: { points: string[] }; detail_level: 'summary' | 'detailed';
  include_attachments: boolean; narrative: Record<string, { ar?: string; en?: string }>;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function parseConfig(raw: unknown): ReportConfig {
  const c = isObj(raw) ? raw : {};
  const comp = isObj(c.comparisons) ? c.comparisons : {};
  const narr: ReportConfig['narrative'] = {};
  if (isObj(c.narrative)) for (const [k, v] of Object.entries(c.narrative)) {
    if (isObj(v)) narr[k] = { ar: typeof v.ar === 'string' ? v.ar : undefined, en: typeof v.en === 'string' ? v.en : undefined };
  }
  const points = strArr(comp.points);
  return {
    sections: strArr(c.sections), indicators: strArr(c.indicators), comparisons: { points: points.length === 2 ? points : ['T0', 'T1'] },
    detail_level: c.detail_level === 'detailed' ? 'detailed' : 'summary', include_attachments: c.include_attachments === true, narrative: narr,
  };
}

export function isReportContent(v: unknown): v is ReportContent {
  return isObj(v) && Array.isArray(v.sections) && isObj(v.title);
}

const isL10n = (v: unknown): v is L10n => isObj(v) && typeof v.ar === 'string';

/** Flattens an LLM narrative payload (string, {ar,en}, or keyed objects) into keyed text blocks. */
export function narrativeBlocks(n: unknown, locale: 'ar' | 'en'): Record<string, string> {
  const out: Record<string, string> = {};
  const text = (v: unknown): string | null => {
    if (typeof v === 'string') return v.trim() || null;
    if (isL10n(v)) return (locale === 'ar' ? v.ar : (typeof v.en === 'string' && v.en) || v.ar).trim() || null;
    if (Array.isArray(v)) { const parts = v.map(text).filter(Boolean); return parts.length ? parts.join('\n\n') : null; }
    return null;
  };
  if (!n) return out;
  const direct = text(n);
  if (direct) { out.summary = direct; return out; }
  if (!isObj(n)) return out;
  for (const [k, v] of Object.entries(n)) {
    if (k === 'sections' && isObj(v)) { for (const [sk, sv] of Object.entries(v)) { const t = text(sv); if (t) out[sk] = t; } continue; }
    if (['model', 'generated_by', 'provider', 'status'].includes(k)) continue;
    const t = text(v);
    if (t) out[k] = t;
  }
  return out;
}

function cell(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

export function ReportView({ content, narrative, header, banner }: { content: ReportContent; narrative: Record<string, string>; header: ReactNode; banner?: ReactNode }) {
  const { tr, L } = useI18n();
  const aiKeys = Object.keys(narrative).filter((k) => !content.sections.some((s) => s.key === k));
  return (
    <div className="stack report-view">
      {banner}
      {header}
      {aiKeys.length > 0 && (
        <Card>
          <CardBody>
            <AiBlock title={tr('ملخص مقترح', 'Suggested summary')} text={aiKeys.map((k) => narrative[k]).join('\n\n')} />
          </CardBody>
        </Card>
      )}
      {content.sections.map((s, i) => <SectionView key={s.key} index={i + 1} s={s} ai={narrative[s.key]} reportTitle={L(content.title)} />)}
      {content.data_notes?.length > 0 && (
        <Card>
          <CardBody>
            <h3 className="small strong">{tr('ملاحظات على البيانات', 'Data notes')}</h3>
            <ul className="small" style={{ margin: 0, paddingInlineStart: 18 }}>{content.data_notes.map((n, i) => <li key={i}>{L(n)}</li>)}</ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function AiBlock({ title, text }: { title: string; text: string }) {
  const { tr } = useI18n();
  return (
    <div className="notice warning" style={{ display: 'block' }}>
      <div className="row" style={{ marginBottom: 4 }}><Sparkles size={15} /><b className="small">{title}</b><Badge tone="warning">{tr('مسودة ذكاء اصطناعي — راجعها قبل الاعتماد', 'AI draft — review before approval')}</Badge></div>
      {text.split(/\n{2,}/).map((p, i) => <p key={i} className="small" style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>{p}</p>)}
    </div>
  );
}

function SectionView({ s, index, ai, reportTitle }: { s: ReportSection; index: number; ai?: string; reportTitle: string }) {
  const { tr, L } = useI18n();
  return (
    <Card>
      <CardBody>
        <div className="stack-sm">
          <div className="row between">
            <h2 style={{ fontSize: 17, margin: 0 }}>{index}. {L(s.title)}</h2>
            {s.manual && <Badge tone="outline">{tr('قسم يُستكمل يدويًا', 'Manually completed section')}</Badge>}
          </div>
          {s.kpis && s.kpis.length > 0 && (
            <div className="grid g4">
              {s.kpis.map((k, i) => (
                <div key={i} className="card kpi">
                  <span className="label">{L(k.label)}</span>
                  <span className="value">{cell(k.value)}</span>
                  {k.hint && <span className="hint">{L(k.hint)}</span>}
                </div>
              ))}
            </div>
          )}
          {s.narrative.map((n, i) => <p key={i} className="small" style={{ margin: 0, lineHeight: 1.7 }}>{L(n)}</p>)}
          {ai && <AiBlock title={tr('صياغة مقترحة لهذا القسم', 'Suggested wording for this section')} text={ai} />}
          {(s.tables ?? []).map((t, ti) => (
            <div key={ti} className="stack-sm">
              <div className="row between">
                <h4 className="small strong" style={{ margin: 0 }}>{L(t.title)}</h4>
                <Button size="sm" variant="ghost" className="no-print" icon={<Download />} disabled={!t.table.rows.length}
                  onClick={() => downloadCSV(`${reportTitle}-${L(s.title)}-${ti + 1}`.replace(/[\\/:*?"<>|]+/g, '_'), t.table.columns.map(L), t.table.rows.map((r) => r.map((c) => (c === null ? '' : c))))}>CSV</Button>
              </div>
              {!t.table.rows.length ? <p className="tiny muted">{tr('لا توجد بيانات.', 'No data.')}</p> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr>{t.table.columns.map((c, ci) => <th key={ci}>{L(c)}</th>)}</tr></thead>
                    <tbody>{t.table.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} className={typeof c === 'number' ? 'num' : undefined}>{cell(c)}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
          {!s.narrative.length && !(s.kpis ?? []).length && !(s.tables ?? []).length && !ai && <Notice tone="info">{tr('لا يوجد محتوى لهذا القسم.', 'No content for this section.')}</Notice>}
        </div>
      </CardBody>
    </Card>
  );
}
