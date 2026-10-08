-- Explicit replacement only after API verification of canonical finalized failure.
-- Existing immutable attempts and their original reservation times remain private.
begin;
create table app_private.reward_sponsor_failed_deployments (
 setup_id uuid not null references app_private.reward_sponsor_executions(setup_id),
 actor_user_id uuid not null references auth.users(id),
 sender text not null check(sender ~ '^0x[0-9a-f]{40}$'),
 nonce bigint not null check(nonce>=0),
 transaction_hash text not null check(transaction_hash ~ '^0x[0-9a-f]{64}$'),
 job jsonb not null,
 failure jsonb not null,
 created_at timestamptz not null,
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(setup_id,transaction_hash), unique(sender,nonce)
);
alter table app_private.reward_sponsor_failed_deployments enable row level security;
revoke all on app_private.reward_sponsor_failed_deployments from public,anon,authenticated,service_role;

create or replace function public.service_reward_sponsor_auto_deployment(p_actor_user_id uuid,p_actor_session_id uuid,p_setup_id uuid,
 p_action text default 'read',p_lease_id uuid default null,p_sender text default null,p_transaction jsonb default null,
 p_signed_transaction text default null,p_transaction_hash text default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare e app_private.reward_sponsor_executions%rowtype; d app_private.reward_distribution_setups%rowtype;
 j app_private.reward_sponsor_auto_deployments%rowtype; n bigint; tx jsonb; failure jsonb;
begin
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if p_action is null or p_action not in('read','reserve','signed','confirm','retry','release') then raise exception 'invalid_sponsor_creation'; end if;
 -- One ordered lock for reservations across all deployment wallets, then setup.
 perform pg_advisory_xact_lock(hashtextextended('reward-auto-creation',0));
 perform pg_advisory_xact_lock(hashtextextended('reward-setup:'||p_setup_id::text,0));
 select * into d from app_private.reward_distribution_setups where id=p_setup_id and owner_user_id=p_actor_user_id and chain_id=10143 and archived_at is null for share;
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if d.id is null then raise exception 'reward_setup_not_found'; end if;
 select * into e from app_private.reward_sponsor_executions where setup_id=d.id for update;
 select * into j from app_private.reward_sponsor_auto_deployments where setup_id=d.id for update;
 if p_action='retry' then
  if j.setup_id is null or j.confirmed or e.deployment_hash is not null or j.signed_transaction is null
   or p_transaction_hash is distinct from j.transaction_hash or p_sender is distinct from j.sender then raise exception 'invalid_sponsor_creation'; end if;
  if j.lease_id is distinct from p_lease_id or j.lease_until<=clock_timestamp() then raise exception 'sponsor_creation_lease'; end if;
  if p_transaction is null or jsonb_typeof(p_transaction)<>'object'
   or (select count(*) from jsonb_object_keys(p_transaction))<>2
   or not(p_transaction ?& array['replacement','failure']) then raise exception 'invalid_sponsor_creation'; end if;
  failure:=p_transaction->'failure'; p_transaction:=p_transaction->'replacement';
  if failure is null or jsonb_typeof(failure)<>'object'
   or (select count(*) from jsonb_object_keys(failure))<>5
   or not(failure ?& array['blockNumber','blockHash','finalizedBlockNumber','finalizedBlockHash','nonceAfter'])
   or exists(select 1 from jsonb_each(failure) x where jsonb_typeof(x.value)<>'string')
   or failure->>'blockNumber' !~ '^[0-9]{1,20}$' or failure->>'finalizedBlockNumber' !~ '^[0-9]{1,20}$'
   or failure->>'nonceAfter' !~ '^[0-9]{1,12}$'
   or failure->>'blockHash' !~ '^0x[0-9a-f]{64}$' or failure->>'finalizedBlockHash' !~ '^0x[0-9a-f]{64}$'
   or (failure->>'blockNumber')::numeric>(failure->>'finalizedBlockNumber')::numeric
   or (failure->>'nonceAfter')::numeric<=j.nonce
   or p_transaction->'data' is distinct from j.transaction->'data'
   or p_transaction->'to' is distinct from j.transaction->'to'
   then raise exception 'invalid_sponsor_creation'; end if;
 end if;
 if p_action in('reserve','retry') then
  if e.setup_id is null or p_lease_id is null then raise exception 'invalid_sponsor_creation'; end if;
  if (j.setup_id is null and e.deployment_hash is null) or p_action='retry' then
   if p_sender is null or p_sender !~ '^0x[0-9a-f]{40}$' or p_sender='0x'||repeat('0',40)
    or p_sender=e.plan->>'funder'
    or (not(p_transaction ? 'to') and p_sender in(e.plan->>'operator',e.plan->>'unallocatedTreasury',e.plan->>'expiredTreasury'))
    or p_transaction is null or jsonb_typeof(p_transaction)<>'object'
    or (select count(*) from jsonb_object_keys(p_transaction))<>(case when p_transaction ? 'to' then 7 else 6 end)
    or (p_transaction ? 'to' and (p_transaction->>'to' is null or p_transaction->>'to' !~ '^0x[0-9a-f]{40}$'))
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
   if exists(select 1 from app_private.reward_controller_transactions where sender=p_sender and not confirmed) then raise exception 'sponsor_creation_busy'; end if;
   -- Owner-authorized testnet allowance: ten reservations per sponsor per rolling 24 hours.
   -- The global ten-reservation / maximum 30 test MON gas bound remains unchanged.
   if (select count(*) from (select actor_user_id,created_at from app_private.reward_sponsor_auto_deployments
      union all select actor_user_id,created_at from app_private.reward_sponsor_failed_deployments) attempts
      where created_at>clock_timestamp()-interval '24 hours')>=10
    or (select count(*) from (select actor_user_id,created_at from app_private.reward_sponsor_auto_deployments
      union all select actor_user_id,created_at from app_private.reward_sponsor_failed_deployments) attempts
      where actor_user_id=p_actor_user_id and created_at>clock_timestamp()-interval '24 hours')>=10
    then raise exception 'sponsor_creation_capacity'; end if;
   select greatest((p_transaction->>'nonce')::bigint,coalesce(max(q.nonce)+1,0)) into n from (select nonce from app_private.reward_sponsor_auto_deployments where sender=p_sender union all select nonce from app_private.reward_controller_transactions where sender=p_sender union all select nonce from app_private.reward_sponsor_failed_deployments where sender=p_sender) q;
   tx:=jsonb_set(p_transaction,'{nonce}',to_jsonb(n::text));
   if p_action='retry' then
    insert into app_private.reward_sponsor_failed_deployments(setup_id,actor_user_id,sender,nonce,transaction_hash,job,failure,created_at)
     values(j.setup_id,j.actor_user_id,j.sender,j.nonce,j.transaction_hash,to_jsonb(j),failure,j.created_at);
    update app_private.reward_sponsor_auto_deployments set nonce=n,transaction=tx,signed_transaction=null,transaction_hash=null,
     confirmed=false,lease_until=clock_timestamp(),created_at=clock_timestamp() where setup_id=d.id returning * into j;
   else
   insert into app_private.reward_sponsor_auto_deployments(setup_id,actor_user_id,sender,nonce,transaction,lease_id,lease_until)
    values(d.id,p_actor_user_id,p_sender,n,tx,p_lease_id,clock_timestamp()+interval '60 seconds') returning * into j;
   end if;
  elsif j.setup_id is not null and (j.lease_until<clock_timestamp() or j.lease_id=p_lease_id) then
   update app_private.reward_sponsor_auto_deployments set lease_id=p_lease_id,lease_until=clock_timestamp()+interval '60 seconds' where setup_id=d.id returning * into j;
  end if;
 elsif p_action in('signed','confirm','release') then
  if j.setup_id is null or j.lease_id is distinct from p_lease_id or j.lease_until<=clock_timestamp() then raise exception 'sponsor_creation_lease'; end if;
  if p_action='release' then
   if j.confirmed or j.transaction_hash is null or p_transaction_hash is distinct from j.transaction_hash then raise exception 'invalid_sponsor_creation'; end if;
   update app_private.reward_sponsor_auto_deployments set lease_until=clock_timestamp() where setup_id=d.id returning * into j;
  elsif p_action='signed' then
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

commit;
