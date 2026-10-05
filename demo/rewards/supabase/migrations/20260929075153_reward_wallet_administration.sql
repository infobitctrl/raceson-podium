begin;
create table app_private.reward_wallet_settings (
 singleton boolean primary key default true check(singleton),
 revision integer not null check(revision>0), settings jsonb not null,
 updated_at timestamptz not null default clock_timestamp()
);
create table app_private.reward_wallet_changes (
 revision integer primary key, settings jsonb not null, previous_settings jsonb not null,
 changed_by uuid not null references public.user_profiles(user_id),
 reason text not null check(length(reason) between 8 and 500),
 changed_at timestamptz not null default clock_timestamp()
);
alter table app_private.reward_wallet_settings enable row level security;
alter table app_private.reward_wallet_changes enable row level security;
revoke all on app_private.reward_wallet_settings,app_private.reward_wallet_changes from public,anon,authenticated,service_role;
grant select,insert,update on app_private.reward_wallet_settings to service_role;
grant select,insert on app_private.reward_wallet_changes to service_role;
create policy reward_wallet_settings_service on app_private.reward_wallet_settings for all to service_role using(true) with check(true);
create policy reward_wallet_changes_read on app_private.reward_wallet_changes for select to service_role using(true);
create policy reward_wallet_changes_insert on app_private.reward_wallet_changes for insert to service_role with check(true);

create function public.service_reward_wallet_settings(p_actor_user_id uuid,p_actor_session_id uuid,
 p_expected_revision integer default null,p_settings jsonb default null,p_reason text default null,p_previous_settings jsonb default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare current_revision integer; document jsonb;
begin
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if not exists(select 1 from public.platform_administrators where user_id=p_actor_user_id and is_active and platform_role='super_admin')
 then raise exception 'reward_master_admin_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reward-wallet-administration',0));
 -- Lock the authority row so concurrent revocation cannot cross the write.
 perform 1 from public.platform_administrators where user_id=p_actor_user_id and is_active and platform_role='super_admin' for share;
 if not found then raise exception 'reward_master_admin_required'; end if;
 select revision,settings into current_revision,document from app_private.reward_wallet_settings where singleton for update;
 current_revision:=coalesce(current_revision,0);
 if p_settings is not null then
  if p_expected_revision is distinct from current_revision then raise exception 'reward_wallet_settings_conflict'; end if;
  if p_previous_settings is null or (document is not null and document is distinct from p_previous_settings) or p_reason is null or length(btrim(p_reason)) not between 8 and 500
   or jsonb_typeof(p_settings) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_settings))<>2
   or not(p_settings ?& array['deployment','controller'])
   or p_settings#>>'{deployment,address}' is null or p_settings#>>'{controller,wallet}' is null
   or (p_settings#>>'{deployment,address}') !~ '^0x[0-9a-f]{40}$'
   or (p_settings#>>'{controller,wallet}') !~ '^0x[0-9a-f]{40}$'
   or p_settings#>>'{deployment,address}'=p_settings#>>'{controller,wallet}'
   or p_settings#>>'{deployment,address}'='0x'||repeat('0',40) or p_settings#>>'{controller,wallet}'='0x'||repeat('0',40)
   or p_settings#>>'{controller,subject}' is null or (p_settings#>>'{controller,subject}') !~ '^did:privy:[a-zA-Z0-9_-]{1,100}$'
  then raise exception 'invalid_reward_wallet_settings'; end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  current_revision:=current_revision+1;document:=p_settings;
  insert into app_private.reward_wallet_changes(revision,settings,previous_settings,changed_by,reason) values(current_revision,document,p_previous_settings,p_actor_user_id,btrim(p_reason));
  insert into app_private.reward_wallet_settings(singleton,revision,settings) values(true,current_revision,document)
   on conflict(singleton) do update set revision=excluded.revision,settings=excluded.settings,updated_at=clock_timestamp();
 end if;
 return jsonb_build_object('revision',current_revision,'settings',document,'history',
  (select coalesce(jsonb_agg(to_jsonb(h) order by h.revision desc),'[]'::jsonb) from
   (select revision,settings,changed_by,reason,changed_at from app_private.reward_wallet_changes order by revision desc limit 50) h));
end $$;
create function public.service_reward_wallet_runtime()
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('revision',coalesce((select revision from app_private.reward_wallet_settings where singleton),0),
 'settings',(select settings from app_private.reward_wallet_settings where singleton),
 'controllers',(select coalesce(jsonb_agg(c),'[]'::jsonb) from (select settings->'controller' c from app_private.reward_wallet_changes union select previous_settings->'controller' from app_private.reward_wallet_changes) v),
 'deployments',(select coalesce(jsonb_agg(d),'[]'::jsonb) from (select settings->'deployment' d from app_private.reward_wallet_changes union select previous_settings->'deployment' from app_private.reward_wallet_changes) v));
$$;
revoke all on function public.service_reward_wallet_settings(uuid,uuid,integer,jsonb,text,jsonb),public.service_reward_wallet_runtime() from public,anon,authenticated;
grant execute on function public.service_reward_wallet_settings(uuid,uuid,integer,jsonb,text,jsonb),public.service_reward_wallet_runtime() to service_role;
-- Factory V4 already accepts a separate gas payer. Preserve old jobs; only remove the application coupling on new reservations.
create or replace function public.service_reward_sponsor_auto_deployment(p_actor_user_id uuid,p_actor_session_id uuid,p_setup_id uuid,
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
   -- Bounded demo sponsorship: max 30 test MON reserved/day, max two/user/day.
   if (select count(*) from app_private.reward_sponsor_auto_deployments where created_at>clock_timestamp()-interval '24 hours')>=10
    or (select count(*) from app_private.reward_sponsor_auto_deployments where actor_user_id=p_actor_user_id and created_at>clock_timestamp()-interval '24 hours')>=2
    then raise exception 'sponsor_creation_capacity'; end if;
   select greatest((p_transaction->>'nonce')::bigint,coalesce(max(q.nonce)+1,0)) into n from (select nonce from app_private.reward_sponsor_auto_deployments where sender=p_sender union all select nonce from app_private.reward_controller_transactions where sender=p_sender) q;
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

commit;
