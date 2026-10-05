import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Pencil, Plus, Sparkles, Star } from 'lucide-react';
import { termsMatch } from '@engine';
import { Badge, Button, Card, CardBody, DataTable, Input, PageHeader, Select, StatusBadge, type Column } from '@/components/ui';
import { RecordFormModal } from '@/components/forms/RecordForm';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { useAsync } from '@/hooks/useAsync';
import { all, insert, update } from '@/services/db';
import type { Expert, ExpertAssignment } from '@/types/db';
import { expertFields, expertInitial, expertRow } from '../components/expertForm';
import { MatchingDrawer } from '../components/MatchingDrawer';

export default function ExpertsPage() {
  const { org, can } = useOrg();
  const { tr, enumLabel, enumOptions, fmtNumber, pick } = useI18n();
  const navigate = useNavigate();
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [expertise, setExpertise] = useState('');
  const [sector, setSector] = useState('');
  const [language, setLanguage] = useState('');
  const [minRating, setMinRating] = useState('');
  const [editing, setEditing] = useState<Expert | 'new' | null>(null);
  const [matchOpen, setMatchOpen] = useState(false);

  const state = useAsync(async () => {
    const [experts, assignments] = await Promise.all([
      all<Expert>('experts', { filters: [['organization_id', 'eq', org.id]], order: { column: 'full_name', ascending: true } }, 5000),
      all<Pick<ExpertAssignment, 'expert_id' | 'status' | 'performance_rating'>>('expert_assignments', { select: 'expert_id,status,performance_rating', filters: [['organization_id', 'eq', org.id]] }, 20000).catch(() => []),
    ]);
    const active = new Map<string, number>();
    for (const a of assignments) if (['proposed', 'confirmed', 'active'].includes(a.status)) active.set(a.expert_id, (active.get(a.expert_id) ?? 0) + 1);
    return { experts, active };
  }, [org.id]);

  const languages = useMemo(() => [...new Set((state.data?.experts ?? []).flatMap((e) => e.languages))].sort(), [state.data]);
  const rows = useMemo(() => (state.data?.experts ?? []).filter((e) =>
    (!role || e.roles.includes(role as Expert['roles'][number]))
    && (!status || e.status === status)
    && (!expertise.trim() || e.expertise.some((x) => termsMatch(x, expertise)))
    && (!sector.trim() || e.sectors.some((x) => termsMatch(x, sector)))
    && (!language || e.languages.includes(language))
    && (!minRating || (e.rating ?? 0) >= Number(minRating))), [state.data, role, status, expertise, sector, language, minRating]);

  const statusOptions = enumOptions('entityStatus').filter((o) => ['active', 'inactive', 'blocked'].includes(o.value));
  const save = async (v: Record<string, unknown>) => {
    const row = expertRow(v);
    if (editing && editing !== 'new') await update<Expert>('experts', editing.id, row);
    else {
      const created = await insert<Expert>('experts', { ...row, organization_id: org.id });
      navigate(`/app/experts/${created.id}/profile`);
      return;
    }
    await state.reload();
  };

  const cols: Column<Expert>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), value: (e) => e.code, render: (e) => <span className="mono">{e.code}</span>, sortable: true },
    { key: 'name', header: tr('الاسم', 'Name'), value: (e) => pick(e.full_name, e.full_name_en), sortable: true, render: (e) => <div><b>{pick(e.full_name, e.full_name_en)}</b>{e.city && <span className="sub">{e.city}</span>}</div> },
    { key: 'roles', header: tr('الأدوار', 'Roles'), value: (e) => e.roles.map((r) => enumLabel('expertRole', r)).join(', '), render: (e) => <div className="row wrap" style={{ gap: 3 }}>{e.roles.map((r) => <Badge key={r} tone="outline">{enumLabel('expertRole', r)}</Badge>)}</div> },
    { key: 'expertise', header: tr('الخبرات', 'Expertise'), value: (e) => e.expertise.join('; '), render: (e) => <span className="small">{e.expertise.slice(0, 4).join('، ')}{e.expertise.length > 4 ? ` +${e.expertise.length - 4}` : ''}</span> },
    { key: 'sectors', header: tr('القطاعات', 'Sectors'), value: (e) => e.sectors.join('; '), render: (e) => <span className="small">{e.sectors.join('، ') || '—'}</span> },
    { key: 'languages', header: tr('اللغات', 'Languages'), value: (e) => e.languages.join(', '), render: (e) => <span className="mono">{e.languages.join(', ')}</span> },
    { key: 'rating', header: tr('التقييم', 'Rating'), align: 'end', sortable: true, value: (e) => e.rating, render: (e) => (e.rating === null ? '—' : <span className="row" style={{ justifyContent: 'flex-end', gap: 3 }}><Star size={12} />{fmtNumber(e.rating, 2)}</span>) },
    { key: 'load', header: tr('تكليفات نشطة', 'Active assignments'), align: 'end', sortable: true, value: (e) => state.data?.active.get(e.id) ?? 0 },
    { key: 'max', header: tr('ساعات/أسبوع', 'Hrs/week'), align: 'end', value: (e) => e.max_weekly_hours },
    { key: 'status', header: tr('الحالة', 'Status'), value: (e) => e.status, render: (e) => <StatusBadge group="entityStatus" value={e.status} /> },
    { key: 'flags', header: '', hideInExport: true, render: (e) => <div className="row" style={{ gap: 4 }}>
      {e.user_id && <Badge tone="info">{tr('بوابة', 'Portal')}</Badge>}
      {e.conflicts.length > 0 && <Badge tone="warning" title={e.conflicts.join(', ')}>{tr('تعارض مُعلن', 'Conflicts')}</Badge>}
      {can('experts.edit') && <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={(x) => { x.stopPropagation(); setEditing(e); }} />}
    </div> },
  ];

  return (
    <div className="stack">
      <PageHeader title={tr('الخبراء والمدربون', 'Experts & trainers')} subtitle={tr('سجل الخبراء بأدوارهم وخبراتهم وتوفرهم، مع مطابقة ذكية قابلة للتفسير.', 'Expert registry with roles, expertise and availability, plus explainable smart matching.')}
        actions={<>
          <Button icon={<Sparkles />} onClick={() => setMatchOpen(true)}>{tr('المطابقة الذكية', 'Smart matching')}</Button>
          {can('experts.create') && <Button variant="primary" icon={<Plus />} onClick={() => setEditing('new')}>{tr('خبير جديد', 'New expert')}</Button>}
        </>} />
      <Card>
        <CardBody flush>
          <DataTable columns={cols} rows={rows} rowKey={(e) => e.id} loading={state.loading} error={state.error} onRetry={state.reload} searchable
            onRowClick={(e) => navigate(`/app/experts/${e.id}/profile`)} exportName={can('experts.export') ? 'experts' : undefined} pageSize={30}
            toolbar={<>
              <Select options={enumOptions('expertRole')} placeholder={tr('كل الأدوار', 'All roles')} value={role} onChange={(e) => setRole(e.target.value)} style={{ width: 120 }} />
              <Select options={statusOptions} placeholder={tr('كل الحالات', 'All statuses')} value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 120 }} />
              <Input placeholder={tr('خبرة', 'Expertise')} value={expertise} onChange={(e) => setExpertise(e.target.value)} style={{ width: 120 }} />
              <Input placeholder={tr('قطاع', 'Sector')} value={sector} onChange={(e) => setSector(e.target.value)} style={{ width: 110 }} />
              <Select options={languages.map((l) => ({ value: l, label: l }))} placeholder={tr('كل اللغات', 'All languages')} value={language} onChange={(e) => setLanguage(e.target.value)} style={{ width: 110 }} />
              <Select options={['3', '3.5', '4', '4.5'].map((v) => ({ value: v, label: `≥ ${v}` }))} placeholder={tr('أي تقييم', 'Any rating')} value={minRating} onChange={(e) => setMinRating(e.target.value)} style={{ width: 100 }} />
              <span className="small muted">{fmtNumber(rows.length)} / {fmtNumber(state.data?.experts.length ?? 0)}</span>
            </>}
            empty={{ title: tr('لا يوجد خبراء مطابقون', 'No matching experts') }} />
        </CardBody>
      </Card>
      <RecordFormModal open={editing !== null} size="wide" onClose={() => setEditing(null)} title={editing === 'new' ? tr('خبير جديد', 'New expert') : tr('تعديل الخبير', 'Edit expert')}
        fields={expertFields(statusOptions)} initial={expertInitial(editing === 'new' ? null : editing)} onSubmit={save} />
      <MatchingDrawer open={matchOpen} onClose={() => setMatchOpen(false)} />
    </div>
  );
}
