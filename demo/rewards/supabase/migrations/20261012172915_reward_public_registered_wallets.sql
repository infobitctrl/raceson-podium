begin;
-- Public names may link to an existing verified destination before payment.
-- Extend the service-only projection; never return account/profile/proof IDs.
-- V2 remains intact while the compatible application deployment builds.
create function public.service_reward_demo_copy_public_awards_v3(p_setup_id uuid,p_slot integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; wallets jsonb;
begin
 result:=public.service_reward_demo_copy_public_awards_v2(p_setup_id,p_slot);
 if result is null then return null;end if;
 with recipients as (
  select r.entitlement_id,r.beneficiary_id,r.beneficiary_kind
  from jsonb_array_elements(result->'awards') award
  join app_private.reward_sponsor_recipients_v4 r
   on '0x'||encode(r.entitlement_id,'hex')=award->>'entitlementId'
   and '0x'||encode(r.opaque_beneficiary_id,'hex')=award->>'beneficiaryId'
  join app_private.reward_sponsor_allocation_approvals_v4 a on a.id=r.approval_id
   and a.setup_id=p_setup_id and a.slot=p_slot and a.decision='approved'
 ), destinations as (
  select r.entitlement_id,c.address
  from recipients r
  join public.athlete_profiles a on r.beneficiary_kind='athlete' and a.id=r.beneficiary_id
   and a.is_claimed and a.status='active' and a.merged_into_athlete_profile_id is null
  join app_private.reward_athlete_destination_requests d
   on d.athlete_profile_id=a.id and d.user_id=a.claimed_by_user_id
  join app_private.reward_wallet_proofs proof on proof.id=d.proof_id
  join app_private.reward_wallet_challenges c on c.id=proof.challenge_id
   and c.user_id=d.user_id and c.session_id=d.session_id
   and c.chain_id=10143 and c.origin='https://podium.raceson.com'
  where not exists(select 1 from app_private.reward_athlete_destination_withdrawals w where w.request_id=d.id)
  union all
  select r.entitlement_id,e.body->>'safeAddress'
  from recipients r
  join app_private.reward_demo_copy_club_creations c on r.beneficiary_kind='club' and c.club_id=r.beneficiary_id
  join app_private.reward_demo_copy_club_creation_events e on e.request_id=c.id and e.kind='verified'
  where coalesce((app_private.reward_demo_copy_club_creation_document(c.id,c.user_id)->>'current')::boolean,false)
 ), unique_destinations as (
  select entitlement_id,min(address) address from destinations
  group by entitlement_id having count(distinct address)=1
   and bool_and(address ~ '^0x[0-9a-f]{40}$' and address<>'0x'||repeat('0',40))
 )
 select coalesce(jsonb_agg(jsonb_build_object('id','0x'||encode(entitlement_id,'hex'),'address',address)
  order by entitlement_id),'[]'::jsonb) into wallets from unique_destinations;
 return result||jsonb_build_object('registeredWallets',wallets);
end $$;
revoke all on function public.service_reward_demo_copy_public_awards_v3(uuid,integer) from public,anon,authenticated;
grant execute on function public.service_reward_demo_copy_public_awards_v3(uuid,integer) to service_role;
notify pgrst,'reload schema';
commit;
