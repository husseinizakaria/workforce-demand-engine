import { useEffect, useState } from 'react';
import { Database, Save } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { AsyncView, Badge, Button, Card, CardBody, CardHeader, Input, Notice, Select, useToast } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { all, upsert } from '@/services/db';
import type { DataSteward } from '@/types/db';
import { memberOptions, useErrMsg, useMembers } from '../shared';

const DOMAINS = ['beneficiaries', 'experts', 'operations', 'assessments', 'evidence', 'outcomes', 'impact', 'finance', 'reports'];
type Draft = { owner: string; verifier: string; notes: string };

export function StewardshipTab() {
  const { tr, enumLabel } = useI18n();
  const { org, can } = useOrg();
  const toast = useToast(); const errMsg = useErrMsg();
  const members = useMembers();
  const editable = can('governance.edit') && can('governance.create');
  const state = useAsync(() => all<DataSteward>('data_stewards', { filters: [['organization_id', 'eq', org.id]], order: { column: 'data_domain', ascending: true } }), [org.id]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const rows = state.data ?? [];
    setDrafts(Object.fromEntries(DOMAINS.map((d) => { const r = rows.find((x) => x.data_domain === d); return [d, { owner: r?.owner_user_id ?? '', verifier: r?.verifier_user_id ?? '', notes: r?.notes ?? '' }]; })));
  }, [state.data]);
  const save = async (domain: string) => {
    const d = drafts[domain];
    setBusy(domain);
    try {
      await upsert('data_stewards', { organization_id: org.id, data_domain: domain, owner_user_id: d.owner || null, verifier_user_id: d.verifier || null, notes: d.notes.trim() || null }, 'organization_id,data_domain');
      toast.success(tr('تم الحفظ', 'Saved')); void state.reload();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(null); }
  };
  const opts = memberOptions(members.data);
  return (
    <Card>
      <CardHeader title={tr('إشراف البيانات', 'Data stewardship')} icon={<Database />} hint={tr('لكل مجال بيانات مالك مسؤول عن جودته ومُحقِّق مستقل', 'Each data domain has an owner accountable for quality and an independent verifier')} />
      <CardBody>
        <AsyncView state={state}>
          {(rows) => {
            const unassigned = DOMAINS.filter((d) => !rows.find((r) => r.data_domain === d)?.owner_user_id);
            const same = rows.filter((r) => r.owner_user_id && r.owner_user_id === r.verifier_user_id);
            return (
              <div className="stack">
                {unassigned.length > 0 && <Notice tone="warning">{tr(`مجالات بلا مالك: ${unassigned.map((d) => enumLabel('dataDomain', d)).join('، ')}.`, `Domains without an owner: ${unassigned.map((d) => enumLabel('dataDomain', d)).join(', ')}.`)}</Notice>}
                {same.length > 0 && <Notice tone="danger">{tr('المالك والمحقّق نفس الشخص في بعض المجالات؛ هذا يخالف مبدأ فصل المهام.', 'Owner and verifier are the same person in some domains; this breaks segregation of duties.')}</Notice>}
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>{tr('المجال', 'Domain')}</th><th>{tr('المالك', 'Owner')}</th><th>{tr('المحقّق', 'Verifier')}</th><th>{tr('ملاحظات', 'Notes')}</th><th /></tr></thead>
                    <tbody>
                      {DOMAINS.map((d) => {
                        const dr = drafts[d] ?? { owner: '', verifier: '', notes: '' };
                        const row = rows.find((r) => r.data_domain === d);
                        const dirty = (row?.owner_user_id ?? '') !== dr.owner || (row?.verifier_user_id ?? '') !== dr.verifier || (row?.notes ?? '') !== dr.notes;
                        const set = (patch: Partial<Draft>) => setDrafts((s) => ({ ...s, [d]: { ...dr, ...patch } }));
                        return (
                          <tr key={d}>
                            <td className="small strong">{enumLabel('dataDomain', d)}{dr.owner && dr.owner === dr.verifier && <> <Badge tone="danger">{tr('تعارض', 'Conflict')}</Badge></>}</td>
                            <td><Select options={opts} placeholder={tr('— غير محدد —', '— Not set —')} value={dr.owner} disabled={!editable} onChange={(e) => set({ owner: e.target.value })} aria-label={tr('المالك', 'Owner')} /></td>
                            <td><Select options={opts} placeholder={tr('— غير محدد —', '— Not set —')} value={dr.verifier} disabled={!editable} onChange={(e) => set({ verifier: e.target.value })} aria-label={tr('المحقّق', 'Verifier')} /></td>
                            <td><Input value={dr.notes} disabled={!editable} onChange={(e) => set({ notes: e.target.value })} aria-label={tr('ملاحظات', 'Notes')} /></td>
                            <td>{editable && <Button size="sm" icon={<Save />} disabled={!dirty} loading={busy === d} onClick={() => void save(d)}>{tr('حفظ', 'Save')}</Button>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {!can('users.view') && <p className="tiny muted">{tr('قائمة الأعضاء تتطلب صلاحية «عرض المستخدمين».', 'The member list requires “view users”.')}</p>}
              </div>
            );
          }}
        </AsyncView>
      </CardBody>
    </Card>
  );
}
