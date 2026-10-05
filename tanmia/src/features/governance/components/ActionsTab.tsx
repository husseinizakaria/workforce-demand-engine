import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Check, ListChecks, Pencil, Plus } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { AsyncView, Badge, Button, Card, CardBody, CardHeader, Checkbox, DataTable, Kpi, Select, StatusBadge, toneOf, useToast, type Column } from '@/components/ui';
import { RecordFormModal, type FieldSpec } from '@/components/forms/RecordForm';
import { useAsync } from '@/hooks/useAsync';
import { all, insert, update } from '@/services/db';
import { todayISO } from '@/utils/dates';
import type { ProgramAction } from '@/types/db';
import { memberLabel, memberOptions, useErrMsg, useMembers, usePrograms } from '../shared';

export function ActionsTab() {
  const { tr, pick, enumLabel, enumOptions, fmtDate, fmtNumber } = useI18n();
  const { org, can } = useOrg();
  const toast = useToast(); const errMsg = useErrMsg();
  const programs = usePrograms(); const members = useMembers();
  const [status, setStatus] = useState('open_all'); const [priority, setPriority] = useState(''); const [program, setProgram] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [edit, setEdit] = useState<ProgramAction | 'new' | null>(null);
  const state = useAsync(() => all<ProgramAction>('program_actions', { filters: [['organization_id', 'eq', org.id]], order: [{ column: 'due_date', ascending: true }] }, 5000), [org.id]);
  const today = todayISO();
  const isOverdue = (a: ProgramAction) => ['open', 'in_progress'].includes(a.status) && !!a.due_date && a.due_date < today;
  const pname = (id: string | null) => { const p = id ? programs.data?.find((x) => x.id === id) : undefined; return p ? pick(p.name, p.name_en) : '—'; };
  const owner = (a: ProgramAction) => (a.owner_user_id ? memberLabel(members.data?.find((m) => m.user_id === a.owner_user_id)) : a.owner_name ?? '—');

  const fields = useMemo<FieldSpec[]>(() => [
    { name: 'title', label: ['الإجراء', 'Action'], type: 'text', required: true, full: true },
    { name: 'program_id', label: ['البرنامج', 'Program'], type: 'select', options: (programs.data ?? []).map((p) => ({ value: p.id, label: `${pick(p.name, p.name_en)} · ${p.code}` })) },
    { name: 'priority', label: ['الأولوية', 'Priority'], type: 'enum', enumGroup: 'priority', required: true },
    { name: 'owner_user_id', label: ['المسؤول (مستخدم)', 'Owner (user)'], type: 'select', options: memberOptions(members.data) },
    { name: 'owner_name', label: ['أو اسم المسؤول', 'Or owner name'], type: 'text', hint: ['لمسؤول خارج المنصة', 'For an owner outside the platform'] },
    { name: 'due_date', label: ['الموعد', 'Due date'], type: 'date' },
    { name: 'status', label: ['الحالة', 'Status'], type: 'enum', enumGroup: 'actionStatus', required: true },
    { name: 'description', label: ['الوصف', 'Description'], type: 'textarea' },
    { name: 'completion_note', label: ['ملاحظة الإنجاز', 'Completion note'], type: 'textarea', visible: (v) => v.status === 'done' },
  ], [programs.data, members.data, pick]);
  const save = async (v: Record<string, unknown>) => {
    if (!v.owner_user_id && !String(v.owner_name ?? '').trim()) throw { code: '23502', message_ar: 'حدد مسؤولًا عن الإجراء (مستخدمًا أو اسمًا).', message_en: 'Set an owner for the action (user or name).' };
    const patch = { ...v, completed_at: v.status === 'done' ? (edit && edit !== 'new' && edit.completed_at) || new Date().toISOString() : null };
    if (edit === 'new') await insert('program_actions', { ...patch, organization_id: org.id, source: 'manual' });
    else if (edit) await update('program_actions', edit.id, patch);
    toast.success(tr('تم الحفظ', 'Saved')); void state.reload();
  };
  const markDone = async (a: ProgramAction) => {
    try { await update('program_actions', a.id, { status: 'done', completed_at: new Date().toISOString() }); toast.success(tr('أُنجز الإجراء', 'Action completed')); void state.reload(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <AsyncView state={state}>
      {(actions) => {
        const open = actions.filter((a) => ['open', 'in_progress'].includes(a.status));
        const overdue = open.filter(isOverdue);
        const rows = actions.filter((a) => (status === 'open_all' ? ['open', 'in_progress'].includes(a.status) : !status || a.status === status)
          && (!priority || a.priority === priority) && (!program || a.program_id === program) && (!overdueOnly || isOverdue(a)));
        const columns: Column<ProgramAction>[] = [
          { key: 'code', header: tr('الرمز', 'Code'), sortable: true, render: (a) => <span className="mono small">{a.code}</span> },
          { key: 'title', header: tr('الإجراء', 'Action'), sortable: true, render: (a) => <div className="stack-sm" style={{ gap: 2 }}><b className="small">{a.title}</b>{a.source !== 'manual' && <span className="tiny muted">{tr('المصدر', 'Source')}: {a.source}</span>}</div> },
          { key: 'program', header: tr('البرنامج', 'Program'), value: (a) => pname(a.program_id), render: (a) => a.program_id ? <Link className="small" to={`/app/programs/${a.program_id}`}>{pname(a.program_id)}</Link> : '—' },
          { key: 'owner', header: tr('المسؤول', 'Owner'), value: owner, render: (a) => (owner(a) === '—' ? <Badge tone="warning">{tr('بلا مسؤول', 'No owner')}</Badge> : <span className="small">{owner(a)}</span>) },
          { key: 'due', header: tr('الموعد', 'Due'), sortable: true, value: (a) => a.due_date, render: (a) => <span className="row small" style={{ gap: 4 }}>{fmtDate(a.due_date)}{isOverdue(a) && <Badge tone="danger">{tr('متأخر', 'Overdue')}</Badge>}</span> },
          { key: 'priority', header: tr('الأولوية', 'Priority'), sortable: true, value: (a) => ({ critical: 4, high: 3, medium: 2, low: 1 })[a.priority], render: (a) => <Badge tone={toneOf(a.priority)}>{enumLabel('priority', a.priority)}</Badge> },
          { key: 'status', header: tr('الحالة', 'Status'), value: (a) => a.status, render: (a) => <StatusBadge group="actionStatus" value={a.status} /> },
          { key: 'actions', header: '', hideInExport: true, render: (a) => can('operations.edit') ? (
            <div className="row" style={{ gap: 2 }}>
              {['open', 'in_progress'].includes(a.status) && <Button size="sm" variant="ghost" icon={<Check />} onClick={() => void markDone(a)}>{tr('إنجاز', 'Done')}</Button>}
              <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => setEdit(a)} />
            </div>
          ) : null },
        ];
        return (
          <div className="stack">
            <div className="grid g4">
              <Kpi label={tr('إجراءات مفتوحة', 'Open actions')} value={fmtNumber(open.length)} icon={<ListChecks />} />
              <Kpi label={tr('متأخرة', 'Overdue')} value={fmtNumber(overdue.length)} tone={overdue.length ? 'danger' : 'success'} />
              <Kpi label={tr('حرجة/عالية مفتوحة', 'Critical/high open')} value={fmtNumber(open.filter((a) => ['critical', 'high'].includes(a.priority)).length)} />
              <Kpi label={tr('بلا مسؤول', 'Without owner')} value={fmtNumber(open.filter((a) => !a.owner_user_id && !a.owner_name).length)} tone={open.some((a) => !a.owner_user_id && !a.owner_name) ? 'warning' : undefined} />
            </div>
            <Card>
              <CardHeader title={tr('الإجراءات عبر البرامج', 'Actions across programs')} icon={<ListChecks />}
                actions={can('operations.create') ? <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setEdit('new')}>{tr('إجراء جديد', 'New action')}</Button> : undefined} />
              <CardBody flush>
                <DataTable columns={columns} rows={rows} rowKey={(a) => a.id} searchable exportName="actions" pageSize={20}
                  toolbar={<>
                    <Select aria-label={tr('الحالة', 'Status')} options={[{ value: 'open_all', label: tr('المفتوحة', 'Open') }, ...enumOptions('actionStatus')]} placeholder={tr('كل الحالات', 'All statuses')} value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 150 }} />
                    <Select aria-label={tr('الأولوية', 'Priority')} options={enumOptions('priority')} placeholder={tr('كل الأولويات', 'All priorities')} value={priority} onChange={(e) => setPriority(e.target.value)} style={{ maxWidth: 150 }} />
                    <Select aria-label={tr('البرنامج', 'Program')} options={(programs.data ?? []).map((p) => ({ value: p.id, label: pick(p.name, p.name_en) }))} placeholder={tr('كل البرامج', 'All programs')} value={program} onChange={(e) => setProgram(e.target.value)} style={{ maxWidth: 200 }} />
                    <Checkbox label={tr('المتأخرة فقط', 'Overdue only')} checked={overdueOnly} onChange={setOverdueOnly} />
                  </>}
                  empty={{ title: tr('لا توجد إجراءات مطابقة', 'No matching actions') }} />
              </CardBody>
            </Card>
            <RecordFormModal open={edit !== null} size="wide" title={edit === 'new' ? tr('إجراء جديد', 'New action') : tr('تعديل الإجراء', 'Edit action')} fields={fields}
              initial={edit && edit !== 'new' ? { ...edit } : { priority: 'medium', status: 'open', program_id: program }} onClose={() => setEdit(null)} onSubmit={save} />
          </div>
        );
      }}
    </AsyncView>
  );
}
