import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { Button, Card, CardBody, DataTable, PageHeader, Segmented, StatusBadge } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { loadOrgStats, type OrgStat } from '../api';
import { OrgSignals, orgSignals } from '../components/OrgHealth';
import { CreateOrganizationModal } from '../components/CreateOrganizationModal';

type StatusFilter = 'all' | 'active' | 'suspended' | 'archived' | 'attention';

export default function OrganizationsPage() {
  const { tr, pick, fmtDate, fmtNumber } = useI18n();
  const navigate = useNavigate();
  const state = useAsync(loadOrgStats, []);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>('all');

  const rows = useMemo(() => {
    const all = state.data ?? [];
    if (filter === 'all') return all;
    if (filter === 'attention') return all.filter((s) => s.org.status === 'active' && orgSignals(s).some((x) => x.tone === 'danger' || x.tone === 'warning'));
    return all.filter((s) => s.org.status === filter);
  }, [state.data, filter]);

  const count = (f: StatusFilter) => {
    const all = state.data ?? [];
    if (f === 'all') return all.length;
    if (f === 'attention') return all.filter((s) => s.org.status === 'active' && orgSignals(s).some((x) => x.tone === 'danger' || x.tone === 'warning')).length;
    return all.filter((s) => s.org.status === f).length;
  };

  return (
    <div className="stack">
      <PageHeader title={tr('المؤسسات', 'Organizations')} crumbs={[{ label: tr('إدارة المنصة', 'Platform'), to: '/platform' }, { label: tr('المؤسسات', 'Organizations') }]}
        subtitle={tr('المستأجرون على المنصة: أنشئ مؤسسة، فعّل وحداتها، وادعُ مديرها الأول.', 'Tenants on the platform: create an organization, enable its modules and invite its first admin.')}
        actions={<Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>{tr('إنشاء مؤسسة', 'Create organization')}</Button>} />
      <Card>
        <CardBody flush>
          <DataTable<OrgStat> rows={rows} rowKey={(r) => r.org.id} loading={state.loading} error={state.error} onRetry={() => void state.reload()}
            searchable exportName="organizations" pageSize={25} onRowClick={(r) => navigate(`/platform/organizations/${r.org.id}`)}
            toolbar={<Segmented<StatusFilter> value={filter} onChange={setFilter} options={[
              { value: 'all', label: `${tr('الكل', 'All')} (${count('all')})` },
              { value: 'active', label: `${tr('نشطة', 'Active')} (${count('active')})` },
              { value: 'suspended', label: `${tr('موقوفة', 'Suspended')} (${count('suspended')})` },
              { value: 'archived', label: `${tr('مؤرشفة', 'Archived')} (${count('archived')})` },
              { value: 'attention', label: `${tr('تحتاج متابعة', 'Needs attention')} (${count('attention')})` },
            ]} />}
            empty={{ title: tr('لا توجد مؤسسات مطابقة', 'No matching organizations'),
              action: !state.data?.length ? <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>{tr('إنشاء أول مؤسسة', 'Create the first organization')}</Button> : undefined }}
            columns={[
              { key: 'code', header: tr('الرمز', 'Code'), value: (r) => r.org.code, render: (r) => <span className="mono">{r.org.code}</span>, sortable: true },
              { key: 'name', header: tr('الاسم', 'Name'), value: (r) => pick(r.org.name, r.org.name_en), sortable: true,
                render: (r) => <div><div className="strong">{pick(r.org.name, r.org.name_en)}</div><div className="tiny muted">{[r.org.org_type, r.org.sector, r.org.city].filter(Boolean).join(' · ') || '—'}</div></div> },
              { key: 'status', header: tr('الحالة', 'Status'), value: (r) => r.org.status, render: (r) => <StatusBadge group="orgStatus" value={r.org.status} />, sortable: true },
              { key: 'members', header: tr('الأعضاء', 'Members'), align: 'end', value: (r) => r.members, sortable: true,
                render: (r) => <span title={tr('نشط / إجمالي', 'active / total')}>{fmtNumber(r.activeMembers)} / {fmtNumber(r.members)}</span> },
              { key: 'admins', header: tr('المديرون', 'Admins'), align: 'end', value: (r) => r.admins, sortable: true },
              { key: 'programs', header: tr('البرامج', 'Programs'), align: 'end', value: (r) => r.programs, sortable: true },
              { key: 'invites', header: tr('دعوات معلقة', 'Pending invites'), align: 'end', value: (r) => r.pendingInvites, sortable: true },
              { key: 'health', header: tr('مؤشرات الصحة', 'Health signals'), value: (r) => orgSignals(r).map((s) => s.en).join('; '), render: (r) => <OrgSignals stat={r} /> },
              { key: 'created', header: tr('تاريخ الإنشاء', 'Created'), value: (r) => r.org.created_at, render: (r) => <span className="nowrap">{fmtDate(r.org.created_at)}</span>, sortable: true },
            ]} />
        </CardBody>
      </Card>
      <CreateOrganizationModal open={creating} onClose={() => setCreating(false)} onCreated={() => void state.reload()} />
    </div>
  );
}
