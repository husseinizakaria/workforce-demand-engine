-- =============================================================================
-- TANMIA — Database health check
-- Run in the Supabase SQL editor (or psql) after applying migrations.
-- Prints a PASS/FAIL table and raises an exception if any critical check fails.
-- =============================================================================
create temporary table if not exists _tanmia_health (check_name text, status text, detail text) on commit preserve rows;
truncate _tanmia_health;

do $$
declare
  t text; n int; missing text[]; expected_tables text[] := array[
    'organizations','platform_users','profiles','organization_members','permissions','roles','role_permissions','user_roles',
    'organization_modules','entity_counters','audit_log','beneficiaries','experts','expert_availability','vendors','partners',
    'user_invitations','invitation_roles','program_track_templates','programs','program_stages','program_cohorts',
    'program_applications','program_enrollments','program_teams','program_team_members','program_projects','expert_assignments',
    'vendor_assignments','program_milestones','program_stage_records','certificates','sessions','session_participants',
    'program_actions','notification_rules','notifications','calendar_feed_tokens','assessment_tools','assessment_dimensions',
    'assessment_questions','external_assessment_imports','assessment_results','form_templates','form_submissions',
    'maturity_frameworks','maturity_assessments','impact_frameworks','indicators','indicator_measurements','program_outputs',
    'program_outcomes','documents','evidence','program_budgets','contracts','risks_issues','approval_requests','data_stewards',
    'reports','report_versions','ai_insights','system_settings','integration_settings'];
  expected_functions text[] := array['is_platform_super_admin','is_org_member','has_permission','module_enabled','tenant_can',
    'my_access','next_entity_code','tg_tenant_guard','tg_audit','transition_program_stage','decide_approval','check_session_conflicts',
    'score_assessment_result','score_maturity_assessment','copy_central_template','org_dashboard','promote_platform_super_admin'];
begin
  select array_agg(x) into missing from unnest(expected_tables) x where to_regclass('public.' || x) is null;
  insert into _tanmia_health values ('tables_present', case when missing is null then 'PASS' else 'FAIL' end, coalesce(array_to_string(missing, ', '), array_length(expected_tables,1) || ' tables'));

  select array_agg(x) into missing from unnest(expected_functions) x where not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = x);
  insert into _tanmia_health values ('functions_present', case when missing is null then 'PASS' else 'FAIL' end, coalesce(array_to_string(missing, ', '), 'all present'));

  select array_agg(c.relname) into missing from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  insert into _tanmia_health values ('rls_enabled_everywhere', case when missing is null then 'PASS' else 'FAIL' end, coalesce(array_to_string(missing, ', '), 'all public tables'));

  select array_agg(c.relname) into missing from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
     and c.relname not in ('entity_counters');
  insert into _tanmia_health values ('policies_defined', case when missing is null then 'PASS' else 'FAIL' end, coalesce(array_to_string(missing, ', '), 'every RLS table has policies'));

  select array_agg(c.relname) into missing from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r' and has_table_privilege('anon', c.oid, 'select');
  insert into _tanmia_health values ('anon_has_no_table_access', case when missing is null then 'PASS' else 'FAIL' end, coalesce(array_to_string(missing, ', '), 'anon revoked'));

  select array_agg(x) into missing from unnest(array['evidence','documents','imports']) x where not exists (select 1 from storage.buckets b where b.id = x and not b.public);
  insert into _tanmia_health values ('private_storage_buckets', case when missing is null then 'PASS' else 'FAIL' end, coalesce(array_to_string(missing, ', '), 'evidence, documents, imports'));

  select count(*) into n from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'tanmia_storage_%';
  insert into _tanmia_health values ('storage_policies', case when n >= 5 then 'PASS' else 'FAIL' end, n || ' policies');

  select count(*) into n from public.program_track_templates where active and code in ('hackathon','incubator','vocational','consulting','bootcamp','graduate');
  insert into _tanmia_health values ('six_program_tracks', case when n = 6 then 'PASS' else 'FAIL' end, n || ' tracks');

  select count(*) into n from public.permissions;
  insert into _tanmia_health values ('permission_catalog', case when n >= 135 then 'PASS' else 'FAIL' end, n || ' permissions');

  select count(*) into n from public.roles where organization_id is null and is_system;
  insert into _tanmia_health values ('role_templates', case when n >= 10 then 'PASS' else 'FAIL' end, n || ' platform role templates');

  select count(*) into n from public.platform_users where is_platform_super_admin and active;
  insert into _tanmia_health values ('platform_owner_configured', case when n >= 1 then 'PASS' else 'WARN' end,
    case when n >= 1 then n || ' super admin(s)' else 'run: select public.promote_platform_super_admin(''owner@example.com'');' end);

  select array_agg(distinct c.relname) into missing
    from pg_class c join pg_namespace s on s.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped
   where s.nspname = 'public' and c.relkind = 'r' and c.relname not in ('organization_members','user_roles','organization_modules','entity_counters','audit_log')
     and not exists (select 1 from pg_trigger tg where tg.tgrelid = c.oid and tg.tgname = 't10_tenant');
  insert into _tanmia_health values ('tenant_guard_triggers', case when missing is null then 'PASS' else 'FAIL' end, coalesce(array_to_string(missing, ', '), 'all tenant tables guarded'));

  select count(*) into n from pg_trigger where tgname = 't95_audit';
  insert into _tanmia_health values ('audit_triggers', case when n >= 40 then 'PASS' else 'FAIL' end, n || ' audited tables');
end $$;

select check_name, status, detail from _tanmia_health order by status desc, check_name;

do $$ begin
  if exists (select 1 from _tanmia_health where status = 'FAIL') then
    raise exception 'TANMIA health check failed: %', (select string_agg(check_name, ', ') from _tanmia_health where status = 'FAIL');
  end if;
end $$;
