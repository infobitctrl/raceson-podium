begin;

-- Demo overlay ONLY. Opt-in sporting review evidence, not award approval, wallet
-- consent or funding authority. No backfill of imported historical publications.
create table app_private.reward_result_review_policies_v3 (
  id uuid primary key default gen_random_uuid(),
  event_category_id uuid not null references public.event_categories(id),
  organization_id uuid not null references public.organizations(id),
  revision integer not null check (revision between 1 and 2147483646),
  review_seconds integer not null check (review_seconds between 0 and 2592000),
  configured_at timestamptz not null default clock_timestamp(),
  configured_by_user_id uuid not null references public.user_profiles(user_id),
  unique(event_category_id,revision),
  unique(id,event_category_id)
);
create table app_private.reward_result_review_clocks_v3 (
  event_category_id uuid primary key references public.event_categories(id),
  policy_id uuid not null,
  started_by_publication_id uuid not null unique references public.result_publications(id),
  started_at timestamptz not null,
  foreign key(policy_id,event_category_id) references app_private.reward_result_review_policies_v3(id,event_category_id)
);
create table app_private.reward_final_publication_evidence_v3 (
  publication_id uuid primary key references public.result_publications(id),
  event_category_id uuid not null references app_private.reward_result_review_clocks_v3(event_category_id),
  policy_id uuid not null,
  official_published_at timestamptz not null,
  foreign key(policy_id,event_category_id) references app_private.reward_result_review_policies_v3(id,event_category_id)
);
create index reward_final_publication_evidence_v3_category_idx on app_private.reward_final_publication_evidence_v3(event_category_id);
alter table app_private.reward_result_review_policies_v3 enable row level security;
alter table app_private.reward_result_review_clocks_v3 enable row level security;
alter table app_private.reward_final_publication_evidence_v3 enable row level security;
revoke all on app_private.reward_result_review_policies_v3,app_private.reward_result_review_clocks_v3,
  app_private.reward_final_publication_evidence_v3 from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_result_review_policies_v3,app_private.reward_result_review_clocks_v3,
  app_private.reward_final_publication_evidence_v3 to service_role;

create function app_private.reward_result_review_immutable_v3()
returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'reward_result_review_immutable'; end $$;
create trigger reward_result_review_policies_v3_immutable before update or delete on app_private.reward_result_review_policies_v3
  for each row execute function app_private.reward_result_review_immutable_v3();
create trigger reward_result_review_clocks_v3_immutable before update or delete on app_private.reward_result_review_clocks_v3
  for each row execute function app_private.reward_result_review_immutable_v3();
create trigger reward_final_publication_evidence_v3_immutable before update or delete on app_private.reward_final_publication_evidence_v3
  for each row execute function app_private.reward_result_review_immutable_v3();

create function app_private.reward_result_review_authorized_v3(p_user_id uuid,p_organization_id uuid)
returns boolean language sql volatile security invoker set search_path='' as $$
  select app_private.reward_planning_authorized(p_user_id,p_organization_id) and exists(
    select 1 from public.organization_memberships m where m.user_id=p_user_id and m.organization_id=p_organization_id
      and m.status='active' and (m.role='owner' or 'results.manage'=any(m.permission_keys)))
$$;
create function app_private.reward_result_review_held_v3(p_category_id uuid)
returns boolean language sql volatile security invoker set search_path='' as $$
  select exists(select 1 from public.result_complaints where event_category_id=p_category_id and status='open')
    or exists(select 1 from public.result_adjudication_cases where event_category_id=p_category_id
      and case_state in ('submitted','accepted','in_review','decision_pending','appealed'))
$$;

-- Lock the same category on both sides of final publication vs a newly opened
-- complaint/adjudication. Existing non-reward races keep their ordinary behavior.
create function app_private.reward_result_hold_lock_v3()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  perform c.id from public.event_categories c where
    (c.id=new.event_category_id or (tg_op='UPDATE' and c.id=old.event_category_id))
    and exists(select 1 from app_private.reward_result_review_policies_v3 p where p.event_category_id=c.id)
    order by c.id for update;
  return new;
end $$;
create trigger reward_result_complaint_lock_v3 before insert or update on public.result_complaints
  for each row execute function app_private.reward_result_hold_lock_v3();
create trigger reward_result_adjudication_lock_v3 before insert or update on public.result_adjudication_cases
  for each row execute function app_private.reward_result_hold_lock_v3();

-- A publication's timestamp for this new path is server-owned. No HTTP/direct
-- service caller can manufacture an earlier review start or future final date.
create function app_private.reward_result_publication_stamp_v3()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.event_categories where id=new.event_category_id for update;
  if exists(select 1 from app_private.reward_result_review_policies_v3 where event_category_id=new.event_category_id) then
    new.published_at := clock_timestamp();
  end if;
  return new;
end $$;
create trigger reward_result_publication_stamp_v3 before insert on public.result_publications
  for each row execute function app_private.reward_result_publication_stamp_v3();

create function app_private.reward_result_publication_capture_v3()
returns trigger language plpgsql security invoker set search_path='' as $$
declare p app_private.reward_result_review_policies_v3%rowtype;
  c app_private.reward_result_review_clocks_v3%rowtype; org uuid;
begin
  select * into p from app_private.reward_result_review_policies_v3 where event_category_id=new.event_category_id
    order by revision desc limit 1;
  if not found then return new; end if;
  select s.organization_id into org from public.event_categories r
    join public.event_editions e on e.id=r.event_edition_id join public.event_series s on s.id=e.event_series_id
    where r.id=new.event_category_id;
  if org is distinct from p.organization_id or not app_private.reward_result_review_authorized_v3(new.published_by_user_id,org) then
    raise exception using errcode='42501',message='reward_result_review_not_found';
  end if;
  if not exists(select 1 from public.result_runs r where r.id=new.result_run_id and r.event_category_id=new.event_category_id
    and r.status='succeeded' and r.completed_at is not null) then raise exception 'reward_result_publication_invalid'; end if;
  select * into c from app_private.reward_result_review_clocks_v3 where event_category_id=new.event_category_id;
  if not found and (new.publication_state='provisional' or
    (p.review_seconds=0 and new.publication_state in ('official','corrected'))) then
    insert into app_private.reward_result_review_clocks_v3(event_category_id,policy_id,started_by_publication_id,started_at)
      values(new.event_category_id,p.id,new.id,new.published_at) returning * into c;
  end if;
  if new.publication_state in ('official','corrected') then
    if c.policy_id is distinct from p.id or new.published_at<c.started_at+make_interval(secs=>p.review_seconds) then
      raise exception 'reward_result_review_not_finished';
    end if;
    if app_private.reward_result_review_held_v3(new.event_category_id) then raise exception 'reward_result_review_held'; end if;
    insert into app_private.reward_final_publication_evidence_v3(publication_id,event_category_id,policy_id,official_published_at)
      values(new.id,new.event_category_id,p.id,new.published_at);
  end if;
  return new;
end $$;
create trigger reward_result_publication_capture_v3 after insert on public.result_publications
  for each row execute function app_private.reward_result_publication_capture_v3();

create function public.service_read_reward_result_review_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_category_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare org uuid; p app_private.reward_result_review_policies_v3%rowtype;
  c app_private.reward_result_review_clocks_v3%rowtype; latest public.result_publications%rowtype;
  final_record app_private.reward_final_publication_evidence_v3%rowtype;
  held boolean; phase text; observed timestamptz;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  select s.organization_id into org from public.event_categories r join public.event_editions e on e.id=r.event_edition_id
    join public.event_series s on s.id=e.event_series_id where r.id=p_category_id;
  if org is null or not app_private.reward_result_review_authorized_v3(p_actor_user_id,org) then
    raise exception using errcode='42501',message='reward_result_review_not_found';
  end if;
  -- Serialize observation with policy/publication/hold writes, then recheck Auth.
  perform 1 from public.event_categories where id=p_category_id for update;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  select * into p from app_private.reward_result_review_policies_v3 where event_category_id=p_category_id order by revision desc limit 1;
  select * into c from app_private.reward_result_review_clocks_v3 where event_category_id=p_category_id;
  select * into latest from public.result_publications where event_category_id=p_category_id order by published_at desc,created_at desc,id desc limit 1;
  select * into final_record from app_private.reward_final_publication_evidence_v3 where publication_id=latest.id and policy_id=p.id;
  held:=app_private.reward_result_review_held_v3(p_category_id); observed:=clock_timestamp();
  phase:=case when p.id is null then 'unconfigured' when held then 'held' when c.policy_id is null then 'awaiting_provisional'
    when observed<c.started_at+make_interval(secs=>p.review_seconds) then 'in_review'
    when final_record.publication_id is not null then 'final' else 'awaiting_final' end;
  -- Recheck the live hierarchy too; neither saved org IDs nor JWT roles grant access.
  if not exists(select 1 from public.event_categories r join public.event_editions e on e.id=r.event_edition_id
    join public.event_series s on s.id=e.event_series_id where r.id=p_category_id and s.organization_id=org)
    or (p.id is not null and p.organization_id<>org) or not app_private.reward_result_review_authorized_v3(p_actor_user_id,org) then
    raise exception using errcode='42501',message='reward_result_review_not_found';
  end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  return jsonb_build_object('schema','raceson-result-review-v3','categoryId',p_category_id,'organizationId',org,'observedAt',observed,
    'state',phase,'revision',coalesce(p.revision,0),'reviewSeconds',p.review_seconds,'policyId',p.id,
    'configuredAt',p.configured_at,'locked',latest.id is not null,'held',held,
    'startedAt',c.started_at,'startedByPublicationId',c.started_by_publication_id,
    'endsAt',c.started_at+make_interval(secs=>p.review_seconds),
    'latestPublicationId',latest.id,'finalPublicationId',case when phase='final' then final_record.publication_id end,
    'officialPublishedAt',case when phase='final' then final_record.official_published_at end,
    'allocationApproved',false);
end $$;

create function public.service_save_reward_result_review_policy_v3(p_actor_user_id uuid,p_actor_session_id uuid,
  p_category_id uuid,p_expected_revision integer,p_review_seconds integer)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare org uuid; p app_private.reward_result_review_policies_v3%rowtype;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  select s.organization_id into org from public.event_categories r join public.event_editions e on e.id=r.event_edition_id
    join public.event_series s on s.id=e.event_series_id where r.id=p_category_id;
  if org is null or not app_private.reward_result_review_authorized_v3(p_actor_user_id,org) then
    raise exception using errcode='42501',message='reward_result_review_not_found';
  end if;
  perform 1 from public.organization_memberships where user_id=p_actor_user_id and organization_id=org for share;
  perform 1 from public.organizations where id=org for share;
  perform 1 from public.event_categories where id=p_category_id for update;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_result_review_authorized_v3(p_actor_user_id,org) or not exists(
    select 1 from public.event_categories r join public.event_editions e on e.id=r.event_edition_id
      join public.event_series s on s.id=e.event_series_id where r.id=p_category_id and s.organization_id=org) then
    raise exception using errcode='42501',message='reward_result_review_not_found';
  end if;
  if p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=2147483646
    or p_review_seconds is null or p_review_seconds<0 or p_review_seconds>2592000 then raise exception 'invalid_reward_result_review'; end if;
  select * into p from app_private.reward_result_review_policies_v3 where event_category_id=p_category_id order by revision desc limit 1;
  if coalesce(p.revision,0)<>p_expected_revision then raise exception using errcode='40001',message='reward_result_review_revision_changed'; end if;
  -- Any publication, not just an existing clock, locks the announced policy.
  -- Imported historical results therefore cannot be retroactively given a clock.
  if exists(select 1 from public.result_publications where event_category_id=p_category_id) then raise exception 'reward_result_review_locked'; end if;
  if p.id is null or p.review_seconds<>p_review_seconds then
    insert into app_private.reward_result_review_policies_v3(event_category_id,organization_id,revision,review_seconds,configured_by_user_id)
      values(p_category_id,org,p_expected_revision+1,p_review_seconds,p_actor_user_id);
  end if;
  return public.service_read_reward_result_review_v3(p_actor_user_id,p_actor_session_id,p_category_id);
end $$;
revoke all on function app_private.reward_result_review_immutable_v3(),app_private.reward_result_review_authorized_v3(uuid,uuid),
  app_private.reward_result_review_held_v3(uuid),app_private.reward_result_hold_lock_v3(),
  app_private.reward_result_publication_stamp_v3(),app_private.reward_result_publication_capture_v3(),
  public.service_read_reward_result_review_v3(uuid,uuid,uuid),
  public.service_save_reward_result_review_policy_v3(uuid,uuid,uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_result_review_immutable_v3(),app_private.reward_result_review_authorized_v3(uuid,uuid),
  app_private.reward_result_review_held_v3(uuid),app_private.reward_result_hold_lock_v3(),
  app_private.reward_result_publication_stamp_v3(),app_private.reward_result_publication_capture_v3(),
  public.service_read_reward_result_review_v3(uuid,uuid,uuid),
  public.service_save_reward_result_review_policy_v3(uuid,uuid,uuid,integer,integer) to service_role;
commit;
