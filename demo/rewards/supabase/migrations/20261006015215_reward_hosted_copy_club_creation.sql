begin;
-- Explicit deployment intent, never a nomination/owner-control/claim attestation.
create table app_private.reward_demo_copy_club_creations(
 id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'),
 user_id uuid not null,session_id uuid not null,club_id uuid not null references public.clubs(id),
 sender text not null check(sender ~ '^0x[0-9a-f]{40}$' and sender<>'0x'||repeat('0',40)),
 owners jsonb not null check(jsonb_typeof(owners)='array' and jsonb_array_length(owners)=3),
 owner_identity jsonb not null,proof_id uuid not null references app_private.reward_wallet_proofs(id),
 salt_nonce text not null check(salt_nonce ~ '^[1-9][0-9]{0,38}$'),
 created_at timestamptz not null default clock_timestamp(),unique(user_id,id)
);
create table app_private.reward_demo_copy_club_creation_events(
 request_id uuid not null references app_private.reward_demo_copy_club_creations(id),
 kind text not null check(kind in('submitted','verified')),
 transaction_hash text not null check(transaction_hash ~ '^0x[0-9a-f]{64}$'),
 body jsonb not null check(jsonb_typeof(body)='object' and octet_length(body::text)<=16384),
 created_at timestamptz not null default clock_timestamp(),primary key(request_id,kind,transaction_hash)
);
create unique index reward_copy_club_creation_verified on app_private.reward_demo_copy_club_creation_events(request_id) where kind='verified';
do $$declare name text;begin
 foreach name in array array['reward_demo_copy_club_creations','reward_demo_copy_club_creation_events'] loop
  execute format('alter table app_private.%I enable row level security',name);
  execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',name);
  execute format('create trigger immutable before update or delete on app_private.%I for each row execute function app_private.reward_result_review_immutable_v3()',name);
 end loop;
end $$;
create function app_private.reward_demo_copy_club_creation_document(p_id uuid,p_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('requestId',c.id,'clubId',c.club_id,'chainId',10143,'sender',c.sender,'owners',c.owners,'saltNonce',c.salt_nonce,
  'createdAt',c.created_at,'current',app_private.reward_club_owner_identity(c.club_id,c.user_id) is not null
   and app_private.reward_club_owner_identity(c.club_id,c.user_id)=c.owner_identity,
  'transactions',coalesce((select jsonb_agg(e.body order by e.created_at,e.transaction_hash) from app_private.reward_demo_copy_club_creation_events e where e.request_id=c.id and e.kind='submitted'),'[]'::jsonb),
  'verified',(select e.body from app_private.reward_demo_copy_club_creation_events e where e.request_id=c.id and e.kind='verified'))
 from app_private.reward_demo_copy_club_creations c where c.id=p_id and c.user_id=p_user_id;
$$;
create function public.service_reward_demo_copy_club_creation(p_user_id uuid,p_session_id uuid,p_action text,p_input jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare clubs jsonb;r app_private.reward_demo_copy_club_creations%rowtype;ch app_private.reward_wallet_challenges%rowtype;
 old app_private.reward_demo_copy_club_creation_events%rowtype;owners jsonb;owner_now jsonb;selected_club uuid;request_id uuid;proof_id uuid;after_id uuid;
 field text;salt numeric:=0;raw_id bytea;i integer;result jsonb;items jsonb;body jsonb;hash text;kind text;
begin
 clubs:=app_private.require_reward_demo_copy_club(p_user_id,p_session_id);
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>16384 then raise exception 'invalid_reward_club_creation';end if;
 if p_action='history' then
  if (select count(*) from jsonb_object_keys(p_input))<>1 or not(p_input?'after') then raise exception 'invalid_reward_club_creation';end if;
  after_id:=(p_input->>'after')::uuid;
  select coalesce(jsonb_agg(q.body order by q.id),'[]'::jsonb) into items from(
   select c.id,app_private.reward_demo_copy_club_creation_document(c.id,p_user_id) body
   from app_private.reward_demo_copy_club_creations c where c.user_id=p_user_id and(after_id is null or c.id>after_id)
    order by c.id limit 26) q;
  return jsonb_build_object('items',case when jsonb_array_length(items)>25 then items-25 else items end,
   'nextCursor',case when jsonb_array_length(items)>25 then items->24->>'requestId' else null end);
 end if;
 request_id:=(p_input->>'requestId')::uuid;
 if request_id is null or request_id='00000000-0000-0000-0000-000000000000' then raise exception 'invalid_reward_club_creation';end if;
 perform pg_advisory_xact_lock(hashtextextended('reward-club-account:'||p_user_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('reward-club-creation:'||request_id::text,0));
 perform app_private.require_reward_demo_copy_club(p_user_id,p_session_id);
 select * into r from app_private.reward_demo_copy_club_creations where id=request_id;
 if r.id is not null and r.user_id<>p_user_id then raise exception 'reward_club_creation_not_found';end if;
 if p_action='request' then
  if(select count(*) from jsonb_object_keys(p_input))<>4 or not(p_input?&array['requestId','clubId','proofId','owners']) then raise exception 'invalid_reward_club_creation';end if;
  selected_club:=(p_input->>'clubId')::uuid;proof_id:=(p_input->>'proofId')::uuid;
  if not exists(select 1 from jsonb_array_elements(clubs) c where(c->>'id')::uuid=selected_club) then raise exception 'reward_club_owner_required';end if;
  if jsonb_typeof(p_input->'owners') is distinct from 'array' or jsonb_array_length(p_input->'owners')<>3 then raise exception 'invalid_reward_club_creation';end if;
  select jsonb_agg(value order by value) into owners from jsonb_array_elements_text(p_input->'owners');
  if(select count(distinct value) from jsonb_array_elements_text(owners))<>3 then raise exception 'invalid_reward_club_creation';end if;
  for field in select value from jsonb_array_elements_text(owners) loop
   if field !~ '^0x[0-9a-f]{40}$' or field in('0x'||repeat('0',40),'0x'||repeat('0',39)||'1',
    '0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67','0x41675c099f32341bf84bfc5382af534df5c7461a','0xfd0732dc9e303f09fcef3a7388ad10a83459ec99') then raise exception 'invalid_reward_club_creation';end if;
  end loop;
  select c.* into ch from app_private.reward_wallet_challenges c join app_private.reward_wallet_proofs p on p.challenge_id=c.id
   where p.id=proof_id and c.user_id=p_user_id and c.chain_id=10143 and c.origin='https://podium.raceson.com';
  if ch.id is null then raise exception 'reward_destination_proof_required';end if;
  if r.id is not null then
   if(r.club_id,r.sender,r.owners) is distinct from(selected_club,ch.address,owners) then raise exception 'reward_ledger_idempotency_conflict';end if;
   return app_private.reward_demo_copy_club_creation_document(request_id,p_user_id);
  end if;
  if ch.session_id<>p_session_id or clock_timestamp()<ch.issued_at or clock_timestamp()>=ch.expires_at then raise exception 'reward_wallet_challenge_expired';end if;
  perform id from public.clubs where id=selected_club for share;
  perform id from public.athlete_profiles where claimed_by_user_id=p_user_id order by id for share;
  perform cm.id from public.club_memberships cm where cm.club_id=selected_club order by cm.id for share;
  perform id from public.club_roles cr where cr.club_id=selected_club order by cr.id for share;
  owner_now:=app_private.reward_club_owner_identity(selected_club,p_user_id);if owner_now is null then raise exception 'reward_club_owner_required';end if;
  if(select count(*) from app_private.reward_demo_copy_club_creations where user_id=p_user_id and created_at>clock_timestamp()-interval '1 hour')>=16
   or(select count(*) from app_private.reward_demo_copy_club_creations where user_id=p_user_id)>=160 then raise exception 'reward_club_creation_limit';end if;
  raw_id:=decode(replace(request_id::text,'-',''),'hex');for i in 0..15 loop salt:=salt*256+get_byte(raw_id,i);end loop;
  insert into app_private.reward_demo_copy_club_creations(id,user_id,session_id,club_id,sender,owners,owner_identity,proof_id,salt_nonce)
   values(request_id,p_user_id,p_session_id,selected_club,ch.address,owners,owner_now,proof_id,(salt+1)::text) returning * into r;
 elsif p_action='read' then
  if(select count(*) from jsonb_object_keys(p_input))<>1 then raise exception 'invalid_reward_club_creation';end if;
  if r.id is null then raise exception 'reward_club_creation_not_found';end if;
 elsif p_action='authorize' then
  if(select count(*) from jsonb_object_keys(p_input))<>2 or not(p_input?&array['requestId','proofId']) then raise exception 'invalid_reward_club_creation';end if;
  if r.id is null then raise exception 'reward_club_creation_not_found';end if;
  select c.* into ch from app_private.reward_wallet_challenges c join app_private.reward_wallet_proofs p on p.challenge_id=c.id
   where p.id=(p_input->>'proofId')::uuid and c.user_id=p_user_id and c.session_id=p_session_id and c.chain_id=10143
    and c.origin='https://podium.raceson.com' and c.address=r.sender;
  if ch.id is null then raise exception 'reward_destination_proof_required';end if;
  if clock_timestamp()<ch.issued_at or clock_timestamp()>=ch.expires_at then raise exception 'reward_wallet_challenge_expired';end if;
  owner_now:=app_private.reward_club_owner_identity(r.club_id,p_user_id);
  if owner_now is null or owner_now<>r.owner_identity then raise exception 'reward_club_owner_required';end if;
 elsif p_action in('submitted','verified') then
  -- Called only after server transaction/provenance verification; public routes
  -- accept the transaction hash, never any of these computed receipt fields.
  if(select count(*) from jsonb_object_keys(p_input))<>2 or not(p_input?&array['requestId','body']) then raise exception 'invalid_reward_club_creation';end if;
  if r.id is null then raise exception 'reward_club_creation_not_found';end if;
  body:=p_input->'body';hash:=body->>'transactionHash';kind:=p_action;
  if jsonb_typeof(body) is distinct from 'object' or hash is null or hash !~ '^0x[0-9a-f]{64}$' or hash='0x'||repeat('0',64) then raise exception 'invalid_reward_club_creation';end if;
  if p_action='submitted' and ((select count(*) from jsonb_object_keys(body))<>1) then raise exception 'invalid_reward_club_creation';end if;
  if p_action='verified' and((select count(*) from jsonb_object_keys(body))<>5 or not(body?&array['transactionHash','safeAddress','blockNumber','blockHash','initializerHash'])
   or coalesce(body->>'safeAddress','') !~ '^0x[0-9a-f]{40}$' or coalesce(body->>'blockNumber','') !~ '^[1-9][0-9]*$'
   or coalesce(body->>'blockHash','') !~ '^0x[0-9a-f]{64}$' or coalesce(body->>'initializerHash','') !~ '^0x[0-9a-f]{64}$') then raise exception 'invalid_reward_club_creation';end if;
  select * into old from app_private.reward_demo_copy_club_creation_events e where e.request_id=r.id and e.kind=p_action and(e.transaction_hash=hash or p_action='verified');
  if old.request_id is not null then
   if old.transaction_hash<>hash or old.body<>body then raise exception 'reward_ledger_idempotency_conflict';end if;
  else
   if p_action='submitted' and(select count(*) from app_private.reward_demo_copy_club_creation_events e where e.request_id=r.id)>=16 then raise exception 'reward_club_creation_limit';end if;
   if p_action='verified' and not exists(select 1 from app_private.reward_demo_copy_club_creation_events e where e.request_id=r.id and e.kind='submitted' and e.transaction_hash=hash) then raise exception 'invalid_reward_club_creation';end if;
   insert into app_private.reward_demo_copy_club_creation_events(request_id,kind,transaction_hash,body) values(r.id,p_action,hash,body);
  end if;
 else raise exception 'invalid_reward_club_creation';end if;
 perform app_private.require_reward_demo_copy_club(p_user_id,p_session_id);
 result:=app_private.reward_demo_copy_club_creation_document(request_id,p_user_id);return result;
end $$;
revoke all on function app_private.reward_demo_copy_club_creation_document(uuid,uuid),public.service_reward_demo_copy_club_creation(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_demo_copy_club_creation(uuid,uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
