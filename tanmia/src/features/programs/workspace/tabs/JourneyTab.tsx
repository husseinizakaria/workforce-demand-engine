// Journey tab: visual journey, stage detail panel and journey configuration.
import { useMemo, useState } from 'react';
import { Ban, Check, CheckCircle2, Lock, Paperclip, Play, Route, Settings2, ShieldCheck } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAsync } from '@/hooks/useAsync';
import { all } from '@/services/db';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Kpi, Notice, Progress } from '@/components/ui';
import type { ProgramTeam } from '@/types/db';
import { useWorkspace } from '../context';
import { JourneyMap } from '../components/JourneyMap';
import { StagePanel } from '../components/StagePanel';
import { JourneyConfigModal } from '../components/JourneyConfigModal';
import { journeyProgress, nextAvailable, stageInfo } from '../components/journeyModel';
import { TabInsights } from '../components/common';

export default function JourneyTab() {
  const { tr, pick, fmtNumber } = useI18n();
  const { can, org } = useOrg();
  const ws = useWorkspace();
  const { bundle } = ws;
  const infos = useMemo(() => bundle.stages.map((s) => stageInfo(bundle, s)), [bundle]);
  const current = bundle.stages.find((s) => s.status === 'in_progress') ?? bundle.stages.find((s) => s.status === 'blocked') ?? nextAvailable(bundle);
  const [selected, setSelected] = useState<string | null>(() => current?.stage_key ?? null);
  const [config, setConfig] = useState(false);
  const teams = useAsync(() => all<ProgramTeam>('program_teams', { filters: [['organization_id', 'eq', org.id], ['program_id', 'eq', ws.programId]], order: { column: 'name', ascending: true } }), [ws.programId, bundle]);

  const done = bundle.stages.filter((s) => ['completed', 'skipped'].includes(s.status)).length;
  const blocked = bundle.stages.filter((s) => s.status === 'blocked').length;
  const pendingApproval = bundle.stages.filter((s) => s.approval_status === 'pending').length;
  const evMissing = infos.filter((i) => ['in_progress', 'completed'].includes(i.stage.status)).reduce((a, i) => a + i.evidenceMissing, 0);
  const progress = journeyProgress(bundle.stages);
  const info = infos.find((i) => i.stage.stage_key === selected);
  const next = nextAvailable(bundle);

  if (!bundle.stages.length) {
    return (
      <Card>
        <EmptyState icon={<Route />} title={tr('لا توجد مراحل لهذا البرنامج', 'This program has no journey stages')}
          description={tr('تُنسخ المراحل تلقائيًا من قالب المسار عند إنشاء البرنامج. يمكن إضافة مراحل مخصصة يدويًا.', 'Stages are copied from the track template when the program is created. You can add custom stages manually.')}
          action={can('programs.configure') ? <Button icon={<Settings2 />} onClick={() => setConfig(true)}>{tr('تهيئة الرحلة', 'Configure journey')}</Button> : undefined} />
        {config && <JourneyConfigModal onClose={() => setConfig(false)} />}
      </Card>
    );
  }

  return (
    <div className="stack">
      <div className="grid g5">
        <Kpi label={tr('تقدم الرحلة', 'Journey progress')} value={`${progress}%`} icon={<Route />} hint={<Progress value={progress} />} />
        <Kpi label={tr('المراحل المكتملة', 'Stages done')} value={`${fmtNumber(done)} / ${fmtNumber(bundle.stages.length)}`} icon={<CheckCircle2 />} />
        <Kpi label={tr('المرحلة الحالية', 'Current stage')} value={<span style={{ fontSize: 15 }}>{current ? pick(current.name_ar, current.name_en) : '—'}</span>} icon={<Play />}
          hint={next && next.id !== current?.id ? `${tr('التالية المتاحة', 'Next available')}: ${pick(next.name_ar, next.name_en)}` : undefined} />
        <Kpi label={tr('متوقفة / بانتظار اعتماد', 'Blocked / awaiting approval')} value={`${blocked} / ${pendingApproval}`} icon={<Ban />} tone={blocked ? 'danger' : pendingApproval ? 'warning' : undefined} />
        <Kpi label={tr('أدلة مطلوبة ناقصة', 'Missing required evidence')} value={fmtNumber(evMissing)} icon={<Paperclip />} tone={evMissing ? 'warning' : 'success'}
          hint={tr('للمراحل الجارية والمكتملة', 'For in-progress and completed stages')} />
      </div>

      <Card>
        <CardHeader icon={<Route />} title={tr('رحلة البرنامج', 'Program journey')}
          hint={tr('انقر على مرحلة لعرض تفاصيلها وإدارة حالتها', 'Click a stage to view details and manage its status')}
          actions={can('programs.configure') ? <Button size="sm" icon={<Settings2 />} onClick={() => setConfig(true)}>{tr('تهيئة الرحلة', 'Configure journey')}</Button> : undefined} />
        <CardBody>
          <JourneyMap infos={infos} selected={selected} onSelect={(k) => setSelected(k === selected ? null : k)} />
          <div className="row wrap tiny muted" style={{ gap: 14, marginTop: 6 }}>
            <span className="row" style={{ gap: 4 }}><i className="dot primary" />{tr('مكتملة / متجاوزة', 'Completed / skipped')}</span>
            <span className="row" style={{ gap: 4 }}><Play size={12} />{tr('قيد التنفيذ', 'In progress')}</span>
            <span className="row" style={{ gap: 4 }}><i className="dot danger" />{tr('متوقفة', 'Blocked')}</span>
            <span className="row" style={{ gap: 4 }}><Lock size={12} />{tr('مقفلة (متطلبات غير مكتملة)', 'Locked (unmet prerequisites)')}</span>
            <span className="row" style={{ gap: 4 }}><ShieldCheck size={12} />{tr('تتطلب اعتمادًا', 'Requires approval')}</span>
            <span className="row" style={{ gap: 4 }}><Paperclip size={12} />{tr('أدلة مستوفاة / مطلوبة', 'Evidence satisfied / required')}</span>
          </div>
        </CardBody>
      </Card>

      {info ? <StagePanel key={info.stage.id} info={info} teams={teams.data ?? []} onClose={() => setSelected(null)} />
        : <Notice tone="info" icon={<Check />}>{tr('اختر مرحلة من الرحلة لعرض تفاصيلها.', 'Select a stage in the journey to see its details.')}</Notice>}

      <TabInsights links={['journey']} title={tr('ملاحظات المحرك على الرحلة', 'Engine findings on the journey')} />
      {pendingApproval > 0 && (
        <Notice tone="info" icon={<ShieldCheck />}>
          {tr('توجد مراحل بانتظار الاعتماد. يقرر المعتمدون من شاشة الحوكمة ← الاعتمادات.', 'Some stages await approval. Approvers decide from Governance → Approvals.')}{' '}
          <Badge tone="warning">{pendingApproval}</Badge>
        </Notice>
      )}
      {config && <JourneyConfigModal onClose={() => setConfig(false)} />}
    </div>
  );
}
