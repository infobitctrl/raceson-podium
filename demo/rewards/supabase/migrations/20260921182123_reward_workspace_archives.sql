begin;
-- Demo workspace retirement retains configurations, revisions and paid history.

alter table app_private.reward_test_programmes add column archived_at timestamptz;

alter table app_private.reward_distribution_setups add column archived_at timestamptz;

-- Status-only archival must not create a duplicate economic revision.
drop trigger reward_setup_revision on app_private.reward_distribution_setups;
create trigger reward_setup_revision after insert or update of configuration,revision,updated_at
 on app_private.reward_distribution_setups for each row execute function app_private.archive_reward_setup_revision();

create or replace function public.service_reward_test_programmes(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
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
    from (select * from app_private.reward_test_programmes where archived_at is null and owner_user_id=p_actor_user_id and chain_id=p_chain_id order by updated_at desc,id limit 100) t;
  else
   select * into d from app_private.reward_test_programmes where id=p_programme_id and archived_at is null and owner_user_id=p_actor_user_id and chain_id=p_chain_id;
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
   if d.archived_at is not null or d.owner_user_id<>p_actor_user_id or d.chain_id<>p_chain_id then raise exception 'reward_test_not_found'; end if;
   if d.last_request_id=p_request_id then
    if d.last_expected_revision<>p_expected_revision or d.configuration<>p_configuration then raise exception 'reward_test_conflict'; end if;
    return app_private.reward_test_programme_document(d);
   end if;
   if d.revision<>p_expected_revision then raise exception 'reward_test_conflict'; end if;
   update app_private.reward_test_programmes set configuration=p_configuration,revision=revision+1,last_request_id=p_request_id,
    last_expected_revision=p_expected_revision,updated_at=clock_timestamp() where id=d.id returning * into d;
  else
   if p_expected_revision<>0 then raise exception 'reward_test_not_found'; end if;
   if (select count(*) from app_private.reward_test_programmes where archived_at is null and owner_user_id=p_actor_user_id and chain_id=p_chain_id)>=100 then raise exception 'reward_test_limit'; end if;
   insert into app_private.reward_test_programmes(id,owner_user_id,chain_id,revision,configuration,last_request_id,last_expected_revision)
    values(p_programme_id,p_actor_user_id,p_chain_id,1,p_configuration,p_request_id,0) returning * into d;
  end if;
  result:=app_private.reward_test_programme_document(d);
 end if;
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 return result;
end $$;

create or replace function public.service_reward_distribution_setups(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
 p_programme_id uuid default null,p_request_id uuid default null,p_expected_revision integer default null,p_configuration jsonb default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d app_private.reward_distribution_setups%rowtype; result jsonb;
begin
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if p_chain_id is null or p_chain_id not in(10143,31337) or p_programme_id='00000000-0000-0000-0000-000000000000'::uuid
  then raise exception 'invalid_reward_setup'; end if;
 if p_request_id is null then
  if p_expected_revision is not null or p_configuration is not null then raise exception 'invalid_reward_setup'; end if;
  if p_programme_id is null then
   select coalesce(jsonb_agg(app_private.reward_setup_document(t) order by updated_at desc,id),'[]'::jsonb) into result
    from (select * from app_private.reward_distribution_setups where archived_at is null and owner_user_id=p_actor_user_id and chain_id=p_chain_id order by updated_at desc,id limit 100) t;
  else
   select * into d from app_private.reward_distribution_setups where id=p_programme_id and archived_at is null and owner_user_id=p_actor_user_id and chain_id=p_chain_id;
   if not found then raise exception 'reward_setup_not_found'; end if;
   result:=app_private.reward_setup_document(d);
  end if;
 else
  if p_programme_id is null or p_request_id='00000000-0000-0000-0000-000000000000'::uuid or p_expected_revision is null or p_expected_revision not between 0 and 2147483644
   then raise exception 'invalid_reward_setup'; end if;
  perform app_private.validate_reward_setup_configuration(p_configuration);
  -- Serialize owner limits and same-ID creation; recheck live account/session after waits.
  perform pg_advisory_xact_lock(hashtextextended('reward-setup-owner:'||p_actor_user_id::text||':'||p_chain_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('reward-setup:'||p_programme_id::text,0));
  perform 1 from public.user_profiles where user_id=p_actor_user_id for share;
  select * into d from app_private.reward_distribution_setups where id=p_programme_id for update;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if d.id is not null then
   if d.archived_at is not null or d.owner_user_id<>p_actor_user_id or d.chain_id<>p_chain_id then raise exception 'reward_setup_not_found'; end if;
   if d.last_request_id=p_request_id then
    if d.last_expected_revision<>p_expected_revision or d.configuration<>p_configuration then raise exception 'reward_setup_conflict'; end if;
    return app_private.reward_setup_document(d);
   end if;
   if d.revision<>p_expected_revision then raise exception 'reward_setup_conflict'; end if;
   update app_private.reward_distribution_setups set configuration=p_configuration,revision=revision+1,last_request_id=p_request_id,
    last_expected_revision=p_expected_revision,updated_at=clock_timestamp() where id=d.id returning * into d;
  else
   if p_expected_revision<>0 then raise exception 'reward_setup_not_found'; end if;
   if (select count(*) from app_private.reward_distribution_setups where archived_at is null and owner_user_id=p_actor_user_id and chain_id=p_chain_id)>=100 then raise exception 'reward_setup_limit'; end if;
   insert into app_private.reward_distribution_setups(id,owner_user_id,chain_id,revision,configuration,last_request_id,last_expected_revision)
    values(p_programme_id,p_actor_user_id,p_chain_id,1,p_configuration,p_request_id,0) returning * into d;
  end if;
  result:=app_private.reward_setup_document(d);
 end if;
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 return result;
end $$;

commit;
