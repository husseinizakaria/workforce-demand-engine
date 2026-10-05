// Vendors: program vendor assignments (service, value, status, due, rating)
// linked to program contracts.
import { useState } from 'react';
import { Pencil, Plus, Trash2, Truck } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAsync } from '@/hooks/useAsync';
import { useAction } from '@/hooks/useAction';
import { all, insert, remove, update } from '@/services/db';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, Kpi, Notice, StatusBadge, useConfirm, type Column } from '@/components/ui';
import { RecordFormModal, type FieldSpec } from '@/components/forms/RecordForm';
import type { Contract, Vendor, VendorAssignment } from '@/types/db';
import { errText } from '../../lib';
import { useWorkspace } from '../context';
import { RowActions } from '../components/common';

export default function VendorsTab() {
  const { tr, fmtMoney, fmtDate, locale, fmtNumber } = useI18n();
  const { can, org, hasModule } = useOrg();
  const ws = useWorkspace();
  const p = ws.bundle.program;
  const confirm = useConfirm();
  const [editing, setEditing] = useState<VendorAssignment | 'new' | null>(null);
  const state = useAsync(async () => {
    const rows = await all<VendorAssignment>('vendor_assignments', { filters: [['organization_id', 'eq', org.id], ['program_id', 'eq', p.id]] });
    const ids = [...new Set(rows.map((r) => r.vendor_id))];
    const vendors = ids.length ? await all<Vendor>('vendors', { filters: [['id', 'in', ids]], order: { column: 'name', ascending: true } }) : [];
    let contracts: Contract[] = [];
    if (hasModule('governance')) {
      try { contracts = await all<Contract>('contracts', { filters: [['organization_id', 'eq', org.id], ['program_id', 'eq', p.id]] }); } catch { contracts = []; }
    }
    return { rows, vendors, contracts };
  }, [p.id, org.id]);
  const data = state.data ?? { rows: [], vendors: [], contracts: [] };
  const vName = (id: string) => data.vendors.find((v) => v.id === id)?.name ?? '—';
  const cCode = (id: string | null) => (id ? data.contracts.find((c) => c.id === id)?.code ?? '—' : '—');
  const del = useAction(async (id: string) => { await remove('vendor_assignments', id); await state.reload(); }, { success: ['تم الحذف', 'Deleted'] });
  const today = new Date().toISOString().slice(0, 10);
  const total = data.rows.filter((r) => r.status !== 'cancelled').reduce((a, r) => a + Number(r.value ?? 0), 0);
  const noContract = data.rows.filter((r) => ['contracted', 'delivering', 'delivered'].includes(r.status) && !r.contract_id).length;
  const fields: FieldSpec[] = [
    { name: 'vendor_id', label: ['المورد', 'Vendor'], type: 'entity', entity: 'vendors', required: true, full: true },
    { name: 'service', label: ['الخدمة', 'Service'], type: 'text', required: true },
    { name: 'value', label: ['القيمة (ر.س)', 'Value (SAR)'], type: 'number', min: 0 },
    { name: 'status', label: ['الحالة', 'Status'], type: 'enum', enumGroup: 'vendorAssignmentStatus', required: true },
    { name: 'due_date', label: ['موعد التسليم', 'Due date'], type: 'date' },
    { name: 'contract_id', label: ['العقد', 'Contract'], type: 'select', options: data.contracts.map((c) => ({ value: c.id, label: `${c.code} · ${c.title}` })),
      hint: ['العقود تُنشأ من تبويب المالية', 'Contracts are created in the Finance tab'] },
    { name: 'performance_rating', label: ['تقييم الأداء (0–5)', 'Performance rating (0–5)'], type: 'number', min: 0, max: 5, step: 0.5 },
    { name: 'notes', label: ['ملاحظات', 'Notes'], type: 'textarea' },
  ];
  const cols: Column<VendorAssignment>[] = [
    { key: 'vendor', header: tr('المورد', 'Vendor'), sortable: true, value: (r) => vName(r.vendor_id) },
    { key: 'service', header: tr('الخدمة', 'Service'), sortable: true },
    { key: 'value', header: tr('القيمة', 'Value'), align: 'end', sortable: true, value: (r) => r.value, render: (r) => fmtMoney(r.value) },
    { key: 'status', header: tr('الحالة', 'Status'), value: (r) => r.status, render: (r) => <StatusBadge group="vendorAssignmentStatus" value={r.status} /> },
    { key: 'due', header: tr('التسليم', 'Due'), value: (r) => r.due_date, render: (r) => r.due_date && r.due_date < today && !['delivered', 'cancelled'].includes(r.status) ? <Badge tone="danger">{fmtDate(r.due_date)}</Badge> : fmtDate(r.due_date) },
    { key: 'contract', header: tr('العقد', 'Contract'), value: (r) => cCode(r.contract_id), render: (r) => (r.contract_id ? <span className="mono">{cCode(r.contract_id)}</span> : ['contracted', 'delivering', 'delivered'].includes(r.status) ? <Badge tone="warning">{tr('بلا عقد', 'No contract')}</Badge> : <span className="muted">—</span>) },
    { key: 'rating', header: tr('التقييم', 'Rating'), align: 'end', value: (r) => r.performance_rating },
    { key: 'actions', header: '', hideInExport: true, render: (r) => (
      <RowActions>
        {can('vendors.edit') && <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => setEditing(r)} />}
        {can('vendors.delete') && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')}
          onClick={async () => { if (await confirm({ title: tr('حذف تكليف المورد؟', 'Delete vendor assignment?'), danger: true })) void del.run(r.id); }} />}
      </RowActions>
    ) },
  ];
  return (
    <div className="stack">
      <div className="grid g3">
        <Kpi label={tr('تكليفات الموردين', 'Vendor assignments')} value={fmtNumber(data.rows.length)} icon={<Truck />} />
        <Kpi label={tr('القيمة الإجمالية', 'Total value')} value={fmtMoney(total)} hint={p.budget_total ? `${Math.round((total / Number(p.budget_total)) * 100)}% ${tr('من الميزانية', 'of budget')}` : undefined} />
        <Kpi label={tr('متعاقد بلا عقد مرتبط', 'Contracted without linked contract')} value={fmtNumber(noContract)} tone={noContract ? 'warning' : undefined} />
      </div>
      {state.error && <Notice tone="danger">{errText(locale, state.error)}</Notice>}
      <Card>
        <CardHeader icon={<Truck />} title={tr('موردو البرنامج', 'Program vendors')}
          actions={can('vendors.create') ? <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setEditing('new')}>{tr('تكليف مورد', 'Assign vendor')}</Button> : undefined} />
        <CardBody flush>
          <DataTable rows={data.rows} loading={state.loading} rowKey={(r) => r.id} columns={cols} searchable exportName={`${p.code}-vendors`}
            empty={{ title: tr('لا يوجد موردون مكلفون', 'No vendors assigned') }} />
        </CardBody>
      </Card>
      <RecordFormModal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? tr('تكليف مورد', 'Assign vendor') : tr('تعديل تكليف المورد', 'Edit vendor assignment')}
        fields={fields} initial={editing && editing !== 'new' ? { ...editing } : { status: 'planned' }}
        onSubmit={async (v) => {
          if (editing && editing !== 'new') await update<VendorAssignment>('vendor_assignments', editing.id, v);
          else await insert<VendorAssignment>('vendor_assignments', { ...v, organization_id: org.id, program_id: p.id });
          await state.reload();
        }} />
    </div>
  );
}
