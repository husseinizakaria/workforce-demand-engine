import { useState } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router';
import { Pencil, RefreshCw, Star } from 'lucide-react';
import { AsyncView, Badge, Button, Card, LinkTabs, PageHeader, StatusBadge } from '@/components/ui';
import { RecordFormModal } from '@/components/forms/RecordForm';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { useAsync } from '@/hooks/useAsync';
import { update } from '@/services/db';
import { NotFoundPage } from '@/pages/MiscPages';
import type { Expert } from '@/types/db';
import { EntityDocuments } from '@/features/beneficiaries/components/EntityDocuments';
import { expertFields, expertInitial, expertRow } from '../components/expertForm';
import { loadE360 } from '../components/e360/data';
import { ExpertiseTab, ProfileTab, QualificationsTab } from '../components/e360/ProfileTabs';
import { AssignmentsTab, FinancialTab, PerformanceTab } from '../components/e360/WorkTabs';
import { AvailabilityTab } from '../components/e360/AvailabilityTab';

export default function Expert360Page() {
  const { expertId = '' } = useParams();
  const { org, can } = useOrg();
  const { tr, pick, enumLabel, enumOptions, fmtNumber } = useI18n();
  const state = useAsync(() => loadE360(org.id, expertId), [org.id, expertId]);
  const [editOpen, setEditOpen] = useState(false);
  const base = `/app/experts/${expertId}`;
  const statusOptions = enumOptions('entityStatus').filter((o) => ['active', 'inactive', 'blocked'].includes(o.value));
  const reload = () => void state.reload();

  return (
    <AsyncView state={state} rows={8}>
      {(d) => {
        const e = d.expert;
        if (e.organization_id !== org.id) return <NotFoundPage />;
        return (
          <div className="stack">
            <PageHeader crumbs={[{ label: tr('الخبراء', 'Experts'), to: '/app/experts' }, { label: e.code }]}
              title={pick(e.full_name, e.full_name_en)}
              badge={<><StatusBadge group="entityStatus" value={e.status} />{e.rating !== null && <Badge tone="info" icon={<Star size={12} />}>{fmtNumber(e.rating, 2)}</Badge>}{e.user_id && <Badge tone="info">{tr('حساب بوابة', 'Portal account')}</Badge>}</>}
              subtitle={[e.code, e.roles.map((r) => enumLabel('expertRole', r)).join('، '), e.city].filter(Boolean).join(' · ')}
              actions={<>
                <Button icon={<RefreshCw />} loading={state.loading} onClick={reload}>{tr('تحديث', 'Refresh')}</Button>
                {can('experts.edit') && <Button variant="primary" icon={<Pencil />} onClick={() => setEditOpen(true)}>{tr('تعديل', 'Edit')}</Button>}
              </>} />
            <LinkTabs base={base} items={[
              { key: 'profile', label: tr('الملف', 'Profile') },
              { key: 'expertise', label: tr('الخبرات', 'Expertise') },
              { key: 'qualifications', label: tr('المؤهلات', 'Qualifications') },
              { key: 'assignments', label: tr('التكليفات', 'Assignments'), badge: <span className="badge">{d.assignments.length}</span> },
              { key: 'performance', label: tr('الأداء', 'Performance') },
              { key: 'availability', label: tr('التوفر', 'Availability') },
              { key: 'financial', label: tr('المالية', 'Financial') },
              { key: 'documents', label: tr('المستندات', 'Documents') },
            ]} />
            <Routes>
              <Route index element={<Navigate to="profile" replace />} />
              <Route path="profile" element={<ProfileTab d={d} />} />
              <Route path="expertise" element={<ExpertiseTab d={d} onSaved={reload} />} />
              <Route path="qualifications" element={<QualificationsTab d={d} onSaved={reload} />} />
              <Route path="assignments" element={<AssignmentsTab d={d} />} />
              <Route path="performance" element={<PerformanceTab d={d} />} />
              <Route path="availability" element={<AvailabilityTab d={d} onChanged={reload} />} />
              <Route path="financial" element={<FinancialTab d={d} />} />
              <Route path="documents" element={<EntityDocuments owner="expert_id" ownerId={e.id} defaultType="cv" />} />
              <Route path="*" element={<Card><NotFoundPage /></Card>} />
            </Routes>
            <RecordFormModal open={editOpen} size="wide" onClose={() => setEditOpen(false)} title={tr('تعديل الخبير', 'Edit expert')}
              fields={expertFields(statusOptions)} initial={expertInitial(e)}
              onSubmit={async (v) => { await update<Expert>('experts', e.id, expertRow(v)); await state.reload(); }} />
          </div>
        );
      }}
    </AsyncView>
  );
}
