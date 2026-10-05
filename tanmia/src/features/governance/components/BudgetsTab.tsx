import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { AsyncView, Badge, Button, Card, CardBody, CardHeader, DataTable, Kpi, Progress, Select, useConfirm, useToast, type Column } from '@/components/ui';
import { RecordFormModal, type FieldSpec } from '@/components/forms/RecordForm';
import { useAsync } from '@/hooks/useAsync';
import { all, insert, remove, update } from '@/services/db';
import { elapsedShare } from '@engine';
import type { ProgramBudget } from '@/types/db';
import { useErrMsg, usePrograms, type ProgMin } from '../shared';

interface Agg { program: ProgMin; planned: number; committed: number; actual: number; lines: number; flags: [string, string][] }

export function BudgetsTab() {
  const { tr, pick, fmtMoney, fmtNumber } = useI18n();
  const { org, can } = useOrg();
  const toast = useToast(); const confirm = useConfirm(); const errMsg = useErrMsg();
  const programs = usePrograms();
  const [program, setProgram] = useState('');
  const [edit, setEdit] = useState<ProgramBudget | 'new' | null>(null);
  const state = useAsync(() => all<ProgramBudget>('program_budgets', { filters: [['organization_id', 'eq', org.id]], order: { column: 'category', ascending: true } }), [org.id]);

  const aggs = useMemo<Agg[]>(() => {
    const lines = state.data ?? [];
    return (programs.data ?? []).map((p) => {
      const ls = lines.filter((l) => l.program_id === p.id);
      const planned = ls.reduce((a, l) => a + Number(l.planned_amount), 0);
      const committed = ls.reduce((a, l) => a + Number(l.committed_amount), 0);
      const actual = ls.reduce((a, l) => a + Number(l.actual_amount), 0);
      const flags: [string, string][] = [];
      if (p.budget_total !== null && planned && Math.abs(planned - Number(p.budget_total)) > Number(p.budget_total) * 0.01) flags.push(['البنود لا تطابق إجمالي البرنامج', 'Lines do not match program total']);
      if (planned && actual > planned) flags.push(['تجاوز الصرف للمخطط', 'Actual exceeds planned']);
      else if (planned && committed + actual > planned * 1.0001) flags.push(['الالتزامات تتجاوز المخطط', 'Commitments exceed planned']);
      const share = elapsedShare(p.start_date, p.end_date);
      if (planned && share !== null && share > 0.2 && actual / planned > share + 0.25) flags.push(['معدل الصرف أسرع من الزمن', 'Burn ahead of schedule']);
      if (!ls.length && p.budget_total && ['active', 'planning'].includes(p.status)) flags.push(['لا توجد بنود ميزانية', 'No budget lines']);
      return { program: p, planned, committed, actual, lines: ls.length, flags };
    }).filter((a) => a.lines || a.program.budget_total);
  }, [state.data, programs.data]);

  const fields: FieldSpec[] = [
    { name: 'program_id', label: ['البرنامج', 'Program'], type: 'select', required: true, options: (programs.data ?? []).map((p) => ({ value: p.id, label: `${pick(p.name, p.name_en)} · ${p.code}` })), full: true },
    { name: 'category', label: ['البند', 'Category'], type: 'text', required: true, hint: ['مثل: أتعاب خبراء، قاعات، ضيافة، جوائز', 'e.g. expert fees, venues, hospitality, prizes'] },
    { name: 'currency', label: ['العملة', 'Currency'], type: 'text', required: true },
    { name: 'planned_amount', label: ['المخطط', 'Planned'], type: 'number', min: 0, required: true },
    { name: 'committed_amount', label: ['الملتزم به', 'Committed'], type: 'number', min: 0, required: true },
    { name: 'actual_amount', label: ['الفعلي (المصروف)', 'Actual (spent)'], type: 'number', min: 0, required: true },
    { name: 'notes', label: ['ملاحظات', 'Notes'], type: 'textarea' },
  ];
  const save = async (v: Record<string, unknown>) => {
    if (edit === 'new') await insert('program_budgets', { ...v, organization_id: org.id });
    else if (edit) await update('program_budgets', edit.id, v);
    toast.success(tr('تم الحفظ', 'Saved')); void state.reload();
  };
  const del = async (b: ProgramBudget) => {
    if (!(await confirm({ title: tr('حذف البند؟', 'Delete line?'), message: b.category, danger: true, confirmLabel: tr('حذف', 'Delete') }))) return;
    try { await remove('program_budgets', b.id); toast.success(tr('تم الحذف', 'Deleted')); void state.reload(); } catch (e) { toast.error(errMsg(e)); }
  };
  const pname = (id: string) => { const p = programs.data?.find((x) => x.id === id); return p ? pick(p.name, p.name_en) : '—'; };

  const aggCols: Column<Agg>[] = [
    { key: 'program', header: tr('البرنامج', 'Program'), sortable: true, value: (a) => pick(a.program.name, a.program.name_en), render: (a) => <Link className="small" to={`/app/programs/${a.program.id}`}><b>{pick(a.program.name, a.program.name_en)}</b></Link> },
    { key: 'total', header: tr('إجمالي البرنامج', 'Program total'), align: 'end', value: (a) => a.program.budget_total, render: (a) => fmtMoney(a.program.budget_total, a.program.currency) },
    { key: 'planned', header: tr('المخطط', 'Planned'), align: 'end', sortable: true, value: (a) => a.planned, render: (a) => fmtMoney(a.planned, a.program.currency) },
    { key: 'committed', header: tr('الملتزم', 'Committed'), align: 'end', value: (a) => a.committed, render: (a) => fmtMoney(a.committed, a.program.currency) },
    { key: 'actual', header: tr('الفعلي', 'Actual'), align: 'end', sortable: true, value: (a) => a.actual, render: (a) => fmtMoney(a.actual, a.program.currency) },
    { key: 'variance', header: tr('الانحراف (المخطط − الفعلي)', 'Variance (planned − actual)'), align: 'end', sortable: true, value: (a) => a.planned - a.actual,
      render: (a) => <span style={{ color: a.planned - a.actual < 0 ? 'var(--danger)' : undefined }}>{fmtMoney(a.planned - a.actual, a.program.currency)}</span> },
    { key: 'burn', header: tr('نسبة الصرف', 'Burn'), value: (a) => (a.planned ? Math.round((a.actual / a.planned) * 100) : null),
      render: (a) => a.planned ? <div style={{ minWidth: 90 }}><Progress value={(a.actual / a.planned) * 100} tone={a.actual > a.planned ? 'danger' : a.actual / a.planned > 0.85 ? 'warning' : 'success'} /><span className="tiny">{fmtNumber((a.actual / a.planned) * 100, 0)}%</span></div> : '—' },
    { key: 'flags', header: tr('ملاحظات', 'Findings'), value: (a) => a.flags.map((f) => f[1]).join('; '),
      render: (a) => a.flags.length ? <div className="row wrap" style={{ gap: 3 }}>{a.flags.map((f) => <Badge key={f[1]} tone="warning">{tr(f[0], f[1])}</Badge>)}</div> : <Badge tone="success">{tr('سليم', 'OK')}</Badge> },
  ];
  const lineCols: Column<ProgramBudget>[] = [
    { key: 'program', header: tr('البرنامج', 'Program'), sortable: true, value: (b) => pname(b.program_id) },
    { key: 'category', header: tr('البند', 'Category'), sortable: true },
    { key: 'planned_amount', header: tr('المخطط', 'Planned'), align: 'end', sortable: true, value: (b) => Number(b.planned_amount), render: (b) => fmtMoney(Number(b.planned_amount), b.currency) },
    { key: 'committed_amount', header: tr('الملتزم', 'Committed'), align: 'end', value: (b) => Number(b.committed_amount), render: (b) => fmtMoney(Number(b.committed_amount), b.currency) },
    { key: 'actual_amount', header: tr('الفعلي', 'Actual'), align: 'end', sortable: true, value: (b) => Number(b.actual_amount), render: (b) => fmtMoney(Number(b.actual_amount), b.currency) },
    { key: 'variance', header: tr('الانحراف', 'Variance'), align: 'end', value: (b) => Number(b.planned_amount) - Number(b.actual_amount),
      render: (b) => { const v = Number(b.planned_amount) - Number(b.actual_amount); return <span style={{ color: v < 0 ? 'var(--danger)' : undefined }}>{fmtMoney(v, b.currency)}</span>; } },
    { key: 'notes', header: tr('ملاحظات', 'Notes'), value: (b) => b.notes ?? '' },
    { key: 'actions', header: '', hideInExport: true, render: (b) => (
      <div className="row" style={{ gap: 2 }}>
        {can('governance.edit') && <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => setEdit(b)} />}
        {can('governance.delete') && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')} onClick={() => void del(b)} />}
      </div>
    ) },
  ];
  return (
    <AsyncView state={state}>
      {(lines) => {
        const planned = aggs.reduce((a, x) => a + x.planned, 0); const actual = aggs.reduce((a, x) => a + x.actual, 0); const committed = aggs.reduce((a, x) => a + x.committed, 0);
        return (
          <div className="stack">
            <div className="grid g4">
              <Kpi label={tr('المخطط', 'Planned')} value={fmtMoney(planned)} icon={<Wallet />} />
              <Kpi label={tr('الملتزم', 'Committed')} value={fmtMoney(committed)} />
              <Kpi label={tr('الفعلي', 'Actual')} value={fmtMoney(actual)} hint={planned ? `${Math.round((actual / planned) * 100)}%` : undefined} tone={actual > planned && planned ? 'danger' : undefined} />
              <Kpi label={tr('برامج بملاحظات مالية', 'Programs with finance findings')} value={fmtNumber(aggs.filter((a) => a.flags.length).length)} tone={aggs.some((a) => a.flags.length) ? 'warning' : 'success'} />
            </div>
            <Card>
              <CardHeader title={tr('الميزانية حسب البرنامج', 'Budget by program')} icon={<Wallet />} />
              <CardBody flush>
                <DataTable columns={aggCols} rows={aggs} rowKey={(a) => a.program.id} exportName="budget-by-program" pageSize={15} empty={{ title: tr('لا توجد ميزانيات', 'No budgets') }} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={tr('بنود الميزانية', 'Budget lines')}
                actions={can('governance.create') ? <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setEdit('new')} disabled={!programs.data?.length}>{tr('بند جديد', 'New line')}</Button> : undefined} />
              <CardBody flush>
                <DataTable columns={lineCols} rows={lines.filter((l) => !program || l.program_id === program)} rowKey={(b) => b.id} searchable exportName="budget-lines" pageSize={20}
                  toolbar={<Select aria-label={tr('البرنامج', 'Program')} options={(programs.data ?? []).map((p) => ({ value: p.id, label: pick(p.name, p.name_en) }))} placeholder={tr('كل البرامج', 'All programs')} value={program} onChange={(e) => setProgram(e.target.value)} style={{ maxWidth: 220 }} />}
                  empty={{ title: tr('لا توجد بنود', 'No lines') }} />
              </CardBody>
            </Card>
            <RecordFormModal open={edit !== null} title={edit === 'new' ? tr('بند ميزانية جديد', 'New budget line') : tr('تعديل البند', 'Edit line')} fields={fields}
              initial={edit && edit !== 'new' ? { ...edit } : { program_id: program, currency: 'SAR', planned_amount: 0, committed_amount: 0, actual_amount: 0 }}
              onClose={() => setEdit(null)} onSubmit={save} />
          </div>
        );
      }}
    </AsyncView>
  );
}
