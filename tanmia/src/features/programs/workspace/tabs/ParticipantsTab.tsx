// Participants: enrollments, applications pipeline, cohorts, teams & members,
// projects and certificates.
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Award, Ban, Pencil, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAuth } from '@/app/AuthProvider';
import { useAsync } from '@/hooks/useAsync';
import { useAction } from '@/hooks/useAction';
import { all, insert, insertMany, maybe, remove, update } from '@/services/db';
import { errorOf, type AppError } from '@/services/errors';
import {
  Badge, Button, Card, CardBody, CardHeader, DataTable, Drawer, EntityPicker, Field, Input, Modal, Notice, Progress, Segmented, Select, StatusBadge, Tabs,
  useConfirm, type Column,
} from '@/components/ui';
import { RecordFormModal, type FieldSpec } from '@/components/forms/RecordForm';
import type {
  Beneficiary, Certificate, ProgramApplication, ProgramCohort, ProgramEnrollment, ProgramProject, ProgramTeam, ProgramTeamMember,
} from '@/types/db';
import { dateOrderError, errText } from '../../lib';
import { useWorkspace } from '../context';
import { RowActions, TabInsights } from '../components/common';

const DECIDED = new Set(['accepted', 'rejected', 'waitlisted', 'ineligible']);

export default function ParticipantsTab() {
  const { tr, fmtNumber, locale } = useI18n();
  const { org } = useOrg();
  const ws = useWorkspace();
  const [tab, setTab] = useState('enrollments');
  const extra = useAsync(async () => {
    const f: [string, 'eq', string][] = [['organization_id', 'eq', org.id], ['program_id', 'eq', ws.programId]];
    const [teams, projects, certificates] = await Promise.all([
      all<ProgramTeam>('program_teams', { filters: f, order: { column: 'name', ascending: true } }),
      all<ProgramProject>('program_projects', { filters: f }),
      all<Certificate>('certificates', { filters: f, order: { column: 'issued_on' } }),
    ]);
    const members = teams.length ? await all<ProgramTeamMember>('program_team_members', { filters: [['team_id', 'in', teams.map((t) => t.id)]], order: { column: 'created_at', ascending: true } }) : [];
    return { teams, projects, certificates, members };
  }, [ws.programId, org.id]);
  const data = extra.data ?? { teams: [], projects: [], certificates: [], members: [] };
  const b = ws.bundle;
  return (
    <div className="stack">
      <TabInsights links={['participants']} title={tr('ملاحظات المحرك: التسجيل والطاقة والتكرار', 'Engine findings: enrollment, capacity and duplicates')} />
      <Tabs value={tab} onChange={setTab} items={[
        { key: 'enrollments', label: tr('الملتحقون', 'Enrollments'), badge: <Badge>{fmtNumber(b.enrollments.length)}</Badge> },
        { key: 'applications', label: tr('الطلبات', 'Applications'), badge: <Badge>{fmtNumber(b.applications.length)}</Badge> },
        { key: 'cohorts', label: tr('الدفعات', 'Cohorts'), badge: <Badge>{fmtNumber(b.cohorts.length)}</Badge> },
        { key: 'teams', label: tr('الفرق', 'Teams'), badge: <Badge>{fmtNumber(data.teams.length)}</Badge> },
        { key: 'projects', label: tr('المشاريع', 'Projects'), badge: <Badge>{fmtNumber(data.projects.length)}</Badge> },
        { key: 'certificates', label: tr('الشهادات', 'Certificates'), badge: <Badge>{fmtNumber(data.certificates.length)}</Badge> },
      ]} />
      {extra.error && <Notice tone="danger">{errText(locale, extra.error)}</Notice>}
      {tab === 'enrollments' && <Enrollments />}
      {tab === 'applications' && <Applications />}
      {tab === 'cohorts' && <Cohorts />}
      {tab === 'teams' && <Teams teams={data.teams} members={data.members} reload={extra.reload} />}
      {tab === 'projects' && <Projects projects={data.projects} teams={data.teams} reload={extra.reload} />}
      {tab === 'certificates' && <Certificates certificates={data.certificates} reload={extra.reload} />}
    </div>
  );
}

// ------------------------------------------------------------------ enrollments
function Enrollments() {
  const { tr, fmtDate } = useI18n();
  const { can } = useOrg();
  const ws = useWorkspace();
  const b = ws.bundle;
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ProgramEnrollment | null>(null);
  const confirm = useConfirm();
  const del = useAction(async (id: string) => { await remove('program_enrollments', id); await ws.reload(); }, { success: ['تم حذف التسجيل', 'Enrollment removed'] });
  const attendance = useMemo(() => {
    const m = new Map<string, { marked: number; present: number }>();
    for (const p of b.participants) {
      if (p.attendance_status === 'unknown') continue;
      const x = m.get(p.beneficiary_id) ?? { marked: 0, present: 0 };
      x.marked++; if (p.attendance_status === 'present' || p.attendance_status === 'late') x.present++;
      m.set(p.beneficiary_id, x);
    }
    return m;
  }, [b.participants]);
  const att = (id: string) => { const x = attendance.get(id); return x && x.marked ? Math.round((x.present / x.marked) * 1000) / 10 : null; };
  const cols: Column<ProgramEnrollment>[] = [
    { key: 'ben', header: tr('المستفيد', 'Beneficiary'), sortable: true, value: (r) => ws.benName(r.beneficiary_id),
      render: (r) => <Link to={`/app/beneficiaries/${r.beneficiary_id}`} onClick={(e) => e.stopPropagation()}>{ws.benName(r.beneficiary_id)}</Link> },
    { key: 'cohort', header: tr('الدفعة', 'Cohort'), sortable: true, value: (r) => ws.cohortName(r.cohort_id) },
    { key: 'status', header: tr('الحالة', 'Status'), sortable: true, value: (r) => r.status, render: (r) => <StatusBadge group="enrollmentStatus" value={r.status} /> },
    { key: 'stage', header: tr('المرحلة الحالية', 'Current stage'), value: (r) => ws.stageName(r.current_stage_key) },
    { key: 'progress', header: tr('التقدم', 'Progress'), sortable: true, value: (r) => r.progress,
      render: (r) => <div className="row"><Progress value={r.progress} /><span className="tiny">{r.progress}%</span></div> },
    { key: 'attendance', header: tr('الحضور', 'Attendance'), align: 'end', sortable: true, value: (r) => att(r.beneficiary_id),
      render: (r) => { const a = att(r.beneficiary_id); return a === null ? <span className="muted">—</span> : <Badge tone={a < 60 ? 'danger' : a < 75 ? 'warning' : 'success'}>{a}%</Badge>; } },
    { key: 'enrolled_at', header: tr('تاريخ الالتحاق', 'Enrolled'), sortable: true, value: (r) => r.enrolled_at, render: (r) => fmtDate(r.enrolled_at) },
    { key: 'exit', header: tr('سبب الخروج', 'Exit reason'), value: (r) => r.exit_reason ?? '' },
    { key: 'actions', header: '', hideInExport: true, render: (r) => (
      <RowActions>
        {can('programs.edit') && <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => setEditing(r)} />}
        {can('programs.delete') && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')}
          onClick={async () => { if (await confirm({ title: tr('حذف التسجيل؟', 'Remove enrollment?'), message: tr('يفضل تغيير الحالة إلى «منسحب» للحفاظ على السجل التاريخي.', 'Prefer changing the status to “withdrawn” to keep history.'), danger: true })) void del.run(r.id); }} />}
      </RowActions>
    ) },
  ];
  return (
    <Card>
      <CardHeader icon={<Users />} title={tr('المستفيدون الملتحقون', 'Enrolled beneficiaries')}
        hint={`${tr('المستهدف', 'Target')}: ${b.program.target_beneficiaries ?? '—'}`}
        actions={can('programs.create') ? <Button size="sm" variant="primary" icon={<UserPlus />} onClick={() => setAddOpen(true)}>{tr('تسجيل مستفيد', 'Enroll beneficiary')}</Button> : undefined} />
      <CardBody flush>
        <DataTable rows={b.enrollments} rowKey={(r) => r.id} columns={cols} searchable exportName={`${b.program.code}-enrollments`}
          empty={{ title: tr('لا يوجد مستفيدون ملتحقون', 'No enrolled beneficiaries'), description: tr('سجّل مستفيدين مباشرة أو اقبل طلبات ثم سجّلهم.', 'Enroll beneficiaries directly or accept applications and enroll them.') }} />
      </CardBody>
      {addOpen && <EnrollModal onClose={() => setAddOpen(false)} />}
      {editing && <EnrollmentEdit enrollment={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function EnrollModal({ onClose }: { onClose: () => void }) {
  const { tr, locale, enumOptions } = useI18n();
  const { org, can } = useOrg();
  const ws = useWorkspace();
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [benId, setBenId] = useState<string | null>(null);
  const [cohort, setCohort] = useState('');
  const [nb, setNb] = useState({ full_name: '', full_name_en: '', gender: '', mobile: '', email: '', national_id: '', city: '' });
  const [dup, setDup] = useState<Beneficiary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const already = benId ? ws.bundle.enrollments.find((e) => e.beneficiary_id === benId) : undefined;
  const cohortRow = ws.bundle.cohorts.find((c) => c.id === cohort);
  const cohortCount = cohort ? ws.bundle.enrollments.filter((e) => e.cohort_id === cohort && !['withdrawn', 'dropped'].includes(e.status)).length : 0;
  const full = cohortRow && cohortRow.capacity !== null && cohortCount >= cohortRow.capacity;

  const enroll = async (beneficiaryId: string) => {
    await insert<ProgramEnrollment>('program_enrollments', {
      organization_id: org.id, program_id: ws.programId, beneficiary_id: beneficiaryId, cohort_id: cohort || null, status: 'active',
      current_stage_key: ws.bundle.stages.find((s) => s.status === 'in_progress')?.stage_key ?? null,
    });
  };
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      if (mode === 'existing') {
        if (!benId) throw { code: '23502', message: tr('اختر مستفيدًا', 'Select a beneficiary') };
        await enroll(benId);
      } else {
        if (!nb.full_name.trim()) throw { code: '23502', message: tr('الاسم مطلوب', 'Name is required') };
        if (!dup) {
          for (const [col, val] of [['national_id', nb.national_id.trim()], ['email', nb.email.trim().toLowerCase()], ['mobile', nb.mobile.trim()]] as const) {
            if (!val) continue;
            const hit = await maybe<Beneficiary>('beneficiaries', [['organization_id', 'eq', org.id], [col, 'eq', val]]);
            if (hit) { setDup(hit); setBusy(false); return; }
          }
        }
        const ben = await insert<Beneficiary>('beneficiaries', {
          organization_id: org.id, full_name: nb.full_name.trim(), full_name_en: nb.full_name_en.trim() || null, gender: nb.gender || null,
          mobile: nb.mobile.trim() || null, email: nb.email.trim().toLowerCase() || null, national_id: nb.national_id.trim() || null, city: nb.city.trim() || null,
        });
        await enroll(ben.id);
      }
      await ws.reload();
      onClose();
    } catch (e) { setError(errorOf(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open title={tr('تسجيل مستفيد في البرنامج', 'Enroll a beneficiary')} onClose={onClose} size="wide"
      footer={<><Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} disabled={!!already} onClick={() => void submit()}>{dup ? tr('إنشاء رغم التشابه وتسجيل', 'Create anyway & enroll') : tr('تسجيل', 'Enroll')}</Button></>}>
      {error && <Notice tone="danger">{errText(locale, error)}</Notice>}
      <Segmented value={mode} onChange={(m) => { setMode(m); setDup(null); }} options={[
        { value: 'existing', label: tr('مستفيد موجود', 'Existing beneficiary') },
        ...(can('beneficiaries.create') ? [{ value: 'new' as const, label: tr('مستفيد جديد', 'New beneficiary') }] : []),
      ]} />
      {mode === 'existing' ? (
        <Field label={tr('المستفيد', 'Beneficiary')} required>
          <EntityPicker kind="beneficiaries" organizationId={org.id} value={benId} onChange={(id) => setBenId(id)} />
        </Field>
      ) : (
        <div className="form-grid">
          <Field label={tr('الاسم الكامل', 'Full name')} required><Input value={nb.full_name} onChange={(e) => setNb({ ...nb, full_name: e.target.value })} /></Field>
          <Field label={tr('الاسم بالإنجليزية', 'English name')}><Input value={nb.full_name_en} onChange={(e) => setNb({ ...nb, full_name_en: e.target.value })} /></Field>
          <Field label={tr('الجنس', 'Gender')}><Select options={enumOptions('gender')} placeholder="—" value={nb.gender} onChange={(e) => setNb({ ...nb, gender: e.target.value })} /></Field>
          <Field label={tr('رقم الهوية', 'National ID')}><Input dir="ltr" value={nb.national_id} onChange={(e) => { setNb({ ...nb, national_id: e.target.value }); setDup(null); }} /></Field>
          <Field label={tr('الجوال', 'Mobile')}><Input dir="ltr" type="tel" value={nb.mobile} onChange={(e) => { setNb({ ...nb, mobile: e.target.value }); setDup(null); }} /></Field>
          <Field label={tr('البريد الإلكتروني', 'Email')}><Input dir="ltr" type="email" value={nb.email} onChange={(e) => { setNb({ ...nb, email: e.target.value }); setDup(null); }} /></Field>
          <Field label={tr('المدينة', 'City')}><Input value={nb.city} onChange={(e) => setNb({ ...nb, city: e.target.value })} /></Field>
        </div>
      )}
      {dup && (
        <Notice tone="warning">
          {tr(`يوجد مستفيد بنفس الهوية/البريد/الجوال: ${dup.full_name} (${dup.code}). يوصى بتسجيل السجل الموجود لتجنب التكرار وتضخم الأعداد.`,
            `A beneficiary with the same ID/email/mobile exists: ${dup.full_name} (${dup.code}). Enrolling the existing record avoids duplicates and inflated counts.`)}{' '}
          <Button size="sm" onClick={() => { setMode('existing'); setBenId(dup.id); setDup(null); }}>{tr('استخدام السجل الموجود', 'Use existing record')}</Button>
        </Notice>
      )}
      <Field label={tr('الدفعة', 'Cohort')}>
        <Select placeholder={tr('— بدون دفعة —', '— No cohort —')} value={cohort} onChange={(e) => setCohort(e.target.value)}
          options={ws.bundle.cohorts.map((c) => ({ value: c.id, label: `${c.name} (${ws.bundle.enrollments.filter((e) => e.cohort_id === c.id && !['withdrawn', 'dropped'].includes(e.status)).length}/${c.capacity ?? '∞'})` }))} />
      </Field>
      {full && <Notice tone="warning">{tr('الدفعة بلغت طاقتها الاستيعابية؛ التسجيل سيتجاوزها.', 'The cohort is at capacity; this enrollment will exceed it.')}</Notice>}
      {already && <Notice tone="warning">{tr('المستفيد مسجل بالفعل في البرنامج.', 'This beneficiary is already enrolled in the program.')}</Notice>}
    </Modal>
  );
}

function EnrollmentEdit({ enrollment, onClose }: { enrollment: ProgramEnrollment; onClose: () => void }) {
  const { tr } = useI18n();
  const ws = useWorkspace();
  const fields: FieldSpec[] = [
    { name: 'status', label: ['الحالة', 'Status'], type: 'enum', enumGroup: 'enrollmentStatus', required: true,
      hint: ['التخرج/الإكمال يسجل تاريخ الإكمال؛ الانسحاب يتطلب سببًا', 'Graduation/completion records a completion date; withdrawal requires a reason'] },
    { name: 'exit_reason', label: ['سبب الخروج', 'Exit reason'], type: 'textarea', visible: (v) => v.status === 'withdrawn' || v.status === 'dropped',
      validate: (v, all) => ((all.status === 'withdrawn' || all.status === 'dropped') && !String(v ?? '').trim() ? ['سبب الخروج مطلوب', 'Exit reason is required'] : null) },
    { name: 'cohort_id', label: ['الدفعة', 'Cohort'], type: 'select', options: ws.bundle.cohorts.map((c) => ({ value: c.id, label: c.name })) },
    { name: 'current_stage_key', label: ['المرحلة الحالية', 'Current stage'], type: 'select', options: ws.bundle.stages.map((s) => ({ value: s.stage_key, label: ws.stageName(s.stage_key) })) },
    { name: 'progress', label: ['التقدم %', 'Progress %'], type: 'number', min: 0, max: 100, step: 1 },
  ];
  return (
    <RecordFormModal open onClose={onClose} title={`${tr('تعديل التسجيل', 'Edit enrollment')}: ${ws.benName(enrollment.beneficiary_id)}`} fields={fields}
      initial={{ status: enrollment.status, exit_reason: enrollment.exit_reason, cohort_id: enrollment.cohort_id, current_stage_key: enrollment.current_stage_key, progress: enrollment.progress }}
      onSubmit={async (v) => {
        const done = v.status === 'graduated' || v.status === 'completed';
        await update<ProgramEnrollment>('program_enrollments', enrollment.id, {
          ...v, progress: v.progress ?? enrollment.progress, exit_reason: v.status === 'withdrawn' || v.status === 'dropped' ? v.exit_reason : null,
          completed_at: done ? enrollment.completed_at ?? new Date().toISOString() : null,
          ...(done && (v.progress === null || v.progress === undefined) ? { progress: 100 } : {}),
        });
        await ws.reload();
      }} />
  );
}

// ------------------------------------------------------------------ applications
function Applications() {
  const { tr, enumOptions, fmtDate, fmtNumber, locale } = useI18n();
  const { can, org } = useOrg();
  const { user } = useAuth();
  const ws = useWorkspace();
  const b = ws.bundle;
  const [filter, setFilter] = useState<string>('');
  const [deciding, setDeciding] = useState<ProgramApplication | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newBen, setNewBen] = useState<string | null>(null);
  const [newCohort, setNewCohort] = useState('');
  const [newErr, setNewErr] = useState<AppError | null>(null);
  const enrolledIds = new Set(b.enrollments.map((e) => e.beneficiary_id));
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of b.applications) m[a.status] = (m[a.status] ?? 0) + 1;
    return m;
  }, [b.applications]);
  const acceptedNotEnrolled = b.applications.filter((a) => a.status === 'accepted' && !enrolledIds.has(a.beneficiary_id));
  const enroll = useAction(async (apps: ProgramApplication[]) => {
    await insertMany('program_enrollments', apps.map((a) => ({ organization_id: org.id, program_id: ws.programId, beneficiary_id: a.beneficiary_id, cohort_id: a.cohort_id, status: 'active' })));
    await ws.reload();
  }, { success: ['تم تسجيل المقبولين', 'Accepted applicants enrolled'] });
  const createApp = useAction(async () => {
    if (!newBen) return;
    setNewErr(null);
    try {
      await insert<ProgramApplication>('program_applications', { organization_id: org.id, program_id: ws.programId, beneficiary_id: newBen, cohort_id: newCohort || null, status: 'submitted' });
      await ws.reload(); setNewOpen(false); setNewBen(null);
    } catch (e) { setNewErr(errorOf(e)); }
  });
  const rows = filter ? b.applications.filter((a) => a.status === filter) : b.applications;
  const cols: Column<ProgramApplication>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), render: (r) => <span className="mono">{r.code}</span>, value: (r) => r.code },
    { key: 'ben', header: tr('المتقدم', 'Applicant'), sortable: true, value: (r) => ws.benName(r.beneficiary_id) },
    { key: 'cohort', header: tr('الدفعة', 'Cohort'), value: (r) => ws.cohortName(r.cohort_id) },
    { key: 'status', header: tr('الحالة', 'Status'), sortable: true, value: (r) => r.status, render: (r) => <StatusBadge group="applicationStatus" value={r.status} /> },
    { key: 'score', header: tr('درجة الفرز', 'Screening'), align: 'end', sortable: true, value: (r) => r.screening_score },
    { key: 'applied', header: tr('تاريخ التقديم', 'Applied'), sortable: true, value: (r) => r.applied_at, render: (r) => fmtDate(r.applied_at) },
    { key: 'decided', header: tr('تاريخ القرار', 'Decided'), value: (r) => r.decided_at, render: (r) => fmtDate(r.decided_at) },
    { key: 'actions', header: '', hideInExport: true, render: (r) => (
      <RowActions>
        {r.status === 'accepted' && !enrolledIds.has(r.beneficiary_id) && can('programs.create') && (
          <Button size="sm" variant="primary" icon={<UserPlus />} loading={enroll.busy} onClick={() => void enroll.run([r])}>{tr('تسجيل', 'Enroll')}</Button>
        )}
        {r.status === 'accepted' && enrolledIds.has(r.beneficiary_id) && <Badge tone="success">{tr('مسجل', 'Enrolled')}</Badge>}
        {can('programs.edit') && <Button size="sm" onClick={() => setDeciding(r)}>{tr('قرار', 'Decide')}</Button>}
      </RowActions>
    ) },
  ];
  const decideFields: FieldSpec[] = [
    { name: 'status', label: ['الحالة / القرار', 'Status / decision'], type: 'enum', enumGroup: 'applicationStatus', required: true },
    { name: 'screening_score', label: ['درجة الفرز', 'Screening score'], type: 'number', min: 0, max: 100 },
    { name: 'cohort_id', label: ['الدفعة', 'Cohort'], type: 'select', options: b.cohorts.map((c) => ({ value: c.id, label: c.name })) },
    { name: 'eligibility_notes', label: ['ملاحظات الأهلية', 'Eligibility notes'], type: 'textarea' },
    { name: 'decision_note', label: ['مبرر القرار', 'Decision rationale'], type: 'textarea', hint: ['يوثق القرار للتدقيق والشفافية', 'Documents the decision for audit and transparency'],
      validate: (v, all) => (all.status === 'rejected' && !String(v ?? '').trim() ? ['يرجى توثيق سبب الرفض', 'Please document the rejection reason'] : null) },
  ];
  return (
    <Card>
      <CardHeader title={tr('مسار الطلبات', 'Applications pipeline')}
        actions={can('programs.create') ? <Button size="sm" icon={<Plus />} onClick={() => setNewOpen(true)}>{tr('طلب جديد', 'New application')}</Button> : undefined} />
      <CardBody>
        <div className="row wrap" style={{ gap: 6 }}>
          <Button size="sm" variant={filter === '' ? 'primary' : 'secondary'} onClick={() => setFilter('')}>{tr('الكل', 'All')} · {fmtNumber(b.applications.length)}</Button>
          {enumOptions('applicationStatus').map((o) => (
            <Button key={o.value} size="sm" variant={filter === o.value ? 'primary' : 'secondary'} onClick={() => setFilter(o.value)} disabled={!counts[o.value]}>
              {o.label} · {fmtNumber(counts[o.value] ?? 0)}
            </Button>
          ))}
        </div>
        {acceptedNotEnrolled.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <Notice tone="warning">
              {tr(`${acceptedNotEnrolled.length} مقبول غير مسجل — لن يظهروا في الحضور والقياس.`, `${acceptedNotEnrolled.length} accepted applicants are not enrolled — they will be missing from attendance and measurement.`)}{' '}
              {can('programs.create') && <Button size="sm" variant="primary" loading={enroll.busy} onClick={() => void enroll.run(acceptedNotEnrolled)}>{tr('تسجيلهم جميعًا', 'Enroll all')}</Button>}
            </Notice>
          </div>
        )}
      </CardBody>
      <CardBody flush>
        <DataTable rows={rows} rowKey={(r) => r.id} columns={cols} searchable exportName={`${b.program.code}-applications`}
          empty={{ title: tr('لا توجد طلبات', 'No applications') }} />
      </CardBody>
      <RecordFormModal open={!!deciding} onClose={() => setDeciding(null)} title={`${tr('قرار الطلب', 'Application decision')}: ${deciding ? ws.benName(deciding.beneficiary_id) : ''}`}
        fields={decideFields} initial={deciding ? { status: deciding.status, screening_score: deciding.screening_score, cohort_id: deciding.cohort_id, eligibility_notes: deciding.eligibility_notes, decision_note: deciding.decision_note } : {}}
        onSubmit={async (v) => {
          if (!deciding) return;
          const decided = DECIDED.has(String(v.status)) && v.status !== deciding.status;
          await update<ProgramApplication>('program_applications', deciding.id, { ...v, ...(decided ? { decided_at: new Date().toISOString(), decided_by: user?.id ?? null } : {}) });
          await ws.reload();
        }}
        intro={<p className="small muted">{tr('بعد القبول يظهر زر «تسجيل» لإنشاء التسجيل في البرنامج.', 'After acceptance an “Enroll” button appears to create the program enrollment.')}</p>} />
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title={tr('طلب التحاق جديد', 'New application')}
        footer={<><Button onClick={() => setNewOpen(false)}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" disabled={!newBen} loading={createApp.busy} onClick={() => void createApp.run()}>{tr('حفظ', 'Save')}</Button></>}>
        {newErr && <Notice tone="danger">{errText(locale, newErr)}</Notice>}
        <Field label={tr('المتقدم', 'Applicant')} required><EntityPicker kind="beneficiaries" organizationId={org.id} value={newBen} onChange={(id) => setNewBen(id)} /></Field>
        <Field label={tr('الدفعة', 'Cohort')}><Select placeholder="—" value={newCohort} onChange={(e) => setNewCohort(e.target.value)} options={b.cohorts.map((c) => ({ value: c.id, label: c.name }))} /></Field>
        {newBen && b.applications.some((a) => a.beneficiary_id === newBen) && <Notice tone="warning">{tr('لدى هذا المستفيد طلب في البرنامج بالفعل.', 'This beneficiary already has an application in this program.')}</Notice>}
      </Modal>
    </Card>
  );
}

// ------------------------------------------------------------------ cohorts
function Cohorts() {
  const { tr, fmtDate } = useI18n();
  const { can, org } = useOrg();
  const ws = useWorkspace();
  const b = ws.bundle;
  const confirm = useConfirm();
  const [editing, setEditing] = useState<ProgramCohort | 'new' | null>(null);
  const del = useAction(async (id: string) => { await remove('program_cohorts', id); await ws.reload(); }, { success: ['تم حذف الدفعة', 'Cohort deleted'] });
  const count = (id: string) => b.enrollments.filter((e) => e.cohort_id === id && !['withdrawn', 'dropped'].includes(e.status)).length;
  const fields: FieldSpec[] = [
    { name: 'name', label: ['اسم الدفعة', 'Cohort name'], type: 'text', required: true },
    { name: 'capacity', label: ['الطاقة الاستيعابية', 'Capacity'], type: 'number', min: 0, step: 1 },
    { name: 'start_date', label: ['البداية', 'Start'], type: 'date' },
    { name: 'end_date', label: ['النهاية', 'End'], type: 'date', validate: (v, all) => dateOrderError(all.start_date, v) },
    { name: 'status', label: ['الحالة', 'Status'], type: 'enum', enumGroup: 'cohortStatus', required: true },
  ];
  return (
    <Card>
      <CardHeader title={tr('الدفعات', 'Cohorts')}
        actions={can('programs.create') ? <Button size="sm" icon={<Plus />} onClick={() => setEditing('new')}>{tr('دفعة جديدة', 'New cohort')}</Button> : undefined} />
      <CardBody flush>
        <DataTable rows={b.cohorts} rowKey={(r) => r.id} exportName={`${b.program.code}-cohorts`} empty={{ title: tr('لا توجد دفعات', 'No cohorts') }}
          columns={[
            { key: 'code', header: tr('الرمز', 'Code'), render: (r) => <span className="mono">{r.code}</span>, value: (r) => r.code },
            { key: 'name', header: tr('الاسم', 'Name'), sortable: true },
            { key: 'fill', header: tr('الإشغال', 'Fill'), value: (r) => count(r.id), render: (r) => {
              const n = count(r.id); const over = r.capacity !== null && n > r.capacity;
              return <div className="row"><Progress value={r.capacity ? (n / r.capacity) * 100 : 0} tone={over ? 'danger' : undefined} /><span className="tiny nowrap">{n} / {r.capacity ?? '—'}</span>{over && <Badge tone="danger">{tr('تجاوز', 'Over')}</Badge>}</div>;
            } },
            { key: 'start_date', header: tr('البداية', 'Start'), render: (r) => fmtDate(r.start_date), value: (r) => r.start_date },
            { key: 'end_date', header: tr('النهاية', 'End'), render: (r) => fmtDate(r.end_date), value: (r) => r.end_date },
            { key: 'status', header: tr('الحالة', 'Status'), render: (r) => <StatusBadge group="cohortStatus" value={r.status} />, value: (r) => r.status },
            { key: 'actions', header: '', hideInExport: true, render: (r) => (
              <RowActions>
                {can('programs.edit') && <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => setEditing(r)} />}
                {can('programs.delete') && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')}
                  onClick={async () => { if (await confirm({ title: tr('حذف الدفعة؟', 'Delete cohort?'), message: tr('سيُفك ارتباط المستفيدين والجلسات بالدفعة.', 'Beneficiaries and sessions will be unlinked from the cohort.'), danger: true })) void del.run(r.id); }} />}
              </RowActions>
            ) },
          ]} />
      </CardBody>
      <RecordFormModal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? tr('دفعة جديدة', 'New cohort') : tr('تعديل الدفعة', 'Edit cohort')} fields={fields}
        initial={editing && editing !== 'new' ? { ...editing } : { status: 'planned', start_date: b.program.start_date, end_date: b.program.end_date }}
        onSubmit={async (v) => {
          if (editing && editing !== 'new') await update<ProgramCohort>('program_cohorts', editing.id, v);
          else await insert<ProgramCohort>('program_cohorts', { ...v, organization_id: org.id, program_id: ws.programId });
          await ws.reload();
        }} />
    </Card>
  );
}

// ------------------------------------------------------------------ teams
function Teams({ teams, members, reload }: { teams: ProgramTeam[]; members: ProgramTeamMember[]; reload: () => Promise<void> }) {
  const { tr, enumLabel } = useI18n();
  const { can, org } = useOrg();
  const ws = useWorkspace();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<ProgramTeam | 'new' | null>(null);
  const [open, setOpen] = useState<ProgramTeam | null>(null);
  const del = useAction(async (id: string) => { await remove('program_teams', id); await reload(); await ws.reload(); }, { success: ['تم حذف الفريق', 'Team deleted'] });
  const inTeam = new Set(members.map((m) => m.beneficiary_id));
  const unassigned = ws.enrolled.filter((b) => !inTeam.has(b.id)).length;
  const fields: FieldSpec[] = [
    { name: 'name', label: ['اسم الفريق', 'Team name'], type: 'text', required: true },
    { name: 'cohort_id', label: ['الدفعة', 'Cohort'], type: 'select', options: ws.bundle.cohorts.map((c) => ({ value: c.id, label: c.name })) },
    { name: 'challenge', label: ['التحدي', 'Challenge'], type: 'text' },
    { name: 'project_title', label: ['عنوان المشروع', 'Project title'], type: 'text' },
    { name: 'status', label: ['الحالة', 'Status'], type: 'enum', enumGroup: 'teamStatus', required: true },
  ];
  return (
    <Card>
      <CardHeader title={tr('الفرق', 'Teams')} hint={teams.length ? tr(`${unassigned} مستفيد ملتحق بلا فريق`, `${unassigned} enrolled beneficiaries without a team`) : undefined}
        actions={can('programs.create') ? <Button size="sm" icon={<Plus />} onClick={() => setEditing('new')}>{tr('فريق جديد', 'New team')}</Button> : undefined} />
      <CardBody flush>
        <DataTable rows={teams} rowKey={(r) => r.id} onRowClick={(r) => setOpen(r)} exportName={`${ws.bundle.program.code}-teams`}
          empty={{ title: tr('لا توجد فرق', 'No teams'), description: tr('الفرق أساسية في مسارات الهاكاثون والمعسكرات لربط الإرشاد والتحكيم.', 'Teams are central in hackathon and bootcamp tracks to link mentoring and judging.') }}
          columns={[
            { key: 'code', header: tr('الرمز', 'Code'), render: (r) => <span className="mono">{r.code}</span>, value: (r) => r.code },
            { key: 'name', header: tr('الاسم', 'Name'), sortable: true },
            { key: 'cohort', header: tr('الدفعة', 'Cohort'), value: (r) => ws.cohortName(r.cohort_id) },
            { key: 'challenge', header: tr('التحدي', 'Challenge'), value: (r) => r.challenge ?? '' },
            { key: 'members', header: tr('الأعضاء', 'Members'), align: 'end', value: (r) => members.filter((m) => m.team_id === r.id).length },
            { key: 'status', header: tr('الحالة', 'Status'), render: (r) => <StatusBadge group="teamStatus" value={r.status} />, value: (r) => enumLabel('teamStatus', r.status) },
            { key: 'actions', header: '', hideInExport: true, render: (r) => (
              <RowActions>
                {can('programs.edit') && <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => setEditing(r)} />}
                {can('programs.delete') && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')}
                  onClick={async () => { if (await confirm({ title: tr('حذف الفريق؟', 'Delete team?'), danger: true })) void del.run(r.id); }} />}
              </RowActions>
            ) },
          ]} />
      </CardBody>
      <RecordFormModal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? tr('فريق جديد', 'New team') : tr('تعديل الفريق', 'Edit team')} fields={fields}
        initial={editing && editing !== 'new' ? { ...editing } : { status: 'forming' }}
        onSubmit={async (v) => {
          if (editing && editing !== 'new') await update<ProgramTeam>('program_teams', editing.id, v);
          else await insert<ProgramTeam>('program_teams', { ...v, organization_id: org.id, program_id: ws.programId });
          await reload();
        }} />
      {open && <TeamMembers team={open} members={members.filter((m) => m.team_id === open.id)} allMembers={members} reload={reload} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function TeamMembers({ team, members, allMembers, reload, onClose }: { team: ProgramTeam; members: ProgramTeamMember[]; allMembers: ProgramTeamMember[]; reload: () => Promise<void>; onClose: () => void }) {
  const { tr } = useI18n();
  const { can, org } = useOrg();
  const ws = useWorkspace();
  const [ben, setBen] = useState('');
  const [role, setRole] = useState<'member' | 'lead'>('member');
  const add = useAction(async () => {
    await insert<ProgramTeamMember>('program_team_members', { organization_id: org.id, team_id: team.id, beneficiary_id: ben, role });
    setBen(''); await reload();
  }, { success: ['تمت إضافة العضو', 'Member added'] });
  const removeM = useAction(async (id: string) => { await remove('program_team_members', id); await reload(); });
  const setRoleM = useAction(async (id: string, r: 'lead' | 'member') => { await update<ProgramTeamMember>('program_team_members', id, { role: r }); await reload(); });
  const otherTeam = (bid: string) => allMembers.find((m) => m.beneficiary_id === bid && m.team_id !== team.id);
  const candidates = ws.enrolled.filter((b) => !members.some((m) => m.beneficiary_id === b.id));
  return (
    <Drawer open title={`${tr('أعضاء الفريق', 'Team members')}: ${team.name}`} onClose={onClose}>
      {!members.some((m) => m.role === 'lead') && members.length > 0 && <Notice tone="info">{tr('لم يُحدد قائد للفريق.', 'No team lead assigned.')}</Notice>}
      <ul className="list-plain">
        {members.map((m) => (
          <li key={m.id} className="row between">
            <span>{ws.benName(m.beneficiary_id)} {m.role === 'lead' && <Badge tone="primary">{tr('قائد', 'Lead')}</Badge>}</span>
            {can('programs.edit') && (
              <span className="row">
                <Button size="sm" variant="ghost" onClick={() => void setRoleM.run(m.id, m.role === 'lead' ? 'member' : 'lead')}>{m.role === 'lead' ? tr('عضو', 'Member') : tr('قائد', 'Lead')}</Button>
                <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('إزالة', 'Remove')} onClick={() => void removeM.run(m.id)} />
              </span>
            )}
          </li>
        ))}
        {!members.length && <li className="muted small">{tr('لا يوجد أعضاء.', 'No members.')}</li>}
      </ul>
      {can('programs.create') && (
        <div className="stack-sm">
          <Field label={tr('إضافة عضو من الملتحقين', 'Add an enrolled member')}>
            <Select placeholder="—" value={ben} onChange={(e) => setBen(e.target.value)} options={candidates.map((b) => ({ value: b.id, label: `${b.full_name}${otherTeam(b.id) ? ' · ' + tr('في فريق آخر', 'in another team') : ''}` }))} />
          </Field>
          <Segmented value={role} onChange={setRole} options={[{ value: 'member', label: tr('عضو', 'Member') }, { value: 'lead', label: tr('قائد', 'Lead') }]} />
          {ben && otherTeam(ben) && <Notice tone="warning">{tr('المستفيد عضو في فريق آخر بالفعل؛ تأكد أن ذلك مقصود.', 'The beneficiary already belongs to another team; make sure this is intended.')}</Notice>}
          <div><Button variant="primary" disabled={!ben} loading={add.busy} icon={<Plus />} onClick={() => void add.run()}>{tr('إضافة', 'Add')}</Button></div>
        </div>
      )}
    </Drawer>
  );
}

// ------------------------------------------------------------------ projects
function Projects({ projects, teams, reload }: { projects: ProgramProject[]; teams: ProgramTeam[]; reload: () => Promise<void> }) {
  const { tr, fmtDate } = useI18n();
  const { can, org } = useOrg();
  const ws = useWorkspace();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<ProgramProject | 'new' | null>(null);
  const del = useAction(async (id: string) => { await remove('program_projects', id); await reload(); }, { success: ['تم حذف المشروع', 'Project deleted'] });
  const fields: FieldSpec[] = [
    { name: 'title', label: ['عنوان المشروع', 'Project title'], type: 'text', required: true, full: true },
    { name: 'description', label: ['الوصف', 'Description'], type: 'textarea' },
    { name: 'team_id', label: ['الفريق', 'Team'], type: 'select', options: teams.map((t) => ({ value: t.id, label: t.name })) },
    { name: 'beneficiary_id', label: ['المستفيد', 'Beneficiary'], type: 'select', options: ws.enrolled.map((b) => ({ value: b.id, label: b.full_name })) },
    { name: 'stage_key', label: ['المرحلة', 'Stage'], type: 'select', options: ws.bundle.stages.map((s) => ({ value: s.stage_key, label: ws.stageName(s.stage_key) })) },
    { name: 'status', label: ['الحالة', 'Status'], type: 'enum', enumGroup: 'projectStatus', required: true },
    { name: 'score', label: ['الدرجة', 'Score'], type: 'number', min: 0, max: 100 },
    { name: 'due_date', label: ['تاريخ التسليم', 'Due date'], type: 'date' },
  ];
  return (
    <Card>
      <CardHeader title={tr('المشاريع', 'Projects')} actions={can('programs.create') ? <Button size="sm" icon={<Plus />} onClick={() => setEditing('new')}>{tr('مشروع جديد', 'New project')}</Button> : undefined} />
      <CardBody flush>
        <DataTable rows={projects} rowKey={(r) => r.id} searchable exportName={`${ws.bundle.program.code}-projects`} empty={{ title: tr('لا توجد مشاريع', 'No projects') }}
          columns={[
            { key: 'code', header: tr('الرمز', 'Code'), render: (r) => <span className="mono">{r.code}</span>, value: (r) => r.code },
            { key: 'title', header: tr('العنوان', 'Title'), sortable: true },
            { key: 'owner', header: tr('الفريق / المستفيد', 'Team / beneficiary'), value: (r) => teams.find((t) => t.id === r.team_id)?.name ?? (r.beneficiary_id ? ws.benName(r.beneficiary_id) : '—') },
            { key: 'stage', header: tr('المرحلة', 'Stage'), value: (r) => ws.stageName(r.stage_key) },
            { key: 'status', header: tr('الحالة', 'Status'), value: (r) => r.status, render: (r) => <StatusBadge group="projectStatus" value={r.status} /> },
            { key: 'score', header: tr('الدرجة', 'Score'), align: 'end', sortable: true, value: (r) => r.score },
            { key: 'due', header: tr('التسليم', 'Due'), value: (r) => r.due_date, render: (r) => fmtDate(r.due_date) },
            { key: 'actions', header: '', hideInExport: true, render: (r) => (
              <RowActions>
                {can('programs.edit') && <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => setEditing(r)} />}
                {can('programs.delete') && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')}
                  onClick={async () => { if (await confirm({ title: tr('حذف المشروع؟', 'Delete project?'), danger: true })) void del.run(r.id); }} />}
              </RowActions>
            ) },
          ]} />
      </CardBody>
      <RecordFormModal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? tr('مشروع جديد', 'New project') : tr('تعديل المشروع', 'Edit project')} fields={fields}
        initial={editing && editing !== 'new' ? { ...editing } : { status: 'proposed' }}
        onSubmit={async (v) => {
          if (editing && editing !== 'new') await update<ProgramProject>('program_projects', editing.id, v);
          else await insert<ProgramProject>('program_projects', { ...v, organization_id: org.id, program_id: ws.programId });
          await reload();
        }} />
    </Card>
  );
}

// ------------------------------------------------------------------ certificates
function Certificates({ certificates, reload }: { certificates: Certificate[]; reload: () => Promise<void> }) {
  const { tr, fmtDate, pick } = useI18n();
  const { can, org } = useOrg();
  const ws = useWorkspace();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const p = ws.bundle.program;
  const graduated = new Set(ws.bundle.enrollments.filter((e) => e.status === 'graduated' || e.status === 'completed').map((e) => e.beneficiary_id));
  const certified = new Set(certificates.filter((c) => c.status === 'issued').map((c) => c.beneficiary_id));
  const pending = [...graduated].filter((id) => !certified.has(id));
  const revoke = useAction(async (id: string) => { await update<Certificate>('certificates', id, { status: 'revoked' }); await reload(); }, { success: ['تم إلغاء الشهادة', 'Certificate revoked'] });
  const issueAll = useAction(async () => {
    await insertMany('certificates', pending.map((bid) => ({ organization_id: org.id, program_id: p.id, beneficiary_id: bid, title: `${tr('شهادة إتمام', 'Certificate of completion')} — ${pick(p.name, p.name_en)}` })));
    await reload();
  }, { success: ['تم إصدار الشهادات', 'Certificates issued'] });
  const fields: FieldSpec[] = [
    { name: 'beneficiary_id', label: ['المستفيد', 'Beneficiary'], type: 'select', required: true,
      options: ws.enrolled.map((b) => ({ value: b.id, label: `${b.full_name}${graduated.has(b.id) ? '' : ' · ' + tr('لم يكمل بعد', 'not completed yet')}` })) },
    { name: 'title', label: ['عنوان الشهادة', 'Certificate title'], type: 'text', required: true, full: true },
    { name: 'issued_on', label: ['تاريخ الإصدار', 'Issued on'], type: 'date', required: true },
  ];
  return (
    <Card>
      <CardHeader icon={<Award />} title={tr('الشهادات', 'Certificates')}
        actions={can('programs.edit') ? <>
          {pending.length > 0 && <Button size="sm" loading={issueAll.busy} onClick={() => void issueAll.run()}>{tr(`إصدار للمكملين (${pending.length})`, `Issue to completers (${pending.length})`)}</Button>}
          <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setOpen(true)}>{tr('إصدار شهادة', 'Issue certificate')}</Button>
        </> : undefined} />
      <CardBody flush>
        <DataTable rows={certificates} rowKey={(r) => r.id} searchable exportName={`${p.code}-certificates`} empty={{ title: tr('لا توجد شهادات', 'No certificates') }}
          columns={[
            { key: 'code', header: tr('الرمز', 'Code'), render: (r) => <span className="mono">{r.code}</span>, value: (r) => r.code },
            { key: 'ben', header: tr('المستفيد', 'Beneficiary'), value: (r) => ws.benName(r.beneficiary_id) },
            { key: 'title', header: tr('العنوان', 'Title') },
            { key: 'issued_on', header: tr('الإصدار', 'Issued'), value: (r) => r.issued_on, render: (r) => fmtDate(r.issued_on) },
            { key: 'status', header: tr('الحالة', 'Status'), value: (r) => r.status, render: (r) => <Badge tone={r.status === 'issued' ? 'success' : 'danger'}>{r.status === 'issued' ? tr('صادرة', 'Issued') : tr('ملغاة', 'Revoked')}</Badge> },
            { key: 'actions', header: '', hideInExport: true, render: (r) => (
              <RowActions>
                {can('programs.edit') && r.status === 'issued' && <Button size="sm" variant="ghost" icon={<Ban />}
                  onClick={async () => { if (await confirm({ title: tr('إلغاء الشهادة؟', 'Revoke certificate?'), danger: true })) void revoke.run(r.id); }}>{tr('إلغاء', 'Revoke')}</Button>}
              </RowActions>
            ) },
          ]} />
      </CardBody>
      <RecordFormModal open={open} onClose={() => setOpen(false)} title={tr('إصدار شهادة', 'Issue certificate')} fields={fields}
        initial={{ title: `${tr('شهادة إتمام', 'Certificate of completion')} — ${pick(p.name, p.name_en)}`, issued_on: new Date().toISOString().slice(0, 10) }}
        intro={<Notice tone="info">{tr('يوصى بإصدار الشهادات لمن أكملوا أو تخرجوا فقط؛ يُستخدم ذلك كدليل على المخرجات.', 'Issue certificates only to completers/graduates; they serve as output evidence.')}</Notice>}
        onSubmit={async (v) => { await insert<Certificate>('certificates', { ...v, organization_id: org.id, program_id: p.id }); await reload(); }} />
    </Card>
  );
}
