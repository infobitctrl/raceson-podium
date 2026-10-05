-- Independent rewards demo. Private preparation is not funding or payment.
begin;

create function app_private.require_reward_preparation_scope(
  p_actor_user_id uuid,p_actor_session_id uuid,p_programme_id uuid,p_chain_id integer,p_campaign_id uuid
) returns void language plpgsql volatile security invoker set search_path='' as $$
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='22023',message='reward_preparation_isolation_required'; end if;
  perform app_private.require_reward_distribution_scope(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id);
  if not exists(select 1 from app_private.reward_campaigns where id=p_campaign_id and programme_id=p_programme_id) then
    raise exception using errcode='42501',message='reward_preparation_scope_required'; end if;
end $$;

create function public.service_check_reward_operator_preparation(
  p_actor_user_id uuid,p_actor_session_id uuid,p_programme_id uuid,p_chain_id integer,p_campaign_id uuid
) returns jsonb language plpgsql volatile security invoker set search_path='' as $$
begin
  perform app_private.require_reward_preparation_scope(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id,p_campaign_id);
  return jsonb_build_object('programmeId',p_programme_id,'chainId',p_chain_id,'campaignId',p_campaign_id);
end $$;

-- SERVER ONLY: the context/record packets contain private sporting evidence.
-- The HTTP adapter calculates a whitelisted preview, never returns this bundle.
create function public.service_read_reward_operator_preparation(
  p_actor_user_id uuid,p_actor_session_id uuid,p_programme_id uuid,p_chain_id integer,p_campaign_id uuid,p_review_id uuid default null
) returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare body jsonb; context jsonb; records jsonb; names jsonb; review_id uuid; latest_id uuid;
begin
  perform app_private.require_reward_preparation_scope(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id,p_campaign_id);
  select id into latest_id from app_private.reward_sporting_reviews where campaign_id=p_campaign_id order by revision desc limit 1;
  review_id:=coalesce(p_review_id,latest_id);
  if review_id is not null then
    context:=public.service_read_reward_calculation_context(p_campaign_id,p_actor_user_id,null,review_id);
    select coalesce(jsonb_agg(public.service_read_reward_record_approval(p_campaign_id,p_actor_user_id,approval_id) order by approval_id),'[]'::jsonb)
      into records from (select distinct (r#>>'{baseline,approvalId}')::uuid approval_id
        from jsonb_array_elements(context#>'{review,body,roundReviews}') rr
        cross join lateral jsonb_array_elements(rr->'records') r where r->'baseline'<>'null'::jsonb) approvals;
    select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'id',id,'name',left(nullif(btrim(name),''),256)) order by kind,id),'[]'::jsonb) into names from (
      select distinct 'athlete' kind,a.id,a.display_name name from jsonb_array_elements(context#>'{snapshot,source,rows}') r
        join public.athlete_profiles a on a.id=(r->>'canonicalAthleteId')::uuid
      union
      select distinct 'club' kind,c.id,c.name from jsonb_array_elements(context#>'{snapshot,source,rows}') r
        join public.clubs c on c.id=(r->>'canonicalClubId')::uuid
    ) labels;
  end if;
  select jsonb_build_object('programmeId',p_programme_id,'chainId',p_chain_id,'campaignId',p_campaign_id,
    'budgetWei',c.budget_wei::text,'latestReviewId',latest_id,
    'allocationId',(select id from app_private.reward_allocations where campaign_id=c.id),
    'context',context,'recordApprovals',coalesce(records,'[]'::jsonb),'names',coalesce(names,'[]'::jsonb)) into body
    from app_private.reward_campaigns c where c.id=p_campaign_id;
  perform app_private.require_reward_preparation_scope(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id,p_campaign_id);
  return body;
end $$;

-- The allocation document comes only from the server calculator. The browser
-- submits the persisted review and preview commitment, never amounts/sources.
-- Existing reservation performs latest/source/record/idempotency checks under
-- its locks. Session/permission loss after INSERT rolls back that whole call.
create function public.service_reserve_reward_operator_allocation(
  p_actor_user_id uuid,p_actor_session_id uuid,p_programme_id uuid,p_chain_id integer,p_campaign_id uuid,
  p_review_id uuid,p_idempotency_key text,p_allocation jsonb
) returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare body jsonb;
begin
  perform app_private.require_reward_preparation_scope(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id,p_campaign_id);
  if not exists(select 1 from app_private.reward_sporting_reviews where id=p_review_id and campaign_id=p_campaign_id) then
    raise exception using errcode='42501',message='reward_preparation_scope_required'; end if;
  body:=public.service_reserve_reward_allocation(p_review_id,p_actor_user_id,p_idempotency_key,p_allocation);
  perform app_private.require_reward_preparation_scope(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id,p_campaign_id);
  return body;
end $$;

revoke all on function app_private.require_reward_preparation_scope(uuid,uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
revoke all on function public.service_check_reward_operator_preparation(uuid,uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
revoke all on function public.service_read_reward_operator_preparation(uuid,uuid,uuid,integer,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.service_reserve_reward_operator_allocation(uuid,uuid,uuid,integer,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function app_private.require_reward_preparation_scope(uuid,uuid,uuid,integer,uuid) to service_role;
grant execute on function public.service_check_reward_operator_preparation(uuid,uuid,uuid,integer,uuid) to service_role;
grant execute on function public.service_read_reward_operator_preparation(uuid,uuid,uuid,integer,uuid,uuid) to service_role;
grant execute on function public.service_reserve_reward_operator_allocation(uuid,uuid,uuid,integer,uuid,uuid,text,jsonb) to service_role;
commit;
