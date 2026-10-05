-- Isolated demo only. An explicit synthetic review is NOT reconstructed history.
-- Clocks are database-owned; this does not stage, activate, sign or pay.
begin;
create table app_private.reward_round_reviews_v3 (
  id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
  upload_id uuid not null unique references app_private.reward_allocation_uploads_v3(id),
  context_hash text not null check(context_hash~'^[0-9a-f]{64}$'),
  package_hash text not null check(package_hash~'^[0-9a-f]{64}$'),
  review_seconds integer not null check(review_seconds between 0 and 2592000),
  started_at timestamptz not null default clock_timestamp(),
  started_by_user_id uuid not null references public.user_profiles(user_id)
);
create table app_private.reward_round_publications_v3 (
  id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
  review_id uuid not null unique references app_private.reward_round_reviews_v3(id),
  published_at timestamptz not null default clock_timestamp(),
  published_by_user_id uuid not null references public.user_profiles(user_id),
  evidence_hash text not null check(evidence_hash~'^0x[0-9a-f]{64}$' and evidence_hash<>'0x'||repeat('0',64))
);
create index reward_round_reviews_v3_actor on app_private.reward_round_reviews_v3(started_by_user_id);
create index reward_round_publications_v3_actor on app_private.reward_round_publications_v3(published_by_user_id);
alter table app_private.reward_round_reviews_v3 enable row level security;
alter table app_private.reward_round_publications_v3 enable row level security;
revoke all on app_private.reward_round_reviews_v3,app_private.reward_round_publications_v3 from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_round_reviews_v3,app_private.reward_round_publications_v3 to service_role;
create policy reward_round_reviews_v3_read on app_private.reward_round_reviews_v3 for select to service_role using(true);
create policy reward_round_reviews_v3_insert on app_private.reward_round_reviews_v3 for insert to service_role with check(true);
create policy reward_round_publications_v3_read on app_private.reward_round_publications_v3 for select to service_role using(true);
create policy reward_round_publications_v3_insert on app_private.reward_round_publications_v3 for insert to service_role with check(true);
create trigger reward_round_reviews_v3_immutable before update or delete on app_private.reward_round_reviews_v3
  for each row execute function app_private.reject_reward_ledger_mutation();
create trigger reward_round_publications_v3_immutable before update or delete on app_private.reward_round_publications_v3
  for each row execute function app_private.reject_reward_ledger_mutation();

create function public.service_reward_round_publication_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_draft_id uuid,p_slot integer,p_approval_id uuid,p_upload_id uuid,p_action text,p_request_id uuid,p_review_id uuid,p_package_hash text)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d jsonb; v jsonb; fresh jsonb; r app_private.reward_round_reviews_v3%rowtype;
  f app_private.reward_round_publications_v3%rowtype; eligible boolean; seen timestamptz; stamp timestamptz;
begin
  if p_action not in ('read','start','publish') or p_action is null then raise exception 'invalid_reward_round_publication'; end if;
  d:=public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  perform 1 from public.organization_memberships where user_id=p_actor_user_id and organization_id=(d->>'organizationId')::uuid for share;
  perform 1 from public.organizations where id=(d->>'organizationId')::uuid for share;
  if p_action='read' then
    perform 1 from app_private.reward_planning_drafts where id=p_draft_id for share;
  else
    perform 1 from app_private.reward_planning_drafts where id=p_draft_id for update;
  end if;
  v:=public.service_read_reward_allocation_upload_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id);
  if v#>>'{prepared,id}' is distinct from p_upload_id::text or p_upload_id is null
    then raise exception 'reward_allocation_upload_not_found'; end if;
  eligible:=p_chain_id=31337 and v#>>'{document,source,kind}'='synthetic_rehearsal';
  select * into r from app_private.reward_round_reviews_v3 where upload_id=p_upload_id;
  select * into f from app_private.reward_round_publications_v3 where review_id=r.id;
  if p_action='read' then
    if p_request_id is not null or p_review_id is not null or p_package_hash is not null
      then raise exception 'invalid_reward_round_publication'; end if;
  else
    if not coalesce(eligible,false) then raise exception 'reward_round_publication_unsupported'; end if;
    if p_request_id is null or p_request_id='00000000-0000-0000-0000-000000000000'::uuid
      or p_package_hash is distinct from v#>>'{prepared,packageHash}' then raise exception 'reward_round_publication_conflict'; end if;
    if p_action='start' and r.id is not null then
      if p_review_id is not null or r.id is distinct from p_request_id or r.started_by_user_id is distinct from p_actor_user_id
        then raise exception 'reward_round_publication_conflict'; end if;
    elsif p_action='publish' and f.id is not null then
      if p_review_id is distinct from r.id or f.id is distinct from p_request_id or f.published_by_user_id is distinct from p_actor_user_id
        then raise exception 'reward_round_publication_conflict'; end if;
    else
      if v->>'current' is distinct from 'true' then raise exception 'reward_allocation_not_ready'; end if;
      if p_action='start' then
        if p_review_id is not null then raise exception 'reward_round_publication_conflict'; end if;
        insert into app_private.reward_round_reviews_v3(id,upload_id,context_hash,package_hash,review_seconds,started_by_user_id)
          values(p_request_id,p_upload_id,v->>'contextHash',p_package_hash,(v#>>'{document,binding,reviewSeconds}')::integer,p_actor_user_id)
          returning * into r;
      else
        if r.id is null or p_review_id is distinct from r.id then raise exception 'reward_round_publication_conflict'; end if;
        stamp:=clock_timestamp();
        if stamp<r.started_at+make_interval(secs=>r.review_seconds) then raise exception 'reward_round_review_pending'; end if;
        -- Evidence binds this exact synthetic approval/package and genuine server
        -- clocks. No private sporting data or claimant identity goes on chain.
        insert into app_private.reward_round_publications_v3(id,review_id,published_at,published_by_user_id,evidence_hash)
          values(p_request_id,r.id,stamp,p_actor_user_id,'0x'||encode(sha256(convert_to(jsonb_build_object(
            'schema','raceson-synthetic-round-publication-v3','id',p_request_id,'reviewId',r.id,'packageHash',r.package_hash,
            'reviewSeconds',r.review_seconds,'startedAt',r.started_at,'publishedAt',stamp)::text,'UTF8')),'hex')) returning * into f;
      end if;
      fresh:=public.service_read_reward_allocation_upload_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id);
      if fresh->>'current' is distinct from 'true' or fresh->>'contextHash' is distinct from v->>'contextHash'
        then raise exception 'reward_planning_revision_changed'; end if;
    end if;
  end if;
  fresh:=public.service_read_reward_allocation_upload_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id);
  if fresh->>'contextHash' is distinct from v->>'contextHash' or fresh->>'current' is distinct from v->>'current'
    or fresh->'prepared' is distinct from v->'prepared' then raise exception 'reward_planning_revision_changed'; end if;
  if r.id is not null and (r.package_hash is distinct from v#>>'{prepared,packageHash}'
    or r.context_hash is distinct from v#>>'{prepared,contextHash}' or r.review_seconds<>(v#>>'{document,binding,reviewSeconds}')::integer)
    then raise exception 'reward_round_publication_conflict'; end if;
  seen:=clock_timestamp();
  return jsonb_build_object('schema','raceson-round-publication-view-v3','chainId',p_chain_id,'draftId',p_draft_id,'slot',p_slot,
    'approvalId',p_approval_id,'uploadId',p_upload_id,'packageHash',v#>>'{prepared,packageHash}',
    'supported',coalesce(eligible,false),'current',(fresh->>'current')::boolean,'observedAt',seen,
    'review',case when r.id is null then null else jsonb_build_object('id',r.id,'seconds',r.review_seconds,'startedAt',r.started_at,
      'endsAt',r.started_at+make_interval(secs=>r.review_seconds)) end,
    'publication',case when f.id is null then null else jsonb_build_object('id',f.id,'publishedAt',f.published_at,'evidenceHash',f.evidence_hash) end,
    'canPublish',coalesce(eligible and (fresh->>'current')::boolean and r.id is not null and f.id is null
      and seen>=r.started_at+make_interval(secs=>r.review_seconds),false));
end $$;
revoke all on function public.service_reward_round_publication_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.service_reward_round_publication_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,text,uuid,uuid,text) to service_role;
commit;
