begin;

-- An explicit account choice, NOT an activated destination or payment consent.
-- Adulthood, wallet MFA/recovery, current identity and operator approval remain
-- separate gates. No amount, entitlement or chain authorization is changed here.
create table app_private.reward_athlete_destination_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid not null,
  athlete_profile_id uuid not null references public.athlete_profiles(id) on delete restrict,
  proof_id uuid not null unique references app_private.reward_wallet_proofs(id) on delete restrict,
  requested_at timestamptz not null default clock_timestamp(),
  idempotency_key text not null check(length(idempotency_key) between 8 and 128),
  unique(user_id,session_id,idempotency_key)
);
create index reward_athlete_destination_owner on app_private.reward_athlete_destination_requests(user_id,athlete_profile_id);
create table app_private.reward_athlete_destination_withdrawals (
  request_id uuid primary key references app_private.reward_athlete_destination_requests(id) on delete restrict,
  session_id uuid not null,
  withdrawn_at timestamptz not null default clock_timestamp()
);
do $$ declare name text; begin
  foreach name in array array['reward_athlete_destination_requests','reward_athlete_destination_withdrawals'] loop
    execute format('alter table app_private.%I enable row level security',name);
    execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',name);
    execute format('grant select,insert on app_private.%I to service_role',name);
    execute format('create policy %I on app_private.%I for select to service_role using(true)',name||'_service_select',name);
    execute format('create policy %I on app_private.%I for insert to service_role with check(true)',name||'_service_insert',name);
    execute format('create trigger reward_destination_immutable before update or delete on app_private.%I for each row execute function app_private.reject_reward_ledger_mutation()',name);
  end loop;
end $$;

create function app_private.reward_athlete_destination_document(r app_private.reward_athlete_destination_requests)
returns jsonb language sql volatile security invoker set search_path='' set timezone='UTC' as $$
  select jsonb_build_object('requestId',r.id,'userId',r.user_id,'sessionId',r.session_id,
    'athleteProfileId',r.athlete_profile_id,'proofId',r.proof_id,'address',c.address,'chainId',c.chain_id,
    'requestedAt',r.requested_at,'idempotencyKey',r.idempotency_key,'withdrawnAt',w.withdrawn_at,
    'status',case when w.request_id is not null then 'withdrawn'
      when not exists(select 1 from public.athlete_profiles a where a.id=r.athlete_profile_id
        and a.claimed_by_user_id=r.user_id and a.is_claimed and a.status='active'
        and a.merged_into_athlete_profile_id is null) then 'identity_hold'
      else 'pending_review' end)
  from app_private.reward_wallet_proofs p join app_private.reward_wallet_challenges c on c.id=p.challenge_id
  left join app_private.reward_athlete_destination_withdrawals w on w.request_id=r.id
  where p.id=r.proof_id;
$$;

create function public.service_request_reward_athlete_destination(p_user_id uuid,p_session_id uuid,p_athlete_profile_id uuid,p_proof_id uuid,p_idempotency_key text)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare r app_private.reward_athlete_destination_requests%rowtype; c app_private.reward_wallet_challenges%rowtype;
begin
  perform app_private.require_reward_account(p_user_id,p_session_id);
  -- Shared with wallet challenge/confirmation, never a lock across network I/O.
  perform pg_advisory_xact_lock(hashtextextended('reward-wallet-account:'||p_user_id::text,0));
  perform user_id from public.user_profiles where user_id=p_user_id for share;
  perform app_private.require_reward_account(p_user_id,p_session_id);
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
  perform app_private.require_reward_account(p_user_id,p_session_id);
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

create function public.service_read_reward_athlete_destination(p_user_id uuid,p_session_id uuid,p_request_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare r app_private.reward_athlete_destination_requests%rowtype;
begin
  perform app_private.require_reward_account(p_user_id,p_session_id);
  select * into r from app_private.reward_athlete_destination_requests where id=p_request_id and user_id=p_user_id;
  if not found then raise exception using errcode='42501',message='reward_destination_not_found'; end if;
  return app_private.reward_athlete_destination_document(r);
end $$;

create function public.service_withdraw_reward_athlete_destination(p_user_id uuid,p_session_id uuid,p_request_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare r app_private.reward_athlete_destination_requests%rowtype;
begin
  perform app_private.require_reward_account(p_user_id,p_session_id);
  perform pg_advisory_xact_lock(hashtextextended('reward-wallet-account:'||p_user_id::text,0));
  perform user_id from public.user_profiles where user_id=p_user_id for share;
  perform app_private.require_reward_account(p_user_id,p_session_id);
  select * into r from app_private.reward_athlete_destination_requests where id=p_request_id and user_id=p_user_id;
  if not found then raise exception using errcode='42501',message='reward_destination_not_found'; end if;
  -- Same account may withdraw from a new live session, even after a profile
  -- merge/transfer. The old address is never shown to that profile's new owner.
  insert into app_private.reward_athlete_destination_withdrawals(request_id,session_id)
    values(r.id,p_session_id) on conflict(request_id) do nothing;
  return app_private.reward_athlete_destination_document(r);
end $$;

revoke all on function app_private.reward_athlete_destination_document(app_private.reward_athlete_destination_requests),
  public.service_request_reward_athlete_destination(uuid,uuid,uuid,uuid,text),
  public.service_read_reward_athlete_destination(uuid,uuid,uuid),
  public.service_withdraw_reward_athlete_destination(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_athlete_destination_document(app_private.reward_athlete_destination_requests),
  public.service_request_reward_athlete_destination(uuid,uuid,uuid,uuid,text),
  public.service_read_reward_athlete_destination(uuid,uuid,uuid),
  public.service_withdraw_reward_athlete_destination(uuid,uuid,uuid) to service_role;
commit;
