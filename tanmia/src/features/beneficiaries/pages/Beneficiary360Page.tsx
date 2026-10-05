import { useState } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router';
import { Pencil, RefreshCw } from 'lucide-react';
import { AsyncView, Badge, Button, Card, LinkTabs, PageHeader, StatusBadge } from '@/components/ui';
import { RecordFormModal } from '@/components/forms/RecordForm';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { useAsync } from '@/hooks/useAsync';
import { update } from '@/services/db';
import { NotFoundPage } from '@/pages/MiscPages';
import type { Beneficiary } from '@/types/db';
import { beneficiaryFields, beneficiaryInitial, checkDuplicatesRemote, DUP_LABEL } from '../components/beneficiaryForm';
import { EntityDocuments } from '../components/EntityDocuments';
import { loadB360 } from '../components/b360/data';
import { OverviewTab } from '../components/b360/OverviewTab';
import { JourneyTab, ProgramsTab } from '../components/b360/JourneyTab';
import { OutcomesTab, SkillsTab } from '../components/b360/SkillsTab';
import { AssessmentsTab } from '../components/b360/AssessmentsTab';
import { MentoringTab, ProjectsTab } from '../components/b360/MentoringTab';
import { EvidenceTab, ImpactTab } from '../components/b360/ImpactTab';

export default function Beneficiary360Page() {
  const { beneficiaryId = '' } = useParams();
  const { org, can } = useOrg();
  const { tr, pick, enumLabel, fmtDate } = useI18n();
  const state = useAsync(() => loadB360(org.id, beneficiaryId), [org.id, beneficiaryId]);
  const [editOpen, setEditOpen] = useState(false);
  const base = `/app/beneficiaries/${beneficiaryId}`;
  const statusOptions = [{ value: 'active', label: enumLabel('entityStatus', 'active') }, { value: 'inactive', label: enumLabel('entityStatus', 'inactive') }, { value: 'archived', label: enumLabel('entityStatus', 'archived') }];

  return (
    <AsyncView state={state} rows={8}>
      {(d) => {
        const b = d.ben;
        if (b.organization_id !== org.id) return <NotFoundPage />;
        const save = async (v: Record<string, unknown>) => {
          const dups = await checkDuplicatesRemote(org.id, v, b.id);
          if (dups.length) {
            throw { code: 'duplicate', message_ar: `تكرار محتمل مع: ${dups.map((x) => `${x.existing.full_name} (${x.existing.code}) — ${DUP_LABEL[x.key][0]}`).join('، ')}`,
              message_en: `Possible duplicate of: ${dups.map((x) => `${x.existing.full_name} (${x.existing.code}) — ${DUP_LABEL[x.key][1]}`).join(', ')}` };
          }
          const row: Record<string, unknown> = { ...v };
          if (v.consent_given && !b.consent_given) row.consent_at = new Date().toISOString();
          if (!v.consent_given) row.consent_at = null;
          await update<Beneficiary>('beneficiaries', b.id, row);
          await state.reload();
        };
        return (
          <div className="stack">
            <PageHeader
              crumbs={[{ label: tr('المستفيدون', 'Beneficiaries'), to: '/app/beneficiaries' }, { label: b.code }]}
              title={pick(b.full_name, b.full_name_en)}
              badge={<><StatusBadge group="entityStatus" value={b.status} />{b.user_id && <Badge tone="info">{tr('حساب بوابة', 'Portal account')}</Badge>}</>}
              subtitle={[b.code, enumLabel('gender', b.gender), b.city, enumLabel('employment', b.employment_status), `${tr('مسجل منذ', 'Registered')} ${fmtDate(b.created_at)}`].filter((x) => x && x !== '—').join(' · ')}
              actions={<>
                <Button icon={<RefreshCw />} onClick={() => void state.reload()} loading={state.loading}>{tr('تحديث', 'Refresh')}</Button>
                {can('beneficiaries.edit') && <Button variant="primary" icon={<Pencil />} onClick={() => setEditOpen(true)}>{tr('تعديل الملف', 'Edit profile')}</Button>}
              </>} />
            <LinkTabs base={base} items={[
              { key: 'overview', label: tr('نظرة عامة', 'Overview') },
              { key: 'journey', label: tr('المسار', 'Journey') },
              { key: 'programs', label: tr('البرامج', 'Programs'), badge: <span className="badge">{d.enrollments.length}</span> },
              { key: 'skills', label: tr('المهارات', 'Skills') },
              { key: 'assessments', label: tr('التقييمات', 'Assessments'), badge: <span className="badge">{d.results.length}</span> },
              { key: 'mentoring', label: tr('الإرشاد', 'Mentoring') },
              { key: 'projects', label: tr('المشاريع', 'Projects') },
              { key: 'outcomes', label: tr('النتائج', 'Outcomes') },
              { key: 'impact', label: tr('الأثر', 'Impact') },
              { key: 'evidence', label: tr('الأدلة', 'Evidence'), badge: <span className="badge">{d.evidence.length}</span> },
              { key: 'documents', label: tr('المستندات', 'Documents') },
            ]} />
            <Routes>
              <Route index element={<Navigate to="overview" replace />} />
              <Route path="overview" element={<OverviewTab d={d} />} />
              <Route path="journey" element={<JourneyTab d={d} />} />
              <Route path="programs" element={<ProgramsTab d={d} />} />
              <Route path="skills" element={<SkillsTab d={d} />} />
              <Route path="assessments" element={<AssessmentsTab d={d} />} />
              <Route path="mentoring" element={<MentoringTab d={d} />} />
              <Route path="projects" element={<ProjectsTab d={d} />} />
              <Route path="outcomes" element={<OutcomesTab d={d} />} />
              <Route path="impact" element={<ImpactTab d={d} />} />
              <Route path="evidence" element={<EvidenceTab d={d} />} />
              <Route path="documents" element={<EntityDocuments owner="beneficiary_id" ownerId={b.id} defaultType="id" />} />
              <Route path="*" element={<Card><NotFoundPage /></Card>} />
            </Routes>
            <RecordFormModal open={editOpen} size="wide" onClose={() => setEditOpen(false)} title={tr('تعديل المستفيد', 'Edit beneficiary')}
              fields={beneficiaryFields(statusOptions)} initial={beneficiaryInitial(b)} onSubmit={save} />
          </div>
        );
      }}
    </AsyncView>
  );
}
