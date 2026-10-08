begin;
-- New executions can explicitly select V6. Existing plans, journals and
-- recipient rights are immutable; legacy V4 claim creation remains V4-only.
do $migration$
declare target regprocedure; definition text; replacement text;
begin
 target:='public.service_reward_sponsor_execution(uuid,uuid,integer,uuid,jsonb,text,text)'::regprocedure;
 definition:=pg_get_functiondef(target);
 if strpos(definition,$n$p_plan->>'version'='5'$n$)=0 or strpos(definition,$n$not in('4','5')$n$)=0 then raise exception 'unexpected_execution_definition';end if;
 replacement:=replace(definition,$n$p_plan->>'version'='5'$n$,$n$p_plan->>'version' in('5','6')$n$);
 execute replace(replacement,$n$not in('4','5')$n$,$n$not in('4','5','6')$n$);
 for target in select unnest(array[
 'public.service_prepare_reward_sponsor_upload_v4(uuid,uuid,integer,uuid,integer,uuid,uuid,text,text,text,jsonb)'::regprocedure,
 'app_private.prepare_reward_demo_copy_upload(uuid,uuid,integer,uuid,integer,uuid,uuid,text,text,text,jsonb)'::regprocedure]) loop
  definition:=pg_get_functiondef(target);
  if strpos(definition,$n$not in('4','5')$n$)=0 then raise exception 'unexpected_upload_definition';end if;
  execute replace(definition,$n$not in('4','5')$n$,$n$not in('4','5','6')$n$);
 end loop;
 -- Versioned historical names are compatibility RPCs. Their verified immutable
 -- plan selects the registry/signature protocol in the application/chain layers.
 for target in select unnest(array[
 'public.service_reward_demo_copy_direct_claim_v5(uuid,uuid,uuid,text,uuid,jsonb)'::regprocedure,
 'public.service_reward_demo_copy_club_direct_claim_v5(uuid,uuid,uuid,text,uuid,uuid,jsonb)'::regprocedure]) loop
  definition:=pg_get_functiondef(target);
  if strpos(definition,$n$plan->>'version'='5'$n$)=0 then raise exception 'unexpected_direct_claim_definition';end if;
  execute replace(definition,$n$plan->>'version'='5'$n$,$n$plan->>'version' in('5','6')$n$);
 end loop;
 for target in select unnest(array[
 'public.service_reward_demo_copy_athlete_awards(uuid,uuid,text)'::regprocedure,
 'public.service_reward_demo_copy_club_awards(uuid,uuid,text)'::regprocedure]) loop
  definition:=pg_get_functiondef(target);
  if strpos(definition,$n$protocol_version='5'$n$)=0 or strpos(definition,$n$'protocolVersion',5$n$)=0 then raise exception 'unexpected_award_projection';end if;
  replacement:=replace(definition,$n$protocol_version='5'$n$,$n$protocol_version in('5','6')$n$);
  execute replace(replacement,$n$'protocolVersion',5$n$,$n$'protocolVersion',protocol_version::integer$n$);
 end loop;
end $migration$;
notify pgrst,'reload schema';
commit;
