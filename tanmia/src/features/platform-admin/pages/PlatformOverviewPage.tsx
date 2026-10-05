import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Building2, CalendarClock, CheckCircle2, Circle, FileCheck2, Gauge, ListChecks, Plus, RefreshCw, ScrollText, ShieldAlert, Users, FolderKanban, UserRound } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useAuth } from '@/app/AuthProvider';
import { AsyncView, Badge, Button, Card, CardBody, CardHeader, DataTable, InsightList, Kpi, PageHeader, StatusBadge } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import * as db from '@/services/db';
import type { AuditLog, IntegrationSetting } from '@/types/db';
import { loadOrgStats, type OrgStat } from '../api';
import { OrgSignals, platformInsights } from '../components/OrgHealth';
import { CreateOrganizationModal } from '../components/CreateOrganizationModal';

interface Overview {
  stats: OrgStat[];
  users: number;
  superAdmins: number;
  beneficiaries: number;
  sessions7: number;
  evidencePending: number;
  centralTools: number;
  centralForms: number;
  centralMaturity: number;
  centralImpact: number;
  tracks: number;
  platformSettings: boolean;
  integrations: IntegrationSetting[];
  audit: AuditLog[];
}

async function loadOverview(): Promise<Overview> {
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 864e5);
  const [stats, users, superAdmins, beneficiaries, sessions7, evidencePending, centralTools, centralForms, centralMaturity, centralImpact, tracks, platformSetting, integrations, audit] = await Promise.all([
    loadOrgStats(),
    db.count('profiles'),
    db.count('platform_users', [['is_platform_super_admin', 'eq', true], ['active', 'eq', true]]),
    db.count('beneficiaries'),
    db.count('sessions', [['starts_at', 'gte', now.toISOString()], ['starts_at', 'lt', in7.toISOString()], ['status', 'in', ['scheduled', 'rescheduled']]]),
    db.count('evidence', [['verification_status', 'eq', 'pending']]),
    db.count('assessment_tools', [['organization_id', 'is', null]]),
    db.count('form_templates', [['organization_id', 'is', null]]),
    db.count('maturity_frameworks', [['organization_id', 'is', null]]),
    db.count('impact_frameworks', [['organization_id', 'is', null]]),
    db.count('program_track_templates', [['active', 'eq', true]]),
    db.maybe<{ id: string }>('system_settings', [['organization_id', 'is', null], ['setting_key', 'eq', 'platform']], 'id'),
    db.all<IntegrationSetting>('integration_settings', { filters: [['organization_id', 'is', null]], order: { column: 'provider', ascending: true } }),
    db.list<AuditLog>('audit_log', { pageSize: 10, order: { column: 'created_at', ascending: false } }),
  ]);
  return {
    stats, users, superAdmins, beneficiaries, sessions7, evidencePending, centralTools, centralForms, centralMaturity, centralImpact, tracks,
    platformSettings: !!platformSetting, integrations, audit: audit.rows,
  };
}

interface CheckItem { key: string; done: boolean; ar: string; en: string; hintAr: string; hintEn: string; to: string; optional?: boolean }

export default function PlatformOverviewPage() {
  const { tr, fmtNumber, fmtDateTime, pick, enumLabel } = useI18n();
  const { access } = useAuth();
  const navigate = useNavigate();
  const state = useAsync(loadOverview, []);
  const [creating, setCreating] = useState(false);

  const insights = useMemo(() => (state.data ? platformInsights(state.data.stats) : []), [state.data]);

  return (
    <div className="stack">
      <PageHeader title={tr('نظرة عامة على المنصة', 'Platform overview')}
        subtitle={tr(`مرحبًا ${access?.profile?.full_name ?? ''} — حالة جميع المؤسسات المستأجرة والإعداد المركزي في مكان واحد.`, `Welcome ${access?.profile?.full_name ?? ''} — the state of every tenant and the central setup in one place.`)}
        actions={<>
          <Button icon={<RefreshCw />} onClick={() => void state.reload()} loading={state.loading && !!state.data}>{tr('تحديث', 'Refresh')}</Button>
          <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>{tr('إنشاء مؤسسة', 'Create organization')}</Button>
        </>} />

      <AsyncView state={state} rows={8}>
        {(d) => {
          const orgs = d.stats;
          const byStatus = (s: string) => orgs.filter((o) => o.org.status === s).length;
          const programs = orgs.reduce((a, o) => a + o.programs, 0);
          const activePrograms = orgs.reduce((a, o) => a + o.activePrograms, 0);
          const highOpen = orgs.reduce((a, o) => a + o.openHighInsights, 0);
          const integ = (p: string) => d.integrations.find((i) => i.provider === p);
          const orgName = (id: string | null) => { const o = orgs.find((x) => x.org.id === id)?.org; return o ? pick(o.name, o.name_en) : null; };
          const activeOrgs = orgs.filter((o) => o.org.status === 'active');

          const checklist: CheckItem[] = [
            { key: 'org', done: orgs.length > 0, ar: 'إنشاء أول مؤسسة', en: 'Create the first organization', hintAr: 'كل العمل التشغيلي يتم داخل مؤسسة.', hintEn: 'All operational work happens inside an organization.', to: '/platform/organizations' },
            { key: 'admins', done: activeOrgs.length > 0 && activeOrgs.every((o) => o.admins > 0), ar: 'لكل مؤسسة نشطة مدير مؤسسة نشط', en: 'Every active organization has an active admin', hintAr: `${activeOrgs.filter((o) => o.admins === 0).length} مؤسسات بلا مدير`, hintEn: `${activeOrgs.filter((o) => o.admins === 0).length} organizations without an admin`, to: '/platform/organizations' },
            { key: 'settings', done: d.platformSettings, ar: 'ضبط إعدادات المنصة (الاسم، اللغة، صلاحية الدعوات)', en: 'Configure platform settings (name, locale, invitation TTL)', hintAr: 'إعدادات النظام', hintEn: 'System settings', to: '/platform/settings' },
            { key: 'email', done: !!integ('email')?.enabled, ar: 'تفعيل البريد الإلكتروني للدعوات والإشعارات', en: 'Enable email for invitations and notifications', hintAr: 'بدونه تُشارك روابط الدعوة يدويًا.', hintEn: 'Without it, invitation links must be shared manually.', to: '/platform/integrations' },
            { key: 'ai', done: !!integ('ai')?.enabled, optional: true, ar: 'تفعيل التحليل بالذكاء الاصطناعي (اختياري)', en: 'Enable AI analysis (optional)', hintAr: 'المحرك القائم على القواعد يعمل دائمًا.', hintEn: 'The rules engine always works without it.', to: '/platform/integrations' },
            { key: 'tracks', done: d.tracks >= 6, ar: 'قوالب المسارات الستة متاحة', en: 'All six track templates available', hintAr: `${d.tracks} / 6 مسارات نشطة`, hintEn: `${d.tracks} / 6 active tracks`, to: '/platform/tracks' },
            { key: 'tools', done: d.centralTools > 0 && d.centralForms > 0, ar: 'قوالب مركزية للتقييم والنماذج', en: 'Central assessment tools and form templates', hintAr: `${d.centralTools} أداة · ${d.centralForms} نموذج`, hintEn: `${d.centralTools} tools · ${d.centralForms} forms`, to: '/platform/templates' },
            { key: 'frameworks', done: d.centralMaturity > 0 && d.centralImpact > 0, ar: 'أطر نضج وأثر مركزية', en: 'Central maturity and impact frameworks', hintAr: `${d.centralMaturity} إطار نضج · ${d.centralImpact} إطار أثر`, hintEn: `${d.centralMaturity} maturity · ${d.centralImpact} impact frameworks`, to: d.centralMaturity === 0 ? '/platform/frameworks/maturity' : '/platform/frameworks/impact' },
            { key: 'owners', done: d.superAdmins >= 2, ar: 'مالك منصة احتياطي ثانٍ', en: 'A second (backup) platform owner', hintAr: 'يمنع فقدان الوصول إذا تعذر وصول المالك الوحيد.', hintEn: 'Prevents lock-out if the only owner is unavailable.', to: '/platform/users' },
          ];
          const required = checklist.filter((c) => !c.optional);
          const doneCount = required.filter((c) => c.done).length;

          return (
            <>
              <div className="grid g4">
                <Kpi icon={<Building2 />} label={tr('المؤسسات', 'Organizations')} value={fmtNumber(orgs.length)}
                  hint={`${enumLabel('orgStatus', 'active')} ${fmtNumber(byStatus('active'))} · ${enumLabel('orgStatus', 'suspended')} ${fmtNumber(byStatus('suspended'))} · ${enumLabel('orgStatus', 'archived')} ${fmtNumber(byStatus('archived'))}`} />
                <Kpi icon={<Users />} label={tr('المستخدمون', 'Users')} value={fmtNumber(d.users)} hint={tr(`${d.superAdmins} مالك منصة`, `${d.superAdmins} platform owners`)} />
                <Kpi icon={<FolderKanban />} label={tr('البرامج', 'Programs')} value={fmtNumber(programs)} hint={tr(`${fmtNumber(activePrograms)} نشطة`, `${fmtNumber(activePrograms)} active`)} />
                <Kpi icon={<UserRound />} label={tr('المستفيدون', 'Beneficiaries')} value={fmtNumber(d.beneficiaries)} />
                <Kpi icon={<CalendarClock />} label={tr('جلسات الأيام السبعة القادمة', 'Sessions next 7 days')} value={fmtNumber(d.sessions7)} />
                <Kpi icon={<FileCheck2 />} label={tr('أدلة بانتظار التحقق', 'Evidence pending verification')} value={fmtNumber(d.evidencePending)} tone={d.evidencePending > 50 ? 'warning' : undefined} />
                <Kpi icon={<ShieldAlert />} label={tr('ملاحظات عالية/حرجة مفتوحة', 'Open high/critical findings')} value={fmtNumber(highOpen)} tone={highOpen ? 'danger' : 'success'} />
                <Kpi icon={<ListChecks />} label={tr('جاهزية الإعداد', 'Setup readiness')} value={`${doneCount} / ${required.length}`} tone={doneCount === required.length ? 'success' : 'warning'} />
              </div>

              <div className="grid g-2-1">
                <Card>
                  <CardHeader icon={<Gauge />} title={tr('ملاحظات المنصة', 'Platform findings')} hint={tr('قواعد مالك المنصة — توصيات للمراجعة وليست قرارات تلقائية', 'Platform owner rules — recommendations to review, never automatic decisions')} />
                  <CardBody>
                    <InsightList insights={insights} max={8} linkBase="/platform/organizations"
                      emptyTitle={tr('لا توجد ملاحظات على المؤسسات حاليًا', 'No findings on organizations right now')} />
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader icon={<ListChecks />} title={tr('قائمة إعداد المنصة', 'Platform setup checklist')} hint={`${doneCount}/${required.length}`} />
                  <CardBody>
                    <ul className="list-plain">
                      {checklist.map((c) => (
                        <li key={c.key} className="row start">
                          {c.done ? <CheckCircle2 size={17} style={{ color: 'var(--success)', flex: 'none' }} /> : <Circle size={17} style={{ color: c.optional ? 'var(--text-2)' : 'var(--warning)', flex: 'none' }} />}
                          <div className="grow">
                            <Link to={c.to} className="small strong">{tr(c.ar, c.en)}</Link>
                            <div className="tiny muted">{tr(c.hintAr, c.hintEn)}</div>
                          </div>
                          {c.optional && <Badge tone="outline">{tr('اختياري', 'Optional')}</Badge>}
                        </li>
                      ))}
                    </ul>
                  </CardBody>
                </Card>
              </div>

              <Card>
                <CardHeader icon={<Building2 />} title={tr('المؤسسات', 'Organizations')} actions={<Link className="small" to="/platform/organizations">{tr('إدارة المؤسسات', 'Manage organizations')}</Link>} />
                <CardBody flush>
                  <DataTable<OrgStat> rows={orgs} rowKey={(r) => r.org.id} pageSize={10} onRowClick={(r) => navigate(`/platform/organizations/${r.org.id}`)}
                    empty={{ title: tr('لا توجد مؤسسات بعد', 'No organizations yet'), description: tr('أنشئ أول مؤسسة لتبدأ المنصة العمل.', 'Create the first organization to start using the platform.'),
                      action: <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>{tr('إنشاء مؤسسة', 'Create organization')}</Button> }}
                    columns={[
                      { key: 'code', header: tr('الرمز', 'Code'), value: (r) => r.org.code, render: (r) => <span className="mono">{r.org.code}</span>, sortable: true },
                      { key: 'name', header: tr('المؤسسة', 'Organization'), value: (r) => pick(r.org.name, r.org.name_en), sortable: true },
                      { key: 'status', header: tr('الحالة', 'Status'), value: (r) => r.org.status, render: (r) => <StatusBadge group="orgStatus" value={r.org.status} /> },
                      { key: 'members', header: tr('الأعضاء النشطون', 'Active members'), align: 'end', value: (r) => r.activeMembers, sortable: true },
                      { key: 'programs', header: tr('البرامج (نشطة)', 'Programs (active)'), align: 'end', value: (r) => r.programs, render: (r) => `${fmtNumber(r.programs)} (${fmtNumber(r.activePrograms)})`, sortable: true },
                      { key: 'health', header: tr('مؤشرات الصحة', 'Health signals'), value: (r) => r.openHighInsights, render: (r) => <OrgSignals stat={r} /> },
                    ]} />
                </CardBody>
              </Card>

              <Card>
                <CardHeader icon={<ScrollText />} title={tr('أحدث أحداث التدقيق', 'Recent audit events')} actions={<Link className="small" to="/platform/audit">{tr('سجل التدقيق الكامل', 'Full audit log')}</Link>} />
                <CardBody flush>
                  <DataTable<AuditLog> rows={d.audit} rowKey={(r) => String(r.id)} empty={{ title: tr('لا توجد أحداث', 'No events') }}
                    columns={[
                      { key: 'created_at', header: tr('الوقت', 'Time'), render: (r) => <span className="nowrap">{fmtDateTime(r.created_at)}</span> },
                      { key: 'scope', header: tr('النطاق', 'Scope'), render: (r) => <Badge tone={r.scope === 'platform' ? 'primary' : 'neutral'}>{r.scope === 'platform' ? tr('المنصة', 'Platform') : tr('مؤسسة', 'Organization')}</Badge> },
                      { key: 'org', header: tr('المؤسسة', 'Organization'), render: (r) => orgName(r.organization_id) ?? <span className="muted">—</span> },
                      { key: 'action', header: tr('الإجراء', 'Action'), render: (r) => <span className="mono">{r.action}</span> },
                      { key: 'entity', header: tr('الكيان', 'Entity'), render: (r) => <span className="mono">{r.entity_type ?? '—'}</span> },
                      { key: 'summary', header: tr('الملخص', 'Summary'), render: (r) => <span className="small">{r.summary ?? '—'}</span> },
                    ]} />
                </CardBody>
              </Card>
            </>
          );
        }}
      </AsyncView>
      <CreateOrganizationModal open={creating} onClose={() => setCreating(false)} onCreated={() => void state.reload()} />
    </div>
  );
}
