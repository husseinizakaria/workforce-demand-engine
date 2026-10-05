// Experts: program assignments, performance, and explainable expert matching
// (server function when deployed, the same engine in the browser otherwise).
import { useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, Pencil, Search, Sparkles, Trash2, UserCheck, UserPlus } from 'lucide-react';
import { matchExperts, type MatchFactor, type MatchRequirements, type MatchResult } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAction } from '@/hooks/useAction';
import { all, insert, remove, update } from '@/services/db';
import { errorOf } from '@/services/errors';
import {
  Badge, Button, Card, CardBody, CardHeader, DataTable, Drawer, Field, Input, Notice, Progress, Select, StatusBadge, TagInput, useConfirm, scoreTone, type Column,
} from '@/components/ui';
import { RecordFormModal, type FieldSpec } from '@/components/forms/RecordForm';
import type { Expert, ExpertAssignment, ExpertAvailability, ExpertRole } from '@/types/db';
import { errText, tryFunction } from '../../lib';
import { useWorkspace } from '../context';
import { RowActions, TabInsights } from '../components/common';

export default function ExpertsTab() {
  const { tr, enumLabel, fmtNumber } = useI18n();
  const { can } = useOrg();
  const ws = useWorkspace();
  const b = ws.bundle;
  const confirm = useConfirm();
  const [editing, setEditing] = useState<ExpertAssignment | null>(null);
  const [why, setWhy] = useState<ExpertAssignment | null>(null);
  const del = useAction(async (id: string) => { await remove('expert_assignments', id); await ws.reload(); }, { success: ['تم حذف التكليف', 'Assignment removed'] });
  const cols: Column<ExpertAssignment>[] = [
    { key: 'expert', header: tr('الخبير', 'Expert'), sortable: true, value: (r) => ws.expertName(r.expert_id),
      render: (r) => <Link to={`/app/experts/${r.expert_id}`} onClick={(e) => e.stopPropagation()}>{ws.expertName(r.expert_id)}</Link> },
    { key: 'role', header: tr('الدور', 'Role'), value: (r) => enumLabel('expertRole', r.role) },
    { key: 'stage', header: tr('المرحلة', 'Stage'), value: (r) => ws.stageName(r.stage_key) },
    { key: 'subject', header: tr('مخصص لـ', 'For'), value: (r) => (r.beneficiary_id ? ws.benName(r.beneficiary_id) : r.cohort_id ? ws.cohortName(r.cohort_id) : tr('البرنامج', 'Program')) },
    { key: 'hours', header: tr('الساعات (منفذة / مخططة)', 'Hours (delivered / planned)'), value: (r) => Number(r.delivered_hours),
      render: (r) => <div className="row"><Progress value={r.planned_hours ? (Number(r.delivered_hours) / Number(r.planned_hours)) * 100 : 0} /><span className="tiny nowrap">{fmtNumber(Number(r.delivered_hours), 1)} / {fmtNumber(r.planned_hours === null ? null : Number(r.planned_hours), 1)}</span></div> },
    { key: 'status', header: tr('الحالة', 'Status'), value: (r) => r.status, render: (r) => <StatusBadge group="assignmentStatus" value={r.status} /> },
    { key: 'match', header: tr('درجة المطابقة', 'Match'), align: 'end', value: (r) => r.match_score,
      render: (r) => (r.match_score === null ? <span className="muted">—</span> : <button type="button" className="link-btn" onClick={(e) => { e.stopPropagation(); setWhy(r); }}>{fmtNumber(Number(r.match_score), 1)}</button>) },
    { key: 'rating', header: tr('التقييم', 'Rating'), align: 'end', value: (r) => r.performance_rating, render: (r) => (r.performance_rating === null ? <span className="muted">—</span> : `${Number(r.performance_rating)} / 5`) },
    { key: 'actions', header: '', hideInExport: true, render: (r) => (
      <RowActions>
        {can('experts.assign') && <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => setEditing(r)} />}
        {can('experts.assign') && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')}
          onClick={async () => { if (await confirm({ title: tr('حذف التكليف؟', 'Remove assignment?'), danger: true })) void del.run(r.id); }} />}
      </RowActions>
    ) },
  ];
  const fields: FieldSpec[] = [
    { name: 'role', label: ['الدور', 'Role'], type: 'enum', enumGroup: 'expertRole', required: true },
    { name: 'status', label: ['الحالة', 'Status'], type: 'enum', enumGroup: 'assignmentStatus', required: true },
    { name: 'stage_key', label: ['المرحلة', 'Stage'], type: 'select', options: b.stages.map((s) => ({ value: s.stage_key, label: ws.stageName(s.stage_key) })) },
    { name: 'cohort_id', label: ['الدفعة', 'Cohort'], type: 'select', options: b.cohorts.map((c) => ({ value: c.id, label: c.name })) },
    { name: 'beneficiary_id', label: ['مستفيد محدد', 'Specific beneficiary'], type: 'select', options: ws.enrolled.map((x) => ({ value: x.id, label: x.full_name })) },
    { name: 'planned_hours', label: ['الساعات المخططة', 'Planned hours'], type: 'number', min: 0 },
    { name: 'delivered_hours', label: ['الساعات المنفذة', 'Delivered hours'], type: 'number', min: 0, hint: ['تُضاف تلقائيًا عند إكمال الجلسات', 'Added automatically when sessions complete'] },
    { name: 'rate', label: ['السعر بالساعة', 'Hourly rate'], type: 'number', min: 0 },
    { name: 'starts_on', label: ['من', 'From'], type: 'date' },
    { name: 'ends_on', label: ['إلى', 'To'], type: 'date', validate: (v, a) => (typeof v === 'string' && typeof a.starts_on === 'string' && v && a.starts_on && v < a.starts_on ? ['النهاية قبل البداية', 'End before start'] : null) },
    { name: 'performance_rating', label: ['تقييم الأداء (0–5)', 'Performance rating (0–5)'], type: 'number', min: 0, max: 5, step: 0.5 },
    { name: 'feedback', label: ['ملاحظات الأداء', 'Performance feedback'], type: 'textarea' },
  ];
  return (
    <div className="stack">
      <TabInsights links={['experts']} />
      <Card>
        <CardHeader icon={<UserCheck />} title={tr('تكليفات الخبراء', 'Expert assignments')} hint={`${b.assignments.length} ${tr('تكليف', 'assignments')}`} />
        <CardBody flush>
          <DataTable rows={b.assignments} rowKey={(r) => r.id} columns={cols} searchable exportName={`${b.program.code}-expert-assignments`}
            empty={{ title: tr('لا يوجد خبراء مكلفون', 'No experts assigned'), description: tr('استخدم «البحث عن خبراء» أدناه لترشيح خبراء مع مبررات واضحة.', 'Use “Find experts” below to get ranked candidates with clear rationale.') }} />
        </CardBody>
      </Card>
      <MatchPanel />
      <RecordFormModal open={!!editing} onClose={() => setEditing(null)} title={`${tr('تعديل التكليف', 'Edit assignment')}: ${editing ? ws.expertName(editing.expert_id) : ''}`} fields={fields}
        initial={editing ? { ...editing } : {}}
        onSubmit={async (v) => { if (!editing) return; await update<ExpertAssignment>('expert_assignments', editing.id, { ...v, delivered_hours: v.delivered_hours ?? 0 }); await ws.reload(); }} />
      {why && (
        <Drawer open title={`${tr('مبررات المطابقة', 'Match rationale')}: ${ws.expertName(why.expert_id)}`} onClose={() => setWhy(null)}>
          <FactorTable factors={(why.match_rationale as unknown as MatchFactor[]).filter((f) => f && typeof f === 'object' && 'key' in f)} />
        </Drawer>
      )}
    </div>
  );
}

function FactorTable({ factors }: { factors: MatchFactor[] }) {
  const { tr, L } = useI18n();
  if (!factors.length) return <p className="small muted">{tr('لا توجد مبررات محفوظة.', 'No stored rationale.')}</p>;
  return (
    <table className="table">
      <thead><tr><th>{tr('العامل', 'Factor')}</th><th className="num">{tr('النقاط', 'Points')}</th><th>{tr('التفصيل', 'Detail')}</th></tr></thead>
      <tbody>
        {factors.map((f) => (
          <tr key={f.key}>
            <td className="nowrap">{L(f.label)}</td>
            <td className="num"><div className="row" style={{ justifyContent: 'flex-end' }}><Progress value={f.max ? (f.points / f.max) * 100 : 0} /><span className="nowrap">{f.points}/{f.max}</span></div></td>
            <td className="small muted">{L(f.detail)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MatchPanel() {
  const { tr, enumOptions, L, locale, fmtNumber } = useI18n();
  const { can, org } = useOrg();
  const ws = useWorkspace();
  const b = ws.bundle;
  const [req, setReq] = useState({ role: '' as ExpertRole | '', expertise: [] as string[], sector: '', language: 'ar', city: b.program.region ?? '', delivery_mode: b.program.delivery_mode ?? '', needed_hours: '', stage_key: '' });
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [source, setSource] = useState<'server' | 'browser' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const assignedActive = new Set(b.assignments.filter((a) => ['proposed', 'confirmed', 'active'].includes(a.status)).map((a) => a.expert_id));

  const requirements = (): MatchRequirements => ({
    role: req.role || null, expertise: req.expertise, sector: req.sector.trim() || null, language: req.language || null, city: req.city.trim() || null,
    delivery_mode: req.delivery_mode || null, needed_hours: req.needed_hours ? Number(req.needed_hours) : null,
    conflict_terms: [b.sponsorName, b.program.name].filter((x): x is string => !!x),
  });
  const find = async () => {
    setBusy(true); setNotice(null);
    const r = await tryFunction<{ results: MatchResult[] }>('expert-matching', { organization_id: org.id, program_id: ws.programId, requirements: requirements(), limit: 20 });
    if (r.ok) { setResults(r.data.results ?? []); setSource('server'); setBusy(false); return; }
    try {
      const [experts, assignments, availability] = await Promise.all([
        all<Expert>('experts', { filters: [['organization_id', 'eq', org.id], ['status', 'eq', 'active']], order: { column: 'full_name', ascending: true } }, 2000),
        all<ExpertAssignment>('expert_assignments', { filters: [['organization_id', 'eq', org.id]] }, 10000),
        all<ExpertAvailability>('expert_availability', { filters: [['organization_id', 'eq', org.id]] }, 10000),
      ]);
      setResults(matchExperts(experts, requirements(), { assignments, availability }).slice(0, 20));
      setSource('browser');
      setNotice(r.unavailable
        ? tr('خدمة المطابقة على الخادم غير منشورة؛ النتائج محسوبة في المتصفح بنفس محرك المطابقة.', 'The server matching service is not deployed; results are computed in the browser with the same matching engine.')
        : tr('تعذرت المطابقة على الخادم (', 'Server matching failed (') + errText(locale, r.error) + tr(')؛ النتائج محسوبة في المتصفح.', '); results are computed in the browser.'));
    } catch (e) {
      setResults(null); setNotice(errText(locale, errorOf(e)));
    } finally { setBusy(false); }
  };
  const assign = useAction(async (m: MatchResult) => {
    await insert<ExpertAssignment>('expert_assignments', {
      organization_id: org.id, program_id: ws.programId, expert_id: m.expert_id, role: req.role || 'mentor', stage_key: req.stage_key || null,
      planned_hours: req.needed_hours ? Number(req.needed_hours) : null, status: 'proposed', match_score: m.score, match_rationale: m.factors,
    });
    await ws.reload();
  }, { success: ['تم إنشاء تكليف مقترح', 'Proposed assignment created'] });

  return (
    <Card>
      <CardHeader icon={<Sparkles />} title={tr('البحث عن خبراء (مطابقة قابلة للتفسير)', 'Find experts (explainable matching)')}
        hint={tr('الترشيحات توصيات؛ القرار والإسناد للمستخدم', 'Rankings are recommendations; you decide and assign')} />
      <CardBody>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
          <Field label={tr('الدور', 'Role')}><Select placeholder={tr('— أي دور —', '— Any role —')} options={enumOptions('expertRole')} value={req.role} onChange={(e) => setReq({ ...req, role: e.target.value as ExpertRole | '' })} /></Field>
          <Field label={tr('القطاع', 'Sector')}><Input value={req.sector} onChange={(e) => setReq({ ...req, sector: e.target.value })} /></Field>
          <Field label={tr('اللغة', 'Language')}><Select options={[{ value: 'ar', label: tr('العربية', 'Arabic') }, { value: 'en', label: tr('الإنجليزية', 'English') }]} placeholder={tr('— أي لغة —', '— Any —')} value={req.language} onChange={(e) => setReq({ ...req, language: e.target.value })} /></Field>
          <Field label={tr('المدينة', 'City')}><Input value={req.city} onChange={(e) => setReq({ ...req, city: e.target.value })} /></Field>
          <Field label={tr('طريقة التنفيذ', 'Delivery mode')}><Select placeholder="—" options={enumOptions('deliveryMode')} value={req.delivery_mode} onChange={(e) => setReq({ ...req, delivery_mode: e.target.value as typeof req.delivery_mode })} /></Field>
          <Field label={tr('الساعات المطلوبة', 'Needed hours')}><Input type="number" min={0} dir="ltr" value={req.needed_hours} onChange={(e) => setReq({ ...req, needed_hours: e.target.value })} /></Field>
          <Field label={tr('المرحلة (للتكليف)', 'Stage (for assignment)')}><Select placeholder="—" options={b.stages.map((s) => ({ value: s.stage_key, label: ws.stageName(s.stage_key) }))} value={req.stage_key} onChange={(e) => setReq({ ...req, stage_key: e.target.value })} /></Field>
          <Field label={tr('الخبرات المطلوبة', 'Required expertise')} className="full"><TagInput value={req.expertise} onChange={(x) => setReq({ ...req, expertise: x })} /></Field>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <Button variant="primary" icon={<Search />} loading={busy} onClick={() => void find()}>{tr('بحث', 'Find')}</Button>
          {b.sponsorName && <span className="tiny muted">{tr(`يُفحص تعارض المصالح مع الراعي «${b.sponsorName}» تلقائيًا.`, `Conflicts of interest with sponsor “${b.sponsorName}” are checked automatically.`)}</span>}
        </div>
      </CardBody>
      {notice && <CardBody><Notice tone="warning">{notice}</Notice></CardBody>}
      {results && (
        <CardBody flush>
          <div className="row between" style={{ padding: '8px 16px' }}>
            <span className="small">{tr(`${results.length} مرشح`, `${results.length} candidates`)}</span>
            <Badge tone={source === 'server' ? 'success' : 'info'}>{source === 'server' ? tr('محسوب على الخادم', 'Computed on server') : tr('محسوب في المتصفح', 'Computed in browser')}</Badge>
          </div>
          {!results.length ? <p className="small muted" style={{ padding: 16 }}>{tr('لا يوجد خبراء نشطون مطابقون.', 'No matching active experts.')}</p> : (
            <ul className="list-plain" style={{ paddingInline: 16 }}>
              {results.map((m, i) => (
                <li key={m.expert_id} className="stack-sm">
                  <div className="row between wrap">
                    <div className="row">
                      <Badge tone="outline">#{i + 1}</Badge>
                      <Link to={`/app/experts/${m.expert_id}`} className="strong">{m.name}</Link>
                      <span className="mono tiny muted">{m.code}</span>
                      {!m.eligible && <Badge tone="danger">{tr('غير مؤهل', 'Not eligible')}</Badge>}
                      {assignedActive.has(m.expert_id) && <Badge tone="info">{tr('مكلف في البرنامج', 'Already assigned')}</Badge>}
                    </div>
                    <div className="row">
                      <div style={{ width: 120 }}><Progress value={m.score} tone={scoreTone(m.score)} /></div>
                      <b>{fmtNumber(m.score, 1)}</b>
                      <span className="tiny muted">{tr('العبء', 'Load')} {fmtNumber(m.load_hours, 1)}h</span>
                      <Button size="sm" variant="ghost" onClick={() => setExpanded(expanded === m.expert_id ? null : m.expert_id)}>{expanded === m.expert_id ? tr('إخفاء', 'Hide') : tr('لماذا؟', 'Why?')}</Button>
                      {can('experts.assign') && <Button size="sm" variant="primary" icon={<UserPlus />} disabled={!m.eligible} loading={assign.busy} onClick={() => void assign.run(m)}>{tr('إسناد', 'Assign')}</Button>}
                    </div>
                  </div>
                  {m.warnings.length > 0 && <div className="row wrap">{m.warnings.map((w, j) => <Badge key={j} tone="warning" icon={<AlertTriangle />}>{L(w)}</Badge>)}</div>}
                  {expanded === m.expert_id && <FactorTable factors={m.factors} />}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      )}
    </Card>
  );
}
