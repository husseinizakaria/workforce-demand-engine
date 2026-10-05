import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Pencil, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import {
  AsyncView, Badge, Button, Card, CardBody, CardHeader, DataTable, Kpi, Notice, Select, StatusBadge, useConfirm, useToast, type Column,
} from '@/components/ui';
import { RecordFormModal, type FieldSpec } from '@/components/forms/RecordForm';
import { useAsync } from '@/hooks/useAsync';
import { all, insert, remove, update } from '@/services/db';
import { todayISO } from '@/utils/dates';
import type { RiskIssue } from '@/types/db';
import { memberLabel, memberOptions, useErrMsg, useMembers, usePrograms } from '../shared';

export const sevTone = (s: number) => (s >= 15 ? 'danger' : s >= 8 ? 'warning' : 'info') as 'danger' | 'warning' | 'info';
const cellBg = (s: number) => (s >= 15 ? 'var(--danger-soft)' : s >= 8 ? 'var(--warning-soft)' : 'var(--success-soft)');

export function RisksTab() {
  const { tr, pick, enumLabel, enumOptions, fmtDate, fmtNumber } = useI18n();
  const { org, can } = useOrg();
  const toast = useToast(); const confirm = useConfirm(); const errMsg = useErrMsg();
  const programs = usePrograms(); const members = useMembers();
  const [kind, setKind] = useState(''); const [status, setStatus] = useState('open_all'); const [program, setProgram] = useState('');
  const [cell, setCell] = useState<{ l: number; i: number } | null>(null);
  const [edit, setEdit] = useState<RiskIssue | 'new' | null>(null);
  const state = useAsync(() => all<RiskIssue>('risks_issues', { filters: [['organization_id', 'eq', org.id]], order: [{ column: 'severity' }, { column: 'created_at' }] }), [org.id]);
  const today = todayISO();
  const pname = (id: string | null) => { const p = id ? programs.data?.find((x) => x.id === id) : undefined; return p ? pick(p.name, p.name_en) : tr('على مستوى المؤسسة', 'Organization-wide'); };
  const mname = (id: string | null) => (id ? memberLabel(members.data?.find((m) => m.user_id === id)) : '—');

  const fields: FieldSpec[] = useMemo(() => [
    { name: 'kind', label: ['النوع', 'Kind'], type: 'enum', enumGroup: 'riskKind', required: true },
    { name: 'program_id', label: ['البرنامج', 'Program'], type: 'select', options: (programs.data ?? []).map((p) => ({ value: p.id, label: `${pick(p.name, p.name_en)} · ${p.code}` })), hint: ['اتركه فارغًا للمخاطر المؤسسية', 'Leave empty for organization-level risks'] },
    { name: 'title', label: ['العنوان', 'Title'], type: 'text', required: true, full: true },
    { name: 'description', label: ['الوصف', 'Description'], type: 'textarea' },
    { name: 'category', label: ['الفئة', 'Category'], type: 'enum', enumGroup: 'riskCategory' },
    { name: 'status', label: ['الحالة', 'Status'], type: 'enum', enumGroup: 'riskStatus', required: true },
    { name: 'likelihood', label: ['الاحتمالية (1-5)', 'Likelihood (1-5)'], type: 'number', min: 1, max: 5, step: 1, required: true },
    { name: 'impact', label: ['الأثر (1-5)', 'Impact (1-5)'], type: 'number', min: 1, max: 5, step: 1, required: true },
    { name: 'owner_user_id', label: ['المالك', 'Owner'], type: 'select', options: memberOptions(members.data) },
    { name: 'due_date', label: ['موعد المعالجة', 'Treatment due'], type: 'date' },
    { name: 'mitigation', label: ['خطة المعالجة', 'Mitigation plan'], type: 'textarea',
      validate: (v, all2) => (Number(all2.likelihood) * Number(all2.impact) >= 15 && !String(v ?? '').trim() && all2.status !== 'closed'
        ? ['الخطر مرتفع (≥15): خطة المعالجة إلزامية', 'High risk (≥15): a mitigation plan is required'] : null) },
  ], [programs.data, members.data, pick]);

  const save = async (v: Record<string, unknown>) => {
    if (edit === 'new') await insert('risks_issues', { ...v, organization_id: org.id, source: 'manual' });
    else if (edit) await update('risks_issues', edit.id, v);
    toast.success(tr('تم الحفظ', 'Saved')); void state.reload();
  };
  const del = async (r: RiskIssue) => {
    if (!(await confirm({ title: tr('حذف السجل؟', 'Delete record?'), message: `${r.code} — ${r.title}`, danger: true, confirmLabel: tr('حذف', 'Delete') }))) return;
    try { await remove('risks_issues', r.id); toast.success(tr('تم الحذف', 'Deleted')); void state.reload(); } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <AsyncView state={state}>
      {(risks) => {
        const open = risks.filter((r) => r.status !== 'closed');
        const scoped = open.filter((r) => r.kind === 'risk' && (!program || r.program_id === program));
        const counts = (l: number, i: number) => scoped.filter((r) => (r.likelihood ?? 1) === l && (r.impact ?? 1) === i).length;
        const highNoMit = open.filter((r) => r.severity >= 15 && !r.mitigation?.trim());
        const overdue = open.filter((r) => r.due_date && r.due_date < today);
        const noOwner = open.filter((r) => !r.owner_user_id && r.severity >= 8);
        const rows = risks.filter((r) => (!kind || r.kind === kind) && (!program || r.program_id === program)
          && (status === 'open_all' ? r.status !== 'closed' : !status || r.status === status)
          && (!cell || ((r.likelihood ?? 1) === cell.l && (r.impact ?? 1) === cell.i && r.kind === 'risk')));
        const columns: Column<RiskIssue>[] = [
          { key: 'code', header: tr('الرمز', 'Code'), sortable: true, render: (r) => <span className="mono small">{r.code}</span> },
          { key: 'kind', header: tr('النوع', 'Kind'), value: (r) => enumLabel('riskKind', r.kind), render: (r) => <Badge tone={r.kind === 'issue' ? 'warning' : 'outline'}>{enumLabel('riskKind', r.kind)}</Badge> },
          { key: 'title', header: tr('العنوان', 'Title'), sortable: true, render: (r) => <div className="stack-sm" style={{ gap: 2 }}><b className="small">{r.title}</b>{r.source !== 'manual' && <span className="tiny muted">{tr('مصدره فحص آلي', 'Raised by automated check')}</span>}</div> },
          { key: 'program', header: tr('البرنامج', 'Program'), value: (r) => pname(r.program_id), render: (r) => r.program_id ? <Link className="small" to={`/app/programs/${r.program_id}`}>{pname(r.program_id)}</Link> : <span className="small muted">{pname(null)}</span> },
          { key: 'category', header: tr('الفئة', 'Category'), value: (r) => enumLabel('riskCategory', r.category) },
          { key: 'li', header: tr('احتمال×أثر', 'L×I'), value: (r) => `${r.likelihood ?? '—'}×${r.impact ?? '—'}`, render: (r) => <span className="mono small">{r.likelihood ?? '—'}×{r.impact ?? '—'}</span> },
          { key: 'severity', header: tr('الخطورة', 'Severity'), sortable: true, align: 'end', value: (r) => r.severity, render: (r) => <Badge tone={sevTone(r.severity)}>{r.severity}</Badge> },
          { key: 'owner', header: tr('المالك', 'Owner'), value: (r) => mname(r.owner_user_id) },
          { key: 'mitigation', header: tr('المعالجة', 'Mitigation'), value: (r) => r.mitigation ?? '',
            render: (r) => r.mitigation?.trim() ? <span className="tiny">{r.mitigation.length > 80 ? r.mitigation.slice(0, 80) + '…' : r.mitigation}</span> : r.severity >= 15 && r.status !== 'closed' ? <Badge tone="danger">{tr('مفقودة', 'Missing')}</Badge> : <span className="muted">—</span> },
          { key: 'due', header: tr('الموعد', 'Due'), sortable: true, value: (r) => r.due_date, render: (r) => <span className="row small" style={{ gap: 4 }}>{fmtDate(r.due_date)}{r.due_date && r.due_date < today && r.status !== 'closed' && <Badge tone="danger">{tr('متأخر', 'Overdue')}</Badge>}</span> },
          { key: 'status', header: tr('الحالة', 'Status'), value: (r) => r.status, render: (r) => <StatusBadge group="riskStatus" value={r.status} /> },
          { key: 'actions', header: '', hideInExport: true, render: (r) => (
            <div className="row" style={{ gap: 2 }}>
              {can('governance.edit') && <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => setEdit(r)} />}
              {can('governance.delete') && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')} onClick={() => void del(r)} />}
            </div>
          ) },
        ];
        return (
          <div className="stack">
            <div className="grid g4">
              <Kpi label={tr('مخاطر وقضايا مفتوحة', 'Open risks & issues')} value={fmtNumber(open.length)} />
              <Kpi label={tr('عالية الخطورة (≥15)', 'High severity (≥15)')} value={fmtNumber(open.filter((r) => r.severity >= 15).length)} tone={open.some((r) => r.severity >= 15) ? 'danger' : undefined} />
              <Kpi label={tr('عالية بلا خطة معالجة', 'High without mitigation')} value={fmtNumber(highNoMit.length)} tone={highNoMit.length ? 'danger' : 'success'} />
              <Kpi label={tr('معالجة متأخرة', 'Overdue treatment')} value={fmtNumber(overdue.length)} tone={overdue.length ? 'warning' : undefined} />
            </div>
            {(highNoMit.length > 0 || noOwner.length > 0) && (
              <Notice tone="warning">
                {highNoMit.length > 0 && <div>{tr(`${highNoMit.length} خطر مرتفع دون خطة معالجة: ${highNoMit.slice(0, 3).map((r) => r.code).join('، ')}. أضف خطة ومالكًا وموعدًا.`, `${highNoMit.length} high risks lack a mitigation plan: ${highNoMit.slice(0, 3).map((r) => r.code).join(', ')}. Add a plan, owner and due date.`)}</div>}
                {noOwner.length > 0 && <div>{tr(`${noOwner.length} خطر متوسط أو مرتفع بلا مالك محدد.`, `${noOwner.length} medium/high risks have no owner.`)}</div>}
              </Notice>
            )}
            <div className="grid g-1-2">
              <Card>
                <CardHeader title={tr('مصفوفة المخاطر المفتوحة', 'Open risk heat matrix')} icon={<ShieldAlert />} hint={tr('انقر خلية للتصفية', 'Click a cell to filter')} />
                <CardBody>
                  <div className="heatmap" style={{ gridTemplateColumns: `minmax(64px, auto) repeat(5, minmax(38px, 1fr))` }} role="grid" aria-label={tr('مصفوفة المخاطر', 'Risk matrix')}>
                    <div className="hm-head tiny">{tr('الأثر ↓ / الاحتمال →', 'Impact ↓ / Likelihood →')}</div>
                    {[1, 2, 3, 4, 5].map((l) => <div key={l} className="hm-head">{l}</div>)}
                    {[5, 4, 3, 2, 1].map((i) => (
                      <div key={i} style={{ display: 'contents' }}>
                        <div className="hm-row">{tr('أثر', 'Impact')} {i}</div>
                        {[1, 2, 3, 4, 5].map((l) => {
                          const n = counts(l, i); const on = cell?.l === l && cell?.i === i;
                          return (
                            <button key={l} type="button" className="hm-cell" onClick={() => setCell(on ? null : { l, i })}
                              title={`${tr('الخطورة', 'Severity')} ${l * i} · ${n}`}
                              style={{ background: cellBg(l * i), border: on ? '2px solid var(--text)' : '1px solid transparent', fontWeight: n ? 700 : 400, color: n ? 'var(--text)' : 'var(--text-2)', cursor: 'pointer' }}>
                              {n || '·'}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  {cell && <p className="tiny" style={{ marginTop: 6 }}>{tr('مصفّى على', 'Filtered to')} {cell.l}×{cell.i} · <button className="link-btn" onClick={() => setCell(null)}>{tr('إلغاء التصفية', 'Clear')}</button></p>}
                </CardBody>
              </Card>
              <Card>
                <CardHeader title={tr('سجل المخاطر والقضايا', 'Risk & issue register')} icon={<ShieldAlert />}
                  actions={can('governance.create') ? <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setEdit('new')}>{tr('تسجيل', 'Register')}</Button> : undefined} />
                <CardBody flush>
                  <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} searchable exportName="risks-issues" pageSize={15}
                    toolbar={<>
                      <Select aria-label={tr('النوع', 'Kind')} options={enumOptions('riskKind')} placeholder={tr('الكل', 'All')} value={kind} onChange={(e) => setKind(e.target.value)} style={{ maxWidth: 120 }} />
                      <Select aria-label={tr('الحالة', 'Status')} options={[{ value: 'open_all', label: tr('غير المغلقة', 'Not closed') }, ...enumOptions('riskStatus')]} placeholder={tr('كل الحالات', 'All statuses')} value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 150 }} />
                      <Select aria-label={tr('البرنامج', 'Program')} options={(programs.data ?? []).map((p) => ({ value: p.id, label: pick(p.name, p.name_en) }))} placeholder={tr('كل البرامج', 'All programs')} value={program} onChange={(e) => setProgram(e.target.value)} style={{ maxWidth: 200 }} />
                    </>}
                    empty={{ title: tr('لا توجد سجلات مطابقة', 'No matching records') }} />
                </CardBody>
              </Card>
            </div>
            <RecordFormModal open={edit !== null} title={edit === 'new' ? tr('تسجيل خطر / قضية', 'Register risk / issue') : tr('تعديل', 'Edit')} fields={fields}
              initial={edit && edit !== 'new' ? { ...edit } : { kind: 'risk', status: 'open', likelihood: 3, impact: 3 }} onClose={() => setEdit(null)} onSubmit={save} size="wide"
              intro={<p className="tiny muted">{tr('الخطورة = الاحتمالية × الأثر (1–25). 15 فأكثر تُعد عالية وتتطلب خطة معالجة.', 'Severity = likelihood × impact (1–25). 15+ is high and requires a mitigation plan.')}</p>} />
          </div>
        );
      }}
    </AsyncView>
  );
}
