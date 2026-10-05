begin;

-- Preserve the existing service-only Auth bridge and its grant boundary. Its
-- previous now() used transaction-start time even after a lock wait. Sensitive
-- reward writes must reject sessions that expire while waiting. The additional
-- anonymous flag is authoritative Auth data, never user_metadata.
create or replace function public.service_request_auth_user(target_user_id uuid,target_session_id uuid)
returns jsonb language sql volatile security definer set search_path='' as $$
  select jsonb_build_object('email',u.email,'email_confirmed_at',u.email_confirmed_at,
    'raw_app_meta_data',u.raw_app_meta_data,'raw_user_meta_data',u.raw_user_meta_data,'is_anonymous',u.is_anonymous)
  from auth.users u join auth.sessions s on s.user_id=u.id and s.id=target_session_id
  where u.id=target_user_id and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=clock_timestamp())
    and (s.not_after is null or s.not_after>clock_timestamp()) limit 1;
$$;
revoke all on function public.service_request_auth_user(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_request_auth_user(uuid,uuid) to service_role;

-- This proves control of an address for one existing account/session. It does
-- not claim athlete identity, verify age/MFA, choose a payout or authorize funds.
create table app_private.reward_wallet_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid not null,
  chain_id integer not null check (chain_id in (10143,31337)),
  address text not null check (address ~ '^0x[0-9a-f]{40}$' and address <> '0x'||repeat('0',40)),
  origin text not null,
  nonce text not null default encode(public.gen_random_bytes(32),'hex') unique check (nonce ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz not null default date_trunc('second',clock_timestamp()),
  expires_at timestamptz not null,
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  unique (user_id,session_id,idempotency_key),
  check (expires_at=issued_at+interval '10 minutes'),
  check ((chain_id=10143 and origin='https://www.raceson.com') or
    (chain_id=31337 and origin ~ '^http://(127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$'))
);
create index reward_wallet_challenge_rate on app_private.reward_wallet_challenges(user_id,issued_at);
create table app_private.reward_wallet_proofs (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null unique references app_private.reward_wallet_challenges(id) on delete restrict,
  message_hash app_private.reward_bytes32 not null,
  signature text not null check (signature ~ '^0x[0-9a-f]{130}$'),
  verified_at timestamptz not null default clock_timestamp()
);
do $$ declare name text; begin
  foreach name in array array['reward_wallet_challenges','reward_wallet_proofs'] loop
    execute format('alter table app_private.%I enable row level security',name);
    execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',name);
    execute format('grant select,insert on app_private.%I to service_role',name);
    execute format('create policy %I on app_private.%I for select to service_role using(true)',name||'_service_select',name);
    execute format('create policy %I on app_private.%I for insert to service_role with check(true)',name||'_service_insert',name);
    execute format('create trigger reward_wallet_immutable before update or delete on app_private.%I for each row execute function app_private.reject_reward_ledger_mutation()',name);
  end loop;
end $$;

create function app_private.require_reward_account(p_user_id uuid,p_session_id uuid)
returns void language plpgsql volatile security invoker set search_path='' as $$
declare actor jsonb;
begin
  actor:=public.service_request_auth_user(p_user_id,p_session_id);
  if p_user_id is null or p_session_id is null
    or actor is null or actor->>'is_anonymous' is distinct from 'false'
    or not exists(select 1 from public.user_profiles where user_id=p_user_id and status='active') then
    raise exception using errcode='42501',message='reward_account_session_required';
  end if;
end $$;

create function app_private.reward_wallet_challenge_document(c app_private.reward_wallet_challenges)
returns jsonb language sql stable security invoker set search_path='' set timezone='UTC' as $$
  select jsonb_build_object('challengeId',c.id,'userId',c.user_id,'sessionId',c.session_id,'chainId',c.chain_id,
    'address',c.address,'origin',c.origin,'nonce',c.nonce,'issuedAt',c.issued_at,'expiresAt',c.expires_at,
    'idempotencyKey',c.idempotency_key,'checkedAt',clock_timestamp(),'proof',
    (select jsonb_build_object('proofId',p.id,'messageHash','0x'||encode(p.message_hash,'hex'),
      'signature',p.signature,'verifiedAt',p.verified_at) from app_private.reward_wallet_proofs p where p.challenge_id=c.id));
$$;

create function public.service_create_reward_wallet_challenge(p_user_id uuid,p_session_id uuid,p_chain_id integer,p_address text,p_origin text,p_idempotency_key text)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c app_private.reward_wallet_challenges%rowtype; issued timestamptz;
begin
  perform app_private.require_reward_account(p_user_id,p_session_id);
  perform pg_advisory_xact_lock(hashtextextended('reward-wallet-account:'||p_user_id::text,0));
  perform user_id from public.user_profiles where user_id=p_user_id for share;
  perform app_private.require_reward_account(p_user_id,p_session_id);
  if p_chain_id is null or p_chain_id not in (10143,31337) or p_address is null or p_address !~ '^0x[0-9a-f]{40}$'
    or p_address='0x'||repeat('0',40) or p_origin is null
    or not ((p_chain_id=10143 and p_origin='https://www.raceson.com') or
      (p_chain_id=31337 and p_origin ~ '^http://(127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$'
        and split_part(p_origin,':',3)::integer between 1 and 65535))
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

create function public.service_read_reward_wallet_challenge(p_user_id uuid,p_session_id uuid,p_challenge_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c app_private.reward_wallet_challenges%rowtype;
begin
  perform app_private.require_reward_account(p_user_id,p_session_id);
  select * into c from app_private.reward_wallet_challenges where id=p_challenge_id and user_id=p_user_id and session_id=p_session_id;
  if not found then raise exception using errcode='42501',message='reward_wallet_challenge_not_found'; end if;
  return app_private.reward_wallet_challenge_document(c);
end $$;

-- Trusted service verifies the exact reconstructed SIWE/EIP-191 signature.
-- SQL consumes once and checks live account/session again after waiting.
create function public.service_confirm_reward_wallet_proof(p_user_id uuid,p_session_id uuid,p_challenge_id uuid,p_message_hash text,p_signature text)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c app_private.reward_wallet_challenges%rowtype; proof app_private.reward_wallet_proofs%rowtype; confirmed_at timestamptz;
begin
  perform app_private.require_reward_account(p_user_id,p_session_id);
  perform pg_advisory_xact_lock(hashtextextended('reward-wallet-account:'||p_user_id::text,0));
  perform user_id from public.user_profiles where user_id=p_user_id for share;
  perform app_private.require_reward_account(p_user_id,p_session_id);
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

-- Private self-service projection. Existing reviewed profile ownership is the
-- only identity grant. Merge history can reveal one's awards but never clears a
-- payout hold. No emails, dates of birth, sporting source rows or salts returned.
create function public.service_read_own_reward_awards(p_user_id uuid,p_session_id uuid,p_after_id uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare items jsonb;
begin
  perform app_private.require_reward_account(p_user_id,p_session_id);
  with recursive owned as (
    select id,date_of_birth,birth_year from public.athlete_profiles where claimed_by_user_id=p_user_id
      and is_claimed and status='active' and merged_into_athlete_profile_id is null
  ), aliases(root_id,id) as (
    select id,id from owned union
    select a.root_id,p.id from aliases a join public.athlete_profiles p on p.merged_into_athlete_profile_id=a.id
  ), selected as (
    select e.id,jsonb_build_object('entitlementId',e.id,'campaignId',c.id,'pot',c.pot,'scopeKey',c.scope_key,
      'chainId',p.chain_id,'environment',p.environment,'athleteProfileId',o.id,'identityChanged',b.entity_id<>o.id,
      'amountWei',e.amount_wei::text,'ageStatus',case
        when o.date_of_birth is null or o.date_of_birth>current_date or
          (o.birth_year is not null and o.birth_year<>extract(year from o.date_of_birth)::integer) then 'unknown'
        when o.date_of_birth>(current_date-interval '18 years')::date then 'minor' else 'unverified_adult' end) body
    from owned o join aliases a on a.root_id=o.id
    join app_private.reward_beneficiaries b on b.kind='athlete' and b.entity_id=a.id
    join app_private.reward_entitlements e on e.beneficiary_id=b.id
    join app_private.reward_campaigns c on c.id=b.campaign_id
    join app_private.reward_programmes p on p.id=c.programme_id
    where p_after_id is null or e.id>p_after_id order by e.id limit 51
  ) select coalesce(jsonb_agg(body order by id),'[]'::jsonb) into items from selected;
  return jsonb_build_object('items',case when jsonb_array_length(items)>50 then items-50 else items end,
    'nextCursor',case when jsonb_array_length(items)>50 then items->49->>'entitlementId' else null end);
end $$;

revoke all on function app_private.require_reward_account(uuid,uuid),
  app_private.reward_wallet_challenge_document(app_private.reward_wallet_challenges),
  public.service_create_reward_wallet_challenge(uuid,uuid,integer,text,text,text),
  public.service_read_reward_wallet_challenge(uuid,uuid,uuid),
  public.service_confirm_reward_wallet_proof(uuid,uuid,uuid,text,text),
  public.service_read_own_reward_awards(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.require_reward_account(uuid,uuid),
  app_private.reward_wallet_challenge_document(app_private.reward_wallet_challenges),
  public.service_create_reward_wallet_challenge(uuid,uuid,integer,text,text,text),
  public.service_read_reward_wallet_challenge(uuid,uuid,uuid),
  public.service_confirm_reward_wallet_proof(uuid,uuid,uuid,text,text),
  public.service_read_own_reward_awards(uuid,uuid,uuid) to service_role;
commit;
