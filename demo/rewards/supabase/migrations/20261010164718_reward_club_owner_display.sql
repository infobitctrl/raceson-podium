begin;
-- Keep the deployed facts function compatible with older strict decoders.
-- Its account/session, selected-owner, treasury and award checks run before
-- projecting names from the immutable treasury selection. No identity IDs leave
-- this projection, and no name grants signing authority.
create function public.service_reward_demo_copy_club_direct_claim_display(
 p_user_id uuid,p_session_id uuid,p_approval_id uuid,p_entitlement_id text,
 p_creation_id uuid,p_proof_id uuid default null,p_receipt jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare facts jsonb; display jsonb;
begin
 facts:=public.service_reward_demo_copy_club_direct_claim_v5(
  p_user_id,p_session_id,p_approval_id,p_entitlement_id,p_creation_id,p_proof_id,p_receipt);
 select coalesce(jsonb_agg(jsonb_build_object('address',m->>'address','name',m->>'name') order by m->>'address'),'[]'::jsonb)
 into display from app_private.reward_club_creation_members s
 cross join lateral jsonb_array_elements(s.members) m
 where s.request_id=p_creation_id and (facts->'treasury'->'owners') ? (m->>'address')
 and nullif(btrim(m->>'name'),'') is not null;
 return jsonb_set(facts,'{treasury,ownerDisplay}',display);
end $$;
revoke all on function public.service_reward_demo_copy_club_direct_claim_display(uuid,uuid,uuid,text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_demo_copy_club_direct_claim_display(uuid,uuid,uuid,text,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
