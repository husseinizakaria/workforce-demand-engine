import { Link, Navigate, useNavigate } from 'react-router';
import { Building2, ChevronLeft, Crown } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useAuth } from '@/app/AuthProvider';
import { Badge } from '@/components/ui';
import { writeStoredOrg } from '@/routes/resolveHome';

export default function SelectOrganizationPage() {
  const { tr, pick } = useI18n();
  const { access } = useAuth();
  const nav = useNavigate();
  const active = access?.memberships.filter((m) => m.active) ?? [];
  if (!access) return <Navigate to="/login" replace />;
  if (!active.length && !access.is_platform_super_admin) return <Navigate to="/no-access" replace />;
  return (
    <div className="stack">
      <p className="small muted">{tr('لديك صلاحية في أكثر من مؤسسة. اختر المؤسسة التي تريد العمل فيها.', 'You have access to several organizations. Choose where to work.')}</p>
      <div className="stack-sm">
        {active.map((m) => (
          <button key={m.organization.id} type="button" className="card card-pad row between" style={{ cursor: 'pointer', textAlign: 'start' }}
            onClick={() => { writeStoredOrg(m.organization.id); nav('/app/dashboard'); }}>
            <div className="row"><Building2 size={20} color="var(--primary)" />
              <div><b>{pick(m.organization.name, m.organization.name_en)}</b><div className="row wrap" style={{ marginTop: 3 }}>{m.roles.map((r) => <Badge key={r.id}>{pick(r.name_ar, r.name_en)}</Badge>)}</div></div>
            </div>
            <ChevronLeft size={18} className="muted" />
          </button>
        ))}
      </div>
      {access.is_platform_super_admin && <Link to="/platform" className="btn"><Crown size={16} />{tr('إدارة المنصة', 'Platform administration')}</Link>}
    </div>
  );
}
