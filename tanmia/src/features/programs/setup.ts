// Program setup helpers shared by the creation wizard and workspace tabs:
// copy central templates into the organization and seed default indicators.
import { TRACK_BY_CODE, type IndicatorSeed } from '@engine';
import { insert, insertMany, maybe, rpc, update } from '@/services/db';
import type { ImpactFramework, Indicator, MaturityFramework, ProgramCohort } from '@/types/db';

export async function findCentralImpactFramework(trackCode: string): Promise<ImpactFramework | null> {
  return maybe<ImpactFramework>('impact_frameworks', [['organization_id', 'is', null], ['program_id', 'is', null], ['track_code', 'eq', trackCode]]);
}
export async function findCentralMaturityFramework(trackCode: string): Promise<MaturityFramework | null> {
  return maybe<MaturityFramework>('maturity_frameworks', [['organization_id', 'is', null], ['track_code', 'eq', trackCode], ['status', 'eq', 'active']]);
}

/** Program impact framework: a copy of the central track template (or blank when none). */
export async function createImpactFramework(orgId: string, program: { id: string; name: string; track_code: string }, central: ImpactFramework | null): Promise<ImpactFramework> {
  return insert<ImpactFramework>('impact_frameworks', {
    organization_id: orgId, program_id: program.id, name: `${central?.name ?? 'نظرية التغيير'} — ${program.name}`, track_code: program.track_code,
    problem_statement: central?.problem_statement ?? null, target_population: central?.target_population ?? null, baseline_summary: central?.baseline_summary ?? null,
    theory_of_change: central?.theory_of_change ?? {}, intended_impact: central?.intended_impact ?? null,
    evaluation_design: central?.evaluation_design ?? 'pre_post', attribution_approach: central?.attribution_approach ?? 'contribution',
    status: 'draft', version: 1,
  });
}

export function defaultIndicatorSeeds(trackCode: string): IndicatorSeed[] {
  return TRACK_BY_CODE[trackCode]?.default_indicators ?? [];
}

export async function createDefaultIndicators(orgId: string, programId: string, trackCode: string, frameworkId: string | null): Promise<Indicator[]> {
  const seeds = defaultIndicatorSeeds(trackCode);
  return insertMany<Indicator>('indicators', seeds.map((s) => ({
    organization_id: orgId, program_id: programId, impact_framework_id: frameworkId, name: s.name_ar, name_en: s.name_en,
    indicator_type: s.indicator_type, chain_level: s.chain_level, outcome_term: s.outcome_term ?? null, unit: s.unit, direction: s.direction,
    measurement_points: s.measurement_points, frequency: 'per_measurement_point', evidence_required: s.indicator_type !== 'operational', status: 'active',
  })));
}

export async function linkMaturityFramework(orgId: string, programId: string, centralId: string): Promise<string> {
  const id = await rpc<string>('copy_central_template', { p_kind: 'maturity_framework', p_id: centralId, p_org: orgId });
  await update<MaturityFramework>('maturity_frameworks', id, { program_id: programId });
  return id;
}

export async function createCohort(orgId: string, programId: string, v: { name: string; capacity: number | null; start_date: string | null; end_date: string | null }): Promise<ProgramCohort> {
  return insert<ProgramCohort>('program_cohorts', { organization_id: orgId, program_id: programId, status: 'planned', ...v });
}
