begin;
-- Copy-only native claims share the existing distribution/deployment nonce lock.
-- Read diagnostics retain stale pending jobs; mutation requires current consent,
-- operator, immutable source and the independently verified actual receipt.
create or replace function app_private.reward_demo_copy_controller_transaction(p_subject text,p_sender text,p_action text,
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
   if coalesce(j.context->>'kind','') not in('distribution','claim') then return 'null'::jsonb;end if;
   -- A stale decision must not hide a pending nonce. Read diagnostics only;
   -- signed/confirm/reserve still require the current exact approved handoff.
   perform app_private.reward_demo_copy_controller(p_sender,p_subject,10143,(j.context->>'setupId')::uuid);
  end if;
 else
  if p_action='reserve' then
   if p_signed is not null or p_hash is not null or p_context is null or jsonb_typeof(p_context) is distinct from 'object'
    or jsonb_typeof(p_context->'source') is distinct from 'string' or octet_length(p_context::text)>8388608
    then raise exception 'controller_transaction_invalid';end if;
   if p_context->>'kind'='distribution' then
    if (select count(*) from jsonb_object_keys(p_context))<>7 or not(p_context ?& array['kind','setupId','approvalId','action','start','end','source'])
     or coalesce(p_context->>'action','') not in('upload','stage','activate')
     or coalesce(p_context->>'start','') !~ '^(0|[1-9][0-9]{0,4})$' or coalesce(p_context->>'end','') !~ '^(0|[1-9][0-9]{0,4})$'
     or (p_context->>'start')::integer>(p_context->>'end')::integer then raise exception 'controller_transaction_invalid';end if;
   elsif p_context->>'kind'='claim' then
    if (select count(*) from jsonb_object_keys(p_context))<>5 or not(p_context ?& array['kind','claimId','setupId','approvalId','source'])
     then raise exception 'controller_transaction_invalid';end if;
   else raise exception 'controller_transaction_invalid';end if;
   if j.id is not null and (j.context is distinct from p_context or j.transaction-'nonce' is distinct from p_transaction-'nonce') then raise exception 'controller_transaction_invalid';end if;
   ctx:=p_context;
  else
   if p_context is not null or p_transaction is not null then raise exception 'controller_transaction_invalid';end if;
   ctx:=j.context;
  end if;
  if ctx->>'kind'='distribution' then
   facts:=app_private.reward_demo_copy_controller(p_sender,p_subject,10143,(ctx->>'setupId')::uuid,(ctx->>'approvalId')::uuid);
   source:=(ctx->>'source')::jsonb;
   if source#>>'{upload,documentHash}' is distinct from facts#>>'{upload,documentHash}'
    or source#>>'{upload,prepared,packageHash}' is distinct from facts#>>'{upload,prepared,packageHash}'
    or source#>>'{publication,bodyHash}' is distinct from facts#>>'{publication,bodyHash}'
    then raise exception 'controller_source_not_ready';end if;
  elsif ctx->>'kind'='claim' then
   facts:=app_private.reward_demo_copy_claim(null,null,10143,(ctx->>'claimId')::uuid,'operator',null,null,p_subject,p_sender);
   source:=(ctx->>'source')::jsonb;
   if facts->'current' is distinct from 'true'::jsonb or facts->>'setupId' is distinct from ctx->>'setupId'
    or facts->>'approvalId' is distinct from ctx->>'approvalId' or facts#>>'{plan,operator}' is distinct from p_sender
    or not(facts->'events' ?& array['intent','recipient','operator']) or facts->'events' ? 'revoked'
    or source is distinct from jsonb_build_object('claimId',facts->'claimId','setupId',facts->'setupId','approvalId',facts->'approvalId',
     'sourceStamp',facts->'sourceStamp','profileFingerprint',facts->'profileFingerprint','packageHash',facts->'packageHash',
     'claim',facts#>'{events,intent,claim}',
     'recipient',jsonb_build_object('digest',facts#>'{events,recipient,digest}','signer',facts#>'{events,recipient,signer}'),
     'operator',jsonb_build_object('digest',facts#>'{events,operator,digest}','signer',facts#>'{events,operator,signer}'))
    then raise exception 'controller_source_not_ready';end if;
   if p_action='confirm' then
    if facts#>>'{events,receipt,transactionHash}' is distinct from p_hash then raise exception 'controller_receipt_invalid';end if;
   elsif facts->'events' ? 'receipt' then raise exception 'controller_source_not_ready';end if;
  else raise exception 'controller_transaction_invalid';end if;

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
   or (p_transaction->>'gas')::numeric*(p_transaction->>'gasPrice')::numeric>500000000000000000
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

revoke all on function app_private.reward_demo_copy_controller_transaction(text,text,text,uuid,jsonb,jsonb,text,text) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
