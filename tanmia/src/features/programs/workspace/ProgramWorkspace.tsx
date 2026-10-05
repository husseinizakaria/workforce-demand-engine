// Integrated Program Workspace: one program, its journey and every operational
// module as tabs, sharing a single loaded bundle and the engine's live health.
import { lazy, Suspense, useCallback, useMemo, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router';
import {
  Activity, BarChart3, ClipboardCheck, FileText, FolderOpen, LayoutDashboard, Paperclip, PowerOff, Route as RouteIcon, Settings2,
  Target, Truck, UserCheck, Users, Wallet, CalendarDays, Lock,
} from 'lucide-react';
import { evidenceCompleteness, programHealth, TRACK_BY_CODE } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAsync } from '@/hooks/useAsync';
import { useAction } from '@/hooks/useAction';
import { loadProgramBundle } from '@/services/programBundle';
import { update } from '@/services/db';
import {
  AsyncView, Badge, Button, EmptyState, LinkTabs, Loading, Modal, MultiCheck, Notice, PageHeader, ScoreRing, Select, StatusBadge,
  scoreTone, useConfirm,
} from '@/components/ui';
import type { ModuleKey, Program, ProgramStatus } from '@/types/db';
import { WorkspaceContext, type WorkspaceValue } from './context';

const OverviewTab = lazy(() => import('./tabs/OverviewTab'));
const JourneyTab = lazy(() => import('./tabs/JourneyTab'));
const ParticipantsTab = lazy(() => import('./tabs/ParticipantsTab'));
const DeliveryTab = lazy(() => import('./tabs/DeliveryTab'));
const ExpertsTab = lazy(() => import('./tabs/ExpertsTab'));
const VendorsTab = lazy(() => import('./tabs/VendorsTab'));
const AssessmentsTab = lazy(() => import('./tabs/AssessmentsTab'));
const EvidenceTab = lazy(() => import('./tabs/EvidenceTab'));
const OutcomesTab = lazy(() => import('./tabs/OutcomesTab'));
const ImpactTab = lazy(() => import('./tabs/ImpactTab'));
const FinanceTab = lazy(() => import('./tabs/FinanceTab'));
const DocumentsTab = lazy(() => import('./tabs/DocumentsTab'));
const ReportsTab = lazy(() => import('./tabs/ReportsTab'));

export type WorkspaceTabKey = 'overview' | 'journey' | 'participants' | 'delivery' | 'experts' | 'vendors' | 'assessments'
  | 'evidence' | 'outcomes' | 'impact' | 'finance' | 'documents' | 'reports';

interface TabDef { key: WorkspaceTabKey; module: ModuleKey; label: [string, string]; icon: ReactNode; element: ReactNode }

const TABS: TabDef[] = [
  { key: 'overview', module: 'programs', label: ['نظرة عامة', 'Overview'], icon: <LayoutDashboard />, element: <OverviewTab /> },
  { key: 'journey', module: 'programs', label: ['الرحلة', 'Journey'], icon: <RouteIcon />, element: <JourneyTab /> },
  { key: 'participants', module: 'programs', label: ['المشاركون', 'Participants'], icon: <Users />, element: <ParticipantsTab /> },
  { key: 'delivery', module: 'operations', label: ['التنفيذ', 'Delivery'], icon: <CalendarDays />, element: <DeliveryTab /> },
  { key: 'experts', module: 'experts', label: ['الخبراء', 'Experts'], icon: <UserCheck />, element: <ExpertsTab /> },
  { key: 'vendors', module: 'vendors', label: ['الموردون', 'Vendors'], icon: <Truck />, element: <VendorsTab /> },
  { key: 'assessments', module: 'assessments', label: ['التقييم', 'Assessments'], icon: <ClipboardCheck />, element: <AssessmentsTab /> },
  { key: 'evidence', module: 'evidence', label: ['الأدلة', 'Evidence'], icon: <Paperclip />, element: <EvidenceTab /> },
  { key: 'outcomes', module: 'outcomes', label: ['المخرجات والنتائج', 'Outcomes'], icon: <Target />, element: <OutcomesTab /> },
  { key: 'impact', module: 'impact', label: ['الأثر', 'Impact'], icon: <Activity />, element: <ImpactTab /> },
  { key: 'finance', module: 'governance', label: ['المالية', 'Finance'], icon: <Wallet />, element: <FinanceTab /> },
  { key: 'documents', module: 'evidence', label: ['المستندات', 'Documents'], icon: <FolderOpen />, element: <DocumentsTab /> },
  { key: 'reports', module: 'reports', label: ['التقارير', 'Reports'], icon: <FileText />, element: <ReportsTab /> },
];

export default function ProgramWorkspace() {
  const { programId = '' } = useParams();
  const state = useAsync(() => loadProgramBundle(programId), [programId]);
  return (
    <div className="stack">
      <AsyncView state={state} rows={8}>
        {(bundle) => <Workspace bundle={bundle} reload={state.reload} programId={programId} />}
      </AsyncView>
    </div>
  );
}

function Workspace({ bundle, reload, programId }: { bundle: WorkspaceValue['bundle']; reload: () => Promise<void>; programId: string }) {
  const { tr, pick, enumLabel, enumOptions, fmtDate, L } = useI18n();
  const { can, hasModule } = useOrg();
  const confirm = useConfirm();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const p = bundle.program;
  const base = `/app/programs/${programId}`;
  const health = useMemo(() => programHealth(bundle), [bundle]);
  const track = TRACK_BY_CODE[p.track_code];

  const value = useMemo<WorkspaceValue>(() => {
    const benMap = new Map(bundle.beneficiaries.map((b) => [b.id, b]));
    const expMap = new Map(bundle.experts.map((e) => [e.id, e]));
    const stageMap = new Map(bundle.stages.map((s) => [s.stage_key, s]));
    const cohortMap = new Map(bundle.cohorts.map((c) => [c.id, c]));
    const enrolledIds = new Set(bundle.enrollments.filter((e) => !['withdrawn', 'dropped'].includes(e.status)).map((e) => e.beneficiary_id));
    return {
      programId, base, bundle, health, track, reload,
      enrolled: bundle.beneficiaries.filter((b) => enrolledIds.has(b.id)),
      benName: (id) => (id ? benMap.get(id)?.full_name ?? '—' : '—'),
      expertName: (id) => (id ? expMap.get(id)?.full_name ?? '—' : '—'),
      stageName: (key) => {
        if (!key) return '—';
        const s = stageMap.get(key);
        return s ? pick(s.name_ar, s.name_en) : key;
      },
      cohortName: (id) => (id ? cohortMap.get(id)?.name ?? '—' : '—'),
    };
  }, [bundle, health, track, reload, programId, base, pick]);

  const statusAction = useAction(async (status: ProgramStatus) => {
    await update<Program>('programs', p.id, { status });
    await reload();
  }, { success: ['تم تحديث حالة البرنامج', 'Program status updated'] });

  const changeStatus = async (status: ProgramStatus) => {
    if (status === p.status) return;
    const setupIssues = health.insights.filter((i) => i.area === 'setup' && ['high', 'critical', 'medium'].includes(i.severity));
    let message: ReactNode = null;
    if (status === 'active' && setupIssues.length) {
      message = (
        <div className="stack-sm">
          <p>{tr('رصد المحرك نواقص في الإعداد قبل التفعيل:', 'The engine found setup gaps before activation:')}</p>
          <ul className="small">{setupIssues.slice(0, 6).map((i) => <li key={i.fingerprint}>{L(i.title)}</li>)}</ul>
          <p className="small muted">{tr('يمكنك المتابعة، لكن يوصى بمعالجتها أولًا.', 'You can proceed, but addressing them first is recommended.')}</p>
        </div>
      );
    } else if (['closed', 'cancelled', 'completed'].includes(status)) {
      message = tr('سيُعتبر البرنامج منتهيًا. تأكد من إكمال قياسات T1 وجدولة متابعات T2–T5 وتوثيق الأدلة.', 'The program will be treated as finished. Make sure T1 measurements are complete, T2–T5 follow-ups are planned and evidence is documented.');
    }
    if (message) {
      const ok = await confirm({ title: tr(`تغيير الحالة إلى «${enumLabel('programStatus', status)}»؟`, `Change status to “${enumLabel('programStatus', status)}”?`), message, danger: status === 'cancelled' });
      if (!ok) return;
    }
    await statusAction.run(status);
  };

  const visible = (t: TabDef) => !p.disabled_tabs.includes(t.key) && hasModule(t.module);
  const blocked = bundle.stages.filter((s) => s.status === 'blocked').length;
  const ev = evidenceCompleteness(bundle);
  const badges: Partial<Record<WorkspaceTabKey, ReactNode>> = {
    journey: blocked ? <Badge tone="danger">{blocked}</Badge> : undefined,
    evidence: ev.missing.length ? <Badge tone="warning">{ev.missing.length}</Badge> : undefined,
  };
  const tone = scoreTone(health.score);

  return (
    <WorkspaceContext.Provider value={value}>
      <PageHeader
        crumbs={[{ label: tr('البرامج', 'Programs'), to: '/app/programs' }, { label: p.code }]}
        title={pick(p.name, p.name_en)}
        badge={<><StatusBadge group="programStatus" value={p.status} /><Badge tone="outline">{enumLabel('track', p.track_code)}</Badge></>}
        subtitle={
          <span className="row wrap" style={{ gap: 10 }}>
            <span className="mono">{p.code}</span>
            <span>{fmtDate(p.start_date)} – {fmtDate(p.end_date)}</span>
            {bundle.sponsorName && <span>{tr('الراعي', 'Sponsor')}: {bundle.sponsorName}</span>}
            {p.region && <span>{p.region}</span>}
          </span>
        }
        actions={
          <>
            <div className="row" title={tr('درجة صحة البرنامج (محسوبة بقواعد المحرك)', 'Program health score (engine rules)')}>
              <ScoreRing value={health.score} tone={tone} />
              <div className="stack-sm" style={{ gap: 0 }}>
                <span className="small strong">{tr('صحة البرنامج', 'Program health')}</span>
                <span className="tiny muted">{health.insights.length} {tr('ملاحظة', 'findings')}</span>
              </div>
            </div>
            {can('programs.edit') ? (
              <Select aria-label={tr('حالة البرنامج', 'Program status')} options={enumOptions('programStatus')} value={p.status}
                disabled={statusAction.busy} onChange={(e) => void changeStatus(e.target.value as ProgramStatus)} style={{ width: 150 }} />
            ) : null}
            {can('programs.configure') && (
              <Button icon={<Settings2 />} onClick={() => setSettingsOpen(true)}>{tr('إعدادات التبويبات', 'Tab settings')}</Button>
            )}
          </>
        }
      />
      <LinkTabs base={base} items={TABS.map((t) => ({ key: t.key, label: tr(t.label[0], t.label[1]), icon: t.icon, hidden: !visible(t), badge: badges[t.key] }))} />
      <Suspense fallback={<Loading rows={6} />}>
        <Routes>
          <Route index element={<Navigate to="overview" replace />} />
          {TABS.map((t) => (
            <Route key={t.key} path={`${t.key}/*`} element={visible(t) ? t.element : <TabUnavailable tab={t} disabled={p.disabled_tabs.includes(t.key)} />} />
          ))}
          <Route path="*" element={<Navigate to="overview" replace />} />
        </Routes>
      </Suspense>
      {settingsOpen && <TabSettings program={p} onClose={() => setSettingsOpen(false)} onSaved={reload} />}
    </WorkspaceContext.Provider>
  );
}

function TabUnavailable({ tab, disabled }: { tab: TabDef; disabled: boolean }) {
  const { tr } = useI18n();
  return (
    <div className="card">
      <EmptyState icon={disabled ? <PowerOff /> : <Lock />}
        title={disabled ? tr(`تبويب «${tab.label[0]}» معطّل لهذا البرنامج`, `The “${tab.label[1]}” tab is disabled for this program`) : tr('لا تملك صلاحية عرض هذا التبويب', 'You do not have permission to view this tab')}
        description={disabled ? tr('يمكن لمن يملك صلاحية تهيئة البرامج إعادة تفعيله من «إعدادات التبويبات».', 'Users with program configuration rights can re-enable it from “Tab settings”.') : tr('الوحدة غير مفعلة أو لا تملك صلاحية العرض فيها.', 'The module is disabled or you lack view permission.')} />
    </div>
  );
}

function TabSettings({ program, onClose, onSaved }: { program: Program; onClose: () => void; onSaved: () => Promise<void> }) {
  const { tr } = useI18n();
  const [enabled, setEnabled] = useState<string[]>(TABS.filter((t) => !program.disabled_tabs.includes(t.key)).map((t) => t.key));
  const save = useAction(async () => {
    const disabled = TABS.filter((t) => t.key !== 'overview' && !enabled.includes(t.key)).map((t) => t.key);
    await update<Program>('programs', program.id, { disabled_tabs: disabled });
    await onSaved();
  }, { success: ['تم حفظ إعدادات التبويبات', 'Tab settings saved'], onDone: onClose });
  const toggleAll = useCallback(() => setEnabled(TABS.map((t) => t.key)), []);
  return (
    <Modal open title={tr('تبويبات مساحة عمل البرنامج', 'Program workspace tabs')} onClose={onClose}
      footer={<><Button onClick={toggleAll}>{tr('تفعيل الكل', 'Enable all')}</Button><Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={save.busy} onClick={() => void save.run()}>{tr('حفظ', 'Save')}</Button></>}>
      <Notice tone="info">
        {tr('تعطيل تبويب يخفيه لهذا البرنامج فقط (مثلًا برنامج استشاري لا يحتاج موردين). البيانات لا تُحذف، وصلاحيات الوحدات على مستوى المؤسسة تبقى كما هي.',
          'Disabling a tab hides it for this program only (e.g. a consulting program without vendors). Data is not deleted and organization-level module permissions are unchanged.')}
      </Notice>
      <MultiCheck options={TABS.filter((t) => t.key !== 'overview').map((t) => ({ value: t.key, label: tr(t.label[0], t.label[1]) }))}
        value={enabled.filter((k) => k !== 'overview')} onChange={(v) => setEnabled(['overview', ...v])} />
      <p className="tiny muted"><BarChart3 size={12} /> {tr('«نظرة عامة» لا يمكن تعطيلها.', '“Overview” cannot be disabled.')}</p>
    </Modal>
  );
}
