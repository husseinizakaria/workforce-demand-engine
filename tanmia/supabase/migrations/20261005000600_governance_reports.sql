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
