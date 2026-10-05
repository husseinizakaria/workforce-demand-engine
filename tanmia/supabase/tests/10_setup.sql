-- Test harness: users, helper assertions, two organizations.
create schema if not exists tests;
grant usage on schema tests to authenticated;

create or replace function tests.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok - %', msg;
end $$;

create or replace function tests.throws(stmt text, msg text, state text default null) returns void language plpgsql as $$
declare got text;
begin
  begin
    execute stmt;
  exception when others then
    got := sqlstate;
    if state is not null and got <> state then raise exception 'FAIL: % (expected SQLSTATE %, got %: %)', msg, state, got, sqlerrm; end if;
    raise notice 'ok - % [%]', msg, got;
    return;
  end;
  raise exception 'FAIL: % (statement succeeded but should have failed)', msg;
end $$;

create or replace function tests.rows(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin execute 'select count(*) from (' || stmt || ') x' into n; return n; end $$;

create or replace function tests.login(p_email text) returns void language plpgsql security definer as $$
declare uid uuid;
begin
  select id into uid from auth.users where email = p_email;
  if uid is null then raise exception 'no test user %', p_email; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false);
end $$;

create or replace function tests.uid(p_email text) returns uuid language sql security definer as $$
  select id from auth.users where email = p_email;
$$;
grant execute on all functions in schema tests to authenticated;

insert into auth.users (email, raw_user_meta_data) values
  ('owner@tanmia.test', '{"full_name":"Platform Owner"}'), ('admin.a@tanmia.test', '{"full_name":"Admin A"}'),
  ('admin.b@tanmia.test', '{"full_name":"Admin B"}'), ('viewer.a@tanmia.test', '{}'), ('coord.a@tanmia.test', '{}'),
  ('quality.a@tanmia.test', '{}'), ('expert.a@tanmia.test', '{}'), ('ben.a@tanmia.test', '{}'), ('outsider@tanmia.test', '{}');

select public.promote_platform_super_admin('owner@tanmia.test');
select tests.ok((select count(*) from public.profiles) = 9, 'profiles auto-created for every auth user');

-- Owner creates two organizations through the API role (RLS applies)
select tests.login('owner@tanmia.test');
set role authenticated;
select tests.ok((public.my_access()->>'is_platform_super_admin')::boolean, 'owner is platform super admin');
select tests.ok(jsonb_array_length(public.my_access()->'memberships') = 0, 'owner needs no membership');
insert into public.organizations (name, name_en) values ('مؤسسة أ', 'Org A'), ('مؤسسة ب', 'Org B');
reset role;

select tests.ok((select count(*) from public.roles r join public.organizations o on o.id = r.organization_id where o.name_en = 'Org A') = 10, 'org A received the 10 standard roles');
select tests.ok((select count(*) from public.organization_modules m join public.organizations o on o.id = m.organization_id where o.name_en = 'Org B') = 14, 'org B modules initialised');
select tests.ok((select code from public.organizations where name_en = 'Org A') ~ '^ORG-\d{4}$', 'organization code generated');

-- Memberships and roles (as owner)
select tests.login('owner@tanmia.test');
set role authenticated;
insert into public.organization_members (organization_id, user_id)
select o.id, tests.uid(e) from public.organizations o, unnest(array['admin.a@tanmia.test','viewer.a@tanmia.test','coord.a@tanmia.test','quality.a@tanmia.test','expert.a@tanmia.test','ben.a@tanmia.test']) e
where o.name_en = 'Org A';
insert into public.organization_members (organization_id, user_id)
select o.id, tests.uid('admin.b@tanmia.test') from public.organizations o where o.name_en = 'Org B';
insert into public.user_roles (organization_id, user_id, role_id)
select o.id, tests.uid(x.email), r.id from (values
  ('Org A','admin.a@tanmia.test','org_admin'), ('Org A','viewer.a@tanmia.test','viewer'), ('Org A','coord.a@tanmia.test','program_coordinator'),
  ('Org A','quality.a@tanmia.test','quality_officer'), ('Org A','quality.a@tanmia.test','impact_officer'),
  ('Org A','expert.a@tanmia.test','expert'), ('Org A','ben.a@tanmia.test','beneficiary'), ('Org B','admin.b@tanmia.test','org_admin')) x(org, email, role)
join public.organizations o on o.name_en = x.org join public.roles r on r.organization_id = o.id and r.code = x.role;
reset role;
select tests.ok((select count(*) from public.user_roles) = 8, 'role assignments created (multi-role user included)');
