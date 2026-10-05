// expert-matching — experts.view on the organization.
// Explainable ranking (engine matchExperts) over the organization's experts,
// their current assignments and availability. When a program is given, its
// sponsor's name is added to the conflict-of-interest terms automatically.
import { serve, readJson, check } from '../_shared/http.ts';
import { getCaller, requireOrgRow, requirePermission } from '../_shared/auth.ts';
import { array, enumOf, int, number, object, optional, parse, string, uuid, withDefault } from '../_shared/validate.ts';
import { fetchAll } from '../_shared/bundle.ts';
import { type AssignmentLike, type AvailabilityLike, type ExpertLike, type MatchRequirements, matchExperts } from '../_shared/engine/index.ts';

const Requirements = object({
  role: optional(enumOf(['trainer', 'mentor', 'consultant', 'coach', 'assessor', 'judge'] as const)),
  expertise: optional(array(string({ min: 1, max: 120 }), { max: 30 })),
  sector: optional(string({ max: 120 })),
  language: optional(string({ max: 20 })),
  city: optional(string({ max: 120 })),
  delivery_mode: optional(enumOf(['onsite', 'online', 'hybrid'] as const)),
  needed_hours: optional(number({ min: 0, max: 2000 })),
  conflict_terms: optional(array(string({ min: 1, max: 200 }), { max: 50 })),
  exclude_expert_ids: optional(array(uuid(), { max: 500 })),
});
const Body = object({
  organization_id: uuid(),
  program_id: optional(uuid()),
  requirements: withDefault(Requirements, {} as ReturnType<typeof Requirements>),
  limit: withDefault(int({ min: 1, max: 100 }), 20),
});

serve(async (req) => {
  const caller = await getCaller(req);
  const b = parse(Body, await readJson(req));
  await requirePermission(caller, b.organization_id, 'experts.view');
  const admin = caller.admin;
  const org = b.organization_id;

  const conflictTerms = [...(b.requirements.conflict_terms ?? [])];
  if (b.program_id) {
    const program = await requireOrgRow<{ sponsor_partner_id: string | null }>(admin, 'programs', b.program_id, org, 'id, sponsor_partner_id');
    if (program.sponsor_partner_id) {
      const sponsor = check(await admin.from('partners').select('name').eq('id', program.sponsor_partner_id).eq('organization_id', org).maybeSingle(), 'partners') as
        { name: string } | null;
      if (sponsor?.name && !conflictTerms.includes(sponsor.name)) conflictTerms.push(sponsor.name);
    }
  }

  const [experts, assignments, availability] = await Promise.all([
    fetchAll<ExpertLike>(admin, 'experts', [['organization_id', 'eq', org], ['status', 'neq', 'blocked']],
      { columns: 'id, code, full_name, roles, expertise, sectors, languages, city, delivery_modes, rating, max_weekly_hours, conflicts, status' }),
    fetchAll<AssignmentLike>(admin, 'expert_assignments', [['organization_id', 'eq', org], ['status', 'in', ['proposed', 'confirmed', 'active']]],
      { columns: 'id, expert_id, program_id, role, status, planned_hours, delivered_hours, performance_rating, beneficiary_id, team_id' }),
    fetchAll<AvailabilityLike>(admin, 'expert_availability', [['organization_id', 'eq', org]],
      { columns: 'id, expert_id, kind, weekday, start_time, end_time, starts_at, ends_at' }),
  ]);

  const req_: MatchRequirements = { ...b.requirements, conflict_terms: conflictTerms };
  const results = matchExperts(experts, req_, { assignments, availability }).slice(0, b.limit);
  return { results, conflict_terms: conflictTerms };
});
