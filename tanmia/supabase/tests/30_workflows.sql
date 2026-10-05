-- Journeys, approvals, scheduling conflicts, assessments, maturity, impact,
-- evidence verification, storage, central templates, notifications, reports.
select id as org_a from public.organizations where name_en = 'Org A' \gset
select id as org_b from public.organizations where name_en = 'Org B' \gset
select id as prg_a from public.programs where name = 'Graduate Program A' \gset
select id as ben1 from public.beneficiaries where email = 'b1@x.test' \gset
select id as ben2 from public.beneficiaries where email = 'b2@x.test' \gset
select id as exp_a from public.experts where full_name = 'خبير أ' \gset
\set fixture `cat "$TANMIA_ROOT/supabase/tests/fixtures/scoring.json"`

-- ---------------------------------------------------------------- six journeys
select tests.login('admin.a@tanmia.test');
set role authenticated;
insert into public.programs (organization_id, name, track_code) values
  (:'org_a', 'J hackathon', 'hackathon'), (:'org_a', 'J incubator', 'incubator'), (:'org_a', 'J vocational', 'vocational'),
  (:'org_a', 'J consulting', 'consulting'), (:'org_a', 'J bootcamp', 'bootcamp');
reset role;
select tests.ok((select string_agg(p.track_code || ':' || (select count(*) from public.program_stages s where s.program_id = p.id), ',' order by p.track_code)
                 from public.programs p where p.organization_id = :'org_a') = 'bootcamp:9,consulting:9,graduate:21,hackathon:12,incubator:13,vocational:9',
  'all six track journeys seeded with the specified stages');
select tests.ok((select depends_on from public.program_stages where program_id = :'prg_a' and stage_key = 'final_assessment') = '{periodic_assessment,job_rotation,projects_assignments}',
  'stage dependencies copied from template');

-- ---------------------------------------------------------------- journey workflow gates
select id as st_need from public.program_stages where program_id = :'prg_a' and stage_key = 'workforce_need' \gset
select id as st_design from public.program_stages where program_id = :'prg_a' and stage_key = 'program_design' \gset
select tests.login('admin.a@tanmia.test');
set role authenticated;
select tests.ok((public.transition_program_stage(:'st_design', 'in_progress'))->>'code' = 'DEPENDENCIES_NOT_MET', 'cannot start a stage before its prerequisite');
select tests.ok((public.transition_program_stage(:'st_need', 'in_progress'))->>'ok' = 'true', 'first stage starts');
select tests.ok((public.transition_program_stage(:'st_need', 'completed'))->>'code' = 'EVIDENCE_MISSING', 'completion blocked until required evidence exists');
insert into public.evidence (organization_id, program_id, stage_key, title, evidence_type, description)
values (:'org_a', :'prg_a', 'workforce_need', 'Workforce plan', 'document', 'Approved workforce plan');
select tests.ok((public.transition_program_stage(:'st_need', 'completed'))->>'ok' = 'true', 'stage completes once evidence is attached');
select tests.ok((public.transition_program_stage(:'st_design', 'in_progress'))->>'ok' = 'true', 'next stage starts after prerequisite');
insert into public.evidence (organization_id, program_id, stage_key, title, evidence_type, description)
values (:'org_a', :'prg_a', 'program_design', 'Design doc', 'document', 'Program design');
select tests.ok((public.transition_program_stage(:'st_design', 'completed'))->>'code' = 'APPROVAL_REQUESTED', 'approval-gated stage raises an approval request');
select tests.ok((select approval_status from public.program_stages where id = :'st_design') = 'pending', 'stage approval pending');
select tests.ok((public.decide_approval((select id from public.approval_requests where entity_id = :'st_design'), 'approved'))->>'code' = 'SELF_APPROVAL_NOT_ALLOWED', 'requester cannot approve own request');
select tests.ok((public.transition_program_stage(:'st_design', 'blocked'))->>'code' = 'BLOCKER_NOTE_REQUIRED', 'blocking a stage requires a documented reason');
reset role;
select tests.login('owner@tanmia.test');
set role authenticated;
select tests.ok((public.decide_approval((select id from public.approval_requests where entity_id = :'st_design'), 'approved', 'OK'))->>'ok' = 'true', 'approver approves stage');
reset role;
select tests.ok((select status from public.program_stages where id = :'st_design') = 'completed', 'approved stage is completed');

select tests.login('coord.a@tanmia.test');
set role authenticated;
select tests.throws(format($q$select public.transition_program_stage(%L, 'in_progress', null, true)$q$, (select id from public.program_stages where program_id = :'prg_a' and stage_key = 'idp')),
  'override requires programs.approve', '42501');
reset role;

-- ---------------------------------------------------------------- scheduling conflicts
select tests.login('admin.a@tanmia.test');
set role authenticated;
insert into public.expert_availability (organization_id, expert_id, kind, weekday, start_time, end_time)
values (:'org_a', :'exp_a', 'weekly', extract(dow from (now() + interval '1 day') at time zone 'Asia/Riyadh')::int, '00:00', '23:59');
select tests.ok(public.check_session_conflicts(:'org_a', now() + interval '1 day 30 minutes', now() + interval '1 day 90 minutes', :'exp_a', array[:'ben1']::uuid[]) @> '[{"type":"expert_overlap"}]',
  'expert double-booking detected');
select tests.ok(public.check_session_conflicts(:'org_a', now() + interval '1 day 30 minutes', now() + interval '1 day 90 minutes', null, array[:'ben1']::uuid[]) @> '[{"type":"beneficiary_overlap"}]',
  'beneficiary double-booking detected');
select tests.ok(jsonb_array_length(public.check_session_conflicts(:'org_a', now() + interval '20 day', now() + interval '20 day 1 hour', null, '{}')) = 0, 'free slot has no conflicts');
reset role;
select tests.login('admin.b@tanmia.test');
set role authenticated;
select tests.throws(format($q$select public.check_session_conflicts(%L, now(), now() + interval '1 hour')$q$, :'org_a'), 'conflict check refuses other organizations', '42501');
reset role;

-- ---------------------------------------------------------------- assessment scoring parity with the TS engine
select tests.login('quality.a@tanmia.test');
set role authenticated;
insert into public.assessment_tools (organization_id, code, name, scale_min, scale_max, scoring_method, pass_threshold, classification, status)
select :'org_a', 'FIXTURE', 'Fixture tool', (f->'tool'->>'scale_min')::numeric, (f->'tool'->>'scale_max')::numeric, f->'tool'->>'scoring_method',
       (f->'tool'->>'pass_threshold')::numeric,
       '[{"min":0,"max":40,"label_ar":"يحتاج تطويرًا","label_en":"Needs development"},{"min":40,"max":60,"label_ar":"نامٍ","label_en":"Developing"},{"min":60,"max":80,"label_ar":"متمكن","label_en":"Proficient"},{"min":80,"max":100,"label_ar":"متميز","label_en":"Distinguished"}]'::jsonb,
       'active'
from (select :'fixture'::jsonb f) x;
insert into public.assessment_dimensions (organization_id, tool_id, code, name, weight)
select :'org_a', t.id, d->>'code', d->>'code', (d->>'weight')::numeric
from public.assessment_tools t, jsonb_array_elements((:'fixture'::jsonb)->'dimensions') d where t.code = 'FIXTURE';
insert into public.assessment_questions (organization_id, tool_id, dimension_id, code, text_en, question_type, options, weight, reverse_scored)
select :'org_a', t.id, dm.id, q->>'code', q->>'code', q->>'question_type', q->'options', (q->>'weight')::numeric, (q->>'reverse_scored')::boolean
from public.assessment_tools t
cross join jsonb_array_elements((:'fixture'::jsonb)->'questions') q
join public.assessment_dimensions dm on dm.tool_id = t.id and dm.code = q->>'dimension'
where t.code = 'FIXTURE';
insert into public.assessment_results (organization_id, tool_id, program_id, beneficiary_id, measurement_point, responses)
select :'org_a', t.id, :'prg_a', :'ben1', 'T0',
       (select jsonb_object_agg(q.id::text, (:'fixture'::jsonb)->'responses'->q.code) from public.assessment_questions q where q.tool_id = t.id)
from public.assessment_tools t where t.code = 'FIXTURE';
reset role;
select r.total_score as fx_total, r.normalized_score as fx_norm, r.passed as fx_passed, r.interpretation->>'label_en' as fx_label,
       (r.dimension_scores->>(select id::text from public.assessment_dimensions where code = 'D1' and tool_id = r.tool_id))::numeric as fx_d1,
       (r.dimension_scores->>(select id::text from public.assessment_dimensions where code = 'D2' and tool_id = r.tool_id))::numeric as fx_d2
from public.assessment_results r join public.assessment_tools t on t.id = r.tool_id where t.code = 'FIXTURE' \gset
select tests.ok(:fx_d1 = ((:'fixture'::jsonb)->'expected'->>'D1')::numeric and :fx_d2 = ((:'fixture'::jsonb)->'expected'->>'D2')::numeric, 'dimension scores match fixture (reverse scoring, choices, weights)');
select tests.ok(:fx_total = ((:'fixture'::jsonb)->'expected'->>'total_score')::numeric, 'weighted total matches fixture');
select tests.ok(:fx_norm = ((:'fixture'::jsonb)->'expected'->>'normalized_score')::numeric, 'normalized score matches fixture');
select tests.ok(:'fx_label' = (:'fixture'::jsonb)->'expected'->>'label_en' and :'fx_passed'::boolean, 'classification and pass flag match fixture');

update public.assessment_tools set scoring_method = 'sum' where code = 'FIXTURE';
insert into public.assessment_results (organization_id, tool_id, program_id, beneficiary_id, measurement_point, source, dimension_scores)
select :'org_a', t.id, :'prg_a', :'ben2', 'T0', 'external_import',
       jsonb_build_object((select id::text from public.assessment_dimensions where tool_id = t.id and code = 'D1'), 5,
                          (select id::text from public.assessment_dimensions where tool_id = t.id and code = 'D2'), 3)
from public.assessment_tools t where t.code = 'FIXTURE';
select tests.ok((select total_score = 8 and normalized_score = 75 from public.assessment_results where beneficiary_id = :'ben2' and source = 'external_import'),
  'sum scoring of imported dimension scores matches fixture');

select id as fx_tool from public.assessment_tools where code = 'FIXTURE' \gset
select tests.login('coord.a@tanmia.test');
set role authenticated;
update public.assessment_results set status = 'verified';
reset role;
select tests.ok((select count(*) from public.assessment_results where status = 'verified') = 0, 'users without assessment rights cannot change results');
select tests.login('expert.a@tanmia.test');
set role authenticated;
select tests.throws(format($q$insert into public.assessment_results (organization_id, tool_id, program_id, beneficiary_id, measurement_point, status) values (%L, %L, %L, %L, 'T1', 'verified')$q$, :'org_a', :'fx_tool', :'prg_a', :'ben1'),
  'assessors without assessments.verify cannot self-verify', '42501');
insert into public.assessment_results (organization_id, tool_id, program_id, beneficiary_id, measurement_point, dimension_scores)
values (:'org_a', :'fx_tool', :'prg_a', :'ben1', 'T1', '{}'::jsonb);
select tests.ok(tests.rows('select 1 from public.assessment_results') = 1, 'assigned expert can submit and see only own assessments');
reset role;

-- ---------------------------------------------------------------- maturity T0/T1
select tests.login('admin.a@tanmia.test');
set role authenticated;
select public.copy_central_template('maturity_framework', (select id from public.maturity_frameworks where organization_id is null and code = 'MAT-GRADUATE'), :'org_a') as fw_id \gset
select tests.ok(tests.rows(format('select 1 from public.maturity_frameworks where id = %L and organization_id = %L', :'fw_id', :'org_a')) = 1, 'central maturity framework copied into organization');
update public.maturity_frameworks set program_id = :'prg_a' where id = :'fw_id';
insert into public.maturity_assessments (organization_id, framework_id, program_id, beneficiary_id, measurement_point, dimension_scores) values
  (:'org_a', :'fw_id', :'prg_a', :'ben1', 'T0', '{"competence":2,"job_readiness":2,"practical_application":2,"independence":2,"performance":2,"role_readiness":2}'),
  (:'org_a', :'fw_id', :'prg_a', :'ben1', 'T1', '{"competence":4,"job_readiness":3,"practical_application":4,"independence":3,"performance":3,"role_readiness":3}');
select tests.throws(format($q$insert into public.maturity_assessments (organization_id, framework_id, program_id, beneficiary_id, measurement_point, dimension_scores) values (%L, %L, %L, %L, 'T2', '{"competence": 9}')$q$, :'org_a', :'fw_id', :'prg_a', :'ben1'),
  'maturity scores outside scale are rejected', '22023');
select tests.throws(format($q$insert into public.maturity_assessments (organization_id, framework_id, program_id, beneficiary_id, measurement_point, dimension_scores) values (%L, %L, %L, %L, 'T3', '{"unknown": 3}')$q$, :'org_a', :'fw_id', :'prg_a', :'ben1'),
  'unknown maturity dimensions are rejected', '22023');
select tests.throws(format($q$insert into public.maturity_assessments (organization_id, framework_id, program_id, beneficiary_id, measurement_point, dimension_scores) values (%L, %L, %L, %L, 'T0', '{"competence": 3}')$q$, :'org_a', :'fw_id', :'prg_a', :'ben1'),
  'one assessment per subject per measurement point', '23505');
reset role;
-- weights: 1.2,1.2,1,0.8,1,1 = 6.2 ; T1 = (4*1.2+3*1.2+4*1+3*0.8+3+3)/6.2 = 20.8/6.2 = 3.35
select tests.ok((select overall_score from public.maturity_assessments where measurement_point = 'T0') = 2.00, 'T0 overall computed');
select tests.ok((select overall_score from public.maturity_assessments where measurement_point = 'T1') = 3.35, 'T1 weighted overall computed');

-- ---------------------------------------------------------------- impact measurement + evidence
select id as ind_a from public.indicators where program_id = :'prg_a' limit 1 \gset
select tests.login('quality.a@tanmia.test');
set role authenticated;
insert into public.indicator_measurements (indicator_id, measurement_point, value, sample_size) values (:'ind_a', 'T0', 2.1, 20), (:'ind_a', 'T1', 3.4, 18);
select tests.ok(tests.rows(format('select 1 from public.indicator_measurements where program_id = %L and organization_id = %L', :'prg_a', :'org_a')) = 2, 'measurements inherit program and organization from indicator');
reset role;

select tests.login('admin.a@tanmia.test');
set role authenticated;
insert into public.evidence (organization_id, program_id, indicator_id, title, evidence_type, description, verification_status)
values (:'org_a', :'prg_a', :'ind_a', 'Assessment report', 'assessment_report', 'T1 report', 'verified');
select tests.ok((select verification_status from public.evidence where title = 'Assessment report') = 'verified', 'admin with evidence.verify may record verified evidence');
insert into public.evidence (organization_id, program_id, title, evidence_type, description) values (:'org_a', :'prg_a', 'Self check', 'photo', 'photo');
select tests.throws($q$update public.evidence set verification_status = 'verified' where title = 'Self check'$q$, 'uploader cannot verify own evidence', '42501');
reset role;
select tests.login('coord.a@tanmia.test');
set role authenticated;
insert into public.evidence (organization_id, program_id, title, evidence_type, description, verification_status) values (:'org_a', :'prg_a', 'Coord upload', 'photo', 'x', 'verified');
reset role;
select tests.ok((select verification_status from public.evidence where title = 'Coord upload') = 'pending', 'non-verifier uploads are forced to pending');
select tests.login('quality.a@tanmia.test');
set role authenticated;
update public.evidence set verification_status = 'verified', verification_notes = 'checked' where title = 'Coord upload';
reset role;
select tests.ok((select verified_by = tests.uid('quality.a@tanmia.test') and verified_at is not null from public.evidence where title = 'Coord upload'), 'verifier and timestamp recorded');

-- ---------------------------------------------------------------- storage (organization-scoped paths)
select tests.login('admin.a@tanmia.test');
set role authenticated;
insert into storage.objects (bucket_id, name) values ('evidence', :'org_a' || '/' || :'prg_a' || '/report.pdf');
select tests.throws(format($q$insert into storage.objects (bucket_id, name) values ('evidence', %L)$q$, :'org_b' || '/x.pdf'), 'cannot upload into another organization folder', '42501');
select tests.throws($q$insert into storage.objects (bucket_id, name) values ('evidence', 'no-org-prefix/x.pdf')$q$, 'uploads require an organization-scoped path', '42501');
select tests.ok(tests.rows('select 1 from storage.objects') = 1, 'admin A reads own organization file');
reset role;
select tests.login('admin.b@tanmia.test');
set role authenticated;
select tests.ok(tests.rows('select 1 from storage.objects') = 0, 'admin B cannot read org A files');
delete from storage.objects;
reset role;
select tests.ok((select count(*) from storage.objects) = 1, 'admin B cannot delete org A files');
select tests.login('viewer.a@tanmia.test');
set role authenticated;
select tests.ok(tests.rows('select 1 from storage.objects') = 1, 'viewer can read org files');
delete from storage.objects;
reset role;
select tests.ok((select count(*) from storage.objects) = 1, 'viewer cannot delete files');
select tests.login('admin.a@tanmia.test');
set role authenticated;
delete from storage.objects where name like :'org_a' || '/%';
reset role;
select tests.ok((select count(*) from storage.objects) = 0, 'admin with evidence.delete removes own organization file');

-- ---------------------------------------------------------------- central templates & forms
select tests.login('admin.a@tanmia.test');
set role authenticated;
select tests.ok(tests.rows('select 1 from public.assessment_tools where organization_id is null') = 2, 'central assessment tools visible to organizations');
select tests.throws($q$insert into public.assessment_tools (organization_id, code, name) values (null, 'X', 'central attempt')$q$, 'organizations cannot create central templates', '42501');
select public.copy_central_template('assessment_tool', (select id from public.assessment_tools where organization_id is null and code = 'ASM-EMPLOYABILITY'), :'org_a') as copied_tool \gset
select tests.ok(tests.rows(format('select 1 from public.assessment_questions where tool_id = %L', :'copied_tool')) = 10, 'copied tool includes all questions');
select public.copy_central_template('form_template', (select id from public.form_templates where organization_id is null and code = 'FRM-SESSION-FEEDBACK'), :'org_a') as form_id \gset
reset role;
select tests.login('ben.a@tanmia.test');
set role authenticated;
select tests.ok(tests.rows('select 1 from public.form_templates where organization_id is not null') = 1, 'beneficiary sees published organization forms');
insert into public.form_submissions (organization_id, template_id, program_id, beneficiary_id, answers)
values (:'org_a', :'form_id', :'prg_a', :'ben1', '{"content":5,"facilitator":4,"relevance":3,"comments":"good"}');
select tests.ok((select score from public.form_submissions limit 1) = 12, 'form submission scored server-side');
select tests.throws(format($q$insert into public.form_submissions (organization_id, template_id, program_id, beneficiary_id, answers) values (%L, %L, %L, %L, '{}')$q$, :'org_a', :'form_id', :'prg_a', :'ben2'),
  'beneficiary cannot submit on behalf of someone else', '42501');
select tests.throws($q$update public.form_submissions set status = 'approved'$q$, 'beneficiary cannot approve own submission', '42501');
reset role;
select tests.login('admin.a@tanmia.test');
set role authenticated;
select tests.throws(format($q$update public.form_templates set schema = '{"fields":[]}' where id = %L$q$, :'form_id'), 'published form with submissions is locked', '42501');
reset role;

-- ---------------------------------------------------------------- notifications
insert into public.notifications (organization_id, user_id, event_type, title, status) values
  (:'org_a', tests.uid('ben.a@tanmia.test'), 'session_reminder', 'Reminder', 'sent'),
  (:'org_a', tests.uid('coord.a@tanmia.test'), 'session_reminder', 'Other', 'sent');
select tests.login('ben.a@tanmia.test');
set role authenticated;
select tests.ok(tests.rows('select 1 from public.notifications') = 1, 'users only see their own notifications');
select public.mark_notification_read((select id from public.notifications limit 1));
select tests.ok((select status from public.notifications limit 1) = 'read', 'user marks own notification read');
reset role;

-- ---------------------------------------------------------------- reports, dashboard
select tests.login('admin.a@tanmia.test');
set role authenticated;
insert into public.reports (organization_id, program_id, report_type, title) values (:'org_a', :'prg_a', 'progress', 'Progress Q1');
insert into public.report_versions (organization_id, report_id, version, content) select :'org_a', id, 1, '{"sections":[]}' from public.reports where title = 'Progress Q1';
select tests.ok((public.org_dashboard(:'org_a')->>'programs_total')::int = 6, 'organization dashboard aggregates');
select tests.ok((public.org_dashboard(:'org_b')->>'programs_total')::int = 0, 'dashboard of another organization returns nothing (RLS)');
reset role;
select tests.ok((select code from public.reports where title = 'Progress Q1') ~ '^RPT-', 'report code generated');
