// Rule-based tenant health signals (platform-level expert rules).
import type { Insight } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { Badge, type Tone } from '@/components/ui';
import type { OrgStat } from '../api';

export interface OrgSignal { code: string; tone: Tone; ar: string; en: string }

export function orgSignals(s: OrgStat): OrgSignal[] {
  const out: OrgSignal[] = [];
  if (s.org.status !== 'active') return [{ code: 'inactive', tone: 'neutral', ar: 'غير نشطة — لا يمكن لأعضائها الدخول', en: 'Not active — members cannot sign in' }];
  if (s.activeMembers === 0) out.push({ code: 'no_members', tone: 'danger', ar: 'لا يوجد أعضاء نشطون', en: 'No active members' });
  else if (s.admins === 0) out.push({ code: 'no_admin', tone: 'danger', ar: 'لا يوجد مدير مؤسسة نشط', en: 'No active organization admin' });
  if (s.expiredInvites > 0) out.push({ code: 'expired_invites', tone: 'warning', ar: `${s.expiredInvites} دعوات منتهية`, en: `${s.expiredInvites} expired invitations` });
  if (s.activeMembers > 0 && s.programs === 0) out.push({ code: 'no_programs', tone: 'info', ar: 'لم تُنشأ برامج بعد', en: 'No programs yet' });
  if (s.openHighInsights > 0) out.push({ code: 'high_insights', tone: 'danger', ar: `${s.openHighInsights} ملاحظات عالية/حرجة مفتوحة`, en: `${s.openHighInsights} open high/critical findings` });
  if (s.admins === 1 && s.activeMembers > 3) out.push({ code: 'single_admin', tone: 'warning', ar: 'مدير واحد فقط (نقطة فشل منفردة)', en: 'Single admin (single point of failure)' });
  return out;
}

export function OrgSignals({ stat }: { stat: OrgStat }) {
  const { tr } = useI18n();
  const sig = orgSignals(stat);
  if (!sig.length) return <Badge tone="success">{tr('سليمة', 'Healthy')}</Badge>;
  return <div className="row wrap" style={{ gap: 4 }}>{sig.map((s) => <Badge key={s.code} tone={s.tone}>{tr(s.ar, s.en)}</Badge>)}</div>;
}

/** Platform-wide findings for the owner, shown with InsightList. */
export function platformInsights(stats: OrgStat[]): Insight[] {
  const out: Insight[] = [];
  const name = (s: OrgStat) => s.org.name_en ? `${s.org.name} / ${s.org.name_en}` : s.org.name;
  for (const s of stats) {
    if (s.org.status !== 'active') continue;
    if (s.activeMembers === 0 && s.pendingInvites === 0) {
      out.push({
        rule_code: 'PLT-ORG-NO-MEMBERS', kind: 'missing_config', severity: 'high', area: 'people', fingerprint: `nomem:${s.org.id}`, source_data: { organization_id: s.org.id },
        title: { ar: `${name(s)}: لا أعضاء ولا دعوات معلّقة`, en: `${name(s)}: no members and no pending invitations` },
        rationale: { ar: 'المؤسسة نشطة لكن لا يستطيع أحد الدخول إليها لإدارتها.', en: 'The organization is active but nobody can sign in to manage it.' },
        recommended_action: { ar: 'افتح المؤسسة وأرسل دعوة لمدير المؤسسة.', en: 'Open the organization and invite an organization admin.' },
        link: s.org.id,
      });
    } else if (s.activeMembers > 0 && s.admins === 0) {
      out.push({
        rule_code: 'PLT-ORG-NO-ADMIN', kind: 'gap', severity: 'high', area: 'people', fingerprint: `noadm:${s.org.id}`, source_data: { organization_id: s.org.id, members: s.activeMembers },
        title: { ar: `${name(s)}: لا يوجد مدير مؤسسة نشط`, en: `${name(s)}: no active organization admin` },
        rationale: { ar: `يوجد ${s.activeMembers} عضو نشط لكن لا أحد يحمل دور مدير المؤسسة، فلا يمكن إدارة المستخدمين والإعدادات محليًا.`, en: `${s.activeMembers} active members, but none holds the organization admin role, so users and settings cannot be managed locally.` },
        recommended_action: { ar: 'أسند دور مدير المؤسسة لعضو موثوق.', en: 'Assign the organization admin role to a trusted member.' },
        link: s.org.id,
      });
    }
    if (s.expiredInvites > 0) {
      out.push({
        rule_code: 'PLT-ORG-EXPIRED-INV', kind: 'data_quality', severity: 'low', area: 'people', fingerprint: `expinv:${s.org.id}`, source_data: { organization_id: s.org.id, expired: s.expiredInvites },
        title: { ar: `${name(s)}: ${s.expiredInvites} دعوات انتهت صلاحيتها دون قبول`, en: `${name(s)}: ${s.expiredInvites} invitations expired unaccepted` },
        rationale: { ar: 'الدعوات المنتهية لا يمكن قبولها، وقد يكون المدعوون ينتظرون الوصول.', en: 'Expired invitations cannot be accepted; invitees may still be waiting for access.' },
        recommended_action: { ar: 'ألغِ الدعوات المنتهية وأرسل دعوات جديدة عند الحاجة.', en: 'Revoke expired invitations and re-invite where still needed.' },
        link: s.org.id,
      });
    }
    if (s.openHighInsights > 0) {
      out.push({
        rule_code: 'PLT-ORG-HIGH-FINDINGS', kind: 'risk', severity: s.openHighInsights >= 5 ? 'high' : 'medium', area: 'delivery', fingerprint: `hi:${s.org.id}`,
        source_data: { organization_id: s.org.id, open_high: s.openHighInsights },
        title: { ar: `${name(s)}: ${s.openHighInsights} ملاحظات صحة عالية/حرجة مفتوحة`, en: `${name(s)}: ${s.openHighInsights} open high/critical health findings` },
        rationale: { ar: 'نتائج فحص صحة البرامج تشير إلى عوائق أو فجوات لم تُعالج في هذه المؤسسة.', en: 'Program health checks report blockers or gaps that have not been addressed in this organization.' },
        recommended_action: { ar: 'تواصل مع مدير المؤسسة أو افتح مساحة العمل لمراجعة الملاحظات.', en: 'Contact the organization admin or open the workspace to review the findings.' },
        link: s.org.id,
      });
    }
  }
  const order = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
  return out.sort((a, b) => order[b.severity] - order[a.severity]);
}
