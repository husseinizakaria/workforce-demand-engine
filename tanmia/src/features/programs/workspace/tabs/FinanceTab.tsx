// Finance: budget lines (planned / committed / actual), totals vs approved
// budget, burn vs elapsed time, and program contracts with approval requests.
import { useState } from 'react';
import { FileSignature, Pencil, Plus, Send, Trash2, Wallet } from 'lucide-react';
import { elapsedShare } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAsync } from '@/hooks/useAsync';
import { useAction } from '@/hooks/useAction';
import { all, insert, remove, update } from '@/services/db';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, Kpi, Notice, Progress, StatusBadge, useConfirm, type Column } from '@/components/ui';
import { RecordFormModal, type FieldSpec } from '@/components/forms/RecordForm';
import type { ApprovalRequest, Contract, ProgramBudget } from '@/types/db';
import { dateOrderError, errText } from '../../lib';
import { useWorkspace } from '../context';
import { RowActions, TabInsights } from '../components/common';

const CATEGORIES = ['التدريب والتنفيذ', 'الخبراء والمرشدون', 'الموردون والخدمات', 'المكان والتجهيزات', 'التسويق والاستقطاب', 'التقييم والقياس', 'الجوائز والمنح', 'الإدارة والتشغيل'];

export default function FinanceTab() {
  const { tr, fmtMoney, fmtNumber, fmtDate, locale } = useI18n();
  const { can, org } = useOrg();
  const ws = useWorkspace();
  const b = ws.bundle;
  const p = b.program;
  const confirm = useConfirm();
  const [editing, setEditing] = useState<ProgramBudget | 'new' | null>(null);
  const [contract, setContract] = useState<Contract | 'new' | null>(null);
  const contracts = useAsync(() => all<Contract>('contracts', { filters: [['organization_id', 'eq', org.id], ['program_id', 'eq', p.id]] }), [p.id]);
  const del = useAction(async (id: string) => { await remove('program_budgets', id); await ws.reload(); }, { success: ['تم حذف البند', 'Line deleted'] });
  const requestApproval = useAction(async (c: Contract) => {
    await insert<ApprovalRequest>('approval_requests', {
      organization_id: org.id, program_id: p.id, entity_type: 'contract', entity_id: c.id, status: 'pending',
      title: `اعتماد عقد: ${c.title} (${c.code})`, details: c.value !== null ? `${tr('القيمة', 'Value')}: ${c.value} ${c.currency}` : null,
    });
    await update<Contract>('contracts', c.id, { status: 'pending_approval' });
    await contracts.reload();
  }, { success: ['أُرسل طلب الاعتماد إلى الحوكمة', 'Approval request sent to Governance'] });

  const planned = b.budgets.reduce((a, x) => a + Number(x.planned_amount), 0);
  const committed = b.budgets.reduce((a, x) => a + Number(x.committed_amount), 0);
  const actual = b.budgets.reduce((a, x) => a + Number(x.actual_amount), 0);
  const total = p.budget_total === null ? null : Number(p.budget_total);
  const share = elapsedShare(p.start_date, p.end_date);
  const base = planned || total || 0;
  const burn = base ? (actual / base) * 100 : null;
  const contractTotal = (contracts.data ?? []).filter((c) => c.status !== 'terminated').reduce((a, c) => a + Number(c.value ?? 0), 0);

  const fields: FieldSpec[] = [
    { name: 'category', label: ['البند', 'Category'], type: 'text', required: true, hint: [CATEGORIES.join('، '), 'e.g. delivery, experts, vendors, venue, marketing, evaluation, awards, admin'] },
    { name: 'planned_amount', label: ['المخطط', 'Planned'], type: 'number', min: 0, required: true },
    { name: 'committed_amount', label: ['الملتزم به', 'Committed'], type: 'number', min: 0 },
    { name: 'actual_amount', label: ['الفعلي', 'Actual'], type: 'number', min: 0 },
    { name: 'notes', label: ['ملاحظات', 'Notes'], type: 'textarea' },
  ];
  const cFields: FieldSpec[] = [
    { name: 'title', label: ['عنوان العقد', 'Contract title'], type: 'text', required: true, full: true },
    { name: 'value', label: ['القيمة', 'Value'], type: 'number', min: 0 },
    { name: 'start_date', label: ['البداية', 'Start'], type: 'date' },
    { name: 'end_date', label: ['النهاية', 'End'], type: 'date', validate: (v, a) => dateOrderError(a.start_date, v) },
    { name: 'vendor_id', label: ['المورد', 'Vendor'], type: 'entity', entity: 'vendors' },
    { name: 'expert_id', label: ['الخبير', 'Expert'], type: 'entity', entity: 'experts' },
    { name: 'partner_id', label: ['الشريك', 'Partner'], type: 'entity', entity: 'partners' },
  ];
  const cols: Column<ProgramBudget>[] = [
    { key: 'category', header: tr('البند', 'Category'), sortable: true },
    { key: 'planned', header: tr('المخطط', 'Planned'), align: 'end', sortable: true, value: (r) => Number(r.planned_amount), render: (r) => fmtMoney(Number(r.planned_amount), r.currency) },
    { key: 'committed', header: tr('الملتزم', 'Committed'), align: 'end', value: (r) => Number(r.committed_amount), render: (r) => fmtMoney(Number(r.committed_amount), r.currency) },
    { key: 'actual', header: tr('الفعلي', 'Actual'), align: 'end', value: (r) => Number(r.actual_amount), render: (r) => fmtMoney(Number(r.actual_amount), r.currency) },
    { key: 'use', header: tr('الاستخدام', 'Utilization'), value: (r) => (Number(r.planned_amount) ? Math.round((Number(r.actual_amount) / Number(r.planned_amount)) * 100) : null),
      render: (r) => { const u = Number(r.planned_amount) ? (Number(r.actual_amount) / Number(r.planned_amount)) * 100 : 0; return <div className="row"><Progress value={u} tone={u > 100 ? 'danger' : u > 90 ? 'warning' : undefined} /><span className="tiny">{Math.round(u)}%</span></div>; } },
    { key: 'notes', header: tr('ملاحظات', 'Notes'), value: (r) => r.notes ?? '' },
    { key: 'actions', header: '', hideInExport: true, render: (r) => (
      <RowActions>
        {can('governance.edit') && <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => setEditing(r)} />}
        {can('governance.delete') && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')}
          onClick={async () => { if (await confirm({ title: tr('حذف البند؟', 'Delete line?'), danger: true })) void del.run(r.id); }} />}
      </RowActions>
    ) },
  ];
  return (
    <div className="stack">
      <div className="grid g4">
        <Kpi label={tr('الميزانية المعتمدة', 'Approved budget')} value={fmtMoney(total, p.currency)} icon={<Wallet />} />
        <Kpi label={tr('مجموع البنود المخططة', 'Planned lines total')} value={fmtMoney(planned, p.currency)} tone={total !== null && planned && Math.abs(planned - total) > total * 0.01 ? 'warning' : undefined}
          hint={total !== null && planned ? (planned > total ? tr('يتجاوز المعتمد', 'Exceeds approved') : planned < total ? tr(`غير موزع: ${fmtMoney(total - planned, p.currency)}`, `Unallocated: ${fmtMoney(total - planned, p.currency)}`) : tr('مطابق', 'Matches')) : undefined} />
        <Kpi label={tr('الملتزم به', 'Committed')} value={fmtMoney(committed, p.currency)} tone={base && committed + actual > base ? 'warning' : undefined} />
        <Kpi label={tr('المصروف الفعلي', 'Actual spend')} value={fmtMoney(actual, p.currency)} tone={base && actual > base ? 'danger' : undefined} hint={burn !== null ? `${fmtNumber(burn, 1)}%` : undefined} />
      </div>
      <Card>
        <CardHeader title={tr('معدل الصرف مقابل الزمن', 'Burn vs elapsed time')} />
        <CardBody>
          <div className="stack-sm">
            <div className="row"><span className="small" style={{ width: 160 }}>{tr('المصروف من الميزانية', 'Budget spent')}</span><Progress large value={burn ?? 0} tone={burn !== null && share !== null && burn / 100 > share + 0.25 ? 'danger' : undefined} /><b className="small">{burn === null ? '—' : `${Math.round(burn)}%`}</b></div>
            <div className="row"><span className="small" style={{ width: 160 }}>{tr('المنقضي من المدة', 'Time elapsed')}</span><Progress large value={share === null ? 0 : share * 100} /><b className="small">{share === null ? '—' : `${Math.round(share * 100)}%`}</b></div>
            {burn !== null && share !== null && burn / 100 > share + 0.25 && <Notice tone="warning">{tr('الصرف أسرع من الزمن بفارق كبير؛ راجع خطة الصرف المتبقية.', 'Spending is well ahead of time; review the remaining spend plan.')}</Notice>}
            {share === null && <p className="tiny muted">{tr('أدخل تواريخ البرنامج لمقارنة الصرف بالزمن.', 'Set program dates to compare burn with time.')}</p>}
          </div>
        </CardBody>
      </Card>
      <TabInsights links={['finance']} />
      <Card>
        <CardHeader icon={<Wallet />} title={tr('بنود الميزانية', 'Budget lines')}
          actions={can('governance.create') ? <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setEditing('new')}>{tr('بند', 'Line')}</Button> : undefined} />
        <CardBody flush>
          <DataTable rows={b.budgets as ProgramBudget[]} rowKey={(r) => r.id} columns={cols} exportName={`${p.code}-budget`} empty={{ title: tr('لا توجد بنود ميزانية', 'No budget lines') }} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader icon={<FileSignature />} title={tr('عقود البرنامج', 'Program contracts')} hint={tr(`الإجمالي ${fmtMoney(contractTotal, p.currency)}`, `Total ${fmtMoney(contractTotal, p.currency)}`)}
          actions={can('governance.create') ? <Button size="sm" icon={<Plus />} onClick={() => setContract('new')}>{tr('عقد', 'Contract')}</Button> : undefined} />
        <CardBody flush>
          {contracts.error ? <Notice tone="danger">{errText(locale, contracts.error)}</Notice> : (
            <DataTable rows={contracts.data ?? []} loading={contracts.loading} rowKey={(r) => r.id} exportName={`${p.code}-contracts`} empty={{ title: tr('لا توجد عقود', 'No contracts') }}
              columns={[
                { key: 'code', header: tr('الرمز', 'Code'), render: (r) => <span className="mono">{r.code}</span>, value: (r) => r.code },
                { key: 'title', header: tr('العنوان', 'Title'), sortable: true },
                { key: 'party', header: tr('الطرف', 'Party'), value: (r) => (r.vendor_id ? tr('مورد', 'Vendor') : r.expert_id ? tr('خبير', 'Expert') : r.partner_id ? tr('شريك', 'Partner') : '—') },
                { key: 'value', header: tr('القيمة', 'Value'), align: 'end', value: (r) => r.value, render: (r) => fmtMoney(r.value, r.currency) },
                { key: 'period', header: tr('المدة', 'Period'), value: (r) => r.start_date, render: (r) => `${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}` },
                { key: 'status', header: tr('الحالة', 'Status'), value: (r) => r.status, render: (r) => <StatusBadge group="contractStatus" value={r.status} /> },
                { key: 'actions', header: '', hideInExport: true, render: (r) => (
                  <RowActions>
                    {r.status === 'draft' && can('governance.edit') && <Button size="sm" icon={<Send />} loading={requestApproval.busy} onClick={() => void requestApproval.run(r)}>{tr('طلب اعتماد', 'Request approval')}</Button>}
                    {r.status === 'pending_approval' && <Badge tone="warning">{tr('في الحوكمة', 'In governance')}</Badge>}
                    {can('governance.edit') && r.status === 'draft' && <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => setContract(r)} />}
                  </RowActions>
                ) },
              ]} />
          )}
        </CardBody>
      </Card>
      <RecordFormModal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? tr('بند ميزانية', 'Budget line') : tr('تعديل البند', 'Edit line')} fields={fields}
        initial={editing && editing !== 'new' ? { ...editing } : { committed_amount: 0, actual_amount: 0 }}
        onSubmit={async (v) => {
          const row = { ...v, committed_amount: v.committed_amount ?? 0, actual_amount: v.actual_amount ?? 0 };
          if (editing && editing !== 'new') await update<ProgramBudget>('program_budgets', editing.id, row);
          else await insert<ProgramBudget>('program_budgets', { ...row, organization_id: org.id, program_id: p.id, currency: p.currency });
          await ws.reload();
        }} />
      <RecordFormModal open={!!contract} onClose={() => setContract(null)} title={contract === 'new' ? tr('عقد جديد', 'New contract') : tr('تعديل العقد', 'Edit contract')} fields={cFields}
        initial={contract && contract !== 'new' ? { ...contract } : { start_date: p.start_date, end_date: p.end_date }}
        intro={<p className="small muted">{tr('يُنشأ العقد كمسودة؛ يصبح ساريًا بعد اعتماده من الحوكمة (لا يعتمد مقدم الطلب طلبه بنفسه).', 'Contracts start as drafts and become active after Governance approval (requesters cannot approve their own request).')}</p>}
        onSubmit={async (v) => {
          if (contract && contract !== 'new') await update<Contract>('contracts', contract.id, v);
          else await insert<Contract>('contracts', { ...v, organization_id: org.id, program_id: p.id, currency: p.currency, status: 'draft' });
          await contracts.reload();
        }} />
    </div>
  );
}
