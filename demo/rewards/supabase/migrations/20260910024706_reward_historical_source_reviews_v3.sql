begin;

-- Isolated demo only. Human review of existing official publications, NOT an
-- invented historical complaint clock, award approval or permission to pay.
create table app_private.reward_historical_source_reviews_v3 (
  id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
  draft_id uuid not null references app_private.reward_planning_drafts(id),
  slot integer not null check(slot between 1 and 4),
  previous_review_id uuid,
  context_hash text not null check(context_hash ~ '^[0-9a-f]{64}$'),
  context jsonb not null check(jsonb_typeof(context)='object' and octet_length(context::text)<=262144),
  decision text not null check(decision in ('confirmed_final','held')),
  reviewed_at timestamptz not null default clock_timestamp(),
  reviewed_by_user_id uuid not null references public.user_profiles(user_id),
  sequence bigint generated always as identity unique,
  unique(draft_id,slot,id),
  foreign key(draft_id,slot,previous_review_id) references app_private.reward_historical_source_reviews_v3(draft_id,slot,id),
  check(previous_review_id is null or previous_review_id<>id)
);
create index reward_historical_source_reviews_v3_draft_idx on app_private.reward_historical_source_reviews_v3(draft_id,slot,sequence desc);
alter table app_private.reward_historical_source_reviews_v3 enable row level security;
revoke all on app_private.reward_historical_source_reviews_v3 from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_historical_source_reviews_v3 to service_role;
create policy reward_historical_source_reviews_v3_select on app_private.reward_historical_source_reviews_v3 for select to service_role using(true);
create policy reward_historical_source_reviews_v3_insert on app_private.reward_historical_source_reviews_v3 for insert to service_role with check(true);
revoke all on sequence app_private.reward_historical_source_reviews_v3_sequence_seq from public,anon,authenticated;
grant usage on sequence app_private.reward_historical_source_reviews_v3_sequence_seq to service_role;
create trigger reward_historical_source_reviews_v3_immutable before update or delete on app_private.reward_historical_source_reviews_v3
  for each row execute function app_private.reward_result_review_immutable_v3();

create function app_private.reward_historical_source_context_v3(p_view jsonb)
returns jsonb language sql immutable security invoker set search_path='' as $$
  select jsonb_build_object('schema','raceson-historical-source-context-v3',
    'record',p_view->'record','workspace',p_view->'workspace','sourceHash',p_view->'sourceHash')
$$;
create function app_private.reward_historical_source_decision_v3(p app_private.reward_historical_source_reviews_v3,p_context_hash text)
returns jsonb language sql stable security invoker set search_path='' set timezone='UTC' as $$
  select jsonb_build_object('id',p.id,'slot',p.slot,'contextHash',p.context_hash,'decision',p.decision,
    'reviewedAt',p.reviewed_at,'current',p.context_hash=p_context_hash)
$$;

create function public.service_read_reward_historical_source_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare v jsonb; h text; decisions jsonb;
begin
  -- Reuses the atomic imported-snapshot reader, not a new external source fetch.
  v:=public.service_read_reward_published_preview_v2(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  if v->'snapshot'='null'::jsonb or v->>'sourceHash' is null then raise exception 'reward_historical_source_missing'; end if;
  h:=encode(sha256(convert_to(app_private.reward_historical_source_context_v3(v)::text,'UTF8')),'hex');
  select coalesce(jsonb_agg(app_private.reward_historical_source_decision_v3(r,h) order by r.slot),'[]'::jsonb) into decisions
    from (select distinct on(slot) * from app_private.reward_historical_source_reviews_v3 where draft_id=p_draft_id order by slot,sequence desc) r;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_planning_authorized(p_actor_user_id,(v#>>'{record,organizationId}')::uuid) then raise exception 'reward_planning_not_found'; end if;
  return v || jsonb_build_object('contextHash',h,'decisions',decisions,'observedAt',clock_timestamp(),'recordedDecision',null);
end $$;

create function public.service_review_reward_historical_source_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid,
  p_slot integer,p_request_id uuid,p_expected_review_id uuid,p_context_hash text,p_decision text)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d jsonb; v jsonb; r jsonb; race jsonb; row_count integer; old app_private.reward_historical_source_reviews_v3%rowtype;
  saved app_private.reward_historical_source_reviews_v3%rowtype;
begin
  d:=public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  perform 1 from public.organization_memberships where user_id=p_actor_user_id and organization_id=(d->>'organizationId')::uuid for share;
  perform 1 from public.organizations where id=(d->>'organizationId')::uuid for share;
  perform 1 from app_private.reward_planning_drafts where id=p_draft_id for update;
  v:=public.service_read_reward_historical_source_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  if p_slot is null or p_slot not between 1 and 4 or p_request_id is null or p_request_id='00000000-0000-0000-0000-000000000000'::uuid
    or p_context_hash is null or p_context_hash !~ '^[0-9a-f]{64}$'
    or p_decision is null or p_decision not in ('confirmed_final','held') then raise exception 'invalid_reward_historical_source'; end if;
  select * into saved from app_private.reward_historical_source_reviews_v3 where id=p_request_id;
  if found then
    if saved.draft_id<>p_draft_id or saved.slot<>p_slot or saved.reviewed_by_user_id<>p_actor_user_id
      or saved.context_hash<>p_context_hash or saved.decision<>p_decision or saved.previous_review_id is distinct from p_expected_review_id
      then raise exception 'reward_historical_review_conflict'; end if;
    -- Recover exactly the old acknowledgement, even if a later hold superseded
    -- it. The current decisions remain separate; retry can never undo that hold.
    return v || jsonb_build_object('recordedDecision',app_private.reward_historical_source_decision_v3(saved,v->>'contextHash'));
  end if;
  if v->>'contextHash' is distinct from p_context_hash then raise exception 'reward_planning_revision_changed'; end if;
  select * into old from app_private.reward_historical_source_reviews_v3 where draft_id=p_draft_id and slot=p_slot order by sequence desc limit 1;
  if old.id is distinct from p_expected_review_id then raise exception 'reward_historical_review_conflict'; end if;
  if v#>>'{workspace,catalogueHash}' is distinct from v#>>'{workspace,boundCatalogueHash}'
    or (v#>>'{workspace,revision}')::integer<1 then raise exception 'reward_planning_revision_changed'; end if;
  select value into r from jsonb_array_elements(v#>'{snapshot,catalogue,rounds}') c
    where c->>'slot'=p_slot::text and c->>'status'='completed'
      and c->>'id'=v#>>array['workspace','mapping','rounds',(p_slot-1)::text,'roundId'];
  if r is null or jsonb_array_length(r->'races')=0 then raise exception 'reward_historical_source_missing'; end if;
  -- A hold may be recorded on problematic evidence. Confirmation cannot upgrade
  -- a generic published flag or an incomplete import to an official publication.
  if p_decision='confirmed_final' then
    for race in select value from jsonb_array_elements(r->'races') loop
      if race->>'publicationId' is null or coalesce(race->>'publicationState','') not in ('official','corrected') then
        raise exception 'invalid_reward_historical_source'; end if;
      select count(*) into row_count from jsonb_array_elements(v#>'{snapshot,results}') rr where rr->>'raceId'=race->>'id'
        and rr->>'publicationId'=race->>'publicationId' and rr->>'publicationState'=race->>'publicationState';
      if row_count=0 or row_count is distinct from (race->>'resultCount')::integer then raise exception 'invalid_reward_historical_source'; end if;
    end loop;
  end if;
  insert into app_private.reward_historical_source_reviews_v3(id,draft_id,slot,previous_review_id,context_hash,context,decision,reviewed_by_user_id)
    values(p_request_id,p_draft_id,p_slot,p_expected_review_id,p_context_hash,app_private.reward_historical_source_context_v3(v),p_decision,p_actor_user_id)
    returning * into saved;
  v:=public.service_read_reward_historical_source_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  if v->>'contextHash' is distinct from p_context_hash then raise exception 'reward_planning_revision_changed'; end if;
  return v || jsonb_build_object('recordedDecision',app_private.reward_historical_source_decision_v3(saved,v->>'contextHash'));
end $$;
revoke all on function app_private.reward_historical_source_context_v3(jsonb),
  app_private.reward_historical_source_decision_v3(app_private.reward_historical_source_reviews_v3,text),
  public.service_read_reward_historical_source_v3(uuid,uuid,integer,uuid),
  public.service_review_reward_historical_source_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_historical_source_context_v3(jsonb),
  app_private.reward_historical_source_decision_v3(app_private.reward_historical_source_reviews_v3,text),
  public.service_read_reward_historical_source_v3(uuid,uuid,integer,uuid),
  public.service_review_reward_historical_source_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,text,text) to service_role;
commit;
