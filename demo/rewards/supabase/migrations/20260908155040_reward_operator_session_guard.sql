begin;

-- Private transaction envelope for the existing stored-job runner. No signing,
-- queuing, new intents or arbitrary RPC dispatch. Underlying functions retain
-- their own operator/source/lease checks and privileges. A post-call session
-- failure rolls back ALL changes made by that call, including after lock waits.
create function public.service_reward_operator_session_call(
  p_actor_user_id uuid,p_actor_session_id uuid,p_method text,p_arguments jsonb
)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare routine pg_catalog.pg_proc%rowtype; parameters text; result jsonb;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode='22023',message='reward_operator_session_isolation_required';
  end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if p_method is null or p_method <> all(array[
    'service_read_reward_deployment_context','service_read_reward_deployment_attempt',
    'service_read_reward_campaign_checkpoint','service_record_reward_campaign_checkpoint',
    'service_read_reward_deployment_job','service_step_reward_deployment_job',
    'service_read_reward_funding_context','service_read_reward_funding_attempt',
    'service_read_reward_funding_job','service_step_reward_funding_job','service_confirm_reward_funding_job',
    'service_read_reward_lifecycle_context','service_read_reward_lifecycle_attempt',
    'service_read_reward_lifecycle_job','service_step_reward_lifecycle_job','service_confirm_reward_lifecycle_job',
    'service_read_reward_athlete_payment_context','service_read_reward_athlete_payment_attempt',
    'service_read_reward_athlete_payment_job','service_step_reward_athlete_payment_job','service_confirm_reward_athlete_payment_job'
  ]) or jsonb_typeof(p_arguments) is distinct from 'object' or octet_length(p_arguments::text)>131072
    or p_arguments->>'p_actor_user_id' is distinct from p_actor_user_id::text
    or (p_arguments ? 'p_actor_session_id' and p_arguments->>'p_actor_session_id' is distinct from p_actor_session_id::text) then
    raise exception using errcode='22023',message='invalid_reward_operator_session_call';
  end if;
  -- Only a single non-overloaded, invoker JSON function in public is allowed.
  -- Names and types come from trusted schema, not supplied JSON. Overloads,
  -- changed argument keys and unsupported signatures are rejected.
  if (select count(*) from pg_catalog.pg_proc where pronamespace='public'::regnamespace and proname=p_method)<>1 then
    raise exception using errcode='22023',message='invalid_reward_operator_session_call';
  end if;
  select * into routine from pg_catalog.pg_proc where pronamespace='public'::regnamespace and proname=p_method;
  if routine.prokind<>'f' or routine.prosecdef or routine.proretset or routine.proargmodes is not null
    or routine.provariadic<>0 or routine.prorettype<>'jsonb'::regtype or routine.proargnames is null
    or (select array_agg(k order by k) from jsonb_object_keys(p_arguments) k)
      is distinct from (select array_agg(k order by k) from unnest(routine.proargnames) k)
    or exists(select 1 from unnest(routine.proargtypes::oid[]) t
      where t not in ('uuid'::regtype,'text'::regtype,'integer'::regtype,'jsonb'::regtype,'timestamptz'::regtype)) then
    raise exception using errcode='22023',message='invalid_reward_operator_session_call';
  end if;
  select string_agg(case when t='jsonb'::regtype
    then format('%I => nullif($1 -> %L, ''null''::jsonb)',n,n)
    else format('%I => ($1 ->> %L)::%s',n,n,pg_catalog.format_type(t,null)) end,',' order by position)
    into parameters from unnest(routine.proargnames,routine.proargtypes::oid[]) with ordinality as a(n,t,position);
  execute format('select public.%I(%s)',p_method,parameters) into result using p_arguments;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  return jsonb_build_object('schemaVersion',1,'actorUserId',p_actor_user_id,'actorSessionId',p_actor_session_id,
    'method',p_method,'result',result);
end $$;
revoke all on function public.service_reward_operator_session_call(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_operator_session_call(uuid,uuid,text,jsonb) to service_role;

commit;
