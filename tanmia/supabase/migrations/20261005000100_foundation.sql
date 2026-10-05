-- =============================================================================
-- TANMIA — 0100 Foundation: tenancy, identity, RBAC, codes, audit, guards
-- Canonical schema. Apply migrations in filename order on a fresh project.
-- =============================================================================
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Utility triggers
-- -----------------------------------------------------------------------------
create or replace function public.tg_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Organizations
-- -----------------------------------------------------------------------------
create sequence if not exists public.organization_code_seq;

create table public.organizations (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  name           text not null,
  name_en        text,
  org_type       text,
  sector         text,
  city           text,
  country        text not null default 'SA',
  timezone       text not null default 'Asia/Riyadh',
  default_locale text not null default 'ar' check (default_locale in ('ar','en')),
  status         text not null default 'active' check (status in ('active','suspended','archived')),
  contact_email  text,
  settings       jsonb not null default '{}'::jsonb,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create or replace function public.tg_organization_code()
returns trigger language plpgsql as $$
begin
  if new.code is null or btrim(new.code) = '' then
    new.code := 'ORG-' || lpad(nextval('public.organization_code_seq')::text, 4, '0');
  end if;
  return new;
end $$;
create trigger t05_org_code before insert on public.organizations
  for each row execute function public.tg_organization_code();
create trigger t90_touch before update on public.organizations
  for each row execute function public.tg_touch_updated_at();

-- -----------------------------------------------------------------------------
-- Identity: platform users and profiles
-- -----------------------------------------------------------------------------
create table public.platform_users (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  is_platform_super_admin boolean not null default false,
  active                  boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create trigger t90_touch before update on public.platform_users
  for each row execute function public.tg_touch_updated_at();

create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  full_name        text,
  email            text,
  phone            text,
  job_title        text,
  preferred_locale text not null default 'ar' check (preferred_locale in ('ar','en')),
  status           text not null default 'active' check (status in ('active','inactive','invited')),
  last_login_at    timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger t90_touch before update on public.profiles
  for each row execute function public.tg_touch_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, status)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), lower(new.email), 'active')
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- Membership and RBAC
-- -----------------------------------------------------------------------------
create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  active          boolean not null default true,
  title           text,
  invited_by      uuid references auth.users(id) on delete set null,
  joined_at       timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index idx_members_user on public.organization_members(user_id);

create table public.permissions (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  module     text not null,
  action     text not null,
  name_ar    text not null,
  name_en    text not null,
  created_at timestamptz not null default now()
);

-- organization_id NULL = platform role template, copied into every new organization.
create table public.roles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  code            text not null,
  name_ar         text not null,
  name_en         text not null,
  description     text,
  is_system       boolean not null default false,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique nulls not distinct (organization_id, code)
);

create table public.role_permissions (
  role_id       uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table public.user_roles (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role_id         uuid not null references public.roles(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (organization_id, user_id, role_id)
);
create index idx_user_roles_user on public.user_roles(user_id, organization_id);

-- Module activation per organization. Absent row = enabled.
create table public.organization_modules (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_key      text not null check (module_key in (
    'programs','beneficiaries','experts','vendors','partners','operations','assessments',
    'evidence','outcomes','impact','templates','reports','governance','notifications')),
  enabled         boolean not null default true,
  updated_by      uuid references auth.users(id) on delete set null,
  updated_at      timestamptz not null default now(),
  primary key (organization_id, module_key)
);

-- -----------------------------------------------------------------------------
-- Authorization helpers (SECURITY DEFINER, used by RLS and Edge Functions)
-- -----------------------------------------------------------------------------
create or replace function public.is_platform_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.platform_users p
    where p.user_id = auth.uid() and p.is_platform_super_admin and p.active
  );
$$;

create or replace function public.is_org_member(org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_super_admin() or exists (
    select 1 from public.organization_members m
    join public.organizations o on o.id = m.organization_id and o.status = 'active'
    where m.organization_id = org and m.user_id = auth.uid() and m.active
  );
$$;

create or replace function public.has_permission(org uuid, permission_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_super_admin() or exists (
    select 1
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id and o.status = 'active'
    join public.user_roles ur on ur.organization_id = m.organization_id and ur.user_id = m.user_id
    join public.roles r on r.id = ur.role_id and r.active
    join public.role_permissions rp on rp.role_id = r.id
    join public.permissions p on p.id = rp.permission_id
    where m.organization_id = org and m.user_id = auth.uid() and m.active and p.code = permission_code
  );
$$;

create or replace function public.module_enabled(org uuid, module text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.organization_modules om
    where om.organization_id = org and om.module_key = module and not om.enabled
  );
$$;

-- The single authorization predicate used by tenant RLS policies.
create or replace function public.tenant_can(org uuid, module text, action text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when org is null then false
    when public.is_platform_super_admin() then true
    else public.module_enabled(org, module) and public.has_permission(org, module || '.' || action)
  end;
$$;

-- -----------------------------------------------------------------------------
-- Human-readable codes, per organization: PRG-2026-0001
-- -----------------------------------------------------------------------------
create table public.entity_counters (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  prefix          text not null,
  period          int  not null,
  last_value      int  not null default 0,
  primary key (organization_id, prefix, period)
);

create or replace function public.next_entity_code(org uuid, code_prefix text)
returns text language plpgsql security definer set search_path = public as $$
declare
  yr int := extract(year from now() at time zone 'Asia/Riyadh')::int;
  v  int;
begin
  insert into public.entity_counters (organization_id, prefix, period, last_value)
  values (org, code_prefix, yr, 1)
  on conflict (organization_id, prefix, period)
  do update set last_value = public.entity_counters.last_value + 1
  returning last_value into v;
  return code_prefix || '-' || yr || '-' || lpad(v::text, 4, '0');
end $$;
revoke all on function public.next_entity_code(uuid, text) from public;

create or replace function public.tg_assign_code()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.code is null or btrim(new.code) = '') and new.organization_id is not null then
    new.code := public.next_entity_code(new.organization_id, tg_argv[0]);
  elsif (new.code is null or btrim(new.code) = '') then
    new.code := tg_argv[0] || '-C-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Tenant guard: fills organization_id from program_id, makes it immutable and
-- rejects references to records owned by another organization.
-- TG_ARGV[0] = 'central_ok' allows organization_id NULL (platform templates),
-- but only for platform super admins / service role.
-- -----------------------------------------------------------------------------
create or replace function public.tg_tenant_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  j       jsonb := to_jsonb(new);
  ref     record;
  ref_org uuid;
  ref_id  uuid;
  rc      int;
  central boolean := coalesce(tg_argv[0], '') = 'central_ok';
begin
  if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id cannot be changed' using errcode = '42501';
  end if;

  if new.organization_id is null and (j->>'program_id') is not null then
    select p.organization_id into new.organization_id from public.programs p where p.id = (j->>'program_id')::uuid;
  end if;

  if new.organization_id is null then
    if not central then
      raise exception 'organization_id is required' using errcode = '23502';
    end if;
    if auth.uid() is not null and not public.is_platform_super_admin() then
      raise exception 'Only platform administrators can manage central templates' using errcode = '42501';
    end if;
  end if;

  for ref in
    select * from (values
      ('program_id','programs'), ('cohort_id','program_cohorts'), ('beneficiary_id','beneficiaries'),
      ('expert_id','experts'), ('vendor_id','vendors'), ('partner_id','partners'),
      ('session_id','sessions'), ('team_id','program_teams'), ('tool_id','assessment_tools'),
      ('dimension_id','assessment_dimensions'), ('framework_id','maturity_frameworks'),
      ('impact_framework_id','impact_frameworks'), ('indicator_id','indicators'),
      ('template_id','form_templates'), ('report_id','reports'), ('contract_id','contracts'),
      ('evidence_id','evidence'), ('milestone_id','program_milestones'), ('output_id','program_outputs'),
      ('outcome_id','program_outcomes'), ('assessment_result_id','assessment_results'),
      ('role_id','roles'), ('stage_id','program_stages'), ('sponsor_partner_id','partners'),
      ('import_id','external_assessment_imports'), ('document_id','documents'),
      ('link_beneficiary_id','beneficiaries'), ('link_expert_id','experts')
    ) v(col, tbl)
  loop
    if j ? ref.col and (j->>ref.col) is not null then
      ref_id := (j->>ref.col)::uuid;
      if to_regclass('public.' || ref.tbl) is null then
        continue;
      end if;
      execute format('select organization_id from public.%I where id = $1', ref.tbl) into ref_org using ref_id;
      get diagnostics rc = row_count;
      if rc = 0 then
        raise exception 'Referenced record not found (%)', ref.col using errcode = '23503';
      end if;
      if ref_org is distinct from new.organization_id then
        raise exception 'Cross-organization reference rejected (%)', ref.col using errcode = '42501';
      end if;
    end if;
  end loop;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Audit log (written only by triggers / SECURITY DEFINER functions / Edge Functions)
-- -----------------------------------------------------------------------------
create table public.audit_log (
  id              bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete set null,
  actor_user_id   uuid references auth.users(id) on delete set null,
  scope           text not null default 'organization' check (scope in ('platform','organization')),
  action          text not null,
  entity_type     text,
  entity_id       text,
  summary         text,
  old_data        jsonb,
  new_data        jsonb,
  source          text not null default 'database' check (source in ('database','edge_function','rpc')),
  created_at      timestamptz not null default now()
);
create index idx_audit_org_time on public.audit_log(organization_id, created_at desc);
create index idx_audit_time on public.audit_log(created_at desc);

create or replace function public.write_audit(
  p_org uuid, p_action text, p_entity_type text, p_entity_id text,
  p_summary text default null, p_new jsonb default null, p_scope text default 'organization')
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (organization_id, actor_user_id, scope, action, entity_type, entity_id, summary, new_data, source)
  values (p_org, auth.uid(), p_scope, p_action, p_entity_type, p_entity_id, p_summary, p_new, 'rpc');
end $$;
revoke all on function public.write_audit(uuid, text, text, text, text, jsonb, text) from public;

create or replace function public.tg_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb; n jsonb; changed_old jsonb := '{}'::jsonb; changed_new jsonb := '{}'::jsonb;
  k text; org uuid; eid text;
begin
  if tg_op in ('UPDATE','DELETE') then o := to_jsonb(old); end if;
  if tg_op in ('INSERT','UPDATE') then n := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k <> 'updated_at' and (o->k) is distinct from (n->k) then
        changed_old := changed_old || jsonb_build_object(k, o->k);
        changed_new := changed_new || jsonb_build_object(k, n->k);
      end if;
    end loop;
    if changed_new = '{}'::jsonb then return null; end if;
    o := changed_old; n := changed_new;
  end if;
  org := coalesce((coalesce(to_jsonb(new), to_jsonb(old))->>'organization_id')::uuid,
                  case when tg_table_name = 'organizations' then (coalesce(to_jsonb(new), to_jsonb(old))->>'id')::uuid end);
  eid := coalesce(coalesce(to_jsonb(new), to_jsonb(old))->>'id', coalesce(to_jsonb(new), to_jsonb(old))->>'user_id');
  insert into public.audit_log (organization_id, actor_user_id, scope, action, entity_type, entity_id, old_data, new_data, source)
  values (case when tg_table_name = 'platform_users' then null else org end,
          auth.uid(),
          case when tg_table_name in ('platform_users','permissions') or org is null then 'platform' else 'organization' end,
          lower(tg_op), tg_table_name, eid, o, n, 'database');
  return null;
end $$;

-- -----------------------------------------------------------------------------
-- Organization defaults: copy platform role templates, enable modules
-- -----------------------------------------------------------------------------
create or replace function public.seed_organization_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.roles (organization_id, code, name_ar, name_en, description, is_system)
  select new.id, r.code, r.name_ar, r.name_en, r.description, true
  from public.roles r where r.organization_id is null and r.active
  on conflict do nothing;

  insert into public.role_permissions (role_id, permission_id)
  select orgr.id, rp.permission_id
  from public.roles tpl
  join public.role_permissions rp on rp.role_id = tpl.id
  join public.roles orgr on orgr.organization_id = new.id and orgr.code = tpl.code
  where tpl.organization_id is null
  on conflict do nothing;

  insert into public.organization_modules (organization_id, module_key, enabled)
  select new.id, m, true from unnest(array['programs','beneficiaries','experts','vendors','partners','operations',
    'assessments','evidence','outcomes','impact','templates','reports','governance','notifications']) m
  on conflict do nothing;
  return new;
end $$;
create trigger t50_seed_defaults after insert on public.organizations
  for each row execute function public.seed_organization_defaults();

-- -----------------------------------------------------------------------------
-- Access context for the signed-in user (drives post-login routing)
-- -----------------------------------------------------------------------------
create or replace function public.my_access()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'is_platform_super_admin', public.is_platform_super_admin(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'organization', jsonb_build_object('id', o.id, 'code', o.code, 'name', o.name, 'name_en', o.name_en,
                                           'status', o.status, 'default_locale', o.default_locale, 'timezone', o.timezone),
        'active', m.active and o.status = 'active',
        'member_active', m.active,
        'roles', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'name_ar', r.name_ar, 'name_en', r.name_en))
                           from public.user_roles ur join public.roles r on r.id = ur.role_id and r.active
                           where ur.organization_id = o.id and ur.user_id = m.user_id), '[]'::jsonb),
        'permissions', coalesce((select jsonb_agg(distinct p.code)
                           from public.user_roles ur
                           join public.roles r on r.id = ur.role_id and r.active
                           join public.role_permissions rp on rp.role_id = r.id
                           join public.permissions p on p.id = rp.permission_id
                           where ur.organization_id = o.id and ur.user_id = m.user_id), '[]'::jsonb),
        'modules', coalesce((select jsonb_object_agg(om.module_key, om.enabled)
                           from public.organization_modules om where om.organization_id = o.id), '{}'::jsonb)
      ) order by o.name)
      from public.organization_members m
      join public.organizations o on o.id = m.organization_id
      where m.user_id = auth.uid()
    ), '[]'::jsonb)
  );
$$;

create or replace function public.touch_last_login()
returns void language sql security definer set search_path = public as $$
  update public.profiles set last_login_at = now() where id = auth.uid();
$$;

-- Run once from the SQL editor (as postgres) to designate the first platform owner.
create or replace function public.promote_platform_super_admin(target_email text)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(btrim(target_email));
  if uid is null then raise exception 'No auth user with email %', target_email; end if;
  insert into public.platform_users (user_id, is_platform_super_admin, active) values (uid, true, true)
  on conflict (user_id) do update set is_platform_super_admin = true, active = true;
  insert into public.audit_log (actor_user_id, scope, action, entity_type, entity_id, summary, source)
  values (null, 'platform', 'promote_super_admin', 'platform_users', uid::text, target_email, 'rpc');
  return uid;
end $$;
revoke all on function public.promote_platform_super_admin(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Triggers on foundation tables
-- -----------------------------------------------------------------------------
create trigger t95_audit after insert or update or delete on public.organizations
  for each row execute function public.tg_audit();
create trigger t95_audit after insert or update or delete on public.platform_users
  for each row execute function public.tg_audit();
create trigger t95_audit after insert or update or delete on public.organization_members
  for each row execute function public.tg_audit();
create trigger t95_audit after insert or update or delete on public.user_roles
  for each row execute function public.tg_audit();
create trigger t10_tenant before insert or update on public.roles
  for each row execute function public.tg_tenant_guard('central_ok');
create trigger t95_audit after insert or update or delete on public.roles
  for each row execute function public.tg_audit();
create trigger t10_tenant before insert or update on public.user_roles
  for each row execute function public.tg_tenant_guard();
create trigger t95_audit after insert or update or delete on public.organization_modules
  for each row execute function public.tg_audit();
