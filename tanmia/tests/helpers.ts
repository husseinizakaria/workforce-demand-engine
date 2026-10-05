import type { ProgramBundle } from '../supabase/functions/_shared/engine/types.ts';
import { TRACK_BY_CODE } from '../supabase/functions/_shared/engine/tracks.ts';

/** Builds a minimal, internally-consistent program bundle for engine tests. */
export function bundle(overrides: Partial<ProgramBundle> = {}, track = 'graduate'): ProgramBundle {
  const t = TRACK_BY_CODE[track];
  return {
    program: { id: 'p1', organization_id: 'o1', code: 'PRG-2026-0001', name: 'Test program', track_code: track, status: 'active',
      start_date: '2026-01-01', end_date: '2026-12-31', target_beneficiaries: 10, budget_total: null },
    stages: t.stages.map((s, i) => ({ id: `s${i}`, stage_key: s.key, name_ar: s.name_ar, name_en: s.name_en, stage_order: i + 1, depends_on: s.depends_on,
      status: 'not_started', progress: 0, planned_start: null, planned_end: null, actual_start: null, actual_end: null,
      requires_approval: s.requires_approval, approval_status: s.requires_approval ? 'not_requested' : 'not_required',
      required_evidence: s.required_evidence, record_types: s.record_types, blocker_note: null })),
    cohorts: [], enrollments: [], applications: [], beneficiaries: [], sessions: [], participants: [], experts: [], assignments: [],
    indicators: [], measurements: [], evidence: [], outputs: [], outcomes: [], budgets: [], risks: [], actions: [],
    impactFramework: null, maturityFrameworks: [], maturityAssessments: [], results: [], stageRecords: [], approvalsPending: [],
    ...overrides,
  };
}
