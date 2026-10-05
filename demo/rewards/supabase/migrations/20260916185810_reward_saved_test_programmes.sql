begin;

-- Account-owned simulation documents only. Never sporting results or ledger rows.
create function app_private.validate_reward_test_configuration(c jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare ranking jsonb; athlete jsonb; k text; v jsonb; rounds integer; athletes integer;
begin
 if c is null or jsonb_typeof(c) is distinct from 'object' or octet_length(c::text)>16384
  or not(c ?& array['name','budgetMon','order','rule','approved','claims'])
  or c-array['name','budgetMon','order','rule','approved','claims']<>'{}'::jsonb
  or jsonb_typeof(c->'name') is distinct from 'string' or length(c->>'name') not between 1 and 100
  or btrim(c->>'name')<>c->>'name' or (c->>'name') ~ '[[:cntrl:]]'
  or jsonb_typeof(c->'budgetMon') is distinct from 'number' or (c->>'budgetMon') !~ '^[1-9][0-9]{0,6}$'
  or jsonb_typeof(c->'rule') is distinct from 'string' or c->>'rule' not in ('rank','equal')
  or jsonb_typeof(c->'approved') is distinct from 'boolean'
  or jsonb_typeof(c->'order') is distinct from 'array' or jsonb_typeof(c->'claims') is distinct from 'object'
  then raise exception 'invalid_test_programme'; end if;
 if (c->>'budgetMon')::integer>1000000 then raise exception 'invalid_test_programme'; end if;
 rounds:=jsonb_array_length(c->'order');
 if rounds not between 1 and 5 or jsonb_typeof(c#>'{order,0}') is distinct from 'array' then raise exception 'invalid_test_programme'; end if;
 athletes:=jsonb_array_length(c#>'{order,0}');
 if athletes not between 2 and 20 then raise exception 'invalid_test_programme'; end if;
 for ranking in select value from jsonb_array_elements(c->'order') loop
  if jsonb_typeof(ranking) is distinct from 'array' then raise exception 'invalid_test_programme'; end if;
  if jsonb_array_length(ranking)<>athletes or (select count(distinct value) from jsonb_array_elements(ranking))<>athletes then raise exception 'invalid_test_programme'; end if;
  for athlete in select value from jsonb_array_elements(ranking) loop
   if jsonb_typeof(athlete) is distinct from 'number' or athlete::text !~ '^(0|[1-9][0-9]?)$' then raise exception 'invalid_test_programme'; end if;
   if athlete::text::integer>=athletes then raise exception 'invalid_test_programme'; end if;
  end loop;
 end loop;
 if not (c->>'approved')::boolean and c->'claims'<>'{}'::jsonb then raise exception 'invalid_test_programme'; end if;
 for k,v in select key,value from jsonb_each(c->'claims') loop
  if k !~ '^[0-4]:([0-9]|1[0-9])$' or v not in ('"claimed"'::jsonb,'"paid"'::jsonb) then raise exception 'invalid_test_programme'; end if;
  if split_part(k,':',1)::integer>=rounds or split_part(k,':',2)::integer>=athletes then raise exception 'invalid_test_programme'; end if;
 end loop;
 return true;
end $$;

create table app_private.reward_test_programmes (
 id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
 owner_user_id uuid not null references public.user_profiles(user_id),
 chain_id integer not null check(chain_id in(31337,10143)),
 revision integer not null check(revision between 1 and 2147483645),
 configuration jsonb not null check(app_private.validate_reward_test_configuration(configuration)),
 last_request_id uuid not null check(last_request_id<>'00000000-0000-0000-0000-000000000000'::uuid),
 last_expected_revision integer not null check(last_expected_revision>=0),
 updated_at timestamptz not null default clock_timestamp()
);
create index reward_test_programmes_owner on app_private.reward_test_programmes(owner_user_id,chain_id,updated_at desc,id);
alter table app_private.reward_test_programmes enable row level security;
revoke all on app_private.reward_test_programmes from public,anon,authenticated,service_role;
grant select,insert,update on app_private.reward_test_programmes to service_role;
create policy reward_test_programmes_service_read on app_private.reward_test_programmes for select to service_role using(true);
create policy reward_test_programmes_service_insert on app_private.reward_test_programmes for insert to service_role with check(true);
create policy reward_test_programmes_service_update on app_private.reward_test_programmes for update to service_role using(true) with check(true);

create function app_private.reward_test_programme_document(d app_private.reward_test_programmes)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',d.id,'chainId',d.chain_id,'revision',d.revision,'configuration',d.configuration,
 'updatedAt',to_char(d.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
$$;
create function public.service_reward_test_programmes(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
 p_programme_id uuid default null,p_request_id uuid default null,p_expected_revision integer default null,p_configuration jsonb default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d app_private.reward_test_programmes%rowtype; result jsonb;
begin
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if p_chain_id is null or p_chain_id not in(10143,31337) or p_programme_id='00000000-0000-0000-0000-000000000000'::uuid
  then raise exception 'invalid_test_programme'; end if;
 if p_request_id is null then
  if p_expected_revision is not null or p_configuration is not null then raise exception 'invalid_test_programme'; end if;
  if p_programme_id is null then
   select coalesce(jsonb_agg(app_private.reward_test_programme_document(t) order by updated_at desc,id),'[]'::jsonb) into result
    from (select * from app_private.reward_test_programmes where owner_user_id=p_actor_user_id and chain_id=p_chain_id order by updated_at desc,id limit 100) t;
  else
   select * into d from app_private.reward_test_programmes where id=p_programme_id and owner_user_id=p_actor_user_id and chain_id=p_chain_id;
   if not found then raise exception 'reward_test_not_found'; end if;
   result:=app_private.reward_test_programme_document(d);
  end if;
 else
  if p_programme_id is null or p_request_id='00000000-0000-0000-0000-000000000000'::uuid or p_expected_revision is null or p_expected_revision not between 0 and 2147483644
   then raise exception 'invalid_test_programme'; end if;
  perform app_private.validate_reward_test_configuration(p_configuration);
  -- Serialize owner limits and same-ID creation; recheck live account/session after waits.
  perform pg_advisory_xact_lock(hashtextextended('reward-test-owner:'||p_actor_user_id::text||':'||p_chain_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('reward-test:'||p_programme_id::text,0));
  perform 1 from public.user_profiles where user_id=p_actor_user_id for share;
  select * into d from app_private.reward_test_programmes where id=p_programme_id for update;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if d.id is not null then
   if d.owner_user_id<>p_actor_user_id or d.chain_id<>p_chain_id then raise exception 'reward_test_not_found'; end if;
   if d.last_request_id=p_request_id then
    if d.last_expected_revision<>p_expected_revision or d.configuration<>p_configuration then raise exception 'reward_test_conflict'; end if;
    return app_private.reward_test_programme_document(d);
   end if;
   if d.revision<>p_expected_revision then raise exception 'reward_test_conflict'; end if;
   update app_private.reward_test_programmes set configuration=p_configuration,revision=revision+1,last_request_id=p_request_id,
    last_expected_revision=p_expected_revision,updated_at=clock_timestamp() where id=d.id returning * into d;
  else
   if p_expected_revision<>0 then raise exception 'reward_test_not_found'; end if;
   if (select count(*) from app_private.reward_test_programmes where owner_user_id=p_actor_user_id and chain_id=p_chain_id)>=100 then raise exception 'reward_test_limit'; end if;
   insert into app_private.reward_test_programmes(id,owner_user_id,chain_id,revision,configuration,last_request_id,last_expected_revision)
    values(p_programme_id,p_actor_user_id,p_chain_id,1,p_configuration,p_request_id,0) returning * into d;
  end if;
  result:=app_private.reward_test_programme_document(d);
 end if;
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 return result;
end $$;
revoke all on function app_private.validate_reward_test_configuration(jsonb),app_private.reward_test_programme_document(app_private.reward_test_programmes),
 public.service_reward_test_programmes(uuid,uuid,integer,uuid,uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function app_private.validate_reward_test_configuration(jsonb),app_private.reward_test_programme_document(app_private.reward_test_programmes),
 public.service_reward_test_programmes(uuid,uuid,integer,uuid,uuid,integer,jsonb) to service_role;
commit;
