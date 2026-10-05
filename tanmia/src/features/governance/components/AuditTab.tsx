import { useState } from 'react';
import { Eye, History } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, Drawer, Input, Select, type Column } from '@/components/ui';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { list, type Filter } from '@/services/db';
import type { AuditLog } from '@/types/db';
import { memberLabel, memberOptions, useMembers } from '../shared';

const PAGE = 30;
const ENTITIES = ['programs', 'program_stages', 'program_enrollments', 'beneficiaries', 'experts', 'expert_assignments', 'sessions', 'session_participants', 'program_actions',
  'assessment_results', 'assessment_tools', 'form_templates', 'form_submissions', 'evidence', 'indicators', 'indicator_measurements', 'program_outputs', 'program_outcomes',
  'impact_frameworks', 'reports', 'report_versions', 'approval_requests', 'contracts', 'risks_issues', 'program_budgets', 'data_stewards', 'ai_insights',
  'organization_members', 'user_roles', 'roles', 'organization_modules', 'organizations', 'system_settings', 'notification_rules'];
const ACTIONS = ['insert', 'update', 'delete', 'approval_approved', 'approval_rejected', 'stage_completed', 'stage_blocked', 'copy_central_template'];

export function AuditTab() {
  const { tr, fmtDateTime } = useI18n();
  const { org } = useOrg();
  const members = useMembers();
  const [entity, setEntity] = useState(''); const [action, setAction] = useState(''); const [actor, setActor] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [q, setQ] = useState(''); const term = useDebounced(q, 350);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<AuditLog | null>(null);
  const state = useAsync(() => {
    const f: Filter[] = [['organization_id', 'eq', org.id]];
    if (entity) f.push(['entity_type', 'eq', entity]);
    if (action) f.push(['action', 'eq', action]);
    if (actor) f.push(['actor_user_id', 'eq', actor]);
    if (from) f.push(['created_at', 'gte', `${from}T00:00:00+03:00`]);
    if (to) f.push(['created_at', 'lte', `${to}T23:59:59+03:00`]);
    return list<AuditLog>('audit_log', { filters: f, search: term ? { columns: ['summary', 'entity_id', 'action'], term } : undefined, order: { column: 'created_at' }, page, pageSize: PAGE, count: true });
  }, [org.id, entity, action, actor, from, to, term, page]);
  const reset = (fn: () => void) => { fn(); setPage(0); };
  const who = (id: string | null) => (id ? memberLabel(members.data?.find((m) => m.user_id === id)) : tr('النظام', 'System'));
  const tone = (a: string) => (a === 'delete' || a.includes('rejected') ? 'danger' : a === 'insert' ? 'success' : a === 'update' ? 'info' : 'primary') as 'danger' | 'success' | 'info' | 'primary';
  const columns: Column<AuditLog>[] = [
    { key: 'time', header: tr('الوقت', 'Time'), value: (a) => a.created_at, render: (a) => <span className="small nowrap">{fmtDateTime(a.created_at)}</span> },
    { key: 'actor', header: tr('المنفّذ', 'Actor'), value: (a) => who(a.actor_user_id) },
    { key: 'action', header: tr('الإجراء', 'Action'), value: (a) => a.action, render: (a) => <Badge tone={tone(a.action)}>{a.action}</Badge> },
    { key: 'entity', header: tr('الكيان', 'Entity'), value: (a) => a.entity_type ?? '', render: (a) => <span className="mono small">{a.entity_type ?? '—'}</span> },
    { key: 'id', header: tr('المعرّف', 'ID'), value: (a) => a.entity_id ?? '', render: (a) => <span className="mono tiny" title={a.entity_id ?? ''}>{a.entity_id ? a.entity_id.slice(0, 8) : '—'}</span> },
    { key: 'summary', header: tr('الملخص', 'Summary'), value: (a) => a.summary ?? Object.keys(a.new_data ?? a.old_data ?? {}).join(', '),
      render: (a) => <span className="tiny">{a.summary ?? (a.action === 'update' ? `${tr('حقول', 'Fields')}: ${Object.keys(a.new_data ?? {}).join(', ')}` : '')}</span> },
    { key: 'source', header: tr('المصدر', 'Source'), value: (a) => a.source, render: (a) => <span className="tiny muted">{a.source}</span> },
    { key: 'open', header: '', hideInExport: true, render: (a) => <Button size="sm" variant="ghost" iconOnly icon={<Eye />} aria-label={tr('التفاصيل', 'Details')} onClick={() => setOpen(a)} /> },
  ];
  return (
    <Card>
      <CardHeader title={tr('سجل التدقيق', 'Audit log')} icon={<History />} hint={tr('سجل غير قابل للتعديل لكل تغيير على البيانات', 'Immutable record of every data change')} />
      <CardBody flush>
        <DataTable columns={columns} rows={state.data?.rows ?? []} rowKey={(a) => String(a.id)} loading={state.loading} error={state.error} onRetry={() => void state.reload()}
          search={{ value: q, onChange: (v) => reset(() => setQ(v)), placeholder: tr('بحث في الملخص/المعرّف…', 'Search summary / ID…') }}
          server={{ page, pageSize: PAGE, total: state.data?.total ?? null, onPage: setPage }} exportName="audit-log"
          toolbar={<>
            <Select aria-label={tr('الكيان', 'Entity')} options={ENTITIES.map((e) => ({ value: e, label: e }))} placeholder={tr('كل الكيانات', 'All entities')} value={entity} onChange={(e) => reset(() => setEntity(e.target.value))} style={{ maxWidth: 190 }} />
            <Select aria-label={tr('الإجراء', 'Action')} options={ACTIONS.map((a) => ({ value: a, label: a }))} placeholder={tr('كل الإجراءات', 'All actions')} value={action} onChange={(e) => reset(() => setAction(e.target.value))} style={{ maxWidth: 170 }} />
            <Select aria-label={tr('المنفّذ', 'Actor')} options={memberOptions(members.data)} placeholder={tr('كل المستخدمين', 'All users')} value={actor} onChange={(e) => reset(() => setActor(e.target.value))} style={{ maxWidth: 190 }} />
            <Input type="date" aria-label={tr('من', 'From')} value={from} onChange={(e) => reset(() => setFrom(e.target.value))} style={{ maxWidth: 150 }} />
            <Input type="date" aria-label={tr('إلى', 'To')} value={to} onChange={(e) => reset(() => setTo(e.target.value))} style={{ maxWidth: 150 }} />
          </>}
          empty={{ title: tr('لا توجد سجلات مطابقة', 'No matching entries') }} />
      </CardBody>
      <Drawer open={!!open} wide onClose={() => setOpen(null)} title={open ? `${open.action} · ${open.entity_type ?? ''}` : ''}>
        {open && <AuditDiff entry={open} who={who(open.actor_user_id)} />}
      </Drawer>
    </Card>
  );
}

const show = (v: unknown) => (v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v, null, 1));

function AuditDiff({ entry, who }: { entry: AuditLog; who: string }) {
  const { tr, fmtDateTime } = useI18n();
  const o = entry.old_data ?? {}; const n = entry.new_data ?? {};
  const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])].sort();
  return (
    <div className="stack">
      <dl className="kv">
        <dt>{tr('الوقت', 'Time')}</dt><dd>{fmtDateTime(entry.created_at)}</dd>
        <dt>{tr('المنفّذ', 'Actor')}</dt><dd>{who}</dd>
        <dt>{tr('الكيان', 'Entity')}</dt><dd className="mono">{entry.entity_type} · {entry.entity_id}</dd>
        <dt>{tr('المصدر', 'Source')}</dt><dd>{entry.source}</dd>
        {entry.summary && <><dt>{tr('الملخص', 'Summary')}</dt><dd>{entry.summary}</dd></>}
      </dl>
      {!keys.length ? <p className="small muted">{tr('لا توجد بيانات تفصيلية.', 'No detail data.')}</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{tr('الحقل', 'Field')}</th><th>{tr('قبل', 'Before')}</th><th>{tr('بعد', 'After')}</th></tr></thead>
            <tbody>
              {keys.map((k) => {
                const changed = JSON.stringify(o[k]) !== JSON.stringify(n[k]);
                return (
                  <tr key={k}>
                    <td className="mono tiny">{k}</td>
                    <td className="mono tiny ltr" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: changed && k in o ? 'var(--danger-soft)' : undefined }}>{show(o[k])}</td>
                    <td className="mono tiny ltr" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: changed && k in n ? 'var(--success-soft)' : undefined }}>{show(n[k])}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
