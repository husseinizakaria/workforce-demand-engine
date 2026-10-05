// /app/assessments — tools, recording results, results & cohort analysis,
// external imports and maturity measurement. Optional ?program=<id> preselect.
import { useSearchParams } from 'react-router';
import { BarChart3, ClipboardCheck, FileUp, Gauge, Wrench } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAsync } from '@/hooks/useAsync';
import { ErrorState, PageHeader, Tabs } from '@/components/ui';
import { loadPrograms } from '../api';
import { ToolsTab } from '../components/ToolsTab';
import { RecordResultTab } from '../components/RecordResultTab';
import { ResultsTab } from '../components/ResultsTab';
import { ImportsTab } from '../components/ImportsTab';
import { MaturityTab } from '../components/MaturityTab';

const TABS = ['tools', 'record', 'results', 'imports', 'maturity'] as const;
type TabKey = (typeof TABS)[number];

export default function AssessmentsPage() {
  const { tr, pick } = useI18n();
  const { org } = useOrg();
  const [params, setParams] = useSearchParams();
  const programParam = params.get('program');
  const tabParam = params.get('tab') as TabKey | null;
  const tab: TabKey = tabParam && TABS.includes(tabParam) ? tabParam : programParam ? 'results' : 'tools';
  const programs = useAsync(() => loadPrograms(org.id), [org.id]);
  const list = programs.data ?? [];
  const preProgram = programParam && list.some((p) => p.id === programParam) ? programParam : null;
  const selectedName = preProgram ? (() => { const p = list.find((x) => x.id === preProgram)!; return pick(p.name, p.name_en); })() : null;

  const setTab = (k: string) => { const n = new URLSearchParams(params); n.set('tab', k); setParams(n, { replace: true }); };

  return (
    <div className="stack">
      <PageHeader title={tr('التقييم والجودة', 'Assessment & quality')}
        subtitle={selectedName ? `${tr('البرنامج المحدد', 'Selected program')}: ${selectedName}` : tr('أدوات التقييم، تسجيل النتائج، الاستيراد الخارجي، وقياس النضج عبر نقاط T0–T5', 'Assessment tools, results, external imports and maturity measurement across T0–T5')} />
      <Tabs value={tab} onChange={setTab} items={[
        { key: 'tools', label: tr('الأدوات', 'Tools'), icon: <Wrench size={15} /> },
        { key: 'record', label: tr('تسجيل نتيجة', 'Record result'), icon: <ClipboardCheck size={15} /> },
        { key: 'results', label: tr('النتائج', 'Results'), icon: <BarChart3 size={15} /> },
        { key: 'imports', label: tr('الاستيراد الخارجي', 'External imports'), icon: <FileUp size={15} /> },
        { key: 'maturity', label: tr('النضج', 'Maturity'), icon: <Gauge size={15} /> },
      ]} />
      {programs.error && <ErrorState error={programs.error} onRetry={programs.reload} compact />}
      {tab === 'tools' && <ToolsTab />}
      {tab === 'record' && <RecordResultTab key={`r-${preProgram}`} programs={list} initialProgram={preProgram} />}
      {tab === 'results' && <ResultsTab key={`s-${preProgram}`} programs={list} initialProgram={preProgram} />}
      {tab === 'imports' && <ImportsTab key={`i-${preProgram}`} programs={list} initialProgram={preProgram} />}
      {tab === 'maturity' && <MaturityTab key={`m-${preProgram}`} programs={list} initialProgram={preProgram} />}
    </div>
  );
}
