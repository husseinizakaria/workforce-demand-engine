import { useMemo, useState } from 'react';
import { FileSignature, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { AsyncView, Badge, Button, Card, CardBody, CardHeader, DataTable, Kpi, Select, StatusBadge, useConfirm, useToast, type Column } from '@/components/ui';
import { RecordFormModal, type FieldSpec } from '@/components/forms/RecordForm';
import { useAsync } from '@/hooks/useAsync';
import { all, insert, remove, update } from '@/services/db';
import { addDaysISO, todayISO } from '@/utils/dates';
import type { Contract, Expert, Partner, Vendor } from '@/types/db';
import { useErrMsg, usePrograms } from '../shared';

interface Data { contracts: Contract[]; names: Map<string, string> }

export function ContractsTab() {
  const { tr, pick, enumLabel, enumOptions, fmtDate, fmtMoney, fmtNumber } = useI18n();
  const { org, can } = useOrg();
  const toast = useToast(); const confirm = useConfirm(); const errMsg = useErrMsg();
  const programs = usePrograms();
  const [status, setStatus] = useState('');
  const [edit, setEdit] = useState<Contract | 'new' | null>(null);
  const state = useAsync<Data>(async () => {
    const orgF: [string, 'eq', string] = ['organization_id', 'eq', org.id];
    const [contracts, vendors, experts, partners] = await Promise.all([
      all<Contract>('contracts', { filters: [orgF], order: { column: 'created_at' } }),
      all<Vendor>('vendors', { select: 'id,name', filters: [orgF], order: { column: 'name', ascending: true } }).catch(() => [] as Vendor[]),
      all<Expert>('experts', { select: 'id,full_name', filters: [orgF], order: { column: 'full_name', ascending: true } }).catch(() => [] as Expert[]),
      all<Partner>('partners', { select: 'id,name', filters: [orgF], order: { column: 'name', ascending: true } }).catch(() => [] as Partner[]),
    ]);
    const names = new Map<string, string>([...vendors.map((v) => [v.id, v.name] as [string, string]), ...experts.map((e) => [e.id, e.full_name] as [string, string]), ...partners.map((p) => [p.id, p.name] as [string, string])]);
    return { contracts, names };
  }, [org.id]);
  const today = todayISO(); const soon = addDaysISO(today, 30);
  const pname = (id: string | null) => { const p = id ? programs.data?.find((x) => x.id === id) : undefined; return p ? pick(p.name, p.name_en) : '—'; };
  const party = (c: Contract, names: Map<string, string>): [string, string] => {
    if (c.vendor_id) return [tr('مورد', 'Vendor'), names.get(c.vendor_id) ?? '—'];
    if (c.expert_id) return [tr('خبير', 'Expert'), names.get(c.expert_id) ?? '—'];
    if (c.partner_id) return [tr('شريك', 'Partner'), names.get(c.partner_id) ?? '—'];
    return [tr('غير محدد', 'Not set'), '—'];
  };

  const fields = useMemo<FieldSpec[]>(() => {
    const cur = edit && edit !== 'new' ? edit.status : 'draft';
    const statusOpts = enumOptions('contractStatus').filter((o) => ['draft', 'completed', 'terminated', cur].includes(o.value));
    return [
      { name: 'title', label: ['عنوان العقد', 'Contract title'], type: 'text', required: true, full: true },
      { name: 'party_kind', label: ['نوع الطرف', 'Counterparty type'], type: 'select', required: true, options: [
        { value: 'vendor', label: tr('مورد', 'Vendor') }, { value: 'expert', label: tr('خبير', 'Expert') }, { value: 'partner', label: tr('شريك', 'Partner') }] },
      { name: 'vendor_id', label: ['المورد', 'Vendor'], type: 'entity', entity: 'vendors', required: true, visible: (v) => v.party_kind === 'vendor' },
      { name: 'expert_id', label: ['الخبير', 'Expert'], type: 'entity', entity: 'experts', required: true, visible: (v) => v.party_kind === 'expert' },
      { name: 'partner_id', label: ['الشريك', 'Partner'], type: 'entity', entity: 'partners', required: true, visible: (v) => v.party_kind === 'partner' },
      { name: 'program_id', label: ['البرنامج', 'Program'], type: 'select', options: (programs.data ?? []).map((p) => ({ value: p.id, label: `${pick(p.name, p.name_en)} · ${p.code}` })) },
      { name: 'value', label: ['القيمة', 'Value'], type: 'number', min: 0 },
      { name: 'currency', label: ['العملة', 'Currency'], type: 'text', required: true },
      { name: 'start_date', label: ['البداية', 'Start'], type: 'date' },
      { name: 'end_date', label: ['النهاية', 'End'], type: 'date', validate: (v, all2) => (v && all2.start_date && String(v) < String(all2.start_date) ? ['النهاية قبل البداية', 'End is before start'] : null) },
      { name: 'status', label: ['الحالة', 'Status'], type: 'select', required: true, options: statusOpts, hint: ['التفعيل يتم عبر طلب اعتماد', 'Activation happens through an approval request'] },
    ];
  }, [edit, programs.data, pick, tr, enumOptions]);

  const save = async (v: Record<string, unknown>) => {
    const kind = v.party_kind; delete v.party_kind;
    const row = { ...v, vendor_id: kind === 'vendor' ? v.vendor_id : null, expert_id: kind === 'expert' ? v.expert_id : null, partner_id: kind === 'partner' ? v.partner_id : null };
    if (edit === 'new') await insert('contracts', { ...row, organization_id: org.id });
    else if (edit) await update('contracts', edit.id, row);
    toast.success(tr('تم الحفظ', 'Saved')); void state.reload();
  };
  const requestApproval = async (c: Contract, names: Map<string, string>) => {
    if (!(await confirm({ title: tr('طلب اعتماد العقد؟', 'Request contract approval?'), message: tr('سيُرسل العقد إلى الاعتمادات؛ يصبح «ساريًا» عند الاعتماد.', 'The contract goes to Approvals; it becomes “active” once approved.') }))) return;
    try {
      await update('contracts', c.id, { status: 'pending_approval' });
      try {
        await insert('approval_requests', { organization_id: org.id, program_id: c.program_id, entity_type: 'contract', entity_id: c.id,
          title: `${tr('اعتماد عقد', 'Contract approval')}: ${c.title} (${c.code})`, details: `${party(c, names).join(': ')} · ${fmtMoney(c.value === null ? null : Number(c.value), c.currency)}` });
      } catch (e) { await update('contracts', c.id, { status: c.status }).catch(() => undefined); throw e; }
      toast.success(tr('أُرسل طلب الاعتماد', 'Approval requested')); void state.reload();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const del = async (c: Contract) => {
    if (!(await confirm({ title: tr('حذف العقد؟', 'Delete contract?'), message: `${c.code} — ${c.title}`, danger: true, confirmLabel: tr('حذف', 'Delete') }))) return;
    try { await remove('contracts', c.id); toast.success(tr('تم الحذف', 'Deleted')); void state.reload(); } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <AsyncView state={state}>
      {(d) => {
        const rows = d.contracts.filter((c) => !status || c.status === status);
        const active = d.contracts.filter((c) => c.status === 'active');
        const expiring = active.filter((c) => c.end_date && c.end_date >= today && c.end_date <= soon);
        const expired = active.filter((c) => c.end_date && c.end_date < today);
        const columns: Column<Contract>[] = [
          { key: 'code', header: tr('الرمز', 'Code'), sortable: true, render: (c) => <span className="mono small">{c.code}</span> },
          { key: 'title', header: tr('العقد', 'Contract'), sortable: true, render: (c) => <b className="small">{c.title}</b> },
          { key: 'party', header: tr('الطرف', 'Counterparty'), value: (c) => party(c, d.names).join(': '), render: (c) => { const [k, n] = party(c, d.names); return <span className="small"><span className="muted">{k}:</span> {n}</span>; } },
          { key: 'program', header: tr('البرنامج', 'Program'), value: (c) => pname(c.program_id) },
          { key: 'value', header: tr('القيمة', 'Value'), align: 'end', sortable: true, value: (c) => (c.value === null ? null : Number(c.value)), render: (c) => fmtMoney(c.value === null ? null : Number(c.value), c.currency) },
          { key: 'dates', header: tr('المدة', 'Term'), value: (c) => c.start_date, render: (c) => (
            <span className="row small" style={{ gap: 4 }}>{fmtDate(c.start_date)} – {fmtDate(c.end_date)}
              {c.status === 'active' && c.end_date && c.end_date < today && <Badge tone="danger">{tr('منتهٍ وما زال ساريًا', 'Expired but active')}</Badge>}
              {c.status === 'active' && c.end_date && c.end_date >= today && c.end_date <= soon && <Badge tone="warning">{tr('ينتهي قريبًا', 'Ending soon')}</Badge>}
            </span>) },
          { key: 'status', header: tr('الحالة', 'Status'), value: (c) => enumLabel('contractStatus', c.status), render: (c) => <StatusBadge group="contractStatus" value={c.status} /> },
          { key: 'actions', header: '', hideInExport: true, render: (c) => (
            <div className="row" style={{ gap: 2 }}>
              {c.status === 'draft' && can('governance.edit') && <Button size="sm" icon={<Send />} onClick={() => void requestApproval(c, d.names)}>{tr('طلب اعتماد', 'Request approval')}</Button>}
              {can('governance.edit') && c.status !== 'pending_approval' && <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => setEdit(c)} />}
              {can('governance.delete') && ['draft', 'terminated'].includes(c.status) && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')} onClick={() => void del(c)} />}
            </div>
          ) },
        ];
        return (
          <div className="stack">
            <div className="grid g4">
              <Kpi label={tr('العقود السارية', 'Active contracts')} value={fmtNumber(active.length)} icon={<FileSignature />} />
              <Kpi label={tr('قيمة العقود السارية', 'Active contract value')} value={fmtMoney(active.reduce((a, c) => a + Number(c.value ?? 0), 0))} />
              <Kpi label={tr('بانتظار الاعتماد', 'Pending approval')} value={fmtNumber(d.contracts.filter((c) => c.status === 'pending_approval').length)} />
              <Kpi label={tr('تنتهي خلال 30 يومًا / منتهية', 'Ending ≤30 days / expired')} value={`${fmtNumber(expiring.length)} / ${fmtNumber(expired.length)}`} tone={expired.length ? 'danger' : expiring.length ? 'warning' : undefined} />
            </div>
            <Card>
              <CardHeader title={tr('سجل العقود', 'Contract register')} icon={<FileSignature />}
                actions={can('governance.create') ? <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setEdit('new')}>{tr('عقد جديد', 'New contract')}</Button> : undefined} />
              <CardBody flush>
                <DataTable columns={columns} rows={rows} rowKey={(c) => c.id} searchable exportName="contracts" pageSize={20}
                  toolbar={<Select aria-label={tr('الحالة', 'Status')} options={enumOptions('contractStatus')} placeholder={tr('كل الحالات', 'All statuses')} value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 180 }} />}
                  empty={{ title: tr('لا توجد عقود', 'No contracts') }} />
              </CardBody>
            </Card>
            <RecordFormModal open={edit !== null} size="wide" title={edit === 'new' ? tr('عقد جديد', 'New contract') : tr('تعديل العقد', 'Edit contract')} fields={fields}
              initial={edit && edit !== 'new' ? { ...edit, party_kind: edit.vendor_id ? 'vendor' : edit.expert_id ? 'expert' : edit.partner_id ? 'partner' : '' } : { status: 'draft', currency: 'SAR', party_kind: 'vendor' }}
              onClose={() => setEdit(null)} onSubmit={save} />
          </div>
        );
      }}
    </AsyncView>
  );
}
