import { Link } from 'react-router';
import { Pencil, Truck } from 'lucide-react';
import type { Insight } from '@engine';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, Drawer, InsightList, Kpi, Notice, StatusBadge, type Column } from '@/components/ui';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { useAsync } from '@/hooks/useAsync';
import { all } from '@/services/db';
import { todayISO } from '@/utils/dates';
import type { Contract, Program, Vendor, VendorAssignment } from '@/types/db';
import { allIn, avg, byId, makeInsight, safe, sortInsights } from '@/features/beneficiaries/components/dataUtils';
import { EntityDocuments } from '@/features/beneficiaries/components/EntityDocuments';

export function VendorDrawer({ vendor, onClose, onEdit }: { vendor: Vendor; onClose: () => void; onEdit?: () => void }) {
  const { org, can } = useOrg();
  const { tr, pick, fmtMoney, fmtDate, fmtNumber } = useI18n();
  const state = useAsync(async () => {
    const f = { filters: [['organization_id', 'eq', org.id], ['vendor_id', 'eq', vendor.id]] as [string, 'eq', string][] };
    const [assignments, contracts] = await Promise.all([safe(all<VendorAssignment>('vendor_assignments', f)), safe(all<Contract>('contracts', f))]);
    const programs = byId(await safe(allIn<Program>('programs', 'id', [...assignments.map((a) => a.program_id), ...contracts.map((c) => c.program_id)])));
    return { assignments, contracts, programs };
  }, [org.id, vendor.id]);
  const d = state.data;
  const pn = (id: string | null) => { const p = id && d ? d.programs.get(id) : undefined; return p ? pick(p.name, p.name_en) : '—'; };
  const perf = d ? avg(d.assignments.filter((a) => a.performance_rating !== null).map((a) => Number(a.performance_rating))) : null;
  const totalValue = d ? d.assignments.filter((a) => a.status !== 'cancelled').reduce((s, a) => s + Number(a.value ?? 0), 0) : 0;
  const contractValue = d ? d.contracts.filter((c) => !['terminated', 'draft'].includes(c.status)).reduce((s, c) => s + Number(c.value ?? 0), 0) : 0;

  const insights: Insight[] = [];
  if (d) {
    const today = todayISO();
    const late = d.assignments.filter((a) => a.due_date && a.due_date < today && ['planned', 'contracted', 'delivering'].includes(a.status));
    if (late.length) insights.push(makeInsight({ rule: 'VND_LATE', severity: 'high', kind: 'blocker', area: 'delivery', title: ['توريدات متأخرة', 'Late deliveries'],
      rationale: [`${late.length} خدمة تجاوزت تاريخ الاستحقاق ولم تُسلّم.`, `${late.length} services are past due and not delivered.`], action: ['تابع مع المورد وحدّث حالة التوريد.', 'Follow up with the vendor and update the delivery status.'] }));
    const noContract = d.assignments.filter((a) => !a.contract_id && ['contracted', 'delivering', 'delivered'].includes(a.status));
    if (noContract.length) insights.push(makeInsight({ rule: 'VND_NO_CONTRACT', severity: 'medium', kind: 'inconsistency', area: 'finance', title: ['توريد بلا عقد مرتبط', 'Delivery without linked contract'],
      rationale: [`${noContract.length} خدمة متعاقد عليها أو مُسلّمة دون ربط بعقد.`, `${noContract.length} contracted/delivered services have no linked contract.`], action: ['اربط كل خدمة بعقدها في الحوكمة.', 'Link each service to its contract under Governance.'] }));
    if (vendor.status === 'blocked' && d.assignments.some((a) => ['planned', 'contracted', 'delivering'].includes(a.status)))
      insights.push(makeInsight({ rule: 'VND_BLOCKED_ACTIVE', severity: 'critical', kind: 'risk', area: 'risk', title: ['مورد محظور بتكليفات قائمة', 'Blocked vendor with open work'],
        rationale: ['المورد محظور ولديه خدمات غير منتهية.', 'The vendor is blocked but has unfinished services.'], action: ['أعد إسناد الخدمات أو راجع قرار الحظر.', 'Reassign the services or review the block decision.'] }));
    if (!vendor.cr_number || !vendor.vat_number) insights.push(makeInsight({ rule: 'VND_MISSING_REG', severity: 'low', kind: 'missing_config', area: 'setup', title: ['بيانات تسجيل ناقصة', 'Missing registration details'],
      rationale: ['السجل التجاري أو الرقم الضريبي غير مسجل؛ مطلوبان للتعاقد والفوترة.', 'CR or VAT number is missing; both are needed for contracting and invoicing.'], action: ['أكمل بيانات المورد.', 'Complete the vendor record.'] }));
    if (contractValue && totalValue > contractValue) insights.push(makeInsight({ rule: 'VND_OVER_CONTRACT', severity: 'medium', kind: 'kpi_anomaly', area: 'finance', title: ['قيمة الخدمات تتجاوز العقود', 'Service value exceeds contracts'],
      rationale: [`قيمة الخدمات ${fmtMoney(totalValue)} مقابل عقود ${fmtMoney(contractValue)}.`, `Services total ${fmtMoney(totalValue)} vs contracts ${fmtMoney(contractValue)}.`], action: ['راجع نطاق العقود أو قيم الخدمات.', 'Review contract scope or service values.'] }));
  }

  const aCols: Column<VendorAssignment>[] = [
    { key: 'program', header: tr('البرنامج', 'Program'), value: (a) => pn(a.program_id), render: (a) => <Link to={`/app/programs/${a.program_id}`}>{pn(a.program_id)}</Link> },
    { key: 'service', header: tr('الخدمة', 'Service'), value: (a) => a.service },
    { key: 'value', header: tr('القيمة', 'Value'), align: 'end', value: (a) => a.value, render: (a) => fmtMoney(a.value) },
    { key: 'due', header: tr('الاستحقاق', 'Due'), value: (a) => a.due_date, render: (a) => fmtDate(a.due_date) },
    { key: 'status', header: tr('الحالة', 'Status'), value: (a) => a.status, render: (a) => <StatusBadge group="vendorAssignmentStatus" value={a.status} /> },
    { key: 'rating', header: tr('الأداء', 'Rating'), align: 'end', value: (a) => a.performance_rating },
  ];
  const cCols: Column<Contract>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), value: (c) => c.code, render: (c) => <span className="mono">{c.code}</span> },
    { key: 'title', header: tr('العقد', 'Contract'), value: (c) => c.title },
    { key: 'program', header: tr('البرنامج', 'Program'), value: (c) => pn(c.program_id) },
    { key: 'value', header: tr('القيمة', 'Value'), align: 'end', value: (c) => c.value, render: (c) => fmtMoney(c.value, c.currency) },
    { key: 'end', header: tr('الانتهاء', 'Ends'), value: (c) => c.end_date, render: (c) => fmtDate(c.end_date) },
    { key: 'status', header: tr('الحالة', 'Status'), value: (c) => c.status, render: (c) => <StatusBadge group="contractStatus" value={c.status} /> },
  ];

  return (
    <Drawer open onClose={onClose} wide title={<span className="row"><Truck size={16} />{vendor.name} <span className="mono small muted">{vendor.code}</span></span>}
      footer={onEdit && can('vendors.edit') ? <Button variant="primary" icon={<Pencil />} onClick={onEdit}>{tr('تعديل', 'Edit')}</Button> : undefined}>
      <div className="stack">
        <dl className="kv">
          <dt>{tr('الحالة', 'Status')}</dt><dd><StatusBadge group="entityStatus" value={vendor.status} /></dd>
          <dt>{tr('الفئة', 'Category')}</dt><dd>{vendor.category ?? '—'}</dd>
          <dt>{tr('الخدمات', 'Services')}</dt><dd><span className="row wrap" style={{ gap: 4 }}>{vendor.services.length ? vendor.services.map((s) => <span key={s} className="tag">{s}</span>) : '—'}</span></dd>
          <dt>{tr('جهة الاتصال', 'Contact')}</dt><dd>{[vendor.contact_name, vendor.mobile, vendor.email].filter(Boolean).join(' · ') || '—'}</dd>
          <dt>{tr('السجل التجاري', 'CR number')}</dt><dd className="mono">{vendor.cr_number ?? '—'}</dd>
          <dt>{tr('الرقم الضريبي', 'VAT number')}</dt><dd className="mono">{vendor.vat_number ?? '—'}</dd>
          <dt>{tr('المدينة', 'City')}</dt><dd>{vendor.city ?? '—'}</dd>
        </dl>
        {vendor.notes && <p className="small muted">{vendor.notes}</p>}
        {state.error && <Notice tone="danger">{tr('تعذر تحميل التفاصيل', 'Could not load details')}</Notice>}
        <div className="grid g4">
          <Kpi label={tr('التكليفات', 'Assignments')} value={fmtNumber(d?.assignments.length ?? 0)} />
          <Kpi label={tr('قيمة الخدمات', 'Service value')} value={fmtMoney(totalValue)} />
          <Kpi label={tr('متوسط الأداء', 'Avg. performance')} value={perf === null ? (vendor.rating ?? '—') : `${fmtNumber(perf, 2)}/5`} hint={perf === null ? tr('من السجل', 'from registry') : tr('من التكليفات', 'from assignments')} />
          <Kpi label={tr('العقود السارية', 'Active contracts')} value={can('governance.view') ? fmtMoney(contractValue) : '—'} />
        </div>
        {d && <InsightList insights={sortInsights(insights)} emptyTitle={tr('لا توجد ملاحظات على هذا المورد', 'No findings for this vendor')} />}
        <Card><CardHeader title={tr('الخدمات عبر البرامج', 'Services across programs')} /><CardBody flush>
          <DataTable columns={aCols} rows={d?.assignments ?? []} rowKey={(a) => a.id} loading={state.loading} empty={{ title: tr('لا توجد تكليفات', 'No assignments') }} />
        </CardBody></Card>
        <Card><CardHeader title={tr('العقود', 'Contracts')} /><CardBody flush>
          {can('governance.view') ? <DataTable columns={cCols} rows={d?.contracts ?? []} rowKey={(c) => c.id} loading={state.loading} empty={{ title: tr('لا توجد عقود', 'No contracts') }} />
            : <div className="card-pad"><Badge tone="outline">{tr('يتطلب صلاحية الحوكمة', 'Requires Governance permission')}</Badge></div>}
        </CardBody></Card>
        <EntityDocuments owner="vendor_id" ownerId={vendor.id} defaultType="contract" />
      </div>
    </Drawer>
  );
}
