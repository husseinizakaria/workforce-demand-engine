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
