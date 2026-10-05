// Stage detail panel: workflow transitions (dependency / evidence / approval
// gates enforced by transition_program_stage), planning, evidence checklist,
// stage-specific records and beneficiary progress.
import { useMemo, useState, type ReactElement } from 'react';
import {
  AlertTriangle, Ban, Check, CheckCircle2, CircleDot, Lock, Paperclip, Pencil, Play, Plus, RotateCcw, ShieldCheck, SkipForward, Trash2, Upload, X,
} from 'lucide-react';
import { RECORD_TYPES } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import {
  Badge, BarList, Button, Card, CardBody, CardHeader, Checkbox, DataTable, EmptyState, Field, Input, Notice, Select, StatusBadge, Tabs, Textarea,
  useConfirm, type Column,
} from '@/components/ui';
import { remove, rpc, update, updateWhere } from '@/services/db';
import { useAction } from '@/hooks/useAction';
import type { EvidenceType, ProgramEnrollment, ProgramStage, ProgramStageRecord, ProgramTeam, StageStatus } from '@/types/db';
import { dateOrderError } from '../../lib';
import { useWorkspace } from '../context';
import type { StageInfo } from './journeyModel';
import { EvidenceUploadModal } from './EvidenceUploadModal';
import { StageRecordModal } from './StageRecordModal';
import { FileLink, RowActions } from './common';

interface TransitionResult { ok: boolean; code?: string; unmet?: string[] | null; missing?: string[] | null; approval_id?: string | null; overridden?: boolean; status?: string }

const TRANSITIONS: Record<StageStatus, StageStatus[]> = {
  not_started: ['in_progress', 'skipped'],
  in_progress: ['completed', 'blocked', 'not_started'],
  blocked: ['in_progress'],
  completed: ['in_progress'],
  skipped: ['not_started'],
};

export function StagePanel({ info, teams, onClose }: { info: StageInfo; teams: ProgramTeam[]; onClose: () => void }) {
  const { tr, pick } = useI18n();
  const s = info.stage;
  const [tab, setTab] = useState('workflow');
  return (
    <Card>
      <CardHeader icon={<CircleDot />} title={<>{pick(s.name_ar, s.name_en)} <StatusBadge group="stageStatus" value={s.status} /></>}
        hint={`${tr('المرحلة', 'Stage')} ${s.stage_order} · ${s.stage_key}`}
        actions={<Button size="sm" variant="ghost" iconOnly icon={<X />} aria-label={tr('إغلاق', 'Close')} onClick={onClose} />} />
      <div style={{ paddingInline: 12 }}>
        <Tabs value={tab} onChange={setTab} items={[
          { key: 'workflow', label: tr('سير العمل', 'Workflow') },
          { key: 'evidence', label: tr('الأدلة المطلوبة', 'Required evidence'), badge: info.evidenceMissing ? <Badge tone="warning">{info.evidenceMissing}</Badge> : undefined },
          { key: 'records', label: tr('سجلات المرحلة', 'Stage records'), badge: info.records ? <Badge>{info.records}</Badge> : undefined },
          { key: 'people', label: tr('تقدم المستفيدين', 'Beneficiary progress'), badge: info.participants ? <Badge>{info.participants}</Badge> : undefined },
        ]} />
      </div>
      <CardBody>
        {tab === 'workflow' && <WorkflowSection info={info} />}
        {tab === 'evidence' && <EvidenceSection info={info} />}
        {tab === 'records' && <RecordsSection stage={s} teams={teams} />}
        {tab === 'people' && <PeopleSection stage={s} />}
        {s.notes && tab === 'workflow' && <p className="small muted" style={{ marginTop: 8 }}>{tr('ملاحظات', 'Notes')}: {s.notes}</p>}
      </CardBody>
    </Card>
  );
}

// ------------------------------------------------------------------ workflow
function WorkflowSection({ info }: { info: StageInfo }) {
  const { tr, pick, enumLabel, fmtDate, locale } = useI18n();
  const { can } = useOrg();
  const ws = useWorkspace();
  const s = info.stage;
  const [target, setTarget] = useState<StageStatus | null>(null);
  const [note, setNote] = useState('');
  const [override, setOverride] = useState(false);
  const [result, setResult] = useState<TransitionResult | null>(null);
  const [noteErr, setNoteErr] = useState<string | null>(null);

  const transition = useAction(async (status: StageStatus, n: string, ov: boolean) => {
    const r = await rpc<TransitionResult>('transition_program_stage', { p_stage: s.id, p_status: status, p_note: n.trim() || null, p_override: ov });
    setResult({ ...r, status });
    if (r.ok || r.code === 'APPROVAL_REQUESTED') await ws.reload();
    if (r.ok) { setTarget(null); setNote(''); setOverride(false); }
    return r;
  });

  const go = () => {
    if (!target) return;
    if ((target === 'blocked' || override) && !note.trim()) {
      setNoteErr(override ? tr('التجاوز يتطلب ملاحظة توضح المبرر', 'An override requires a justification note') : tr('اكتب سبب التوقف', 'Describe the blocker'));
      return;
    }
    setNoteErr(null);
    void transition.run(target, note, override);
  };

  const label = (to: StageStatus): [string, ReactElement] => {
    if (to === 'in_progress') return s.status === 'blocked' ? [tr('استئناف', 'Resume'), <Play />] : s.status === 'completed' ? [tr('إعادة فتح', 'Reopen'), <RotateCcw />] : [tr('بدء المرحلة', 'Start stage'), <Play />];
    if (to === 'completed') return [tr('إكمال المرحلة', 'Complete stage'), <CheckCircle2 />];
    if (to === 'blocked') return [tr('تسجيل عائق', 'Mark blocked'), <Ban />];
    if (to === 'skipped') return [tr('تجاوز المرحلة', 'Skip stage'), <SkipForward />];
    return [tr('إعادة إلى «لم تبدأ»', 'Reset to not started'), <RotateCcw />];
  };
  const unmetNames = (keys: string[]) => keys.map((k) => ws.stageName(k)).join(locale === 'ar' ? '، ' : ', ');

  return (
    <div className="grid g-3-2">
      <div className="stack">
        {s.description && <p className="small">{s.description}</p>}
        <dl className="kv">
          <dt>{tr('الحالة', 'Status')}</dt><dd><StatusBadge group="stageStatus" value={s.status} /> <span className="small muted">{s.progress}%</span></dd>
          <dt>{tr('التواريخ المخططة', 'Planned dates')}</dt><dd>{fmtDate(s.planned_start)} – {fmtDate(s.planned_end)}</dd>
          <dt>{tr('التواريخ الفعلية', 'Actual dates')}</dt><dd>{fmtDate(s.actual_start)} – {fmtDate(s.actual_end)}</dd>
          <dt>{tr('الاعتماد', 'Approval')}</dt>
          <dd>{s.requires_approval ? <><StatusBadge group="approvalStatus" value={s.approval_status} /> <span className="tiny muted">{tr('الإكمال يتطلب اعتمادًا من الحوكمة', 'Completion requires a governance approval')}</span></> : <span className="muted">{tr('لا يتطلب', 'Not required')}</span>}</dd>
          {s.status === 'blocked' && <><dt>{tr('سبب التوقف', 'Blocker')}</dt><dd className="strong" style={{ color: 'var(--danger)' }}>{s.blocker_note ?? '—'}</dd></>}
        </dl>
        <div className="stack-sm">
          <span className="small strong">{tr('المتطلبات السابقة', 'Prerequisites')}</span>
          {info.deps.length === 0 ? <span className="small muted">{tr('لا توجد متطلبات — يمكن البدء مباشرة.', 'None — can start immediately.')}</span> : (
            <ul className="list-plain small">
              {info.deps.map((d) => (
                <li key={d.key} className="row between">
                  <span className="row">{d.met ? <Check size={14} color="var(--success)" /> : <Lock size={14} color="var(--warning)" />}{d.stage ? pick(d.stage.name_ar, d.stage.name_en) : d.key}</span>
                  {d.stage ? <StatusBadge group="stageStatus" value={d.stage.status} /> : <Badge tone="danger">{tr('غير موجودة', 'Missing')}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </div>
        {can('programs.configure') && <PlanningForm stage={s} />}
      </div>

      <div className="stack">
        <Card tinted>
          <CardHeader title={tr('تغيير حالة المرحلة', 'Change stage status')} />
          <CardBody>
            {!can('programs.edit') ? <Notice tone="info">{tr('تغيير الحالة يتطلب صلاحية تعديل البرامج.', 'Changing status requires programs.edit permission.')}</Notice> : (
              <div className="stack-sm">
                <div className="row wrap">
                  {TRANSITIONS[s.status as StageStatus].map((to) => {
                    const [l, icon] = label(to);
                    return <Button key={to} size="sm" variant={target === to ? 'primary' : to === 'blocked' ? 'danger' : 'secondary'} icon={icon}
                      onClick={() => { setTarget(to); setResult(null); setNoteErr(null); }}>{l}</Button>;
                  })}
                </div>
                {info.locked && <Notice tone="warning" icon={<Lock />}>{tr(`المرحلة مقفلة حتى اكتمال: ${unmetNames(info.unmet)}`, `Locked until complete: ${unmetNames(info.unmet)}`)}</Notice>}
                {target && (
                  <div className="stack-sm">
                    <Field label={target === 'blocked' ? tr('سبب التوقف', 'Blocker note') : tr('ملاحظة', 'Note')} required={target === 'blocked' || override} error={noteErr}>
                      <Textarea value={note} onChange={(e) => setNote(e.target.value)} invalid={!!noteErr}
                        placeholder={target === 'completed' && s.requires_approval ? tr('تُرسل مع طلب الاعتماد', 'Sent with the approval request') : undefined} />
                    </Field>
                    {can('programs.approve') && ['in_progress', 'completed'].includes(target) && (
                      <Checkbox checked={override} onChange={setOverride}
                        label={<span className="small">{tr('تجاوز البوابات (المتطلبات/الأدلة/الاعتماد) — يُسجل في سجل التدقيق مع الملاحظة', 'Override gates (prerequisites/evidence/approval) — recorded in the audit log with the note')}</span>} />
                    )}
                    <div className="row">
                      <Button variant="primary" loading={transition.busy} onClick={go}>{tr('تنفيذ', 'Apply')}: {enumLabel('stageStatus', target)}</Button>
                      <Button variant="ghost" onClick={() => { setTarget(null); setOverride(false); }}>{tr('إلغاء', 'Cancel')}</Button>
                    </div>
                  </div>
                )}
                {result && <TransitionNotice result={result} unmetNames={unmetNames} />}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function TransitionNotice({ result, unmetNames }: { result: TransitionResult; unmetNames: (k: string[]) => string }) {
  const { tr, enumLabel, locale } = useI18n();
  const { can } = useOrg();
  const sep = locale === 'ar' ? '، ' : ', ';
  if (result.ok) {
    return <Notice tone="success" icon={<CheckCircle2 />}>
      {tr(`تم تغيير الحالة إلى «${enumLabel('stageStatus', result.status)}».`, `Status changed to “${enumLabel('stageStatus', result.status)}”.`)}
      {result.overridden && <> {tr('تم ذلك بتجاوز موثق في سجل التدقيق.', 'This was done with an override recorded in the audit log.')}</>}
    </Notice>;
  }
  const overrideHint = can('programs.approve')
    ? tr('بصفتك معتمدًا يمكنك التجاوز مع ملاحظة إلزامية توضح المبرر.', 'As an approver you may override with a mandatory justification note.')
    : tr('التجاوز متاح فقط لمن يملك صلاحية اعتماد البرامج.', 'Override is only available to users with program approval rights.');
  switch (result.code) {
    case 'DEPENDENCIES_NOT_MET':
      return <Notice tone="warning" icon={<Lock />}>
        <b>{tr('المتطلبات السابقة غير مكتملة', 'Prerequisites are not complete')}</b><br />
        {tr(`يجب إكمال أو تجاوز المراحل: ${unmetNames(result.unmet ?? [])}. البدء قبلها يربك تسلسل الرحلة ويضعف موثوقية القياس.`,
          `Complete or skip these stages first: ${unmetNames(result.unmet ?? [])}. Starting early breaks the journey sequence and weakens measurement reliability.`)}<br />
        <span className="small">{overrideHint}</span>
      </Notice>;
    case 'EVIDENCE_MISSING':
      return <Notice tone="warning" icon={<Paperclip />}>
        <b>{tr('أدلة مطلوبة غير مرفوعة', 'Required evidence missing')}</b><br />
        {tr(`لا يمكن الإكمال دون دليل من نوع: ${(result.missing ?? []).map((t) => enumLabel('evidenceType', t)).join(sep)}. ارفعه من قسم «الأدلة المطلوبة».`,
          `Completion needs evidence of type: ${(result.missing ?? []).map((t) => enumLabel('evidenceType', t)).join(sep)}. Upload it from “Required evidence”.`)}<br />
        <span className="small">{overrideHint}</span>
      </Notice>;
    case 'APPROVAL_REQUESTED':
      return <Notice tone="info" icon={<ShieldCheck />}>
        <b>{tr('أُرسل طلب اعتماد', 'Approval requested')}</b><br />
        {result.approval_id
          ? tr('أُنشئ طلب اعتماد لإكمال المرحلة؛ تبقى المرحلة «قيد التنفيذ» حتى يقرر المعتمد في شاشة الحوكمة ← الاعتمادات. لا يمكن لمقدم الطلب اعتماد طلبه بنفسه.',
            'An approval request was created; the stage stays “in progress” until an approver decides in Governance → Approvals. Requesters cannot approve their own request.')
          : tr('يوجد طلب اعتماد معلق لهذه المرحلة بالفعل؛ بانتظار قرار المعتمد.', 'An approval request is already pending for this stage; awaiting the approver’s decision.')}
      </Notice>;
    case 'BLOCKER_NOTE_REQUIRED':
      return <Notice tone="warning" icon={<AlertTriangle />}>{tr('تسجيل عائق يتطلب ملاحظة توضح السبب حتى يمكن معالجته وتصعيده.', 'Marking a stage blocked requires a note explaining the cause so it can be resolved or escalated.')}</Notice>;
    default:
      return <Notice tone="danger">{result.code ?? tr('تعذر تنفيذ الانتقال', 'Transition failed')}</Notice>;
  }
}

function PlanningForm({ stage }: { stage: ProgramStage }) {
  const { tr } = useI18n();
  const ws = useWorkspace();
  const [v, setV] = useState({ planned_start: stage.planned_start ?? '', planned_end: stage.planned_end ?? '', progress: String(stage.progress), notes: stage.notes ?? '' });
  const [err, setErr] = useState<string | null>(null);
  const p = ws.bundle.program;
  const save = useAction(async () => {
    await update<ProgramStage>('program_stages', stage.id, {
      planned_start: v.planned_start || null, planned_end: v.planned_end || null,
      progress: Math.max(0, Math.min(100, Math.round(Number(v.progress) || 0))), notes: v.notes.trim() || null,
    });
    await ws.reload();
  }, { success: ['تم حفظ تخطيط المرحلة', 'Stage planning saved'] });
  const submit = () => {
    const e = dateOrderError(v.planned_start, v.planned_end);
    setErr(e ? tr(e[0], e[1]) : null);
    if (!e) void save.run();
  };
  const outside = (p.start_date && v.planned_start && v.planned_start < p.start_date) || (p.end_date && v.planned_end && v.planned_end > p.end_date);
  return (
    <div className="stack-sm">
      <span className="small strong">{tr('تخطيط المرحلة', 'Stage planning')}</span>
      <div className="form-grid">
        <Field label={tr('البداية المخططة', 'Planned start')}><Input type="date" value={v.planned_start} onChange={(e) => setV({ ...v, planned_start: e.target.value })} /></Field>
        <Field label={tr('النهاية المخططة', 'Planned end')} error={err}><Input type="date" value={v.planned_end} onChange={(e) => setV({ ...v, planned_end: e.target.value })} invalid={!!err} /></Field>
        <Field label={tr('نسبة التقدم %', 'Progress %')}><Input type="number" min={0} max={100} dir="ltr" value={v.progress} onChange={(e) => setV({ ...v, progress: e.target.value })} /></Field>
        <Field label={tr('ملاحظات', 'Notes')}><Input value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      </div>
      {outside && <Notice tone="warning">{tr('التواريخ خارج مدة البرنامج.', 'Dates fall outside the program period.')}</Notice>}
      <div><Button size="sm" variant="primary" loading={save.busy} onClick={submit}>{tr('حفظ التخطيط', 'Save planning')}</Button></div>
    </div>
  );
}

// ------------------------------------------------------------------ evidence
function EvidenceSection({ info }: { info: StageInfo }) {
  const { tr, enumLabel, fmtDate } = useI18n();
  const { can } = useOrg();
  const ws = useWorkspace();
  const s = info.stage;
  const [upload, setUpload] = useState<{ type?: EvidenceType } | null>(null);
  const rows = ws.bundle.evidence.filter((e) => e.stage_key === s.stage_key);
  return (
    <div className="stack">
      <div className="row between wrap">
        <p className="small muted">{tr('الأدلة التي يحددها مسار البرنامج لإكمال هذه المرحلة. الأدلة بحالة «بانتظار التحقق» أو «متحقق منه» تستوفي الشرط؛ المرفوضة لا تستوفيه.',
          'Evidence this program’s journey requires to complete the stage. Evidence pending or verified satisfies the gate; rejected evidence does not.')}</p>
        {can('evidence.create') && <Button size="sm" icon={<Upload />} onClick={() => setUpload({})}>{tr('رفع دليل للمرحلة', 'Upload stage evidence')}</Button>}
      </div>
      {info.evidence.length === 0 ? <Notice tone="info">{tr('لا تتطلب هذه المرحلة أدلة إلزامية. يمكنك مع ذلك رفع أدلة داعمة.', 'This stage has no mandatory evidence. You can still upload supporting evidence.')}</Notice> : (
        <ul className="list-plain">
          {info.evidence.map((e) => (
            <li key={e.type} className="row between">
              <span className="row">{e.satisfied ? <CheckCircle2 size={16} color="var(--success)" /> : <AlertTriangle size={16} color="var(--warning)" />}
                <span><b>{enumLabel('evidenceType', e.type)}</b> <span className="small muted">{e.satisfied ? tr(`${e.count} دليل مرتبط`, `${e.count} linked`) : tr('مفقود', 'Missing')}</span></span></span>
              {can('evidence.create') && !e.satisfied && <Button size="sm" variant="primary" icon={<Upload />} onClick={() => setUpload({ type: e.type as EvidenceType })}>{tr('رفع', 'Upload')}</Button>}
            </li>
          ))}
        </ul>
      )}
      <DataTable rows={rows} rowKey={(r) => r.id} dense empty={{ title: tr('لا توجد أدلة مرتبطة بالمرحلة', 'No evidence linked to this stage') }}
        columns={[
          { key: 'code', header: tr('الرمز', 'Code'), render: (r) => <span className="mono">{r.code}</span> },
          { key: 'title', header: tr('العنوان', 'Title') },
          { key: 'evidence_type', header: tr('النوع', 'Type'), render: (r) => enumLabel('evidenceType', r.evidence_type) },
          { key: 'verification_status', header: tr('التحقق', 'Verification'), render: (r) => <StatusBadge group="verification" value={r.verification_status} /> },
          { key: 'created_at', header: tr('التاريخ', 'Date'), render: (r) => fmtDate(r.created_at) },
          { key: 'file', header: '', render: (r) => <FileLink bucket="evidence" path={r.file_path} url={r.source_url} /> },
        ]} />
      <EvidenceUploadModal open={!!upload} onClose={() => setUpload(null)} lock={['stage_key']}
        preset={{ stage_key: s.stage_key, evidence_type: upload?.type, title: upload?.type ? `${enumLabel('evidenceType', upload.type)} — ${ws.stageName(s.stage_key)}` : undefined }} />
    </div>
  );
}

// ------------------------------------------------------------------ records
function RecordsSection({ stage, teams }: { stage: ProgramStage; teams: ProgramTeam[] }) {
  const { tr, L, enumLabel, fmtDate } = useI18n();
  const { can } = useOrg();
  const ws = useWorkspace();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<{ type: string; row: ProgramStageRecord | null } | null>(null);
  const del = useAction(async (id: string) => { await remove('program_stage_records', id); await ws.reload(); }, { success: ['تم حذف السجل', 'Record deleted'] });
  const teamName = (id: string | null) => (id ? teams.find((t) => t.id === id)?.name ?? '—' : null);

  if (!stage.record_types.length) {
    return <EmptyState compact title={tr('لا توجد نماذج سجلات لهذه المرحلة', 'No record forms for this stage')}
      description={tr('يمكن متابعة المرحلة عبر الجلسات والأدلة والمعالم.', 'Track the stage through sessions, evidence and milestones.')} />;
  }
  return (
    <div className="stack">
      {stage.record_types.map((rt) => {
        const def = RECORD_TYPES[rt];
        const rows = ws.bundle.stageRecords.filter((r) => r.stage_key === stage.stage_key && r.record_type === rt);
        const scored = def?.fields.some((f) => f.scored);
        const cols: Column<ProgramStageRecord>[] = [
          { key: 'title', header: tr('العنوان', 'Title'), sortable: true },
          { key: 'subject', header: tr('الجهة', 'Subject'), value: (r) => (r.beneficiary_id ? ws.benName(r.beneficiary_id) : teamName(r.team_id) ?? (r.expert_id ? ws.expertName(r.expert_id) : '—')) },
          ...(scored ? [{ key: 'score', header: tr('الدرجة', 'Score'), align: 'end' as const, sortable: true, value: (r: ProgramStageRecord) => r.score }] : []),
          { key: 'status', header: tr('الحالة', 'Status'), render: (r) => <StatusBadge group="actionStatus" value={r.status} />, value: (r) => r.status },
          { key: 'due_date', header: tr('الاستحقاق', 'Due'), render: (r) => fmtDate(r.due_date), value: (r) => r.due_date },
          { key: 'created_at', header: tr('أنشئ', 'Created'), render: (r) => fmtDate(r.created_at), value: (r) => r.created_at, sortable: true },
          {
            key: 'actions', header: '', hideInExport: true, render: (r) => (
              <RowActions>
                {can('programs.edit') && <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => setEditing({ type: rt, row: r })} />}
                {can('programs.delete') && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')}
                  onClick={async () => { if (await confirm({ title: tr('حذف السجل؟', 'Delete record?'), danger: true })) void del.run(r.id); }} />}
              </RowActions>
            ),
          },
        ];
        return (
          <Card key={rt}>
            <CardHeader title={def ? L({ ar: def.name_ar, en: def.name_en }) : rt} hint={`${rows.length} ${tr('سجل', 'records')}${scored && rows.length ? ` · ${tr('متوسط الدرجة', 'avg score')} ${avgScore(rows)}` : ''}`}
              actions={can('programs.create') && def ? <Button size="sm" icon={<Plus />} onClick={() => setEditing({ type: rt, row: null })}>{tr('إضافة', 'Add')}</Button> : undefined} />
            <CardBody flush>
              <DataTable rows={rows} rowKey={(r) => r.id} columns={cols} exportName={`${ws.bundle.program.code}-${stage.stage_key}-${rt}`}
                empty={{ title: tr('لا توجد سجلات بعد', 'No records yet'), description: def ? enumLabel('stageStatus', stage.status) : undefined }} />
            </CardBody>
          </Card>
        );
      })}
      {editing && <StageRecordModal open onClose={() => setEditing(null)} stageKey={stage.stage_key} recordType={editing.type} existing={editing.row} teams={teams} />}
    </div>
  );
}
function avgScore(rows: ProgramStageRecord[]): string {
  const xs = rows.map((r) => r.score).filter((x): x is number => x !== null).map(Number);
  return xs.length ? (Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10).toString() : '—';
}

// ------------------------------------------------------------------ people
function PeopleSection({ stage }: { stage: ProgramStage }) {
  const { tr, enumLabel } = useI18n();
  const { can } = useOrg();
  const ws = useWorkspace();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'stage' | 'all'>('stage');
  const [targetKey, setTargetKey] = useState(stage.stage_key);
  const active = ws.bundle.enrollments.filter((e) => !['withdrawn', 'dropped'].includes(e.status));
  const dist = useMemo(() => {
    const items = ws.bundle.stages.map((s) => ({ label: ws.stageName(s.stage_key), value: active.filter((e) => e.current_stage_key === s.stage_key).length }));
    const unset = active.filter((e) => !e.current_stage_key).length;
    return unset ? [...items, { label: tr('غير محدد', 'Not set'), value: unset }] : items;
  }, [active, ws, tr]);
  const rows = filter === 'stage' ? active.filter((e) => e.current_stage_key === stage.stage_key) : active;
  const apply = useAction(async () => {
    await updateWhere('program_enrollments', [['id', 'in', [...selected]], ['program_id', 'eq', ws.programId]], { current_stage_key: targetKey || null });
    setSelected(new Set());
    await ws.reload();
  }, { success: ['تم تحديث مرحلة المستفيدين', 'Beneficiary stage updated'] });
  const toggle = (id: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  return (
    <div className="grid g-1-2">
      <div className="stack-sm">
        <span className="small strong">{tr('توزيع المستفيدين على المراحل', 'Beneficiaries by current stage')}</span>
        {active.length ? <BarList items={dist} /> : <span className="small muted">{tr('لا يوجد مستفيدون مسجلون.', 'No enrolled beneficiaries.')}</span>}
      </div>
      <div className="stack-sm">
        <div className="row between wrap">
          <Select aria-label={tr('عرض', 'Show')} value={filter} onChange={(e) => setFilter(e.target.value as 'stage' | 'all')} style={{ width: 220 }}
            options={[{ value: 'stage', label: tr('في هذه المرحلة', 'At this stage') }, { value: 'all', label: tr('كل المسجلين', 'All enrolled') }]} />
          {can('programs.edit') && (
            <div className="row">
              <Select aria-label={tr('المرحلة الهدف', 'Target stage')} value={targetKey} onChange={(e) => setTargetKey(e.target.value)} style={{ width: 200 }}
                options={[{ value: '', label: tr('— بدون —', '— None —') }, ...ws.bundle.stages.map((s) => ({ value: s.stage_key, label: ws.stageName(s.stage_key) }))]} />
              <Button size="sm" variant="primary" disabled={!selected.size} loading={apply.busy} onClick={() => void apply.run()}>
                {tr(`نقل المحددين (${selected.size})`, `Move selected (${selected.size})`)}
              </Button>
            </div>
          )}
        </div>
        <DataTable rows={rows} rowKey={(r) => r.id} pageSize={15} searchable
          empty={{ title: filter === 'stage' ? tr('لا يوجد مستفيدون في هذه المرحلة', 'No beneficiaries at this stage') : tr('لا يوجد مستفيدون', 'No beneficiaries') }}
          columns={[
            ...(can('programs.edit') ? [{
              key: 'sel', header: '', hideInExport: true, width: 32,
              render: (r: ProgramEnrollment) => <input type="checkbox" aria-label={tr('تحديد', 'Select')} checked={selected.has(r.id)} onChange={(e) => toggle(r.id, e.target.checked)} />,
            }] : []),
            { key: 'ben', header: tr('المستفيد', 'Beneficiary'), value: (r) => ws.benName(r.beneficiary_id) },
            { key: 'cohort', header: tr('الدفعة', 'Cohort'), value: (r) => ws.cohortName(r.cohort_id) },
            { key: 'stage', header: tr('المرحلة الحالية', 'Current stage'), value: (r) => ws.stageName(r.current_stage_key) },
            { key: 'status', header: tr('الحالة', 'Status'), value: (r) => enumLabel('enrollmentStatus', r.status) },
            { key: 'progress', header: tr('التقدم', 'Progress'), align: 'end', value: (r) => `${r.progress}%` },
          ]} />
        {can('programs.edit') && rows.length > 0 && (
          <div className="row">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(rows.map((r) => r.id)))}>{tr('تحديد الكل', 'Select all')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>{tr('إلغاء التحديد', 'Clear')}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
