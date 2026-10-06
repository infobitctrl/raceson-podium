begin;
-- Settlement belongs to the original escrow/operator, not a mutable sporting
-- approval or profile. Only independently verified actual receipts are recorded.
create table app_private.reward_demo_copy_settlement_receipts(
 id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'),
 setup_id uuid not null references app_private.reward_sponsor_executions(setup_id),
 slot integer not null check(slot between 0 and 5),
 action text not null check(action in('close','returnUnallocated','returnExpired')),
 subject text not null,sender text not null,transaction_hash text not null unique,
 body jsonb not null check(jsonb_typeof(body)='object' and octet_length(body::text)<=16384),
 created_at timestamptz not null default clock_timestamp(),unique(setup_id,slot,action)
);
alter table app_private.reward_demo_copy_settlement_receipts enable row level security;
revoke all on app_private.reward_demo_copy_settlement_receipts from public,anon,authenticated,service_role;
create trigger immutable before update or delete on app_private.reward_demo_copy_settlement_receipts
 for each row execute function app_private.reward_result_review_immutable_v3();

create function app_private.reward_demo_copy_settlement(p_subject text,p_sender text,p_setup_id uuid,p_slot integer,
 p_request_id uuid default null,p_receipt jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare e app_private.reward_sponsor_executions%rowtype;old app_private.reward_demo_copy_settlement_receipts%rowtype;
 rows jsonb;field text;selected_action text;recipient text;amount numeric;
begin
 perform app_private.require_reward_demo_copy_controller(p_sender,p_subject);
 if p_setup_id is null or p_slot is null or p_slot not between 0 and 5 then raise exception 'controller_invalid_request';end if;
 perform pg_advisory_xact_lock(hashtextextended('reward-settlement:'||p_setup_id::text||':'||p_slot::text,0));
 -- Archiving a planning page must not prevent settling its original escrow.
 select x.* into e from app_private.reward_sponsor_executions x
 join app_private.reward_demo_copy_launch_sources b on b.launch_id=x.launch_id
  and b.batch_sha256='073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644'
 join app_private.reward_distribution_setups d on d.id=x.setup_id and d.chain_id=10143
 where x.setup_id=p_setup_id and x.plan->>'operator'=p_sender and x.plan->'chainId'='10143'::jsonb for share of x;
 if e.setup_id is null or coalesce(e.plan->'caps'->>p_slot,'0')::numeric<=0 then raise exception 'controller_scope_required';end if;
 if p_receipt is null and p_request_id is not null then raise exception 'controller_receipt_invalid';end if;
 if p_receipt is not null then
  if e.deployment_hash is null or e.funding_hash is null then raise exception 'controller_source_not_ready';end if;
  if p_request_id is null or p_request_id='00000000-0000-0000-0000-000000000000'
   or jsonb_typeof(p_receipt) is distinct from 'object' or octet_length(p_receipt::text)>16384
   or(select count(*) from jsonb_object_keys(p_receipt))<>10
   or not(p_receipt?&array['action','slot','campaignAddress','recipient','amountWei','transactionHash','blockNumber','blockHash','blockTimestamp','schema'])
   or p_receipt->>'schema' is distinct from 'podium-sponsor-settlement-receipt-v1'
   or p_receipt->'slot' is distinct from to_jsonb(p_slot) then raise exception 'controller_receipt_invalid';end if;
  foreach field in array array['action','campaignAddress','amountWei','transactionHash','blockNumber','blockHash','blockTimestamp','schema'] loop
   if jsonb_typeof(p_receipt->field) is distinct from 'string' then raise exception 'controller_receipt_invalid';end if;
  end loop;
  selected_action:=p_receipt->>'action';recipient:=p_receipt->>'recipient';
  if selected_action not in('close','returnUnallocated','returnExpired') or p_receipt->>'campaignAddress' !~ '^0x[0-9a-f]{40}$'
   or p_receipt->>'campaignAddress' in('0x'||repeat('0',40),'0x'||repeat('0',39)||'1')
   or p_receipt->>'amountWei' !~ '^(0|[1-9][0-9]{0,24})$'
   or p_receipt->>'transactionHash' !~ '^0x[0-9a-f]{64}$' or p_receipt->>'transactionHash'='0x'||repeat('0',64)
   or p_receipt->>'blockHash' !~ '^0x[0-9a-f]{64}$' or p_receipt->>'blockHash'='0x'||repeat('0',64)
   or p_receipt->>'blockNumber' !~ '^[1-9][0-9]{0,19}$' or (p_receipt->>'blockNumber')::numeric>=18446744073709551616
   or p_receipt->>'blockTimestamp' !~ '^[1-9][0-9]{0,19}$' or (p_receipt->>'blockTimestamp')::numeric>=18446744073709551616
   then raise exception 'controller_receipt_invalid';end if;
  amount:=(p_receipt->>'amountWei')::numeric;
  if amount>(e.plan->'caps'->>p_slot)::numeric then raise exception 'controller_receipt_invalid';end if;
  if selected_action='close' then
   if p_receipt->'recipient' is distinct from 'null'::jsonb or amount<>0 then raise exception 'controller_receipt_invalid';end if;
  elsif amount<=0 or jsonb_typeof(p_receipt->'recipient') is distinct from 'string'
   or recipient is distinct from e.plan->>(case when selected_action='returnUnallocated' then 'unallocatedTreasury' else 'expiredTreasury' end)
   then raise exception 'controller_receipt_invalid';end if;
  select * into old from app_private.reward_demo_copy_settlement_receipts r
   where r.id=p_request_id or r.transaction_hash=p_receipt->>'transactionHash' or(r.setup_id=p_setup_id and r.slot=p_slot and r.action=selected_action);
  if old.id is not null then
   if old.setup_id<>p_setup_id or old.slot<>p_slot or old.action<>selected_action or old.subject<>p_subject or old.sender<>p_sender or old.body<>p_receipt
    then raise exception 'controller_receipt_conflict';end if;
  else
   insert into app_private.reward_demo_copy_settlement_receipts(id,setup_id,slot,action,subject,sender,transaction_hash,body)
    values(p_request_id,p_setup_id,p_slot,selected_action,p_subject,p_sender,p_receipt->>'transactionHash',p_receipt);
  end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'body',r.body) order by r.created_at,r.id),'[]'::jsonb) into rows
 from app_private.reward_demo_copy_settlement_receipts r where r.setup_id=p_setup_id and r.slot=p_slot;
 perform app_private.require_reward_demo_copy_controller(p_sender,p_subject);
 return jsonb_build_object('setupId',p_setup_id,'slot',p_slot,'execution',jsonb_build_object('plan',e.plan,'deploymentHash',e.deployment_hash,'fundingHash',e.funding_hash),'receipts',rows);
end $$;
create function public.service_reward_demo_copy_settlement(p_subject text,p_sender text,p_setup_id uuid,p_slot integer,p_action text,p_input jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>16384 then raise exception 'controller_invalid_request';end if;
 if p_action='read' and (select count(*) from jsonb_object_keys(p_input))=0 then
  return app_private.reward_demo_copy_settlement(p_subject,p_sender,p_setup_id,p_slot);
 elsif p_action='receipt' and(select count(*) from jsonb_object_keys(p_input))=2 and p_input?&array['requestId','body'] then
  return app_private.reward_demo_copy_settlement(p_subject,p_sender,p_setup_id,p_slot,(p_input->>'requestId')::uuid,p_input->'body');
 end if;
 raise exception 'controller_invalid_request';
end $$;
revoke all on function app_private.reward_demo_copy_settlement(text,text,uuid,integer,uuid,jsonb),
 public.service_reward_demo_copy_settlement(text,text,uuid,integer,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_demo_copy_settlement(text,text,uuid,integer,text,jsonb) to service_role;

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
   if coalesce(j.context->>'kind','') not in('distribution','claim','clubClaim','settlement') then return 'null'::jsonb;end if;
   -- A stale decision must not hide a pending nonce. Read diagnostics only;
   -- signed/confirm/reserve still require the current exact approved handoff.
   if j.context->>'kind'='settlement' then
    perform app_private.reward_demo_copy_settlement(p_subject,p_sender,(j.context->>'setupId')::uuid,(j.context->>'slot')::integer);
   else perform app_private.reward_demo_copy_controller(p_sender,p_subject,10143,(j.context->>'setupId')::uuid);end if;
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
   elsif p_context->>'kind'='settlement' then
    if(select count(*) from jsonb_object_keys(p_context))<>7 or not(p_context?&array['kind','setupId','slot','action','recipient','amountWei','source'])
     or coalesce(p_context->>'action','') not in('close','returnUnallocated','returnExpired')
     or jsonb_typeof(p_context->'slot') is distinct from 'number' or p_context->>'slot' !~ '^[0-5]$'
     or jsonb_typeof(p_context->'amountWei') is distinct from 'string' or p_context->>'amountWei' !~ '^(0|[1-9][0-9]{0,24})$'
     then raise exception 'controller_transaction_invalid';end if;
   elsif p_context->>'kind' in('claim','clubClaim') then
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
  elsif ctx->>'kind'='settlement' then
   facts:=app_private.reward_demo_copy_settlement(p_subject,p_sender,(ctx->>'setupId')::uuid,(ctx->>'slot')::integer);
   source:=(ctx->>'source')::jsonb;
   if source is distinct from jsonb_build_object('setupId',facts->'setupId','slot',facts->'slot','execution',facts->'execution')
    or facts#>'{execution,deploymentHash}'='null'::jsonb or facts#>'{execution,fundingHash}'='null'::jsonb
    or(ctx->>'amountWei')::numeric>(facts#>>array['execution','plan','caps',ctx->>'slot'])::numeric
    then raise exception 'controller_source_not_ready';end if;
   if ctx->>'action'='close' then
    if ctx->'recipient' is distinct from 'null'::jsonb or ctx->>'amountWei'<>'0' then raise exception 'controller_transaction_invalid';end if;
   else
    if(ctx->>'amountWei')::numeric<=0 or ctx->>'recipient' is distinct from facts#>>array['execution','plan',case when ctx->>'action'='returnUnallocated' then 'unallocatedTreasury' else 'expiredTreasury' end]
     then raise exception 'controller_transaction_invalid';end if;
   end if;
   if p_action='confirm' then
    if not exists(select 1 from jsonb_array_elements(facts->'receipts') r where r->'body'->>'transactionHash'=p_hash
      and r->'body'->>'action'=ctx->>'action' and r->'body'->'recipient'=ctx->'recipient'
      and r->'body'->>'amountWei'=ctx->>'amountWei' and r->'body'->>'campaignAddress'=j.transaction->>'to')
     then raise exception 'controller_receipt_invalid';end if;
   elsif exists(select 1 from jsonb_array_elements(facts->'receipts') r where r->'body'->>'action'=ctx->>'action')
    then raise exception 'controller_source_not_ready';end if;
  elsif ctx->>'kind' in('claim','clubClaim') then
   if ctx->>'kind'='clubClaim' then
    facts:=app_private.reward_demo_copy_club_claim(null,null,10143,(ctx->>'claimId')::uuid,'operator',null,null,p_subject,p_sender);
   else facts:=app_private.reward_demo_copy_claim(null,null,10143,(ctx->>'claimId')::uuid,'operator',null,null,p_subject,p_sender);end if;
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
