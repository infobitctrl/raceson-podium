-- Demo-only fixed-transaction creation journal. No oracle/result authority.
begin;
create table app_private.reward_sponsor_auto_deployments (
 setup_id uuid primary key references app_private.reward_sponsor_executions(setup_id),
 actor_user_id uuid not null references auth.users(id),
 sender text not null check(sender ~ '^0x[0-9a-f]{40}$'),
 nonce bigint not null check(nonce >= 0),
 transaction jsonb not null,
 signed_transaction text,
 transaction_hash text,
 lease_id uuid not null,
 lease_until timestamptz not null,
 confirmed boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),
 unique(sender,nonce),
 check((signed_transaction is null)=(transaction_hash is null)),
 check(signed_transaction is null or signed_transaction ~ '^0x[0-9a-f]+$' and length(signed_transaction)<250000),
 check(transaction_hash is null or transaction_hash ~ '^0x[0-9a-f]{64}$'),
 check(not confirmed or transaction_hash is not null)
);
alter table app_private.reward_sponsor_auto_deployments enable row level security;
revoke all on app_private.reward_sponsor_auto_deployments from public,anon,authenticated,service_role;
grant select,insert,update on app_private.reward_sponsor_auto_deployments to service_role;
create policy sponsor_auto_service on app_private.reward_sponsor_auto_deployments for all to service_role using(true) with check(true);

create function public.service_reward_sponsor_auto_deployment(p_actor_user_id uuid,p_actor_session_id uuid,p_setup_id uuid,
 p_action text default 'read',p_lease_id uuid default null,p_sender text default null,p_transaction jsonb default null,
 p_signed_transaction text default null,p_transaction_hash text default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare e app_private.reward_sponsor_executions%rowtype; d app_private.reward_distribution_setups%rowtype;
 j app_private.reward_sponsor_auto_deployments%rowtype; n bigint; tx jsonb;
begin
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if p_action is null or p_action not in('read','reserve','signed','confirm') then raise exception 'invalid_sponsor_creation'; end if;
 -- One ordered lock for reservations across all deployment wallets, then setup.
 perform pg_advisory_xact_lock(hashtextextended('reward-auto-creation',0));
 perform pg_advisory_xact_lock(hashtextextended('reward-setup:'||p_setup_id::text,0));
 select * into d from app_private.reward_distribution_setups where id=p_setup_id and owner_user_id=p_actor_user_id and chain_id=10143 and archived_at is null for share;
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if d.id is null then raise exception 'reward_setup_not_found'; end if;
 select * into e from app_private.reward_sponsor_executions where setup_id=d.id for update;
 select * into j from app_private.reward_sponsor_auto_deployments where setup_id=d.id for update;
 if p_action='reserve' then
  if e.setup_id is null or p_lease_id is null then raise exception 'invalid_sponsor_creation'; end if;
  if j.setup_id is null and e.deployment_hash is null then
   if p_sender is null or p_sender !~ '^0x[0-9a-f]{40}$' or p_sender='0x'||repeat('0',40)
    or p_sender in(e.plan->>'operator',e.plan->>'funder',e.plan->>'unallocatedTreasury',e.plan->>'expiredTreasury')
    or p_transaction is null or jsonb_typeof(p_transaction)<>'object'
    or (select count(*) from jsonb_object_keys(p_transaction))<>6
    or not(p_transaction ?& array['chainId','data','value','nonce','gas','gasPrice'])
    or p_transaction->'chainId' is distinct from '10143'::jsonb or p_transaction->'value' is distinct from '"0"'::jsonb
    or exists(select 1 from jsonb_each(p_transaction) x where x.key<>'chainId' and jsonb_typeof(x.value)<>'string')
    or p_transaction->>'data' !~ '^0x[0-9a-f]+$' or octet_length(p_transaction::text)>200000
    or p_transaction->>'nonce' !~ '^[0-9]{1,12}$' or p_transaction->>'gas' !~ '^[0-9]{1,8}$'
    or p_transaction->>'gasPrice' !~ '^[0-9]{1,15}$'
    or (p_transaction->>'gas')::numeric not between 1 and 30000000
    or (p_transaction->>'gasPrice')::numeric<=0
    or (p_transaction->>'gas')::numeric*(p_transaction->>'gasPrice')::numeric>3000000000000000000
    then raise exception 'invalid_sponsor_creation'; end if;
   -- Bounded demo sponsorship: max 30 test MON reserved/day, max two/user/day.
   if (select count(*) from app_private.reward_sponsor_auto_deployments where created_at>clock_timestamp()-interval '24 hours')>=10
    or (select count(*) from app_private.reward_sponsor_auto_deployments where actor_user_id=p_actor_user_id and created_at>clock_timestamp()-interval '24 hours')>=2
    then raise exception 'sponsor_creation_capacity'; end if;
   select greatest((p_transaction->>'nonce')::bigint,coalesce(max(nonce)+1,0)) into n from app_private.reward_sponsor_auto_deployments where sender=p_sender;
   tx:=jsonb_set(p_transaction,'{nonce}',to_jsonb(n::text));
   insert into app_private.reward_sponsor_auto_deployments(setup_id,actor_user_id,sender,nonce,transaction,lease_id,lease_until)
    values(d.id,p_actor_user_id,p_sender,n,tx,p_lease_id,clock_timestamp()+interval '60 seconds') returning * into j;
  elsif j.setup_id is not null and (j.lease_until<clock_timestamp() or j.lease_id=p_lease_id) then
   update app_private.reward_sponsor_auto_deployments set lease_id=p_lease_id,lease_until=clock_timestamp()+interval '60 seconds' where setup_id=d.id returning * into j;
  end if;
 elsif p_action in('signed','confirm') then
  if j.setup_id is null or j.lease_id is distinct from p_lease_id or j.lease_until<=clock_timestamp() then raise exception 'sponsor_creation_lease'; end if;
  if p_action='signed' then
   if p_signed_transaction is null or p_transaction_hash is null or j.signed_transaction is not null and (j.signed_transaction<>p_signed_transaction or j.transaction_hash<>p_transaction_hash) then raise exception 'invalid_sponsor_creation'; end if;
   update app_private.reward_sponsor_auto_deployments set signed_transaction=p_signed_transaction,transaction_hash=p_transaction_hash where setup_id=d.id returning * into j;
  else
   if j.transaction_hash is null or p_transaction_hash is distinct from j.transaction_hash then raise exception 'invalid_sponsor_creation'; end if;
   perform public.service_reward_sponsor_execution(p_actor_user_id,p_actor_session_id,10143,d.id,null,j.transaction_hash,null);
   update app_private.reward_sponsor_auto_deployments set confirmed=true where setup_id=d.id returning * into j;
  end if;
 end if;
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if j.setup_id is null then return 'null'::jsonb; end if;
 return jsonb_build_object('sender',j.sender,'transaction',j.transaction,'signedTransaction',j.signed_transaction,
  'hash',j.transaction_hash,'leaseId',j.lease_id,'leaseUntil',j.lease_until,'confirmed',j.confirmed);
end $$;
revoke all on function public.service_reward_sponsor_auto_deployment(uuid,uuid,uuid,text,uuid,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.service_reward_sponsor_auto_deployment(uuid,uuid,uuid,text,uuid,text,jsonb,text,text) to service_role;
commit;
