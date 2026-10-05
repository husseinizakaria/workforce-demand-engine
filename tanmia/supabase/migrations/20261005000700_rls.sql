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
  using (user_id = auth.uid() or public.tenant_can(organization_id, 'users', 'view'));
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
  using (public.tenant_can(organization_id, 'assessments', 'edit') or (assessor_user_id = auth.uid() and status in ('draft','submitted')))
  with check (public.tenant_can(organization_id, 'assessments', 'edit') or (assessor_user_id = auth.uid() and status in ('draft','submitted')));
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
  using (public.tenant_can(organization_id, 'templates', 'edit') or (submitted_by = auth.uid() and status in ('draft','submitted')))
  with check (public.tenant_can(organization_id, 'templates', 'edit') or (submitted_by = auth.uid() and status in ('draft','submitted')));
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
