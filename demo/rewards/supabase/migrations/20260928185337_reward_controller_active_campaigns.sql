-- List archive visibility must match My campaigns. Keep scoped receipt/history
-- access for archived campaigns; soft-deleted setups remain inaccessible.
begin;
create or replace function public.service_reward_controller_v4(p_operator text,p_subject text,p_chain_id integer,
 p_setup_id uuid default null,p_approval_id uuid default null,p_request_id uuid default null,p_receipt jsonb default null)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare e app_private.reward_sponsor_executions%rowtype; a app_private.reward_sponsor_allocation_approvals_v4%rowtype;
 u app_private.reward_sponsor_uploads_v4%rowtype; pub app_private.reward_sponsor_lifecycle_v4%rowtype;
 old app_private.reward_controller_receipts_v4%rowtype; stamp text; recipients jsonb; receipts jsonb; rows jsonb;
begin
 if p_operator is null or p_operator !~ '^0x[0-9a-f]{40}$' or p_subject is null or p_subject !~ '^did:privy:[a-zA-Z0-9_-]{1,100}$'
  or p_chain_id is distinct from 10143 then raise exception 'controller_scope_required'; end if;
 if p_setup_id is null then
  if p_approval_id is not null or p_request_id is not null or p_receipt is not null then raise exception 'controller_scope_required'; end if;
  select coalesce(jsonb_agg(row order by created_at desc),'[]'::jsonb) into rows from (
   select ex.created_at,jsonb_build_object('setupId',ex.setup_id,'name',coalesce(r.configuration->>'name','Sponsor campaign'),
    'execution',jsonb_build_object('plan',ex.plan,'deploymentHash',ex.deployment_hash,'fundingHash',ex.funding_hash),
    'pots',(select coalesce(jsonb_agg(jsonb_build_object('approvalId',x.id,'slot',x.slot,
      'ready',exists(select 1 from app_private.reward_sponsor_lifecycle_v4 p where p.approval_id=x.id and p.kind='publication'
        and p.source_stamp=app_private.reward_sponsor_source_stamp_v4(x.id))) order by x.slot),'[]'::jsonb)
      from app_private.reward_sponsor_allocation_approvals_v4 x where x.setup_id=ex.setup_id and x.decision='approved'
      and x.sequence=(select max(y.sequence) from app_private.reward_sponsor_allocation_approvals_v4 y where y.setup_id=x.setup_id and y.slot=x.slot))) row
   from app_private.reward_sponsor_executions ex join app_private.reward_distribution_setups d on d.id=ex.setup_id
   join app_private.reward_sponsor_launches l on l.id=ex.launch_id
   join app_private.reward_setup_revisions r on r.setup_id=d.id and r.revision=l.setup_revision
   where ex.plan->>'operator'=p_operator and d.chain_id=p_chain_id and d.archived_at is null and d.list_archived_at is null
   order by ex.created_at desc limit 100
  ) q;
  return rows;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('reward-setup:'||p_setup_id::text,0));
 select x.* into e from app_private.reward_sponsor_executions x join app_private.reward_distribution_setups d on d.id=x.setup_id
 where x.setup_id=p_setup_id and x.plan->>'operator'=p_operator and d.chain_id=p_chain_id and d.archived_at is null for update of x;
 if e.setup_id is null then raise exception 'controller_scope_required'; end if;
 if p_approval_id is not null then
  select * into a from app_private.reward_sponsor_allocation_approvals_v4 where id=p_approval_id and setup_id=p_setup_id and decision='approved';
  select * into u from app_private.reward_sponsor_uploads_v4 where approval_id=a.id;
  select * into pub from app_private.reward_sponsor_lifecycle_v4 where approval_id=a.id and kind='publication';
  stamp:=app_private.reward_sponsor_source_stamp_v4(a.id);
  if a.id is null or u.id is null or pub.id is null or stamp is null or pub.source_stamp is distinct from stamp
   or exists(select 1 from app_private.reward_sponsor_allocation_approvals_v4 n where n.setup_id=a.setup_id and n.slot=a.slot and n.sequence>a.sequence)
   then raise exception 'controller_source_not_ready'; end if;
 end if;
 if p_receipt is not null then
  if p_request_id is null or p_request_id='00000000-0000-0000-0000-000000000000' or octet_length(p_receipt::text)>131072
   or coalesce(p_receipt->>'transactionHash','') !~ '^0x[0-9a-f]{64}$' then raise exception 'controller_receipt_invalid'; end if;
  if p_approval_id is null then
   if p_receipt->>'action' is distinct from 'deployment' or e.deployment_hash is not null and e.deployment_hash<>p_receipt->>'transactionHash'
    then raise exception 'controller_receipt_conflict'; end if;
  elsif coalesce(p_receipt->>'action','') not in('upload','stage','activate')
   or p_receipt->>'campaignAddress' is distinct from u.package_text::jsonb->>'campaignAddress'
   then raise exception 'controller_receipt_invalid'; end if;
  select * into old from app_private.reward_controller_receipts_v4 where id=p_request_id or transaction_hash=p_receipt->>'transactionHash';
  if found then
   if old.setup_id<>p_setup_id or old.approval_id is distinct from p_approval_id or old.privy_subject<>p_subject
    or old.operator<>p_operator or old.body<>p_receipt then raise exception 'controller_receipt_conflict'; end if;
  else
   insert into app_private.reward_controller_receipts_v4(id,setup_id,approval_id,privy_subject,operator,body,transaction_hash)
   values(p_request_id,p_setup_id,p_approval_id,p_subject,p_operator,p_receipt,p_receipt->>'transactionHash');
   if p_approval_id is null then
    update app_private.reward_sponsor_executions set deployment_hash=p_receipt->>'transactionHash' where setup_id=p_setup_id;
    e.deployment_hash:=p_receipt->>'transactionHash';
   end if;
  end if;
 end if;
 if p_approval_id is null then
  return jsonb_build_object('plan',e.plan,'deploymentHash',e.deployment_hash,'fundingHash',e.funding_hash);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('beneficiaryKind',r.beneficiary_kind,'beneficiaryId',r.beneficiary_id,'amountWei',r.amount_wei::text,
  'entitlementId','0x'||encode(r.entitlement_id,'hex'),'opaqueBeneficiaryId','0x'||encode(r.opaque_beneficiary_id,'hex'),
  'explanationSalt','0x'||encode(r.explanation_salt,'hex')) order by r.beneficiary_kind,r.beneficiary_id),'[]'::jsonb) into recipients
 from app_private.reward_sponsor_recipients_v4 r where approval_id=a.id;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'body',body) order by created_at),'[]'::jsonb) into receipts
 from app_private.reward_controller_receipts_v4 where approval_id=a.id;
 if app_private.reward_sponsor_source_stamp_v4(a.id) is distinct from stamp then raise exception 'controller_source_not_ready'; end if;
 return jsonb_build_object('upload',jsonb_build_object('approvalId',a.id,'contextHash',a.context_hash,'documentHash',a.document_hash,
  'document',a.document_text::jsonb,'current',true,'execution',jsonb_build_object('plan',e.plan,'deploymentHash',e.deployment_hash,'fundingHash',e.funding_hash),
  'snapshotSalt','0x'||encode(a.snapshot_salt,'hex'),'recipients',recipients,
  'prepared',jsonb_build_object('id',u.id,'packageHash',u.package_hash,'package',u.package_text::jsonb,'preparedAt',u.created_at,'actorUserId',u.actor_user_id)),
  'publication',jsonb_build_object('id',pub.id,'body',pub.body_text::jsonb,'bodyHash',pub.body_hash,'current',true,'createdAt',pub.created_at),'receipts',receipts);
end $$;
revoke all on function public.service_reward_controller_v4(text,text,integer,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_controller_v4(text,text,integer,uuid,uuid,uuid,jsonb) to service_role;
commit;
