begin;
-- Recipient discovery, not a claim capability. Never borrow an operator session
-- or expose the allocation package, other beneficiaries, salts or signatures.
create index reward_allocation_recipients_v3_athlete_lookup
  on app_private.reward_allocation_recipients_v3(source_beneficiary_id,entitlement_id)
  where beneficiary_kind='athlete';

create function public.service_read_own_reward_allocations_v3(
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
  -- Exact source-ID ownership only. Merges, unclaimed profiles, clubs and other
  -- accounts retain their ledger shares, but cannot inherit this user's access.
  with own as (
    select r.*,a.draft_id,a.slot,a.document,a.approved_at,p.date_of_birth,p.birth_year
    from public.athlete_profiles p
    join app_private.reward_allocation_recipients_v3 r on r.source_beneficiary_id=p.id and r.beneficiary_kind='athlete'
    join app_private.reward_allocation_approvals_v3 a on a.id=r.approval_id
    where p.claimed_by_user_id=p_user_id and p.is_claimed and p.status='active' and p.merged_into_athlete_profile_id is null
      and (a.document#>>'{record,chainId}')::integer=p_chain_id
      and (p_after_id is null or r.entitlement_id>decode(substr(p_after_id,3),'hex'))
      -- Supersession must be checked BEFORE selecting the user's shares: an
      -- athlete removed from a newer allocation must not see the old one.
      and not exists(select 1 from app_private.reward_allocation_approvals_v3 newer
        where newer.draft_id=a.draft_id and newer.slot=a.slot and newer.sequence>a.sequence)
    order by r.entitlement_id limit 51
  ), page as (select * from own order by entitlement_id limit 50)
  select jsonb_build_object('schema','raceson-own-allocations-v3','chainId',p_chain_id,'items',coalesce((select jsonb_agg(
    jsonb_build_object('entitlementId','0x'||encode(entitlement_id,'hex'),'approvalId',approval_id,
      'draftId',draft_id,'slot',slot,'athleteProfileId',source_beneficiary_id,'chainId',p_chain_id,
      'sourceKind',document#>>'{source,kind}','amountWei',amount_wei::text,
      'campaignAddress',document#>>'{binding,campaignAddress}',
      'recordedAt',to_char(approved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'ageStatus',case
        when date_of_birth is not null and (date_of_birth>today or (birth_year is not null and birth_year<>extract(year from date_of_birth))) then 'unknown'
        when date_of_birth is not null and date_of_birth>today-interval '18 years' then 'minor'
        when date_of_birth is null then 'unknown' else 'unverified_adult' end)
    order by entitlement_id) from page),'[]'::jsonb),
    'nextCursor',case when (select count(*) from own)>50 then
      (select '0x'||encode(entitlement_id,'hex') from page order by entitlement_id desc limit 1) else null end) into result;
  -- Session revocation/account suspension between the lock and query fails closed.
  perform app_private.require_reward_account(p_user_id,p_session_id);
  return result;
end $$;
revoke all on function public.service_read_own_reward_allocations_v3(uuid,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.service_read_own_reward_allocations_v3(uuid,uuid,integer,text) to service_role;
commit;
