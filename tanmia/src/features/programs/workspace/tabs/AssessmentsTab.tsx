// Assessments: tools available to the track, results summary per tool and
// measurement point, and the maturity before/after analysis.
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ClipboardCheck, ExternalLink, Gauge, Link2 } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAsync } from '@/hooks/useAsync';
import { useAction } from '@/hooks/useAction';
import { all, maybe, rpc, update } from '@/services/db';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, Notice, Select } from '@/components/ui';
import type { AssessmentTool, MaturityFramework } from '@/types/db';
import { avg, errText, round1 } from '../../lib';
import { useWorkspace } from '../context';
import { MaturityPanel } from '../components/MaturityPanel';
import { TabInsights } from '../components/common';

interface SummaryRow { key: string; tool_id: string; point: string; n: number; mean: number | null; passRate: number | null; verified: number }

export default function AssessmentsTab() {
  const { tr, pick, enumLabel, fmtNumber, locale } = useI18n();
  const { org, can } = useOrg();
  const ws = useWorkspace();
  const b = ws.bundle;
  const track = b.program.track_code;
  const tools = useAsync(async () => {
    const own = await all<AssessmentTool>('assessment_tools', { filters: [['organization_id', 'eq', org.id], ['status', 'eq', 'active']], order: { column: 'name', ascending: true } });
    const ids = [...new Set(b.results.map((r) => r.tool_id))].filter((id) => !own.some((t) => t.id === id));
    const extra = ids.length ? await all<AssessmentTool>('assessment_tools', { filters: [['id', 'in', ids]] }) : [];
    return [...own, ...extra];
  }, [org.id, b.results.length]);
  const toolList = tools.data ?? [];
  const forTrack = toolList.filter((t) => t.status === 'active' && t.organization_id === org.id && (!t.track_codes.length || t.track_codes.includes(track)));
  const toolName = (id: string) => { const t = toolList.find((x) => x.id === id); return t ? pick(t.name, t.name_en) : '—'; };
  const summary = useMemo<SummaryRow[]>(() => {
    const m = new Map<string, SummaryRow & { scores: number[]; passed: number; judged: number }>();
    for (const r of b.results) {
      if (r.status === 'rejected') continue;
      const key = `${r.tool_id}:${r.measurement_point}`;
      const x = m.get(key) ?? { key, tool_id: r.tool_id, point: r.measurement_point, n: 0, mean: null, passRate: null, verified: 0, scores: [], passed: 0, judged: 0 };
      x.n++; if (r.normalized_score !== null) x.scores.push(Number(r.normalized_score));
      if (r.passed !== null) { x.judged++; if (r.passed) x.passed++; }
      if (r.status === 'verified') x.verified++;
      m.set(key, x);
    }
    return [...m.values()].map((x) => ({ key: x.key, tool_id: x.tool_id, point: x.point, n: x.n, verified: x.verified, mean: round1(avg(x.scores)), passRate: x.judged ? Math.round((x.passed / x.judged) * 100) : null }))
      .sort((a, c) => a.tool_id.localeCompare(c.tool_id) || a.point.localeCompare(c.point));
  }, [b.results]);
  const enrolledN = ws.enrolled.length;
  const [fwId, setFwId] = useState<string>('');
  const fw = b.maturityFrameworks.find((f) => f.id === fwId) ?? b.maturityFrameworks[0];

  const link = useAction(async () => {
    const central = await maybe<MaturityFramework>('maturity_frameworks', [['organization_id', 'is', null], ['track_code', 'eq', track], ['status', 'eq', 'active']]);
    if (!central) throw { code: 'not_found', message: tr('لا يوجد إطار نضج مركزي لهذا المسار', 'No central maturity framework for this track') };
    const id = await rpc<string>('copy_central_template', { p_kind: 'maturity_framework', p_id: central.id, p_org: org.id });
    await update<MaturityFramework>('maturity_frameworks', id, { program_id: ws.programId });
    await ws.reload();
  }, { success: ['تم ربط إطار النضج بالبرنامج', 'Maturity framework linked to the program'] });

  return (
    <div className="stack">
      <TabInsights links={['assessments']} />
      <div className="grid g-1-2">
        <Card>
          <CardHeader icon={<ClipboardCheck />} title={tr('أدوات التقييم المتاحة للمسار', 'Assessment tools for this track')} hint={enumLabel('track', track)} />
          <CardBody flush>
            {tools.error ? <Notice tone="danger">{errText(locale, tools.error)}</Notice> : !forTrack.length ? (
              <EmptyState compact title={tr('لا توجد أدوات نشطة لهذا المسار', 'No active tools for this track')}
                description={tr('انسخ أداة من القوالب المركزية أو أنشئ أداة في وحدة التقييم.', 'Copy a central template or build a tool in the Assessments module.')}
                action={<Link to="/app/assessments">{tr('وحدة التقييم', 'Assessments module')}</Link>} />
            ) : (
              <ul className="list-plain" style={{ paddingInline: 16 }}>
                {forTrack.map((t) => {
                  const n = b.results.filter((r) => r.tool_id === t.id).length;
                  return (
                    <li key={t.id} className="row between">
                      <span className="stack-sm" style={{ gap: 0 }}>
                        <span className="small strong">{pick(t.name, t.name_en)}</span>
                        <span className="tiny muted">{t.code} · v{t.version} · {enumLabel('toolType', t.tool_type)} · {enumLabel('subjectType', t.subject_type)}</span>
                      </span>
                      <span className="row">
                        <Badge>{n}</Badge>
                        {can('assessments.create') && <Link className="small" to={`/app/assessments?program=${ws.programId}&tool=${t.id}`}><ExternalLink size={12} /> {tr('تسجيل نتيجة', 'Record result')}</Link>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={tr('ملخص النتائج حسب الأداة ونقطة القياس', 'Results by tool and measurement point')}
            actions={<Link className="small" to={`/app/assessments?program=${ws.programId}`}><ExternalLink size={12} /> {tr('فتح في وحدة التقييم', 'Open in Assessments')}</Link>} />
          <CardBody flush>
            <DataTable rows={summary} rowKey={(r) => r.key} exportName={`${b.program.code}-assessment-summary`}
              empty={{ title: tr('لا توجد نتائج تقييم للبرنامج', 'No assessment results for the program'), description: tr('سجّل قياس T0 قبل بدء التنفيذ لتمكين المقارنة لاحقًا.', 'Record a T0 baseline before delivery starts to enable later comparison.') }}
              columns={[
                { key: 'tool', header: tr('الأداة', 'Tool'), value: (r) => toolName(r.tool_id) },
                { key: 'point', header: tr('النقطة', 'Point'), value: (r) => enumLabel('measurementPoint', r.point) },
                { key: 'n', header: 'n', align: 'end', value: (r) => r.n, render: (r) => <span>{r.n}{enrolledN ? <span className="tiny muted"> / {enrolledN}</span> : null}</span> },
                { key: 'mean', header: tr('متوسط الدرجة المعيارية', 'Mean normalized score'), align: 'end', value: (r) => r.mean, render: (r) => fmtNumber(r.mean, 1) },
                { key: 'pass', header: tr('نسبة النجاح', 'Pass rate'), align: 'end', value: (r) => r.passRate, render: (r) => (r.passRate === null ? '—' : `${r.passRate}%`) },
                { key: 'verified', header: tr('متحقق منها', 'Verified'), align: 'end', value: (r) => r.verified },
              ]} />
          </CardBody>
        </Card>
      </div>

      {b.maturityFrameworks.length === 0 ? (
        <Card>
          <EmptyState icon={<Gauge />} title={tr('لا يوجد إطار نضج مرتبط بالبرنامج', 'No maturity framework linked to the program')}
            description={tr('إطار النضج يقيس تطور المستفيدين عبر أبعاد المسار بين T0 وT1 وما بعدها؛ دونه لا يمكن عرض التغير قبل/بعد.', 'A maturity framework measures beneficiary progress across track dimensions between T0, T1 and later; without it no before/after change can be shown.')}
            action={can('assessments.create') ? <Button variant="primary" icon={<Link2 />} loading={link.busy} onClick={() => void link.run()}>{tr('نسخ الإطار المركزي للمسار وربطه', 'Copy & link the central track framework')}</Button> : undefined} />
        </Card>
      ) : (
        <>
          {b.maturityFrameworks.length > 1 && (
            <Select aria-label={tr('إطار النضج', 'Maturity framework')} value={fw?.id ?? ''} onChange={(e) => setFwId(e.target.value)} style={{ maxWidth: 360 }}
              options={b.maturityFrameworks.map((f) => ({ value: f.id, label: `${pick(f.name, f.name_en)} · v${f.version}` }))} />
          )}
          {fw && <MaturityPanel framework={fw} />}
        </>
      )}
    </div>
  );
}
