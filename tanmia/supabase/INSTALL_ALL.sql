-- TANMIA — full database install (all migrations combined, in order).
-- Paste this whole file once into Supabase → SQL Editor → Run. Do not run it twice.

-- ===================== 20261005000100_foundation.sql =====================
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

-- ===================== 20261005000200_directory_programs.sql =====================
-- =============================================================================
-- TANMIA — 0200 Directory (beneficiaries, experts, vendors, partners),
-- invitations, program tracks, programs and program workspace structures
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Directory
-- -----------------------------------------------------------------------------
create table public.beneficiaries (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  code              text not null,
  user_id           uuid references auth.users(id) on delete set null,
  full_name         text not null,
  full_name_en      text,
  national_id       text,
  gender            text check (gender in ('male','female')),
  birth_date        date,
  mobile            text,
  email             text,
  city              text,
  region            text,
  education_level   text,
  specialization    text,
  employment_status text check (employment_status in ('student','unemployed','employed','self_employed','entrepreneur','other')),
  organization_name text,
  tags              text[] not null default '{}',
  consent_given     boolean not null default false,
  consent_at        timestamptz,
  status            text not null default 'active' check (status in ('active','inactive','archived')),
  notes             text,
  created_by        uuid references auth.users(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, user_id)
);
create index idx_beneficiaries_org on public.beneficiaries(organization_id, full_name);
create index idx_beneficiaries_user on public.beneficiaries(user_id);

create table public.experts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  code              text not null,
  user_id           uuid references auth.users(id) on delete set null,
  full_name         text not null,
  full_name_en      text,
  email             text,
  mobile            text,
  roles             text[] not null default '{}',   -- trainer, mentor, consultant, coach, assessor, judge
  expertise         text[] not null default '{}',
  sectors           text[] not null default '{}',
  languages         text[] not null default '{ar}',
  city              text,
  delivery_modes    text[] not null default '{onsite,online}',
  bio               text,
  qualifications    jsonb not null default '[]'::jsonb,  -- [{title, issuer, year}]
  hourly_rate       numeric(12,2),
  currency          text not null default 'SAR',
  max_weekly_hours  int check (max_weekly_hours between 0 and 80),
  rating            numeric(3,2) check (rating between 0 and 5),
  conflicts         text[] not null default '{}',       -- declared conflicts of interest (entity names/codes)
  status            text not null default 'active' check (status in ('active','inactive','blocked')),
  created_by        uuid references auth.users(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, user_id)
);
create index idx_experts_org on public.experts(organization_id, full_name);
create index idx_experts_user on public.experts(user_id);

create table public.expert_availability (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  expert_id       uuid not null references public.experts(id) on delete cascade,
  kind            text not null default 'weekly' check (kind in ('weekly','blocked')),
  weekday         smallint check (weekday between 0 and 6),
  start_time      time,
  end_time        time,
  starts_at       timestamptz,
  ends_at         timestamptz,
  note            text,
  created_at      timestamptz not null default now(),
  check ((kind = 'weekly' and weekday is not null and start_time is not null and end_time > start_time)
      or (kind = 'blocked' and starts_at is not null and ends_at > starts_at))
);
create index idx_availability_expert on public.expert_availability(expert_id);

create table public.vendors (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code            text not null,
  name            text not null,
  category        text,
  services        text[] not null default '{}',
  contact_name    text,
  email           text,
  mobile          text,
  cr_number       text,
  vat_number      text,
  city            text,
  rating          numeric(3,2) check (rating between 0 and 5),
  status          text not null default 'active' check (status in ('active','inactive','blocked')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.partners (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code            text not null,
  name            text not null,
  partner_type    text check (partner_type in ('funder','government','implementing','academic','private','nonprofit','employer','other')),
  contact_name    text,
  email           text,
  mobile          text,
  agreement_start date,
  agreement_end   date,
  status          text not null default 'active' check (status in ('prospect','active','inactive')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, code),
  check (agreement_end is null or agreement_start is null or agreement_end >= agreement_start)
);

-- -----------------------------------------------------------------------------
-- Invitations (tokens are stored hashed; the raw token is only ever returned
-- once by the send-invitation Edge Function)
-- -----------------------------------------------------------------------------
create table public.user_invitations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email           text not null,
  full_name       text,
  job_title       text,
  token_hash      text not null unique,
  status          text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  expires_at      timestamptz not null default (now() + interval '7 days'),
  link_beneficiary_id uuid references public.beneficiaries(id) on delete set null,
  link_expert_id  uuid references public.experts(id) on delete set null,
  invited_by      uuid references auth.users(id) on delete set null,
  accepted_by     uuid references auth.users(id) on delete set null,
  accepted_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index idx_invitations_org on public.user_invitations(organization_id, status);

create table public.invitation_roles (
  invitation_id uuid not null references public.user_invitations(id) on delete cascade,
  role_id       uuid not null references public.roles(id) on delete cascade,
  primary key (invitation_id, role_id)
);

-- -----------------------------------------------------------------------------
-- Program track templates (platform-level, central)
-- stages: [{key,name_ar,name_en,order,depends_on[],required_evidence[],requires_approval,record_types[],description_ar,description_en}]
-- -----------------------------------------------------------------------------
create table public.program_track_templates (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique,
  name_ar            text not null,
  name_en            text not null,
  description_ar     text,
  description_en     text,
  stages             jsonb not null default '[]'::jsonb,
  maturity_dimensions jsonb not null default '[]'::jsonb,
  default_indicators jsonb not null default '[]'::jsonb,
  report_sections    jsonb not null default '[]'::jsonb,
  session_types      text[] not null default '{}',
  version            int not null default 1,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Programs
-- -----------------------------------------------------------------------------
create table public.programs (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  code                  text not null,
  name                  text not null,
  name_en               text,
  track_code            text not null references public.program_track_templates(code),
  description           text,
  objectives            text,
  status                text not null default 'draft' check (status in ('draft','planning','active','on_hold','completed','closed','cancelled')),
  start_date            date,
  end_date              date,
  target_beneficiaries  int check (target_beneficiaries >= 0),
  budget_total          numeric(14,2) check (budget_total >= 0),
  currency              text not null default 'SAR',
  region                text,
  delivery_mode         text check (delivery_mode in ('onsite','online','hybrid')),
  manager_user_id       uuid references auth.users(id) on delete set null,
  sponsor_partner_id    uuid references public.partners(id) on delete set null,
  disabled_tabs         text[] not null default '{}',  -- program-level module deactivation
  created_by            uuid references auth.users(id) on delete set null default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (organization_id, code),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create index idx_programs_org on public.programs(organization_id, status);

-- The program's own journey: copied from the track template on creation and
-- configurable per program without altering the central template.
create table public.program_stages (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  program_id        uuid not null references public.programs(id) on delete cascade,
  stage_key         text not null,
  name_ar           text not null,
  name_en           text,
  description       text,
  stage_order       int not null,
  depends_on        text[] not null default '{}',
  status            text not null default 'not_started' check (status in ('not_started','in_progress','blocked','completed','skipped')),
  progress          int not null default 0 check (progress between 0 and 100),
  planned_start     date,
  planned_end       date,
  actual_start      date,
  actual_end        date,
  requires_approval boolean not null default false,
  approval_status   text not null default 'not_required' check (approval_status in ('not_required','not_requested','pending','approved','rejected')),
  required_evidence text[] not null default '{}',
  record_types      text[] not null default '{}',
  blocker_note      text,
  owner_user_id     uuid references auth.users(id) on delete set null,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (program_id, stage_key),
  check (planned_end is null or planned_start is null or planned_end >= planned_start)
);
create index idx_stages_program on public.program_stages(program_id, stage_order);

create table public.program_cohorts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  program_id      uuid not null references public.programs(id) on delete cascade,
  code            text not null,
  name            text not null,
  capacity        int check (capacity >= 0),
  start_date      date,
  end_date        date,
  status          text not null default 'planned' check (status in ('planned','active','completed','cancelled')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, code),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table public.program_applications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  program_id      uuid not null references public.programs(id) on delete cascade,
  cohort_id       uuid references public.program_cohorts(id) on delete set null,
  beneficiary_id  uuid not null references public.beneficiaries(id) on delete cascade,
  code            text not null,
  status          text not null default 'submitted' check (status in ('submitted','eligible','ineligible','screening','shortlisted','accepted','rejected','waitlisted','withdrawn')),
  eligibility_notes text,
  screening_score numeric(6,2),
  decision_note   text,
  answers         jsonb not null default '{}'::jsonb,
  applied_at      timestamptz not null default now(),
  decided_at      timestamptz,
  decided_by      uuid references auth.users(id) on delete set null,
  updated_at      timestamptz not null default now(),
  unique (organization_id, code),
  unique (program_id, beneficiary_id)
);

create table public.program_enrollments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  program_id       uuid not null references public.programs(id) on delete cascade,
  cohort_id        uuid references public.program_cohorts(id) on delete set null,
  beneficiary_id   uuid not null references public.beneficiaries(id) on delete cascade,
  status           text not null default 'active' check (status in ('active','completed','graduated','withdrawn','dropped')),
  current_stage_key text,
  progress         int not null default 0 check (progress between 0 and 100),
  enrolled_at      timestamptz not null default now(),
  completed_at     timestamptz,
  exit_reason      text,
  updated_at       timestamptz not null default now(),
  unique (program_id, beneficiary_id)
);
create index idx_enrollments_beneficiary on public.program_enrollments(beneficiary_id);

create table public.program_teams (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  program_id      uuid not null references public.programs(id) on delete cascade,
  cohort_id       uuid references public.program_cohorts(id) on delete set null,
  code            text not null,
  name            text not null,
  challenge       text,
  project_title   text,
  status          text not null default 'active' check (status in ('forming','active','withdrawn','completed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.program_team_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_id         uuid not null references public.program_teams(id) on delete cascade,
  beneficiary_id  uuid not null references public.beneficiaries(id) on delete cascade,
  role            text not null default 'member' check (role in ('lead','member')),
  created_at      timestamptz not null default now(),
  unique (team_id, beneficiary_id)
);

create table public.program_projects (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  program_id      uuid not null references public.programs(id) on delete cascade,
  team_id         uuid references public.program_teams(id) on delete set null,
  beneficiary_id  uuid references public.beneficiaries(id) on delete set null,
  code            text not null,
  title           text not null,
  description     text,
  stage_key       text,
  status          text not null default 'proposed' check (status in ('proposed','in_progress','submitted','evaluated','completed','discontinued')),
  score           numeric(6,2),
  due_date        date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.expert_assignments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  program_id      uuid not null references public.programs(id) on delete cascade,
  cohort_id       uuid references public.program_cohorts(id) on delete set null,
  expert_id       uuid not null references public.experts(id) on delete cascade,
  beneficiary_id  uuid references public.beneficiaries(id) on delete set null,
  team_id         uuid references public.program_teams(id) on delete set null,
  role            text not null check (role in ('trainer','mentor','consultant','coach','assessor','judge')),
  stage_key       text,
  planned_hours   numeric(8,2) check (planned_hours >= 0),
  delivered_hours numeric(8,2) not null default 0 check (delivered_hours >= 0),
  rate            numeric(12,2),
  starts_on       date,
  ends_on         date,
  status          text not null default 'proposed' check (status in ('proposed','confirmed','active','completed','cancelled')),
  match_score     numeric(5,2),
  match_rationale jsonb not null default '[]'::jsonb,
  performance_rating numeric(3,2) check (performance_rating between 0 and 5),
  feedback        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index idx_assignments_expert on public.expert_assignments(expert_id);
create index idx_assignments_program on public.expert_assignments(program_id);

create table public.vendor_assignments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  program_id      uuid not null references public.programs(id) on delete cascade,
  vendor_id       uuid not null references public.vendors(id) on delete cascade,
  service         text not null,
  value           numeric(14,2),
  status          text not null default 'planned' check (status in ('planned','contracted','delivering','delivered','cancelled')),
  due_date        date,
  performance_rating numeric(3,2) check (performance_rating between 0 and 5),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.program_milestones (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  program_id        uuid not null references public.programs(id) on delete cascade,
  stage_key         text,
  cohort_id         uuid references public.program_cohorts(id) on delete set null,
  team_id           uuid references public.program_teams(id) on delete set null,
  beneficiary_id    uuid references public.beneficiaries(id) on delete set null,
  title             text not null,
  due_date          date,
  status            text not null default 'not_started' check (status in ('not_started','in_progress','achieved','missed','cancelled')),
  progress          int not null default 0 check (progress between 0 and 100),
  evidence_required boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Stage-specific operational records (judging scores, diagnostics, IDP items,
-- rotations, placements, MVP checkpoints, consulting recommendations, ...).
create table public.program_stage_records (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  program_id      uuid not null references public.programs(id) on delete cascade,
  stage_key       text not null,
  record_type     text not null,
  title           text not null,
  beneficiary_id  uuid references public.beneficiaries(id) on delete set null,
  expert_id       uuid references public.experts(id) on delete set null,
  team_id         uuid references public.program_teams(id) on delete set null,
  status          text not null default 'open' check (status in ('open','in_progress','done','cancelled')),
  score           numeric(6,2),
  due_date        date,
  payload         jsonb not null default '{}'::jsonb,
  created_by      uuid references auth.users(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_stage_records_program on public.program_stage_records(program_id, stage_key);

create table public.certificates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  program_id      uuid not null references public.programs(id) on delete cascade,
  beneficiary_id  uuid not null references public.beneficiaries(id) on delete cascade,
  code            text not null,
  title           text not null,
  issued_on       date not null default current_date,
  status          text not null default 'issued' check (status in ('issued','revoked')),
  created_at      timestamptz not null default now(),
  unique (organization_id, code)
);

-- -----------------------------------------------------------------------------
-- Self-service helpers (beneficiary / expert portal access)
-- -----------------------------------------------------------------------------
create or replace function public.my_beneficiary_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select b.id from public.beneficiaries b
  join public.organization_members m on m.organization_id = b.organization_id and m.user_id = auth.uid() and m.active
  where b.user_id = auth.uid();
$$;

create or replace function public.my_expert_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select e.id from public.experts e
  join public.organization_members m on m.organization_id = e.organization_id and m.user_id = auth.uid() and m.active
  where e.user_id = auth.uid();
$$;

-- -----------------------------------------------------------------------------
-- Program journey seeding from the central track template
-- -----------------------------------------------------------------------------
create or replace function public.seed_program_stages()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.program_stages (organization_id, program_id, stage_key, name_ar, name_en, description, stage_order,
                                     depends_on, requires_approval, approval_status, required_evidence, record_types)
  select new.organization_id, new.id, s->>'key', s->>'name_ar', s->>'name_en', s->>'description_ar',
         coalesce((s->>'order')::int, ord::int),
         coalesce(array(select jsonb_array_elements_text(s->'depends_on')), '{}'),
         coalesce((s->>'requires_approval')::boolean, false),
         case when coalesce((s->>'requires_approval')::boolean, false) then 'not_requested' else 'not_required' end,
         coalesce(array(select jsonb_array_elements_text(s->'required_evidence')), '{}'),
         coalesce(array(select jsonb_array_elements_text(s->'record_types')), '{}')
  from public.program_track_templates t,
       jsonb_array_elements(t.stages) with ordinality as x(s, ord)
  where t.code = new.track_code
  on conflict (program_id, stage_key) do nothing;
  return new;
end $$;

create trigger t50_seed_stages after insert on public.programs
  for each row execute function public.seed_program_stages();

-- -----------------------------------------------------------------------------
-- Standard triggers: tenant guard, codes, updated_at, audit
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select * from (values
    ('beneficiaries','BEN'), ('experts','EXP'), ('vendors','VEN'), ('partners','PTN'),
    ('programs','PRG'), ('program_cohorts','COH'), ('program_applications','APP'),
    ('program_teams','TEM'), ('program_projects','PRJ'), ('certificates','CRT')
  ) v(tbl, prefix) loop
    execute format('create trigger t20_code before insert on public.%I for each row execute function public.tg_assign_code(%L)', r.tbl, r.prefix);
  end loop;

  for r in select unnest(array['beneficiaries','experts','expert_availability','vendors','partners','user_invitations',
      'programs','program_stages','program_cohorts','program_applications','program_enrollments','program_teams',
      'program_team_members','program_projects','expert_assignments','vendor_assignments','program_milestones',
      'program_stage_records','certificates']) as tbl loop
    execute format('create trigger t10_tenant before insert or update on public.%I for each row execute function public.tg_tenant_guard()', r.tbl);
  end loop;

  for r in select unnest(array['beneficiaries','experts','vendors','partners','programs','program_stages','program_cohorts',
      'program_applications','program_enrollments','program_teams','program_projects','expert_assignments',
      'vendor_assignments','program_milestones','program_stage_records','program_track_templates']) as tbl loop
    execute format('create trigger t90_touch before update on public.%I for each row execute function public.tg_touch_updated_at()', r.tbl);
  end loop;

  for r in select unnest(array['beneficiaries','experts','vendors','partners','programs','program_stages',
      'program_applications','program_enrollments','expert_assignments','user_invitations','program_track_templates',
      'certificates']) as tbl loop
    execute format('create trigger t95_audit after insert or update or delete on public.%I for each row execute function public.tg_audit()', r.tbl);
  end loop;
end $$;

-- A team member must belong to the same program as the team (via enrollment is
-- not required, but the team's organization must match — enforced by guard).
-- program_team_members has no program_id; organization is taken from the team.
create or replace function public.tg_team_member_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.organization_id is null then
    select organization_id into new.organization_id from public.program_teams where id = new.team_id;
  end if;
  return new;
end $$;
create trigger t05_team_member_org before insert on public.program_team_members
  for each row execute function public.tg_team_member_org();

-- ===================== 20261005000300_operations.sql =====================
-- =============================================================================
-- TANMIA — 0300 Operations: sessions, participants & attendance, actions,
-- conflict detection, notification rules & queue, calendar feeds
-- =============================================================================

create table public.sessions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  program_id       uuid references public.programs(id) on delete cascade,
  cohort_id        uuid references public.program_cohorts(id) on delete set null,
  team_id          uuid references public.program_teams(id) on delete set null,
  expert_id        uuid references public.experts(id) on delete set null,
  code             text not null,
  title            text not null,
  session_type     text not null default 'training' check (session_type in ('training','workshop','mentoring','coaching','consulting','assessment','judging','event','orientation','other')),
  stage_key        text,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  timezone         text not null default 'Asia/Riyadh',
  delivery_mode    text not null default 'onsite' check (delivery_mode in ('onsite','online','hybrid')),
  location         text,
  meeting_url      text,
  capacity         int check (capacity >= 0),
  status           text not null default 'scheduled' check (status in ('draft','scheduled','completed','cancelled','rescheduled')),
  topics           text[] not null default '{}',
  agenda           text,
  summary          text,
  recommendations  text,
  cancelled_reason text,
  rescheduled_from uuid references public.sessions(id) on delete set null,
  completed_at     timestamptz,
  created_by       uuid references auth.users(id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, code),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '24 hours')
);
create index idx_sessions_org_time on public.sessions(organization_id, starts_at);
create index idx_sessions_program on public.sessions(program_id, starts_at);
create index idx_sessions_expert on public.sessions(expert_id, starts_at);

create table public.session_participants (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  session_id        uuid not null references public.sessions(id) on delete cascade,
  beneficiary_id    uuid not null references public.beneficiaries(id) on delete cascade,
  invitation_status text not null default 'pending' check (invitation_status in ('pending','sent','accepted','declined')),
  attendance_status text not null default 'unknown' check (attendance_status in ('unknown','present','late','absent','excused')),
  check_in_at       timestamptz,
  check_out_at      timestamptz,
  feedback_rating   smallint check (feedback_rating between 1 and 5),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (session_id, beneficiary_id)
);
create index idx_participants_beneficiary on public.session_participants(beneficiary_id);

create or replace function public.tg_participant_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.organization_id is null then
    select organization_id into new.organization_id from public.sessions where id = new.session_id;
  end if;
  return new;
end $$;
create trigger t05_participant_org before insert on public.session_participants
  for each row execute function public.tg_participant_org();

create table public.program_actions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  program_id       uuid references public.programs(id) on delete cascade,
  session_id       uuid references public.sessions(id) on delete set null,
  beneficiary_id   uuid references public.beneficiaries(id) on delete set null,
  expert_id        uuid references public.experts(id) on delete set null,
  stage_key        text,
  code             text not null,
  title            text not null,
  description      text,
  owner_user_id    uuid references auth.users(id) on delete set null,
  owner_name       text,
  due_date         date,
  priority         text not null default 'medium' check (priority in ('low','medium','high','critical')),
  status           text not null default 'open' check (status in ('open','in_progress','done','cancelled')),
  source           text not null default 'manual' check (source in ('manual','session','ai','risk','approval','consulting')),
  completion_note  text,
  completed_at     timestamptz,
  created_by       uuid references auth.users(id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, code)
);
create index idx_actions_program on public.program_actions(program_id, status);

-- -----------------------------------------------------------------------------
-- Conflict detection (warn before creating conflicts)
-- -----------------------------------------------------------------------------
create or replace function public.check_session_conflicts(
  p_org uuid, p_starts timestamptz, p_ends timestamptz, p_expert uuid default null,
  p_beneficiaries uuid[] default '{}', p_location text default null, p_exclude uuid default null,
  p_program uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  out jsonb := '[]'::jsonb;
  local_start timestamp := p_starts at time zone 'Asia/Riyadh';
  local_end   timestamp := p_ends at time zone 'Asia/Riyadh';
  has_weekly boolean;
  fits boolean;
  prg record;
begin
  if not public.tenant_can(p_org, 'operations', 'view') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_ends <= p_starts then
    return jsonb_build_array(jsonb_build_object('type','invalid_range','severity','high'));
  end if;

  if p_expert is not null then
    out := out || coalesce((select jsonb_agg(jsonb_build_object('type','expert_overlap','severity','high','session_id',s.id,'code',s.code,'title',s.title,'starts_at',s.starts_at,'ends_at',s.ends_at))
      from public.sessions s where s.organization_id = p_org and s.expert_id = p_expert and s.status in ('scheduled','draft')
        and s.id is distinct from p_exclude and tstzrange(s.starts_at, s.ends_at) && tstzrange(p_starts, p_ends)), '[]'::jsonb);

    out := out || coalesce((select jsonb_agg(jsonb_build_object('type','expert_blocked','severity','high','note',a.note,'starts_at',a.starts_at,'ends_at',a.ends_at))
      from public.expert_availability a where a.expert_id = p_expert and a.kind = 'blocked'
        and tstzrange(a.starts_at, a.ends_at) && tstzrange(p_starts, p_ends)), '[]'::jsonb);

    select exists(select 1 from public.expert_availability a where a.expert_id = p_expert and a.kind = 'weekly') into has_weekly;
    if has_weekly then
      select exists(select 1 from public.expert_availability a where a.expert_id = p_expert and a.kind = 'weekly'
        and a.weekday = extract(dow from local_start)::int and local_start::time >= a.start_time and local_end::time <= a.end_time
        and local_start::date = local_end::date) into fits;
      if not fits then
        out := out || jsonb_build_array(jsonb_build_object('type','outside_availability','severity','medium'));
      end if;
    end if;

    out := out || coalesce((select jsonb_agg(jsonb_build_object('type','expert_weekly_load','severity','medium','hours',h,'max',e.max_weekly_hours))
      from (select coalesce(sum(extract(epoch from (s.ends_at - s.starts_at)) / 3600), 0)
                   + extract(epoch from (p_ends - p_starts)) / 3600 as h
            from public.sessions s where s.expert_id = p_expert and s.status in ('scheduled','draft') and s.id is distinct from p_exclude
              and date_trunc('week', (s.starts_at at time zone 'Asia/Riyadh') + interval '1 day') = date_trunc('week', local_start + interval '1 day')) w  -- Sunday-start (Saudi) week
      join public.experts e on e.id = p_expert
      where e.max_weekly_hours is not null and w.h > e.max_weekly_hours), '[]'::jsonb);
  end if;

  if coalesce(array_length(p_beneficiaries, 1), 0) > 0 then
    out := out || coalesce((select jsonb_agg(jsonb_build_object('type','beneficiary_overlap','severity','medium','session_id',s.id,'code',s.code,'title',s.title,
                                                              'beneficiary_id',sp.beneficiary_id,'starts_at',s.starts_at,'ends_at',s.ends_at))
      from public.session_participants sp join public.sessions s on s.id = sp.session_id
      where s.organization_id = p_org and sp.beneficiary_id = any(p_beneficiaries) and s.status in ('scheduled','draft')
        and s.id is distinct from p_exclude and tstzrange(s.starts_at, s.ends_at) && tstzrange(p_starts, p_ends)), '[]'::jsonb);
  end if;

  if p_location is not null and btrim(p_location) <> '' then
    out := out || coalesce((select jsonb_agg(jsonb_build_object('type','location_overlap','severity','medium','session_id',s.id,'code',s.code,'title',s.title,'starts_at',s.starts_at,'ends_at',s.ends_at))
      from public.sessions s where s.organization_id = p_org and lower(btrim(s.location)) = lower(btrim(p_location)) and s.delivery_mode <> 'online'
        and s.status in ('scheduled','draft') and s.id is distinct from p_exclude and tstzrange(s.starts_at, s.ends_at) && tstzrange(p_starts, p_ends)), '[]'::jsonb);
  end if;

  if p_program is not null then
    select start_date, end_date into prg from public.programs where id = p_program and organization_id = p_org;
    if (prg.start_date is not null and local_start::date < prg.start_date) or (prg.end_date is not null and local_end::date > prg.end_date) then
      out := out || jsonb_build_array(jsonb_build_object('type','outside_program_dates','severity','low','start_date',prg.start_date,'end_date',prg.end_date));
    end if;
  end if;
  return out;
end $$;

-- -----------------------------------------------------------------------------
-- Notifications
-- -----------------------------------------------------------------------------
create table public.notification_rules (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null,
  event_type       text not null check (event_type in ('session_scheduled','session_reminder','session_cancelled','session_rescheduled',
                     'assessment_due','evidence_rejected','evidence_verified','approval_requested','approval_decided','stage_blocked',
                     'action_due','invitation_sent','report_ready','health_alert')),
  audience         text not null default 'participants' check (audience in ('participants','expert','program_manager','org_admins','assignee','requester')),
  channels         text[] not null default '{in_app}',
  offset_minutes   int not null default 0,
  conditions       jsonb not null default '{}'::jsonb,
  subject_template text,
  body_template    text,
  status           text not null default 'active' check (status in ('active','inactive')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (channels <@ array['in_app','email','sms','whatsapp','calendar']::text[])
);

create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid references auth.users(id) on delete cascade,
  recipient_email text,
  recipient_phone text,
  channel         text not null default 'in_app' check (channel in ('in_app','email','sms','whatsapp','calendar')),
  event_type      text not null,
  title           text not null,
  body            text,
  link            text,
  entity_type     text,
  entity_id       uuid,
  rule_id         uuid references public.notification_rules(id) on delete set null,
  status          text not null default 'queued' check (status in ('queued','scheduled','sent','failed','skipped','read','cancelled')),
  scheduled_for   timestamptz not null default now(),
  sent_at         timestamptz,
  read_at         timestamptz,
  attempts        int not null default 0,
  delivery_result jsonb not null default '{}'::jsonb,
  dedupe_key      text,
  created_at      timestamptz not null default now(),
  unique (dedupe_key)
);
create index idx_notifications_user on public.notifications(user_id, status, created_at desc);
create index idx_notifications_due on public.notifications(status, scheduled_for);

create or replace function public.mark_notification_read(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.notifications set status = 'read', read_at = now()
  where id = p_id and user_id = auth.uid() and channel = 'in_app';
$$;

create or replace function public.mark_all_notifications_read(p_org uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.notifications set status = 'read', read_at = now()
  where organization_id = p_org and user_id = auth.uid() and channel = 'in_app' and status in ('sent','queued','scheduled')
    and scheduled_for <= now();
  get diagnostics n = row_count;
  return n;
end $$;

-- Calendar feed tokens (ICS subscription). Token hashes only.
create table public.calendar_feed_tokens (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  scope           text not null check (scope in ('me','expert','program','organization')),
  scope_id        uuid,
  token_hash      text not null unique,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz
);

-- -----------------------------------------------------------------------------
-- Standard triggers
-- -----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select * from (values ('sessions','SES'), ('program_actions','ACT')) v(tbl, prefix) loop
    execute format('create trigger t20_code before insert on public.%I for each row execute function public.tg_assign_code(%L)', r.tbl, r.prefix);
  end loop;
  for r in select unnest(array['sessions','session_participants','program_actions','notification_rules','notifications','calendar_feed_tokens']) as tbl loop
    execute format('create trigger t10_tenant before insert or update on public.%I for each row execute function public.tg_tenant_guard()', r.tbl);
  end loop;
  for r in select unnest(array['sessions','session_participants','program_actions','notification_rules']) as tbl loop
    execute format('create trigger t90_touch before update on public.%I for each row execute function public.tg_touch_updated_at()', r.tbl);
  end loop;
  for r in select unnest(array['sessions','program_actions','notification_rules']) as tbl loop
    execute format('create trigger t95_audit after insert or update or delete on public.%I for each row execute function public.tg_audit()', r.tbl);
  end loop;
end $$;

-- Session completion bookkeeping and delivered expert hours
create or replace function public.tg_session_complete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and (old.status is distinct from 'completed') then
    new.completed_at := coalesce(new.completed_at, now());
    if new.expert_id is not null and new.program_id is not null then
      update public.expert_assignments
         set delivered_hours = delivered_hours + extract(epoch from (new.ends_at - new.starts_at)) / 3600
       where id = (select id from public.expert_assignments
                    where expert_id = new.expert_id and program_id = new.program_id and status in ('confirmed','active')
                    order by created_at limit 1);
    end if;
  end if;
  return new;
end $$;
create trigger t30_session_complete before update on public.sessions
  for each row execute function public.tg_session_complete();

-- ===================== 20261005000400_assessments.sql =====================
-- =============================================================================
-- TANMIA — 0400 Assessment engine, external imports, form builder, maturity
-- Scoring is authoritative in the database (triggers below). The TypeScript
-- engine (supabase/functions/_shared/engine/scoring.ts) mirrors it exactly for
-- live previews; tests assert both produce the same numbers.
-- =============================================================================

-- organization_id NULL = central (platform) template, copied into organizations.
create table public.assessment_tools (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  code            text not null,
  name            text not null,
  name_en         text,
  description     text,
  tool_type       text not null default 'internal' check (tool_type in ('internal','external')),
  provider        text,                       -- e.g. Hogan, SHL, internal
  subject_type    text not null default 'individual' check (subject_type in ('individual','team','expert','program')),
  track_codes     text[] not null default '{}',
  scoring_method  text not null default 'weighted_average' check (scoring_method in ('weighted_average','average','sum')),
  scale_min       numeric not null default 1,
  scale_max       numeric not null default 5,
  pass_threshold  numeric check (pass_threshold between 0 and 100),   -- on the 0–100 normalized scale
  classification  jsonb not null default '[]'::jsonb, -- [{min,max,label_ar,label_en,interpretation_ar,interpretation_en}] on 0–100
  version         int not null default 1,
  parent_tool_id  uuid references public.assessment_tools(id) on delete set null,
  status          text not null default 'draft' check (status in ('draft','active','archived')),
  created_by      uuid references auth.users(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique nulls not distinct (organization_id, code, version),
  check (scale_max > scale_min)
);

create table public.assessment_dimensions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  tool_id         uuid not null references public.assessment_tools(id) on delete cascade,
  code            text not null,
  name            text not null,
  name_en         text,
  description     text,
  weight          numeric not null default 1 check (weight >= 0),
  sort_order      int not null default 0,
  rubric          jsonb not null default '[]'::jsonb, -- [{score,label_ar,label_en,descriptor_ar,descriptor_en}]
  created_at      timestamptz not null default now(),
  unique (tool_id, code)
);

create table public.assessment_questions (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid references public.organizations(id) on delete cascade,
  tool_id            uuid not null references public.assessment_tools(id) on delete cascade,
  dimension_id       uuid references public.assessment_dimensions(id) on delete set null,
  code               text not null,
  text_ar            text,
  text_en            text,
  question_type      text not null default 'scale' check (question_type in ('scale','single_choice','multiple_choice','number','boolean','text')),
  options            jsonb not null default '[]'::jsonb, -- [{value,label_ar,label_en,score}] score on tool scale
  weight             numeric not null default 1 check (weight >= 0),
  reverse_scored     boolean not null default false,
  required           boolean not null default true,
  sort_order         int not null default 0,
  translation_status text not null default 'none' check (translation_status in ('none','machine','verified')),
  created_at         timestamptz not null default now(),
  unique (tool_id, code),
  check (text_ar is not null or text_en is not null)
);

create table public.external_assessment_imports (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  tool_id           uuid not null references public.assessment_tools(id) on delete restrict,
  program_id        uuid references public.programs(id) on delete set null,
  provider          text,
  file_path         text,
  original_filename text,
  measurement_point text check (measurement_point in ('T0','T1','T2','T3','T4','T5','other')),
  column_mapping    jsonb not null default '{}'::jsonb,
  status            text not null default 'uploaded' check (status in ('uploaded','parsed','imported','partially_imported','failed')),
  row_count         int not null default 0,
  imported_count    int not null default 0,
  unmatched         jsonb not null default '[]'::jsonb,
  error             text,
  imported_by       uuid references auth.users(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now()
);

create table public.assessment_results (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  tool_id              uuid not null references public.assessment_tools(id) on delete restrict,
  tool_version         int,
  program_id           uuid references public.programs(id) on delete cascade,
  cohort_id            uuid references public.program_cohorts(id) on delete set null,
  beneficiary_id       uuid references public.beneficiaries(id) on delete cascade,
  team_id              uuid references public.program_teams(id) on delete set null,
  expert_id            uuid references public.experts(id) on delete set null, -- subject when assessing an expert
  assessor_user_id     uuid references auth.users(id) on delete set null default auth.uid(),
  measurement_point    text not null default 'other' check (measurement_point in ('T0','T1','T2','T3','T4','T5','other')),
  source               text not null default 'internal' check (source in ('internal','external_import')),
  import_id            uuid references public.external_assessment_imports(id) on delete set null,
  responses            jsonb not null default '{}'::jsonb,   -- {question_id: value}
  dimension_scores     jsonb not null default '{}'::jsonb,   -- {dimension_id: score on tool scale}
  total_score          numeric,
  normalized_score     numeric,                              -- 0..100
  classification_label text,
  passed               boolean,
  interpretation       jsonb not null default '{}'::jsonb,
  external_raw         jsonb,
  status               text not null default 'submitted' check (status in ('draft','submitted','verified','rejected')),
  verified_by          uuid references auth.users(id) on delete set null,
  verified_at          timestamptz,
  notes                text,
  assessed_at          timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (beneficiary_id is not null or team_id is not null or expert_id is not null or program_id is not null)
);
create index idx_results_beneficiary on public.assessment_results(beneficiary_id, measurement_point);
create index idx_results_program on public.assessment_results(program_id, tool_id);

-- -----------------------------------------------------------------------------
-- Authoritative scoring
-- -----------------------------------------------------------------------------
create or replace function public.score_assessment_result()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t       public.assessment_tools%rowtype;
  q       record;
  d       record;
  v       numeric;
  smin    numeric; smax numeric;
  dim_acc jsonb := '{}'::jsonb;   -- {dim_id: {"s": weighted_sum, "w": weight_sum}}
  dims    jsonb := '{}'::jsonb;
  total   numeric; wsum numeric := 0; acc numeric := 0; n int := 0;
  norm    numeric;
  cls     jsonb;
  key     text;
  raw     jsonb;
begin
  select * into t from public.assessment_tools where id = new.tool_id;
  smin := t.scale_min; smax := t.scale_max;
  new.tool_version := t.version;

  if new.responses is not null and new.responses <> '{}'::jsonb then
    for q in select aq.* from public.assessment_questions aq where aq.tool_id = t.id and aq.dimension_id is not null loop
      raw := new.responses -> (q.id::text);
      if raw is null or raw = 'null'::jsonb then continue; end if;
      v := null;
      if q.question_type in ('scale','number') then
        v := least(greatest((raw #>> '{}')::numeric, smin), smax);
      elsif q.question_type = 'boolean' then
        v := case when (raw #>> '{}')::boolean then smax else smin end;
      elsif q.question_type = 'single_choice' then
        select (o->>'score')::numeric into v from jsonb_array_elements(q.options) o where o->>'value' = raw #>> '{}' limit 1;
      elsif q.question_type = 'multiple_choice' and jsonb_typeof(raw) = 'array' then
        select avg((o->>'score')::numeric) into v from jsonb_array_elements(q.options) o
         where (o->>'value') in (select jsonb_array_elements_text(raw));
      end if;
      if v is null then continue; end if;
      if q.reverse_scored then v := smin + smax - v; end if;
      key := q.dimension_id::text;
      dim_acc := jsonb_set(dim_acc, array[key], jsonb_build_object(
        's', coalesce((dim_acc->key->>'s')::numeric, 0) + v * q.weight,
        'w', coalesce((dim_acc->key->>'w')::numeric, 0) + q.weight));
    end loop;
    for key in select jsonb_object_keys(dim_acc) loop
      if (dim_acc->key->>'w')::numeric > 0 then
        dims := dims || jsonb_build_object(key, round((dim_acc->key->>'s')::numeric / (dim_acc->key->>'w')::numeric, 4));
      end if;
    end loop;
    new.dimension_scores := dims;
  end if;

  -- Overall from dimension scores
  for d in select ad.id, ad.weight from public.assessment_dimensions ad where ad.tool_id = t.id loop
    if new.dimension_scores ? (d.id::text) then
      v := least(greatest((new.dimension_scores->>(d.id::text))::numeric, smin), smax);
      if t.scoring_method = 'weighted_average' then
        acc := acc + v * d.weight; wsum := wsum + d.weight;
      else
        acc := acc + v; wsum := wsum + 1;
      end if;
      n := n + 1;
    end if;
  end loop;

  if n = 0 then
    new.total_score := null; new.normalized_score := null; new.classification_label := null; new.passed := null;
    return new;
  end if;

  if t.scoring_method = 'sum' then
    total := acc;
    norm := (acc - n * smin) / (n * (smax - smin)) * 100;
  else
    total := case when wsum > 0 then acc / wsum else null end;
    norm := case when total is null then null else (total - smin) / (smax - smin) * 100 end;
  end if;

  new.total_score := round(total, 2);
  new.normalized_score := round(norm, 2);

  select c into cls from jsonb_array_elements(t.classification) c
   where norm >= (c->>'min')::numeric and (norm < (c->>'max')::numeric or ((c->>'max')::numeric >= 100 and norm <= 100))
   order by (c->>'min')::numeric desc limit 1;
  new.classification_label := cls->>'label_ar';
  new.interpretation := coalesce(new.interpretation, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'label_ar', cls->>'label_ar', 'label_en', cls->>'label_en',
    'interpretation_ar', cls->>'interpretation_ar', 'interpretation_en', cls->>'interpretation_en',
    'dimensions_scored', n));
  new.passed := case when t.pass_threshold is null then null else norm >= t.pass_threshold end;
  return new;
end $$;

create trigger t40_score before insert or update of responses, dimension_scores, tool_id on public.assessment_results
  for each row execute function public.score_assessment_result();

-- New version of a tool (copies dimensions and questions; previous version archived)
create or replace function public.create_assessment_tool_version(p_tool uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t public.assessment_tools%rowtype; new_id uuid; d record; new_dim uuid;
begin
  select * into t from public.assessment_tools where id = p_tool;
  if t.id is null then raise exception 'Tool not found'; end if;
  if t.organization_id is null then
    if not public.is_platform_super_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  elsif not public.tenant_can(t.organization_id, 'assessments', 'configure') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  insert into public.assessment_tools (organization_id, code, name, name_en, description, tool_type, provider, subject_type, track_codes,
     scoring_method, scale_min, scale_max, pass_threshold, classification, version, parent_tool_id, status)
  values (t.organization_id, t.code, t.name, t.name_en, t.description, t.tool_type, t.provider, t.subject_type, t.track_codes,
     t.scoring_method, t.scale_min, t.scale_max, t.pass_threshold, t.classification,
     (select max(version) + 1 from public.assessment_tools where organization_id is not distinct from t.organization_id and code = t.code),
     t.id, 'draft')
  returning id into new_id;
  for d in select * from public.assessment_dimensions where tool_id = t.id loop
    insert into public.assessment_dimensions (organization_id, tool_id, code, name, name_en, description, weight, sort_order, rubric)
    values (d.organization_id, new_id, d.code, d.name, d.name_en, d.description, d.weight, d.sort_order, d.rubric)
    returning id into new_dim;
    insert into public.assessment_questions (organization_id, tool_id, dimension_id, code, text_ar, text_en, question_type, options, weight,
       reverse_scored, required, sort_order, translation_status)
    select organization_id, new_id, new_dim, code, text_ar, text_en, question_type, options, weight, reverse_scored, required, sort_order, translation_status
    from public.assessment_questions where tool_id = t.id and dimension_id = d.id;
  end loop;
  insert into public.assessment_questions (organization_id, tool_id, dimension_id, code, text_ar, text_en, question_type, options, weight,
     reverse_scored, required, sort_order, translation_status)
  select organization_id, new_id, null, code, text_ar, text_en, question_type, options, weight, reverse_scored, required, sort_order, translation_status
  from public.assessment_questions where tool_id = t.id and dimension_id is null;
  return new_id;
end $$;

-- -----------------------------------------------------------------------------
-- Form builder
-- schema: {fields:[{key,type,label_ar,label_en,required,options:[{value,label_ar,label_en,score}],
--                    min,max,show_if:{field,op,value},scoring:{weight}}]}
-- -----------------------------------------------------------------------------
create table public.form_templates (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid references public.organizations(id) on delete cascade,
  code               text not null,
  title              text not null,
  title_en           text,
  description        text,
  form_type          text not null default 'form' check (form_type in ('application','registration','feedback','survey','assessment','stage_form','follow_up','form')),
  track_codes        text[] not null default '{}',
  stage_key          text,
  program_id         uuid references public.programs(id) on delete cascade,
  schema             jsonb not null default '{"fields":[]}'::jsonb,
  scoring_enabled    boolean not null default false,
  requires_review    boolean not null default false,
  version            int not null default 1,
  parent_template_id uuid references public.form_templates(id) on delete set null,
  status             text not null default 'draft' check (status in ('draft','published','archived')),
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique nulls not distinct (organization_id, code, version)
);

create table public.form_submissions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  template_id      uuid not null references public.form_templates(id) on delete restrict,
  template_version int,
  program_id       uuid references public.programs(id) on delete cascade,
  beneficiary_id   uuid references public.beneficiaries(id) on delete set null,
  stage_key        text,
  submitted_by     uuid references auth.users(id) on delete set null default auth.uid(),
  answers          jsonb not null default '{}'::jsonb,
  score            numeric,
  signature        jsonb,                                  -- {name, acknowledged_at}
  status           text not null default 'submitted' check (status in ('draft','submitted','reviewed','approved','rejected')),
  reviewed_by      uuid references auth.users(id) on delete set null,
  reviewed_at      timestamptz,
  review_note      text,
  submitted_at     timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index idx_submissions_template on public.form_submissions(template_id);

-- Score submissions server-side: sum(option.score * weight) for choice/rating fields.
create or replace function public.score_form_submission()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  tpl public.form_templates%rowtype; f jsonb; a jsonb; total numeric := 0; any_scored boolean := false; w numeric; s numeric;
begin
  select * into tpl from public.form_templates where id = new.template_id;
  new.template_version := tpl.version;
  if not tpl.scoring_enabled then new.score := null; return new; end if;
  for f in select * from jsonb_array_elements(coalesce(tpl.schema->'fields', '[]'::jsonb)) loop
    a := new.answers -> (f->>'key');
    if a is null or a = 'null'::jsonb then continue; end if;
    w := coalesce((f->'scoring'->>'weight')::numeric, 1);
    s := null;
    if f->>'type' in ('single_choice') then
      select (o->>'score')::numeric into s from jsonb_array_elements(coalesce(f->'options','[]'::jsonb)) o where o->>'value' = a #>> '{}' limit 1;
    elsif f->>'type' = 'multiple_choice' and jsonb_typeof(a) = 'array' then
      select sum((o->>'score')::numeric) into s from jsonb_array_elements(coalesce(f->'options','[]'::jsonb)) o
       where (o->>'value') in (select jsonb_array_elements_text(a));
    elsif f->>'type' in ('rating','scale','number') and jsonb_typeof(a) = 'number' and (f ? 'scoring') then
      s := (a #>> '{}')::numeric;
    end if;
    if s is not null then total := total + s * w; any_scored := true; end if;
  end loop;
  new.score := case when any_scored then round(total, 2) else null end;
  return new;
end $$;
create trigger t40_score before insert or update of answers on public.form_submissions
  for each row execute function public.score_form_submission();

-- -----------------------------------------------------------------------------
-- Maturity model (T0..T5)
-- dimensions: [{key,name_ar,name_en,weight,levels:{"1":{"ar":..,"en":..},...}}]
-- -----------------------------------------------------------------------------
create table public.maturity_frameworks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  program_id      uuid references public.programs(id) on delete cascade,
  code            text not null,
  name            text not null,
  name_en         text,
  track_code      text,
  description     text,
  scale_min       numeric not null default 1,
  scale_max       numeric not null default 5,
  weighted        boolean not null default true,
  dimensions      jsonb not null default '[]'::jsonb,
  version         int not null default 1,
  status          text not null default 'active' check (status in ('draft','active','archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique nulls not distinct (organization_id, code, version),
  check (scale_max > scale_min)
);

create table public.maturity_assessments (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  framework_id      uuid not null references public.maturity_frameworks(id) on delete restrict,
  program_id        uuid not null references public.programs(id) on delete cascade,
  cohort_id         uuid references public.program_cohorts(id) on delete set null,
  beneficiary_id    uuid references public.beneficiaries(id) on delete cascade,
  team_id           uuid references public.program_teams(id) on delete cascade,
  measurement_point text not null check (measurement_point in ('T0','T1','T2','T3','T4','T5')),
  dimension_scores  jsonb not null default '{}'::jsonb,      -- {dimension_key: score}
  overall_score     numeric,
  overall_level     int,
  data_quality      text not null default 'assessor_rated' check (data_quality in ('self_reported','assessor_rated','verified')),
  evidence_ids      uuid[] not null default '{}',
  assessed_by       uuid references auth.users(id) on delete set null default auth.uid(),
  assessed_at       timestamptz not null default now(),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (beneficiary_id is not null or team_id is not null)
);
create unique index uq_maturity_point on public.maturity_assessments
  (framework_id, program_id, coalesce(beneficiary_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid), measurement_point);

create or replace function public.score_maturity_assessment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  fw public.maturity_frameworks%rowtype; d jsonb; v numeric; w numeric; acc numeric := 0; wsum numeric := 0; k text;
begin
  select * into fw from public.maturity_frameworks where id = new.framework_id;
  for k in select jsonb_object_keys(new.dimension_scores) loop
    if not exists (select 1 from jsonb_array_elements(fw.dimensions) x where x->>'key' = k) then
      raise exception 'Unknown maturity dimension: %', k using errcode = '22023';
    end if;
    v := (new.dimension_scores->>k)::numeric;
    if v < fw.scale_min or v > fw.scale_max then
      raise exception 'Score for % must be between % and %', k, fw.scale_min, fw.scale_max using errcode = '22023';
    end if;
  end loop;
  for d in select * from jsonb_array_elements(fw.dimensions) loop
    if new.dimension_scores ? (d->>'key') then
      v := (new.dimension_scores->>(d->>'key'))::numeric;
      w := case when fw.weighted then coalesce((d->>'weight')::numeric, 1) else 1 end;
      acc := acc + v * w; wsum := wsum + w;
    end if;
  end loop;
  new.overall_score := case when wsum > 0 then round(acc / wsum, 2) else null end;
  new.overall_level := case when wsum > 0 then round(acc / wsum)::int else null end;
  return new;
end $$;
create trigger t40_score before insert or update of dimension_scores, framework_id on public.maturity_assessments
  for each row execute function public.score_maturity_assessment();

-- -----------------------------------------------------------------------------
-- Copy a central template (assessment tool / form / maturity framework) into an organization
-- -----------------------------------------------------------------------------
create or replace function public.copy_central_template(p_kind text, p_id uuid, p_org uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid; d record; new_dim uuid;
begin
  if p_kind = 'assessment_tool' then
    if not public.tenant_can(p_org, 'assessments', 'create') then raise exception 'Not authorized' using errcode = '42501'; end if;
    insert into public.assessment_tools (organization_id, code, name, name_en, description, tool_type, provider, subject_type, track_codes,
       scoring_method, scale_min, scale_max, pass_threshold, classification, version, status)
    select p_org, code, name, name_en, description, tool_type, provider, subject_type, track_codes,
       scoring_method, scale_min, scale_max, pass_threshold, classification,
       coalesce((select max(version) + 1 from public.assessment_tools x where x.organization_id = p_org and x.code = t.code), 1), 'active'
    from public.assessment_tools t where t.id = p_id and t.organization_id is null
    returning id into new_id;
    if new_id is null then raise exception 'Central tool not found'; end if;
    for d in select * from public.assessment_dimensions where tool_id = p_id loop
      insert into public.assessment_dimensions (organization_id, tool_id, code, name, name_en, description, weight, sort_order, rubric)
      values (p_org, new_id, d.code, d.name, d.name_en, d.description, d.weight, d.sort_order, d.rubric) returning id into new_dim;
      insert into public.assessment_questions (organization_id, tool_id, dimension_id, code, text_ar, text_en, question_type, options, weight,
         reverse_scored, required, sort_order, translation_status)
      select p_org, new_id, new_dim, code, text_ar, text_en, question_type, options, weight, reverse_scored, required, sort_order, translation_status
      from public.assessment_questions where tool_id = p_id and dimension_id = d.id;
    end loop;
  elsif p_kind = 'form_template' then
    if not public.tenant_can(p_org, 'templates', 'create') then raise exception 'Not authorized' using errcode = '42501'; end if;
    insert into public.form_templates (organization_id, code, title, title_en, description, form_type, track_codes, stage_key, schema,
       scoring_enabled, requires_review, version, status)
    select p_org, code, title, title_en, description, form_type, track_codes, stage_key, schema, scoring_enabled, requires_review,
       coalesce((select max(version) + 1 from public.form_templates x where x.organization_id = p_org and x.code = t.code), 1), 'published'
    from public.form_templates t where t.id = p_id and t.organization_id is null
    returning id into new_id;
  elsif p_kind = 'maturity_framework' then
    if not public.tenant_can(p_org, 'assessments', 'create') then raise exception 'Not authorized' using errcode = '42501'; end if;
    insert into public.maturity_frameworks (organization_id, code, name, name_en, track_code, description, scale_min, scale_max, weighted, dimensions, version, status)
    select p_org, code, name, name_en, track_code, description, scale_min, scale_max, weighted, dimensions,
       coalesce((select max(version) + 1 from public.maturity_frameworks x where x.organization_id = p_org and x.code = t.code), 1), 'active'
    from public.maturity_frameworks t where t.id = p_id and t.organization_id is null
    returning id into new_id;
  else
    raise exception 'Unknown template kind %', p_kind;
  end if;
  if new_id is null then raise exception 'Central template not found'; end if;
  perform public.write_audit(p_org, 'copy_central_template', p_kind, new_id::text, p_id::text);
  return new_id;
end $$;

-- -----------------------------------------------------------------------------
-- Standard triggers
-- -----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select * from (values ('assessment_tools','ASM'), ('form_templates','FRM'), ('maturity_frameworks','MAT')) v(tbl, prefix) loop
    execute format('create trigger t20_code before insert on public.%I for each row execute function public.tg_assign_code(%L)', r.tbl, r.prefix);
  end loop;
  for r in select unnest(array['assessment_tools','assessment_dimensions','assessment_questions','form_templates','maturity_frameworks']) as tbl loop
    execute format('create trigger t10_tenant before insert or update on public.%I for each row execute function public.tg_tenant_guard(%L)', r.tbl, 'central_ok');
  end loop;
  for r in select unnest(array['external_assessment_imports','assessment_results','form_submissions','maturity_assessments']) as tbl loop
    execute format('create trigger t10_tenant before insert or update on public.%I for each row execute function public.tg_tenant_guard()', r.tbl);
  end loop;
  for r in select unnest(array['assessment_tools','assessment_results','form_templates','form_submissions','maturity_frameworks','maturity_assessments']) as tbl loop
    execute format('create trigger t90_touch before update on public.%I for each row execute function public.tg_touch_updated_at()', r.tbl);
  end loop;
  for r in select unnest(array['assessment_tools','assessment_results','external_assessment_imports','form_templates','form_submissions',
      'maturity_frameworks','maturity_assessments']) as tbl loop
    execute format('create trigger t95_audit after insert or update or delete on public.%I for each row execute function public.tg_audit()', r.tbl);
  end loop;
end $$;

-- ===================== 20261005000500_impact_evidence.sql =====================
-- =============================================================================
-- TANMIA — 0500 Social impact (Theory of Change, indicators, measurements),
-- outputs & outcomes, evidence registry, documents, storage buckets
-- =============================================================================

-- organization_id NULL + program_id NULL = central impact framework template.
create table public.impact_frameworks (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid references public.organizations(id) on delete cascade,
  program_id           uuid references public.programs(id) on delete cascade,
  code                 text not null,
  name                 text not null,
  track_code           text,
  problem_statement    text,
  target_population    text,
  baseline_summary     text,
  -- {inputs:[],activities:[],outputs:[],outcomes_short:[],outcomes_medium:[],outcomes_long:[],impact:[],assumptions:[],external_factors:[]}
  theory_of_change     jsonb not null default '{}'::jsonb,
  intended_impact      text,
  evaluation_design    text not null default 'pre_post' check (evaluation_design in ('monitoring_only','pre_post','comparison_group','quasi_experimental','rct')),
  attribution_approach text not null default 'contribution' check (attribution_approach in ('observed_change','contribution','attribution')),
  status               text not null default 'draft' check (status in ('draft','approved','archived')),
  version              int not null default 1,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (program_id is null or organization_id is not null)
);
create unique index uq_impact_framework_program on public.impact_frameworks(program_id) where program_id is not null;

create table public.indicators (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  program_id          uuid not null references public.programs(id) on delete cascade,
  impact_framework_id uuid references public.impact_frameworks(id) on delete set null,
  code                text not null,
  name                text not null,
  name_en             text,
  definition          text,
  indicator_type      text not null check (indicator_type in ('operational','output','outcome','impact')),
  chain_level         text not null check (chain_level in ('input','activity','output','outcome','impact')),
  outcome_term        text check (outcome_term in ('short','medium','long')),
  unit                text not null default 'count',
  baseline_value      numeric,
  baseline_date       date,
  target_value        numeric,
  direction           text not null default 'increase' check (direction in ('increase','decrease','maintain')),
  data_source         text,
  collection_method   text,
  frequency           text not null default 'per_measurement_point' check (frequency in ('once','monthly','quarterly','per_measurement_point','annual')),
  measurement_points  text[] not null default '{T0,T1}',
  evidence_required   boolean not null default true,
  responsible_user_id uuid references auth.users(id) on delete set null,
  disaggregation      text[] not null default '{}',
  status              text not null default 'active' check (status in ('draft','active','retired')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organization_id, code)
);
create index idx_indicators_program on public.indicators(program_id);

create table public.indicator_measurements (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  indicator_id      uuid not null references public.indicators(id) on delete cascade,
  program_id        uuid references public.programs(id) on delete cascade,
  measurement_point text check (measurement_point in ('T0','T1','T2','T3','T4','T5','other')),
  period_start      date,
  period_end        date,
  value             numeric not null,
  sample_size       int check (sample_size >= 0),
  comparison_value  numeric,       -- comparison / control group value at the same point
  data_quality      text not null default 'reported' check (data_quality in ('estimated','reported','verified')),
  source            text,
  notes             text,
  evidence_id       uuid,          -- FK added after evidence table exists
  measured_at       timestamptz not null default now(),
  recorded_by       uuid references auth.users(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now()
);
create index idx_measurements_indicator on public.indicator_measurements(indicator_id, measurement_point);

create or replace function public.tg_measurement_program()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select program_id, organization_id into new.program_id, new.organization_id from public.indicators where id = new.indicator_id;
  return new;
end $$;
create trigger t05_measurement_program before insert or update of indicator_id on public.indicator_measurements
  for each row execute function public.tg_measurement_program();

create table public.program_outputs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  program_id      uuid not null references public.programs(id) on delete cascade,
  indicator_id    uuid references public.indicators(id) on delete set null,
  code            text not null,
  description     text not null,
  unit            text not null default 'count',
  target          numeric,
  actual          numeric not null default 0,
  due_date        date,
  stage_key       text,
  status          text not null default 'planned' check (status in ('planned','in_progress','achieved','partially_achieved','not_achieved')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.program_outcomes (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  program_id        uuid not null references public.programs(id) on delete cascade,
  indicator_id      uuid references public.indicators(id) on delete set null,
  beneficiary_id    uuid references public.beneficiaries(id) on delete cascade,
  code              text not null,
  description       text not null,
  scope             text not null default 'program' check (scope in ('program','cohort','beneficiary')),
  term              text not null default 'short' check (term in ('short','medium','long')),
  unit              text not null default 'percent',
  baseline          numeric,
  target            numeric,
  actual            numeric,
  measurement_point text check (measurement_point in ('T0','T1','T2','T3','T4','T5','other')),
  status            text not null default 'not_measured' check (status in ('not_measured','on_track','at_risk','achieved','not_achieved')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, code),
  check (scope <> 'beneficiary' or beneficiary_id is not null)
);

-- -----------------------------------------------------------------------------
-- Documents (program documents, contracts, beneficiary/expert files)
-- -----------------------------------------------------------------------------
create table public.documents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code            text not null,
  title           text not null,
  doc_type        text not null default 'other' check (doc_type in ('plan','contract','agreement','policy','cv','certificate','id','report','minutes','invoice','other')),
  program_id      uuid references public.programs(id) on delete cascade,
  beneficiary_id  uuid references public.beneficiaries(id) on delete cascade,
  expert_id       uuid references public.experts(id) on delete cascade,
  vendor_id       uuid references public.vendors(id) on delete cascade,
  partner_id      uuid references public.partners(id) on delete cascade,
  file_path       text not null,
  file_name       text,
  mime_type       text,
  file_size       bigint,
  version         int not null default 1,
  status          text not null default 'active' check (status in ('active','superseded','archived')),
  uploaded_by     uuid references auth.users(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  unique (organization_id, code)
);

-- -----------------------------------------------------------------------------
-- Evidence registry
-- -----------------------------------------------------------------------------
create table public.evidence (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  code                 text not null,
  title                text not null,
  evidence_type        text not null default 'document' check (evidence_type in ('document','photo','video','attendance_sheet','certificate',
                          'assessment_report','survey_data','testimonial','link','dataset','minutes','product','other')),
  description          text,
  file_path            text,
  file_name            text,
  mime_type            text,
  file_size            bigint,
  source_url           text,
  program_id           uuid references public.programs(id) on delete cascade,
  cohort_id            uuid references public.program_cohorts(id) on delete set null,
  beneficiary_id       uuid references public.beneficiaries(id) on delete set null,
  expert_id            uuid references public.experts(id) on delete set null,
  session_id           uuid references public.sessions(id) on delete set null,
  assessment_result_id uuid references public.assessment_results(id) on delete set null,
  indicator_id         uuid references public.indicators(id) on delete set null,
  milestone_id         uuid references public.program_milestones(id) on delete set null,
  output_id            uuid references public.program_outputs(id) on delete set null,
  outcome_id           uuid references public.program_outcomes(id) on delete set null,
  stage_key            text,
  verification_status  text not null default 'pending' check (verification_status in ('pending','verified','rejected','needs_info')),
  verified_by          uuid references auth.users(id) on delete set null,
  verified_at          timestamptz,
  verification_notes   text,
  metadata             jsonb not null default '{}'::jsonb,
  collected_at         date,
  uploaded_by          uuid references auth.users(id) on delete set null default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (organization_id, code),
  check (file_path is not null or source_url is not null or description is not null)
);
create index idx_evidence_program on public.evidence(program_id, verification_status);
create index idx_evidence_indicator on public.evidence(indicator_id);
create index idx_evidence_beneficiary on public.evidence(beneficiary_id);

alter table public.indicator_measurements
  add constraint indicator_measurements_evidence_fk foreign key (evidence_id) references public.evidence(id) on delete set null;

-- Only verifiers may set verification fields (enforced here in addition to RLS).
create or replace function public.tg_evidence_verification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.verification_status <> 'pending' and auth.uid() is not null and not public.tenant_can(new.organization_id, 'evidence', 'verify') then
      new.verification_status := 'pending';
    end if;
    if new.verification_status = 'pending' then
      new.verified_by := null; new.verified_at := null;
    end if;
    return new;
  end if;
  if new.verification_status is distinct from old.verification_status then
    if auth.uid() is not null and not public.tenant_can(new.organization_id, 'evidence', 'verify') then
      raise exception 'Verification requires evidence.verify permission' using errcode = '42501';
    end if;
    if auth.uid() is not null and new.uploaded_by = auth.uid() and new.verification_status = 'verified' and not public.is_platform_super_admin() then
      raise exception 'Evidence cannot be verified by the person who uploaded it' using errcode = '42501';
    end if;
    new.verified_by := auth.uid();
    new.verified_at := now();
  end if;
  return new;
end $$;
create trigger t30_verification before insert or update on public.evidence
  for each row execute function public.tg_evidence_verification();

-- -----------------------------------------------------------------------------
-- Storage: private buckets, organization-scoped paths: <organization_id>/...
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values
  ('evidence', 'evidence', false),
  ('documents', 'documents', false),
  ('imports', 'imports', false)
on conflict (id) do nothing;

create or replace function public.storage_org_id(object_name text)
returns uuid language plpgsql immutable as $$
declare first_segment text := split_part(object_name, '/', 1);
begin
  if first_segment ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return first_segment::uuid;
  end if;
  return null;
end $$;

create or replace function public.storage_module(bucket text)
returns text language sql immutable as $$
  select case bucket when 'evidence' then 'evidence' when 'documents' then 'evidence' when 'imports' then 'assessments' end;
$$;

drop policy if exists tanmia_storage_select on storage.objects;
create policy tanmia_storage_select on storage.objects for select to authenticated
  using (bucket_id in ('evidence','documents','imports')
         and public.tenant_can(public.storage_org_id(name), public.storage_module(bucket_id), 'view'));
drop policy if exists tanmia_storage_insert on storage.objects;
create policy tanmia_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('evidence','documents','imports')
         and public.tenant_can(public.storage_org_id(name), public.storage_module(bucket_id), 'create'));
drop policy if exists tanmia_storage_update on storage.objects;
create policy tanmia_storage_update on storage.objects for update to authenticated
  using (bucket_id in ('evidence','documents','imports')
         and public.tenant_can(public.storage_org_id(name), public.storage_module(bucket_id), 'edit'))
  with check (bucket_id in ('evidence','documents','imports')
         and public.tenant_can(public.storage_org_id(name), public.storage_module(bucket_id), 'edit'));
drop policy if exists tanmia_storage_delete on storage.objects;
create policy tanmia_storage_delete on storage.objects for delete to authenticated
  using (bucket_id in ('evidence','documents','imports')
         and public.tenant_can(public.storage_org_id(name), public.storage_module(bucket_id), 'delete'));

-- -----------------------------------------------------------------------------
-- Standard triggers
-- -----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select * from (values ('impact_frameworks','IMP'), ('indicators','KPI'), ('program_outputs','OUT'),
                                 ('program_outcomes','OCM'), ('documents','DOC'), ('evidence','EVD')) v(tbl, prefix) loop
    execute format('create trigger t20_code before insert on public.%I for each row execute function public.tg_assign_code(%L)', r.tbl, r.prefix);
  end loop;
  execute 'create trigger t10_tenant before insert or update on public.impact_frameworks for each row execute function public.tg_tenant_guard(''central_ok'')';
  for r in select unnest(array['indicators','indicator_measurements','program_outputs','program_outcomes','documents','evidence']) as tbl loop
    execute format('create trigger t10_tenant before insert or update on public.%I for each row execute function public.tg_tenant_guard()', r.tbl);
  end loop;
  for r in select unnest(array['impact_frameworks','indicators','program_outputs','program_outcomes','evidence']) as tbl loop
    execute format('create trigger t90_touch before update on public.%I for each row execute function public.tg_touch_updated_at()', r.tbl);
  end loop;
  for r in select unnest(array['impact_frameworks','indicators','indicator_measurements','program_outputs','program_outcomes','documents','evidence']) as tbl loop
    execute format('create trigger t95_audit after insert or update or delete on public.%I for each row execute function public.tg_audit()', r.tbl);
  end loop;
end $$;

-- ===================== 20261005000600_governance_reports.sql =====================
-- =============================================================================
-- TANMIA — 0600 Governance (budgets, contracts, risks/issues, approvals, data
-- stewardship), reports & versions, AI insights, settings, integrations,
-- journey workflow RPCs
-- =============================================================================

create table public.program_budgets (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  program_id       uuid not null references public.programs(id) on delete cascade,
  category         text not null,
  planned_amount   numeric(14,2) not null default 0 check (planned_amount >= 0),
  committed_amount numeric(14,2) not null default 0 check (committed_amount >= 0),
  actual_amount    numeric(14,2) not null default 0 check (actual_amount >= 0),
  currency         text not null default 'SAR',
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.contracts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code            text not null,
  program_id      uuid references public.programs(id) on delete set null,
  vendor_id       uuid references public.vendors(id) on delete set null,
  expert_id       uuid references public.experts(id) on delete set null,
  partner_id      uuid references public.partners(id) on delete set null,
  title           text not null,
  value           numeric(14,2) check (value >= 0),
  currency        text not null default 'SAR',
  start_date      date,
  end_date        date,
  status          text not null default 'draft' check (status in ('draft','pending_approval','active','completed','terminated')),
  document_id     uuid references public.documents(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, code),
  check (end_date is null or start_date is null or end_date >= start_date)
);

alter table public.vendor_assignments add column contract_id uuid references public.contracts(id) on delete set null;

create table public.risks_issues (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  program_id      uuid references public.programs(id) on delete cascade,
  code            text not null,
  kind            text not null default 'risk' check (kind in ('risk','issue')),
  title           text not null,
  description     text,
  category        text check (category in ('delivery','financial','quality','compliance','safeguarding','data','reputational','partner','other')),
  likelihood      smallint check (likelihood between 1 and 5),
  impact          smallint check (impact between 1 and 5),
  severity        smallint generated always as (coalesce(likelihood, 1) * coalesce(impact, 1)) stored,
  owner_user_id   uuid references auth.users(id) on delete set null,
  mitigation      text,
  due_date        date,
  status          text not null default 'open' check (status in ('open','mitigating','escalated','closed')),
  source          text not null default 'manual' check (source in ('manual','ai','health_check')),
  created_by      uuid references auth.users(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.approval_requests (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  program_id       uuid references public.programs(id) on delete cascade,
  entity_type      text not null check (entity_type in ('program','program_stage','report','contract','budget','evidence','assessment_result','application','other')),
  entity_id        uuid,
  title            text not null,
  details          text,
  status           text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  requested_by     uuid references auth.users(id) on delete set null default auth.uid(),
  approver_user_id uuid references auth.users(id) on delete set null,
  decided_by       uuid references auth.users(id) on delete set null,
  decision_note    text,
  decided_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index idx_approvals_org on public.approval_requests(organization_id, status);

create table public.data_stewards (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  data_domain      text not null check (data_domain in ('beneficiaries','experts','operations','assessments','evidence','outcomes','impact','finance','reports')),
  owner_user_id    uuid references auth.users(id) on delete set null,
  verifier_user_id uuid references auth.users(id) on delete set null,
  notes            text,
  created_at       timestamptz not null default now(),
  unique (organization_id, data_domain)
);

-- -----------------------------------------------------------------------------
-- Reports
-- -----------------------------------------------------------------------------
create table public.reports (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  program_id      uuid references public.programs(id) on delete cascade,
  code            text not null,
  report_type     text not null check (report_type in ('executive','progress','attendance_delivery','beneficiaries','experts','evaluation_quality',
                     'maturity','outputs','outcomes','impact','evidence','closure','final_comprehensive')),
  title           text not null,
  period_start    date,
  period_end      date,
  -- {sections:[], indicators:[uuid], comparisons:{points:['T0','T1']}, detail_level:'summary'|'detailed', include_attachments:bool, narrative:{}}
  configuration   jsonb not null default '{}'::jsonb,
  status          text not null default 'draft' check (status in ('draft','generated','in_review','approved','published')),
  current_version int not null default 0,
  approved_by     uuid references auth.users(id) on delete set null,
  approved_at     timestamptz,
  created_by      uuid references auth.users(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, code),
  check (period_end is null or period_start is null or period_end >= period_start)
);

create table public.report_versions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  report_id       uuid not null references public.reports(id) on delete cascade,
  version         int not null,
  content         jsonb not null default '{}'::jsonb,
  narrative       jsonb not null default '{}'::jsonb,
  generator       text not null default 'rules' check (generator in ('rules','rules+llm','manual')),
  generated_by    uuid references auth.users(id) on delete set null,
  generated_at    timestamptz not null default now(),
  unique (report_id, version)
);

-- -----------------------------------------------------------------------------
-- AI / expert-system insights (recommendations; humans accept or dismiss)
-- -----------------------------------------------------------------------------
create table public.ai_insights (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  program_id         uuid references public.programs(id) on delete cascade,
  scope              text not null default 'program' check (scope in ('organization','program','beneficiary','assessment','impact','evidence','operations')),
  entity_id          uuid,
  kind               text not null check (kind in ('missing_config','inconsistency','blocker','evidence_gap','kpi_anomaly','risk',
                        'recommendation','interpretation','conflict','overlap','gap','data_quality')),
  severity           text not null default 'medium' check (severity in ('info','low','medium','high','critical')),
  rule_code          text,
  fingerprint        text,
  title              text not null,
  rationale          text not null,
  source_data        jsonb not null default '{}'::jsonb,
  recommended_action text,
  generated_by       text not null default 'rules' check (generated_by in ('rules','llm')),
  status             text not null default 'open' check (status in ('open','accepted','dismissed','resolved')),
  decided_by         uuid references auth.users(id) on delete set null,
  decided_at         timestamptz,
  decision_note      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index uq_insight_fingerprint on public.ai_insights(organization_id, fingerprint) where status = 'open' and fingerprint is not null;
create index idx_insights_program on public.ai_insights(program_id, status);

-- -----------------------------------------------------------------------------
-- Settings and integrations (non-secret configuration only; secrets live in
-- Edge Function environment variables)
-- -----------------------------------------------------------------------------
create table public.system_settings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  setting_key     text not null,
  setting_value   jsonb not null default '{}'::jsonb,
  updated_by      uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at      timestamptz not null default now(),
  unique nulls not distinct (organization_id, setting_key)
);

create table public.integration_settings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  provider        text not null check (provider in ('email','sms','whatsapp','calendar_ics','ai')),
  enabled         boolean not null default false,
  config          jsonb not null default '{}'::jsonb,   -- e.g. {"from":"noreply@..."}; never secrets
  updated_by      uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at      timestamptz not null default now(),
  unique nulls not distinct (organization_id, provider)
);

-- -----------------------------------------------------------------------------
-- Journey workflow: dependencies, evidence and approval gates
-- -----------------------------------------------------------------------------
create or replace function public.transition_program_stage(p_stage uuid, p_status text, p_note text default null, p_override boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  st public.program_stages%rowtype;
  unmet text[];
  missing text[];
  appr uuid;
begin
  select * into st from public.program_stages where id = p_stage for update;
  if st.id is null then raise exception 'Stage not found' using errcode = 'P0002'; end if;
  if not public.tenant_can(st.organization_id, 'programs', 'edit') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_status not in ('not_started','in_progress','blocked','completed','skipped') then
    raise exception 'Invalid status %', p_status using errcode = '22023';
  end if;
  if p_override and not public.tenant_can(st.organization_id, 'programs', 'approve') then
    raise exception 'Override requires programs.approve' using errcode = '42501';
  end if;
  if p_status = 'blocked' and coalesce(btrim(p_note), '') = '' then
    return jsonb_build_object('ok', false, 'code', 'BLOCKER_NOTE_REQUIRED');
  end if;

  if p_status in ('in_progress','completed') then
    select array_agg(d) into unmet from unnest(st.depends_on) d
    where not exists (select 1 from public.program_stages x where x.program_id = st.program_id and x.stage_key = d and x.status in ('completed','skipped'));
    if coalesce(array_length(unmet, 1), 0) > 0 and not p_override then
      return jsonb_build_object('ok', false, 'code', 'DEPENDENCIES_NOT_MET', 'unmet', to_jsonb(unmet));
    end if;
  end if;

  if p_status = 'completed' then
    select array_agg(t) into missing from unnest(st.required_evidence) t
    where not exists (select 1 from public.evidence e where e.program_id = st.program_id and e.stage_key = st.stage_key
                        and e.evidence_type = t and e.verification_status in ('pending','verified'));
    if coalesce(array_length(missing, 1), 0) > 0 and not p_override then
      return jsonb_build_object('ok', false, 'code', 'EVIDENCE_MISSING', 'missing', to_jsonb(missing));
    end if;
    if st.requires_approval and st.approval_status <> 'approved' and not p_override then
      if st.approval_status <> 'pending' then
        insert into public.approval_requests (organization_id, program_id, entity_type, entity_id, title, details)
        values (st.organization_id, st.program_id, 'program_stage', st.id, 'اعتماد إكمال مرحلة: ' || st.name_ar, p_note)
        returning id into appr;
        update public.program_stages set approval_status = 'pending', status = 'in_progress',
               actual_start = coalesce(actual_start, current_date) where id = st.id;
      end if;
      return jsonb_build_object('ok', false, 'code', 'APPROVAL_REQUESTED', 'approval_id', appr);
    end if;
  end if;

  update public.program_stages set
    status = p_status,
    progress = case when p_status in ('completed','skipped') then 100 when p_status = 'not_started' then 0 else greatest(progress, 10) end,
    actual_start = case when p_status in ('in_progress','completed') then coalesce(actual_start, current_date) else actual_start end,
    actual_end = case when p_status in ('completed','skipped') then current_date else null end,
    blocker_note = case when p_status = 'blocked' then p_note else null end,
    notes = coalesce(p_note, notes)
  where id = st.id;

  perform public.write_audit(st.organization_id, 'stage_' || p_status, 'program_stages', st.id::text,
    st.name_ar, jsonb_build_object('override', p_override, 'note', p_note));
  return jsonb_build_object('ok', true, 'status', p_status, 'overridden', p_override and (coalesce(array_length(unmet,1),0) > 0 or coalesce(array_length(missing,1),0) > 0));
end $$;

create or replace function public.decide_approval(p_id uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.approval_requests%rowtype;
begin
  select * into a from public.approval_requests where id = p_id for update;
  if a.id is null then raise exception 'Approval not found' using errcode = 'P0002'; end if;
  if not public.tenant_can(a.organization_id, 'governance', 'approve') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if a.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_DECIDED');
  end if;
  if p_decision not in ('approved','rejected') then raise exception 'Invalid decision' using errcode = '22023'; end if;
  if a.requested_by = auth.uid() and not public.is_platform_super_admin() then
    return jsonb_build_object('ok', false, 'code', 'SELF_APPROVAL_NOT_ALLOWED');
  end if;

  update public.approval_requests set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = a.id;

  if a.entity_type = 'program_stage' and a.entity_id is not null then
    update public.program_stages set approval_status = p_decision,
      status = case when p_decision = 'approved' then 'completed' else status end,
      progress = case when p_decision = 'approved' then 100 else progress end,
      actual_end = case when p_decision = 'approved' then current_date else actual_end end
    where id = a.entity_id and organization_id = a.organization_id;
  elsif a.entity_type = 'report' and a.entity_id is not null then
    update public.reports set status = case when p_decision = 'approved' then 'approved' else 'draft' end,
      approved_by = case when p_decision = 'approved' then auth.uid() end,
      approved_at = case when p_decision = 'approved' then now() end
    where id = a.entity_id and organization_id = a.organization_id;
  elsif a.entity_type = 'contract' and a.entity_id is not null then
    update public.contracts set status = case when p_decision = 'approved' then 'active' else 'draft' end
    where id = a.entity_id and organization_id = a.organization_id;
  end if;

  perform public.write_audit(a.organization_id, 'approval_' || p_decision, 'approval_requests', a.id::text, a.title, jsonb_build_object('note', p_note));
  return jsonb_build_object('ok', true, 'status', p_decision);
end $$;

create or replace function public.decide_insight(p_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare i public.ai_insights%rowtype;
begin
  select * into i from public.ai_insights where id = p_id;
  if i.id is null then raise exception 'Insight not found'; end if;
  if not public.tenant_can(i.organization_id, 'programs', 'edit') then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_decision not in ('accepted','dismissed','resolved') then raise exception 'Invalid decision'; end if;
  update public.ai_insights set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = p_id;
end $$;

-- -----------------------------------------------------------------------------
-- Dashboard aggregate (RLS-respecting: SECURITY INVOKER)
-- -----------------------------------------------------------------------------
create or replace function public.org_dashboard(p_org uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'programs_total',     (select count(*) from public.programs where organization_id = p_org),
    'programs_active',    (select count(*) from public.programs where organization_id = p_org and status = 'active'),
    'beneficiaries',      (select count(*) from public.beneficiaries where organization_id = p_org and status = 'active'),
    'enrollments_active', (select count(*) from public.program_enrollments where organization_id = p_org and status = 'active'),
    'graduates',          (select count(*) from public.program_enrollments where organization_id = p_org and status in ('graduated','completed')),
    'experts',            (select count(*) from public.experts where organization_id = p_org and status = 'active'),
    'sessions_upcoming',  (select count(*) from public.sessions where organization_id = p_org and status = 'scheduled' and starts_at >= now()),
    'sessions_completed', (select count(*) from public.sessions where organization_id = p_org and status = 'completed'),
    'attendance_rate',    (select round(100.0 * count(*) filter (where attendance_status in ('present','late')) / nullif(count(*) filter (where attendance_status <> 'unknown'), 0), 1)
                           from public.session_participants where organization_id = p_org),
    'evidence_total',     (select count(*) from public.evidence where organization_id = p_org),
    'evidence_verified',  (select count(*) from public.evidence where organization_id = p_org and verification_status = 'verified'),
    'evidence_pending',   (select count(*) from public.evidence where organization_id = p_org and verification_status = 'pending'),
    'approvals_pending',  (select count(*) from public.approval_requests where organization_id = p_org and status = 'pending'),
    'risks_open',         (select count(*) from public.risks_issues where organization_id = p_org and status <> 'closed'),
    'risks_high',         (select count(*) from public.risks_issues where organization_id = p_org and status <> 'closed' and severity >= 15),
    'actions_overdue',    (select count(*) from public.program_actions where organization_id = p_org and status in ('open','in_progress') and due_date < current_date),
    'insights_open',      (select count(*) from public.ai_insights where organization_id = p_org and status = 'open'),
    'budget_planned',     (select coalesce(sum(planned_amount), 0) from public.program_budgets where organization_id = p_org),
    'budget_actual',      (select coalesce(sum(actual_amount), 0) from public.program_budgets where organization_id = p_org)
  );
$$;

-- -----------------------------------------------------------------------------
-- Standard triggers
-- -----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select * from (values ('contracts','CTR'), ('risks_issues','ISS'), ('reports','RPT')) v(tbl, prefix) loop
    execute format('create trigger t20_code before insert on public.%I for each row execute function public.tg_assign_code(%L)', r.tbl, r.prefix);
  end loop;
  for r in select unnest(array['program_budgets','contracts','risks_issues','approval_requests','data_stewards','reports','report_versions','ai_insights']) as tbl loop
    execute format('create trigger t10_tenant before insert or update on public.%I for each row execute function public.tg_tenant_guard()', r.tbl);
  end loop;
  for r in select unnest(array['system_settings','integration_settings']) as tbl loop
    execute format('create trigger t10_tenant before insert or update on public.%I for each row execute function public.tg_tenant_guard(%L)', r.tbl, 'central_ok');
  end loop;
  for r in select unnest(array['program_budgets','contracts','risks_issues','reports','ai_insights']) as tbl loop
    execute format('create trigger t90_touch before update on public.%I for each row execute function public.tg_touch_updated_at()', r.tbl);
  end loop;
  for r in select unnest(array['program_budgets','contracts','risks_issues','approval_requests','data_stewards','reports','report_versions',
      'ai_insights','system_settings','integration_settings']) as tbl loop
    execute format('create trigger t95_audit after insert or update or delete on public.%I for each row execute function public.tg_audit()', r.tbl);
  end loop;
end $$;

-- ===================== 20261005000700_rls.sql =====================
-- =============================================================================
-- TANMIA — 0700 Row Level Security
-- Every tenant table is protected by tenant_can(organization_id, module, action):
--   platform super admin → allowed; otherwise the organization must be active,
--   the module enabled, the membership active and one of the user's roles must
--   grant <module>.<action>. Self-service policies give beneficiaries/experts
--   access to their own records only.
-- =============================================================================

-- Self-service scope helpers
create or replace function public.my_expert_program_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct a.program_id from public.expert_assignments a
  where a.expert_id in (select public.my_expert_ids()) and a.status in ('confirmed','active','completed');
$$;

create or replace function public.my_beneficiary_program_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct e.program_id from public.program_enrollments e
  where e.beneficiary_id in (select public.my_beneficiary_ids());
$$;

create or replace function public.my_session_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select s.id from public.sessions s where s.expert_id in (select public.my_expert_ids())
  union
  select sp.session_id from public.session_participants sp where sp.beneficiary_id in (select public.my_beneficiary_ids());
$$;

create or replace function public.my_expert_beneficiary_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select a.beneficiary_id from public.expert_assignments a
   where a.expert_id in (select public.my_expert_ids()) and a.beneficiary_id is not null and a.status in ('confirmed','active','completed')
  union
  select tm.beneficiary_id from public.expert_assignments a join public.program_team_members tm on tm.team_id = a.team_id
   where a.expert_id in (select public.my_expert_ids()) and a.status in ('confirmed','active','completed')
  union
  select sp.beneficiary_id from public.session_participants sp join public.sessions s on s.id = sp.session_id
   where s.expert_id in (select public.my_expert_ids());
$$;

-- Organization fields only the platform may change
create or replace function public.tg_org_protect()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_platform_super_admin() then
    if new.status is distinct from old.status or new.code is distinct from old.code then
      raise exception 'Only platform administrators can change organization status or code' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger t08_org_protect before update on public.organizations
  for each row execute function public.tg_org_protect();

-- Review states of form submissions require approval rights
create or replace function public.tg_submission_review_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('reviewed','approved','rejected') and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    if auth.uid() is not null and not public.tenant_can(new.organization_id, 'templates', 'approve') then
      raise exception 'Reviewing submissions requires templates.approve' using errcode = '42501';
    end if;
    new.reviewed_by := auth.uid(); new.reviewed_at := now();
  end if;
  return new;
end $$;
create trigger t30_review_guard before insert or update on public.form_submissions
  for each row execute function public.tg_submission_review_guard();

-- Assessment verification requires assessments.verify
create or replace function public.tg_result_verification_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('verified','rejected') and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    if auth.uid() is not null and not public.tenant_can(new.organization_id, 'assessments', 'verify') then
      raise exception 'Verifying results requires assessments.verify' using errcode = '42501';
    end if;
    new.verified_by := auth.uid(); new.verified_at := now();
  end if;
  return new;
end $$;
create trigger t30_verify_guard before insert or update on public.assessment_results
  for each row execute function public.tg_result_verification_guard();

-- Verifiers without assessments.edit may only change review fields.
create or replace function public.tg_result_verifier_scope()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.tenant_can(new.organization_id, 'assessments', 'edit')
     and new.assessor_user_id is distinct from auth.uid()
     and (new.responses is distinct from old.responses or new.dimension_scores is distinct from old.dimension_scores
          or new.tool_id is distinct from old.tool_id or new.beneficiary_id is distinct from old.beneficiary_id
          or new.measurement_point is distinct from old.measurement_point or new.program_id is distinct from old.program_id) then
    raise exception 'Verifiers may only change verification fields' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger t31_verifier_scope before update on public.assessment_results
  for each row execute function public.tg_result_verifier_scope();

-- Published forms that already have submissions are immutable (create a new version instead).
create or replace function public.tg_form_template_lock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'published' and (new.schema is distinct from old.schema or new.scoring_enabled is distinct from old.scoring_enabled)
     and exists (select 1 from public.form_submissions s where s.template_id = old.id) then
    raise exception 'Published form has submissions; create a new version' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger t32_form_lock before update on public.form_templates
  for each row execute function public.tg_form_template_lock();

-- -----------------------------------------------------------------------------
-- Enable RLS on every public table
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Standard tenant policies: (table, module)
-- -----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select * from (values
    ('vendors','vendors'), ('vendor_assignments','vendors'), ('partners','partners'),
    ('program_cohorts','programs'), ('program_applications','programs'), ('program_teams','programs'),
    ('program_team_members','programs'), ('program_projects','programs'), ('program_milestones','programs'),
    ('expert_availability','experts'),
    ('program_actions','operations'),
    ('external_assessment_imports','assessments'), ('maturity_frameworks_org','assessments'),
    ('indicators','impact'), ('indicator_measurements','impact'),
    ('program_outputs','outcomes'), ('program_outcomes','outcomes'),
    ('documents','evidence'),
    ('program_budgets','governance'), ('contracts','governance'), ('risks_issues','governance'), ('data_stewards','governance'),
    ('reports','reports'), ('report_versions','reports'),
    ('notification_rules','notifications')
  ) v(tbl, module) loop
    continue when r.tbl = 'maturity_frameworks_org';
    execute format('create policy %I on public.%I for select to authenticated using (public.tenant_can(organization_id, %L, ''view''))', r.tbl || '_select', r.tbl, r.module);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.tenant_can(organization_id, %L, ''create''))', r.tbl || '_insert', r.tbl, r.module);
    execute format('create policy %I on public.%I for update to authenticated using (public.tenant_can(organization_id, %L, ''edit'')) with check (public.tenant_can(organization_id, %L, ''edit''))', r.tbl || '_update', r.tbl, r.module, r.module);
    execute format('create policy %I on public.%I for delete to authenticated using (public.tenant_can(organization_id, %L, ''delete''))', r.tbl || '_delete', r.tbl, r.module);
  end loop;
end $$;

-- Central-capable tables: organization_id NULL rows are platform templates
do $$
declare r record;
begin
  for r in select * from (values
    ('assessment_tools','assessments'), ('assessment_dimensions','assessments'), ('assessment_questions','assessments'),
    ('maturity_frameworks','assessments'), ('impact_frameworks','impact'), ('form_templates','templates')
  ) v(tbl, module) loop
    execute format('create policy %I on public.%I for select to authenticated using (organization_id is null or public.tenant_can(organization_id, %L, ''view''))', r.tbl || '_select', r.tbl, r.module);
    execute format('create policy %I on public.%I for insert to authenticated with check (case when organization_id is null then public.is_platform_super_admin() else public.tenant_can(organization_id, %L, ''create'') end)', r.tbl || '_insert', r.tbl, r.module);
    execute format('create policy %I on public.%I for update to authenticated using (case when organization_id is null then public.is_platform_super_admin() else public.tenant_can(organization_id, %L, ''edit'') end) with check (case when organization_id is null then public.is_platform_super_admin() else public.tenant_can(organization_id, %L, ''edit'') end)', r.tbl || '_update', r.tbl, r.module, r.module);
    execute format('create policy %I on public.%I for delete to authenticated using (case when organization_id is null then public.is_platform_super_admin() else public.tenant_can(organization_id, %L, ''delete'') end)', r.tbl || '_delete', r.tbl, r.module);
  end loop;
end $$;

-- Published forms are visible to every active member (beneficiaries fill them)
create policy form_templates_member_published on public.form_templates for select to authenticated
  using (organization_id is not null and status = 'published' and public.is_org_member(organization_id));

-- -----------------------------------------------------------------------------
-- Platform / identity
-- -----------------------------------------------------------------------------
create policy organizations_select on public.organizations for select to authenticated
  using (public.is_platform_super_admin() or exists (select 1 from public.organization_members m where m.organization_id = organizations.id and m.user_id = auth.uid()));
create policy organizations_insert on public.organizations for insert to authenticated
  with check (public.is_platform_super_admin());
create policy organizations_update on public.organizations for update to authenticated
  using (public.is_platform_super_admin() or public.tenant_can(id, 'governance', 'configure'))
  with check (public.is_platform_super_admin() or public.tenant_can(id, 'governance', 'configure'));
create policy organizations_delete on public.organizations for delete to authenticated
  using (public.is_platform_super_admin());

create policy platform_users_select on public.platform_users for select to authenticated
  using (user_id = auth.uid() or public.is_platform_super_admin());
create policy platform_users_write on public.platform_users for all to authenticated
  using (public.is_platform_super_admin()) with check (public.is_platform_super_admin());

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_platform_super_admin()
         or exists (select 1 from public.organization_members m where m.user_id = profiles.id and public.tenant_can(m.organization_id, 'users', 'view'))
         or exists (select 1 from public.organization_members a join public.organization_members b on a.organization_id = b.organization_id
                    where a.user_id = auth.uid() and a.active and b.user_id = profiles.id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_platform_super_admin())
  with check (id = auth.uid() or public.is_platform_super_admin());

create policy members_select on public.organization_members for select to authenticated
  using (user_id = auth.uid() or public.tenant_can(organization_id, 'users', 'view') or public.tenant_can(organization_id, 'governance', 'view'));
create policy members_insert on public.organization_members for insert to authenticated
  with check (public.tenant_can(organization_id, 'users', 'edit'));
create policy members_update on public.organization_members for update to authenticated
  using (public.tenant_can(organization_id, 'users', 'edit')) with check (public.tenant_can(organization_id, 'users', 'edit'));
create policy members_delete on public.organization_members for delete to authenticated
  using (public.tenant_can(organization_id, 'users', 'delete'));

create policy permissions_select on public.permissions for select to authenticated using (true);
create policy permissions_write on public.permissions for all to authenticated
  using (public.is_platform_super_admin()) with check (public.is_platform_super_admin());

create policy roles_select on public.roles for select to authenticated
  using (organization_id is null or public.is_org_member(organization_id));
create policy roles_write on public.roles for all to authenticated
  using (case when organization_id is null then public.is_platform_super_admin() else public.tenant_can(organization_id, 'users', 'configure') end)
  with check (case when organization_id is null then public.is_platform_super_admin() else public.tenant_can(organization_id, 'users', 'configure') end);

create policy role_permissions_select on public.role_permissions for select to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and (r.organization_id is null or public.is_org_member(r.organization_id))));
create policy role_permissions_write on public.role_permissions for all to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and
         case when r.organization_id is null then public.is_platform_super_admin() else public.tenant_can(r.organization_id, 'users', 'configure') end))
  with check (exists (select 1 from public.roles r where r.id = role_id and
         case when r.organization_id is null then public.is_platform_super_admin() else public.tenant_can(r.organization_id, 'users', 'configure') end));

create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.tenant_can(organization_id, 'users', 'view'));
create policy user_roles_write on public.user_roles for all to authenticated
  using (public.tenant_can(organization_id, 'users', 'assign')) with check (public.tenant_can(organization_id, 'users', 'assign'));

create policy org_modules_select on public.organization_modules for select to authenticated
  using (public.is_org_member(organization_id));
create policy org_modules_write on public.organization_modules for all to authenticated
  using (public.tenant_can(organization_id, 'governance', 'configure')) with check (public.tenant_can(organization_id, 'governance', 'configure'));

create policy audit_select on public.audit_log for select to authenticated
  using (public.is_platform_super_admin() or (organization_id is not null and public.tenant_can(organization_id, 'governance', 'view')));

create policy invitations_select on public.user_invitations for select to authenticated
  using (public.tenant_can(organization_id, 'users', 'view'));
create policy invitations_update on public.user_invitations for update to authenticated
  using (public.tenant_can(organization_id, 'users', 'edit')) with check (public.tenant_can(organization_id, 'users', 'edit'));
create policy invitation_roles_select on public.invitation_roles for select to authenticated
  using (exists (select 1 from public.user_invitations i where i.id = invitation_id and public.tenant_can(i.organization_id, 'users', 'view')));

create policy track_templates_select on public.program_track_templates for select to authenticated using (true);
create policy track_templates_write on public.program_track_templates for all to authenticated
  using (public.is_platform_super_admin()) with check (public.is_platform_super_admin());

-- -----------------------------------------------------------------------------
-- Directory with self-service
-- -----------------------------------------------------------------------------
create policy beneficiaries_select on public.beneficiaries for select to authenticated
  using (public.tenant_can(organization_id, 'beneficiaries', 'view')
         or id in (select public.my_beneficiary_ids())
         or id in (select public.my_expert_beneficiary_ids()));
create policy beneficiaries_insert on public.beneficiaries for insert to authenticated
  with check (public.tenant_can(organization_id, 'beneficiaries', 'create'));
create policy beneficiaries_update on public.beneficiaries for update to authenticated
  using (public.tenant_can(organization_id, 'beneficiaries', 'edit')) with check (public.tenant_can(organization_id, 'beneficiaries', 'edit'));
create policy beneficiaries_delete on public.beneficiaries for delete to authenticated
  using (public.tenant_can(organization_id, 'beneficiaries', 'delete'));

create policy experts_select on public.experts for select to authenticated
  using (public.tenant_can(organization_id, 'experts', 'view') or id in (select public.my_expert_ids()));
create policy experts_insert on public.experts for insert to authenticated
  with check (public.tenant_can(organization_id, 'experts', 'create'));
create policy experts_update on public.experts for update to authenticated
  using (public.tenant_can(organization_id, 'experts', 'edit')) with check (public.tenant_can(organization_id, 'experts', 'edit'));
create policy experts_delete on public.experts for delete to authenticated
  using (public.tenant_can(organization_id, 'experts', 'delete'));

create policy availability_self on public.expert_availability for all to authenticated
  using (expert_id in (select public.my_expert_ids())) with check (expert_id in (select public.my_expert_ids()));

create policy expert_assignments_select on public.expert_assignments for select to authenticated
  using (public.tenant_can(organization_id, 'experts', 'view') or expert_id in (select public.my_expert_ids()));
create policy expert_assignments_insert on public.expert_assignments for insert to authenticated
  with check (public.tenant_can(organization_id, 'experts', 'assign'));
create policy expert_assignments_update on public.expert_assignments for update to authenticated
  using (public.tenant_can(organization_id, 'experts', 'assign')) with check (public.tenant_can(organization_id, 'experts', 'assign'));
create policy expert_assignments_delete on public.expert_assignments for delete to authenticated
  using (public.tenant_can(organization_id, 'experts', 'assign'));

-- -----------------------------------------------------------------------------
-- Programs with self-service visibility
-- -----------------------------------------------------------------------------
create policy programs_select on public.programs for select to authenticated
  using (public.tenant_can(organization_id, 'programs', 'view')
         or id in (select public.my_beneficiary_program_ids()) or id in (select public.my_expert_program_ids()));
create policy programs_insert on public.programs for insert to authenticated
  with check (public.tenant_can(organization_id, 'programs', 'create'));
create policy programs_update on public.programs for update to authenticated
  using (public.tenant_can(organization_id, 'programs', 'edit')) with check (public.tenant_can(organization_id, 'programs', 'edit'));
create policy programs_delete on public.programs for delete to authenticated
  using (public.tenant_can(organization_id, 'programs', 'delete'));

create policy stages_select on public.program_stages for select to authenticated
  using (public.tenant_can(organization_id, 'programs', 'view')
         or program_id in (select public.my_beneficiary_program_ids()) or program_id in (select public.my_expert_program_ids()));
create policy stages_insert on public.program_stages for insert to authenticated
  with check (public.tenant_can(organization_id, 'programs', 'configure'));
create policy stages_update on public.program_stages for update to authenticated
  using (public.tenant_can(organization_id, 'programs', 'configure')) with check (public.tenant_can(organization_id, 'programs', 'configure'));
create policy stages_delete on public.program_stages for delete to authenticated
  using (public.tenant_can(organization_id, 'programs', 'configure'));

create policy enrollments_select on public.program_enrollments for select to authenticated
  using (public.tenant_can(organization_id, 'programs', 'view') or beneficiary_id in (select public.my_beneficiary_ids()));
create policy enrollments_insert on public.program_enrollments for insert to authenticated
  with check (public.tenant_can(organization_id, 'programs', 'create'));
create policy enrollments_update on public.program_enrollments for update to authenticated
  using (public.tenant_can(organization_id, 'programs', 'edit')) with check (public.tenant_can(organization_id, 'programs', 'edit'));
create policy enrollments_delete on public.program_enrollments for delete to authenticated
  using (public.tenant_can(organization_id, 'programs', 'delete'));

create policy stage_records_select on public.program_stage_records for select to authenticated
  using (public.tenant_can(organization_id, 'programs', 'view') or created_by = auth.uid()
         or beneficiary_id in (select public.my_beneficiary_ids()));
create policy stage_records_insert on public.program_stage_records for insert to authenticated
  with check (public.tenant_can(organization_id, 'programs', 'create')
              or (created_by = auth.uid() and program_id in (select public.my_expert_program_ids())));
create policy stage_records_update on public.program_stage_records for update to authenticated
  using (public.tenant_can(organization_id, 'programs', 'edit') or (created_by = auth.uid() and program_id in (select public.my_expert_program_ids())))
  with check (public.tenant_can(organization_id, 'programs', 'edit') or (created_by = auth.uid() and program_id in (select public.my_expert_program_ids())));
create policy stage_records_delete on public.program_stage_records for delete to authenticated
  using (public.tenant_can(organization_id, 'programs', 'delete'));

create policy certificates_select on public.certificates for select to authenticated
  using (public.tenant_can(organization_id, 'programs', 'view') or beneficiary_id in (select public.my_beneficiary_ids()));
create policy certificates_write on public.certificates for all to authenticated
  using (public.tenant_can(organization_id, 'programs', 'edit')) with check (public.tenant_can(organization_id, 'programs', 'edit'));

-- -----------------------------------------------------------------------------
-- Operations
-- -----------------------------------------------------------------------------
create policy sessions_select on public.sessions for select to authenticated
  using (public.tenant_can(organization_id, 'operations', 'view') or id in (select public.my_session_ids()));
create policy sessions_insert on public.sessions for insert to authenticated
  with check (public.tenant_can(organization_id, 'operations', 'create'));
create policy sessions_update on public.sessions for update to authenticated
  using (public.tenant_can(organization_id, 'operations', 'edit') or expert_id in (select public.my_expert_ids()))
  with check (public.tenant_can(organization_id, 'operations', 'edit') or expert_id in (select public.my_expert_ids()));
create policy sessions_delete on public.sessions for delete to authenticated
  using (public.tenant_can(organization_id, 'operations', 'delete'));

create policy participants_select on public.session_participants for select to authenticated
  using (public.tenant_can(organization_id, 'operations', 'view') or beneficiary_id in (select public.my_beneficiary_ids())
         or session_id in (select s.id from public.sessions s where s.expert_id in (select public.my_expert_ids())));
create policy participants_insert on public.session_participants for insert to authenticated
  with check (public.tenant_can(organization_id, 'operations', 'create'));
create policy participants_update on public.session_participants for update to authenticated
  using (public.tenant_can(organization_id, 'operations', 'edit')
         or session_id in (select s.id from public.sessions s where s.expert_id in (select public.my_expert_ids())))
  with check (public.tenant_can(organization_id, 'operations', 'edit')
         or session_id in (select s.id from public.sessions s where s.expert_id in (select public.my_expert_ids())));
create policy participants_delete on public.session_participants for delete to authenticated
  using (public.tenant_can(organization_id, 'operations', 'delete'));

create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid() or public.tenant_can(organization_id, 'notifications', 'configure'));
create policy notifications_insert on public.notifications for insert to authenticated
  with check (public.tenant_can(organization_id, 'notifications', 'create'));

create policy feed_tokens_select on public.calendar_feed_tokens for select to authenticated
  using (user_id = auth.uid());
create policy feed_tokens_revoke on public.calendar_feed_tokens for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Assessments / forms / maturity with self-service
-- -----------------------------------------------------------------------------
create policy results_select on public.assessment_results for select to authenticated
  using (public.tenant_can(organization_id, 'assessments', 'view') or beneficiary_id in (select public.my_beneficiary_ids())
         or assessor_user_id = auth.uid());
create policy results_insert on public.assessment_results for insert to authenticated
  with check (public.tenant_can(organization_id, 'assessments', 'create')
              or (assessor_user_id = auth.uid() and program_id in (select public.my_expert_program_ids())));
create policy results_update on public.assessment_results for update to authenticated
  using (public.tenant_can(organization_id, 'assessments', 'edit') or public.tenant_can(organization_id, 'assessments', 'verify')
         or (assessor_user_id = auth.uid() and status in ('draft','submitted')))
  with check (public.tenant_can(organization_id, 'assessments', 'edit') or public.tenant_can(organization_id, 'assessments', 'verify')
         or (assessor_user_id = auth.uid() and status in ('draft','submitted')));
create policy results_delete on public.assessment_results for delete to authenticated
  using (public.tenant_can(organization_id, 'assessments', 'delete'));

create policy maturity_select on public.maturity_assessments for select to authenticated
  using (public.tenant_can(organization_id, 'assessments', 'view') or beneficiary_id in (select public.my_beneficiary_ids()));
create policy maturity_insert on public.maturity_assessments for insert to authenticated
  with check (public.tenant_can(organization_id, 'assessments', 'create')
              or (assessed_by = auth.uid() and program_id in (select public.my_expert_program_ids())));
create policy maturity_update on public.maturity_assessments for update to authenticated
  using (public.tenant_can(organization_id, 'assessments', 'edit')) with check (public.tenant_can(organization_id, 'assessments', 'edit'));
create policy maturity_delete on public.maturity_assessments for delete to authenticated
  using (public.tenant_can(organization_id, 'assessments', 'delete'));

create policy submissions_select on public.form_submissions for select to authenticated
  using (public.tenant_can(organization_id, 'templates', 'view') or submitted_by = auth.uid()
         or beneficiary_id in (select public.my_beneficiary_ids()));
create policy submissions_insert on public.form_submissions for insert to authenticated
  with check (public.tenant_can(organization_id, 'templates', 'create')
              or (submitted_by = auth.uid() and public.is_org_member(organization_id)
                  and (beneficiary_id is null or beneficiary_id in (select public.my_beneficiary_ids()))));
create policy submissions_update on public.form_submissions for update to authenticated
  using (public.tenant_can(organization_id, 'templates', 'edit') or public.tenant_can(organization_id, 'templates', 'approve')
         or (submitted_by = auth.uid() and status in ('draft','submitted')))
  with check (public.tenant_can(organization_id, 'templates', 'edit') or public.tenant_can(organization_id, 'templates', 'approve')
         or (submitted_by = auth.uid() and status in ('draft','submitted')));
create policy submissions_delete on public.form_submissions for delete to authenticated
  using (public.tenant_can(organization_id, 'templates', 'delete'));

-- -----------------------------------------------------------------------------
-- Evidence (uploaders can see their own submissions)
-- -----------------------------------------------------------------------------
create policy evidence_select on public.evidence for select to authenticated
  using (public.tenant_can(organization_id, 'evidence', 'view') or uploaded_by = auth.uid());
create policy evidence_insert on public.evidence for insert to authenticated
  with check (public.tenant_can(organization_id, 'evidence', 'create'));
create policy evidence_update on public.evidence for update to authenticated
  using (public.tenant_can(organization_id, 'evidence', 'edit') or public.tenant_can(organization_id, 'evidence', 'verify'))
  with check (public.tenant_can(organization_id, 'evidence', 'edit') or public.tenant_can(organization_id, 'evidence', 'verify'));
create policy evidence_delete on public.evidence for delete to authenticated
  using (public.tenant_can(organization_id, 'evidence', 'delete'));

-- Uploaders may read back their own storage objects
drop policy if exists tanmia_storage_select_own on storage.objects;
create policy tanmia_storage_select_own on storage.objects for select to authenticated
  using (bucket_id in ('evidence','documents','imports') and owner = auth.uid()
         and public.is_org_member(public.storage_org_id(name)));

-- -----------------------------------------------------------------------------
-- Governance specials
-- -----------------------------------------------------------------------------
create policy approvals_select on public.approval_requests for select to authenticated
  using (public.tenant_can(organization_id, 'governance', 'view') or requested_by = auth.uid() or approver_user_id = auth.uid());
-- Requesters may cancel their own pending requests (decisions go through decide_approval).
create or replace function public.cancel_approval(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.approval_requests set status = 'cancelled', decided_at = now(), decided_by = auth.uid()
   where id = p_id and status = 'pending' and (requested_by = auth.uid() or public.tenant_can(organization_id, 'governance', 'approve'));
  if not found then raise exception 'Approval cannot be cancelled' using errcode = '42501'; end if;
end $$;

-- The governance module cannot be switched off by an organization (it hosts module settings).
create or replace function public.tg_governance_module_lock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.module_key = 'governance' and not new.enabled and auth.uid() is not null and not public.is_platform_super_admin() then
    raise exception 'The governance module can only be deactivated by the platform owner' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger t30_governance_lock before insert or update on public.organization_modules
  for each row execute function public.tg_governance_module_lock();

create policy approvals_insert on public.approval_requests for insert to authenticated
  with check (public.is_org_member(organization_id) and requested_by = auth.uid() and status = 'pending');

create policy insights_select on public.ai_insights for select to authenticated
  using (public.tenant_can(organization_id, 'programs', 'view'));

create policy settings_select on public.system_settings for select to authenticated
  using (organization_id is null or public.is_org_member(organization_id));
create policy settings_write on public.system_settings for all to authenticated
  using (case when organization_id is null then public.is_platform_super_admin() else public.tenant_can(organization_id, 'governance', 'configure') end)
  with check (case when organization_id is null then public.is_platform_super_admin() else public.tenant_can(organization_id, 'governance', 'configure') end);

create policy integrations_select on public.integration_settings for select to authenticated
  using (case when organization_id is null then true else public.tenant_can(organization_id, 'governance', 'view') end);
create policy integrations_write on public.integration_settings for all to authenticated
  using (case when organization_id is null then public.is_platform_super_admin() else public.tenant_can(organization_id, 'governance', 'configure') end)
  with check (case when organization_id is null then public.is_platform_super_admin() else public.tenant_can(organization_id, 'governance', 'configure') end);

-- -----------------------------------------------------------------------------
-- Grants: anon gets nothing; authenticated is governed entirely by RLS
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on public.entity_counters from authenticated;
revoke insert, update, delete on public.audit_log from authenticated;
revoke execute on function public.next_entity_code(uuid, text) from authenticated, anon;
revoke execute on function public.write_audit(uuid, text, text, text, text, jsonb, text) from authenticated, anon;
revoke execute on function public.promote_platform_super_admin(text) from authenticated, anon;

-- ===================== 20261005000800_reference_data.sql =====================
-- =============================================================================
-- TANMIA — 0800 Reference data (GENERATED by scripts/generate-reference-seed.ts)
-- Permissions catalog, platform role templates, the six program tracks, central
-- maturity / impact / assessment / form templates. Idempotent.
-- =============================================================================

-- Permissions
insert into public.permissions (code, module, action, name_ar, name_en) values
  ('programs.view', 'programs', 'view', 'عرض البرامج', 'View Programs'),
  ('programs.create', 'programs', 'create', 'إنشاء البرامج', 'Create Programs'),
  ('programs.edit', 'programs', 'edit', 'تعديل البرامج', 'Edit Programs'),
  ('programs.delete', 'programs', 'delete', 'حذف البرامج', 'Delete Programs'),
  ('programs.approve', 'programs', 'approve', 'اعتماد البرامج', 'Approve Programs'),
  ('programs.assign', 'programs', 'assign', 'إسناد البرامج', 'Assign Programs'),
  ('programs.export', 'programs', 'export', 'تصدير البرامج', 'Export Programs'),
  ('programs.configure', 'programs', 'configure', 'تهيئة البرامج', 'Configure Programs'),
  ('programs.verify', 'programs', 'verify', 'تحقق البرامج', 'Verify Programs'),
  ('beneficiaries.view', 'beneficiaries', 'view', 'عرض المستفيدون', 'View Beneficiaries'),
  ('beneficiaries.create', 'beneficiaries', 'create', 'إنشاء المستفيدون', 'Create Beneficiaries'),
  ('beneficiaries.edit', 'beneficiaries', 'edit', 'تعديل المستفيدون', 'Edit Beneficiaries'),
  ('beneficiaries.delete', 'beneficiaries', 'delete', 'حذف المستفيدون', 'Delete Beneficiaries'),
  ('beneficiaries.approve', 'beneficiaries', 'approve', 'اعتماد المستفيدون', 'Approve Beneficiaries'),
  ('beneficiaries.assign', 'beneficiaries', 'assign', 'إسناد المستفيدون', 'Assign Beneficiaries'),
  ('beneficiaries.export', 'beneficiaries', 'export', 'تصدير المستفيدون', 'Export Beneficiaries'),
  ('beneficiaries.configure', 'beneficiaries', 'configure', 'تهيئة المستفيدون', 'Configure Beneficiaries'),
  ('beneficiaries.verify', 'beneficiaries', 'verify', 'تحقق المستفيدون', 'Verify Beneficiaries'),
  ('experts.view', 'experts', 'view', 'عرض الخبراء', 'View Experts'),
  ('experts.create', 'experts', 'create', 'إنشاء الخبراء', 'Create Experts'),
  ('experts.edit', 'experts', 'edit', 'تعديل الخبراء', 'Edit Experts'),
  ('experts.delete', 'experts', 'delete', 'حذف الخبراء', 'Delete Experts'),
  ('experts.approve', 'experts', 'approve', 'اعتماد الخبراء', 'Approve Experts'),
  ('experts.assign', 'experts', 'assign', 'إسناد الخبراء', 'Assign Experts'),
  ('experts.export', 'experts', 'export', 'تصدير الخبراء', 'Export Experts'),
  ('experts.configure', 'experts', 'configure', 'تهيئة الخبراء', 'Configure Experts'),
  ('experts.verify', 'experts', 'verify', 'تحقق الخبراء', 'Verify Experts'),
  ('vendors.view', 'vendors', 'view', 'عرض الموردون', 'View Vendors'),
  ('vendors.create', 'vendors', 'create', 'إنشاء الموردون', 'Create Vendors'),
  ('vendors.edit', 'vendors', 'edit', 'تعديل الموردون', 'Edit Vendors'),
  ('vendors.delete', 'vendors', 'delete', 'حذف الموردون', 'Delete Vendors'),
  ('vendors.approve', 'vendors', 'approve', 'اعتماد الموردون', 'Approve Vendors'),
  ('vendors.assign', 'vendors', 'assign', 'إسناد الموردون', 'Assign Vendors'),
  ('vendors.export', 'vendors', 'export', 'تصدير الموردون', 'Export Vendors'),
  ('vendors.configure', 'vendors', 'configure', 'تهيئة الموردون', 'Configure Vendors'),
  ('vendors.verify', 'vendors', 'verify', 'تحقق الموردون', 'Verify Vendors'),
  ('partners.view', 'partners', 'view', 'عرض الشركاء', 'View Partners'),
  ('partners.create', 'partners', 'create', 'إنشاء الشركاء', 'Create Partners'),
  ('partners.edit', 'partners', 'edit', 'تعديل الشركاء', 'Edit Partners'),
  ('partners.delete', 'partners', 'delete', 'حذف الشركاء', 'Delete Partners'),
  ('partners.approve', 'partners', 'approve', 'اعتماد الشركاء', 'Approve Partners'),
  ('partners.assign', 'partners', 'assign', 'إسناد الشركاء', 'Assign Partners'),
  ('partners.export', 'partners', 'export', 'تصدير الشركاء', 'Export Partners'),
  ('partners.configure', 'partners', 'configure', 'تهيئة الشركاء', 'Configure Partners'),
  ('partners.verify', 'partners', 'verify', 'تحقق الشركاء', 'Verify Partners'),
  ('operations.view', 'operations', 'view', 'عرض التشغيل والجدولة', 'View Operations'),
  ('operations.create', 'operations', 'create', 'إنشاء التشغيل والجدولة', 'Create Operations'),
  ('operations.edit', 'operations', 'edit', 'تعديل التشغيل والجدولة', 'Edit Operations'),
  ('operations.delete', 'operations', 'delete', 'حذف التشغيل والجدولة', 'Delete Operations'),
  ('operations.approve', 'operations', 'approve', 'اعتماد التشغيل والجدولة', 'Approve Operations'),
  ('operations.assign', 'operations', 'assign', 'إسناد التشغيل والجدولة', 'Assign Operations'),
  ('operations.export', 'operations', 'export', 'تصدير التشغيل والجدولة', 'Export Operations'),
  ('operations.configure', 'operations', 'configure', 'تهيئة التشغيل والجدولة', 'Configure Operations'),
  ('operations.verify', 'operations', 'verify', 'تحقق التشغيل والجدولة', 'Verify Operations'),
  ('assessments.view', 'assessments', 'view', 'عرض التقييم والجودة', 'View Assessments'),
  ('assessments.create', 'assessments', 'create', 'إنشاء التقييم والجودة', 'Create Assessments'),
  ('assessments.edit', 'assessments', 'edit', 'تعديل التقييم والجودة', 'Edit Assessments'),
  ('assessments.delete', 'assessments', 'delete', 'حذف التقييم والجودة', 'Delete Assessments'),
  ('assessments.approve', 'assessments', 'approve', 'اعتماد التقييم والجودة', 'Approve Assessments'),
  ('assessments.assign', 'assessments', 'assign', 'إسناد التقييم والجودة', 'Assign Assessments'),
  ('assessments.export', 'assessments', 'export', 'تصدير التقييم والجودة', 'Export Assessments'),
  ('assessments.configure', 'assessments', 'configure', 'تهيئة التقييم والجودة', 'Configure Assessments'),
  ('assessments.verify', 'assessments', 'verify', 'تحقق التقييم والجودة', 'Verify Assessments'),
  ('evidence.view', 'evidence', 'view', 'عرض الأدلة والوثائق', 'View Evidence'),
  ('evidence.create', 'evidence', 'create', 'إنشاء الأدلة والوثائق', 'Create Evidence'),
  ('evidence.edit', 'evidence', 'edit', 'تعديل الأدلة والوثائق', 'Edit Evidence'),
  ('evidence.delete', 'evidence', 'delete', 'حذف الأدلة والوثائق', 'Delete Evidence'),
  ('evidence.approve', 'evidence', 'approve', 'اعتماد الأدلة والوثائق', 'Approve Evidence'),
  ('evidence.assign', 'evidence', 'assign', 'إسناد الأدلة والوثائق', 'Assign Evidence'),
  ('evidence.export', 'evidence', 'export', 'تصدير الأدلة والوثائق', 'Export Evidence'),
  ('evidence.configure', 'evidence', 'configure', 'تهيئة الأدلة والوثائق', 'Configure Evidence'),
  ('evidence.verify', 'evidence', 'verify', 'تحقق الأدلة والوثائق', 'Verify Evidence'),
  ('outcomes.view', 'outcomes', 'view', 'عرض المخرجات والنتائج', 'View Outputs & outcomes'),
  ('outcomes.create', 'outcomes', 'create', 'إنشاء المخرجات والنتائج', 'Create Outputs & outcomes'),
  ('outcomes.edit', 'outcomes', 'edit', 'تعديل المخرجات والنتائج', 'Edit Outputs & outcomes'),
  ('outcomes.delete', 'outcomes', 'delete', 'حذف المخرجات والنتائج', 'Delete Outputs & outcomes'),
  ('outcomes.approve', 'outcomes', 'approve', 'اعتماد المخرجات والنتائج', 'Approve Outputs & outcomes'),
  ('outcomes.assign', 'outcomes', 'assign', 'إسناد المخرجات والنتائج', 'Assign Outputs & outcomes'),
  ('outcomes.export', 'outcomes', 'export', 'تصدير المخرجات والنتائج', 'Export Outputs & outcomes'),
  ('outcomes.configure', 'outcomes', 'configure', 'تهيئة المخرجات والنتائج', 'Configure Outputs & outcomes'),
  ('outcomes.verify', 'outcomes', 'verify', 'تحقق المخرجات والنتائج', 'Verify Outputs & outcomes'),
  ('impact.view', 'impact', 'view', 'عرض الأثر', 'View Impact'),
  ('impact.create', 'impact', 'create', 'إنشاء الأثر', 'Create Impact'),
  ('impact.edit', 'impact', 'edit', 'تعديل الأثر', 'Edit Impact'),
  ('impact.delete', 'impact', 'delete', 'حذف الأثر', 'Delete Impact'),
  ('impact.approve', 'impact', 'approve', 'اعتماد الأثر', 'Approve Impact'),
  ('impact.assign', 'impact', 'assign', 'إسناد الأثر', 'Assign Impact'),
  ('impact.export', 'impact', 'export', 'تصدير الأثر', 'Export Impact'),
  ('impact.configure', 'impact', 'configure', 'تهيئة الأثر', 'Configure Impact'),
  ('impact.verify', 'impact', 'verify', 'تحقق الأثر', 'Verify Impact'),
  ('templates.view', 'templates', 'view', 'عرض القوالب والنماذج', 'View Templates & forms'),
  ('templates.create', 'templates', 'create', 'إنشاء القوالب والنماذج', 'Create Templates & forms'),
  ('templates.edit', 'templates', 'edit', 'تعديل القوالب والنماذج', 'Edit Templates & forms'),
  ('templates.delete', 'templates', 'delete', 'حذف القوالب والنماذج', 'Delete Templates & forms'),
  ('templates.approve', 'templates', 'approve', 'اعتماد القوالب والنماذج', 'Approve Templates & forms'),
  ('templates.assign', 'templates', 'assign', 'إسناد القوالب والنماذج', 'Assign Templates & forms'),
  ('templates.export', 'templates', 'export', 'تصدير القوالب والنماذج', 'Export Templates & forms'),
  ('templates.configure', 'templates', 'configure', 'تهيئة القوالب والنماذج', 'Configure Templates & forms'),
  ('templates.verify', 'templates', 'verify', 'تحقق القوالب والنماذج', 'Verify Templates & forms'),
  ('reports.view', 'reports', 'view', 'عرض التقارير', 'View Reports'),
  ('reports.create', 'reports', 'create', 'إنشاء التقارير', 'Create Reports'),
  ('reports.edit', 'reports', 'edit', 'تعديل التقارير', 'Edit Reports'),
  ('reports.delete', 'reports', 'delete', 'حذف التقارير', 'Delete Reports'),
  ('reports.approve', 'reports', 'approve', 'اعتماد التقارير', 'Approve Reports'),
  ('reports.assign', 'reports', 'assign', 'إسناد التقارير', 'Assign Reports'),
  ('reports.export', 'reports', 'export', 'تصدير التقارير', 'Export Reports'),
  ('reports.configure', 'reports', 'configure', 'تهيئة التقارير', 'Configure Reports'),
  ('reports.verify', 'reports', 'verify', 'تحقق التقارير', 'Verify Reports'),
  ('governance.view', 'governance', 'view', 'عرض الحوكمة', 'View Governance'),
  ('governance.create', 'governance', 'create', 'إنشاء الحوكمة', 'Create Governance'),
  ('governance.edit', 'governance', 'edit', 'تعديل الحوكمة', 'Edit Governance'),
  ('governance.delete', 'governance', 'delete', 'حذف الحوكمة', 'Delete Governance'),
  ('governance.approve', 'governance', 'approve', 'اعتماد الحوكمة', 'Approve Governance'),
  ('governance.assign', 'governance', 'assign', 'إسناد الحوكمة', 'Assign Governance'),
  ('governance.export', 'governance', 'export', 'تصدير الحوكمة', 'Export Governance'),
  ('governance.configure', 'governance', 'configure', 'تهيئة الحوكمة', 'Configure Governance'),
  ('governance.verify', 'governance', 'verify', 'تحقق الحوكمة', 'Verify Governance'),
  ('notifications.view', 'notifications', 'view', 'عرض الإشعارات', 'View Notifications'),
  ('notifications.create', 'notifications', 'create', 'إنشاء الإشعارات', 'Create Notifications'),
  ('notifications.edit', 'notifications', 'edit', 'تعديل الإشعارات', 'Edit Notifications'),
  ('notifications.delete', 'notifications', 'delete', 'حذف الإشعارات', 'Delete Notifications'),
  ('notifications.approve', 'notifications', 'approve', 'اعتماد الإشعارات', 'Approve Notifications'),
  ('notifications.assign', 'notifications', 'assign', 'إسناد الإشعارات', 'Assign Notifications'),
  ('notifications.export', 'notifications', 'export', 'تصدير الإشعارات', 'Export Notifications'),
  ('notifications.configure', 'notifications', 'configure', 'تهيئة الإشعارات', 'Configure Notifications'),
  ('notifications.verify', 'notifications', 'verify', 'تحقق الإشعارات', 'Verify Notifications'),
  ('users.view', 'users', 'view', 'عرض المستخدمون', 'View Users'),
  ('users.create', 'users', 'create', 'إنشاء المستخدمون', 'Create Users'),
  ('users.edit', 'users', 'edit', 'تعديل المستخدمون', 'Edit Users'),
  ('users.delete', 'users', 'delete', 'حذف المستخدمون', 'Delete Users'),
  ('users.approve', 'users', 'approve', 'اعتماد المستخدمون', 'Approve Users'),
  ('users.assign', 'users', 'assign', 'إسناد المستخدمون', 'Assign Users'),
  ('users.export', 'users', 'export', 'تصدير المستخدمون', 'Export Users'),
  ('users.configure', 'users', 'configure', 'تهيئة المستخدمون', 'Configure Users'),
  ('users.verify', 'users', 'verify', 'تحقق المستخدمون', 'Verify Users')
on conflict (code) do update set name_ar = excluded.name_ar, name_en = excluded.name_en;

-- Platform role templates (organization_id is null) and their permission bundles
insert into public.roles (organization_id, code, name_ar, name_en, description, is_system) values (null, 'org_admin', 'مدير المؤسسة', 'Organization Admin', 'إدارة المؤسسة ومستخدميها وبرامجها وإعداداتها', true)
on conflict (organization_id, code) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, description = excluded.description;
insert into public.role_permissions (role_id, permission_id) select r.id, p.id from public.roles r join public.permissions p on ((p.module = 'programs') or (p.module = 'beneficiaries') or (p.module = 'experts') or (p.module = 'vendors') or (p.module = 'partners') or (p.module = 'operations') or (p.module = 'assessments') or (p.module = 'evidence') or (p.module = 'outcomes') or (p.module = 'impact') or (p.module = 'templates') or (p.module = 'reports') or (p.module = 'governance') or (p.module = 'notifications') or (p.module = 'users'))
where r.organization_id is null and r.code = 'org_admin' on conflict do nothing;
insert into public.roles (organization_id, code, name_ar, name_en, description, is_system) values (null, 'program_manager', 'مدير البرامج', 'Program Manager', 'إدارة البرامج والرحلات والمستفيدين والتقارير', true)
on conflict (organization_id, code) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, description = excluded.description;
insert into public.role_permissions (role_id, permission_id) select r.id, p.id from public.roles r join public.permissions p on ((p.module = 'programs') or (p.module = 'beneficiaries' and p.action in ('view','create','edit','export','assign')) or (p.module = 'experts' and p.action in ('view','create','edit','assign','export')) or (p.module = 'vendors' and p.action in ('view','export')) or (p.module = 'partners' and p.action in ('view','create','edit','export')) or (p.module = 'operations') or (p.module = 'assessments' and p.action in ('view','export')) or (p.module = 'evidence' and p.action in ('view','create','export')) or (p.module = 'outcomes') or (p.module = 'impact' and p.action in ('view','export')) or (p.module = 'templates' and p.action in ('view','create','edit')) or (p.module = 'reports' and p.action in ('view','create','edit','export')) or (p.module = 'governance' and p.action in ('view','create')) or (p.module = 'notifications' and p.action in ('view','create')) or (p.module = 'users' and p.action in ('view')))
where r.organization_id is null and r.code = 'program_manager' on conflict do nothing;
insert into public.roles (organization_id, code, name_ar, name_en, description, is_system) values (null, 'operations_manager', 'مدير التشغيل', 'Operations Manager', 'الجدولة والجلسات والحضور والإسنادات والموردين', true)
on conflict (organization_id, code) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, description = excluded.description;
insert into public.role_permissions (role_id, permission_id) select r.id, p.id from public.roles r join public.permissions p on ((p.module = 'operations') or (p.module = 'programs' and p.action in ('view','edit')) or (p.module = 'beneficiaries' and p.action in ('view','create','edit','export')) or (p.module = 'experts' and p.action in ('view','create','edit','assign','export')) or (p.module = 'vendors') or (p.module = 'partners' and p.action in ('view')) or (p.module = 'evidence' and p.action in ('view','create')) or (p.module = 'notifications' and p.action in ('view','create','configure')) or (p.module = 'governance' and p.action in ('view')) or (p.module = 'reports' and p.action in ('view')))
where r.organization_id is null and r.code = 'operations_manager' on conflict do nothing;
insert into public.roles (organization_id, code, name_ar, name_en, description, is_system) values (null, 'impact_officer', 'مسؤول القياس والأثر', 'Impact / Measurement Officer', 'المؤشرات والنضج والأثر والأدلة', true)
on conflict (organization_id, code) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, description = excluded.description;
insert into public.role_permissions (role_id, permission_id) select r.id, p.id from public.roles r join public.permissions p on ((p.module = 'impact') or (p.module = 'outcomes') or (p.module = 'assessments' and p.action in ('view','create','edit','export')) or (p.module = 'evidence' and p.action in ('view','create','edit','verify','export')) or (p.module = 'reports' and p.action in ('view','create','edit','export')) or (p.module = 'programs' and p.action in ('view')) or (p.module = 'beneficiaries' and p.action in ('view')) or (p.module = 'operations' and p.action in ('view')))
where r.organization_id is null and r.code = 'impact_officer' on conflict do nothing;
insert into public.roles (organization_id, code, name_ar, name_en, description, is_system) values (null, 'quality_officer', 'مسؤول الجودة والتقييم', 'Quality / Assessment Officer', 'أدوات التقييم والتحقق والجودة والنماذج', true)
on conflict (organization_id, code) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, description = excluded.description;
insert into public.role_permissions (role_id, permission_id) select r.id, p.id from public.roles r join public.permissions p on ((p.module = 'assessments') or (p.module = 'evidence' and p.action in ('view','create','edit','verify','approve','export')) or (p.module = 'templates') or (p.module = 'programs' and p.action in ('view')) or (p.module = 'beneficiaries' and p.action in ('view')) or (p.module = 'experts' and p.action in ('view')) or (p.module = 'reports' and p.action in ('view','export')) or (p.module = 'operations' and p.action in ('view')))
where r.organization_id is null and r.code = 'quality_officer' on conflict do nothing;
insert into public.roles (organization_id, code, name_ar, name_en, description, is_system) values (null, 'reporting_officer', 'مسؤول التقارير', 'Reporting Officer', 'إعداد التقارير وإصداراتها وتصديرها', true)
on conflict (organization_id, code) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, description = excluded.description;
insert into public.role_permissions (role_id, permission_id) select r.id, p.id from public.roles r join public.permissions p on ((p.module = 'reports' and p.action in ('view','create','edit','export','delete')) or (p.module = 'programs' and p.action in ('view')) or (p.module = 'beneficiaries' and p.action in ('view')) or (p.module = 'outcomes' and p.action in ('view','export')) or (p.module = 'impact' and p.action in ('view','export')) or (p.module = 'assessments' and p.action in ('view','export')) or (p.module = 'evidence' and p.action in ('view','export')) or (p.module = 'governance' and p.action in ('view')) or (p.module = 'operations' and p.action in ('view')) or (p.module = 'experts' and p.action in ('view')))
where r.organization_id is null and r.code = 'reporting_officer' on conflict do nothing;
insert into public.roles (organization_id, code, name_ar, name_en, description, is_system) values (null, 'program_coordinator', 'منسق برنامج', 'Program Coordinator', 'متابعة المستفيدين والجلسات والوثائق', true)
on conflict (organization_id, code) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, description = excluded.description;
insert into public.role_permissions (role_id, permission_id) select r.id, p.id from public.roles r join public.permissions p on ((p.module = 'programs' and p.action in ('view','create','edit')) or (p.module = 'beneficiaries' and p.action in ('view','create','edit')) or (p.module = 'operations' and p.action in ('view','create','edit')) or (p.module = 'evidence' and p.action in ('view','create')) or (p.module = 'templates' and p.action in ('view')) or (p.module = 'experts' and p.action in ('view')) or (p.module = 'outcomes' and p.action in ('view','edit')) or (p.module = 'notifications' and p.action in ('view')))
where r.organization_id is null and r.code = 'program_coordinator' on conflict do nothing;
insert into public.roles (organization_id, code, name_ar, name_en, description, is_system) values (null, 'expert', 'خبير / مدرب / مرشد / محكّم', 'Expert / Trainer / Mentor / Judge', 'الوصول إلى التكليفات والجلسات المصرح بها فقط', true)
on conflict (organization_id, code) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, description = excluded.description;
insert into public.role_permissions (role_id, permission_id) select r.id, p.id from public.roles r join public.permissions p on ((p.module = 'evidence' and p.action in ('create')))
where r.organization_id is null and r.code = 'expert' on conflict do nothing;
insert into public.roles (organization_id, code, name_ar, name_en, description, is_system) values (null, 'beneficiary', 'مستفيد', 'Beneficiary', 'الوصول إلى رحلته ونماذجه ومواعيده فقط', true)
on conflict (organization_id, code) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, description = excluded.description;
insert into public.role_permissions (role_id, permission_id) select r.id, p.id from public.roles r join public.permissions p on ((p.module = 'evidence' and p.action in ('create')))
where r.organization_id is null and r.code = 'beneficiary' on conflict do nothing;
insert into public.roles (organization_id, code, name_ar, name_en, description, is_system) values (null, 'viewer', 'مشاهد / مدقق', 'Viewer / Auditor', 'قراءة وتصدير البيانات والتقارير وسجل التدقيق', true)
on conflict (organization_id, code) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, description = excluded.description;
insert into public.role_permissions (role_id, permission_id) select r.id, p.id from public.roles r join public.permissions p on ((p.module = 'programs' and p.action in ('view','export')) or (p.module = 'beneficiaries' and p.action in ('view','export')) or (p.module = 'experts' and p.action in ('view','export')) or (p.module = 'vendors' and p.action in ('view','export')) or (p.module = 'partners' and p.action in ('view','export')) or (p.module = 'operations' and p.action in ('view','export')) or (p.module = 'assessments' and p.action in ('view','export')) or (p.module = 'evidence' and p.action in ('view','export')) or (p.module = 'outcomes' and p.action in ('view','export')) or (p.module = 'impact' and p.action in ('view','export')) or (p.module = 'templates' and p.action in ('view','export')) or (p.module = 'reports' and p.action in ('view','export')) or (p.module = 'governance' and p.action in ('view','export')) or (p.module = 'notifications' and p.action in ('view','export')) or (p.module = 'users' and p.action in ('view','export')))
where r.organization_id is null and r.code = 'viewer' on conflict do nothing;

-- Program track templates
insert into public.program_track_templates (code, name_ar, name_en, description_ar, description_en, stages, maturity_dimensions, default_indicators, report_sections, session_types) values (
  'hackathon', 'هاكاثون', 'Hackathon', 'من تصميم التحديات إلى التحكيم والجوائز ومتابعة المشاريع وقياس الأثر.', 'From challenge design to judging, awards, project follow-up and impact.',
  '[{"key":"design","name_ar":"التصميم","name_en":"Design","description_ar":"تحديد الهدف والفئة المستهدفة ونطاق الهاكاثون ومعايير النجاح.","description_en":"Define purpose, target group, scope and success criteria.","order":1,"depends_on":[],"required_evidence":["document"],"requires_approval":true,"record_types":["design_decision"]},{"key":"challenges","name_ar":"التحديات","name_en":"Challenges","description_ar":"صياغة التحديات مع أصحابها ومعايير الحلول.","description_en":"Frame challenges with owners and solution criteria.","order":2,"depends_on":["design"],"required_evidence":["document"],"requires_approval":false,"record_types":["challenge"]},{"key":"applications","name_ar":"التقديم","name_en":"Applications","description_ar":"استقبال الطلبات والتحقق من اكتمالها.","description_en":"Receive and check applications.","order":3,"depends_on":["challenges"],"required_evidence":[],"requires_approval":false,"record_types":["application_review"]},{"key":"screening","name_ar":"الفرز","name_en":"Screening","description_ar":"فرز المتقدمين وفق معايير معلنة.","description_en":"Screen applicants against published criteria.","order":4,"depends_on":["applications"],"required_evidence":["minutes"],"requires_approval":true,"record_types":["screening_score"]},{"key":"teams","name_ar":"تكوين الفرق","name_en":"Teams","description_ar":"تكوين فرق متوازنة وربطها بالتحديات.","description_en":"Form balanced teams and link them to challenges.","order":5,"depends_on":["screening"],"required_evidence":[],"requires_approval":false,"record_types":["team_formation"]},{"key":"bootcamp","name_ar":"المعسكر","name_en":"Bootcamp","description_ar":"جلسات تمكين مكثفة قبل التطوير.","description_en":"Intensive enablement sessions before development.","order":6,"depends_on":["teams"],"required_evidence":["attendance_sheet"],"requires_approval":false,"record_types":["session_log"]},{"key":"mentoring","name_ar":"الإرشاد","name_en":"Mentoring","description_ar":"إسناد مرشدين للفرق وتوثيق الجلسات.","description_en":"Assign mentors to teams and log sessions.","order":7,"depends_on":["teams"],"required_evidence":[],"requires_approval":false,"record_types":["mentoring_note"]},{"key":"project_development","name_ar":"تطوير المشاريع","name_en":"Project development","description_ar":"متابعة نقاط المراجعة للمشاريع.","description_en":"Track project checkpoints.","order":8,"depends_on":["teams"],"required_evidence":[],"requires_approval":false,"record_types":["project_checkpoint"]},{"key":"judging","name_ar":"التحكيم","name_en":"Judging","description_ar":"تحكيم المشاريع بمعايير موزونة ومحكّمين دون تعارض مصالح.","description_en":"Judge projects with weighted criteria and conflict-free judges.","order":9,"depends_on":["project_development","mentoring"],"required_evidence":["minutes"],"requires_approval":true,"record_types":["judging_score"]},{"key":"awards","name_ar":"الجوائز","name_en":"Awards","description_ar":"إعلان الفائزين وتسليم الجوائز.","description_en":"Announce winners and deliver awards.","order":10,"depends_on":["judging"],"required_evidence":["photo"],"requires_approval":false,"record_types":["award"]},{"key":"post_tracking","name_ar":"متابعة ما بعد الهاكاثون","name_en":"Post-hackathon tracking","description_ar":"متابعة استمرار المشاريع عند T2–T5.","description_en":"Follow project continuity at T2–T5.","order":11,"depends_on":["awards"],"required_evidence":[],"requires_approval":false,"record_types":["follow_up"]},{"key":"impact","name_ar":"الأثر","name_en":"Impact","description_ar":"قياس النتائج والأثر مقارنة بخط الأساس.","description_en":"Measure outcomes and impact against baseline.","order":12,"depends_on":["post_tracking"],"required_evidence":["survey_data"],"requires_approval":false,"record_types":["impact_measurement"]}]'::jsonb,
  '[{"key":"problem_clarity","name_ar":"وضوح المشكلة","name_en":"Problem clarity","weight":1},{"key":"innovation","name_ar":"الابتكار","name_en":"Innovation","weight":1.2},{"key":"feasibility","name_ar":"الجدوى","name_en":"Feasibility","weight":1},{"key":"execution","name_ar":"قابلية التنفيذ","name_en":"Execution readiness","weight":1},{"key":"expected_impact","name_ar":"الأثر المتوقع","name_en":"Expected impact","weight":1.2}]'::jsonb,
  '[{"key":"applications","name_ar":"عدد الطلبات المستلمة","name_en":"Applications received","indicator_type":"operational","chain_level":"activity","unit":"count","direction":"increase","measurement_points":["T1"]},{"key":"teams_completed","name_ar":"الفرق التي أكملت مشاريعها","name_en":"Teams completing projects","indicator_type":"output","chain_level":"output","unit":"count","direction":"increase","measurement_points":["T1"]},{"key":"prototype_quality","name_ar":"متوسط جودة النماذج الأولية","name_en":"Average prototype quality","indicator_type":"outcome","chain_level":"outcome","outcome_term":"short","unit":"score","direction":"increase","measurement_points":["T0","T1"]},{"key":"projects_continuing","name_ar":"نسبة المشاريع المستمرة بعد 6 أشهر","name_en":"% projects continuing after 6 months","indicator_type":"impact","chain_level":"impact","outcome_term":"long","unit":"percent","direction":"increase","measurement_points":["T4"]}]'::jsonb,
  '["executive_summary","program_information","participation","execution","evaluation","outputs","outcomes","impact","success_stories","lessons_learned","recommendations"]'::jsonb,
  array['workshop','mentoring','judging','event']::text[])
on conflict (code) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, description_ar = excluded.description_ar, description_en = excluded.description_en,
  stages = excluded.stages, maturity_dimensions = excluded.maturity_dimensions, default_indicators = excluded.default_indicators,
  report_sections = excluded.report_sections, session_types = excluded.session_types, version = public.program_track_templates.version + 1, updated_at = now();
insert into public.program_track_templates (code, name_ar, name_en, description_ar, description_en, stages, maturity_dimensions, default_indicators, report_sections, session_types) values (
  'incubator', 'حاضنة أعمال', 'Business incubator', 'من التقديم والتشخيص إلى MVP والتحقق السوقي والنمو والتخرج.', 'From application and diagnostics to MVP, market validation, growth and graduation.',
  '[{"key":"application","name_ar":"التقديم","name_en":"Application","description_ar":"استقبال طلبات المشاريع.","description_en":"Receive venture applications.","order":1,"depends_on":[],"required_evidence":[],"requires_approval":false,"record_types":["application_review"]},{"key":"assessment","name_ar":"التقييم","name_en":"Assessment","description_ar":"تقييم الجاهزية والفريق والفكرة.","description_en":"Assess readiness, team and idea.","order":2,"depends_on":["application"],"required_evidence":["assessment_report"],"requires_approval":false,"record_types":["screening_score"]},{"key":"selection","name_ar":"الاختيار","name_en":"Selection","description_ar":"اعتماد المشاريع المقبولة.","description_en":"Approve accepted ventures.","order":3,"depends_on":["assessment"],"required_evidence":["minutes"],"requires_approval":true,"record_types":[]},{"key":"business_diagnostic","name_ar":"تشخيص الأعمال","name_en":"Business diagnostic","description_ar":"تشخيص نموذج العمل والسوق والمنتج والمالية.","description_en":"Diagnose business model, market, product and finance.","order":4,"depends_on":["selection"],"required_evidence":["assessment_report"],"requires_approval":false,"record_types":["business_diagnostic"]},{"key":"incubation_plan","name_ar":"خطة الاحتضان","name_en":"Incubation plan","description_ar":"خطة احتضان لكل مشروع مرتبطة بالفجوات.","description_en":"Per-venture plan tied to diagnosed gaps.","order":5,"depends_on":["business_diagnostic"],"required_evidence":["document"],"requires_approval":true,"record_types":["incubation_plan"]},{"key":"mentoring","name_ar":"الإرشاد","name_en":"Mentoring","description_ar":"جلسات إرشاد واستشارات متخصصة.","description_en":"Mentoring and specialist advisory.","order":6,"depends_on":["incubation_plan"],"required_evidence":[],"requires_approval":false,"record_types":["mentoring_note"]},{"key":"milestones","name_ar":"المعالم","name_en":"Milestones","description_ar":"متابعة معالم الخطة.","description_en":"Track plan milestones.","order":7,"depends_on":["incubation_plan"],"required_evidence":[],"requires_approval":false,"record_types":["milestone_check"]},{"key":"mvp","name_ar":"النموذج الأولي (MVP)","name_en":"MVP","description_ar":"بناء واختبار النموذج الأولي.","description_en":"Build and test the MVP.","order":8,"depends_on":["milestones"],"required_evidence":["product"],"requires_approval":false,"record_types":["mvp_checkpoint"]},{"key":"market_validation","name_ar":"التحقق السوقي","name_en":"Market validation","description_ar":"إثبات الطلب والعملاء الدافعين.","description_en":"Prove demand and paying customers.","order":9,"depends_on":["mvp"],"required_evidence":["dataset"],"requires_approval":false,"record_types":["market_validation"]},{"key":"growth","name_ar":"النمو","name_en":"Growth","description_ar":"تتبع الإيرادات والتوظيف.","description_en":"Track revenue and hiring.","order":10,"depends_on":["market_validation"],"required_evidence":[],"requires_approval":false,"record_types":["growth_metric"]},{"key":"graduation","name_ar":"التخرج","name_en":"Graduation","description_ar":"قرار التخرج وفق معايير معتمدة.","description_en":"Graduation decision against approved criteria.","order":11,"depends_on":["growth"],"required_evidence":["certificate"],"requires_approval":true,"record_types":["graduation_decision"]},{"key":"post_incubation","name_ar":"ما بعد الاحتضان","name_en":"Post-incubation","description_ar":"متابعة المشاريع بعد التخرج.","description_en":"Follow ventures after graduation.","order":12,"depends_on":["graduation"],"required_evidence":[],"requires_approval":false,"record_types":["follow_up","growth_metric"]},{"key":"impact","name_ar":"الأثر","name_en":"Impact","description_ar":"قياس الأثر الاقتصادي والاجتماعي.","description_en":"Measure economic and social impact.","order":13,"depends_on":["post_incubation"],"required_evidence":["survey_data"],"requires_approval":false,"record_types":["impact_measurement"]}]'::jsonb,
  '[{"key":"business_model","name_ar":"نموذج العمل","name_en":"Business model","weight":1.2},{"key":"market","name_ar":"السوق","name_en":"Market","weight":1.2},{"key":"product","name_ar":"المنتج","name_en":"Product","weight":1},{"key":"operations","name_ar":"التشغيل","name_en":"Operations","weight":0.8},{"key":"finance","name_ar":"المالية","name_en":"Finance","weight":1},{"key":"governance","name_ar":"الحوكمة","name_en":"Governance","weight":0.8},{"key":"sustainability","name_ar":"الاستدامة","name_en":"Sustainability","weight":1}]'::jsonb,
  '[{"key":"ventures_incubated","name_ar":"المشاريع المحتضنة","name_en":"Ventures incubated","indicator_type":"output","chain_level":"output","unit":"count","direction":"increase","measurement_points":["T1"]},{"key":"mentoring_hours","name_ar":"ساعات الإرشاد المقدمة","name_en":"Mentoring hours delivered","indicator_type":"operational","chain_level":"activity","unit":"hours","direction":"increase","measurement_points":["T1"]},{"key":"ventures_revenue","name_ar":"نسبة المشاريع المحققة لإيرادات","name_en":"% ventures generating revenue","indicator_type":"outcome","chain_level":"outcome","outcome_term":"medium","unit":"percent","direction":"increase","measurement_points":["T0","T1","T3","T4"]},{"key":"jobs_created","name_ar":"الوظائف المستحدثة","name_en":"Jobs created","indicator_type":"impact","chain_level":"impact","outcome_term":"long","unit":"count","direction":"increase","measurement_points":["T0","T4","T5"]}]'::jsonb,
  '["executive_summary","program_information","target_group","execution","participation","evaluation","maturity","outputs","outcomes","impact","success_stories","challenges","lessons_learned","recommendations"]'::jsonb,
  array['mentoring','consulting','workshop','assessment']::text[])
on conflict (code) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, description_ar = excluded.description_ar, description_en = excluded.description_en,
  stages = excluded.stages, maturity_dimensions = excluded.maturity_dimensions, default_indicators = excluded.default_indicators,
  report_sections = excluded.report_sections, session_types = excluded.session_types, version = public.program_track_templates.version + 1, updated_at = now();
insert into public.program_track_templates (code, name_ar, name_en, description_ar, description_en, stages, maturity_dimensions, default_indicators, report_sections, session_types) values (
  'vocational', 'برنامج مهني / حرفي', 'Vocational / craft program', 'من التسجيل وقياس المهارة القبلي إلى الشهادة والتوظيف ومتابعة الأثر.', 'From registration and baseline skill assessment to certification, employment and impact follow-up.',
  '[{"key":"registration","name_ar":"التسجيل","name_en":"Registration","description_ar":"تسجيل المتدربين والتحقق من البيانات.","description_en":"Register trainees and validate data.","order":1,"depends_on":[],"required_evidence":[],"requires_approval":false,"record_types":["application_review"]},{"key":"baseline_skill_assessment","name_ar":"قياس المهارة القبلي","name_en":"Baseline skill assessment","description_ar":"قياس مستوى المهارة عند T0.","description_en":"Measure skill level at T0.","order":2,"depends_on":["registration"],"required_evidence":["assessment_report"],"requires_approval":false,"record_types":["skill_assessment"]},{"key":"training","name_ar":"التدريب النظري والعملي","name_en":"Theory / practical training","description_ar":"تنفيذ التدريب وفق الخطة.","description_en":"Deliver training per plan.","order":3,"depends_on":["baseline_skill_assessment"],"required_evidence":["attendance_sheet"],"requires_approval":false,"record_types":["session_log"]},{"key":"attendance","name_ar":"الحضور","name_en":"Attendance","description_ar":"متابعة الحضور ومعالجة الغياب.","description_en":"Monitor attendance and handle absence.","order":4,"depends_on":["training"],"required_evidence":[],"requires_approval":false,"record_types":["attendance_check"]},{"key":"skill_assessment","name_ar":"قياس المهارة","name_en":"Skill assessment","description_ar":"قياس المهارة عند T1.","description_en":"Measure skill at T1.","order":5,"depends_on":["training"],"required_evidence":["assessment_report"],"requires_approval":false,"record_types":["skill_assessment"]},{"key":"practical_product","name_ar":"المنتج العملي","name_en":"Practical product","description_ar":"تقييم المنتج العملي لكل متدرب.","description_en":"Evaluate each trainee''s practical product.","order":6,"depends_on":["skill_assessment"],"required_evidence":["photo","product"],"requires_approval":false,"record_types":["practical_product"]},{"key":"certification","name_ar":"الشهادة","name_en":"Certification","description_ar":"اعتماد ومنح الشهادات.","description_en":"Approve and issue certificates.","order":7,"depends_on":["skill_assessment","practical_product"],"required_evidence":["certificate"],"requires_approval":true,"record_types":["certification"]},{"key":"employment_practice","name_ar":"التوظيف / الممارسة","name_en":"Employment / practice","description_ar":"متابعة الالتحاق بعمل أو ممارسة الحرفة.","description_en":"Track employment or craft practice.","order":8,"depends_on":["certification"],"required_evidence":[],"requires_approval":false,"record_types":["employment_status"]},{"key":"impact_follow_up","name_ar":"متابعة الأثر","name_en":"Impact follow-up","description_ar":"متابعة الدخل والاستمرار عند T3–T5.","description_en":"Follow income and continuity at T3–T5.","order":9,"depends_on":["employment_practice"],"required_evidence":["survey_data"],"requires_approval":false,"record_types":["employment_status","impact_measurement"]}]'::jsonb,
  '[{"key":"knowledge","name_ar":"المعرفة","name_en":"Knowledge","weight":0.8},{"key":"practical_skill","name_ar":"المهارة العملية","name_en":"Practical skill","weight":1.4},{"key":"quality","name_ar":"الجودة","name_en":"Quality","weight":1.2},{"key":"safety","name_ar":"السلامة","name_en":"Safety","weight":1},{"key":"independence","name_ar":"الاستقلالية","name_en":"Independence","weight":1},{"key":"employability","name_ar":"قابلية التوظيف","name_en":"Employability","weight":1}]'::jsonb,
  '[{"key":"training_hours","name_ar":"ساعات التدريب المنفذة","name_en":"Training hours delivered","indicator_type":"operational","chain_level":"activity","unit":"hours","direction":"increase","measurement_points":["T1"]},{"key":"certified","name_ar":"المتدربون الحاصلون على شهادة","name_en":"Trainees certified","indicator_type":"output","chain_level":"output","unit":"count","direction":"increase","measurement_points":["T1"]},{"key":"skill_gain","name_ar":"متوسط التحسن في المهارة","name_en":"Average skill gain","indicator_type":"outcome","chain_level":"outcome","outcome_term":"short","unit":"score","direction":"increase","measurement_points":["T0","T1"]},{"key":"employed_or_practicing","name_ar":"نسبة العاملين أو الممارسين بعد 6 أشهر","name_en":"% employed or practicing at 6 months","indicator_type":"impact","chain_level":"impact","outcome_term":"long","unit":"percent","direction":"increase","measurement_points":["T0","T4"]}]'::jsonb,
  '["executive_summary","program_information","execution","participation","evaluation","maturity","outputs","outcomes","impact","success_stories","recommendations"]'::jsonb,
  array['training','workshop','assessment']::text[])
on conflict (code) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, description_ar = excluded.description_ar, description_en = excluded.description_en,
  stages = excluded.stages, maturity_dimensions = excluded.maturity_dimensions, default_indicators = excluded.default_indicators,
  report_sections = excluded.report_sections, session_types = excluded.session_types, version = public.program_track_templates.version + 1, updated_at = now();
insert into public.program_track_templates (code, name_ar, name_en, description_ar, description_en, stages, maturity_dimensions, default_indicators, report_sections, session_types) values (
  'consulting', 'جلسات استشارية', 'Consulting sessions', 'من الطلب والتشخيص والمطابقة إلى التوصيات وخطة العمل والمتابعة والإغلاق.', 'From request, diagnosis and matching to recommendations, action plan, follow-up and closure.',
  '[{"key":"request","name_ar":"الطلب","name_en":"Request","description_ar":"استقبال طلب الاستشارة وتحديد الاحتياج.","description_en":"Receive request and define need.","order":1,"depends_on":[],"required_evidence":[],"requires_approval":false,"record_types":["consulting_request"]},{"key":"diagnosis","name_ar":"التشخيص","name_en":"Diagnosis","description_ar":"تشخيص المشكلة وأسبابها الجذرية.","description_en":"Diagnose problem and root causes.","order":2,"depends_on":["request"],"required_evidence":[],"requires_approval":false,"record_types":["diagnosis"]},{"key":"matching","name_ar":"إسناد / مطابقة المستشار","name_en":"Consultant assignment / matching","description_ar":"مطابقة قابلة للتفسير مع فحص تعارض المصالح.","description_en":"Explainable matching with conflict-of-interest check.","order":3,"depends_on":["diagnosis"],"required_evidence":[],"requires_approval":false,"record_types":["consultant_match"]},{"key":"session","name_ar":"الجلسة","name_en":"Session","description_ar":"تنفيذ الجلسات وتوثيقها.","description_en":"Deliver and document sessions.","order":4,"depends_on":["matching"],"required_evidence":["minutes"],"requires_approval":false,"record_types":["session_log"]},{"key":"recommendations","name_ar":"التوصيات","name_en":"Recommendations","description_ar":"توصيات محددة قابلة للتنفيذ.","description_en":"Specific, actionable recommendations.","order":5,"depends_on":["session"],"required_evidence":[],"requires_approval":false,"record_types":["recommendation"]},{"key":"action_plan","name_ar":"خطة العمل","name_en":"Action plan","description_ar":"خطة عمل بمسؤوليات ومواعيد.","description_en":"Action plan with owners and dates.","order":6,"depends_on":["recommendations"],"required_evidence":["document"],"requires_approval":false,"record_types":["action_plan_item"]},{"key":"follow_up","name_ar":"المتابعة","name_en":"Follow-up","description_ar":"متابعة تطبيق خطة العمل.","description_en":"Follow up plan implementation.","order":7,"depends_on":["action_plan"],"required_evidence":[],"requires_approval":false,"record_types":["follow_up"]},{"key":"closure","name_ar":"الإغلاق","name_en":"Closure","description_ar":"إغلاق الحالة بتقييم التطبيق والرضا.","description_en":"Close with implementation and satisfaction review.","order":8,"depends_on":["follow_up"],"required_evidence":["document"],"requires_approval":true,"record_types":["closure"]},{"key":"outcome_impact","name_ar":"النتيجة / الأثر","name_en":"Outcome / impact","description_ar":"قياس التحسن الناتج.","description_en":"Measure resulting improvement.","order":9,"depends_on":["closure"],"required_evidence":["survey_data"],"requires_approval":false,"record_types":["impact_measurement"]}]'::jsonb,
  '[{"key":"need_clarity","name_ar":"وضوح الاحتياج","name_en":"Need clarity","weight":1},{"key":"execution_capacity","name_ar":"القدرة على التنفيذ","name_en":"Execution capacity","weight":1.2},{"key":"decision_quality","name_ar":"جودة القرار","name_en":"Decision quality","weight":1},{"key":"application","name_ar":"التطبيق","name_en":"Application","weight":1.2},{"key":"sustained_improvement","name_ar":"استدامة التحسن","name_en":"Sustained improvement","weight":1}]'::jsonb,
  '[{"key":"sessions_delivered","name_ar":"الجلسات المنفذة","name_en":"Sessions delivered","indicator_type":"operational","chain_level":"activity","unit":"count","direction":"increase","measurement_points":["T1"]},{"key":"action_plans","name_ar":"خطط العمل المعتمدة","name_en":"Action plans agreed","indicator_type":"output","chain_level":"output","unit":"count","direction":"increase","measurement_points":["T1"]},{"key":"implementation_rate","name_ar":"نسبة تطبيق التوصيات","name_en":"Recommendation implementation rate","indicator_type":"outcome","chain_level":"outcome","outcome_term":"short","unit":"percent","direction":"increase","measurement_points":["T2","T3"]},{"key":"performance_improvement","name_ar":"التحسن في الأداء المؤسسي","name_en":"Organizational performance improvement","indicator_type":"impact","chain_level":"impact","outcome_term":"medium","unit":"score","direction":"increase","measurement_points":["T0","T3"]}]'::jsonb,
  '["executive_summary","program_information","execution","participation","evaluation","outputs","outcomes","impact","recommendations"]'::jsonb,
  array['consulting','coaching']::text[])
on conflict (code) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, description_ar = excluded.description_ar, description_en = excluded.description_en,
  stages = excluded.stages, maturity_dimensions = excluded.maturity_dimensions, default_indicators = excluded.default_indicators,
  report_sections = excluded.report_sections, session_types = excluded.session_types, version = public.program_track_templates.version + 1, updated_at = now();
insert into public.program_track_templates (code, name_ar, name_en, description_ar, description_en, stages, maturity_dimensions, default_indicators, report_sections, session_types) values (
  'bootcamp', 'معسكر', 'Bootcamp', 'من التسجيل والاختيار والدفعات إلى رحلة التعلم والمشاريع والتخرج والمتابعة.', 'From registration, selection and cohorts to learning journey, projects, graduation and follow-up.',
  '[{"key":"registration","name_ar":"التسجيل","name_en":"Registration","description_ar":"استقبال التسجيلات.","description_en":"Receive registrations.","order":1,"depends_on":[],"required_evidence":[],"requires_approval":false,"record_types":["application_review"]},{"key":"selection","name_ar":"الاختيار","name_en":"Selection","description_ar":"اختيار المشاركين واعتماد القوائم.","description_en":"Select and approve participants.","order":2,"depends_on":["registration"],"required_evidence":["minutes"],"requires_approval":true,"record_types":["screening_score"]},{"key":"cohorts","name_ar":"الدفعات","name_en":"Cohorts","description_ar":"تقسيم المشاركين إلى دفعات.","description_en":"Organize participants into cohorts.","order":3,"depends_on":["selection"],"required_evidence":[],"requires_approval":false,"record_types":["cohort_setup"]},{"key":"learning_journey","name_ar":"رحلة التعلم","name_en":"Learning journey","description_ar":"تصميم وحدات التعلم ونواتجها.","description_en":"Design learning modules and outcomes.","order":4,"depends_on":["cohorts"],"required_evidence":["document"],"requires_approval":false,"record_types":["learning_module"]},{"key":"sessions","name_ar":"الجلسات","name_en":"Sessions","description_ar":"تنفيذ الجلسات ومتابعة الحضور.","description_en":"Deliver sessions and track attendance.","order":5,"depends_on":["cohorts","learning_journey"],"required_evidence":["attendance_sheet"],"requires_approval":false,"record_types":["session_log"]},{"key":"projects","name_ar":"المشاريع","name_en":"Projects","description_ar":"مشاريع تطبيقية فردية أو جماعية.","description_en":"Applied individual or team projects.","order":6,"depends_on":["sessions"],"required_evidence":[],"requires_approval":false,"record_types":["project_evaluation"]},{"key":"assessments","name_ar":"التقييمات","name_en":"Assessments","description_ar":"تقييم نواتج التعلم.","description_en":"Assess learning outcomes.","order":7,"depends_on":["projects"],"required_evidence":["assessment_report"],"requires_approval":false,"record_types":["skill_assessment"]},{"key":"graduation","name_ar":"التخرج","name_en":"Graduation","description_ar":"اعتماد المتخرجين.","description_en":"Approve graduates.","order":8,"depends_on":["assessments"],"required_evidence":["certificate"],"requires_approval":true,"record_types":["graduation_decision"]},{"key":"follow_up","name_ar":"المتابعة","name_en":"Follow-up","description_ar":"متابعة التطبيق والتوظيف.","description_en":"Follow application and employment.","order":9,"depends_on":["graduation"],"required_evidence":[],"requires_approval":false,"record_types":["employment_status","follow_up"]}]'::jsonb,
  '[{"key":"knowledge","name_ar":"المعرفة","name_en":"Knowledge","weight":1},{"key":"skill","name_ar":"المهارة","name_en":"Skill","weight":1.2},{"key":"application","name_ar":"التطبيق","name_en":"Application","weight":1.2},{"key":"project","name_ar":"المشروع","name_en":"Project","weight":1},{"key":"readiness","name_ar":"الجاهزية","name_en":"Readiness","weight":1}]'::jsonb,
  '[{"key":"attendance_rate","name_ar":"نسبة الحضور","name_en":"Attendance rate","indicator_type":"operational","chain_level":"activity","unit":"percent","direction":"increase","measurement_points":["T1"]},{"key":"graduates","name_ar":"عدد المتخرجين","name_en":"Graduates","indicator_type":"output","chain_level":"output","unit":"count","direction":"increase","measurement_points":["T1"]},{"key":"skill_gain","name_ar":"التحسن في المهارة","name_en":"Skill gain","indicator_type":"outcome","chain_level":"outcome","outcome_term":"short","unit":"score","direction":"increase","measurement_points":["T0","T1"]},{"key":"employment","name_ar":"نسبة التوظيف بعد 3 أشهر","name_en":"Employment at 3 months","indicator_type":"impact","chain_level":"impact","outcome_term":"medium","unit":"percent","direction":"increase","measurement_points":["T0","T3"]}]'::jsonb,
  '["executive_summary","program_information","participation","execution","evaluation","maturity","outputs","outcomes","impact","recommendations"]'::jsonb,
  array['training','workshop','assessment']::text[])
on conflict (code) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, description_ar = excluded.description_ar, description_en = excluded.description_en,
  stages = excluded.stages, maturity_dimensions = excluded.maturity_dimensions, default_indicators = excluded.default_indicators,
  report_sections = excluded.report_sections, session_types = excluded.session_types, version = public.program_track_templates.version + 1, updated_at = now();
insert into public.program_track_templates (code, name_ar, name_en, description_ar, description_en, stages, maturity_dimensions, default_indicators, report_sections, session_types) values (
  'graduate', 'تطوير الخريجين', 'Graduate development program', 'من الاحتياج الوظيفي والاستقطاب إلى IDP والتدوير والتقييم والتسكين ومتابعة 6/12 شهرًا.', 'From workforce need and campaign to IDP, rotation, assessment, placement and 6/12-month tracking.',
  '[{"key":"workforce_need","name_ar":"الاحتياج الوظيفي","name_en":"Workforce / talent need","description_ar":"تحديد الوظائف والجدارات المطلوبة.","description_en":"Define roles and required competencies.","order":1,"depends_on":[],"required_evidence":["document"],"requires_approval":false,"record_types":["workforce_need"]},{"key":"program_design","name_ar":"تصميم البرنامج","name_en":"Program design","description_ar":"تصميم مسار التطوير ومعايير التخرج.","description_en":"Design the development path and graduation criteria.","order":2,"depends_on":["workforce_need"],"required_evidence":["document"],"requires_approval":true,"record_types":["design_decision"]},{"key":"campaign","name_ar":"الحملة","name_en":"Campaign","description_ar":"حملة الاستقطاب وقنواتها.","description_en":"Recruitment campaign and channels.","order":3,"depends_on":["program_design"],"required_evidence":[],"requires_approval":false,"record_types":["campaign_channel"]},{"key":"applications","name_ar":"التقديم","name_en":"Applications","description_ar":"استقبال الطلبات.","description_en":"Receive applications.","order":4,"depends_on":["campaign"],"required_evidence":[],"requires_approval":false,"record_types":["application_review"]},{"key":"eligibility","name_ar":"الأهلية","name_en":"Eligibility","description_ar":"التحقق من شروط الأهلية.","description_en":"Check eligibility criteria.","order":5,"depends_on":["applications"],"required_evidence":[],"requires_approval":false,"record_types":["eligibility_check"]},{"key":"screening","name_ar":"الفرز","name_en":"Screening","description_ar":"الفرز الأولي.","description_en":"Initial screening.","order":6,"depends_on":["eligibility"],"required_evidence":[],"requires_approval":false,"record_types":["screening_score"]},{"key":"assessment","name_ar":"التقييم","name_en":"Assessment","description_ar":"تقييمات معيارية ومقابلات.","description_en":"Standardized assessments and interviews.","order":7,"depends_on":["screening"],"required_evidence":["assessment_report"],"requires_approval":false,"record_types":["screening_score"]},{"key":"selection","name_ar":"الاختيار","name_en":"Selection","description_ar":"اعتماد المقبولين.","description_en":"Approve selected candidates.","order":8,"depends_on":["assessment"],"required_evidence":["minutes"],"requires_approval":true,"record_types":[]},{"key":"onboarding","name_ar":"التهيئة","name_en":"Onboarding","description_ar":"تهيئة المنضمين.","description_en":"Onboard joiners.","order":9,"depends_on":["selection"],"required_evidence":[],"requires_approval":false,"record_types":["onboarding_item"]},{"key":"baseline","name_ar":"خط الأساس (T0)","name_en":"Baseline (T0)","description_ar":"قياس خط الأساس للجدارات.","description_en":"Baseline competency measurement.","order":10,"depends_on":["onboarding"],"required_evidence":["assessment_report"],"requires_approval":false,"record_types":["skill_assessment"]},{"key":"idp","name_ar":"خطة التطوير الفردية","name_en":"IDP","description_ar":"خطة تطوير فردية مبنية على فجوات T0.","description_en":"Individual plan built from T0 gaps.","order":11,"depends_on":["baseline"],"required_evidence":["document"],"requires_approval":false,"record_types":["idp_item"]},{"key":"learning_journey","name_ar":"رحلة التعلم","name_en":"Learning journey","description_ar":"تنفيذ الوحدات التعليمية.","description_en":"Deliver learning modules.","order":12,"depends_on":["idp"],"required_evidence":["attendance_sheet"],"requires_approval":false,"record_types":["learning_module"]},{"key":"job_rotation","name_ar":"التدوير الوظيفي","name_en":"Job rotation","description_ar":"تدوير بين الإدارات بتقييم المشرف.","description_en":"Rotations with supervisor ratings.","order":13,"depends_on":["idp"],"required_evidence":[],"requires_approval":false,"record_types":["rotation"]},{"key":"mentoring_coaching","name_ar":"الإرشاد والكوتشينغ","name_en":"Mentoring / coaching","description_ar":"جلسات إرشاد وكوتشينغ.","description_en":"Mentoring and coaching sessions.","order":14,"depends_on":["idp"],"required_evidence":[],"requires_approval":false,"record_types":["mentoring_note"]},{"key":"projects_assignments","name_ar":"المشاريع والمهام","name_en":"Projects / assignments","description_ar":"مهام ومشاريع تطبيقية.","description_en":"Applied projects and assignments.","order":15,"depends_on":["idp"],"required_evidence":[],"requires_approval":false,"record_types":["assignment_review"]},{"key":"periodic_assessment","name_ar":"التقييم الدوري","name_en":"Periodic assessment","description_ar":"تقييمات دورية للتقدم.","description_en":"Periodic progress assessments.","order":16,"depends_on":["learning_journey"],"required_evidence":["assessment_report"],"requires_approval":false,"record_types":["skill_assessment"]},{"key":"final_assessment","name_ar":"التقييم النهائي (T1)","name_en":"Final assessment (T1)","description_ar":"التقييم النهائي ومقارنته بـ T0.","description_en":"Final assessment compared with T0.","order":17,"depends_on":["periodic_assessment","job_rotation","projects_assignments"],"required_evidence":["assessment_report"],"requires_approval":false,"record_types":["skill_assessment"]},{"key":"graduation","name_ar":"التخرج","name_en":"Graduation","description_ar":"اعتماد التخرج.","description_en":"Approve graduation.","order":18,"depends_on":["final_assessment"],"required_evidence":["certificate"],"requires_approval":true,"record_types":["graduation_decision"]},{"key":"placement","name_ar":"التسكين","name_en":"Placement","description_ar":"تسكين الخريجين في الوظائف.","description_en":"Place graduates in roles.","order":19,"depends_on":["graduation"],"required_evidence":["document"],"requires_approval":false,"record_types":["placement"]},{"key":"tracking","name_ar":"متابعة 6/12 شهرًا","name_en":"6/12-month tracking","description_ar":"متابعة الاستمرار والأداء عند T4 وT5.","description_en":"Track retention and performance at T4 and T5.","order":20,"depends_on":["placement"],"required_evidence":[],"requires_approval":false,"record_types":["retention_check"]},{"key":"impact","name_ar":"الأثر","name_en":"Impact","description_ar":"قياس الأثر على الجاهزية والاحتفاظ والأداء.","description_en":"Measure impact on readiness, retention and performance.","order":21,"depends_on":["tracking"],"required_evidence":["survey_data"],"requires_approval":false,"record_types":["impact_measurement"]}]'::jsonb,
  '[{"key":"competence","name_ar":"الكفاءة","name_en":"Competence","weight":1.2},{"key":"job_readiness","name_ar":"الجاهزية الوظيفية","name_en":"Job readiness","weight":1.2},{"key":"practical_application","name_ar":"التطبيق العملي","name_en":"Practical application","weight":1},{"key":"independence","name_ar":"الاستقلالية","name_en":"Independence","weight":0.8},{"key":"performance","name_ar":"الأداء","name_en":"Performance","weight":1},{"key":"role_readiness","name_ar":"الاستعداد للدور","name_en":"Role readiness","weight":1}]'::jsonb,
  '[{"key":"applications","name_ar":"الطلبات المستلمة","name_en":"Applications received","indicator_type":"operational","chain_level":"activity","unit":"count","direction":"increase","measurement_points":["T1"]},{"key":"graduates","name_ar":"الخريجون","name_en":"Graduates","indicator_type":"output","chain_level":"output","unit":"count","direction":"increase","measurement_points":["T1"]},{"key":"readiness_gain","name_ar":"التحسن في الجاهزية الوظيفية","name_en":"Job-readiness gain","indicator_type":"outcome","chain_level":"outcome","outcome_term":"short","unit":"score","direction":"increase","measurement_points":["T0","T1"]},{"key":"placement_rate","name_ar":"نسبة التسكين","name_en":"Placement rate","indicator_type":"outcome","chain_level":"outcome","outcome_term":"medium","unit":"percent","direction":"increase","measurement_points":["T2"]},{"key":"retention_12m","name_ar":"نسبة الاحتفاظ بعد 12 شهرًا","name_en":"12-month retention","indicator_type":"impact","chain_level":"impact","outcome_term":"long","unit":"percent","direction":"increase","measurement_points":["T5"]}]'::jsonb,
  '["executive_summary","program_information","target_group","execution","participation","evaluation","maturity","outputs","outcomes","impact","success_stories","challenges","lessons_learned","recommendations","appendices"]'::jsonb,
  array['training','mentoring','coaching','assessment','orientation']::text[])
on conflict (code) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, description_ar = excluded.description_ar, description_en = excluded.description_en,
  stages = excluded.stages, maturity_dimensions = excluded.maturity_dimensions, default_indicators = excluded.default_indicators,
  report_sections = excluded.report_sections, session_types = excluded.session_types, version = public.program_track_templates.version + 1, updated_at = now();

-- Central maturity frameworks (one per track)
insert into public.maturity_frameworks (organization_id, code, name, name_en, track_code, description, scale_min, scale_max, weighted, dimensions, status)
select null, 'MAT-HACKATHON', 'إطار نضج — هاكاثون', 'Maturity framework — Hackathon', 'hackathon', 'خمسة مستويات لكل بعد؛ يقاس عند T0 وT1 ونقاط المتابعة.', 1, 5, true, '[{"key":"problem_clarity","name_ar":"وضوح المشكلة","name_en":"Problem clarity","weight":1,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"innovation","name_ar":"الابتكار","name_en":"Innovation","weight":1.2,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"feasibility","name_ar":"الجدوى","name_en":"Feasibility","weight":1,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"execution","name_ar":"قابلية التنفيذ","name_en":"Execution readiness","weight":1,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"expected_impact","name_ar":"الأثر المتوقع","name_en":"Expected impact","weight":1.2,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}}]'::jsonb, 'active'
where not exists (select 1 from public.maturity_frameworks where organization_id is null and code = 'MAT-HACKATHON');
insert into public.maturity_frameworks (organization_id, code, name, name_en, track_code, description, scale_min, scale_max, weighted, dimensions, status)
select null, 'MAT-INCUBATOR', 'إطار نضج — حاضنة أعمال', 'Maturity framework — Business incubator', 'incubator', 'خمسة مستويات لكل بعد؛ يقاس عند T0 وT1 ونقاط المتابعة.', 1, 5, true, '[{"key":"business_model","name_ar":"نموذج العمل","name_en":"Business model","weight":1.2,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"market","name_ar":"السوق","name_en":"Market","weight":1.2,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"product","name_ar":"المنتج","name_en":"Product","weight":1,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"operations","name_ar":"التشغيل","name_en":"Operations","weight":0.8,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"finance","name_ar":"المالية","name_en":"Finance","weight":1,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"governance","name_ar":"الحوكمة","name_en":"Governance","weight":0.8,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"sustainability","name_ar":"الاستدامة","name_en":"Sustainability","weight":1,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}}]'::jsonb, 'active'
where not exists (select 1 from public.maturity_frameworks where organization_id is null and code = 'MAT-INCUBATOR');
insert into public.maturity_frameworks (organization_id, code, name, name_en, track_code, description, scale_min, scale_max, weighted, dimensions, status)
select null, 'MAT-VOCATIONAL', 'إطار نضج — برنامج مهني / حرفي', 'Maturity framework — Vocational / craft program', 'vocational', 'خمسة مستويات لكل بعد؛ يقاس عند T0 وT1 ونقاط المتابعة.', 1, 5, true, '[{"key":"knowledge","name_ar":"المعرفة","name_en":"Knowledge","weight":0.8,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"practical_skill","name_ar":"المهارة العملية","name_en":"Practical skill","weight":1.4,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"quality","name_ar":"الجودة","name_en":"Quality","weight":1.2,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"safety","name_ar":"السلامة","name_en":"Safety","weight":1,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"independence","name_ar":"الاستقلالية","name_en":"Independence","weight":1,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"employability","name_ar":"قابلية التوظيف","name_en":"Employability","weight":1,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}}]'::jsonb, 'active'
where not exists (select 1 from public.maturity_frameworks where organization_id is null and code = 'MAT-VOCATIONAL');
insert into public.maturity_frameworks (organization_id, code, name, name_en, track_code, description, scale_min, scale_max, weighted, dimensions, status)
select null, 'MAT-CONSULTING', 'إطار نضج — جلسات استشارية', 'Maturity framework — Consulting sessions', 'consulting', 'خمسة مستويات لكل بعد؛ يقاس عند T0 وT1 ونقاط المتابعة.', 1, 5, true, '[{"key":"need_clarity","name_ar":"وضوح الاحتياج","name_en":"Need clarity","weight":1,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"execution_capacity","name_ar":"القدرة على التنفيذ","name_en":"Execution capacity","weight":1.2,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"decision_quality","name_ar":"جودة القرار","name_en":"Decision quality","weight":1,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"application","name_ar":"التطبيق","name_en":"Application","weight":1.2,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"sustained_improvement","name_ar":"استدامة التحسن","name_en":"Sustained improvement","weight":1,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}}]'::jsonb, 'active'
where not exists (select 1 from public.maturity_frameworks where organization_id is null and code = 'MAT-CONSULTING');
insert into public.maturity_frameworks (organization_id, code, name, name_en, track_code, description, scale_min, scale_max, weighted, dimensions, status)
select null, 'MAT-BOOTCAMP', 'إطار نضج — معسكر', 'Maturity framework — Bootcamp', 'bootcamp', 'خمسة مستويات لكل بعد؛ يقاس عند T0 وT1 ونقاط المتابعة.', 1, 5, true, '[{"key":"knowledge","name_ar":"المعرفة","name_en":"Knowledge","weight":1,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"skill","name_ar":"المهارة","name_en":"Skill","weight":1.2,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"application","name_ar":"التطبيق","name_en":"Application","weight":1.2,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"project","name_ar":"المشروع","name_en":"Project","weight":1,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"readiness","name_ar":"الجاهزية","name_en":"Readiness","weight":1,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}}]'::jsonb, 'active'
where not exists (select 1 from public.maturity_frameworks where organization_id is null and code = 'MAT-BOOTCAMP');
insert into public.maturity_frameworks (organization_id, code, name, name_en, track_code, description, scale_min, scale_max, weighted, dimensions, status)
select null, 'MAT-GRADUATE', 'إطار نضج — تطوير الخريجين', 'Maturity framework — Graduate development program', 'graduate', 'خمسة مستويات لكل بعد؛ يقاس عند T0 وT1 ونقاط المتابعة.', 1, 5, true, '[{"key":"competence","name_ar":"الكفاءة","name_en":"Competence","weight":1.2,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"job_readiness","name_ar":"الجاهزية الوظيفية","name_en":"Job readiness","weight":1.2,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"practical_application","name_ar":"التطبيق العملي","name_en":"Practical application","weight":1,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"independence","name_ar":"الاستقلالية","name_en":"Independence","weight":0.8,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"performance","name_ar":"الأداء","name_en":"Performance","weight":1,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}},{"key":"role_readiness","name_ar":"الاستعداد للدور","name_en":"Role readiness","weight":1,"levels":{"1":{"ar":"مبتدئ: ممارسات غير منتظمة تعتمد على المبادرة الفردية","en":"Initial: Ad-hoc practice dependent on individual initiative"},"2":{"ar":"نامٍ: ممارسات أساسية موجودة لكنها غير متسقة","en":"Developing: Basic practice exists but is inconsistent"},"3":{"ar":"متمكن: ممارسات مستقرة ومطبقة باتساق","en":"Established: Stable practice applied consistently"},"4":{"ar":"متقدم: ممارسات مقاسة تُحسَّن بناءً على البيانات","en":"Advanced: Measured practice improved using data"},"5":{"ar":"رائد: ممارسات نموذجية قابلة للنقل ومؤثرة في الآخرين","en":"Leading: Exemplary, transferable practice that influences others"}}}]'::jsonb, 'active'
where not exists (select 1 from public.maturity_frameworks where organization_id is null and code = 'MAT-GRADUATE');

-- Central impact framework templates (Theory of Change starters, one per track)
insert into public.impact_frameworks (organization_id, program_id, code, name, track_code, problem_statement, target_population, theory_of_change, intended_impact, evaluation_design, attribution_approach, status)
select null, null, 'IMP-HACKATHON', 'قالب نظرية تغيير — هاكاثون', 'hackathon', 'ضعف تحويل الأفكار المبتكرة إلى حلول قابلة للتنفيذ لتحديات مجتمعية محددة', 'شباب ومبتكرون ورواد أعمال ناشئون', '{"inputs":["تمويل ورعاة","تحديات من جهات مالكة","مرشدون ومحكّمون","منصة ومكان"],"activities":["ورش تمكين","إرشاد الفرق","تحكيم","متابعة ما بعد الهاكاثون"],"outputs":["فرق مكتملة","نماذج أولية","عروض نهائية"],"outcomes_short":["تحسن مهارات الابتكار والعمل الجماعي","نماذج أولية قابلة للاختبار"],"outcomes_medium":["مشاريع مستمرة بعد 6 أشهر","شراكات مع ملاك التحديات"],"outcomes_long":["مشاريع ناشئة مسجلة"],"impact":["حلول مطبقة لتحديات مجتمعية"],"assumptions":["توفر مرشدين مؤهلين","التزام الفرق بعد الحدث"],"external_factors":["توفر تمويل لاحق","بيئة تنظيمية داعمة"]}'::jsonb, 'حلول مبتكرة مستدامة تعالج تحديات مجتمعية', 'pre_post', 'contribution', 'approved'
where not exists (select 1 from public.impact_frameworks where organization_id is null and code = 'IMP-HACKATHON');
insert into public.impact_frameworks (organization_id, program_id, code, name, track_code, problem_statement, target_population, theory_of_change, intended_impact, evaluation_design, attribution_approach, status)
select null, null, 'IMP-INCUBATOR', 'قالب نظرية تغيير — حاضنة أعمال', 'incubator', 'ارتفاع تعثر المشاريع الناشئة في سنواتها الأولى', 'رواد أعمال ومشاريع ناشئة في مرحلة مبكرة', '{"inputs":["مساحة احتضان","خبراء ومرشدون","تمويل تشغيلي"],"activities":["تشخيص الأعمال","خطط احتضان","إرشاد واستشارات","تحقق سوقي"],"outputs":["مشاريع محتضنة","ساعات إرشاد","نماذج أولية"],"outcomes_short":["نماذج عمل أوضح","MVP مختبر"],"outcomes_medium":["عملاء دافعون وإيرادات"],"outcomes_long":["نمو وتوظيف"],"impact":["وظائف مستحدثة ومشاريع مستدامة"],"assumptions":["التزام المؤسسين","جودة الإرشاد"],"external_factors":["الظروف الاقتصادية","الوصول للتمويل"]}'::jsonb, 'مشاريع مستدامة تخلق وظائف وقيمة اقتصادية', 'pre_post', 'contribution', 'approved'
where not exists (select 1 from public.impact_frameworks where organization_id is null and code = 'IMP-INCUBATOR');
insert into public.impact_frameworks (organization_id, program_id, code, name, track_code, problem_statement, target_population, theory_of_change, intended_impact, evaluation_design, attribution_approach, status)
select null, null, 'IMP-VOCATIONAL', 'قالب نظرية تغيير — برنامج مهني / حرفي', 'vocational', 'فجوة المهارات المهنية والحرفية المطلوبة لسوق العمل', 'باحثون عن عمل وحرفيون ناشئون', '{"inputs":["مدربون","ورش ومعدات","مواد خام"],"activities":["تدريب نظري وعملي","قياس مهارة","منتج عملي","اعتماد"],"outputs":["ساعات تدريب","متدربون معتمدون","منتجات عملية"],"outcomes_short":["تحسن المهارة العملية"],"outcomes_medium":["التحاق بعمل أو ممارسة الحرفة"],"outcomes_long":["استقرار الدخل"],"impact":["تحسن مستوى المعيشة"],"assumptions":["طلب سوقي على المهارة"],"external_factors":["توفر فرص العمل محليًا"]}'::jsonb, 'دخل مستدام من العمل أو الحرفة', 'pre_post', 'contribution', 'approved'
where not exists (select 1 from public.impact_frameworks where organization_id is null and code = 'IMP-VOCATIONAL');
insert into public.impact_frameworks (organization_id, program_id, code, name, track_code, problem_statement, target_population, theory_of_change, intended_impact, evaluation_design, attribution_approach, status)
select null, null, 'IMP-CONSULTING', 'قالب نظرية تغيير — جلسات استشارية', 'consulting', 'ضعف القدرات المؤسسية والإدارية لدى الجهات المستفيدة', 'منشآت صغيرة ومتوسطة وجهات غير ربحية', '{"inputs":["مستشارون","أدوات تشخيص"],"activities":["تشخيص","جلسات استشارية","خطط عمل","متابعة"],"outputs":["جلسات منفذة","خطط عمل معتمدة"],"outcomes_short":["تطبيق التوصيات"],"outcomes_medium":["تحسن مؤشرات الأداء"],"outcomes_long":["استدامة التحسن"],"impact":["منشآت أكثر قدرة واستدامة"],"assumptions":["التزام الإدارة بالتطبيق"],"external_factors":["تغيرات السوق والتنظيم"]}'::jsonb, 'تحسن مستدام في الأداء المؤسسي', 'pre_post', 'contribution', 'approved'
where not exists (select 1 from public.impact_frameworks where organization_id is null and code = 'IMP-CONSULTING');
insert into public.impact_frameworks (organization_id, program_id, code, name, track_code, problem_statement, target_population, theory_of_change, intended_impact, evaluation_design, attribution_approach, status)
select null, null, 'IMP-BOOTCAMP', 'قالب نظرية تغيير — معسكر', 'bootcamp', 'فجوة بين التعليم الأكاديمي والمهارات التطبيقية المطلوبة', 'طلاب وخريجون وباحثون عن عمل', '{"inputs":["مدربون","منهج","منصة تعلم"],"activities":["جلسات مكثفة","مشاريع تطبيقية","تقييمات"],"outputs":["متخرجون","مشاريع مكتملة"],"outcomes_short":["تحسن المهارة والتطبيق"],"outcomes_medium":["توظيف خلال 3 أشهر"],"outcomes_long":["تقدم مهني"],"impact":["زيادة التوظيف في التخصص"],"assumptions":["التزام المشاركين"],"external_factors":["طلب سوق العمل"]}'::jsonb, 'جاهزية وظيفية وتوظيف في مجالات الطلب', 'pre_post', 'contribution', 'approved'
where not exists (select 1 from public.impact_frameworks where organization_id is null and code = 'IMP-BOOTCAMP');
insert into public.impact_frameworks (organization_id, program_id, code, name, track_code, problem_statement, target_population, theory_of_change, intended_impact, evaluation_design, attribution_approach, status)
select null, null, 'IMP-GRADUATE', 'قالب نظرية تغيير — تطوير الخريجين', 'graduate', 'ضعف الجاهزية الوظيفية للخريجين الجدد لأدوار محددة', 'خريجون جدد', '{"inputs":["احتياج وظيفي معتمد","مرشدون ومدربون","إدارات مستضيفة"],"activities":["استقطاب واختيار","IDP","تعلم","تدوير","إرشاد","مشاريع"],"outputs":["خريجون أكملوا البرنامج","خطط تطوير منفذة"],"outcomes_short":["تحسن الجدارات والجاهزية"],"outcomes_medium":["تسكين في الوظائف"],"outcomes_long":["احتفاظ وأداء بعد 12 شهرًا"],"impact":["خفض فجوة المواهب لدى الجهة"],"assumptions":["توفر وظائف شاغرة","دعم المديرين"],"external_factors":["تغير الهيكل التنظيمي"]}'::jsonb, 'كوادر جاهزة ومستقرة في وظائف الجهة', 'pre_post', 'contribution', 'approved'
where not exists (select 1 from public.impact_frameworks where organization_id is null and code = 'IMP-GRADUATE');

do $$ declare tid uuid; did uuid; begin
  if exists (select 1 from public.assessment_tools where organization_id is null and code = 'ASM-EMPLOYABILITY') then return; end if;
  insert into public.assessment_tools (organization_id, code, name, name_en, tool_type, subject_type, track_codes, scoring_method, scale_min, scale_max, pass_threshold, classification, status)
  values (null, 'ASM-EMPLOYABILITY', 'جاهزية التوظيف', 'Employability readiness', 'internal', 'individual', array['graduate','bootcamp','vocational']::text[], 'weighted_average', 1, 5, 60, '[{"min":0,"max":40,"label_ar":"يحتاج تطويرًا جوهريًا","label_en":"Needs substantial development","interpretation_ar":"الأداء أقل بوضوح من المستوى المطلوب؛ يلزم دعم مركز وخطة تطوير.","interpretation_en":"Clearly below the required level; focused support and a development plan are needed."},{"min":40,"max":60,"label_ar":"نامٍ","label_en":"Developing","interpretation_ar":"أساس موجود مع فجوات واضحة في أبعاد محددة.","interpretation_en":"A foundation exists with clear gaps in specific dimensions."},{"min":60,"max":80,"label_ar":"متمكن","label_en":"Proficient","interpretation_ar":"يحقق المستوى المطلوب مع فرص تحسين محددة.","interpretation_en":"Meets the required level with specific improvement opportunities."},{"min":80,"max":100,"label_ar":"متميز","label_en":"Distinguished","interpretation_ar":"أداء يتجاوز المطلوب ويمكن البناء عليه كنقطة قوة.","interpretation_en":"Exceeds the requirement; a strength to build on."}]'::jsonb, 'active') returning id into tid;
  insert into public.assessment_dimensions (organization_id, tool_id, code, name, name_en, weight, sort_order, rubric) values (null, tid, 'D1', 'التواصل المهني', 'Professional communication', 1, 1, '[{"score":1,"label_ar":"مبتدئ","label_en":"Initial"},{"score":2,"label_ar":"نامٍ","label_en":"Developing"},{"score":3,"label_ar":"متمكن","label_en":"Established"},{"score":4,"label_ar":"متقدم","label_en":"Advanced"},{"score":5,"label_ar":"رائد","label_en":"Leading"}]'::jsonb) returning id into did;
  insert into public.assessment_questions (organization_id, tool_id, dimension_id, code, text_ar, text_en, question_type, weight, reverse_scored, sort_order, translation_status) values (null, tid, did, 'D1Q1', 'أعبّر عن أفكاري بوضوح في بيئة العمل', 'I express my ideas clearly at work', 'scale', 1, false, 1, 'verified');
  insert into public.assessment_questions (organization_id, tool_id, dimension_id, code, text_ar, text_en, question_type, weight, reverse_scored, sort_order, translation_status) values (null, tid, did, 'D1Q2', 'أكتب رسائل وتقارير مهنية منظمة', 'I write organized professional messages and reports', 'scale', 1, false, 2, 'verified');
  insert into public.assessment_questions (organization_id, tool_id, dimension_id, code, text_ar, text_en, question_type, weight, reverse_scored, sort_order, translation_status) values (null, tid, did, 'D1Q3', 'أجد صعوبة في عرض عملي أمام الآخرين', 'I find it hard to present my work to others', 'scale', 1, true, 3, 'verified');
  insert into public.assessment_dimensions (organization_id, tool_id, code, name, name_en, weight, sort_order, rubric) values (null, tid, 'D2', 'حل المشكلات', 'Problem solving', 1.2, 2, '[{"score":1,"label_ar":"مبتدئ","label_en":"Initial"},{"score":2,"label_ar":"نامٍ","label_en":"Developing"},{"score":3,"label_ar":"متمكن","label_en":"Established"},{"score":4,"label_ar":"متقدم","label_en":"Advanced"},{"score":5,"label_ar":"رائد","label_en":"Leading"}]'::jsonb) returning id into did;
  insert into public.assessment_questions (organization_id, tool_id, dimension_id, code, text_ar, text_en, question_type, weight, reverse_scored, sort_order, translation_status) values (null, tid, did, 'D2Q1', 'أحلل المشكلة قبل اقتراح الحلول', 'I analyze a problem before proposing solutions', 'scale', 1, false, 1, 'verified');
  insert into public.assessment_questions (organization_id, tool_id, dimension_id, code, text_ar, text_en, question_type, weight, reverse_scored, sort_order, translation_status) values (null, tid, did, 'D2Q2', 'أستخدم البيانات لاتخاذ القرار', 'I use data to make decisions', 'scale', 1, false, 2, 'verified');
  insert into public.assessment_questions (organization_id, tool_id, dimension_id, code, text_ar, text_en, question_type, weight, reverse_scored, sort_order, translation_status) values (null, tid, did, 'D2Q3', 'أتوقف عند أول عقبة دون بدائل', 'I stop at the first obstacle without alternatives', 'scale', 1, true, 3, 'verified');
  insert into public.assessment_dimensions (organization_id, tool_id, code, name, name_en, weight, sort_order, rubric) values (null, tid, 'D3', 'العمل الجماعي', 'Teamwork', 1, 3, '[{"score":1,"label_ar":"مبتدئ","label_en":"Initial"},{"score":2,"label_ar":"نامٍ","label_en":"Developing"},{"score":3,"label_ar":"متمكن","label_en":"Established"},{"score":4,"label_ar":"متقدم","label_en":"Advanced"},{"score":5,"label_ar":"رائد","label_en":"Leading"}]'::jsonb) returning id into did;
  insert into public.assessment_questions (organization_id, tool_id, dimension_id, code, text_ar, text_en, question_type, weight, reverse_scored, sort_order, translation_status) values (null, tid, did, 'D3Q1', 'أتعاون بفاعلية مع زملاء من خلفيات مختلفة', 'I collaborate effectively with diverse colleagues', 'scale', 1, false, 1, 'verified');
  insert into public.assessment_questions (organization_id, tool_id, dimension_id, code, text_ar, text_en, question_type, weight, reverse_scored, sort_order, translation_status) values (null, tid, did, 'D3Q2', 'ألتزم بنصيبي من مهام الفريق في الوقت المحدد', 'I deliver my share of team tasks on time', 'scale', 1, false, 2, 'verified');
  insert into public.assessment_dimensions (organization_id, tool_id, code, name, name_en, weight, sort_order, rubric) values (null, tid, 'D4', 'الانضباط المهني', 'Professional discipline', 0.8, 4, '[{"score":1,"label_ar":"مبتدئ","label_en":"Initial"},{"score":2,"label_ar":"نامٍ","label_en":"Developing"},{"score":3,"label_ar":"متمكن","label_en":"Established"},{"score":4,"label_ar":"متقدم","label_en":"Advanced"},{"score":5,"label_ar":"رائد","label_en":"Leading"}]'::jsonb) returning id into did;
  insert into public.assessment_questions (organization_id, tool_id, dimension_id, code, text_ar, text_en, question_type, weight, reverse_scored, sort_order, translation_status) values (null, tid, did, 'D4Q1', 'ألتزم بالمواعيد والتعليمات', 'I respect schedules and instructions', 'scale', 1, false, 1, 'verified');
  insert into public.assessment_questions (organization_id, tool_id, dimension_id, code, text_ar, text_en, question_type, weight, reverse_scored, sort_order, translation_status) values (null, tid, did, 'D4Q2', 'أدير وقتي وأولوياتي بفاعلية', 'I manage my time and priorities effectively', 'scale', 1, false, 2, 'verified');
end $$;
do $$ declare tid uuid; did uuid; begin
  if exists (select 1 from public.assessment_tools where organization_id is null and code = 'ASM-VENTURE') then return; end if;
  insert into public.assessment_tools (organization_id, code, name, name_en, tool_type, subject_type, track_codes, scoring_method, scale_min, scale_max, pass_threshold, classification, status)
  values (null, 'ASM-VENTURE', 'جاهزية المشروع الريادي', 'Venture readiness', 'internal', 'individual', array['incubator','hackathon']::text[], 'weighted_average', 1, 5, 60, '[{"min":0,"max":40,"label_ar":"يحتاج تطويرًا جوهريًا","label_en":"Needs substantial development","interpretation_ar":"الأداء أقل بوضوح من المستوى المطلوب؛ يلزم دعم مركز وخطة تطوير.","interpretation_en":"Clearly below the required level; focused support and a development plan are needed."},{"min":40,"max":60,"label_ar":"نامٍ","label_en":"Developing","interpretation_ar":"أساس موجود مع فجوات واضحة في أبعاد محددة.","interpretation_en":"A foundation exists with clear gaps in specific dimensions."},{"min":60,"max":80,"label_ar":"متمكن","label_en":"Proficient","interpretation_ar":"يحقق المستوى المطلوب مع فرص تحسين محددة.","interpretation_en":"Meets the required level with specific improvement opportunities."},{"min":80,"max":100,"label_ar":"متميز","label_en":"Distinguished","interpretation_ar":"أداء يتجاوز المطلوب ويمكن البناء عليه كنقطة قوة.","interpretation_en":"Exceeds the requirement; a strength to build on."}]'::jsonb, 'active') returning id into tid;
  insert into public.assessment_dimensions (organization_id, tool_id, code, name, name_en, weight, sort_order, rubric) values (null, tid, 'D1', 'وضوح المشكلة والعميل', 'Problem & customer clarity', 1.2, 1, '[{"score":1,"label_ar":"مبتدئ","label_en":"Initial"},{"score":2,"label_ar":"نامٍ","label_en":"Developing"},{"score":3,"label_ar":"متمكن","label_en":"Established"},{"score":4,"label_ar":"متقدم","label_en":"Advanced"},{"score":5,"label_ar":"رائد","label_en":"Leading"}]'::jsonb) returning id into did;
  insert into public.assessment_questions (organization_id, tool_id, dimension_id, code, text_ar, text_en, question_type, weight, reverse_scored, sort_order, translation_status) values (null, tid, did, 'D1Q1', 'المشكلة محددة ومثبتة بمقابلات عملاء', 'The problem is specific and validated with customer interviews', 'scale', 1, false, 1, 'verified');
  insert into public.assessment_questions (organization_id, tool_id, dimension_id, code, text_ar, text_en, question_type, weight, reverse_scored, sort_order, translation_status) values (null, tid, did, 'D1Q2', 'الشريحة المستهدفة محددة بدقة', 'The target segment is precisely defined', 'scale', 1, false, 2, 'verified');
  insert into public.assessment_dimensions (organization_id, tool_id, code, name, name_en, weight, sort_order, rubric) values (null, tid, 'D2', 'الحل والمنتج', 'Solution & product', 1, 2, '[{"score":1,"label_ar":"مبتدئ","label_en":"Initial"},{"score":2,"label_ar":"نامٍ","label_en":"Developing"},{"score":3,"label_ar":"متمكن","label_en":"Established"},{"score":4,"label_ar":"متقدم","label_en":"Advanced"},{"score":5,"label_ar":"رائد","label_en":"Leading"}]'::jsonb) returning id into did;
  insert into public.assessment_questions (organization_id, tool_id, dimension_id, code, text_ar, text_en, question_type, weight, reverse_scored, sort_order, translation_status) values (null, tid, did, 'D2Q1', 'يوجد نموذج أولي قابل للاختبار', 'A testable prototype exists', 'scale', 1, false, 1, 'verified');
  insert into public.assessment_questions (organization_id, tool_id, dimension_id, code, text_ar, text_en, question_type, weight, reverse_scored, sort_order, translation_status) values (null, tid, did, 'D2Q2', 'الحل يتميز بوضوح عن البدائل', 'The solution is clearly differentiated', 'scale', 1, false, 2, 'verified');
  insert into public.assessment_dimensions (organization_id, tool_id, code, name, name_en, weight, sort_order, rubric) values (null, tid, 'D3', 'نموذج العمل', 'Business model', 1.2, 3, '[{"score":1,"label_ar":"مبتدئ","label_en":"Initial"},{"score":2,"label_ar":"نامٍ","label_en":"Developing"},{"score":3,"label_ar":"متمكن","label_en":"Established"},{"score":4,"label_ar":"متقدم","label_en":"Advanced"},{"score":5,"label_ar":"رائد","label_en":"Leading"}]'::jsonb) returning id into did;
  insert into public.assessment_questions (organization_id, tool_id, dimension_id, code, text_ar, text_en, question_type, weight, reverse_scored, sort_order, translation_status) values (null, tid, did, 'D3Q1', 'مصادر الإيراد محددة ومختبرة', 'Revenue streams are defined and tested', 'scale', 1, false, 1, 'verified');
  insert into public.assessment_questions (organization_id, tool_id, dimension_id, code, text_ar, text_en, question_type, weight, reverse_scored, sort_order, translation_status) values (null, tid, did, 'D3Q2', 'تكلفة اكتساب العميل معروفة', 'Customer acquisition cost is known', 'scale', 1, false, 2, 'verified');
  insert into public.assessment_dimensions (organization_id, tool_id, code, name, name_en, weight, sort_order, rubric) values (null, tid, 'D4', 'الفريق', 'Team', 1, 4, '[{"score":1,"label_ar":"مبتدئ","label_en":"Initial"},{"score":2,"label_ar":"نامٍ","label_en":"Developing"},{"score":3,"label_ar":"متمكن","label_en":"Established"},{"score":4,"label_ar":"متقدم","label_en":"Advanced"},{"score":5,"label_ar":"رائد","label_en":"Leading"}]'::jsonb) returning id into did;
  insert into public.assessment_questions (organization_id, tool_id, dimension_id, code, text_ar, text_en, question_type, weight, reverse_scored, sort_order, translation_status) values (null, tid, did, 'D4Q1', 'الفريق يغطي المهارات الأساسية', 'The team covers core skills', 'scale', 1, false, 1, 'verified');
  insert into public.assessment_questions (organization_id, tool_id, dimension_id, code, text_ar, text_en, question_type, weight, reverse_scored, sort_order, translation_status) values (null, tid, did, 'D4Q2', 'الأدوار والمسؤوليات واضحة', 'Roles and responsibilities are clear', 'scale', 1, false, 2, 'verified');
end $$;

-- Central form templates
insert into public.form_templates (organization_id, code, title, title_en, form_type, schema, scoring_enabled, status)
select null, 'FRM-APPLICATION', 'نموذج تقديم عام', 'General application form', 'application', '{"fields":[{"key":"motivation","type":"long_text","label_ar":"لماذا ترغب في الالتحاق بالبرنامج؟","label_en":"Why do you want to join?","required":true},{"key":"education","type":"single_choice","label_ar":"المؤهل","label_en":"Education","required":true,"options":[{"value":"secondary","label_ar":"ثانوي","label_en":"Secondary"},{"value":"diploma","label_ar":"دبلوم","label_en":"Diploma"},{"value":"bachelor","label_ar":"بكالوريوس","label_en":"Bachelor"},{"value":"postgraduate","label_ar":"دراسات عليا","label_en":"Postgraduate"}]},{"key":"employed","type":"single_choice","label_ar":"هل تعمل حاليًا؟","label_en":"Currently employed?","required":true,"options":[{"value":"yes","label_ar":"نعم","label_en":"Yes"},{"value":"no","label_ar":"لا","label_en":"No"}]},{"key":"employer","type":"text","label_ar":"جهة العمل","label_en":"Employer","show_if":{"field":"employed","op":"eq","value":"yes"}},{"key":"cv","type":"file","label_ar":"السيرة الذاتية","label_en":"CV"},{"key":"consent","type":"acknowledgment","label_ar":"أوافق على معالجة بياناتي لأغراض البرنامج وقياس الأثر","label_en":"I consent to processing of my data for program and impact measurement","required":true}]}'::jsonb, false, 'published'
where not exists (select 1 from public.form_templates where organization_id is null and code = 'FRM-APPLICATION');
insert into public.form_templates (organization_id, code, title, title_en, form_type, schema, scoring_enabled, status)
select null, 'FRM-SESSION-FEEDBACK', 'تقييم الجلسة', 'Session feedback', 'feedback', '{"fields":[{"key":"content","type":"rating","label_ar":"جودة المحتوى","label_en":"Content quality","required":true,"min":1,"max":5,"scoring":{"weight":1}},{"key":"facilitator","type":"rating","label_ar":"أداء الميسّر","label_en":"Facilitator","required":true,"min":1,"max":5,"scoring":{"weight":1}},{"key":"relevance","type":"rating","label_ar":"ارتباط الجلسة باحتياجي","label_en":"Relevance to my needs","required":true,"min":1,"max":5,"scoring":{"weight":1}},{"key":"comments","type":"long_text","label_ar":"ملاحظات","label_en":"Comments"}]}'::jsonb, true, 'published'
where not exists (select 1 from public.form_templates where organization_id is null and code = 'FRM-SESSION-FEEDBACK');

-- Platform settings defaults
insert into public.system_settings (organization_id, setting_key, setting_value) values
  (null, 'platform', '{"name_ar":"نماء","name_en":"TANMIA","default_locale":"ar","timezone":"Asia/Riyadh","invitation_ttl_days":7,"data_residency":"SA"}'::jsonb),
  (null, 'measurement_points', '{"T0":"baseline","T1":0,"T2":30,"T3":90,"T4":182,"T5":365}'::jsonb)
on conflict (organization_id, setting_key) do nothing;
insert into public.integration_settings (organization_id, provider, enabled, config) values
  (null, 'email', false, '{}'::jsonb), (null, 'sms', false, '{}'::jsonb), (null, 'whatsapp', false, '{}'::jsonb), (null, 'calendar_ics', true, '{}'::jsonb), (null, 'ai', false, '{}'::jsonb)
on conflict (organization_id, provider) do nothing;

