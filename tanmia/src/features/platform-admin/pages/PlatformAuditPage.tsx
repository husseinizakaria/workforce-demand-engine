import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Download, FilterX } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { Badge, Button, Card, CardBody, DataTable, Drawer, Field, Input, PageHeader, Select } from '@/components/ui';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { useAction } from '@/hooks/useAction';
import * as db from '@/services/db';
import type { AuditLog, Profile } from '@/types/db';
import { addDaysISO } from '@/utils/dates';
import { downloadCSV } from '@/utils/csv';
import { loadOrgOptions, loadProfiles } from '../api';
import { JsonDiff, jsonText } from '../components/common';

const PAGE = 50;
const EXPORT_CAP = 5000;

export default function PlatformAuditPage() {
  const { tr, pick, fmtDateTime, fmtNumber } = useI18n();
  const [params] = useSearchParams();
  const [scope, setScope] = useState('');
  const [org, setOrg] = useState(params.get('organization') ?? '');
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<AuditLog | null>(null);
  const dAction = useDebounced(action, 350);
  const dEntity = useDebounced(entity, 350);

  const filters = useMemo<db.Filter[]>(() => {
    const f: db.Filter[] = [];
    if (scope) f.push(['scope', 'eq', scope]);
    if (org === '_platform') f.push(['organization_id', 'is', null]);
    else if (org) f.push(['organization_id', 'eq', org]);
    if (dAction.trim()) f.push(['action', 'ilike', `%${dAction.trim()}%`]);
    if (dEntity.trim()) f.push(['entity_type', 'ilike', `%${dEntity.trim()}%`]);
    if (from) f.push(['created_at', 'gte', `${from}T00:00:00+03:00`]);
    if (to) f.push(['created_at', 'lt', `${addDaysISO(to, 1)}T00:00:00+03:00`]);
    return f;
  }, [scope, org, dAction, dEntity, from, to]);
  const key = JSON.stringify(filters);
  useEffect(() => setPage(0), [key]);

  const orgs = useAsync(loadOrgOptions, []);
  const state = useAsync(async () => {
    const res = await db.list<AuditLog>('audit_log', { filters, page, pageSize: PAGE, count: true, order: { column: 'created_at', ascending: false } });
    const actors = await loadProfiles(res.rows.map((r) => r.actor_user_id ?? '').filter(Boolean));
    return { ...res, actors };
  }, [key, page]);

  const orgName = (id: string | null) => {
    if (!id) return null;
    const o = orgs.data?.find((x) => x.id === id);
    return o ? pick(o.name, o.name_en) : id.slice(0, 8);
  };
  const actorName = (r: AuditLog, actors?: Map<string, Profile>) => (r.actor_user_id ? actors?.get(r.actor_user_id)?.full_name ?? actors?.get(r.actor_user_id)?.email ?? r.actor_user_id.slice(0, 8) : tr('النظام', 'System'));

  const exportAll = useAction(async () => {
    const rows = await db.all<AuditLog>('audit_log', { filters, order: { column: 'created_at', ascending: false } }, EXPORT_CAP);
    const actors = await loadProfiles(rows.map((r) => r.actor_user_id ?? '').filter(Boolean));
    downloadCSV(`audit-log-${new Date().toISOString().slice(0, 10)}`,
      ['id', 'created_at', 'scope', 'organization', 'actor', 'action', 'entity_type', 'entity_id', 'source', 'summary', 'old_data', 'new_data'],
      rows.map((r) => [r.id, r.created_at, r.scope, orgName(r.organization_id) ?? '', actorName(r, actors), r.action, r.entity_type, r.entity_id, r.source, r.summary,
        r.old_data ? JSON.stringify(r.old_data) : '', r.new_data ? JSON.stringify(r.new_data) : '']));
  });

  const clear = () => { setScope(''); setOrg(''); setAction(''); setEntity(''); setFrom(''); setTo(''); };
  const total = state.data?.total ?? null;

  return (
    <div className="stack">
      <PageHeader title={tr('سجل التدقيق', 'Audit log')} crumbs={[{ label: tr('إدارة المنصة', 'Platform'), to: '/platform' }, { label: tr('سجل التدقيق', 'Audit log') }]}
        subtitle={tr('كل تغيير في البيانات يُسجل تلقائيًا من قاعدة البيانات والدوال الخلفية؛ السجل غير قابل للتعديل أو الحذف عبر الواجهة.', 'Every data change is recorded automatically by the database and server functions; the log cannot be edited or deleted through the API.')}
        actions={<Button icon={<Download />} loading={exportAll.busy} disabled={!total} onClick={() => void exportAll.run()}>
          {tr(`تصدير CSV (حتى ${fmtNumber(EXPORT_CAP)})`, `Export CSV (up to ${fmtNumber(EXPORT_CAP)})`)}</Button>} />
      <Card>
        <CardBody>
          <div className="grid g6" style={{ alignItems: 'end' }}>
            <Field label={tr('النطاق', 'Scope')}><Select value={scope} onChange={(e) => setScope(e.target.value)} options={[{ value: '', label: tr('الكل', 'All') }, { value: 'platform', label: tr('المنصة', 'Platform') }, { value: 'organization', label: tr('مؤسسة', 'Organization') }]} /></Field>
            <Field label={tr('المؤسسة', 'Organization')}>
              <Select value={org} onChange={(e) => setOrg(e.target.value)} options={[{ value: '', label: tr('الكل', 'All') }, { value: '_platform', label: tr('بدون مؤسسة (المنصة)', 'No organization (platform)') }, ...(orgs.data ?? []).map((o) => ({ value: o.id, label: `${pick(o.name, o.name_en)} (${o.code})` }))]} />
            </Field>
            <Field label={tr('الإجراء', 'Action')}><Input dir="ltr" value={action} placeholder="insert / update / delete…" onChange={(e) => setAction(e.target.value)} /></Field>
            <Field label={tr('نوع الكيان', 'Entity type')}><Input dir="ltr" value={entity} placeholder="programs, roles…" onChange={(e) => setEntity(e.target.value)} /></Field>
            <Field label={tr('من تاريخ', 'From')}><Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label={tr('إلى تاريخ', 'To')}><Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
          <div className="row between" style={{ marginTop: 8 }}>
            <span className="small muted">{total !== null ? tr(`${fmtNumber(total)} حدث مطابق`, `${fmtNumber(total)} matching events`) : ''}</span>
            <Button size="sm" variant="ghost" icon={<FilterX />} onClick={clear}>{tr('مسح المرشحات', 'Clear filters')}</Button>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardBody flush>
          <DataTable<AuditLog> rows={state.data?.rows ?? []} rowKey={(r) => String(r.id)} loading={state.loading} error={state.error} onRetry={() => void state.reload()}
            server={{ page, pageSize: PAGE, total, onPage: setPage }} onRowClick={setOpen}
            empty={{ title: tr('لا توجد أحداث مطابقة', 'No matching events') }}
            columns={[
              { key: 'time', header: tr('الوقت', 'Time'), render: (r) => <span className="nowrap small">{fmtDateTime(r.created_at)}</span> },
              { key: 'scope', header: tr('النطاق', 'Scope'), render: (r) => <Badge tone={r.scope === 'platform' ? 'primary' : 'neutral'}>{r.scope === 'platform' ? tr('المنصة', 'Platform') : tr('مؤسسة', 'Org')}</Badge> },
              { key: 'org', header: tr('المؤسسة', 'Organization'), render: (r) => <span className="small">{orgName(r.organization_id) ?? '—'}</span> },
              { key: 'actor', header: tr('المنفّذ', 'Actor'), render: (r) => <span className="small">{actorName(r, state.data?.actors)}</span> },
              { key: 'action', header: tr('الإجراء', 'Action'), render: (r) => <Badge tone={r.action === 'delete' ? 'danger' : r.action === 'insert' ? 'success' : 'outline'}>{r.action}</Badge> },
              { key: 'entity', header: tr('الكيان', 'Entity'), render: (r) => <span className="mono">{r.entity_type ?? '—'}</span> },
              { key: 'source', header: tr('المصدر', 'Source'), render: (r) => <span className="tiny muted">{r.source}</span> },
              { key: 'summary', header: tr('التغييرات', 'Changes'), render: (r) => <span className="small ellipsis" style={{ display: 'inline-block', maxWidth: 260 }}>{r.summary ?? (Object.keys(r.new_data ?? r.old_data ?? {}).slice(0, 6).join(', ') || '—')}</span> },
            ]} />
        </CardBody>
      </Card>
      <Drawer wide open={!!open} onClose={() => setOpen(null)} title={open ? <>{open.action} · <span className="mono">{open.entity_type ?? '—'}</span></> : ''}>
        {open && (
          <div className="stack">
            <dl className="kv">
              <dt>{tr('الوقت', 'Time')}</dt><dd>{fmtDateTime(open.created_at)}</dd>
              <dt>{tr('النطاق', 'Scope')}</dt><dd>{open.scope}</dd>
              <dt>{tr('المؤسسة', 'Organization')}</dt><dd>{orgName(open.organization_id) ?? '—'}</dd>
              <dt>{tr('المنفّذ', 'Actor')}</dt><dd>{actorName(open, state.data?.actors)}</dd>
              <dt>{tr('المصدر', 'Source')}</dt><dd>{open.source}</dd>
              <dt>{tr('معرّف الكيان', 'Entity id')}</dt><dd className="mono">{open.entity_id ?? '—'}</dd>
              {open.summary && <><dt>{tr('الملخص', 'Summary')}</dt><dd>{jsonText(open.summary)}</dd></>}
            </dl>
            <JsonDiff oldData={open.old_data} newData={open.new_data} />
          </div>
        )}
      </Drawer>
    </div>
  );
}
