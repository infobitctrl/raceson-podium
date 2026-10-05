begin;

-- Demo-only, non-executable evidence from the immutable approved document.
-- No current result joins, participant names, DOB, wallet addresses or proofs.
create function app_private.reward_athlete_award_breakdown_v3(
  p_document jsonb,p_profile_id uuid,p_amount_wei numeric)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare components jsonb; total numeric; result jsonb;
begin
  with parts as (
    select 1 as ordering,c->>'categoryId' as key,
      jsonb_build_object('kind','placing','categoryId',c->>'categoryId',
        'sourceRowId',a->>'sourceRowId','rank',a->'rank',
        'poolWei',c->>'budgetWei','amountWei',a->>'amountWei') as item
    from jsonb_array_elements(p_document#>'{calculation,families}') f,
      lateral jsonb_array_elements(f->'categories') c,
      lateral jsonb_array_elements(c->'awards') a
    where f->>'key'='athlete_standings' and c->>'target'='individual'
      and a->>'beneficiaryId'=p_profile_id::text and (a->>'amountWei')::numeric>0
    union all
    select 2,'participation',jsonb_build_object('kind','participation',
      'metres',a->>'metres','totalMetres',p_document#>>'{calculation,participation,totalMetres}',
      'finishes',a->'finishes','resultIds',a->'resultIds',
      'poolWei',p_document#>>'{calculation,participation,budgetWei}','amountWei',a->>'amountWei')
    from jsonb_array_elements(coalesce(p_document#>'{calculation,participation,awards}','[]'::jsonb)) a
    where (p_document->>'slot')::integer=6 and a->>'beneficiaryId'=p_profile_id::text and (a->>'amountWei')::numeric>0
  )
  select jsonb_agg(item order by ordering,key),sum((item->>'amountWei')::numeric)
    into components,total from parts;
  if components is null or jsonb_array_length(components)>65 or total<>p_amount_wei then
    raise exception 'invalid_reward_athlete_award_breakdown';
  end if;
  result:=jsonb_build_object('schema','raceson-athlete-award-breakdown-v1',
    'sourceKind',p_document#>>'{source,kind}','components',components);
  return result;
end $$;
revoke all on function app_private.reward_athlete_award_breakdown_v3(jsonb,uuid,numeric) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_athlete_award_breakdown_v3(jsonb,uuid,numeric) to service_role;

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

-- Existing service-only grants are retained by CREATE OR REPLACE.

commit;
