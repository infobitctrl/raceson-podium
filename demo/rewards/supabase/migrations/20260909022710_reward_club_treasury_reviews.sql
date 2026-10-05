begin;

-- Private designated-operator evidence, never a payout authorization. The service
-- verifies the chain portion; human audit references remain explicit attestations.
create function app_private.valid_reward_club_review_evidence(e jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare k text; b jsonb; v text;
begin
  if jsonb_typeof(e) is distinct from 'object' or octet_length(e::text)>4096 then return false; end if;
  if (select array_agg(x order by x) from jsonb_object_keys(e) x) is distinct from
    array['authorityEvidenceRef','candidate','chainId','controlEvidenceRef','deploymentBlock','deploymentTransactionHash',
      'executionHistoryEvidenceRef','factoryAddress','initializerHash','policy','recoveryEvidenceRef','reviewedBlock','schemaVersion']::text[] then return false; end if;
  if e->'schemaVersion' is distinct from '1'::jsonb or e->>'policy' is distinct from 'operator-reviewed-original-safe-v1'
    or (e->'chainId' is distinct from '31337'::jsonb and e->'chainId' is distinct from '10143'::jsonb)
    or not app_private.valid_reward_club_candidate(e->'candidate') then return false; end if;
  if jsonb_typeof(e->'factoryAddress') is distinct from 'string' or (e->>'factoryAddress' ~ '^0x[0-9a-f]{40}$') is not true
    or e->>'factoryAddress' in ('0x'||repeat('0',40),'0x'||repeat('0',39)||'1',e->'candidate'->>'safeAddress',
      e->'candidate'->>'singletonAddress',e->'candidate'->>'fallbackHandlerAddress') then return false; end if;
  foreach k in array array['deploymentTransactionHash','initializerHash'] loop
    if jsonb_typeof(e->k) is distinct from 'string' or (e->>k ~ '^0x[0-9a-f]{64}$') is not true or e->>k='0x'||repeat('0',64) then return false; end if;
  end loop;
  foreach k in array array['authorityEvidenceRef','controlEvidenceRef','recoveryEvidenceRef','executionHistoryEvidenceRef'] loop
    if jsonb_typeof(e->k) is distinct from 'string' or (e->>k ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') is not true
      or e->>k='00000000-0000-0000-0000-000000000000' then return false; end if;
  end loop;
  foreach k in array array['deploymentBlock','reviewedBlock'] loop
    b:=e->k;
    if jsonb_typeof(b) is distinct from 'object' then return false; end if;
    if (select array_agg(x order by x) from jsonb_object_keys(b) x) is distinct from array['hash','number','timestamp']::text[] then return false; end if;
    if jsonb_typeof(b->'hash') is distinct from 'string' or (b->>'hash' ~ '^0x[0-9a-f]{64}$') is not true or b->>'hash'='0x'||repeat('0',64) then return false; end if;
    foreach v in array array['number','timestamp'] loop
      if jsonb_typeof(b->v) is distinct from 'string' or (b->>v ~ '^(0|[1-9][0-9]{0,77})$') is not true then return false; end if;
      if (b->>v)::numeric>=power(2::numeric,256) then return false; end if;
    end loop;
  end loop;
  if (e->'deploymentBlock'->>'number')::numeric<=0 or (e->'deploymentBlock'->>'number')::numeric>(e->'reviewedBlock'->>'number')::numeric
    or (e->'deploymentBlock'->>'timestamp')::numeric>(e->'reviewedBlock'->>'timestamp')::numeric then return false; end if;
  if e->'deploymentBlock'->>'number'=e->'reviewedBlock'->>'number' and e->'deploymentBlock' is distinct from e->'reviewedBlock' then return false; end if;
  return true;
end $$;

create table app_private.reward_club_treasury_reviews (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references app_private.reward_programmes(id) on delete restrict,
  request_id uuid not null references app_private.reward_club_treasury_requests(id) on delete restrict,
  revision integer not null check(revision>0),
  reviewed_by_user_id uuid not null,
  reviewed_session_id uuid not null,
  reviewed_at timestamptz not null default clock_timestamp(),
  identity_fingerprint_sha256 text not null check(identity_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  evidence jsonb not null check(app_private.valid_reward_club_review_evidence(evidence)),
  idempotency_key text not null check(length(idempotency_key) between 8 and 128),
  unique(programme_id,request_id,revision),
  unique(programme_id,reviewed_by_user_id,idempotency_key)
);
create index reward_club_reviews_request on app_private.reward_club_treasury_reviews(request_id);
create table app_private.reward_club_treasury_revocations (
  review_id uuid primary key references app_private.reward_club_treasury_reviews(id) on delete restrict,
  revoked_by_user_id uuid not null,
  revoked_session_id uuid not null,
  revoked_at timestamptz not null default clock_timestamp(),
  reason text not null check(reason in('authority_uncertain','key_control_changed','wallet_history_uncertain','operator_correction'))
);
do $$ declare name text; begin
  foreach name in array array['reward_club_treasury_reviews','reward_club_treasury_revocations'] loop
    execute format('alter table app_private.%I enable row level security',name);
    execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',name);
    execute format('grant select,insert on app_private.%I to service_role',name);
    execute format('create policy %I on app_private.%I for select to service_role using(true)',name||'_service_select',name);
    execute format('create policy %I on app_private.%I for insert to service_role with check(true)',name||'_service_insert',name);
    execute format('create trigger reward_club_review_immutable before update or delete on app_private.%I for each row execute function app_private.reject_reward_ledger_mutation()',name);
  end loop;
end $$;

-- Private tuple versions supplement nomination timestamps. Do not treat xmin
-- as portable identity: database restore/import requires a new explicit review.
create function app_private.reward_club_review_fingerprint(p_request_id uuid)
returns text language sql volatile security invoker set search_path='' set timezone='UTC' as $$
  select encode(sha256(convert_to(jsonb_build_object('requestId',q.id,'candidate',q.candidate,
    'identity',app_private.reward_club_owner_identity(q.club_id,q.user_id),
    'clubVersion',c.xmin::text,'profileVersion',a.xmin::text,'membershipVersion',m.xmin::text,'roleVersion',r.xmin::text,
    'accountVersion',u.xmin::text,'accountStatus',u.status)::text,'UTF8')),'hex')
  from app_private.reward_club_treasury_requests q
  left join public.clubs c on c.id=q.club_id
  left join public.athlete_profiles a on a.id=(q.owner_identity->>'athleteProfileId')::uuid
  left join public.club_memberships m on m.id=(q.owner_identity->>'membershipId')::uuid
  left join public.club_roles r on r.id=(q.owner_identity->>'roleId')::uuid
  left join public.user_profiles u on u.user_id=q.user_id where q.id=p_request_id;
$$;
create function app_private.reward_club_review_document(r app_private.reward_club_treasury_reviews)
returns jsonb language sql volatile security invoker set search_path='' set timezone='UTC' as $$
  select jsonb_build_object('reviewId',r.id,'programmeId',r.programme_id,'requestId',r.request_id,'revision',r.revision,
    'reviewedByUserId',r.reviewed_by_user_id,'reviewedSessionId',r.reviewed_session_id,'reviewedAt',r.reviewed_at,
    'identityFingerprintSha256',r.identity_fingerprint_sha256,'evidence',r.evidence,'idempotencyKey',r.idempotency_key,
    'revokedAt',v.revoked_at,'revocationReason',v.reason)
  from (values(1)) one(n) left join app_private.reward_club_treasury_revocations v on v.review_id=r.id;
$$;
create function app_private.reward_club_review_context(p_programme_id uuid,p_request_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare programme app_private.reward_programmes%rowtype; q app_private.reward_club_treasury_requests%rowtype;
  r app_private.reward_club_treasury_reviews%rowtype; nomination jsonb; fingerprint text; state text;
begin
  select * into programme from app_private.reward_programmes where id=p_programme_id;
  if not found then raise exception using errcode='42501',message='reward_club_review_scope_required'; end if;
  select * into q from app_private.reward_club_treasury_requests where id=p_request_id;
  if not found or q.chain_id<>programme.chain_id then raise exception using errcode='42501',message='reward_club_review_scope_required'; end if;
  if not exists(with recursive aliases(id) as (
    select q.club_id union select c.id from public.clubs c join aliases a on c.merged_into_club_id=a.id
  ) select 1 from aliases a join app_private.reward_beneficiaries b on b.entity_id=a.id and b.kind='club'
    join app_private.reward_campaigns campaign on campaign.id=b.campaign_id where campaign.programme_id=p_programme_id)
    and not exists(select 1 from app_private.reward_club_treasury_reviews where programme_id=p_programme_id and request_id=q.id) then
    raise exception using errcode='42501',message='reward_club_review_scope_required'; end if;
  nomination:=app_private.reward_club_treasury_document(q);
  fingerprint:=app_private.reward_club_review_fingerprint(q.id);
  select * into r from app_private.reward_club_treasury_reviews where programme_id=p_programme_id and request_id=q.id order by revision desc limit 1;
  state:=case when nomination->>'status'='withdrawn' then 'request_withdrawn'
    when nomination->>'status'='identity_hold' or not exists(select 1 from public.user_profiles where user_id=q.user_id and status='active') then 'identity_hold'
    when r.id is null then 'unreviewed'
    when exists(select 1 from app_private.reward_club_treasury_revocations where review_id=r.id) then 'revoked'
    when r.identity_fingerprint_sha256 is distinct from fingerprint then 'identity_changed'
    else 'reviewed' end;
  return jsonb_build_object('programmeId',programme.id,'operatorUserId',programme.operator_user_id,'chainId',programme.chain_id,
    'nomination',nomination,'identityFingerprintSha256',fingerprint,
    'latestReview',case when r.id is null then null else app_private.reward_club_review_document(r) end,'reviewState',state);
end $$;
create function public.service_read_reward_club_review_context(p_programme_id uuid,p_actor_user_id uuid,p_actor_session_id uuid,p_request_id uuid,p_idempotency_key text default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare body jsonb; prior app_private.reward_club_treasury_reviews%rowtype;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator(p_programme_id,p_actor_user_id);
  if p_idempotency_key is not null and length(p_idempotency_key) not between 8 and 128 then
    raise exception using errcode='22023',message='invalid_reward_club_review'; end if;
  body:=app_private.reward_club_review_context(p_programme_id,p_request_id);
  select * into prior from app_private.reward_club_treasury_reviews where programme_id=p_programme_id
    and reviewed_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
  body:=body||jsonb_build_object('retryReview',case when prior.id is null then null else app_private.reward_club_review_document(prior) end);
  if app_private.reward_club_review_fingerprint(p_request_id) is distinct from body->>'identityFingerprintSha256' then
    raise exception using errcode='22023',message='reward_club_review_identity_changed'; end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator(p_programme_id,p_actor_user_id);
  return body;
end $$;
create function public.service_record_reward_club_review(p_programme_id uuid,p_actor_user_id uuid,p_actor_session_id uuid,
  p_request_id uuid,p_expected_identity_fingerprint text,p_expected_revision integer,p_evidence jsonb,p_idempotency_key text)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare q app_private.reward_club_treasury_requests%rowtype; r app_private.reward_club_treasury_reviews%rowtype; context jsonb; result jsonb;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator(p_programme_id,p_actor_user_id);
  if p_expected_identity_fingerprint is null or p_expected_identity_fingerprint !~ '^[0-9a-f]{64}$'
    or p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=2147483647
    or not app_private.valid_reward_club_review_evidence(p_evidence)
    or p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception using errcode='22023',message='invalid_reward_club_review'; end if;
  perform id from app_private.reward_programmes where id=p_programme_id for update;
  select * into q from app_private.reward_club_treasury_requests where id=p_request_id;
  if not found then raise exception using errcode='42501',message='reward_club_review_scope_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('reward-club-account:'||q.user_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('reward-club-treasury:'||q.club_id::text||':'||q.chain_id::text,0));
  perform user_id from public.user_profiles where user_id in(p_actor_user_id,q.user_id) order by user_id for share;
  perform id from public.clubs where id=q.club_id for share;
  perform id from public.athlete_profiles where claimed_by_user_id=q.user_id or id=(q.owner_identity->>'athleteProfileId')::uuid order by id for share;
  perform id from public.club_memberships where club_id=q.club_id order by id for share;
  perform id from public.club_roles where club_id=q.club_id order by id for share;
  context:=public.service_read_reward_club_review_context(p_programme_id,p_actor_user_id,p_actor_session_id,p_request_id);
  if p_evidence->'candidate' is distinct from q.candidate or p_evidence->'chainId' is distinct from context->'chainId' then
    raise exception using errcode='22023',message='invalid_reward_club_review'; end if;
  select * into r from app_private.reward_club_treasury_reviews where programme_id=p_programme_id
    and reviewed_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
  if found then
    if r.request_id is distinct from p_request_id or r.identity_fingerprint_sha256 is distinct from p_expected_identity_fingerprint
      or r.revision<>p_expected_revision+1 or r.evidence is distinct from p_evidence then
      raise exception using errcode='22023',message='reward_ledger_idempotency_conflict'; end if;
  else
    if coalesce((context->'latestReview'->>'revision')::integer,0)<>p_expected_revision then
      raise exception using errcode='22023',message='reward_club_review_revision_changed'; end if;
    if context->>'identityFingerprintSha256' is distinct from p_expected_identity_fingerprint then
      raise exception using errcode='22023',message='reward_club_review_identity_changed'; end if;
    if context->>'reviewState' in('request_withdrawn','identity_hold') then raise exception using errcode='42501',message='reward_club_review_hold'; end if;
    insert into app_private.reward_club_treasury_reviews(programme_id,request_id,revision,reviewed_by_user_id,reviewed_session_id,
      identity_fingerprint_sha256,evidence,idempotency_key)
      values(p_programme_id,p_request_id,p_expected_revision+1,p_actor_user_id,p_actor_session_id,p_expected_identity_fingerprint,p_evidence,p_idempotency_key)
      returning * into r;
  end if;
  result:=app_private.reward_club_review_document(r);
  if app_private.reward_club_review_fingerprint(p_request_id) is distinct from context->>'identityFingerprintSha256' then
    raise exception using errcode='22023',message='reward_club_review_identity_changed'; end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator(p_programme_id,p_actor_user_id);
  return result; -- Exact retries are historical, including revoked/held records.
end $$;
create function public.service_revoke_reward_club_review(p_programme_id uuid,p_actor_user_id uuid,p_actor_session_id uuid,p_review_id uuid,p_reason text)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare r app_private.reward_club_treasury_reviews%rowtype; q app_private.reward_club_treasury_requests%rowtype; prior text; result jsonb;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator(p_programme_id,p_actor_user_id);
  perform id from app_private.reward_programmes where id=p_programme_id for update;
  select * into r from app_private.reward_club_treasury_reviews where id=p_review_id and programme_id=p_programme_id;
  if not found then raise exception using errcode='42501',message='reward_club_review_scope_required'; end if;
  select * into q from app_private.reward_club_treasury_requests where id=r.request_id;
  perform pg_advisory_xact_lock(hashtextextended('reward-club-account:'||q.user_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('reward-club-treasury:'||q.club_id::text||':'||q.chain_id::text,0));
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator(p_programme_id,p_actor_user_id);
  if p_reason is null or p_reason not in('authority_uncertain','key_control_changed','wallet_history_uncertain','operator_correction') then
    raise exception using errcode='22023',message='invalid_reward_club_review'; end if;
  select reason into prior from app_private.reward_club_treasury_revocations where review_id=r.id;
  if found and prior<>p_reason then raise exception using errcode='22023',message='reward_ledger_idempotency_conflict'; end if;
  insert into app_private.reward_club_treasury_revocations(review_id,revoked_by_user_id,revoked_session_id,reason)
    values(r.id,p_actor_user_id,p_actor_session_id,p_reason) on conflict(review_id) do nothing;
  result:=app_private.reward_club_review_document(r);
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator(p_programme_id,p_actor_user_id);
  return result;
end $$;

revoke all on function app_private.valid_reward_club_review_evidence(jsonb),app_private.reward_club_review_fingerprint(uuid),
  app_private.reward_club_review_document(app_private.reward_club_treasury_reviews),app_private.reward_club_review_context(uuid,uuid),
  public.service_read_reward_club_review_context(uuid,uuid,uuid,uuid,text),
  public.service_record_reward_club_review(uuid,uuid,uuid,uuid,text,integer,jsonb,text),
  public.service_revoke_reward_club_review(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function app_private.valid_reward_club_review_evidence(jsonb),app_private.reward_club_review_fingerprint(uuid),
  app_private.reward_club_review_document(app_private.reward_club_treasury_reviews),app_private.reward_club_review_context(uuid,uuid),
  public.service_read_reward_club_review_context(uuid,uuid,uuid,uuid,text),
  public.service_record_reward_club_review(uuid,uuid,uuid,uuid,text,integer,jsonb,text),
  public.service_revoke_reward_club_review(uuid,uuid,uuid,uuid,text) to service_role;
commit;
