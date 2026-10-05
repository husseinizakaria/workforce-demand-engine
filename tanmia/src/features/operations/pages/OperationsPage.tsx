import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Activity, CalendarDays, CalendarPlus, CalendarRange, KanbanSquare, List } from 'lucide-react';
import { AsyncView, PageHeader, Tabs } from '@/components/ui';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { useAsync } from '@/hooks/useAsync';
import { loadRefs } from '../components/ops';
import { CalendarTab } from '../components/CalendarTab';
import { SessionsListTab } from '../components/SessionsListTab';
import { ScheduleSessionForm } from '../components/ScheduleSessionForm';
import { BulkScheduleTab } from '../components/BulkScheduleTab';
import { ActionsBoard } from '../components/ActionsBoard';
import { InsightsPanel } from '../components/InsightsPanel';
import { SessionDrawer } from '../components/SessionDrawer';

const TABS = ['calendar', 'sessions', 'schedule', 'bulk', 'actions', 'insights'] as const;
type TabKey = (typeof TABS)[number];

export default function OperationsPage() {
  const { org, can } = useOrg();
  const { tr } = useI18n();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: TabKey = (TABS as readonly string[]).includes(raw ?? '') ? (raw as TabKey) : 'calendar';
  const setTab = (k: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', k); return n; }, { replace: true });
  const openId = params.get('session');
  const open = (id: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('session', id); return n; });
  const close = () => setParams((p) => { const n = new URLSearchParams(p); n.delete('session'); return n; });
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const refs = useAsync(() => loadRefs(org.id), [org.id]);

  return (
    <div className="stack">
      <PageHeader title={tr('التشغيل والجدولة', 'Scheduling & operations')}
        subtitle={tr('تقويم الجلسات عبر البرامج، الجدولة مع فحص التعارض، الحضور والإغلاق، الإجراءات والتنبيهات التشغيلية. الأوقات بتوقيت الرياض.', 'Sessions across programs, conflict-checked scheduling, attendance and closure, actions and operational warnings. Times are Riyadh time.')} />
      <Tabs value={tab} onChange={setTab} items={[
        { key: 'calendar', label: tr('التقويم', 'Calendar'), icon: <CalendarDays size={15} /> },
        { key: 'sessions', label: tr('الجلسات', 'Sessions'), icon: <List size={15} /> },
        { key: 'schedule', label: tr('جدولة جلسة', 'Schedule session'), icon: <CalendarPlus size={15} />, hidden: !can('operations.create') },
        { key: 'bulk', label: tr('جدولة متكررة', 'Bulk scheduling'), icon: <CalendarRange size={15} />, hidden: !can('operations.create') },
        { key: 'actions', label: tr('لوحة الإجراءات', 'Actions board'), icon: <KanbanSquare size={15} /> },
        { key: 'insights', label: tr('التنبيهات', 'Insights'), icon: <Activity size={15} /> },
      ]} />
      <AsyncView state={refs}>
        {(r) => (
          <>
            {tab === 'calendar' && <CalendarTab refs={r} onOpen={open} version={version} />}
            {tab === 'sessions' && <SessionsListTab refs={r} onOpen={open} version={version} />}
            {tab === 'schedule' && <ScheduleSessionForm refs={r} onCreated={(s) => { bump(); open(s.id); }} />}
            {tab === 'bulk' && <BulkScheduleTab refs={r} onCreated={() => { bump(); setTab('calendar'); }} />}
            {tab === 'actions' && <ActionsBoard refs={r} onOpenSession={open} version={version} />}
            {tab === 'insights' && <InsightsPanel refs={r} onOpen={open} version={version} />}
            {openId && <SessionDrawer key={openId} sessionId={openId} refs={r} onClose={close} onChanged={bump} onOpen={open} />}
          </>
        )}
      </AsyncView>
    </div>
  );
}
