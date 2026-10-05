// Derived journey state per stage (dependencies, evidence, approvals, records).
import type { FullProgramBundle } from '@/services/programBundle';
import type { ProgramStage } from '@/types/db';

export interface StageInfo {
  stage: ProgramStage;
  deps: { key: string; stage: ProgramStage | undefined; met: boolean }[];
  unmet: string[];
  locked: boolean;
  evidence: { type: string; satisfied: boolean; count: number }[];
  evidenceMissing: number;
  records: number;
  participants: number;
  overdue: boolean;
}

const OK = new Set(['pending', 'verified']);

export function stageInfo(b: FullProgramBundle, s: ProgramStage, today = new Date().toISOString().slice(0, 10)): StageInfo {
  const byKey = new Map(b.stages.map((x) => [x.stage_key, x]));
  const deps = s.depends_on.map((k) => {
    const st = byKey.get(k);
    return { key: k, stage: st, met: !!st && ['completed', 'skipped'].includes(st.status) };
  });
  const unmet = deps.filter((d) => !d.met).map((d) => d.key);
  const evidence = s.required_evidence.map((t) => {
    const rows = b.evidence.filter((e) => e.stage_key === s.stage_key && e.evidence_type === t && OK.has(e.verification_status));
    return { type: t, satisfied: rows.length > 0, count: rows.length };
  });
  return {
    stage: s, deps, unmet,
    locked: unmet.length > 0 && s.status === 'not_started',
    evidence, evidenceMissing: evidence.filter((e) => !e.satisfied).length,
    records: b.stageRecords.filter((r) => r.stage_key === s.stage_key).length,
    participants: b.enrollments.filter((e) => e.current_stage_key === s.stage_key && !['withdrawn', 'dropped'].includes(e.status)).length,
    overdue: s.status === 'in_progress' && !!s.planned_end && s.planned_end < today,
  };
}

/** Next stage that can start now (all prerequisites done), in order. */
export function nextAvailable(b: FullProgramBundle): ProgramStage | undefined {
  return b.stages.find((s) => s.status === 'not_started' && stageInfo(b, s).unmet.length === 0);
}

export function journeyProgress(stages: ProgramStage[]): number {
  if (!stages.length) return 0;
  return Math.round(stages.reduce((a, s) => a + (['completed', 'skipped'].includes(s.status) ? 100 : s.progress), 0) / stages.length);
}
