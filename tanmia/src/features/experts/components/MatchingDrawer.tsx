// Smart matching: requirements → explainable ranked experts. Server function
// first (adds sponsor conflicts and authorizes), browser engine as fallback.
import { useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, Sparkles } from 'lucide-react';
import { matchExperts, type MatchRequirements, type MatchResult } from '@engine';
import { Badge, Button, Drawer, EntityPicker, Field, Input, Notice, Progress, Select, TagInput } from '@/components/ui';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { all, get } from '@/services/db';
import { callFunction } from '@/services/functions';
import { errorOf } from '@/services/errors';
import type { Expert, ExpertAssignment, ExpertAvailability, Partner, Program } from '@/types/db';

export function MatchingDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { org } = useOrg();
  const { tr, enumOptions, L, locale, fmtNumber } = useI18n();
  const [programId, setProgramId] = useState<string | null>(null);
  const [role, setRole] = useState('');
  const [expertise, setExpertise] = useState<string[]>([]);
  const [sector, setSector] = useState('');
  const [language, setLanguage] = useState('');
  const [city, setCity] = useState('');
  const [mode, setMode] = useState('');
  const [hours, setHours] = useState('');
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [source, setSource] = useState<'server' | 'client' | null>(null);
  const [serverNote, setServerNote] = useState<string | null>(null);

  const run = async () => {
    setBusy(true); setServerNote(null); setResults(null);
    const requirements: MatchRequirements = {
      role: role || null, expertise, sector: sector.trim() || null, language: language || null, city: city.trim() || null,
      delivery_mode: mode || null, needed_hours: hours ? Number(hours) : null, conflict_terms: conflicts,
    };
    try {
      const r = await callFunction<{ results: MatchResult[] }>('expert-matching', { organization_id: org.id, program_id: programId ?? undefined, requirements, limit: 25 });
      setResults(r.results ?? []); setSource('server');
    } catch (e) {
      const err = errorOf(e);
      setServerNote(err.code === 'function_unavailable'
        ? tr('خدمة المطابقة على الخادم غير منشورة؛ النتائج أدناه محسوبة في المتصفح بنفس المحرك.', 'The server matching service is not deployed; results below are computed in the browser with the same engine.')
        : `${locale === 'ar' ? err.message_ar : err.message_en} — ${tr('عُرضت نتائج محسوبة في المتصفح.', 'Showing results computed in the browser.')}`);
      try {
        const orgF: [string, 'eq', string] = ['organization_id', 'eq', org.id];
        const [experts, assignments, availability] = await Promise.all([
          all<Expert>('experts', { filters: [orgF], order: { column: 'full_name', ascending: true } }, 5000),
          all<ExpertAssignment>('expert_assignments', { filters: [orgF] }, 20000),
          all<ExpertAvailability>('expert_availability', { filters: [orgF] }, 20000),
        ]);
        const terms = [...conflicts];
        if (programId) {
          try {
            const p = await get<Program>('programs', programId);
            if (p.sponsor_partner_id) terms.push((await get<Partner>('partners', p.sponsor_partner_id)).name);
          } catch { /* sponsor not visible */ }
        }
        setResults(matchExperts(experts, { ...requirements, conflict_terms: terms }, { assignments, availability }).slice(0, 25));
        setSource('client');
      } catch (e2) {
        const err2 = errorOf(e2);
        setServerNote(locale === 'ar' ? err2.message_ar : err2.message_en);
      }
    } finally { setBusy(false); }
  };

  return (
    <Drawer open={open} onClose={onClose} wide title={<span className="row"><Sparkles size={16} />{tr('المطابقة الذكية للخبراء', 'Smart expert matching')}</span>}>
      <div className="stack">
        <div className="form-grid">
          <Field label={tr('البرنامج (اختياري)', 'Program (optional)')} hint={tr('يضيف اسم الراعي لفحص تعارض المصالح', 'Adds the sponsor name to the conflict-of-interest check')} className="full">
            <EntityPicker kind="programs" organizationId={org.id} value={programId} onChange={(id) => setProgramId(id)} />
          </Field>
          <Field label={tr('الدور المطلوب', 'Required role')}><Select options={enumOptions('expertRole')} placeholder={tr('أي دور', 'Any role')} value={role} onChange={(e) => setRole(e.target.value)} /></Field>
          <Field label={tr('طريقة التقديم', 'Delivery mode')}><Select options={enumOptions('deliveryMode')} placeholder={tr('أي طريقة', 'Any')} value={mode} onChange={(e) => setMode(e.target.value)} /></Field>
          <Field label={tr('الخبرات المطلوبة', 'Required expertise')} className="full"><TagInput value={expertise} onChange={setExpertise} /></Field>
          <Field label={tr('القطاع', 'Sector')}><Input value={sector} onChange={(e) => setSector(e.target.value)} /></Field>
          <Field label={tr('اللغة', 'Language')}><Select options={[{ value: 'ar', label: tr('العربية', 'Arabic') }, { value: 'en', label: tr('الإنجليزية', 'English') }]} placeholder={tr('أي لغة', 'Any')} value={language} onChange={(e) => setLanguage(e.target.value)} /></Field>
          <Field label={tr('المدينة', 'City')}><Input value={city} onChange={(e) => setCity(e.target.value)} /></Field>
          <Field label={tr('الساعات المطلوبة', 'Needed hours')}><Input type="number" min={0} dir="ltr" value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
          <Field label={tr('أطراف لفحص التعارض', 'Parties to check for conflicts')} hint={tr('أسماء مستفيدين أو فرق أو جهات', 'Beneficiary, team or organization names')} className="full"><TagInput value={conflicts} onChange={setConflicts} /></Field>
        </div>
        <div className="row"><Button variant="primary" icon={<Sparkles />} loading={busy} onClick={() => void run()}>{tr('ابحث عن أفضل الخبراء', 'Find best experts')}</Button>
          {source && <Badge tone={source === 'server' ? 'success' : 'info'}>{source === 'server' ? tr('محسوب على الخادم', 'Computed on server') : tr('محسوب في المتصفح', 'Computed in browser')}</Badge>}</div>
        {serverNote && <Notice tone="warning">{serverNote}</Notice>}
        {results && results.length === 0 && <Notice tone="info">{tr('لا يوجد خبراء مسجلون للمطابقة.', 'No experts are registered to match.')}</Notice>}
        {results && results.map((r, i) => (
          <div key={r.expert_id} className="card card-pad stack-sm">
            <div className="row between">
              <div className="row"><b className="mono">#{i + 1}</b><Link to={`/app/experts/${r.expert_id}/profile`}><b>{r.name}</b></Link><span className="mono small muted">{r.code}</span></div>
              <div className="row">{r.eligible ? <Badge tone="success">{tr('مؤهل', 'Eligible')}</Badge> : <Badge tone="danger">{tr('غير مؤهل', 'Not eligible')}</Badge>}<b>{fmtNumber(r.score, 1)}</b><span className="small muted">/100</span></div>
            </div>
            <table className="table">
              <tbody>
                {r.factors.map((f) => (
                  <tr key={f.key}>
                    <td style={{ width: 150 }} className="small">{L(f.label)}</td>
                    <td className="small muted">{L(f.detail)}</td>
                    <td style={{ width: 120 }}><Progress value={f.max ? (f.points / f.max) * 100 : 0} tone={f.points >= f.max * 0.75 ? 'success' : f.points >= f.max * 0.4 ? 'warning' : 'danger'} /></td>
                    <td className="num small" style={{ width: 60 }}>{fmtNumber(f.points, 1)}/{f.max}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {r.warnings.map((w, j) => <span key={j} className="small row" style={{ color: 'var(--warning)' }}><AlertTriangle size={13} />{L(w)}</span>)}
            <span className="tiny muted">{tr('عبء متبقٍ', 'Remaining load')}: {fmtNumber(r.load_hours, 1)} {tr('ساعة', 'h')}</span>
          </div>
        ))}
        {results && results.length > 0 && <p className="tiny muted">{tr('الترتيب توصية قابلة للتفسير؛ قرار الإسناد يبقى للمستخدم.', 'The ranking is an explainable recommendation; the assignment decision remains yours.')}</p>}
      </div>
    </Drawer>
  );
}
