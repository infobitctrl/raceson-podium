begin;

create index reward_programme_operator_discovery on app_private.reward_programmes(operator_user_id,chain_id,id);

-- Private discovery only. Configured budgets are not observed chain balances.
create function public.service_list_reward_operator_programmes(
  p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_after_id uuid default null
) returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare items jsonb; item jsonb;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if p_chain_id is null or p_chain_id not in (10143,31337) then
    raise exception using errcode='22023',message='invalid_reward_discovery_request'; end if;
  select coalesce(jsonb_agg(body order by id),'[]'::jsonb) into items from (
    select p.id,jsonb_build_object('programmeId',p.id,'organizationId',p.organization_id,
      'seasonId',p.league_season_id,'year',(p.configuration->>'year')::integer,
      'leagueName',left(nullif(btrim(l.name),''),256),'seasonName',left(nullif(btrim(s.name),''),256),
      'budgetWei',p.budget_wei::text,'createdAt',p.created_at) body
    from app_private.reward_programmes p
    left join public.league_seasons s on s.id=p.league_season_id
      and exists(select 1 from public.leagues x where x.id=s.league_id and x.organization_id=p.organization_id)
    left join public.leagues l on l.id=s.league_id and l.organization_id=p.organization_id
    where p.operator_user_id=p_actor_user_id and p.chain_id=p_chain_id
      and public.service_user_has_organization_permission(p.organization_id,p_actor_user_id,'leagues.manage','organization',null)
      and (p_after_id is null or p.id>p_after_id)
    order by p.id limit 26
  ) page;
  -- Fresh statements after possible lock waits; do not return a stale operator list.
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  for item in select value from jsonb_array_elements(items) loop
    perform app_private.require_reward_operator((item->>'programmeId')::uuid,p_actor_user_id);
  end loop;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  return jsonb_build_object('chainId',p_chain_id,
    'items',case when jsonb_array_length(items)>25 then items-25 else items end,
    'nextCursor',case when jsonb_array_length(items)>25 then items->24->>'programmeId' else null end);
end $$;

-- This private scope predicate mirrors the existing
-- readiness context: an earned athlete beneficiary (including merge aliases),
-- or a previous review in this programme. Neither condition approves ownership.
create function app_private.reward_destination_has_programme_scope(p_programme_id uuid,p_request_id uuid)
returns boolean language sql stable security invoker set search_path='' set timezone='UTC' as $$
  select exists(
    with recursive aliases(id) as (
      select d.athlete_profile_id from app_private.reward_athlete_destination_requests d where d.id=p_request_id
      union select a.id from public.athlete_profiles a join aliases x on a.merged_into_athlete_profile_id=x.id
    ) select 1 from aliases x join app_private.reward_beneficiaries b on b.entity_id=x.id and b.kind='athlete'
      join app_private.reward_campaigns c on c.id=b.campaign_id where c.programme_id=p_programme_id
  ) or exists(select 1 from app_private.reward_athlete_readiness_reviews r
    where r.programme_id=p_programme_id and r.request_id=p_request_id);
$$;

create function public.service_list_reward_operator_destinations(
  p_actor_user_id uuid,p_actor_session_id uuid,p_programme_id uuid,p_chain_id integer,p_after_id uuid default null
) returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare items jsonb; item jsonb;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator(p_programme_id,p_actor_user_id);
  if p_chain_id is null or p_chain_id not in (10143,31337) then
    raise exception using errcode='22023',message='invalid_reward_discovery_request'; end if;
  if not exists(select 1 from app_private.reward_programmes where id=p_programme_id and chain_id=p_chain_id) then
    raise exception using errcode='42501',message='reward_readiness_scope_required'; end if;
  select coalesce(jsonb_agg(body order by id),'[]'::jsonb) into items from (
    select d.id,jsonb_build_object('requestId',d.id,'athleteProfileId',d.athlete_profile_id,
      'athleteName',left(nullif(btrim(a.display_name),''),256),'address',ch.address,'requestedAt',d.requested_at,
      'destinationStatus',app_private.reward_athlete_destination_document(d)->>'status') body
    from app_private.reward_athlete_destination_requests d
    join app_private.reward_wallet_proofs proof on proof.id=d.proof_id
    join app_private.reward_wallet_challenges ch on ch.id=proof.challenge_id and ch.chain_id=p_chain_id
    left join public.athlete_profiles a on a.id=d.athlete_profile_id
    where (p_after_id is null or d.id>p_after_id)
      and app_private.reward_destination_has_programme_scope(p_programme_id,d.id)
    order by d.id limit 26
  ) page;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator(p_programme_id,p_actor_user_id);
  for item in select value from jsonb_array_elements(items) loop
    if not app_private.reward_destination_has_programme_scope(p_programme_id,(item->>'requestId')::uuid) then
      raise exception using errcode='42501',message='reward_readiness_scope_required'; end if;
  end loop;
  perform app_private.require_reward_operator(p_programme_id,p_actor_user_id);
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  return jsonb_build_object('programmeId',p_programme_id,'chainId',p_chain_id,
    'items',case when jsonb_array_length(items)>25 then items-25 else items end,
    'nextCursor',case when jsonb_array_length(items)>25 then items->24->>'requestId' else null end);
end $$;

revoke all on function public.service_list_reward_operator_programmes(uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
revoke all on function app_private.reward_destination_has_programme_scope(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.service_list_reward_operator_destinations(uuid,uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_list_reward_operator_programmes(uuid,uuid,integer,uuid) to service_role;
grant execute on function app_private.reward_destination_has_programme_scope(uuid,uuid) to service_role;
grant execute on function public.service_list_reward_operator_destinations(uuid,uuid,uuid,integer,uuid) to service_role;
commit;
