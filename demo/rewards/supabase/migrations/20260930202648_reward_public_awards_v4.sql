begin;
-- Service-only projection of already public contract inputs. Never returns the
-- private allocation document, identity mapping, salts or consent records.
create function public.service_reward_public_awards_v4(p_chain_id integer,p_setup_id uuid,p_slot integer)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare package jsonb;
begin
 if p_chain_id is null or p_chain_id not in (10143,31337) or p_setup_id is null or p_slot is null or p_slot not between 0 and 5 then
  raise exception 'invalid_public_awards';
 end if;
 select u.package_text::jsonb into package
 from app_private.reward_public_campaigns p
 join app_private.reward_sponsor_executions e on e.setup_id=p.setup_id and e.launch_id=p.launch_id
 join app_private.reward_sponsor_allocation_approvals_v4 a on a.setup_id=p.setup_id and a.slot=p_slot
 join app_private.reward_sponsor_uploads_v4 u on u.approval_id=a.id
 where p.setup_id=p_setup_id and (e.plan->>'chainId')::integer=p_chain_id and e.funding_hash is not null
 and a.decision='approved' and a.sequence=(select max(n.sequence) from app_private.reward_sponsor_allocation_approvals_v4 n where n.setup_id=a.setup_id and n.slot=a.slot);
 if package is null then return null; end if;
 return jsonb_build_object('chainId',package->'chainId','slot',package->'slot',
  'programmeAddress',package->'programmeAddress','campaignAddress',package->'campaignAddress',
  'fundingHash',package->'fundingHash','uploadDigest',package->'uploadDigest',
  'awards',(select coalesce(jsonb_agg(jsonb_build_object('entitlementId',r->'entitlementId',
    'beneficiaryId',r->'beneficiaryId','explanationHash',r->'explanationHash',
    'amount',r->'amount','pot',r->'pot','beneficiaryKind',r->'beneficiaryKind') order by r->>'entitlementId'),'[]'::jsonb)
    from jsonb_array_elements(package->'awards') r));
end $$;
revoke all on function public.service_reward_public_awards_v4(integer,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_public_awards_v4(integer,uuid,integer) to service_role;
commit;
