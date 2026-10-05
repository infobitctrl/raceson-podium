-- Isolated demo only. Read projections of immutable sporting allocations,
-- not current source approval, wallet readiness, funding or payment authority.
begin;

create function app_private.require_reward_distribution_scope(
  p_actor_user_id uuid,p_actor_session_id uuid,p_programme_id uuid,p_chain_id integer
) returns void language plpgsql volatile security invoker set search_path='' as $$
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator(p_programme_id,p_actor_user_id);
  if p_chain_id is null or p_chain_id not in (10143,31337) then
    raise exception using errcode='22023',message='invalid_reward_distribution_request'; end if;
  if not exists(select 1 from app_private.reward_programmes where id=p_programme_id and chain_id=p_chain_id) then
    raise exception using errcode='42501',message='reward_distribution_scope_required'; end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
end $$;

create function public.service_list_reward_operator_campaigns(
  p_actor_user_id uuid,p_actor_session_id uuid,p_programme_id uuid,p_chain_id integer
) returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare body jsonb;
begin
  perform app_private.require_reward_distribution_scope(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id);
  select jsonb_build_object('programmeId',p.id,'chainId',p.chain_id,'budgetWei',p.budget_wei::text,
    'items',(select coalesce(jsonb_agg(jsonb_build_object('campaignId',c.id,'pot',c.pot,'scopeKey',c.scope_key,
      'roundNumber',(round_config->>'number')::integer,'raceName',left(nullif(btrim(e.name),''),256),
      'budgetWei',c.budget_wei::text,'allocation',case when a.id is null then null else jsonb_build_object(
        'allocationId',a.id,'reservedAt',a.reserved_at,'allocatedWei',a.allocated_wei::text,
        'unallocatedWei',a.unallocated_wei::text,'awardCount',(select count(*) from app_private.reward_entitlements where allocation_id=a.id)) end)
      order by case when c.pot='race' then 0 else 1 end,(round_config->>'number')::integer,c.id),'[]'::jsonb)
      from app_private.reward_campaigns c
      left join lateral (select value round_config from jsonb_array_elements(p.configuration->'rounds') where value->>'id'=c.scope_key) r on true
      left join public.event_editions e on e.id=(round_config->>'eventEditionId')::uuid
      left join app_private.reward_allocations a on a.campaign_id=c.id where c.programme_id=p.id)) into body
  from app_private.reward_programmes p where p.id=p_programme_id and p.chain_id=p_chain_id;
  perform app_private.require_reward_distribution_scope(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id);
  return body;
end $$;

create function public.service_list_reward_operator_awards(
  p_actor_user_id uuid,p_actor_session_id uuid,p_programme_id uuid,p_chain_id integer,
  p_campaign_id uuid,p_allocation_id uuid,p_after_id uuid default null
) returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare items jsonb;
begin
  perform app_private.require_reward_distribution_scope(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id);
  if not exists(select 1 from app_private.reward_allocations a join app_private.reward_campaigns c on c.id=a.campaign_id
    where a.id=p_allocation_id and c.id=p_campaign_id and c.programme_id=p_programme_id) then
    raise exception using errcode='42501',message='reward_distribution_scope_required'; end if;
  select coalesce(jsonb_agg(body order by id),'[]'::jsonb) into items from (
    select e.id,jsonb_build_object('entitlementId',e.id,'beneficiaryKind',b.kind,'beneficiaryId',b.entity_id,
      'beneficiaryName',left(nullif(btrim(case when b.kind='athlete' then athlete.display_name else club.name end),''),256),
      'amountWei',e.amount_wei::text) body
    from app_private.reward_entitlements e join app_private.reward_beneficiaries b on b.id=e.beneficiary_id and b.campaign_id=p_campaign_id
    left join public.athlete_profiles athlete on b.kind='athlete' and athlete.id=b.entity_id
    left join public.clubs club on b.kind='club' and club.id=b.entity_id
    where e.allocation_id=p_allocation_id and (p_after_id is null or e.id>p_after_id) order by e.id limit 26
  ) page;
  perform app_private.require_reward_distribution_scope(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id);
  return jsonb_build_object('programmeId',p_programme_id,'chainId',p_chain_id,'campaignId',p_campaign_id,'allocationId',p_allocation_id,
    'items',case when jsonb_array_length(items)>25 then items-25 else items end,
    'nextCursor',case when jsonb_array_length(items)>25 then items->24->>'entitlementId' else null end);
end $$;

create function public.service_read_reward_operator_award(
  p_actor_user_id uuid,p_actor_session_id uuid,p_programme_id uuid,p_chain_id integer,
  p_campaign_id uuid,p_allocation_id uuid,p_entitlement_id uuid,p_after_id uuid default null
) returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare body jsonb; explanation jsonb; source jsonb; configuration jsonb; breakdown jsonb; sources jsonb; source_ids text[]; source_count integer;
begin
  perform app_private.require_reward_distribution_scope(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id);
  select jsonb_build_object('programmeId',p.id,'chainId',p.chain_id,'campaignId',c.id,'allocationId',a.id,
      'entitlementId',e.id,'beneficiaryKind',b.kind,'beneficiaryId',b.entity_id,
      'beneficiaryName',left(nullif(btrim(case when b.kind='athlete' then athlete.display_name else club.name end),''),256),
      'amountWei',e.amount_wei::text,'reservedAt',a.reserved_at,'sourceSnapshotId',s.id),e.explanation,s.source_body,p.configuration
    into body,explanation,source,configuration
    from app_private.reward_entitlements e join app_private.reward_allocations a on a.id=e.allocation_id
    join app_private.reward_campaigns c on c.id=a.campaign_id join app_private.reward_programmes p on p.id=c.programme_id
    join app_private.reward_beneficiaries b on b.id=e.beneficiary_id and b.campaign_id=c.id
    join app_private.reward_sporting_reviews r on r.id=a.review_id join app_private.reward_source_snapshots s on s.id=r.source_snapshot_id
    left join public.athlete_profiles athlete on b.kind='athlete' and athlete.id=b.entity_id
    left join public.clubs club on b.kind='club' and club.id=b.entity_id
    where e.id=p_entitlement_id and a.id=p_allocation_id and c.id=p_campaign_id and p.id=p_programme_id and p.chain_id=p_chain_id;
  if body is null then raise exception using errcode='42501',message='reward_distribution_scope_required'; end if;
  -- Pick each field explicitly. No full explanation, source document, review,
  -- salt, private commitment or wallet/identity context crosses this boundary.
  select coalesce(jsonb_agg(jsonb_build_object('family',b->'family','scopeId',b->'scopeId','amountWei',b->'amountWei',
      'sourceCount',jsonb_array_length(b->'sourceIds'),
      'scopeName',(select left(nullif(btrim(x->>'name'),''),256) from jsonb_array_elements(source->'classifications') x where x->>'id'=b->>'scopeId'),
      'calculation',case b->'calculation'->>'method'
        when 'podium' then jsonb_build_object('method','podium','divisionBudgetWei',b->'calculation'->'divisionBudgetWei',
          'rank',b->'calculation'->'rank','tieSize',b->'calculation'->'tieSize','sharedPrizeWei',b->'calculation'->'sharedPrizeWei',
          'prizeSlots',b->'calculation'->'prizeSlots','clubScore',b->'calculation'->'clubScore')
        when 'record' then jsonb_build_object('method','record','divisionBudgetWei',b->'calculation'->'divisionBudgetWei',
          'baselineTimeMs',b->'calculation'->'baselineTimeMs','finishTimeMs',b->'calculation'->'finishTimeMs','tiedHolders',b->'calculation'->'tiedHolders')
        when 'proportional' then jsonb_build_object('method','proportional','familyBudgetWei',b->'calculation'->'familyBudgetWei',
          'weight',b->'calculation'->'weight','totalWeight',b->'calculation'->'totalWeight')
        else null end) order by n),'[]'::jsonb) into breakdown
    from jsonb_array_elements(explanation->'breakdown') with ordinality x(b,n);
  select coalesce(array_agg(distinct id order by id),array[]::text[]) into source_ids
    from jsonb_array_elements(explanation->'breakdown') b cross join lateral jsonb_array_elements_text(b->'sourceIds') x(id);
  select count(*) into source_count from jsonb_array_elements(source->'rows') r where r->>'id'=any(source_ids);
  if source_count<>cardinality(source_ids) then raise exception using errcode='22023',message='invalid_reward_distribution_document'; end if;
  select coalesce(jsonb_agg(row_body order by id),'[]'::jsonb) into sources from (
    select r->>'id' id,jsonb_build_object('sourceId',r->'id','roundId',r->'roundId','roundNumber',round_config->'number',
      'raceId',r->'raceId','publicationId',r->'publicationId','athleteId',r->'canonicalAthleteId',
      'athleteName',left(nullif(btrim(athlete.display_name),''),256),'representedClubId',r->'canonicalClubId',
      'finishTimeMs',r->'finishTimeMs','distanceMetres',race_config->'distanceMetres',
      -- PostgreSQL numeric source text retains scale (e.g. 10000.00). Remove
      -- only a zero fractional suffix; non-integer values must still fail the
      -- shared strict integer decoder rather than being rounded or truncated.
      'clubPointsHundredths',regexp_replace(r->>'clubPointsHundredths','[.]0+$',''),
      'contributions',(select jsonb_agg(jsonb_build_object('family',b->'family','scopeId',b->'scopeId') order by n)
        from jsonb_array_elements(explanation->'breakdown') with ordinality x(b,n) where b->'sourceIds' ? (r->>'id'))) row_body
    from jsonb_array_elements(source->'rows') r
    join lateral jsonb_array_elements(configuration->'rounds') round_config on round_config->>'id'=r->>'roundId'
    join lateral jsonb_array_elements(round_config->'races') race_config on race_config->>'id'=r->>'raceId'
    left join public.athlete_profiles athlete on athlete.id=(r->>'canonicalAthleteId')::uuid
    where r->>'id'=any(source_ids) and (p_after_id is null or (r->>'id')::uuid>p_after_id)
    order by (r->>'id')::uuid limit 51
  ) page;
  perform app_private.require_reward_distribution_scope(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id);
  return body||jsonb_build_object('breakdown',breakdown,'sourceCount',source_count,
    'sources',case when jsonb_array_length(sources)>50 then sources-50 else sources end,
    'nextCursor',case when jsonb_array_length(sources)>50 then sources->49->>'sourceId' else null end);
end $$;

revoke all on function app_private.require_reward_distribution_scope(uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.service_list_reward_operator_campaigns(uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.service_list_reward_operator_awards(uuid,uuid,uuid,integer,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.service_read_reward_operator_award(uuid,uuid,uuid,integer,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.require_reward_distribution_scope(uuid,uuid,uuid,integer) to service_role;
grant execute on function public.service_list_reward_operator_campaigns(uuid,uuid,uuid,integer) to service_role;
grant execute on function public.service_list_reward_operator_awards(uuid,uuid,uuid,integer,uuid,uuid,uuid) to service_role;
grant execute on function public.service_read_reward_operator_award(uuid,uuid,uuid,integer,uuid,uuid,uuid,uuid) to service_role;
commit;
