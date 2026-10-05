begin;
-- Copied-source upload uses the existing private package format and receipts.
create function app_private.read_reward_demo_copy_upload(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
 p_setup_id uuid,p_slot integer,p_approval_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare v jsonb; a app_private.reward_sponsor_allocation_approvals_v4%rowtype; u app_private.reward_sponsor_uploads_v4%rowtype; recipients jsonb;
begin
 v:=app_private.read_reward_demo_copy_allocation(p_actor_user_id,p_actor_session_id,p_chain_id,p_setup_id,p_slot,null);
 select * into a from app_private.reward_sponsor_allocation_approvals_v4 where id=p_approval_id and setup_id=p_setup_id and slot=p_slot and decision='approved';
 if a.id is null then raise exception 'reward_sponsor_approval_not_found'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('beneficiaryKind',r.beneficiary_kind,'beneficiaryId',r.beneficiary_id,'amountWei',r.amount_wei::text,
  'entitlementId','0x'||encode(r.entitlement_id,'hex'),'opaqueBeneficiaryId','0x'||encode(r.opaque_beneficiary_id,'hex'),
  'explanationSalt','0x'||encode(r.explanation_salt,'hex')) order by r.beneficiary_kind,r.beneficiary_id),'[]'::jsonb) into recipients
  from app_private.reward_sponsor_recipients_v4 r where approval_id=a.id;
 select * into u from app_private.reward_sponsor_uploads_v4 where approval_id=a.id;
 -- Recheck after relation waits, including expiry/revocation and source changes.
 v:=app_private.read_reward_demo_copy_allocation(p_actor_user_id,p_actor_session_id,p_chain_id,p_setup_id,p_slot,null);
 return jsonb_build_object('approvalId',a.id,'contextHash',a.context_hash,'documentHash',a.document_hash,'document',a.document_text::jsonb,
  'current',coalesce(v#>>'{approval,id}'=a.id::text and v#>>'{approval,decision}'='approved' and v->>'contextHash'=a.context_hash,false),
  'execution',v->'execution','snapshotSalt','0x'||encode(a.snapshot_salt,'hex'),'recipients',recipients,
  'prepared',case when u.id is null then null else jsonb_build_object('id',u.id,'packageHash',u.package_hash,'package',u.package_text::jsonb,
   'preparedAt',u.created_at,'actorUserId',u.actor_user_id) end);
end $$;

create function app_private.prepare_reward_demo_copy_upload(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
 p_setup_id uuid,p_slot integer,p_approval_id uuid,p_request_id uuid,p_context_hash text,p_document_hash text,p_package_text text,p_funding jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v jsonb; fresh jsonb; package jsonb; saved app_private.reward_sponsor_uploads_v4%rowtype; h text; row jsonb; recipient jsonb; n integer; total numeric;
begin
 v:=app_private.read_reward_demo_copy_upload(p_actor_user_id,p_actor_session_id,p_chain_id,p_setup_id,p_slot,p_approval_id);
 if p_request_id is null or p_request_id='00000000-0000-0000-0000-000000000000'::uuid or p_package_text is null or octet_length(p_package_text)>4194304
  or p_context_hash is distinct from v->>'contextHash' or p_document_hash is distinct from v->>'documentHash' then raise exception 'invalid_sponsor_upload'; end if;
 h:=encode(sha256(convert_to(p_package_text,'UTF8')),'hex');
 select * into saved from app_private.reward_sponsor_uploads_v4 where approval_id=p_approval_id or id=p_request_id;
 if found then
  if saved.id<>p_request_id or saved.approval_id<>p_approval_id or saved.actor_user_id<>p_actor_user_id or saved.context_hash<>p_context_hash
   or saved.document_hash<>p_document_hash or saved.package_hash<>h or saved.package_text<>p_package_text then raise exception 'reward_sponsor_upload_conflict'; end if;
  return v;
 end if;
 if v->'current' is distinct from 'true'::jsonb then raise exception 'reward_sponsor_source_not_ready'; end if;
 package:=p_package_text::jsonb;
 if jsonb_typeof(package) is distinct from 'object' or (select count(*) from jsonb_object_keys(package))<>25
  or not(package ?& array['schema','protocolVersion','chainId','slot','approvalId','documentHash','programmeAddress','campaignAddress','deploymentHash','fundingHash','programmeId','campaignId','programmeManifestHash','reviewPeriod','claimLifetime','unallocatedTreasury','expiredTreasury','cancellationTreasury','budgetWei','allocatedWei','unallocatedWei','snapshotDigest','uploadDigest','entitlementCount','awards'])
  or package->>'reviewPeriod' is distinct from v#>>array['execution','plan','reviewPeriods',p_slot::text]
  or package->>'claimLifetime' is distinct from v#>>'{execution,plan,claimLifetime}'
  or package->>'unallocatedTreasury' is distinct from v#>>'{execution,plan,unallocatedTreasury}'
  or package->>'expiredTreasury' is distinct from v#>>'{execution,plan,expiredTreasury}'
  or package->>'cancellationTreasury' is distinct from v#>>'{execution,plan,funder}'
  or package->>'schema' is distinct from 'raceson-sponsor-upload-v4'
  or package->'protocolVersion' is distinct from '4'::jsonb or package->'chainId' is distinct from to_jsonb(p_chain_id)
  or package->>'approvalId' is distinct from p_approval_id::text or package->>'documentHash' is distinct from p_document_hash
  or package->'slot' is distinct from to_jsonb(p_slot) or package->>'budgetWei' is distinct from v#>>'{document,calculation,budgetWei}'
  or package->>'allocatedWei' is distinct from v#>>'{document,calculation,proposedWei}' or package->>'unallocatedWei' is distinct from v#>>'{document,calculation,retainedWei}'
  or v#>>'{execution,deploymentHash}' is null or v#>>'{execution,fundingHash}' is null
  or package->>'deploymentHash' is distinct from v#>>'{execution,deploymentHash}' or package->>'fundingHash' is distinct from v#>>'{execution,fundingHash}'
  or jsonb_typeof(package->'awards') is distinct from 'array' then raise exception 'invalid_sponsor_upload'; end if;
 if jsonb_typeof(p_funding) is distinct from 'object' or octet_length(p_funding::text)>32768 or p_funding->'funded' is distinct from 'true'::jsonb or p_funding->'cancelled' is distinct from 'false'::jsonb
  or p_funding->>'address' is distinct from package->>'programmeAddress' or p_funding->>'deploymentHash' is distinct from package->>'deploymentHash'
  or p_funding->>'fundingHash' is distinct from package->>'fundingHash' or coalesce(p_funding->>'blockHash','') !~ '^0x[0-9a-f]{64}$'
  or coalesce(p_funding->>'blockNumber','') !~ '^[0-9]+$' or coalesce(p_funding->>'blockTimestamp','') !~ '^[0-9]+$' then raise exception 'invalid_sponsor_upload'; end if;
 select value into row from jsonb_array_elements(p_funding->'pots') p where p->'slot'=to_jsonb(p_slot);
 if row is null or row->>'address' is distinct from package->>'campaignAddress' or row->>'amountWei' is distinct from package->>'budgetWei'
  or row->'state' is distinct from '1'::jsonb or row->'paused' is distinct from 'false'::jsonb
  or row->>'allocatedWei' is distinct from '0' or row->>'paidWei' is distinct from '0' or row->>'returnedWei' is distinct from '0'
  or row->>'entitlementCount' is distinct from '0' or row->>'remainingWei' is distinct from package->>'budgetWei' then raise exception 'reward_sponsor_funding_not_ready'; end if;
 n:=0;total:=0;
 for row in select value from jsonb_array_elements(package->'awards') loop
  select value into recipient from jsonb_array_elements(v->'recipients') r where r->>'entitlementId'=row->>'entitlementId';
  if recipient is null or row->>'beneficiaryId' is distinct from recipient->>'opaqueBeneficiaryId'
   or row->>'amount' is distinct from recipient->>'amountWei' or row->'pot' is distinct from to_jsonb(case when p_slot=0 then 1 else 0 end)
   or row->'beneficiaryKind' is distinct from to_jsonb(case when recipient->>'beneficiaryKind'='athlete' then 0 else 1 end)
   or coalesce(row->>'explanationHash','') !~ '^0x[0-9a-f]{64}$' then raise exception 'invalid_sponsor_upload'; end if;
  n:=n+1;total:=total+(row->>'amount')::numeric;
 end loop;
 if n<>jsonb_array_length(v->'recipients') or n<>(select count(distinct value->>'entitlementId') from jsonb_array_elements(package->'awards'))
  or package->>'entitlementCount' is distinct from n::text or total<>(package->>'allocatedWei')::numeric then raise exception 'invalid_sponsor_upload'; end if;
 insert into app_private.reward_sponsor_uploads_v4(id,approval_id,context_hash,document_hash,package_text,package_hash,funding_observation,actor_user_id)
 values(p_request_id,p_approval_id,p_context_hash,p_document_hash,p_package_text,h,p_funding,p_actor_user_id);
 fresh:=app_private.read_reward_demo_copy_upload(p_actor_user_id,p_actor_session_id,p_chain_id,p_setup_id,p_slot,p_approval_id);
 if fresh->'current' is distinct from 'true'::jsonb or fresh->'execution' is distinct from v->'execution' then raise exception 'reward_planning_revision_changed'; end if;
 return fresh;
end $$;

create function public.service_reward_demo_copy_upload(p_operation text,p_actor_user_id uuid,p_actor_session_id uuid,
 p_setup_id uuid,p_slot integer,p_approval_id uuid,p_request_id uuid default null,p_context_hash text default null,
 p_document_hash text default null,p_package_text text default null,p_funding jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
 if p_operation='read' and p_request_id is null and p_context_hash is null and p_document_hash is null and p_package_text is null and p_funding is null then
  return app_private.read_reward_demo_copy_upload(p_actor_user_id,p_actor_session_id,10143,p_setup_id,p_slot,p_approval_id);
 elsif p_operation='prepare' then
  return app_private.prepare_reward_demo_copy_upload(p_actor_user_id,p_actor_session_id,10143,p_setup_id,p_slot,p_approval_id,
   p_request_id,p_context_hash,p_document_hash,p_package_text,p_funding);
 end if;
 raise exception 'invalid_sponsor_upload';
end $$;
revoke all on function app_private.read_reward_demo_copy_upload(uuid,uuid,integer,uuid,integer,uuid),
 app_private.prepare_reward_demo_copy_upload(uuid,uuid,integer,uuid,integer,uuid,uuid,text,text,text,jsonb),
 public.service_reward_demo_copy_upload(text,uuid,uuid,uuid,integer,uuid,uuid,text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_demo_copy_upload(text,uuid,uuid,uuid,integer,uuid,uuid,text,text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
