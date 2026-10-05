// Evidence completeness: what the program's own configuration says must be
// evidenced (stage required evidence, indicators requiring evidence, sessions
// needing attendance proof) versus what exists in the registry.
import { type L10n, type ProgramBundle, l } from './types.ts';

export interface EvidenceRequirement { key: string; label: L10n; satisfied: boolean; kind: 'stage' | 'indicator' | 'session' | 'output' }
export interface EvidenceCompleteness { score: number; required: number; satisfied: number; missing: EvidenceRequirement[]; items: EvidenceRequirement[]; verified_share: number | null }

const OK = new Set(['pending', 'verified']);

export function evidenceCompleteness(b: Pick<ProgramBundle, 'stages' | 'indicators' | 'measurements' | 'evidence' | 'sessions' | 'outputs'>): EvidenceCompleteness {
  const items: EvidenceRequirement[] = [];
  for (const s of b.stages) {
    if (!['in_progress', 'completed'].includes(s.status)) continue;
    for (const t of s.required_evidence) {
      const ok = b.evidence.some((e) => e.stage_key === s.stage_key && e.evidence_type === t && OK.has(e.verification_status));
      items.push({ key: `stage:${s.stage_key}:${t}`, kind: 'stage', satisfied: ok,
        label: l(`المرحلة «${s.name_ar}» تتطلب دليلًا من نوع ${t}`, `Stage “${s.name_en ?? s.name_ar}” requires ${t} evidence`) });
    }
  }
  for (const i of b.indicators) {
    if (!i.evidence_required || i.status !== 'active') continue;
    const hasMeasurements = b.measurements.some((m) => m.indicator_id === i.id);
    if (!hasMeasurements) continue;
    const ok = b.evidence.some((e) => e.indicator_id === i.id && OK.has(e.verification_status))
      || b.measurements.some((m) => m.indicator_id === i.id && m.evidence_id);
    items.push({ key: `indicator:${i.id}`, kind: 'indicator', satisfied: ok,
      label: l(`قياسات المؤشر ${i.code} بلا دليل مرتبط`, `Indicator ${i.code} measurements lack linked evidence`) });
  }
  const completed = b.sessions.filter((s) => s.status === 'completed');
  if (completed.length) {
    const withProof = completed.filter((s) => b.evidence.some((e) => e.session_id === s.id && OK.has(e.verification_status))).length;
    const share = withProof / completed.length;
    items.push({ key: 'sessions:proof', kind: 'session', satisfied: share >= 0.5,
      label: l(`${completed.length - withProof} جلسة مكتملة دون دليل (كشف حضور/صور/محضر)`, `${completed.length - withProof} completed sessions without proof (attendance sheet/photos/minutes)`) });
  }
  for (const o of b.outputs) {
    if (o.status !== 'achieved') continue;
    const ok = b.evidence.some((e) => e.output_id === o.id && OK.has(e.verification_status));
    items.push({ key: `output:${o.id}`, kind: 'output', satisfied: ok, label: l(`المخرج ${o.code} منجز دون دليل`, `Output ${o.code} achieved without evidence`) });
  }
  const satisfied = items.filter((x) => x.satisfied).length;
  const verified = b.evidence.filter((e) => e.verification_status === 'verified').length;
  return {
    score: items.length ? Math.round((satisfied / items.length) * 100) : 100,
    required: items.length, satisfied, missing: items.filter((x) => !x.satisfied), items,
    verified_share: b.evidence.length ? Math.round((verified / b.evidence.length) * 100) / 100 : null,
  };
}
