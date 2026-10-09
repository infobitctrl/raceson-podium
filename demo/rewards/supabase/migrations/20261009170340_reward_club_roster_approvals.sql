begin;
-- Frozen sporting representation, not a new membership application or consent.
create table app_private.reward_demo_club_roster (
 member_id uuid primary key references public.club_memberships(id),
 athlete_id uuid not null references public.athlete_profiles(id),
 club_id uuid not null references public.clubs(id),
 batch_sha256 text not null references app_private.reward_demo_copy_batches(file_sha256),
 policy text not null default 'copied-representation-demo-roster-v1' check(policy='copied-representation-demo-roster-v1'),
 unique(athlete_id,club_id)
);
alter table app_private.reward_demo_club_roster enable row level security;
revoke all on app_private.reward_demo_club_roster from public,anon,authenticated,service_role;
create function app_private.repair_reward_demo_club_roster()
returns integer language plpgsql security invoker set search_path='' as $$
declare item record; member uuid; changed integer:=0;
begin
 for item in
  select distinct a.athlete_id,r.represented_club_id club_id,a.batch_sha256
  from app_private.reward_demo_copy_athletes a
  join public.result_rows r on r.athlete_profile_id=a.athlete_id
  join app_private.reward_demo_copy_results p on p.result_id=r.id and p.batch_sha256=a.batch_sha256
  join public.registrations g on g.id=r.registration_id and g.athlete_profile_id=a.athlete_id and g.represented_club_id=r.represented_club_id
  where a.batch_sha256='073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644' and r.represented_club_id is not null
 loop
  if not exists(select 1 from public.club_roles where club_id=item.club_id and role_key='member' and not is_owner and status='active') then raise exception 'reward_demo_member_role_required';end if;
  insert into public.club_memberships(club_id,athlete_profile_id,membership_role,status,is_primary,membership_origin,club_role_id)
   select item.club_id,item.athlete_id,'member','active',false,'represented',id
   from public.club_roles where club_id=item.club_id and role_key='member' and not is_owner and status='active'
   on conflict(club_id,athlete_profile_id) do nothing returning id into member;
  if member is not null then changed:=changed+1;end if;
  -- Never revive removed members or replace an existing owner/role.
  insert into app_private.reward_demo_club_roster(member_id,athlete_id,club_id,batch_sha256)
   select id,item.athlete_id,item.club_id,item.batch_sha256 from public.club_memberships
   where club_id=item.club_id and athlete_profile_id=item.athlete_id and membership_origin='represented'
   on conflict do nothing;
 end loop;
 return changed;
end $$;
revoke all on function app_private.repair_reward_demo_club_roster() from public,anon,authenticated,service_role;
select app_private.repair_reward_demo_club_roster();

-- Only the recorded copied associations are available under the explicit demo
-- selection policy. Unrelated historical representation is not auto-eligible.
create function app_private.reward_club_member_eligible(p_member_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.club_memberships m
 where m.id=p_member_id and m.status='active' and (m.membership_origin<>'represented' or exists(
  select 1 from app_private.reward_demo_club_roster p where p.member_id=m.id and p.club_id=m.club_id and p.athlete_id=m.athlete_profile_id)))
$$;
revoke all on function app_private.reward_club_member_eligible(uuid) from public,anon,authenticated,service_role;

do $patch$
declare definition text;
begin
 definition:=pg_get_functiondef('public.service_reward_club_creation_members(uuid,uuid,uuid,uuid,uuid[])'::regprocedure);
 if strpos(definition,$n$'userId',case when a.is_claimed$n$)=0 then raise exception 'unexpected_roster_definition';end if;
 definition:=replace(definition,$n$coalesce(nullif(a.display_name,''),$n$,
  $n$coalesce((select 'Demo athlete '||d.ordinal from app_private.reward_demo_copy_athletes d where d.athlete_id=a.id),nullif(a.display_name,''),$n$);
 definition:=replace(definition,$n$m.status='active' and a.status='active'$n$,$n$app_private.reward_club_member_eligible(m.id) and a.status='active'$n$);
 execute definition;
 -- Preserve the deployed v1 response while v2 adds presentation metadata.
 definition:=replace(definition,'public.service_reward_club_creation_members(','public.service_reward_club_creation_members_v2(');
 definition:=replace(definition,$n$'userId',case when a.is_claimed$n$,
  $n$'username',(select l.username from public.account_login_identifiers l where l.user_id=a.claimed_by_user_id),
   'role',case when m.membership_role='owner' then 'manager' else 'athlete' end,
   'source',case when exists(select 1 from app_private.reward_demo_club_roster p where p.member_id=m.id) then 'copied_representation' else 'membership' end,
   'userId',case when a.is_claimed$n$);
 execute definition;
 -- Immutable creation snapshots retain the four original fields; roster metadata
 -- is presentation only and is not promoted to authority.
 definition:=pg_get_functiondef('app_private.reward_demo_copy_club_creation_document(uuid,uuid)'::regprocedure);
 execute replace(definition,$n$m.status='active' and a.status='active'$n$,$n$app_private.reward_club_member_eligible(m.id) and a.status='active'$n$);
end $patch$;
revoke all on function public.service_reward_club_creation_members_v2(uuid,uuid,uuid,uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_club_creation_members_v2(uuid,uuid,uuid,uuid,uuid[]) to service_role;

-- Current access derives from the immutable selected-member snapshot, never from
-- a caller-supplied wallet address or the fact that someone appears in results.
create function app_private.reward_club_claim_access(p_user_id uuid,p_session_id uuid,p_creation_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare account jsonb; c app_private.reward_demo_copy_club_creations%rowtype; doc jsonb; signer text; manager boolean;
begin
 account:=app_private.reward_demo_web_session(p_user_id,p_session_id);
 select * into c from app_private.reward_demo_copy_club_creations where id=p_creation_id;
 if c.id is null then raise exception 'reward_club_treasury_required';end if;
 doc:=app_private.reward_demo_copy_club_creation_document(c.id,c.user_id);
 manager:=c.user_id=p_user_id and account->>'kind'='club_representative'
  and c.owner_identity=app_private.reward_club_owner_identity(c.club_id,p_user_id);
 select m->>'address' into signer from app_private.reward_club_creation_members s
 cross join lateral jsonb_array_elements(s.members) m
 where s.request_id=c.id and m->>'userId'=p_user_id::text;
 -- Retained address-only treasuries can still be inspected by their creator.
 if signer is null and manager and not exists(select 1 from app_private.reward_club_creation_members where request_id=c.id)
  and c.owners ? c.sender then signer:=c.sender;end if;
 if not coalesce(manager,false) and signer is null then raise exception 'reward_claim_scope_required';end if;
 if not coalesce((doc->>'current')::boolean,false) then raise exception 'reward_claim_scope_required';end if;
 if signer is not null and not(c.owners ? signer) then raise exception 'reward_claim_scope_required';end if;
 return jsonb_build_object('clubId',c.club_id,'creatorId',c.user_id,'manager',coalesce(manager,false),'signerAddress',signer);
end $$;
revoke all on function app_private.reward_club_claim_access(uuid,uuid,uuid) from public,anon,authenticated,service_role;

do $patch$
declare definition text; start_at integer; end_at integer;
begin
 definition:=pg_get_functiondef('public.service_reward_demo_copy_club_direct_claim_v5(uuid,uuid,uuid,text,uuid,uuid,jsonb)'::regprocedure);
 definition:=replace(definition,$n$account:=app_private.require_reward_demo_copy_club(p_user_id,p_session_id);$n$,
  $n$account:=app_private.reward_club_claim_access(p_user_id,p_session_id,p_creation_id);$n$);
 definition:=replace(definition,$n$not exists(select 1 from jsonb_array_elements(account) x where(x->>'id')::uuid=r.beneficiary_id)$n$,
  $n$(account->>'clubId')::uuid is distinct from r.beneficiary_id$n$);
 start_at:=strpos(definition,' owner_now:=');end_at:=strpos(definition,' select body into treasury');
 if start_at=0 or end_at<=start_at then raise exception 'unexpected_direct_claim_access';end if;
 definition:=substr(definition,1,start_at-1)||$n$ select * into creation from app_private.reward_demo_copy_club_creations where id=p_creation_id and club_id=r.beneficiary_id;
$n$||substr(definition,end_at);
 definition:=replace(definition,$n$not(creation.owners ? ch.address)$n$,
  $n$(ch.address is distinct from account->>'signerAddress')$n$);
 definition:=replace(definition,$n$perform app_private.require_reward_demo_copy_club(p_user_id,p_session_id);
 if app_private.reward_club_owner_identity(r.beneficiary_id,p_user_id) is distinct from owner_now then raise exception 'reward_claim_scope_required';end if;$n$,
  $n$if account is distinct from app_private.reward_club_claim_access(p_user_id,p_session_id,p_creation_id) then raise exception 'reward_claim_scope_required';end if;$n$);
 execute definition;
end $patch$;

create table app_private.reward_club_owner_approvals (
 id uuid primary key default gen_random_uuid(),
 creation_id uuid not null references app_private.reward_demo_copy_club_creations(id),
 approval_id uuid not null references app_private.reward_sponsor_allocation_approvals_v4(id),
 entitlement_id text not null check(entitlement_id ~ '^0x[0-9a-f]{64}$'),
 body jsonb not null check(jsonb_typeof(body)='object'),
 expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 retired_at timestamptz,
 check(expires_at>created_at and expires_at<=created_at+interval '10 minutes')
);
create unique index reward_club_owner_approvals_current on app_private.reward_club_owner_approvals(creation_id,approval_id,entitlement_id) where retired_at is null;
create table app_private.reward_club_owner_signatures (
 request_id uuid not null references app_private.reward_club_owner_approvals(id),
 user_id uuid not null references auth.users(id),
 address text not null check(address ~ '^0x[0-9a-f]{40}$'),
 signature text not null check(signature ~ '^0x[0-9a-fA-F]{130}$'),
 primary key(request_id,address),unique(request_id,user_id)
);
create table app_private.reward_club_owner_submissions (
 request_id uuid not null references app_private.reward_club_owner_approvals(id),
 transaction_hash text not null check(transaction_hash ~ '^0x[0-9a-f]{64}$'),
 primary key(request_id,transaction_hash)
);
alter table app_private.reward_club_owner_approvals enable row level security;
alter table app_private.reward_club_owner_signatures enable row level security;
alter table app_private.reward_club_owner_submissions enable row level security;
revoke all on app_private.reward_club_owner_approvals,app_private.reward_club_owner_signatures,app_private.reward_club_owner_submissions from public,anon,authenticated,service_role;
create trigger immutable before update or delete on app_private.reward_club_owner_signatures for each row execute function app_private.reward_result_review_immutable_v3();

create function public.service_reward_club_owner_approval(p_user_id uuid,p_session_id uuid,p_creation_id uuid,p_approval_id uuid,p_entitlement_id text,p_action text,p_input jsonb default '{}')
returns jsonb language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare access jsonb; facts jsonb; r app_private.reward_club_owner_approvals%rowtype; signer text; previous text;
begin
 access:=app_private.reward_club_claim_access(p_user_id,p_session_id,p_creation_id);
 -- Full award/club/publication scope is checked even for reads and signatures.
 facts:=public.service_reward_demo_copy_club_direct_claim_v5(p_user_id,p_session_id,p_approval_id,p_entitlement_id,p_creation_id,null,null);
 signer:=access->>'signerAddress';
 if p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>32768 then raise exception 'invalid_sponsor_claim';end if;
 perform pg_advisory_xact_lock(hashtextextended('club-approval:'||p_creation_id::text||p_approval_id::text||p_entitlement_id,0));
 -- Recheck after a lock wait; pin selected membership/profile rows until write.
 perform m.id from public.club_memberships m join app_private.reward_club_creation_members s on s.request_id=p_creation_id
 where exists(select 1 from jsonb_array_elements(s.members) v where v->>'memberId'=m.id::text) order by m.id for share of m;
 perform a.id from public.athlete_profiles a join public.club_memberships m on m.athlete_profile_id=a.id
 join app_private.reward_club_creation_members s on s.request_id=p_creation_id
 where exists(select 1 from jsonb_array_elements(s.members) v where v->>'memberId'=m.id::text) order by a.id for share of a;
 access:=app_private.reward_club_claim_access(p_user_id,p_session_id,p_creation_id);signer:=access->>'signerAddress';
 select * into r from app_private.reward_club_owner_approvals where creation_id=p_creation_id and approval_id=p_approval_id and entitlement_id=p_entitlement_id and retired_at is null;
 if p_action<>'read' and signer is null then raise exception 'reward_club_owner_required';end if;
 if p_action='prepare' then
  if (select count(*) from jsonb_object_keys(p_input))<>3 or not(p_input?&array['previousId','body','expiresAt'])
   or p_input->'body'->>'creationId' is distinct from p_creation_id::text
   or p_input->'body'->>'approvalId' is distinct from p_approval_id::text
   or p_input->'body'->>'entitlementId' is distinct from p_entitlement_id
   or p_input->'body'->>'safeAddress' is distinct from facts->'treasury'->>'safeAddress'
   or p_input->'body'->>'amountWei' is distinct from facts->'award'->>'amount'
   or p_input->'body'->'owners' is distinct from facts->'treasury'->'owners' then raise exception 'invalid_sponsor_claim';end if;
  if r.id is not null and r.id::text is distinct from p_input->>'previousId' then raise exception 'reward_sponsor_claim_conflict';end if;
  if r.id is null and p_input->>'previousId' is not null then raise exception 'reward_sponsor_claim_conflict';end if;
  if r.id is not null then update app_private.reward_club_owner_approvals set retired_at=clock_timestamp() where id=r.id;end if;
  insert into app_private.reward_club_owner_approvals(creation_id,approval_id,entitlement_id,body,expires_at)
   values(p_creation_id,p_approval_id,p_entitlement_id,p_input->'body',(p_input->>'expiresAt')::timestamptz) returning * into r;
 elsif p_action in('sign','submitted') then
  if r.id is null or r.id::text is distinct from p_input->>'requestId' or r.expires_at<=clock_timestamp() then raise exception 'reward_sponsor_claim_conflict';end if;
  if p_action='sign' then
   if (select count(*) from jsonb_object_keys(p_input))<>3 or not(p_input?&array['requestId','address','signature']) or p_input->>'address' is distinct from signer then raise exception 'reward_club_owner_required';end if;
   select signature into previous from app_private.reward_club_owner_signatures where request_id=r.id and address=signer;
   if previous is not null and previous<>p_input->>'signature' then raise exception 'reward_sponsor_claim_conflict';end if;
   insert into app_private.reward_club_owner_signatures values(r.id,p_user_id,signer,p_input->>'signature') on conflict do nothing;
  else
   if (select count(*) from jsonb_object_keys(p_input))<>2 or not(p_input?&array['requestId','hash'])
    or (select count(*) from app_private.reward_club_owner_signatures where request_id=r.id)<2 then raise exception 'reward_sponsor_claim_conflict';end if;
   if (select count(*) from app_private.reward_club_owner_submissions where request_id=r.id)>=8 then raise exception 'reward_sponsor_claim_conflict';end if;
   insert into app_private.reward_club_owner_submissions values(r.id,p_input->>'hash') on conflict do nothing;
  end if;
 elsif p_action<>'read' or p_input<>'{}'::jsonb then raise exception 'invalid_sponsor_claim';end if;
 return jsonb_build_object('signerAddress',signer,'request',case when r.id is null then null else jsonb_build_object(
  'requestId',r.id,'body',r.body,'expiresAt',r.expires_at,
  'signatures',coalesce((select jsonb_agg(jsonb_build_object('address',address,'signature',signature) order by address) from app_private.reward_club_owner_signatures where request_id=r.id),'[]'::jsonb),
  'submissions',coalesce((select jsonb_agg(transaction_hash order by transaction_hash) from app_private.reward_club_owner_submissions where request_id=r.id),'[]'::jsonb)) end);
end $$;
revoke all on function public.service_reward_club_owner_approval(uuid,uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_club_owner_approval(uuid,uuid,uuid,uuid,text,text,jsonb) to service_role;

create function public.service_reward_club_owner_awards(p_user_id uuid,p_session_id uuid,p_after text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; account jsonb;
begin
 account:=app_private.reward_demo_web_session(p_user_id,p_session_id);
 if p_after is not null and p_after !~ '^[0-9a-f-]{36}:[0-9a-f-]{36}:0x[0-9a-f]{64}$' then raise exception 'invalid_sponsor_claim';end if;
 select coalesce(jsonb_agg(body order by key),'[]'::jsonb) into rows from (
  select c.id::text||':'||a.id::text||':0x'||encode(r.entitlement_id,'hex') key,
   jsonb_build_object('cursor',c.id::text||':'||a.id::text||':0x'||encode(r.entitlement_id,'hex'),
    'creationId',c.id,'clubName',club.name,'safeAddress',event.body->>'safeAddress',
    'award',jsonb_build_object('approvalId',a.id,'entitlementId','0x'||encode(r.entitlement_id,'hex'),'amountWei',r.amount_wei::text,'slot',a.slot,'clubId',c.club_id,
    'protocolVersion',(e.plan->>'version')::integer,'claims','[]'::jsonb,
    'directClaim',jsonb_build_object('paid',exists(select 1 from app_private.reward_direct_claim_receipts_v5 receipt where receipt.entitlement_id=r.entitlement_id)))) body
  from app_private.reward_demo_copy_club_creations c
  join app_private.reward_club_creation_members members on members.request_id=c.id
  join app_private.reward_demo_copy_club_creation_events event on event.request_id=c.id and event.kind='verified'
  join public.clubs club on club.id=c.club_id
  join app_private.reward_sponsor_recipients_v4 r on r.beneficiary_id=c.club_id and r.beneficiary_kind='club'
  join app_private.reward_sponsor_allocation_approvals_v4 a on a.id=r.approval_id and a.decision='approved'
  join app_private.reward_sponsor_executions e on e.setup_id=a.setup_id and e.launch_id=a.launch_id
  where exists(select 1 from jsonb_array_elements(members.members) m where m->>'userId'=p_user_id::text)
   and coalesce((app_private.reward_demo_copy_club_creation_document(c.id,c.user_id)->>'current')::boolean,false)
   and e.plan->>'version' in('5','6') and e.plan->>'chainId'='10143' and e.deployment_hash is not null and e.funding_hash is not null
   and a.document_text::jsonb->>'schema'='podium-copy-allocation-document-v1'
   and exists(select 1 from app_private.reward_sponsor_lifecycle_v4 where approval_id=a.id and kind='publication')
   and exists(select 1 from app_private.reward_demo_copy_launch_sources where launch_id=e.launch_id and batch_sha256='073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644')
   and (p_after is null or c.id::text||':'||a.id::text||':0x'||encode(r.entitlement_id,'hex')>p_after)
  order by key limit 26
 ) q;
 return jsonb_build_object('items',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'nextCursor',case when jsonb_array_length(rows)>25 then rows->24->>'cursor' else null end);
end $$;
revoke all on function public.service_reward_club_owner_awards(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_club_owner_awards(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
