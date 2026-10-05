import { useMemo, useState } from 'react';
import { AlertTriangle, Pencil, Plus } from 'lucide-react';
import { Button, Card, CardBody, DataTable, Notice, PageHeader, Select, StatusBadge, type Column } from '@/components/ui';
import { RecordFormModal, type FieldSpec } from '@/components/forms/RecordForm';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { useAsync } from '@/hooks/useAsync';
import { all, insert, update } from '@/services/db';
import type { Partner } from '@/types/db';
import { AgreementBadge, agreementState } from '../components/agreement';
import { PartnerDrawer } from '../components/PartnerDrawer';

export default function PartnersPage() {
  const { org, can } = useOrg();
  const { tr, enumLabel, enumOptions, fmtDate } = useI18n();
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [agreement, setAgreement] = useState('');
  const [editing, setEditing] = useState<Partner | 'new' | null>(null);
  const [selected, setSelected] = useState<Partner | null>(null);
  const state = useAsync(() => all<Partner>('partners', { filters: [['organization_id', 'eq', org.id]], order: { column: 'name', ascending: true } }, 5000), [org.id]);
  const rows = useMemo(() => (state.data ?? []).filter((p) => (!type || p.partner_type === type) && (!status || p.status === status)
    && (!agreement || agreementState(p) === agreement)), [state.data, type, status, agreement]);
  const expiring = (state.data ?? []).filter((p) => p.status === 'active' && agreementState(p) === 'expiring');
  const expired = (state.data ?? []).filter((p) => p.status === 'active' && agreementState(p) === 'expired');
  const statusOptions = enumOptions('entityStatus').filter((o) => ['prospect', 'active', 'inactive'].includes(o.value));

  const fields: FieldSpec[] = [
    { name: 'name', label: ['اسم الشريك', 'Partner name'], type: 'text', required: true },
    { name: 'partner_type', label: ['نوع الشراكة', 'Partner type'], type: 'enum', enumGroup: 'partnerType' },
    { name: 'contact_name', label: ['جهة الاتصال', 'Contact name'], type: 'text' },
    { name: 'email', label: ['البريد الإلكتروني', 'Email'], type: 'email' },
    { name: 'mobile', label: ['الجوال', 'Mobile'], type: 'tel' },
    { name: 'status', label: ['الحالة', 'Status'], type: 'select', options: statusOptions, required: true },
    { name: 'agreement_start', label: ['بداية الاتفاقية', 'Agreement start'], type: 'date' },
    { name: 'agreement_end', label: ['نهاية الاتفاقية', 'Agreement end'], type: 'date',
      validate: (v, all) => (v && all.agreement_start && String(v) < String(all.agreement_start) ? ['النهاية قبل البداية', 'End is before start'] : null) },
    { name: 'notes', label: ['ملاحظات', 'Notes'], type: 'textarea' },
  ];
  const initial = (p: Partner | null): Record<string, unknown> => p ? {
    name: p.name, partner_type: p.partner_type, contact_name: p.contact_name, email: p.email, mobile: p.mobile, status: p.status,
    agreement_start: p.agreement_start, agreement_end: p.agreement_end, notes: p.notes,
  } : { status: 'active' };
  const save = async (v: Record<string, unknown>) => {
    if (editing && editing !== 'new') {
      const u = await update<Partner>('partners', editing.id, v);
      if (selected?.id === u.id) setSelected(u);
    } else await insert<Partner>('partners', { ...v, organization_id: org.id });
    await state.reload();
  };

  const cols: Column<Partner>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), value: (p) => p.code, sortable: true, render: (p) => <span className="mono">{p.code}</span> },
    { key: 'name', header: tr('الشريك', 'Partner'), value: (p) => p.name, sortable: true, render: (p) => <div><b>{p.name}</b>{p.contact_name && <span className="sub">{p.contact_name}</span>}</div> },
    { key: 'type', header: tr('النوع', 'Type'), value: (p) => enumLabel('partnerType', p.partner_type) },
    { key: 'contact', header: tr('التواصل', 'Contact'), value: (p) => [p.email, p.mobile].filter(Boolean).join(' / '), render: (p) => <div className="small"><span className="ltr">{p.email ?? '—'}</span>{p.mobile && <span className="sub ltr">{p.mobile}</span>}</div> },
    { key: 'agreement', header: tr('الاتفاقية', 'Agreement'), value: (p) => `${p.agreement_start ?? ''} – ${p.agreement_end ?? ''}`, sortable: true,
      render: (p) => <div className="small">{p.agreement_start || p.agreement_end ? `${fmtDate(p.agreement_start)} – ${fmtDate(p.agreement_end)}` : ''}</div> },
    { key: 'validity', header: tr('الصلاحية', 'Validity'), value: (p) => agreementState(p), render: (p) => <AgreementBadge p={p} /> },
    { key: 'status', header: tr('الحالة', 'Status'), value: (p) => p.status, render: (p) => <StatusBadge group="entityStatus" value={p.status} /> },
    { key: 'edit', header: '', hideInExport: true, render: (p) => can('partners.edit') ? <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={(e) => { e.stopPropagation(); setEditing(p); }} /> : null },
  ];
  const agreementOptions = [
    { value: 'valid', label: tr('سارية', 'Valid') }, { value: 'expiring', label: tr('تنتهي خلال 60 يومًا', 'Expiring within 60 days') },
    { value: 'expired', label: tr('منتهية', 'Expired') }, { value: 'not_started', label: tr('لم تبدأ', 'Not started') },
    { value: 'open_ended', label: tr('مفتوحة', 'Open-ended') }, { value: 'none', label: tr('بلا اتفاقية', 'No agreement') },
  ];

  return (
    <div className="stack">
      <PageHeader title={tr('الشركاء', 'Partners')} subtitle={tr('الممولون والجهات الحكومية وشركاء التنفيذ والتوظيف، مع متابعة صلاحية الاتفاقيات.', 'Funders, government, implementing and employer partners, with agreement validity tracking.')}
        actions={can('partners.create') ? <Button variant="primary" icon={<Plus />} onClick={() => setEditing('new')}>{tr('شريك جديد', 'New partner')}</Button> : undefined} />
      {(expiring.length > 0 || expired.length > 0) && (
        <Notice tone={expired.length ? 'danger' : 'warning'} icon={<AlertTriangle />}>
          {expired.length > 0 && <div>{tr(`${expired.length} شريك نشط اتفاقيته منتهية: `, `${expired.length} active partners have an expired agreement: `)}{expired.map((p) => p.name).join('، ')}</div>}
          {expiring.length > 0 && <div>{tr(`${expiring.length} اتفاقية تنتهي خلال 60 يومًا: `, `${expiring.length} agreements expire within 60 days: `)}{expiring.map((p) => p.name).join('، ')}</div>}
        </Notice>
      )}
      <Card><CardBody flush>
        <DataTable columns={cols} rows={rows} rowKey={(p) => p.id} loading={state.loading} error={state.error} onRetry={state.reload} searchable onRowClick={setSelected}
          exportName={can('partners.export') ? 'partners' : undefined}
          toolbar={<>
            <Select options={enumOptions('partnerType')} placeholder={tr('كل الأنواع', 'All types')} value={type} onChange={(e) => setType(e.target.value)} style={{ width: 130 }} />
            <Select options={statusOptions} placeholder={tr('كل الحالات', 'All statuses')} value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 120 }} />
            <Select options={agreementOptions} placeholder={tr('كل الاتفاقيات', 'All agreements')} value={agreement} onChange={(e) => setAgreement(e.target.value)} style={{ width: 170 }} />
          </>}
          empty={{ title: tr('لا يوجد شركاء', 'No partners') }} />
      </CardBody></Card>
      <RecordFormModal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? tr('شريك جديد', 'New partner') : tr('تعديل الشريك', 'Edit partner')}
        fields={fields} initial={initial(editing === 'new' ? null : editing)} onSubmit={save} size="wide" />
      {selected && <PartnerDrawer partner={selected} onClose={() => setSelected(null)} onEdit={() => setEditing(selected)} />}
    </div>
  );
}
