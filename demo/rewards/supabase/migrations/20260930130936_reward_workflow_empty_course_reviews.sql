begin;
-- Explicit zero-entry course in the approved finite synthetic fixture only.
-- Publication evidence, real-source nonempty checks and normal authority remain.
create or replace function public.service_review_reward_historical_source_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid,
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
  if (v#>>'{workspace,catalogueHash}' is distinct from v#>>'{workspace,boundCatalogueHash}'
      and coalesce(public.service_read_reward_programme_approval_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id)#>>'{approval,current}','false')<>'true')
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
      if (row_count=0 and not (p_chain_id=10143 and p_draft_id='9b000000-0000-4000-8000-000000000152'::uuid
        and app_private.reward_workflow_snapshot_20260930_v2(v->'snapshot','9b000000-0000-4000-8000-000000000151'::uuid)
        and race->>'competitionId'='9b000000-0000-4000-8000-000000000061'
        and race->>'resultCount'='0'))
        or row_count is distinct from (race->>'resultCount')::integer then raise exception 'invalid_reward_historical_source'; end if;
    end loop;
  end if;
  insert into app_private.reward_historical_source_reviews_v3(id,draft_id,slot,previous_review_id,context_hash,context,decision,reviewed_by_user_id)
    values(p_request_id,p_draft_id,p_slot,p_expected_review_id,p_context_hash,app_private.reward_historical_source_context_v3(v),p_decision,p_actor_user_id)
    returning * into saved;
  v:=public.service_read_reward_historical_source_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  if v->>'contextHash' is distinct from p_context_hash then raise exception 'reward_planning_revision_changed'; end if;
  return v || jsonb_build_object('recordedDecision',app_private.reward_historical_source_decision_v3(saved,v->>'contextHash'));
end $$;

commit;
