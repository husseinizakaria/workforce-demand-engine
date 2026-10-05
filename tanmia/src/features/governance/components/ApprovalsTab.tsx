import { useState } from 'react';
import { Link } from 'react-router';
import { Check, ClipboardCheck, X } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAuth } from '@/app/AuthProvider';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, Field, Modal, Notice, Segmented, StatusBadge, Textarea, useToast, type Column } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { all, list, rpc, type Filter } from '@/services/db';
import type { ApprovalRequest, Profile } from '@/types/db';
import { useErrMsg, usePrograms } from '../shared';

const PAGE = 25;
const CODES: Record<string, [string, string]> = {
  SELF_APPROVAL_NOT_ALLOWED: ['لا يمكن اعتماد طلب قدّمته بنفسك؛ يجب أن يتخذ القرار شخص آخر (فصل المهام).', 'You cannot decide a request you submitted yourself; another approver must decide (segregation of duties).'],
  ALREADY_DECIDED: ['تم اتخاذ قرار بشأن هذا الطلب مسبقًا؛ حُدّثت القائمة.', 'This request has already been decided; the list was refreshed.'],
};
const ENTITY: Record<string, [string, string]> = {
  program: ['برنامج', 'Program'], program_stage: ['مرحلة برنامج', 'Program stage'], report: ['تقرير', 'Report'], contract: ['عقد', 'Contract'],
  budget: ['ميزانية', 'Budget'], evidence: ['دليل', 'Evidence'], assessment_result: ['نتيجة تقييم', 'Assessment result'], application: ['طلب التحاق', 'Application'], other: ['أخرى', 'Other'],
};

export function entityLink(a: Pick<ApprovalRequest, 'entity_type' | 'entity_id' | 'program_id'>): string | null {
  if (a.entity_type === 'report' && a.entity_id) return `/app/reports/${a.entity_id}`;
  if (a.entity_type === 'program_stage' && a.program_id) return `/app/programs/${a.program_id}/journey`;
  if (a.entity_type === 'program' && a.entity_id) return `/app/programs/${a.entity_id}`;
  if (a.entity_type === 'contract') return '/app/governance/contracts';
  if (a.entity_type === 'budget') return '/app/governance/budgets';
  if (a.entity_type === 'evidence') return '/app/evidence';
  if (a.program_id) return `/app/programs/${a.program_id}`;
  return null;
}

export function ApprovalsTab() {
  const { tr, pick, fmtDateTime } = useI18n();
  const { org, can, isPlatformAdmin } = useOrg();
  const { user } = useAuth();
  const toast = useToast(); const errMsg = useErrMsg();
  const [view, setView] = useState<'pending' | 'decided'>('pending');
  const [page, setPage] = useState(0);
  const [deciding, setDeciding] = useState<{ a: ApprovalRequest; decision: 'approved' | 'rejected' } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [codeMsg, setCodeMsg] = useState<string | null>(null);
  const programs = usePrograms();
  const state = useAsync(async () => {
    const f: Filter[] = [['organization_id', 'eq', org.id], view === 'pending' ? ['status', 'eq', 'pending'] : ['status', 'in', ['approved', 'rejected', 'cancelled']]];
    const r = await list<ApprovalRequest>('approval_requests', { filters: f, order: { column: view === 'pending' ? 'created_at' : 'decided_at', ascending: view === 'pending' }, page, pageSize: PAGE, count: true });
    const ids = [...new Set(r.rows.flatMap((a) => [a.requested_by, a.decided_by]).filter(Boolean) as string[])];
    const profiles = ids.length ? await all<Profile>('profiles', { select: 'id,full_name,email', filters: [['id', 'in', ids]], order: { column: 'id', ascending: true } }).catch(() => [] as Profile[]) : [];
    return { ...r, people: new Map(profiles.map((p) => [p.id, p.full_name || p.email || p.id.slice(0, 8)])) };
  }, [org.id, view, page]);
  const canApprove = can('governance.approve');
  const pname = (id: string | null) => { const p = id ? programs.data?.find((x) => x.id === id) : undefined; return p ? pick(p.name, p.name_en) : '—'; };

  const decide = async () => {
    if (!deciding) return;
    if (deciding.decision === 'rejected' && !note.trim()) return;
    setBusy(true); setCodeMsg(null);
    try {
      const r = await rpc<{ ok: boolean; code?: string; status?: string }>('decide_approval', { p_id: deciding.a.id, p_decision: deciding.decision, p_note: note.trim() || null });
      if (!r?.ok) {
        const m = r?.code ? CODES[r.code] : undefined;
        setCodeMsg(m ? tr(m[0], m[1]) : tr(`تعذر تنفيذ القرار (${r?.code ?? '—'})`, `Decision could not be applied (${r?.code ?? '—'})`));
        if (r?.code === 'ALREADY_DECIDED') void state.reload();
        return;
      }
      toast.success(deciding.decision === 'approved' ? tr('تم الاعتماد', 'Approved') : tr('تم الرفض', 'Rejected'));
      setDeciding(null); setNote(''); void state.reload();
    } catch (e) { setCodeMsg(errMsg(e)); } finally { setBusy(false); }
  };

  const columns: Column<ApprovalRequest>[] = [
    { key: 'title', header: tr('الطلب', 'Request'), render: (a) => {
      const to = entityLink(a);
      return <div className="stack-sm" style={{ gap: 2 }}>{to ? <Link to={to}><b className="small">{a.title}</b></Link> : <b className="small">{a.title}</b>}{a.details && <span className="tiny muted">{a.details}</span>}</div>;
    } },
    { key: 'entity', header: tr('النوع', 'Type'), value: (a) => (ENTITY[a.entity_type] ? tr(ENTITY[a.entity_type][0], ENTITY[a.entity_type][1]) : a.entity_type) },
    { key: 'program', header: tr('البرنامج', 'Program'), value: (a) => pname(a.program_id) },
    { key: 'requested', header: tr('مقدم الطلب', 'Requested by'), value: (a) => (a.requested_by ? state.data?.people.get(a.requested_by) ?? '—' : '—'),
      render: (a) => <span className="small">{a.requested_by ? state.data?.people.get(a.requested_by) ?? '—' : '—'}{a.requested_by === user?.id && <> <Badge tone="outline">{tr('أنت', 'You')}</Badge></>}</span> },
    { key: 'created', header: tr('تاريخ الطلب', 'Requested'), value: (a) => a.created_at, render: (a) => <span className="small nowrap">{fmtDateTime(a.created_at)}</span> },
    { key: 'status', header: tr('الحالة', 'Status'), value: (a) => a.status, render: (a) => <StatusBadge group="approvalStatus" value={a.status} /> },
    ...(view === 'decided' ? [
      { key: 'decided', header: tr('القرار', 'Decision'), value: (a: ApprovalRequest) => a.decided_at,
        render: (a: ApprovalRequest) => <div className="stack-sm" style={{ gap: 2 }}><span className="small">{a.decided_by ? state.data?.people.get(a.decided_by) ?? '—' : '—'} · {fmtDateTime(a.decided_at)}</span>{a.decision_note && <span className="tiny muted">«{a.decision_note}»</span>}</div> },
    ] : []),
    ...(view === 'pending' && canApprove ? [{
      key: 'actions', header: '', hideInExport: true, render: (a: ApprovalRequest) => {
        const self = a.requested_by === user?.id && !isPlatformAdmin;
        return (
          <div className="row" style={{ gap: 4 }} title={self ? tr('لا يمكنك اعتماد طلبك', 'You cannot decide your own request') : undefined}>
            <Button size="sm" variant="primary" icon={<Check />} disabled={self} onClick={() => { setDeciding({ a, decision: 'approved' }); setNote(''); setCodeMsg(null); }}>{tr('اعتماد', 'Approve')}</Button>
            <Button size="sm" variant="danger" icon={<X />} disabled={self} onClick={() => { setDeciding({ a, decision: 'rejected' }); setNote(''); setCodeMsg(null); }}>{tr('رفض', 'Reject')}</Button>
          </div>
        );
      },
    }] : []),
  ];
  return (
    <Card>
      <CardHeader title={tr('طلبات الاعتماد', 'Approval requests')} icon={<ClipboardCheck />}
        hint={tr('القرار يُطبَّق على السجل المرتبط (مرحلة، تقرير، عقد) ويُسجل في سجل التدقيق', 'The decision is applied to the linked record (stage, report, contract) and logged in the audit trail')} />
      <CardBody flush>
        {!canApprove && <div style={{ padding: 12 }}><Notice tone="info">{tr('يمكنك متابعة الطلبات، لكن اتخاذ القرار يتطلب صلاحية «اعتماد الحوكمة».', 'You can follow requests, but deciding requires the “governance approve” permission.')}</Notice></div>}
        <DataTable columns={columns} rows={state.data?.rows ?? []} rowKey={(a) => a.id} loading={state.loading} error={state.error} onRetry={() => void state.reload()}
          exportName={`approvals-${view}`} server={{ page, pageSize: PAGE, total: state.data?.total ?? null, onPage: setPage }}
          toolbar={<Segmented value={view} onChange={(v) => { setView(v); setPage(0); }} options={[{ value: 'pending', label: tr('بانتظار القرار', 'Pending') }, { value: 'decided', label: tr('تم البت فيها', 'Decided') }]} />}
          empty={{ title: view === 'pending' ? tr('لا توجد طلبات معلقة', 'No pending requests') : tr('لا توجد قرارات بعد', 'No decisions yet') }} />
      </CardBody>
      <Modal open={!!deciding} onClose={() => setDeciding(null)} title={deciding?.decision === 'approved' ? tr('اعتماد الطلب', 'Approve request') : tr('رفض الطلب', 'Reject request')}
        footer={<><Button onClick={() => setDeciding(null)}>{tr('إلغاء', 'Cancel')}</Button>
          <Button variant={deciding?.decision === 'approved' ? 'primary' : 'danger'} loading={busy} disabled={deciding?.decision === 'rejected' && !note.trim()} onClick={decide}>
            {deciding?.decision === 'approved' ? tr('اعتماد', 'Approve') : tr('رفض', 'Reject')}</Button></>}>
        <div className="stack">
          <p className="small"><b>{deciding?.a.title}</b></p>
          {deciding?.a.entity_type === 'report' && deciding.decision === 'rejected' && <Notice tone="info">{tr('رفض التقرير يعيده إلى حالة «مسودة».', 'Rejecting a report returns it to “draft”.')}</Notice>}
          {deciding?.a.entity_type === 'contract' && <Notice tone="info">{deciding.decision === 'approved' ? tr('اعتماد العقد يجعله «ساريًا».', 'Approving the contract makes it “active”.') : tr('رفض العقد يعيده إلى «مسودة».', 'Rejecting the contract returns it to “draft”.')}</Notice>}
          {deciding?.a.entity_type === 'program_stage' && deciding.decision === 'approved' && <Notice tone="info">{tr('اعتماد المرحلة يكملها (100%).', 'Approving the stage completes it (100%).')}</Notice>}
          <Field label={tr('ملاحظة القرار', 'Decision note')} required={deciding?.decision === 'rejected'} hint={deciding?.decision === 'rejected' ? tr('سبب الرفض إلزامي ليتمكن مقدم الطلب من المعالجة', 'A reason is required so the requester can address it') : undefined}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          </Field>
          {codeMsg && <Notice tone="danger">{codeMsg}</Notice>}
        </div>
      </Modal>
    </Card>
  );
}
