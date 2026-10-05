-- Two-tenant isolation, RBAC, module activation, self-service, codes, audit.
select id as org_a from public.organizations where name_en = 'Org A' \gset
select id as org_b from public.organizations where name_en = 'Org B' \gset

-- ---------------------------------------------------------------- admin A creates data
select tests.login('admin.a@tanmia.test');
set role authenticated;
select tests.ok(jsonb_array_length(public.my_access()->'memberships') = 1, 'admin A has exactly one membership');
select tests.ok(not (public.my_access()->>'is_platform_super_admin')::boolean, 'admin A is not a platform admin');
select tests.ok((public.my_access()->'memberships'->0->'permissions') ? 'programs.create', 'admin A permissions aggregated');
insert into public.programs (organization_id, name, track_code, status, start_date, end_date, target_beneficiaries, budget_total)
values (:'org_a', 'Graduate Program A', 'graduate', 'active', current_date - 30, current_date + 150, 20, 100000);
insert into public.beneficiaries (organization_id, full_name, email, gender, city) values
  (:'org_a', 'مستفيد ١', 'b1@x.test', 'female', 'الرياض'), (:'org_a', 'مستفيد ٢', 'b2@x.test', 'male', 'جدة');
insert into public.experts (organization_id, full_name, roles, expertise, max_weekly_hours) values
  (:'org_a', 'خبير أ', '{mentor,assessor}', '{القيادة,التخطيط}', 10);
reset role;

select id as prg_a, code as prg_a_code from public.programs where name = 'Graduate Program A' \gset
select tests.ok(:'prg_a_code' ~ ('^PRG-' || extract(year from now())::int || '-0001$'), 'program code is per-organization sequential');
select tests.ok((select count(*) from public.program_stages where program_id = :'prg_a') = 21, 'graduate journey seeded with 21 stages');
select tests.ok((select organization_id from public.program_stages where program_id = :'prg_a' limit 1) = :'org_a'::uuid, 'stages inherit organization');
select id as ben1 from public.beneficiaries where email = 'b1@x.test' \gset
select id as ben2 from public.beneficiaries where email = 'b2@x.test' \gset
select id as exp_a from public.experts where full_name = 'خبير أ' \gset

-- ---------------------------------------------------------------- admin B: isolation
select tests.login('admin.b@tanmia.test');
set role authenticated;
insert into public.programs (organization_id, name, track_code) values (:'org_b', 'Hackathon B', 'hackathon');
insert into public.beneficiaries (organization_id, full_name) values (:'org_b', 'مستفيد ب');
select tests.ok(tests.rows('select 1 from public.programs') = 1, 'admin B sees only its own program');
select tests.ok(tests.rows(format('select 1 from public.programs where id = %L', :'prg_a')) = 0, 'admin B cannot read org A program by id');
select tests.ok(tests.rows('select 1 from public.beneficiaries') = 1, 'admin B sees only org B beneficiaries');
select tests.ok(tests.rows('select 1 from public.program_stages') = 12, 'admin B sees only its hackathon stages');
select tests.ok(tests.rows('select 1 from public.organizations') = 1, 'admin B sees only its organization');
select tests.throws(format($q$insert into public.programs (organization_id, name, track_code) values (%L, 'intrusion', 'bootcamp')$q$, :'org_a'), 'admin B cannot create a program in org A', '42501');
update public.programs set name = 'hijacked' where id = :'prg_a';
select tests.throws(format($q$insert into public.program_enrollments (organization_id, program_id, beneficiary_id) select %L, p.id, %L from public.programs p where p.name = 'Hackathon B'$q$, :'org_b', :'ben1'),
  'cross-organization reference (org A beneficiary in org B program) is rejected', '42501');
select tests.ok(tests.rows('select 1 from public.audit_log where organization_id is distinct from (select id from public.organizations limit 1)') = 0, 'admin B audit view limited to org B');
select tests.ok(tests.rows('select 1 from public.profiles where email = ''admin.a@tanmia.test''') = 0, 'admin B cannot read profiles of org A users');
reset role;
select tests.ok((select name from public.programs where id = :'prg_a') = 'Graduate Program A', 'org A program unchanged after cross-tenant update attempt');
select tests.ok((select code from public.programs where name = 'Hackathon B') ~ '-0001$', 'org B code sequence independent of org A');

-- ---------------------------------------------------------------- outsider and immutability
select tests.login('outsider@tanmia.test');
set role authenticated;
select tests.ok(jsonb_array_length(public.my_access()->'memberships') = 0, 'outsider has no memberships (controlled no-access state)');
select tests.ok(tests.rows('select 1 from public.programs union all select 1 from public.beneficiaries union all select 1 from public.organizations') = 0, 'outsider sees nothing');
select tests.throws($q$insert into public.organizations (name) values ('rogue')$q$, 'non-platform user cannot create organizations', '42501');
reset role;

select tests.login('admin.a@tanmia.test');
set role authenticated;
select tests.throws(format($q$update public.programs set organization_id = %L where id = %L$q$, :'org_b', :'prg_a'), 'organization_id is immutable', '42501');
select tests.throws(format($q$update public.organizations set status = 'suspended' where id = %L$q$, :'org_a'), 'org admin cannot change organization status', '42501');
reset role;

-- ---------------------------------------------------------------- RBAC: viewer / coordinator
select tests.login('viewer.a@tanmia.test');
set role authenticated;
select tests.ok(tests.rows('select 1 from public.programs') = 1, 'viewer can read programs');
select tests.throws(format($q$insert into public.programs (organization_id, name, track_code) values (%L, 'x', 'bootcamp')$q$, :'org_a'), 'viewer cannot create programs', '42501');
update public.programs set name = 'viewer edit' where id = :'prg_a';
select tests.ok(tests.rows('select 1 from public.audit_log') > 0, 'viewer (auditor) can read org audit log');
reset role;
select tests.ok((select name from public.programs where id = :'prg_a') = 'Graduate Program A', 'viewer update silently filtered by RLS');

select tests.login('coord.a@tanmia.test');
set role authenticated;
insert into public.beneficiaries (organization_id, full_name, email) values (:'org_a', 'مستفيد ٣', 'b3@x.test');
select tests.ok(tests.rows('select 1 from public.beneficiaries') = 3, 'coordinator creates and reads beneficiaries');
delete from public.beneficiaries where email = 'b3@x.test';
select tests.ok(tests.rows('select 1 from public.beneficiaries where email = ''b3@x.test''') = 1, 'coordinator cannot delete beneficiaries');
select tests.ok(tests.rows('select 1 from public.program_budgets') = 0 and tests.rows('select 1 from public.vendors') = 0, 'coordinator has no governance / vendor visibility');
select tests.throws(format($q$insert into public.user_roles (organization_id, user_id, role_id) select %L, auth.uid(), id from public.roles where organization_id = %L and code = 'org_admin'$q$, :'org_a', :'org_a'),
  'coordinator cannot escalate own roles', '42501');
reset role;

-- ---------------------------------------------------------------- module deactivation
select tests.login('admin.a@tanmia.test');
set role authenticated;
insert into public.indicators (organization_id, program_id, name, indicator_type, chain_level, unit, target_value, data_source)
values (:'org_a', :'prg_a', 'Job readiness', 'outcome', 'outcome', 'score', 4, 'assessment');
select tests.ok(tests.rows('select 1 from public.indicators') = 1, 'impact module visible while enabled');
update public.organization_modules set enabled = false where organization_id = :'org_a' and module_key = 'impact';
select tests.ok(tests.rows('select 1 from public.indicators') = 0, 'deactivated module data is hidden by RLS');
update public.organization_modules set enabled = true where organization_id = :'org_a' and module_key = 'impact';
select tests.ok(tests.rows('select 1 from public.indicators') = 1, 'reactivated module visible again');
reset role;

-- ---------------------------------------------------------------- self-service (beneficiary / expert)
update public.beneficiaries set user_id = tests.uid('ben.a@tanmia.test') where id = :'ben1';
update public.experts set user_id = tests.uid('expert.a@tanmia.test') where id = :'exp_a';
select tests.login('admin.a@tanmia.test');
set role authenticated;
insert into public.program_enrollments (organization_id, program_id, beneficiary_id) values (:'org_a', :'prg_a', :'ben1'), (:'org_a', :'prg_a', :'ben2');
insert into public.expert_assignments (organization_id, program_id, expert_id, beneficiary_id, role, status, planned_hours) values (:'org_a', :'prg_a', :'exp_a', :'ben1', 'mentor', 'active', 20);
insert into public.sessions (organization_id, program_id, expert_id, title, session_type, starts_at, ends_at)
values (:'org_a', :'prg_a', :'exp_a', 'Mentoring 1', 'mentoring', now() + interval '1 day', now() + interval '1 day 1 hour');
insert into public.session_participants (session_id, beneficiary_id) select id, :'ben1' from public.sessions where title = 'Mentoring 1';
insert into public.sessions (organization_id, program_id, title, session_type, starts_at, ends_at)
values (:'org_a', :'prg_a', 'Other workshop', 'workshop', now() + interval '2 day', now() + interval '2 day 2 hour');
reset role;

select tests.login('ben.a@tanmia.test');
set role authenticated;
select tests.ok(tests.rows('select 1 from public.beneficiaries') = 1, 'beneficiary sees only own profile');
select tests.ok(tests.rows('select 1 from public.program_enrollments') = 1, 'beneficiary sees only own enrollment');
select tests.ok(tests.rows('select 1 from public.programs') = 1, 'beneficiary sees enrolled program');
select tests.ok(tests.rows('select 1 from public.sessions') = 1, 'beneficiary sees only sessions they attend');
select tests.ok(tests.rows('select 1 from public.experts') = 0, 'beneficiary cannot browse experts');
reset role;

select tests.login('expert.a@tanmia.test');
set role authenticated;
select tests.ok(tests.rows('select 1 from public.sessions') = 1, 'expert sees only own sessions');
select tests.ok(tests.rows('select 1 from public.beneficiaries') = 1, 'expert sees only assigned beneficiaries');
select tests.ok(tests.rows('select 1 from public.expert_assignments') = 1, 'expert sees own assignments');
update public.session_participants set attendance_status = 'present';
update public.sessions set summary = 'Covered goals' where title = 'Mentoring 1';
update public.sessions set summary = 'tamper' where title = 'Other workshop';
reset role;
select tests.ok((select attendance_status from public.session_participants limit 1) = 'present', 'expert records attendance for own session');
select tests.ok((select summary from public.sessions where title = 'Other workshop') is null, 'expert cannot edit other sessions');

-- ---------------------------------------------------------------- super admin sees all
select tests.login('owner@tanmia.test');
set role authenticated;
select tests.ok(tests.rows('select 1 from public.programs') = 2, 'platform super admin sees programs of every organization');
select tests.ok(tests.rows('select 1 from public.audit_log where scope = ''platform''') > 0, 'platform audit visible to owner');
reset role;

-- ---------------------------------------------------------------- audit
select tests.ok((select count(*) from public.audit_log where entity_type = 'programs' and action = 'insert') = 2, 'program inserts audited');
select tests.login('admin.a@tanmia.test');
set role authenticated;
select tests.throws($q$insert into public.audit_log (action) values ('forged')$q$, 'audit log cannot be written directly', '42501');
select tests.throws($q$delete from public.audit_log$q$, 'audit log cannot be deleted', '42501');
reset role;
