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
