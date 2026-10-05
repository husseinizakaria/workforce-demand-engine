// Server-side equivalent of src/services/programBundle.ts. Runs with the
// service role AFTER the caller was authorized, so every query is explicitly
// filtered by organization_id (and program_id) — never rely on RLS here.
import type {
  ApplicationLike, AssignmentLike, AvailabilityLike, BeneficiaryLike, BudgetLike, CohortLike, EnrollmentLike, EvidenceLike, ExpertLike,
  ImpactFrameworkLike, IndicatorLike, MaturityAssessmentLike, MaturityFrameworkLike, MeasurementLike, OutcomeLike, OutputLike,
  ParticipantLike, ProgramBundle, ProgramLike, RiskLike, ActionLike, ResultLike, SessionLike, StageLike, StageRecordLike,
} from './engine/index.ts';
import type { Db } from './auth.ts';
import { check, fail } from './http.ts';

const PAGE = 1000;
const IN_CHUNK = 150;

export type Filter = [column: string, op: 'eq' | 'in' | 'neq' | 'not_null' | 'is_null' | 'gte' | 'lte', value?: unknown];

// deno-lint-ignore no-explicit-any
function applyFilters(q: any, filters: Filter[]): any {
  for (const [col, op, val] of filters) {
    if (op === 'eq') q = q.eq(col, val);
    else if (op === 'neq') q = q.neq(col, val);
    else if (op === 'in') q = q.in(col, val as unknown[]);
    else if (op === 'gte') q = q.gte(col, val);
    else if (op === 'lte') q = q.lte(col, val);
    else if (op === 'not_null') q = q.not(col, 'is', null);
    else if (op === 'is_null') q = q.is(col, null);
  }
  return q;
}

export interface FetchOpts { columns?: string; order?: string; ascending?: boolean; max?: number; key?: string[] }

/**
 * Reads every matching row (pages through PostgREST's row limit).
 * `key` = unique column(s) used as a stable tie-breaker (default ['id']; pass
 * e.g. ['organization_id','user_id'] for tables without an id column).
 */
export async function fetchAll<T>(admin: Db, table: string, filters: Filter[], opts: FetchOpts = {}): Promise<T[]> {
  const out: T[] = [];
  const max = opts.max ?? 100_000;
  const key = opts.key ?? ['id'];
  for (let from = 0; from < max; from += PAGE) {
    let q = applyFilters(admin.from(table).select(opts.columns ?? '*'), filters);
    if (opts.order) q = q.order(opts.order, { ascending: opts.ascending ?? true });
    for (const k of key) if (k !== opts.order) q = q.order(k, { ascending: true });
    const rows = check(await q.range(from, Math.min(from + PAGE, max) - 1), table) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** fetchAll with an `in` filter split into URL-safe chunks. */
export async function fetchIn<T>(admin: Db, table: string, column: string, values: string[], filters: Filter[], opts: FetchOpts = {}): Promise<T[]> {
  const uniq = [...new Set(values.filter(Boolean))];
  const out: T[] = [];
  for (let i = 0; i < uniq.length; i += IN_CHUNK) {
    out.push(...await fetchAll<T>(admin, table, [...filters, [column, 'in', uniq.slice(i, i + IN_CHUNK)]], opts));
  }
  return out;
}

export interface ServerProgramBundle extends ProgramBundle {
  program: ProgramLike & { name_en?: string | null; manager_user_id?: string | null; description?: string | null; objectives?: string | null };
  availability: AvailabilityLike[];
}

/**
 * Loads everything the analysis engine needs for one program of one organization.
 * 404 when the program does not belong to the organization.
 */
export async function loadProgramBundle(admin: Db, orgId: string, programId: string): Promise<ServerProgramBundle> {
  const program = check(await admin.from('programs').select('*').eq('id', programId).eq('organization_id', orgId).maybeSingle(), 'programs');
  if (!program) fail('not_found', { detail: { entity: 'program' } });

  const scope: Filter[] = [['organization_id', 'eq', orgId], ['program_id', 'eq', programId]];
  const [stages, cohorts, enrollments, applications, sessions, assignments, indicators, measurements, evidence, outputs, outcomes,
    budgets, risks, actions, frameworks, maturity, results, stageRecords, approvals, impactFrameworks] = await Promise.all([
    fetchAll<StageLike>(admin, 'program_stages', scope, { order: 'stage_order' }),
    fetchAll<CohortLike>(admin, 'program_cohorts', scope),
    fetchAll<EnrollmentLike>(admin, 'program_enrollments', scope, { order: 'enrolled_at' }),
    fetchAll<ApplicationLike>(admin, 'program_applications', scope, { order: 'applied_at' }),
    fetchAll<SessionLike>(admin, 'sessions', scope, { order: 'starts_at' }),
    fetchAll<AssignmentLike>(admin, 'expert_assignments', scope),
    fetchAll<IndicatorLike>(admin, 'indicators', scope),
    fetchAll<MeasurementLike>(admin, 'indicator_measurements', scope, { order: 'measured_at' }),
    fetchAll<EvidenceLike>(admin, 'evidence', scope),
    fetchAll<OutputLike>(admin, 'program_outputs', scope),
    fetchAll<OutcomeLike>(admin, 'program_outcomes', scope),
    fetchAll<BudgetLike>(admin, 'program_budgets', scope),
    fetchAll<RiskLike>(admin, 'risks_issues', scope),
    fetchAll<ActionLike>(admin, 'program_actions', scope),
    fetchAll<MaturityFrameworkLike>(admin, 'maturity_frameworks', scope),
    fetchAll<MaturityAssessmentLike>(admin, 'maturity_assessments', scope),
    fetchAll<ResultLike>(admin, 'assessment_results', scope),
    fetchAll<StageRecordLike>(admin, 'program_stage_records', scope),
    fetchAll<{ id: string; entity_type: string; entity_id: string | null; created_at: string }>(admin, 'approval_requests', [...scope, ['status', 'eq', 'pending']],
      { columns: 'id, entity_type, entity_id, created_at' }),
    fetchAll<ImpactFrameworkLike>(admin, 'impact_frameworks', scope),
  ]);

  const sessionIds = sessions.map((s) => s.id);
  const participants = sessionIds.length
    ? await fetchIn<ParticipantLike>(admin, 'session_participants', 'session_id', sessionIds, [['organization_id', 'eq', orgId]])
    : [];
  const benIds = [...enrollments.map((e) => e.beneficiary_id), ...applications.map((a) => a.beneficiary_id)];
  const beneficiaries = benIds.length
    ? await fetchIn<BeneficiaryLike>(admin, 'beneficiaries', 'id', benIds, [['organization_id', 'eq', orgId]])
    : [];
  beneficiaries.sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar'));
  const expertIds = [...assignments.map((a) => a.expert_id), ...sessions.map((s) => s.expert_id).filter((x): x is string => !!x)];
  const [experts, availability] = expertIds.length
    ? await Promise.all([
      fetchIn<ExpertLike>(admin, 'experts', 'id', expertIds, [['organization_id', 'eq', orgId]]),
      fetchIn<AvailabilityLike>(admin, 'expert_availability', 'expert_id', expertIds, [['organization_id', 'eq', orgId]]),
    ])
    : [[], []];
  experts.sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar'));

  let sponsorName: string | null = null;
  if (program.sponsor_partner_id) {
    const sp = check(await admin.from('partners').select('name').eq('id', program.sponsor_partner_id).eq('organization_id', orgId).maybeSingle(), 'partners');
    sponsorName = sp?.name ?? null;
  }

  return {
    program, stages, cohorts, enrollments, applications, beneficiaries, sessions, participants, experts, assignments, indicators, measurements,
    evidence, outputs, outcomes, budgets, risks, actions, impactFramework: impactFrameworks[0] ?? null, maturityFrameworks: frameworks,
    maturityAssessments: maturity, results, stageRecords, approvalsPending: approvals, sponsorName, availability,
  };
}
