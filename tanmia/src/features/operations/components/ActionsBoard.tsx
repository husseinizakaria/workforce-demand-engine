// Org-wide action board grouped by status with overdue highlighting and quick updates.
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, Plus } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, ErrorState, Input, Loading, Select, useToast } from '@/components/ui';
import { RecordFormModal, type FieldSpec } from '@/components/forms/RecordForm';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { useAsync } from '@/hooks/useAsync';
import { all, insert, update } from '@/services/db';
import { todayISO } from '@/utils/dates';
import type { ProgramAction } from '@/types/db';
import { errMsg } from '@/features/beneficiaries/components/dataUtils';
import type { OpsRefs } from './ops';

const COLS: ProgramAction['status'][] = ['open', 'in_progress', 'done', 'cancelled'];
const PRIO: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function ActionsBoard({ refs, onOpenSession, version }: { refs: OpsRefs; onOpenSession: (id: string) => void; version: number }) {
  const { org, can } = useOrg();
  const { tr, pick, enumLabel, enumOptions, fmtDate, locale } = useI18n();
  const toast = useToast();
  const [program, setProgram] = useState('');
  const [priority, setPriority] = useState('');
  const [source, setSource] = useState('');
  const [owner, setOwner] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [creating, setCreating] = useState(false);
  const state = useAsync(() => all<ProgramAction>('program_actions', { filters: [['organization_id', 'eq', org.id]], order: { column: 'due_date', ascending: true } }, 5000), [org.id, version]);
  const today = todayISO();
  const isOverdue = (a: ProgramAction) => !!a.due_date && a.due_date < today && ['open', 'in_progress'].includes(a.status);
  const filtered = useMemo(() => (state.data ?? []).filter((a) => (!program || a.program_id === program) && (!priority || a.priority === priority) && (!source || a.source === source)
    && (!owner.trim() || (a.owner_name ?? '').toLowerCase().includes(owner.trim().toLowerCase())) && (!overdueOnly || isOverdue(a))), [state.data, program, priority, source, owner, overdueOnly, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const overdueCount = (state.data ?? []).filter(isOverdue).length;

  const setStatus = async (a: ProgramAction, status: string) => {
    try {
      const patch: Record<string, unknown> = { status, completed_at: status === 'done' ? new Date().toISOString() : null };
      const u = await update<ProgramAction>('program_actions', a.id, patch);
      state.setData((rows) => (rows ?? []).map((x) => (x.id === u.id ? u : x)));
    } catch (e) { toast.error(errMsg(e, locale)); }
  };
  const fields: FieldSpec[] = [
    { name: 'title', label: ['الإجراء', 'Action'], type: 'text', required: true, full: true },
    { name: 'program_id', label: ['البرنامج', 'Program'], type: 'select', options: refs.programs.map((p) => ({ value: p.id, label: pick(p.name, p.name_en) })) },
    { name: 'owner_name', label: ['المسؤول', 'Owner'], type: 'text' },
    { name: 'due_date', label: ['تاريخ الاستحقاق', 'Due date'], type: 'date' },
    { name: 'priority', label: ['الأولوية', 'Priority'], type: 'enum', enumGroup: 'priority', required: true },
    { name: 'description', label: ['الوصف', 'Description'], type: 'textarea' },
  ];

  const statuses = showClosed ? COLS : COLS.filter((c) => c !== 'cancelled');
  return (
    <div className="stack">
      <Card>
        <CardBody>
          <div className="row wrap">
            <Select options={refs.programs.map((p) => ({ value: p.id, label: pick(p.name, p.name_en) }))} placeholder={tr('كل البرامج', 'All programs')} value={program} onChange={(e) => setProgram(e.target.value)} style={{ width: 170 }} />
            <Select options={enumOptions('priority')} placeholder={tr('كل الأولويات', 'All priorities')} value={priority} onChange={(e) => setPriority(e.target.value)} style={{ width: 130 }} />
            <Select options={['manual', 'session', 'ai', 'risk', 'approval', 'consulting'].map((s) => ({ value: s, label: s }))} placeholder={tr('كل المصادر', 'All sources')} value={source} onChange={(e) => setSource(e.target.value)} style={{ width: 120 }} />
            <Input placeholder={tr('المسؤول', 'Owner')} value={owner} onChange={(e) => setOwner(e.target.value)} style={{ width: 130 }} />
            <Checkbox label={tr(`المتأخرة فقط (${overdueCount})`, `Overdue only (${overdueCount})`)} checked={overdueOnly} onChange={setOverdueOnly} />
            <Checkbox label={tr('إظهار الملغاة', 'Show cancelled')} checked={showClosed} onChange={setShowClosed} />
            <div className="grow" />
            {can('operations.create') && <Button variant="primary" size="sm" icon={<Plus />} onClick={() => setCreating(true)}>{tr('إجراء جديد', 'New action')}</Button>}
          </div>
        </CardBody>
      </Card>
      {state.error ? <ErrorState error={state.error} onRetry={state.reload} /> : state.loading && !state.data ? <Loading /> : (
        <div className={`grid ${statuses.length === 4 ? 'g4' : 'g3'}`} style={{ alignItems: 'start' }}>
          {statuses.map((st) => {
            const items = filtered.filter((a) => a.status === st).sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || (PRIO[a.priority] - PRIO[b.priority]) || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
            return (
              <Card key={st}>
                <CardHeader title={enumLabel('actionStatus', st)} hint={String(items.length)} />
                <CardBody>
                  <div className="stack-sm" style={{ maxHeight: 620, overflowY: 'auto' }}>
                    {items.length === 0 && <span className="small muted">{tr('لا شيء', 'Nothing here')}</span>}
                    {items.slice(0, 200).map((a) => {
                      const od = isOverdue(a);
                      const p = a.program_id ? refs.programMap.get(a.program_id) : undefined;
                      return (
                        <div key={a.id} className="card card-pad stack-sm" style={od ? { borderColor: 'var(--danger)', background: 'var(--danger-soft)' } : undefined}>
                          <div className="row between start"><b className="small">{a.title}</b><Badge tone={a.priority === 'critical' || a.priority === 'high' ? 'danger' : a.priority === 'medium' ? 'warning' : 'info'}>{enumLabel('priority', a.priority)}</Badge></div>
                          <div className="tiny muted row wrap" style={{ gap: 6 }}>
                            <span className="mono">{a.code}</span>
                            {p && <Link to={`/app/programs/${p.id}`}>{pick(p.name, p.name_en)}</Link>}
                            {a.owner_name && <span>· {a.owner_name}</span>}
                            {a.session_id && <a href="#" onClick={(e) => { e.preventDefault(); onOpenSession(a.session_id!); }}>· {tr('الجلسة', 'Session')}</a>}
                            {a.beneficiary_id && <Link to={`/app/beneficiaries/${a.beneficiary_id}/overview`}>· {tr('المستفيد', 'Beneficiary')}</Link>}
                            <Badge tone="outline">{a.source}</Badge>
                          </div>
                          <div className="row between">
                            <span className="small" style={od ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{od && <AlertTriangle size={12} />} {a.due_date ? fmtDate(a.due_date) : tr('بلا تاريخ', 'No due date')}</span>
                            {can('operations.edit') ? <Select options={enumOptions('actionStatus')} value={a.status} onChange={(e) => void setStatus(a, e.target.value)} style={{ width: 120, height: 28 }} /> : null}
                          </div>
                        </div>
                      );
                    })}
                    {items.length > 200 && <span className="tiny muted">{tr(`+${items.length - 200} أخرى — استخدم المرشحات`, `+${items.length - 200} more — use filters`)}</span>}
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
      <RecordFormModal open={creating} onClose={() => setCreating(false)} title={tr('إجراء جديد', 'New action')} fields={fields} initial={{ priority: 'medium' }}
        onSubmit={async (v) => { await insert<ProgramAction>('program_actions', { ...v, organization_id: org.id, status: 'open', source: 'manual' }); await state.reload(); }} />
    </div>
  );
}
