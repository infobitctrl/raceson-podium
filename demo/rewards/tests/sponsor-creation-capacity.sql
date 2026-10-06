-- Run only in a fresh disposable PostgreSQL database with psql -v ON_ERROR_STOP=1.
-- Minimal account/table fixtures exercise the real migration's reservation logic.
-- This is not a hosted authentication test and never signs or broadcasts a transaction.
create schema app_private;
create role anon;
create role authenticated;
create role service_role;
create table app_private.reward_distribution_setups (
 id uuid primary key, owner_user_id uuid not null, chain_id integer not null, archived_at timestamptz
);
create table app_private.reward_sponsor_executions (
 setup_id uuid primary key, plan jsonb not null, deployment_hash text
);
create table app_private.reward_sponsor_auto_deployments (
 setup_id uuid primary key, actor_user_id uuid not null, sender text not null, nonce bigint not null,
 transaction jsonb not null, lease_id uuid not null, lease_until timestamptz not null,
 signed_transaction text, transaction_hash text, confirmed boolean not null default false,
 created_at timestamptz not null default clock_timestamp(), unique(sender,nonce)
);
create table app_private.reward_controller_transactions (sender text, nonce bigint, confirmed boolean);
create function app_private.require_reward_account(uuid,uuid) returns void language plpgsql as $$
begin
 if $1 is null or $2 is distinct from $1 then raise exception 'reward_account_session_required'; end if;
end $$;
-- Match the hosted generic function's restricted ACL before CREATE OR REPLACE.
create function public.service_reward_sponsor_auto_deployment(uuid,uuid,uuid,text,uuid,text,jsonb,text,text)
 returns jsonb language sql as $$select null::jsonb$$;
revoke all on function public.service_reward_sponsor_auto_deployment(uuid,uuid,uuid,text,uuid,text,jsonb,text,text)
 from public,anon,authenticated,service_role;

\ir ../supabase/migrations/20261006213948_reward_sponsor_creation_limit_ten.sql

create function pg_temp.must_fail(query text,expected text) returns void language plpgsql as $$
declare failed boolean:=false;
begin
 begin execute query; exception when others then
  if sqlerrm<>expected then raise exception 'Unexpected failure: %',sqlerrm; end if;
  failed:=true;
 end;
 if not failed then raise exception 'Expected failure missing: %',expected; end if;
end $$;

do $$
declare actor uuid:=gen_random_uuid(); other_actor uuid:=gen_random_uuid();
 setup_ids uuid[]:='{}'; setup uuid; lease uuid:=gen_random_uuid(); i integer; v jsonb; original jsonb;
 sender text:='0x'||repeat('8',40); rpc text;
 tx jsonb:='{"chainId":10143,"to":"0x4444444444444444444444444444444444444444","data":"0x6000","value":"0","nonce":"0","gas":"100","gasPrice":"1"}';
begin
 for i in 1..12 loop
  setup:=gen_random_uuid(); setup_ids:=array_append(setup_ids,setup);
  insert into app_private.reward_distribution_setups values(setup,case when i=12 then other_actor else actor end,10143,null);
  insert into app_private.reward_sponsor_executions values(setup,'{"funder":"0x1111111111111111111111111111111111111111"}',null);
 end loop;
 for i in 1..10 loop
  v:=public.service_reward_sponsor_auto_deployment(actor,actor,setup_ids[i],'reserve',lease,sender,tx);
  if v#>>'{transaction,nonce}'<>(i-1)::text then raise exception 'Reservation % did not preserve nonce order',i; end if;
  if i=1 then original:=v; end if;
 end loop;
 if (select count(*) from app_private.reward_sponsor_auto_deployments)<>10 then raise exception 'Ten reservations not allowed'; end if;
 rpc:=format('select public.service_reward_sponsor_auto_deployment(%L,%L,%L,%L,%L,%L,%L::jsonb)',actor,actor,setup_ids[11],'reserve',lease,sender,tx);
 perform pg_temp.must_fail(rpc,'sponsor_creation_capacity');
 perform pg_temp.must_fail(format('select public.service_reward_sponsor_auto_deployment(%L,%L,%L,%L,%L,%L,%L::jsonb)',other_actor,other_actor,setup_ids[12],'reserve',lease,sender,tx),'sponsor_creation_capacity');
 v:=public.service_reward_sponsor_auto_deployment(actor,actor,setup_ids[1],'reserve',lease,sender,tx);
 if v->'transaction'<>original->'transaction' or (select count(*) from app_private.reward_sponsor_auto_deployments)<>10 then raise exception 'Retry created a second request'; end if;
 -- Time passage frees a slot but the old nonce and reservation remain retained.
 update app_private.reward_sponsor_auto_deployments set created_at=clock_timestamp()-interval '25 hours' where setup_id=setup_ids[1];
 v:=public.service_reward_sponsor_auto_deployment(actor,actor,setup_ids[11],'reserve',lease,sender,tx);
 if v#>>'{transaction,nonce}'<>'10' or (select count(*) from app_private.reward_sponsor_auto_deployments)<>11 then raise exception 'Rolling window or retained nonce failed'; end if;
 perform pg_temp.must_fail(format('select public.service_reward_sponsor_auto_deployment(%L,%L,%L,%L,%L,%L,%L::jsonb)',other_actor,other_actor,setup_ids[12],'reserve',lease,sender,tx),'sponsor_creation_capacity');
 -- Fee rejection still precedes the capacity check.
 perform pg_temp.must_fail(format('select public.service_reward_sponsor_auto_deployment(%L,%L,%L,%L,%L,%L,%L::jsonb)',other_actor,other_actor,setup_ids[12],'reserve',lease,sender,jsonb_set(jsonb_set(tx,'{gas}','"30000000"'),'{gasPrice}','"100000000001"')),'invalid_sponsor_creation');
 if has_function_privilege('anon','public.service_reward_sponsor_auto_deployment(uuid,uuid,uuid,text,uuid,text,jsonb,text,text)','execute')
  or has_function_privilege('authenticated','public.service_reward_sponsor_auto_deployment(uuid,uuid,uuid,text,uuid,text,jsonb,text,text)','execute')
  or has_function_privilege('service_role','public.service_reward_sponsor_auto_deployment(uuid,uuid,uuid,text,uuid,text,jsonb,text,text)','execute')
  or (select prosecdef from pg_proc where oid='public.service_reward_sponsor_auto_deployment(uuid,uuid,uuid,text,uuid,text,jsonb,text,text)'::regprocedure)
 then raise exception 'Function permissions widened'; end if;
 if exists(select 1 from app_private.reward_sponsor_auto_deployments where signed_transaction is not null or transaction_hash is not null or confirmed)
 then raise exception 'Unexpected signed transaction'; end if;
end $$;
select 'PASS: ten reservations, eleventh denied, global cap, exact retry, rolling expiry, retained nonce, fee cap and unchanged ACL' as result;
