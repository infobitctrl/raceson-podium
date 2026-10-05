begin;
-- Native Privy identity is verified by the API; the database also requires a
-- master-reviewed, dedicated controller, retaining immutable older operators.
create function app_private.require_reward_demo_copy_controller(p_operator text,p_subject text)
returns void language plpgsql volatile security definer set search_path='' as $$
declare revision integer; settings jsonb;
begin
 if p_operator is null or p_operator !~ '^0x[0-9a-f]{40}$' or p_operator in('0x'||repeat('0',40),'0x361ffea5d7c76b2db3d5573a241c94ed05e787ba')
  or p_subject is null or p_subject !~ '^did:privy:[a-zA-Z0-9_-]{1,100}$' then raise exception 'controller_scope_required';end if;
 select s.revision,s.settings into revision,settings from app_private.reward_wallet_settings s where singleton for share;
 if coalesce(revision,0)=0 or not exists(select 1 from (
  select settings->'controller' controller union all
  select h.settings->'controller' from app_private.reward_wallet_changes h union all
  select h.previous_settings->'controller' from app_private.reward_wallet_changes h
 ) c where c.controller->>'wallet'=p_operator and c.controller->>'subject'=p_subject)
 then raise exception 'controller_scope_required';end if;
end $$;
create function app_private.reward_demo_copy_controller(p_operator text,p_subject text,p_chain_id integer,
 p_setup_id uuid default null,p_approval_id uuid default null,p_request_id uuid default null,p_receipt jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare e app_private.reward_sponsor_executions%rowtype; a app_private.reward_sponsor_allocation_approvals_v4%rowtype;
 u app_private.reward_sponsor_uploads_v4%rowtype; pub app_private.reward_sponsor_lifecycle_v4%rowtype;
 old app_private.reward_controller_receipts_v4%rowtype; stamp text; recipients jsonb; receipts jsonb; rows jsonb;
begin
 perform app_private.require_reward_demo_copy_controller(p_operator,p_subject);
 if p_operator is null or p_operator !~ '^0x[0-9a-f]{40}$' or p_subject is null or p_subject !~ '^did:privy:[a-zA-Z0-9_-]{1,100}$'
  or p_chain_id is distinct from 10143 then raise exception 'controller_scope_required'; end if;
 if p_setup_id is null then
  if p_approval_id is not null or p_request_id is not null or p_receipt is not null then raise exception 'controller_scope_required'; end if;
  select coalesce(jsonb_agg(row order by created_at desc),'[]'::jsonb) into rows from (
   select ex.created_at,jsonb_build_object('setupId',ex.setup_id,'name',coalesce(r.configuration->>'name','Sponsor campaign'),
    'execution',jsonb_build_object('plan',ex.plan,'deploymentHash',ex.deployment_hash,'fundingHash',ex.funding_hash),
    'pots',(select coalesce(jsonb_agg(jsonb_build_object('approvalId',x.id,'slot',x.slot,
      'ready',exists(select 1 from app_private.reward_sponsor_lifecycle_v4 p where p.approval_id=x.id and p.kind='publication'
        and p.source_stamp=app_private.reward_demo_copy_source_stamp(x.id))) order by x.slot),'[]'::jsonb)
      from app_private.reward_sponsor_allocation_approvals_v4 x where x.setup_id=ex.setup_id and x.decision='approved' and x.document_text::jsonb->>'schema'='podium-copy-allocation-document-v1'
      and x.sequence=(select max(y.sequence) from app_private.reward_sponsor_allocation_approvals_v4 y where y.setup_id=x.setup_id and y.slot=x.slot))) row
   from app_private.reward_sponsor_executions ex join app_private.reward_demo_copy_launch_sources b on b.launch_id=ex.launch_id
    and b.batch_sha256='073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644'
   join app_private.reward_distribution_setups d on d.id=ex.setup_id
   join app_private.reward_sponsor_launches l on l.id=ex.launch_id
   join app_private.reward_setup_revisions r on r.setup_id=d.id and r.revision=l.setup_revision
   where ex.plan->>'operator'=p_operator and d.chain_id=p_chain_id and d.archived_at is null and d.list_archived_at is null
   order by ex.created_at desc limit 100
  ) q;
  perform app_private.require_reward_demo_copy_controller(p_operator,p_subject);
  return rows;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('reward-setup:'||p_setup_id::text,0));
 select x.* into e from app_private.reward_sponsor_executions x join app_private.reward_demo_copy_launch_sources b on b.launch_id=x.launch_id
  and b.batch_sha256='073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644'
 join app_private.reward_distribution_setups d on d.id=x.setup_id
 where x.setup_id=p_setup_id and x.plan->>'operator'=p_operator and d.chain_id=p_chain_id and d.archived_at is null for update of x;
 if e.setup_id is null then raise exception 'controller_scope_required'; end if;
 if p_approval_id is not null then
  select * into a from app_private.reward_sponsor_allocation_approvals_v4 where id=p_approval_id and setup_id=p_setup_id and decision='approved';
  select * into u from app_private.reward_sponsor_uploads_v4 where approval_id=a.id;
  select * into pub from app_private.reward_sponsor_lifecycle_v4 where approval_id=a.id and kind='publication';
  stamp:=app_private.reward_demo_copy_source_stamp(a.id);
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
 perform app_private.require_reward_demo_copy_controller(p_operator,p_subject);
 if p_approval_id is null then
  return jsonb_build_object('plan',e.plan,'deploymentHash',e.deployment_hash,'fundingHash',e.funding_hash);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('beneficiaryKind',r.beneficiary_kind,'beneficiaryId',r.beneficiary_id,'amountWei',r.amount_wei::text,
  'entitlementId','0x'||encode(r.entitlement_id,'hex'),'opaqueBeneficiaryId','0x'||encode(r.opaque_beneficiary_id,'hex'),
  'explanationSalt','0x'||encode(r.explanation_salt,'hex')) order by r.beneficiary_kind,r.beneficiary_id),'[]'::jsonb) into recipients
 from app_private.reward_sponsor_recipients_v4 r where approval_id=a.id;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'body',body) order by created_at),'[]'::jsonb) into receipts
 from app_private.reward_controller_receipts_v4 where approval_id=a.id;
 perform app_private.require_reward_demo_copy_controller(p_operator,p_subject);
 if app_private.reward_demo_copy_source_stamp(a.id) is distinct from stamp then raise exception 'controller_source_not_ready'; end if;
 return jsonb_build_object('upload',jsonb_build_object('approvalId',a.id,'contextHash',a.context_hash,'documentHash',a.document_hash,
  'document',a.document_text::jsonb,'current',true,'execution',jsonb_build_object('plan',e.plan,'deploymentHash',e.deployment_hash,'fundingHash',e.funding_hash),
  'snapshotSalt','0x'||encode(a.snapshot_salt,'hex'),'recipients',recipients,
  'prepared',jsonb_build_object('id',u.id,'packageHash',u.package_hash,'package',u.package_text::jsonb,'preparedAt',u.created_at,'actorUserId',u.actor_user_id)),
  'publication',jsonb_build_object('id',pub.id,'body',pub.body_text::jsonb,'bodyHash',pub.body_hash,'current',true,'createdAt',pub.created_at),'receipts',receipts);
end $$;

create function public.service_reward_demo_copy_controller(p_operator text,p_subject text,
 p_setup_id uuid default null,p_approval_id uuid default null,p_request_id uuid default null,p_receipt jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
 if p_receipt is null and p_request_id is not null then raise exception 'controller_receipt_invalid';end if;
 return app_private.reward_demo_copy_controller(p_operator,p_subject,10143,p_setup_id,p_approval_id,p_request_id,p_receipt);
end $$;
create function app_private.reward_demo_copy_controller_transaction(p_subject text,p_sender text,p_action text,
 p_id uuid default null,p_context jsonb default null,p_transaction jsonb default null,p_signed text default null,p_hash text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare j app_private.reward_controller_transactions%rowtype; n bigint; ctx jsonb; facts jsonb; source jsonb;
begin
 perform app_private.require_reward_demo_copy_controller(p_sender,p_subject);
 if p_subject is null or p_subject not like 'did:privy:%' or p_sender is null or p_sender !~ '^0x[0-9a-f]{40}$'
  or p_action is null or p_action not in('read','reserve','signed','confirm') then raise exception 'controller_transaction_invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reward-auto-creation',0));
 if p_id is null then
  select * into j from app_private.reward_controller_transactions where sender=p_sender and subject=p_subject and not confirmed order by nonce limit 1;
 else select * into j from app_private.reward_controller_transactions where id=p_id and sender=p_sender and subject=p_subject for update; end if;
 if p_action='read' then
  if p_context is not null or p_transaction is not null or p_signed is not null or p_hash is not null then raise exception 'controller_transaction_invalid';end if;
  if j.id is not null then
   if j.context->>'kind' is distinct from 'distribution' then return 'null'::jsonb;end if;
   -- A stale decision must not hide a pending nonce. Read diagnostics only;
   -- signed/confirm/reserve still require the current exact approved handoff.
   perform app_private.reward_demo_copy_controller(p_sender,p_subject,10143,(j.context->>'setupId')::uuid);
  end if;
 else
  if p_action='reserve' then
   if p_signed is not null or p_hash is not null or p_context is null or jsonb_typeof(p_context) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_context))<>7
    or not(p_context ?& array['kind','setupId','approvalId','action','start','end','source'])
    or p_context->>'kind' is distinct from 'distribution' or coalesce(p_context->>'action','') not in('upload','stage','activate')
    or coalesce(p_context->>'start','') !~ '^(0|[1-9][0-9]{0,4})$' or coalesce(p_context->>'end','') !~ '^(0|[1-9][0-9]{0,4})$'
    or (p_context->>'start')::integer>(p_context->>'end')::integer
    or jsonb_typeof(p_context->'source') is distinct from 'string' or octet_length(p_context::text)>8388608
    then raise exception 'controller_transaction_invalid';end if;
   if j.id is not null and (j.context is distinct from p_context or j.transaction-'nonce' is distinct from p_transaction-'nonce') then raise exception 'controller_transaction_invalid';end if;
   ctx:=p_context;
  else
   if p_context is not null or p_transaction is not null then raise exception 'controller_transaction_invalid';end if;
   ctx:=j.context;
  end if;
  if ctx->>'kind' is distinct from 'distribution' then raise exception 'controller_transaction_invalid';end if;
  facts:=app_private.reward_demo_copy_controller(p_sender,p_subject,10143,(ctx->>'setupId')::uuid,(ctx->>'approvalId')::uuid);
  source:=(ctx->>'source')::jsonb;
  if source#>>'{upload,documentHash}' is distinct from facts#>>'{upload,documentHash}'
   or source#>>'{upload,prepared,packageHash}' is distinct from facts#>>'{upload,prepared,packageHash}'
   or source#>>'{publication,bodyHash}' is distinct from facts#>>'{publication,bodyHash}'
   then raise exception 'controller_source_not_ready';end if;
 end if;
 if p_action='reserve' and j.id is null then
  if p_id is null or p_context is null or p_transaction is null or jsonb_typeof(p_transaction)<>'object'
   or p_transaction->'chainId' is distinct from '10143'::jsonb or p_transaction->'value' is distinct from '"0"'::jsonb
   or not(p_transaction ?& array['chainId','data','value','nonce','gas','gasPrice'])
   or (select count(*) from jsonb_object_keys(p_transaction))<>(case when p_transaction?'to' then 7 else 6 end)
   or exists(select 1 from jsonb_each(p_transaction) kv where kv.key<>'chainId' and jsonb_typeof(kv.value)<>'string')
   or p_transaction?'to' and p_transaction->>'to' !~ '^0x[0-9a-f]{40}$'
   or p_transaction->>'data' !~ '^0x[0-9a-f]+$' or octet_length(p_transaction::text)>200000
   or p_transaction->>'nonce' !~ '^[0-9]{1,12}$' or p_transaction->>'gas' !~ '^[0-9]{1,8}$' or p_transaction->>'gasPrice' !~ '^[0-9]{1,15}$'
   or (p_transaction->>'gas')::numeric not between 1 and 30000000 or (p_transaction->>'gasPrice')::numeric<=0
   or (p_transaction->>'gas')::numeric*(p_transaction->>'gasPrice')::numeric>3000000000000000000
   then raise exception 'controller_transaction_invalid'; end if;
  if exists(select 1 from app_private.reward_controller_transactions where sender=p_sender and not confirmed)
   or exists(select 1 from app_private.reward_sponsor_auto_deployments where sender=p_sender and not confirmed)
   then raise exception 'controller_transaction_pending'; end if;
  select greatest((p_transaction->>'nonce')::bigint,coalesce(max(q.nonce)+1,0)) into n from (
   select nonce from app_private.reward_controller_transactions where sender=p_sender union all
   select nonce from app_private.reward_sponsor_auto_deployments where sender=p_sender) q;
  insert into app_private.reward_controller_transactions(id,subject,sender,nonce,context,transaction)
   values(p_id,p_subject,p_sender,n,p_context,jsonb_set(p_transaction,'{nonce}',to_jsonb(n::text))) returning * into j;
 elsif p_action in('signed','confirm') then
  if j.id is null then raise exception 'controller_transaction_invalid'; end if;
  if p_action='signed' then
   if p_signed is null or p_hash is null or j.signed_transaction is not null and (j.signed_transaction<>p_signed or j.transaction_hash<>p_hash) then raise exception 'controller_transaction_invalid'; end if;
   update app_private.reward_controller_transactions set signed_transaction=p_signed,transaction_hash=p_hash where id=j.id returning * into j;
  else
   if j.transaction_hash is null or p_hash is distinct from j.transaction_hash then raise exception 'controller_transaction_invalid'; end if;
   update app_private.reward_controller_transactions set confirmed=true where id=j.id returning * into j;
  end if;
 end if;
 perform app_private.require_reward_demo_copy_controller(p_sender,p_subject);
 if j.id is null then return 'null'::jsonb; end if;
 return jsonb_build_object('id',j.id,'subject',j.subject,'sender',j.sender,'context',j.context,'transaction',j.transaction,
  'signedTransaction',j.signed_transaction,'hash',j.transaction_hash,'confirmed',j.confirmed);
end $$;

create function public.service_reward_demo_copy_controller_transaction(p_subject text,p_sender text,p_action text,
 p_id uuid default null,p_context jsonb default null,p_transaction jsonb default null,p_signed text default null,p_hash text default null)
returns jsonb language sql volatile security definer set search_path='' as $$
 select app_private.reward_demo_copy_controller_transaction(p_subject,p_sender,p_action,p_id,p_context,p_transaction,p_signed,p_hash)
$$;
revoke all on function app_private.require_reward_demo_copy_controller(text,text),
 app_private.reward_demo_copy_controller(text,text,integer,uuid,uuid,uuid,jsonb),
 app_private.reward_demo_copy_controller_transaction(text,text,text,uuid,jsonb,jsonb,text,text),
 public.service_reward_demo_copy_controller(text,text,uuid,uuid,uuid,jsonb),
 public.service_reward_demo_copy_controller_transaction(text,text,text,uuid,jsonb,jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_demo_copy_controller(text,text,uuid,uuid,uuid,jsonb),
 public.service_reward_demo_copy_controller_transaction(text,text,text,uuid,jsonb,jsonb,text,text) to service_role;
notify pgrst,'reload schema';
commit;
