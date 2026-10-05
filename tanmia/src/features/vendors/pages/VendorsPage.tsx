import { useMemo, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { termsMatch } from '@engine';
import { Badge, Button, Card, CardBody, DataTable, Input, PageHeader, Select, StatusBadge, type Column } from '@/components/ui';
import { RecordFormModal, type FieldSpec } from '@/components/forms/RecordForm';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { useAsync } from '@/hooks/useAsync';
import { all, insert, update } from '@/services/db';
import type { Vendor } from '@/types/db';
import { VendorDrawer } from '../components/VendorDrawer';

const CR = /^\d{10}$/;
const VAT = /^3\d{13}3$/;

export default function VendorsPage() {
  const { org, can } = useOrg();
  const { tr, enumOptions, fmtNumber } = useI18n();
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [service, setService] = useState('');
  const [editing, setEditing] = useState<Vendor | 'new' | null>(null);
  const [selected, setSelected] = useState<Vendor | null>(null);
  const state = useAsync(() => all<Vendor>('vendors', { filters: [['organization_id', 'eq', org.id]], order: { column: 'name', ascending: true } }, 5000), [org.id]);
  const categories = useMemo(() => [...new Set((state.data ?? []).map((v) => v.category).filter((x): x is string => !!x))].sort(), [state.data]);
  const rows = useMemo(() => (state.data ?? []).filter((v) => (!status || v.status === status) && (!category || v.category === category)
    && (!service.trim() || v.services.some((s) => termsMatch(s, service)))), [state.data, status, category, service]);
  const statusOptions = enumOptions('entityStatus').filter((o) => ['active', 'inactive', 'blocked'].includes(o.value));

  const fields: FieldSpec[] = [
    { name: 'name', label: ['اسم المورد', 'Vendor name'], type: 'text', required: true },
    { name: 'category', label: ['الفئة', 'Category'], type: 'text', hint: ['مثل: تموين، قاعات، طباعة، منصات', 'e.g. catering, venues, printing, platforms'] },
    { name: 'services', label: ['الخدمات', 'Services'], type: 'tags', full: true },
    { name: 'contact_name', label: ['جهة الاتصال', 'Contact name'], type: 'text' },
    { name: 'email', label: ['البريد الإلكتروني', 'Email'], type: 'email' },
    { name: 'mobile', label: ['الجوال', 'Mobile'], type: 'tel' },
    { name: 'city', label: ['المدينة', 'City'], type: 'text' },
    { name: 'cr_number', label: ['السجل التجاري', 'CR number'], type: 'text', validate: (v) => (v && !CR.test(String(v).trim()) ? ['السجل التجاري 10 أرقام', 'CR number is 10 digits'] : null) },
    { name: 'vat_number', label: ['الرقم الضريبي', 'VAT number'], type: 'text', validate: (v) => (v && !VAT.test(String(v).trim()) ? ['الرقم الضريبي 15 رقمًا يبدأ وينتهي بـ 3', 'VAT number is 15 digits starting and ending with 3'] : null) },
    { name: 'rating', label: ['التقييم (0–5)', 'Rating (0–5)'], type: 'number', min: 0, max: 5, step: 0.1 },
    { name: 'status', label: ['الحالة', 'Status'], type: 'select', options: statusOptions, required: true },
    { name: 'notes', label: ['ملاحظات', 'Notes'], type: 'textarea' },
  ];
  const initial = (v: Vendor | null): Record<string, unknown> => v ? {
    name: v.name, category: v.category, services: v.services, contact_name: v.contact_name, email: v.email, mobile: v.mobile, city: v.city,
    cr_number: v.cr_number, vat_number: v.vat_number, rating: v.rating, status: v.status, notes: v.notes,
  } : { status: 'active', services: [] };
  const save = async (v: Record<string, unknown>) => {
    if (editing && editing !== 'new') {
      const u = await update<Vendor>('vendors', editing.id, v);
      if (selected?.id === u.id) setSelected(u);
    } else await insert<Vendor>('vendors', { ...v, organization_id: org.id });
    await state.reload();
  };

  const cols: Column<Vendor>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), value: (v) => v.code, sortable: true, render: (v) => <span className="mono">{v.code}</span> },
    { key: 'name', header: tr('المورد', 'Vendor'), value: (v) => v.name, sortable: true, render: (v) => <div><b>{v.name}</b>{v.contact_name && <span className="sub">{v.contact_name}</span>}</div> },
    { key: 'category', header: tr('الفئة', 'Category'), value: (v) => v.category ?? '' },
    { key: 'services', header: tr('الخدمات', 'Services'), value: (v) => v.services.join('; '), render: (v) => <span className="small">{v.services.join('، ') || '—'}</span> },
    { key: 'city', header: tr('المدينة', 'City'), value: (v) => v.city ?? '' },
    { key: 'cr', header: tr('السجل / الضريبي', 'CR / VAT'), value: (v) => [v.cr_number, v.vat_number].filter(Boolean).join(' / '), render: (v) => (
      v.cr_number && v.vat_number ? <span className="mono small">{v.cr_number}</span> : <Badge tone="warning">{tr('ناقص', 'Incomplete')}</Badge>
    ) },
    { key: 'rating', header: tr('التقييم', 'Rating'), align: 'end', sortable: true, value: (v) => v.rating, render: (v) => (v.rating === null ? '—' : fmtNumber(v.rating, 2)) },
    { key: 'status', header: tr('الحالة', 'Status'), value: (v) => v.status, render: (v) => <StatusBadge group="entityStatus" value={v.status} /> },
    { key: 'edit', header: '', hideInExport: true, render: (v) => can('vendors.edit') ? <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={(e) => { e.stopPropagation(); setEditing(v); }} /> : null },
  ];

  return (
    <div className="stack">
      <PageHeader title={tr('الموردون', 'Vendors')} subtitle={tr('موردو الخدمات عبر البرامج: التكليفات والعقود والأداء والمستندات.', 'Service vendors across programs: assignments, contracts, performance and documents.')}
        actions={can('vendors.create') ? <Button variant="primary" icon={<Plus />} onClick={() => setEditing('new')}>{tr('مورد جديد', 'New vendor')}</Button> : undefined} />
      <Card><CardBody flush>
        <DataTable columns={cols} rows={rows} rowKey={(v) => v.id} loading={state.loading} error={state.error} onRetry={state.reload} searchable onRowClick={setSelected}
          exportName={can('vendors.export') ? 'vendors' : undefined}
          toolbar={<>
            <Select options={statusOptions} placeholder={tr('كل الحالات', 'All statuses')} value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 120 }} />
            <Select options={categories.map((c) => ({ value: c, label: c }))} placeholder={tr('كل الفئات', 'All categories')} value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: 140 }} />
            <Input placeholder={tr('خدمة', 'Service')} value={service} onChange={(e) => setService(e.target.value)} style={{ width: 130 }} />
          </>}
          empty={{ title: tr('لا يوجد موردون', 'No vendors') }} />
      </CardBody></Card>
      <RecordFormModal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? tr('مورد جديد', 'New vendor') : tr('تعديل المورد', 'Edit vendor')}
        fields={fields} initial={initial(editing === 'new' ? null : editing)} onSubmit={save} size="wide" />
      {selected && <VendorDrawer vendor={selected} onClose={() => setSelected(null)} onEdit={() => setEditing(selected)} />}
    </div>
  );
}
