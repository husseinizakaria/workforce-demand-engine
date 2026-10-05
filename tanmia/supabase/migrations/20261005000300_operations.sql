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
