begin;
-- Reviewer authorization and publication-only provider consent are independent.
-- Share the existing nonce lane with manual controller and automatic creation.
create table app_private.reward_review_publication_audit (
 job_id uuid primary key references app_private.reward_controller_transactions(id),
 reviewer_user_id uuid not null references auth.users(id),
 reviewer_session_id uuid not null,
 initiated_at timestamptz not null default clock_timestamp()
);
alter table app_private.reward_review_publication_audit enable row level security;
revoke all on app_private.reward_review_publication_audit from public,anon,authenticated,service_role;
create function public.service_reward_demo_copy_review_publication_transaction(p_actor_user_id uuid,p_actor_session_id uuid,p_setup_id uuid,p_slot integer,p_approval_id uuid,p_operator text,p_action text,
 p_id uuid default null,p_context jsonb default null,p_transaction jsonb default null,p_signed text default null,p_hash text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare j app_private.reward_controller_transactions%rowtype; n bigint; ctx jsonb; facts jsonb; source jsonb; p_subject constant text := 'service:review-publication'; p_sender text := p_operator;
begin
 perform app_private.require_reward_demo_copy_reviewer(p_actor_user_id,p_actor_session_id);
 if p_sender is null or p_sender !~ '^0x[0-9a-f]{40}$'
  or p_action is null or p_action not in('read','reserve','signed','confirm') then raise exception 'controller_transaction_invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reward-auto-creation',0));
 facts:=app_private.reward_demo_copy_lifecycle(p_actor_user_id,p_actor_session_id,10143,p_setup_id,p_slot,p_approval_id);
 if facts#>>'{upload,execution,plan,operator}' is distinct from p_sender
  or facts#>'{upload,current}' is distinct from 'true'::jsonb or facts#>'{publication,current}' is distinct from 'true'::jsonb
  then raise exception 'controller_source_not_ready';end if;
 if p_id is null then
  select * into j from app_private.reward_controller_transactions where sender=p_sender and subject=p_subject and not confirmed order by nonce limit 1;
 else select * into j from app_private.reward_controller_transactions where id=p_id and sender=p_sender and subject=p_subject for update; end if;
 if p_action='read' then
  if p_context is not null or p_transaction is not null or p_signed is not null or p_hash is not null then raise exception 'controller_transaction_invalid';end if;
  if j.id is not null then
   if j.context->>'kind' is distinct from 'distribution' then return 'null'::jsonb;end if;
   -- Another approval cannot consume this reserved nonce.
   if j.context->>'setupId' is distinct from p_setup_id::text or j.context->>'approvalId' is distinct from p_approval_id::text then raise exception 'controller_transaction_pending';end if;
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
  if ctx->>'setupId' is distinct from p_setup_id::text or ctx->>'approvalId' is distinct from p_approval_id::text then raise exception 'controller_scope_required';end if;
  source:=(ctx->>'source')::jsonb;
  if source->'publication' is distinct from facts->'publication'
   or source#>>'{upload,documentHash}' is distinct from facts#>>'{upload,documentHash}'
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
   or p_transaction->>'to' is distinct from facts#>>'{upload,prepared,package,campaignAddress}'
   or left(p_transaction->>'data',10) is distinct from (case p_context->>'action' when 'upload' then '0x59596dfd' when 'stage' then '0x6a404ce2' when 'activate' then '0xeb778965' end)
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
  insert into app_private.reward_review_publication_audit(job_id,reviewer_user_id,reviewer_session_id) values(j.id,p_actor_user_id,p_actor_session_id);
 elsif p_action in('signed','confirm') then
  if j.id is null then raise exception 'controller_transaction_invalid'; end if;
  if p_action='signed' then
   if p_signed is null or p_signed !~ '^0x[0-9a-f]+$' or octet_length(p_signed)>250000 or p_hash is null or p_hash !~ '^0x[0-9a-f]{64}$' or j.signed_transaction is not null and (j.signed_transaction<>p_signed or j.transaction_hash<>p_hash) then raise exception 'controller_transaction_invalid'; end if;
   update app_private.reward_controller_transactions set signed_transaction=p_signed,transaction_hash=p_hash where id=j.id returning * into j;
  else
   if p_signed is not null or j.transaction_hash is null or p_hash is distinct from j.transaction_hash or not exists(select 1 from app_private.reward_sponsor_lifecycle_v4 where id=j.id and approval_id=p_approval_id and kind='receipt' and body_text::jsonb->>'transactionHash'=p_hash) then raise exception 'controller_transaction_invalid'; end if;
   update app_private.reward_controller_transactions set confirmed=true where id=j.id returning * into j;
  end if;
 end if;
 perform app_private.require_reward_demo_copy_reviewer(p_actor_user_id,p_actor_session_id);
 if j.id is null then return 'null'::jsonb; end if;
 return jsonb_build_object('id',j.id,'subject',j.subject,'sender',j.sender,'context',j.context,'transaction',j.transaction,
  'signedTransaction',j.signed_transaction,'hash',j.transaction_hash,'confirmed',j.confirmed);
end $$;


create function public.service_reward_demo_copy_review_publication_receipt(p_actor_user_id uuid,p_actor_session_id uuid,
 p_setup_id uuid,p_slot integer,p_approval_id uuid,p_operator text,p_id uuid,p_receipt jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare j app_private.reward_controller_transactions%rowtype; facts jsonb; old app_private.reward_sponsor_lifecycle_v4%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('reward-auto-creation',0));
 facts:=app_private.reward_demo_copy_lifecycle(p_actor_user_id,p_actor_session_id,10143,p_setup_id,p_slot,p_approval_id);
 if facts#>>'{upload,execution,plan,operator}' is distinct from p_operator or facts#>'{upload,current}' is distinct from 'true'::jsonb or facts#>'{publication,current}' is distinct from 'true'::jsonb then raise exception 'controller_source_not_ready';end if;
 select * into j from app_private.reward_controller_transactions where id=p_id and sender=p_operator and subject='service:review-publication' for update;
 if j.id is null or j.transaction_hash is null or p_receipt->>'transactionHash' is distinct from j.transaction_hash
  or j.context->>'setupId' is distinct from p_setup_id::text or j.context->>'approvalId' is distinct from p_approval_id::text
  or (j.context->>'source')::jsonb#>>'{upload,documentHash}' is distinct from facts#>>'{upload,documentHash}'
  or (j.context->>'source')::jsonb#>>'{upload,prepared,packageHash}' is distinct from facts#>>'{upload,prepared,packageHash}'
  or (j.context->>'source')::jsonb->'publication' is distinct from facts->'publication'
  or p_receipt->>'action' is distinct from j.context->>'action'
  or p_receipt->'start' is distinct from j.context->'start' or p_receipt->'end' is distinct from j.context->'end'
  or p_receipt->>'campaignAddress' is distinct from j.transaction->>'to' then raise exception 'controller_receipt_invalid';end if;
 select * into old from app_private.reward_sponsor_lifecycle_v4 where id=p_id;
 if old.id is not null then
  if old.approval_id<>p_approval_id or old.kind<>'receipt' or old.body_text::jsonb is distinct from p_receipt then raise exception 'controller_receipt_conflict';end if;
 else
  facts:=app_private.reward_demo_copy_lifecycle(p_actor_user_id,p_actor_session_id,10143,p_setup_id,p_slot,p_approval_id,p_id,'receipt',p_receipt::text);
 end if;
 perform app_private.require_reward_demo_copy_reviewer(p_actor_user_id,p_actor_session_id);
 return facts;
end $$;
revoke execute on function public.service_reward_demo_copy_review_publication_transaction(uuid,uuid,uuid,integer,uuid,text,text,uuid,jsonb,jsonb,text,text),
 public.service_reward_demo_copy_review_publication_receipt(uuid,uuid,uuid,integer,uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_demo_copy_review_publication_transaction(uuid,uuid,uuid,integer,uuid,text,text,uuid,jsonb,jsonb,text,text),
 public.service_reward_demo_copy_review_publication_receipt(uuid,uuid,uuid,integer,uuid,text,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
