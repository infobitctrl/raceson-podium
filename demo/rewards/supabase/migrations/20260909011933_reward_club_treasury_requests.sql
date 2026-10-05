begin;

-- Nomination only. Browser addresses are unverified candidates, not approved
-- Safe expectations, control proofs, payment destinations or chain observations.
create function app_private.valid_reward_club_candidate(c jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare a text; owners text[];
begin
  if jsonb_typeof(c) is distinct from 'object' then return false; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(c) k)
    is distinct from array['fallbackHandlerAddress','owners','safeAddress','singletonAddress']::text[] then return false; end if;
  foreach a in array array[c->>'safeAddress',c->>'singletonAddress',c->>'fallbackHandlerAddress'] loop
    if (a ~ '^0x[0-9a-f]{40}$' and a<>'0x'||repeat('0',40) and a<>'0x'||repeat('0',39)||'1') is not true then return false; end if;
  end loop;
  if c->>'safeAddress'=c->>'singletonAddress' or c->>'safeAddress'=c->>'fallbackHandlerAddress'
    or c->>'singletonAddress'=c->>'fallbackHandlerAddress' then return false; end if;
  if jsonb_typeof(c->'owners') is distinct from 'array' then return false; end if;
  if jsonb_array_length(c->'owners')<>3 then return false; end if;
  if exists(select 1 from jsonb_array_elements(c->'owners') v where jsonb_typeof(v)<>'string') then return false; end if;
  select array_agg(v order by ord) into owners from jsonb_array_elements_text(c->'owners') with ordinality o(v,ord);
  foreach a in array owners loop
    if (a ~ '^0x[0-9a-f]{40}$' and a<>'0x'||repeat('0',40) and a<>'0x'||repeat('0',39)||'1'
      and a<>c->>'safeAddress') is not true then return false; end if;
  end loop;
  return owners[1]<owners[2] and owners[2]<owners[3];
end $$;

-- Existing active club ownership, not creator provenance, public title,
-- organization permission or a platform support override. Versions fence ABA
-- changes; even a benign identity edit requires a new review/nomination.
create function app_private.reward_club_owner_identity(p_club_id uuid,p_user_id uuid)
returns jsonb language sql volatile security invoker set search_path='' set timezone='UTC' as $$
  select jsonb_build_object('clubId',c.id,'clubVersion',c.updated_at,
    'athleteProfileId',a.id,'profileVersion',a.updated_at,
    'membershipId',m.id,'membershipVersion',m.updated_at,'roleId',r.id,'roleVersion',r.updated_at)
  from public.clubs c
  join public.club_memberships m on m.club_id=c.id and m.status='active'
  join public.club_roles r on r.club_id=c.id and r.id=m.club_role_id and r.is_owner and r.is_system and r.status='active'
  join public.athlete_profiles a on a.id=m.athlete_profile_id
  where c.id=p_club_id and c.status='active' and c.merged_into_club_id is null
    and a.claimed_by_user_id=p_user_id and a.is_claimed and a.status='active' and a.merged_into_athlete_profile_id is null
    and (select count(*) from public.club_memberships cm join public.club_roles cr on cr.id=cm.club_role_id and cr.club_id=cm.club_id
      where cm.club_id=c.id and cm.status='active' and cr.is_owner and cr.status='active')=1;
$$;

create table app_private.reward_club_treasury_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid not null,
  club_id uuid not null references public.clubs(id) on delete restrict,
  chain_id integer not null check(chain_id in (31337,10143)),
  candidate jsonb not null check(app_private.valid_reward_club_candidate(candidate)),
  owner_identity jsonb not null check(jsonb_typeof(owner_identity)='object'),
  requested_at timestamptz not null default clock_timestamp(),
  idempotency_key text not null check(length(idempotency_key) between 8 and 128),
  unique(user_id,chain_id,idempotency_key)
);
create index reward_club_treasury_history on app_private.reward_club_treasury_requests(user_id,chain_id,id);
create index reward_club_treasury_scope on app_private.reward_club_treasury_requests(club_id,chain_id);
create table app_private.reward_club_treasury_withdrawals (
  request_id uuid primary key references app_private.reward_club_treasury_requests(id) on delete restrict,
  session_id uuid not null,
  withdrawn_at timestamptz not null default clock_timestamp()
);
do $$ declare name text; begin
  foreach name in array array['reward_club_treasury_requests','reward_club_treasury_withdrawals'] loop
    execute format('alter table app_private.%I enable row level security',name);
    execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',name);
    execute format('grant select,insert on app_private.%I to service_role',name);
    execute format('create policy %I on app_private.%I for select to service_role using(true)',name||'_service_select',name);
    execute format('create policy %I on app_private.%I for insert to service_role with check(true)',name||'_service_insert',name);
    execute format('create trigger reward_club_treasury_immutable before update or delete on app_private.%I for each row execute function app_private.reject_reward_ledger_mutation()',name);
  end loop;
end $$;

create function app_private.reward_club_treasury_document(r app_private.reward_club_treasury_requests)
returns jsonb language sql volatile security invoker set search_path='' set timezone='UTC' as $$
  select jsonb_build_object('requestId',r.id,'userId',r.user_id,'sessionId',r.session_id,
    'clubId',r.club_id,'chainId',r.chain_id,'candidate',r.candidate,
    'requestedAt',r.requested_at,'idempotencyKey',r.idempotency_key,'withdrawnAt',w.withdrawn_at,
    'status',case when w.request_id is not null then 'withdrawn'
      when app_private.reward_club_owner_identity(r.club_id,r.user_id) is distinct from r.owner_identity then 'identity_hold'
      else 'pending_review' end)
  from (values(1)) as one(n) left join app_private.reward_club_treasury_withdrawals w on w.request_id=r.id;
$$;

create function public.service_request_reward_club_treasury(p_user_id uuid,p_session_id uuid,p_club_id uuid,p_chain_id integer,p_candidate jsonb,p_idempotency_key text)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare r app_private.reward_club_treasury_requests%rowtype; identity_now jsonb; body jsonb;
begin
  perform app_private.require_reward_account(p_user_id,p_session_id);
  if p_club_id is null or p_chain_id is null or p_chain_id not in(31337,10143)
    or not app_private.valid_reward_club_candidate(p_candidate)
    or p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception using errcode='22023',message='invalid_reward_club_treasury_request'; end if;
  -- Serialize retry keys across clubs, then choices across owners. No locks
  -- span wallet/network work; this path never calls a chain or authenticates keys.
  perform pg_advisory_xact_lock(hashtextextended('reward-club-account:'||p_user_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('reward-club-treasury:'||p_club_id::text||':'||p_chain_id::text,0));
  perform user_id from public.user_profiles where user_id=p_user_id for share;
  perform app_private.require_reward_account(p_user_id,p_session_id);
  select * into r from app_private.reward_club_treasury_requests
    where user_id=p_user_id and chain_id=p_chain_id and idempotency_key=p_idempotency_key;
  if found then
    if r.club_id is distinct from p_club_id or r.candidate is distinct from p_candidate then
      raise exception using errcode='22023',message='reward_ledger_idempotency_conflict'; end if;
    body:=app_private.reward_club_treasury_document(r);
    perform app_private.require_reward_account(p_user_id,p_session_id);
    return body; -- Exact history, even after ownership loss; never refreshed.
  end if;
  perform id from public.clubs where id=p_club_id for share;
  perform id from public.athlete_profiles where claimed_by_user_id=p_user_id order by id for share;
  perform id from public.club_memberships where club_id=p_club_id order by id for share;
  perform id from public.club_roles where club_id=p_club_id order by id for share;
  perform app_private.require_reward_account(p_user_id,p_session_id);
  identity_now:=app_private.reward_club_owner_identity(p_club_id,p_user_id);
  if identity_now is null then raise exception using errcode='42501',message='reward_club_owner_required'; end if;
  if exists(select 1 from app_private.reward_club_treasury_requests old
    where old.club_id=p_club_id and old.chain_id=p_chain_id and old.owner_identity=identity_now
      and not exists(select 1 from app_private.reward_club_treasury_withdrawals w where w.request_id=old.id)) then
    raise exception using errcode='22023',message='reward_club_treasury_withdraw_first'; end if;
  insert into app_private.reward_club_treasury_requests(user_id,session_id,club_id,chain_id,candidate,owner_identity,idempotency_key)
    values(p_user_id,p_session_id,p_club_id,p_chain_id,p_candidate,identity_now,p_idempotency_key) returning * into r;
  body:=app_private.reward_club_treasury_document(r);
  perform app_private.require_reward_account(p_user_id,p_session_id);
  if app_private.reward_club_owner_identity(p_club_id,p_user_id) is distinct from identity_now then
    raise exception using errcode='42501',message='reward_club_owner_required'; end if;
  return body;
end $$;

create function public.service_read_reward_club_treasury(p_user_id uuid,p_session_id uuid,p_chain_id integer,p_request_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare r app_private.reward_club_treasury_requests%rowtype; body jsonb;
begin
  perform app_private.require_reward_account(p_user_id,p_session_id);
  select * into r from app_private.reward_club_treasury_requests where id=p_request_id and user_id=p_user_id and chain_id=p_chain_id;
  if not found then raise exception using errcode='42501',message='reward_club_treasury_not_found'; end if;
  body:=app_private.reward_club_treasury_document(r);
  perform app_private.require_reward_account(p_user_id,p_session_id);
  return body;
end $$;

create function public.service_list_reward_club_treasuries(p_user_id uuid,p_session_id uuid,p_chain_id integer,p_after_id uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare items jsonb;
begin
  perform app_private.require_reward_account(p_user_id,p_session_id);
  if p_chain_id is null or p_chain_id not in(31337,10143) then
    raise exception using errcode='22023',message='invalid_reward_club_treasury_request'; end if;
  select coalesce(jsonb_agg(body order by id),'[]'::jsonb) into items from (
    select r.id,app_private.reward_club_treasury_document(r) body from app_private.reward_club_treasury_requests r
    where r.user_id=p_user_id and r.chain_id=p_chain_id and (p_after_id is null or r.id>p_after_id)
    order by r.id limit 26
  ) page;
  perform app_private.require_reward_account(p_user_id,p_session_id);
  return jsonb_build_object('items',case when jsonb_array_length(items)>25 then items-25 else items end,
    'nextCursor',case when jsonb_array_length(items)>25 then items->24->>'requestId' else null end);
end $$;

create function public.service_withdraw_reward_club_treasury(p_user_id uuid,p_session_id uuid,p_chain_id integer,p_request_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare r app_private.reward_club_treasury_requests%rowtype; body jsonb;
begin
  perform app_private.require_reward_account(p_user_id,p_session_id);
  perform pg_advisory_xact_lock(hashtextextended('reward-club-account:'||p_user_id::text,0));
  select * into r from app_private.reward_club_treasury_requests where id=p_request_id and user_id=p_user_id and chain_id=p_chain_id;
  if not found then raise exception using errcode='42501',message='reward_club_treasury_not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('reward-club-treasury:'||r.club_id::text||':'||r.chain_id::text,0));
  perform app_private.require_reward_account(p_user_id,p_session_id);
  insert into app_private.reward_club_treasury_withdrawals(request_id,session_id)
    values(r.id,p_session_id) on conflict(request_id) do nothing;
  body:=app_private.reward_club_treasury_document(r);
  perform app_private.require_reward_account(p_user_id,p_session_id);
  return body; -- New live session allowed; withdrawal does not revoke chain bytes.
end $$;

revoke all on function app_private.valid_reward_club_candidate(jsonb),app_private.reward_club_owner_identity(uuid,uuid),
  app_private.reward_club_treasury_document(app_private.reward_club_treasury_requests),
  public.service_request_reward_club_treasury(uuid,uuid,uuid,integer,jsonb,text),
  public.service_read_reward_club_treasury(uuid,uuid,integer,uuid),
  public.service_list_reward_club_treasuries(uuid,uuid,integer,uuid),
  public.service_withdraw_reward_club_treasury(uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.valid_reward_club_candidate(jsonb),app_private.reward_club_owner_identity(uuid,uuid),
  app_private.reward_club_treasury_document(app_private.reward_club_treasury_requests),
  public.service_request_reward_club_treasury(uuid,uuid,uuid,integer,jsonb,text),
  public.service_read_reward_club_treasury(uuid,uuid,integer,uuid),
  public.service_list_reward_club_treasuries(uuid,uuid,integer,uuid),
  public.service_withdraw_reward_club_treasury(uuid,uuid,integer,uuid) to service_role;
commit;
