begin;
-- Fixed hosted self-service wallet boundary. Existing proof/destination records
-- retain their immutable retry, freshness, rate and withdrawal semantics.
-- Personal wallet proof does not confer athlete ownership or payment consent.
create function app_private.require_reward_demo_web_wallet_account(p_user_id uuid,p_session_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare account jsonb;
begin
 perform user_id from app_private.reward_demo_copy_accounts where user_id=p_user_id for share;
 account:=app_private.reward_demo_web_session(p_user_id,p_session_id);
 if account->>'kind' in('athlete','sponsor') and account->>'batchSha256' is distinct from
  '073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644'
 then raise exception 'reward_account_session_required';end if;
 return account;
end $$;

-- Retained implementation from 20260909141644_reward_demo_wallet_origins.sql; bounded private transport only.
create function app_private.hosted_copy_service_create_reward_wallet_challenge(p_user_id uuid,p_session_id uuid,p_chain_id integer,p_address text,p_origin text,p_idempotency_key text)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c app_private.reward_wallet_challenges%rowtype; issued timestamptz;
begin
  perform app_private.require_reward_demo_web_wallet_account(p_user_id,p_session_id);
  perform pg_advisory_xact_lock(hashtextextended('reward-wallet-account:'||p_user_id::text,0));
  perform user_id from public.user_profiles where user_id=p_user_id for share;
  perform app_private.require_reward_demo_web_wallet_account(p_user_id,p_session_id);
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

-- Retained implementation from 20260908070450_reward_athlete_wallet_proofs.sql; bounded private transport only.
create function app_private.hosted_copy_service_read_reward_wallet_challenge(p_user_id uuid,p_session_id uuid,p_challenge_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c app_private.reward_wallet_challenges%rowtype;
begin
  perform app_private.require_reward_demo_web_wallet_account(p_user_id,p_session_id);
  select * into c from app_private.reward_wallet_challenges where id=p_challenge_id and user_id=p_user_id and session_id=p_session_id;
  if not found then raise exception using errcode='42501',message='reward_wallet_challenge_not_found'; end if;
  return app_private.reward_wallet_challenge_document(c);
end $$;

-- Retained implementation from 20260908070450_reward_athlete_wallet_proofs.sql; bounded private transport only.
create function app_private.hosted_copy_service_confirm_reward_wallet_proof(p_user_id uuid,p_session_id uuid,p_challenge_id uuid,p_message_hash text,p_signature text)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c app_private.reward_wallet_challenges%rowtype; proof app_private.reward_wallet_proofs%rowtype; confirmed_at timestamptz;
begin
  perform app_private.require_reward_demo_web_wallet_account(p_user_id,p_session_id);
  perform pg_advisory_xact_lock(hashtextextended('reward-wallet-account:'||p_user_id::text,0));
  perform user_id from public.user_profiles where user_id=p_user_id for share;
  perform app_private.require_reward_demo_web_wallet_account(p_user_id,p_session_id);
  select * into c from app_private.reward_wallet_challenges where id=p_challenge_id and user_id=p_user_id and session_id=p_session_id;
  if not found then raise exception using errcode='42501',message='reward_wallet_challenge_not_found'; end if;
  if p_message_hash is null or p_message_hash !~ '^0x[0-9a-f]{64}$' or p_message_hash='0x'||repeat('0',64)
    or p_signature is null or p_signature !~ '^0x[0-9a-f]{130}$' then
    raise exception using errcode='22023',message='invalid_reward_wallet_proof'; end if;
  select * into proof from app_private.reward_wallet_proofs where challenge_id=c.id;
  if found then
    if proof.message_hash<>decode(substr(p_message_hash,3),'hex') or proof.signature<>p_signature then
      raise exception using errcode='22023',message='reward_ledger_idempotency_conflict'; end if;
  else
    confirmed_at:=clock_timestamp();
    if confirmed_at<c.issued_at or confirmed_at>=c.expires_at then
      raise exception using errcode='22023',message='reward_wallet_challenge_expired'; end if;
    insert into app_private.reward_wallet_proofs(challenge_id,message_hash,signature,verified_at)
      values(c.id,decode(substr(p_message_hash,3),'hex'),p_signature,confirmed_at);
  end if;
  return app_private.reward_wallet_challenge_document(c);
end $$;

-- Retained implementation from 20260908083346_reward_athlete_destination_requests.sql; bounded private transport only.
create function app_private.hosted_copy_service_request_reward_athlete_destination(p_user_id uuid,p_session_id uuid,p_athlete_profile_id uuid,p_proof_id uuid,p_idempotency_key text)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare r app_private.reward_athlete_destination_requests%rowtype; c app_private.reward_wallet_challenges%rowtype;
begin
  perform app_private.require_reward_demo_web_wallet_account(p_user_id,p_session_id);
  -- Shared with wallet challenge/confirmation, never a lock across network I/O.
  perform pg_advisory_xact_lock(hashtextextended('reward-wallet-account:'||p_user_id::text,0));
  perform user_id from public.user_profiles where user_id=p_user_id for share;
  perform app_private.require_reward_demo_web_wallet_account(p_user_id,p_session_id);
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception using errcode='22023',message='invalid_reward_destination_request'; end if;
  select * into r from app_private.reward_athlete_destination_requests
    where user_id=p_user_id and session_id=p_session_id and idempotency_key=p_idempotency_key;
  if found then
    if (r.athlete_profile_id,r.proof_id) is distinct from (p_athlete_profile_id,p_proof_id) then
      raise exception using errcode='22023',message='reward_ledger_idempotency_conflict'; end if;
    -- Historical retry does not renew proof freshness or reverse withdrawal.
    return app_private.reward_athlete_destination_document(r);
  end if;
  perform id from public.athlete_profiles where id=p_athlete_profile_id for share;
  perform app_private.require_reward_demo_web_wallet_account(p_user_id,p_session_id);
  if not exists(select 1 from public.athlete_profiles where id=p_athlete_profile_id
    and claimed_by_user_id=p_user_id and is_claimed and status='active' and merged_into_athlete_profile_id is null) then
    raise exception using errcode='42501',message='reward_destination_profile_required'; end if;
  select ch.* into c from app_private.reward_wallet_challenges ch join app_private.reward_wallet_proofs pr on pr.challenge_id=ch.id
    where pr.id=p_proof_id and ch.user_id=p_user_id and ch.session_id=p_session_id;
  if not found then raise exception using errcode='42501',message='reward_destination_proof_required'; end if;
  if clock_timestamp()<c.issued_at or clock_timestamp()>=c.expires_at then
    raise exception using errcode='22023',message='reward_wallet_challenge_expired'; end if;
  if exists(select 1 from app_private.reward_athlete_destination_requests where proof_id=p_proof_id) then
    raise exception using errcode='22023',message='reward_ledger_idempotency_conflict'; end if;
  -- Explicit withdrawal before another selection. Never silently replace a
  -- destination whose future approval/claim may already be under review.
  if exists(select 1 from app_private.reward_athlete_destination_requests d
    join app_private.reward_wallet_proofs pr on pr.id=d.proof_id
    join app_private.reward_wallet_challenges ch on ch.id=pr.challenge_id
    where d.user_id=p_user_id and d.athlete_profile_id=p_athlete_profile_id and ch.chain_id=c.chain_id
      and not exists(select 1 from app_private.reward_athlete_destination_withdrawals w where w.request_id=d.id)) then
    raise exception using errcode='22023',message='reward_destination_withdraw_first'; end if;
  insert into app_private.reward_athlete_destination_requests(user_id,session_id,athlete_profile_id,proof_id,idempotency_key)
    values(p_user_id,p_session_id,p_athlete_profile_id,p_proof_id,p_idempotency_key) returning * into r;
  return app_private.reward_athlete_destination_document(r);
end $$;

-- Retained implementation from 20260908083346_reward_athlete_destination_requests.sql; bounded private transport only.
create function app_private.hosted_copy_service_read_reward_athlete_destination(p_user_id uuid,p_session_id uuid,p_request_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare r app_private.reward_athlete_destination_requests%rowtype;
begin
  perform app_private.require_reward_demo_web_wallet_account(p_user_id,p_session_id);
  select * into r from app_private.reward_athlete_destination_requests where id=p_request_id and user_id=p_user_id;
  if not found then raise exception using errcode='42501',message='reward_destination_not_found'; end if;
  return app_private.reward_athlete_destination_document(r);
end $$;

-- Retained implementation from 20260908083346_reward_athlete_destination_requests.sql; bounded private transport only.
create function app_private.hosted_copy_service_withdraw_reward_athlete_destination(p_user_id uuid,p_session_id uuid,p_request_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare r app_private.reward_athlete_destination_requests%rowtype;
begin
  perform app_private.require_reward_demo_web_wallet_account(p_user_id,p_session_id);
  perform pg_advisory_xact_lock(hashtextextended('reward-wallet-account:'||p_user_id::text,0));
  perform user_id from public.user_profiles where user_id=p_user_id for share;
  perform app_private.require_reward_demo_web_wallet_account(p_user_id,p_session_id);
  select * into r from app_private.reward_athlete_destination_requests where id=p_request_id and user_id=p_user_id;
  if not found then raise exception using errcode='42501',message='reward_destination_not_found'; end if;
  -- Same account may withdraw from a new live session, even after a profile
  -- merge/transfer. The old address is never shown to that profile's new owner.
  insert into app_private.reward_athlete_destination_withdrawals(request_id,session_id)
    values(r.id,p_session_id) on conflict(request_id) do nothing;
  return app_private.reward_athlete_destination_document(r);
end $$;

-- Retained implementation from 20260908084842_reward_athlete_destination_history.sql; bounded private transport only.
create function app_private.hosted_copy_service_list_reward_athlete_destinations(p_user_id uuid,p_session_id uuid,p_after_id uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare items jsonb;
begin
  perform app_private.require_reward_demo_web_wallet_account(p_user_id,p_session_id);
  select coalesce(jsonb_agg(body order by id),'[]'::jsonb) into items from (
    select d.id,app_private.reward_athlete_destination_document(d) body
    from app_private.reward_athlete_destination_requests d
    join app_private.reward_wallet_proofs proof on proof.id=d.proof_id
    join app_private.reward_wallet_challenges challenge on challenge.id=proof.challenge_id
    where challenge.chain_id=10143 and challenge.origin='https://podium.raceson.com' and d.user_id=p_user_id and (p_after_id is null or d.id>p_after_id)
    order by d.id limit 51
  ) page;
  return jsonb_build_object('items',case when jsonb_array_length(items)>50 then items-50 else items end,
    'nextCursor',case when jsonb_array_length(items)>50 then items->49->>'requestId' else null end);
end $$;

create function public.service_reward_demo_copy_beneficiary_wallet(p_user_id uuid,p_session_id uuid,p_action text,p_input jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare account jsonb; result jsonb; challenge jsonb; required text[]; field text;
begin
 account:=app_private.require_reward_demo_web_wallet_account(p_user_id,p_session_id);
 required:=case p_action
  when 'challenge' then array['p_chain_id','p_address','p_origin','p_idempotency_key']
  when 'readChallenge' then array['p_challenge_id']
  when 'proof' then array['p_challenge_id','p_message_hash','p_signature']
  when 'destination' then array['p_athlete_profile_id','p_proof_id','p_idempotency_key']
  when 'readDestination' then array['p_request_id']
  when 'listDestinations' then array['p_after_id']
  when 'withdraw' then array['p_request_id'] end;
 if required is null or p_input is null or jsonb_typeof(p_input) is distinct from 'object'
  or not(p_input ?& required) or (select count(*) from jsonb_object_keys(p_input))<>cardinality(required)
  or octet_length(p_input::text)>2048 then raise exception 'invalid_reward_wallet_request';end if;
 foreach field in array required loop
  if field='p_chain_id' then
   if p_input->field is distinct from '10143'::jsonb then raise exception 'invalid_reward_wallet_request';end if;
  elsif field='p_after_id' and p_input->field='null'::jsonb then null;
  elsif jsonb_typeof(p_input->field) is distinct from 'string' then raise exception 'invalid_reward_wallet_request';end if;
  if field in('p_challenge_id','p_athlete_profile_id','p_proof_id','p_request_id','p_after_id') and p_input->field<>'null'::jsonb
   and (coalesce(p_input->>field,'') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_input->>field='00000000-0000-0000-0000-000000000000') then raise exception 'invalid_reward_wallet_request';end if;
 end loop;
 if p_action in('readChallenge','proof') then
  challenge:=app_private.hosted_copy_service_read_reward_wallet_challenge(p_user_id,p_session_id,(p_input->>'p_challenge_id')::uuid);
  if challenge->'chainId' is distinct from '10143'::jsonb or challenge->>'origin' is distinct from 'https://podium.raceson.com'
   then raise exception 'reward_wallet_challenge_not_found';end if;
 end if;
 if p_action in('readDestination','withdraw') and not exists(
  select 1 from app_private.reward_athlete_destination_requests d
  join app_private.reward_wallet_proofs proof on proof.id=d.proof_id
  join app_private.reward_wallet_challenges ch on ch.id=proof.challenge_id
  where d.id=(p_input->>'p_request_id')::uuid and d.user_id=p_user_id and ch.chain_id=10143 and ch.origin='https://podium.raceson.com')
  then raise exception 'reward_destination_not_found';end if;
 if p_action='challenge' then
  if p_input->>'p_origin' is distinct from 'https://podium.raceson.com' then raise exception 'invalid_reward_wallet_request';end if;
  result:=app_private.hosted_copy_service_create_reward_wallet_challenge(p_user_id,p_session_id,10143,p_input->>'p_address','https://podium.raceson.com',p_input->>'p_idempotency_key');
 elsif p_action='readChallenge' then result:=challenge;
 elsif p_action='proof' then
  result:=app_private.hosted_copy_service_confirm_reward_wallet_proof(p_user_id,p_session_id,(p_input->>'p_challenge_id')::uuid,p_input->>'p_message_hash',p_input->>'p_signature');
 elsif p_action='destination' then
  -- Only an operator-provisioned copied alias may choose its own destination.
  -- Existing SQL independently checks current claimed profile ownership.
  if account->>'kind' is distinct from 'athlete' or account->>'athleteId' is distinct from p_input->>'p_athlete_profile_id'
   then raise exception 'reward_destination_profile_required';end if;
  if not exists(select 1 from app_private.reward_wallet_proofs proof
   join app_private.reward_wallet_challenges ch on ch.id=proof.challenge_id
   where proof.id=(p_input->>'p_proof_id')::uuid and ch.user_id=p_user_id and ch.session_id=p_session_id
    and ch.chain_id=10143 and ch.origin='https://podium.raceson.com') then raise exception 'reward_destination_proof_required';end if;
  result:=app_private.hosted_copy_service_request_reward_athlete_destination(p_user_id,p_session_id,(p_input->>'p_athlete_profile_id')::uuid,(p_input->>'p_proof_id')::uuid,p_input->>'p_idempotency_key');
 elsif p_action='readDestination' then
  result:=app_private.hosted_copy_service_read_reward_athlete_destination(p_user_id,p_session_id,(p_input->>'p_request_id')::uuid);
 elsif p_action='withdraw' then
  result:=app_private.hosted_copy_service_withdraw_reward_athlete_destination(p_user_id,p_session_id,(p_input->>'p_request_id')::uuid);
 elsif p_action='listDestinations' then
  result:=app_private.hosted_copy_service_list_reward_athlete_destinations(p_user_id,p_session_id,(p_input->>'p_after_id')::uuid);
 end if;
 perform app_private.require_reward_demo_web_wallet_account(p_user_id,p_session_id);
 return result;
end $$;
revoke all on function app_private.require_reward_demo_web_wallet_account(uuid,uuid),
 app_private.hosted_copy_service_create_reward_wallet_challenge(uuid,uuid,integer,text,text,text),
 app_private.hosted_copy_service_read_reward_wallet_challenge(uuid,uuid,uuid),
 app_private.hosted_copy_service_confirm_reward_wallet_proof(uuid,uuid,uuid,text,text),
 app_private.hosted_copy_service_request_reward_athlete_destination(uuid,uuid,uuid,uuid,text),
 app_private.hosted_copy_service_read_reward_athlete_destination(uuid,uuid,uuid),
 app_private.hosted_copy_service_withdraw_reward_athlete_destination(uuid,uuid,uuid),
 app_private.hosted_copy_service_list_reward_athlete_destinations(uuid,uuid,uuid),
 public.service_reward_demo_copy_beneficiary_wallet(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_demo_copy_beneficiary_wallet(uuid,uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
