begin;
-- Read-only presentation of the exact approved copied allocation; economics unchanged.
create or replace function public.service_reward_demo_copy_public_awards(p_setup_id uuid,p_slot integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; document jsonb; approval uuid;
begin
 if p_setup_id is null or p_slot is null or p_slot not between 0 and 5 then raise exception 'invalid_public_awards';end if;
 if not app_private.reward_demo_copy_public_scope(p_setup_id) then return null;end if;
 -- A copied approved package is required. A later hold never becomes an empty
 -- or unpaid assertion: the chain observer separately rejects inconsistent totals.
 if not exists(select 1 from app_private.reward_sponsor_allocation_approvals_v4 a
  join app_private.reward_sponsor_uploads_v4 u on u.approval_id=a.id
  where a.setup_id=p_setup_id and a.slot=p_slot and a.decision='approved'
   and a.document_text::jsonb->>'schema'='podium-copy-allocation-document-v1'
   and a.sequence=(select max(n.sequence) from app_private.reward_sponsor_allocation_approvals_v4 n where n.setup_id=a.setup_id and n.slot=a.slot)) then return null;end if;
 result:=public.service_reward_public_awards_v4(10143,p_setup_id,p_slot);
 if result is null then return null; end if;
 select a.id,a.document_text::jsonb into approval,document
 from app_private.reward_sponsor_allocation_approvals_v4 a
 join app_private.reward_sponsor_uploads_v4 u on u.approval_id=a.id
 where a.setup_id=p_setup_id and a.slot=p_slot and a.decision='approved'
 order by a.sequence desc limit 1;
 -- Older minimal projections retain the existing ledger without invented links.
 if exists(select 1 from jsonb_array_elements(document#>'{calculation,groups}') g
   where g->>'name' is null or jsonb_typeof(g->'awards') is distinct from 'array') then return result;end if;
 -- Category labels, prize positions and contribution amounts only. Never return
 -- sporting recipient names/IDs, wallets, private documents, salts or consent.
 return jsonb_set(result,'{awards}',(select coalesce(jsonb_agg(row || jsonb_build_object('breakdown',(
   select coalesce(jsonb_agg(jsonb_build_object('category',g->>'name','amountWei',w->>'amountWei','place',w->'place')
     order by g->>'name'),'[]'::jsonb)
   from app_private.reward_sponsor_recipients_v4 recipient
   cross join lateral jsonb_array_elements(document#>'{calculation,groups}') g
   cross join lateral jsonb_array_elements(g->'awards') w
   where recipient.approval_id=approval and '0x'||encode(recipient.entitlement_id,'hex')=row->>'entitlementId'
    and g->>'beneficiaryKind'=recipient.beneficiary_kind and w->>'beneficiaryId'=recipient.beneficiary_id::text
  )) order by row->>'entitlementId'),'[]'::jsonb) from jsonb_array_elements(result->'awards') row));
end $$;
revoke all on function public.service_reward_demo_copy_public_awards(uuid,integer) from public,anon,authenticated;
grant execute on function public.service_reward_demo_copy_public_awards(uuid,integer) to service_role;
notify pgrst,'reload schema';
commit;
