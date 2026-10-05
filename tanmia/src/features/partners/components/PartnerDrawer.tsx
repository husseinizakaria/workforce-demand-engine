import { Link } from 'react-router';
import { Handshake, Pencil } from 'lucide-react';
import type { Insight } from '@engine';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, Drawer, InsightList, Kpi, StatusBadge, type Column } from '@/components/ui';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { useAsync } from '@/hooks/useAsync';
import { all } from '@/services/db';
import type { Contract, Partner, Program } from '@/types/db';
import { byId, makeInsight, safe, sortInsights } from '@/features/beneficiaries/components/dataUtils';
import { EntityDocuments } from '@/features/beneficiaries/components/EntityDocuments';
import { AgreementBadge, agreementState, daysLeft } from './agreement';

export function PartnerDrawer({ partner, onClose, onEdit }: { partner: Partner; onClose: () => void; onEdit?: () => void }) {
  const { org, can } = useOrg();
  const { tr, pick, fmtMoney, fmtDate, fmtNumber, enumLabel } = useI18n();
  const state = useAsync(async () => {
    const [programs, contracts] = await Promise.all([
      safe(all<Program>('programs', { filters: [['organization_id', 'eq', org.id], ['sponsor_partner_id', 'eq', partner.id]], order: { column: 'start_date', ascending: false } })),
      safe(all<Contract>('contracts', { filters: [['organization_id', 'eq', org.id], ['partner_id', 'eq', partner.id]] })),
    ]);
    return { programs, contracts };
  }, [org.id, partner.id]);
  const d = state.data;
  const progMap = byId(d?.programs ?? []);
  const sponsored = d?.programs ?? [];
  const budget = sponsored.reduce((s, p) => s + Number(p.budget_total ?? 0), 0);
  const ag = agreementState(partner);

  const insights: Insight[] = [];
  if (d) {
    const live = sponsored.filter((p) => ['planning', 'active', 'on_hold'].includes(p.status));
    if (ag === 'expired' && live.length) insights.push(makeInsight({ rule: 'PRT_EXPIRED_LIVE', severity: 'high', kind: 'risk', area: 'risk', title: ['اتفاقية منتهية مع برامج قائمة', 'Expired agreement with live programs'],
      rationale: [`انتهت الاتفاقية في ${fmtDate(partner.agreement_end)} وما زال ${live.length} برنامج يرعاه الشريك قيد التنفيذ.`, `The agreement ended on ${fmtDate(partner.agreement_end)} while ${live.length} sponsored programs are still running.`],
      action: ['جدد الاتفاقية أو وثّق ترتيبات الاستمرار.', 'Renew the agreement or document continuation arrangements.'] }));
    if (ag === 'expiring') insights.push(makeInsight({ rule: 'PRT_EXPIRING', severity: 'medium', kind: 'recommendation', area: 'risk', title: ['اتفاقية قاربت على الانتهاء', 'Agreement expiring soon'],
      rationale: [`تنتهي خلال ${daysLeft(partner.agreement_end)} يومًا.`, `Expires in ${daysLeft(partner.agreement_end)} days.`], action: ['ابدأ إجراءات التجديد مبكرًا.', 'Start the renewal process early.'] }));
    const beyond = live.filter((p) => partner.agreement_end && p.end_date && p.end_date > partner.agreement_end);
    if (beyond.length) insights.push(makeInsight({ rule: 'PRT_PROGRAM_BEYOND', severity: 'medium', kind: 'inconsistency', area: 'risk', title: ['برامج تمتد بعد نهاية الاتفاقية', 'Programs extend beyond the agreement'],
      rationale: [`${beyond.map((p) => p.name).join('، ')} تنتهي بعد ${fmtDate(partner.agreement_end)}.`, `${beyond.map((p) => p.name_en || p.name).join(', ')} end after ${fmtDate(partner.agreement_end)}.`], action: ['مدد الاتفاقية لتغطي مدة البرامج.', 'Extend the agreement to cover the programs.'] }));
    if (partner.status === 'active' && ag === 'none' && partner.partner_type === 'funder') insights.push(makeInsight({ rule: 'PRT_NO_AGREEMENT', severity: 'low', kind: 'missing_config', area: 'setup', title: ['ممول بلا اتفاقية مسجلة', 'Funder without recorded agreement'],
      rationale: ['تواريخ الاتفاقية غير مسجلة.', 'Agreement dates are not recorded.'], action: ['سجل تواريخ الاتفاقية وارفعها في المستندات.', 'Record the agreement dates and upload it to documents.'] }));
  }

  const pCols: Column<Program>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), value: (p) => p.code, render: (p) => <span className="mono">{p.code}</span> },
    { key: 'name', header: tr('البرنامج', 'Program'), value: (p) => pick(p.name, p.name_en), render: (p) => <Link to={`/app/programs/${p.id}`}>{pick(p.name, p.name_en)}</Link> },
    { key: 'track', header: tr('المسار', 'Track'), value: (p) => enumLabel('track', p.track_code) },
    { key: 'period', header: tr('الفترة', 'Period'), value: (p) => p.start_date, render: (p) => `${fmtDate(p.start_date)} – ${fmtDate(p.end_date)}` },
    { key: 'budget', header: tr('الميزانية', 'Budget'), align: 'end', value: (p) => p.budget_total, render: (p) => fmtMoney(p.budget_total, p.currency) },
    { key: 'status', header: tr('الحالة', 'Status'), value: (p) => p.status, render: (p) => <StatusBadge group="programStatus" value={p.status} /> },
  ];
  const cCols: Column<Contract>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), value: (c) => c.code, render: (c) => <span className="mono">{c.code}</span> },
    { key: 'title', header: tr('العقد', 'Contract'), value: (c) => c.title },
    { key: 'program', header: tr('البرنامج', 'Program'), value: (c) => (c.program_id ? progMap.get(c.program_id)?.name ?? '—' : '—') },
    { key: 'value', header: tr('القيمة', 'Value'), align: 'end', value: (c) => c.value, render: (c) => fmtMoney(c.value, c.currency) },
    { key: 'period', header: tr('الفترة', 'Period'), value: (c) => c.start_date, render: (c) => `${fmtDate(c.start_date)} – ${fmtDate(c.end_date)}` },
    { key: 'status', header: tr('الحالة', 'Status'), value: (c) => c.status, render: (c) => <StatusBadge group="contractStatus" value={c.status} /> },
  ];
  return (
    <Drawer open onClose={onClose} wide title={<span className="row"><Handshake size={16} />{partner.name} <span className="mono small muted">{partner.code}</span></span>}
      footer={onEdit && can('partners.edit') ? <Button variant="primary" icon={<Pencil />} onClick={onEdit}>{tr('تعديل', 'Edit')}</Button> : undefined}>
      <div className="stack">
        <dl className="kv">
          <dt>{tr('النوع', 'Type')}</dt><dd>{enumLabel('partnerType', partner.partner_type)}</dd>
          <dt>{tr('الحالة', 'Status')}</dt><dd><StatusBadge group="entityStatus" value={partner.status} /></dd>
          <dt>{tr('جهة الاتصال', 'Contact')}</dt><dd>{[partner.contact_name, partner.mobile, partner.email].filter(Boolean).join(' · ') || '—'}</dd>
          <dt>{tr('الاتفاقية', 'Agreement')}</dt><dd className="row wrap">{fmtDate(partner.agreement_start)} – {fmtDate(partner.agreement_end)} <AgreementBadge p={partner} /></dd>
        </dl>
        {partner.notes && <p className="small muted">{partner.notes}</p>}
        <div className="grid g3">
          <Kpi label={tr('برامج يرعاها', 'Sponsored programs')} value={fmtNumber(sponsored.length)} hint={tr(`${sponsored.filter((p) => p.status === 'active').length} نشط`, `${sponsored.filter((p) => p.status === 'active').length} active`)} />
          <Kpi label={tr('ميزانيات البرامج', 'Program budgets')} value={fmtMoney(budget)} />
          <Kpi label={tr('العقود', 'Contracts')} value={can('governance.view') ? fmtNumber(d?.contracts.length ?? 0) : '—'} />
        </div>
        {d && <InsightList insights={sortInsights(insights)} emptyTitle={tr('لا توجد ملاحظات على هذا الشريك', 'No findings for this partner')} />}
        <Card><CardHeader title={tr('البرامج المرعية', 'Sponsored programs')} /><CardBody flush>
          <DataTable columns={pCols} rows={sponsored} rowKey={(p) => p.id} loading={state.loading} empty={{ title: tr('لا توجد برامج يرعاها هذا الشريك', 'No programs sponsored by this partner') }} />
        </CardBody></Card>
        <Card><CardHeader title={tr('العقود', 'Contracts')} /><CardBody flush>
          {can('governance.view') ? <DataTable columns={cCols} rows={d?.contracts ?? []} rowKey={(c) => c.id} loading={state.loading} empty={{ title: tr('لا توجد عقود', 'No contracts') }} />
            : <div className="card-pad"><Badge tone="outline">{tr('يتطلب صلاحية الحوكمة', 'Requires Governance permission')}</Badge></div>}
        </CardBody></Card>
        <EntityDocuments owner="partner_id" ownerId={partner.id} defaultType="agreement" />
      </div>
    </Drawer>
  );
}
