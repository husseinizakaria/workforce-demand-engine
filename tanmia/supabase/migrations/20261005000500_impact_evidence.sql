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
