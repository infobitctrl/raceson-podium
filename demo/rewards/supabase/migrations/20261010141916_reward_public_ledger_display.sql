begin;
-- Owner-requested public display of the pseudonymized sporting copy only.
-- Keep v1 unchanged so the currently deployed decoder stays compatible.
create function public.service_reward_demo_copy_public_awards_v2(p_setup_id uuid,p_slot integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; document jsonb; approval uuid;
begin
 result:=public.service_reward_demo_copy_public_awards(p_setup_id,p_slot);
 if result is null then return null;end if;
 select a.id,a.document_text::jsonb into approval,document
 from app_private.reward_sponsor_allocation_approvals_v4 a
 join app_private.reward_sponsor_uploads_v4 u on u.approval_id=a.id
 where a.setup_id=p_setup_id and a.slot=p_slot and a.decision='approved'
 order by a.sequence desc limit 1;
 -- Frozen approved source, not current membership, profiles or account records.
 return jsonb_set(result,'{awards}',(select coalesce(jsonb_agg(
  row || case when identity.name is null then '{}'::jsonb else jsonb_build_object('display',
   jsonb_build_object('name',identity.name,'club',case when recipient.beneficiary_kind='athlete' then facts.club else null end,
    'timeMs',case when recipient.beneficiary_kind='athlete' and p_slot<>0 and facts.result_count=1 then facts.time_ms else null end)) end
  order by row->>'entitlementId'),'[]'::jsonb)
 from jsonb_array_elements(result->'awards') row
 join app_private.reward_sponsor_recipients_v4 recipient on recipient.approval_id=approval
  and '0x'||encode(recipient.entitlement_id,'hex')=row->>'entitlementId'
 left join lateral (
  select item->>'name' name from jsonb_array_elements(case when recipient.beneficiary_kind='athlete'
   then document#>'{source,athletes}' else document#>'{source,clubs}' end) item
  where item->>'id'=recipient.beneficiary_id::text
 ) identity on true
 left join lateral (
  select count(*) result_count,min(r->>'finishTimeMs') time_ms,
   case when count(distinct coalesce(r->>'clubId',''))=1 then min(c->>'name') else null end club
  from jsonb_array_elements(document#>'{source,results}') r
  join jsonb_array_elements(document#>'{source,races}') race on race->>'id'=r->>'raceId'
   and race->>'runId'=r->>'runId' and race->>'publicationId'=r->>'publicationId'
  left join jsonb_array_elements(document#>'{source,clubs}') c on c->>'id'=r->>'clubId'
  where recipient.beneficiary_kind='athlete' and r->>'athleteId'=recipient.beneficiary_id::text
   and (p_slot=0 or (race->>'slot')::integer=p_slot)
 ) facts on true));
end $$;
revoke all on function public.service_reward_demo_copy_public_awards_v2(uuid,integer) from public,anon,authenticated;
grant execute on function public.service_reward_demo_copy_public_awards_v2(uuid,integer) to service_role;
notify pgrst,'reload schema';
commit;
