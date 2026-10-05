begin;

-- Origin shape is defense in depth, not provider/hosting approval. The API
-- supplies its exact validated demo configuration; never trust a browser host.
create function app_private.reward_demo_wallet_origin_allowed(p_origin text,p_chain_id integer)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare host text; label text; port text;
begin
  if p_origin is null or length(p_origin)>100 or p_chain_id is null or p_chain_id not in (31337,10143) then return false; end if;
  if p_origin ~ '^http://(127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$' then
    port:=split_part(p_origin,':',3); return port::integer between 1 and 65535 and port::integer<>80;
  end if;
  if p_chain_id<>10143 or p_origin !~ '^https://[a-z0-9.-]+$' then return false; end if;
  host:=substr(p_origin,9);
  if length(host)>253 or position('.' in host)=0 or host ~ '^[0-9.]+$'
    or host like '%.supabase.co' or host=any(array['raceson.com','www.raceson.com','staging.raceson.com',
      'raceson-staging.vercel.app','sitrail.com','www.sitrail.com','sibenik.trail']) then return false; end if;
  foreach label in array string_to_array(host,'.') loop
    if length(label)>63 or label !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function app_private.reward_demo_wallet_origin_allowed(text,integer) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_demo_wallet_origin_allowed(text,integer) to service_role;

-- Immutable historical www proofs remain readable/verifiable; they are not
-- permission to issue a new production-bound proof or to move a demo to www.
do $$ declare item record; found_count integer:=0;
begin
  for item in select conname from pg_constraint where conrelid='app_private.reward_wallet_challenges'::regclass
    and contype='c' and pg_get_constraintdef(oid) like '%origin%' loop
    found_count:=found_count+1;
    execute format('alter table app_private.reward_wallet_challenges drop constraint %I',item.conname);
  end loop;
  if found_count<>1 then raise exception 'Unexpected reward wallet origin constraints'; end if;
end $$;
alter table app_private.reward_wallet_challenges add constraint reward_wallet_challenges_origin_v2_check check (
  app_private.reward_demo_wallet_origin_allowed(origin,chain_id)
  or (chain_id=10143 and origin='https://www.raceson.com')
);

-- The compatibility exception above preserves old rows only. Even a direct
-- service-role insert may not create a new production-bound challenge.
create function app_private.require_new_reward_demo_wallet_origin()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if not app_private.reward_demo_wallet_origin_allowed(new.origin,new.chain_id) then
    raise exception using errcode='22023',message='invalid_reward_wallet_request';
  end if;
  return new;
end $$;
revoke all on function app_private.require_new_reward_demo_wallet_origin() from public,anon,authenticated,service_role;
grant execute on function app_private.require_new_reward_demo_wallet_origin() to service_role;
create trigger reward_wallet_challenge_demo_origin before insert on app_private.reward_wallet_challenges
for each row execute function app_private.require_new_reward_demo_wallet_origin();

create or replace function public.service_create_reward_wallet_challenge(p_user_id uuid,p_session_id uuid,p_chain_id integer,p_address text,p_origin text,p_idempotency_key text)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c app_private.reward_wallet_challenges%rowtype; issued timestamptz;
begin
  perform app_private.require_reward_account(p_user_id,p_session_id);
  perform pg_advisory_xact_lock(hashtextextended('reward-wallet-account:'||p_user_id::text,0));
  perform user_id from public.user_profiles where user_id=p_user_id for share;
  perform app_private.require_reward_account(p_user_id,p_session_id);
  if p_chain_id is null or p_chain_id not in (10143,31337) or p_address is null or p_address !~ '^0x[0-9a-f]{40}$'
    or p_address='0x'||repeat('0',40) or p_origin is null
    or not app_private.reward_demo_wallet_origin_allowed(p_origin,p_chain_id)
    or p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception using errcode='22023',message='invalid_reward_wallet_request';
  end if;
  select * into c from app_private.reward_wallet_challenges where user_id=p_user_id and session_id=p_session_id and idempotency_key=p_idempotency_key;
  if found then
    if (c.chain_id,c.address,c.origin) is distinct from (p_chain_id,p_address,p_origin) then
      raise exception using errcode='22023',message='reward_ledger_idempotency_conflict'; end if;
  else
    if (select count(*) from app_private.reward_wallet_challenges where user_id=p_user_id and issued_at>clock_timestamp()-interval '1 minute')>=10 then
      raise exception using errcode='54000',message='reward_wallet_rate_limited'; end if;
    issued:=date_trunc('second',clock_timestamp());
    insert into app_private.reward_wallet_challenges(user_id,session_id,chain_id,address,origin,issued_at,expires_at,idempotency_key)
      values(p_user_id,p_session_id,p_chain_id,p_address,p_origin,issued,issued+interval '10 minutes',p_idempotency_key) returning * into c;
  end if;
  return app_private.reward_wallet_challenge_document(c);
end $$;


revoke all on function public.service_create_reward_wallet_challenge(uuid,uuid,integer,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.service_create_reward_wallet_challenge(uuid,uuid,integer,text,text,text) to service_role;
commit;
