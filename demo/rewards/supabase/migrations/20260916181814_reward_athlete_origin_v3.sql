begin;

-- Display metadata only, taken from the approved record and its exact sealed
-- source snapshot. Never map a slot number to today's event catalogue.
create function app_private.reward_athlete_origin_v3(p_document jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare round_id text; event_name text; event_id text; event_date text; slot integer;
begin
  slot:=(p_document->>'slot')::integer;
  if slot between 1 and 5 then
    select r->>'roundId' into round_id from jsonb_array_elements(p_document#>'{mapping,rounds}') r
      where (r->>'slot')::integer=slot;
    select r->>'name',r->>'editionId',r->>'date' into event_name,event_id,event_date
      from app_private.reward_public_snapshots_v2 s,
        lateral jsonb_array_elements(s.payload#>'{catalogue,rounds}') r
      where s.season_id=(p_document#>>'{record,seasonId}')::uuid
        and s.organization_id=(p_document#>>'{record,organizationId}')::uuid
        and s.source_hash=p_document->>'sourceHash'
        and r->>'id'=round_id and (r->>'slot')::integer=slot;
  end if;
  return jsonb_build_object('schema','raceson-reward-origin-v1',
    'programmeName',p_document#>>'{record,seasonName}',
    'hostName',p_document#>>'{record,organizationName}',
    'potKind',case when slot=6 then 'league' else 'race' end,
    'roundId',round_id,'eventName',event_name,'eventEditionId',event_id,'eventDate',event_date,
    'sourceKind',p_document#>>'{source,kind}');
end $$;
revoke all on function app_private.reward_athlete_origin_v3(jsonb) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_athlete_origin_v3(jsonb) to service_role;

create or replace function public.service_read_own_reward_allocations_v3(
  p_user_id uuid,p_session_id uuid,p_chain_id integer,p_after_id text default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare result jsonb; today date:=(clock_timestamp() at time zone 'Europe/Zagreb')::date;
begin
  perform app_private.require_reward_account(p_user_id,p_session_id);
  if p_chain_id is null or p_chain_id not in (31337,10143)
    or (p_after_id is not null and p_after_id !~ '^0x[0-9a-f]{64}$') then
    raise exception 'invalid_reward_allocation_query';
  end if;
  perform 1 from public.user_profiles where user_id=p_user_id for share;
  perform 1 from public.athlete_profiles where claimed_by_user_id=p_user_id order by id for share;
  with own as (
    select r.*,a.draft_id,a.slot,a.document,a.approved_at,p.date_of_birth,p.birth_year
    from public.athlete_profiles p
    join app_private.reward_allocation_recipients_v3 r on r.source_beneficiary_id=p.id and r.beneficiary_kind='athlete'
    join app_private.reward_allocation_approvals_v3 a on a.id=r.approval_id
    where p.claimed_by_user_id=p_user_id and p.is_claimed and p.status='active' and p.merged_into_athlete_profile_id is null
      and ((a.slot between 1 and 4 and a.document->>'schema'='raceson-allocation-document-v3.1')
        or (a.slot in (5,6) and a.document->>'schema'='raceson-allocation-document-v3.2'))
      and (a.document#>>'{record,chainId}')::integer=p_chain_id
      and (p_after_id is null or r.entitlement_id>decode(substr(p_after_id,3),'hex'))
      and not exists(select 1 from app_private.reward_allocation_approvals_v3 newer
        where newer.draft_id=a.draft_id and newer.slot=a.slot and newer.sequence>a.sequence)
    order by r.entitlement_id limit 51
  ), page as (select * from own order by entitlement_id limit 50)
  select jsonb_build_object('schema','raceson-own-allocations-v3','chainId',p_chain_id,'items',coalesce((select jsonb_agg(
    jsonb_build_object('entitlementId','0x'||encode(entitlement_id,'hex'),'approvalId',approval_id,
      'draftId',draft_id,'slot',slot,'athleteProfileId',source_beneficiary_id,'chainId',p_chain_id,
      'sourceKind',case when slot=5 then 'native_finale' when slot=6 then 'final_league' else document#>>'{source,kind}' end,'amountWei',amount_wei::text,
      'campaignAddress',document#>>'{binding,campaignAddress}',
      'breakdown',app_private.reward_athlete_award_breakdown_v3(document,source_beneficiary_id,amount_wei),
      'origin',app_private.reward_athlete_origin_v3(document),
      'recordedAt',to_char(approved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'ageStatus',case
        when app_private.reward_privy_synthetic_identity_v3(draft_id,p_chain_id,source_beneficiary_id,p_user_id) then 'synthetic_test'
        when date_of_birth is not null and (date_of_birth>today or (birth_year is not null and birth_year<>extract(year from date_of_birth))) then 'unknown'
        when date_of_birth is not null and date_of_birth>today-interval '18 years' then 'minor'
        when date_of_birth is null then 'unknown' else 'unverified_adult' end)
    order by entitlement_id) from page),'[]'::jsonb),
    'nextCursor',case when (select count(*) from own)>50 then
      (select '0x'||encode(entitlement_id,'hex') from page order by entitlement_id desc limit 1) else null end) into result;
  perform app_private.require_reward_account(p_user_id,p_session_id);
  return result;
end $$;

-- CREATE OR REPLACE retains the existing service-only entry-point grant.
commit;
