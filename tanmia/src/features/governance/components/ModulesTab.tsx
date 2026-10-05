import { useState } from 'react';
import { Blocks, PowerOff } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { AsyncView, Badge, Button, Card, CardBody, CardHeader, Notice, useConfirm, useToast } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { all, upsert } from '@/services/db';
import type { ModuleKey, OrganizationModule } from '@/types/db';
import { useErrMsg } from '../shared';

const MODULES: { key: ModuleKey; deps?: ModuleKey[]; note?: [string, string] }[] = [
  { key: 'programs', note: ['أساس كل الوحدات الأخرى', 'Foundation for all other modules'] },
  { key: 'beneficiaries' }, { key: 'experts' }, { key: 'vendors' }, { key: 'partners' },
  { key: 'operations', deps: ['programs'] }, { key: 'assessments', deps: ['programs'] }, { key: 'evidence', deps: ['programs'] },
  { key: 'outcomes', deps: ['programs'] }, { key: 'impact', deps: ['programs', 'outcomes'] }, { key: 'templates' },
  { key: 'reports', deps: ['programs'] }, { key: 'governance', note: ['يتضمن هذه الشاشة', 'Includes this screen'] }, { key: 'notifications' },
];

export function ModulesTab() {
  const { tr, enumLabel, fmtDateTime } = useI18n();
  const { org, refresh, isPlatformAdmin } = useOrg();
  const toast = useToast(); const confirm = useConfirm(); const errMsg = useErrMsg();
  const [busy, setBusy] = useState<string | null>(null);
  const state = useAsync(() => all<OrganizationModule>('organization_modules', { filters: [['organization_id', 'eq', org.id]], order: { column: 'module_key', ascending: true } }), [org.id]);
  const enabled = (k: ModuleKey) => state.data?.find((m) => m.module_key === k)?.enabled !== false;

  const set = async (k: ModuleKey, on: boolean) => {
    if (!on && k === 'governance' && !isPlatformAdmin) { toast.error(tr('تعطيل الحوكمة يخفي هذه الشاشة ولا يمكن التراجع إلا من مالك المنصة.', 'Disabling governance hides this screen; only a platform owner could undo it.')); return; }
    const dependants = MODULES.filter((m) => m.deps?.includes(k) && enabled(m.key)).map((m) => enumLabel('module', m.key));
    if (!on && !(await confirm({
      title: tr(`تعطيل «${enumLabel('module', k)}»؟`, `Deactivate “${enumLabel('module', k)}”?`), danger: true, confirmLabel: tr('تعطيل', 'Deactivate'),
      message: <div className="stack-sm">
        <p className="small">{tr('ستُخفى الوحدة وبياناتها عن جميع المستخدمين، وتمنع قواعد الأمان الوصول إليها. البيانات لا تُحذف وتعود عند إعادة التفعيل.', 'The module and its data are hidden from all users and access is blocked by security rules. Data is not deleted and returns when re-activated.')}</p>
        {dependants.length > 0 && <Notice tone="warning">{tr(`وحدات تعتمد عليها: ${dependants.join('، ')} — ستعمل بشكل محدود.`, `Modules depending on it: ${dependants.join(', ')} — they will work with reduced data.`)}</Notice>}
      </div>,
    }))) return;
    setBusy(k);
    try {
      await upsert('organization_modules', { organization_id: org.id, module_key: k, enabled: on }, 'organization_id,module_key');
      toast.success(on ? tr('فُعّلت الوحدة', 'Module activated') : tr('عُطّلت الوحدة', 'Module deactivated'));
      await state.reload(); void refresh();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(null); }
  };

  return (
    <Card>
      <CardHeader title={tr('تفعيل الوحدات', 'Module activation')} icon={<Blocks />} />
      <CardBody>
        <Notice tone="info" icon={<PowerOff />}>{tr('تعطيل وحدة يخفيها هي وبياناتها (وتمنعها قواعد الأمان في قاعدة البيانات) دون حذف أي بيانات. إعادة التفعيل تعيد كل شيء كما كان.', 'Deactivating a module hides it and its data (enforced by database security rules) without deleting anything. Re-activating restores everything as it was.')}</Notice>
        <AsyncView state={state}>
          {(rows) => (
            <div className="grid g3" style={{ marginTop: 12 }}>
              {MODULES.map((m) => {
                const on = enabled(m.key);
                const row = rows.find((r) => r.module_key === m.key);
                const missingDeps = on ? (m.deps ?? []).filter((dep) => !enabled(dep)) : [];
                return (
                  <div key={m.key} className="card card-pad stack-sm">
                    <div className="row between">
                      <b>{enumLabel('module', m.key)}</b>
                      <Badge tone={on ? 'success' : 'neutral'}>{on ? tr('مفعّلة', 'Active') : tr('معطّلة', 'Inactive')}</Badge>
                    </div>
                    {m.note && <span className="tiny muted">{tr(m.note[0], m.note[1])}</span>}
                    {missingDeps.length > 0 && <span className="tiny" style={{ color: 'var(--warning)' }}>{tr('تعتمد على وحدة معطلة', 'Depends on a deactivated module')}: {missingDeps.map((x) => enumLabel('module', x)).join('، ')}</span>}
                    {row && <span className="tiny muted">{tr('آخر تغيير', 'Last change')}: {fmtDateTime(row.updated_at)}</span>}
                    <div><Button size="sm" variant={on ? 'secondary' : 'primary'} loading={busy === m.key} onClick={() => void set(m.key, !on)}>{on ? tr('تعطيل', 'Deactivate') : tr('تفعيل', 'Activate')}</Button></div>
                  </div>
                );
              })}
            </div>
          )}
        </AsyncView>
      </CardBody>
    </Card>
  );
}
