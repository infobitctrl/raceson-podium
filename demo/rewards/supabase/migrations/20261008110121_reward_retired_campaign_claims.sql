-- Isolated copied demo only. Retirement never changes a contract, entitlement,
-- payment receipt or balance. Retained rows remain available for recovery.
begin;
do $migration$
declare definition text; target regprocedure; needle text;
begin
 for target in select unnest(array[
  'public.service_reward_demo_copy_athlete_awards(uuid,uuid,text)'::regprocedure,
  'public.service_reward_demo_copy_club_awards(uuid,uuid,text)'::regprocedure]) loop
  definition:=pg_get_functiondef(target);
  needle:=$text$e.plan->>'chainId'='10143'$text$;
  if strpos(definition,needle)=0 then raise exception 'unexpected_recipient_awards_definition';end if;
  execute replace(definition,needle,needle||$code$
  and exists(select 1 from app_private.reward_distribution_setups active_setup
   where active_setup.id=a.setup_id and active_setup.archived_at is null)$code$);
 end loop;
 -- Stale tabs must not create or continue requests for retired test campaigns.
 for target in select unnest(array[
  'app_private.reward_demo_copy_claim(uuid,uuid,integer,uuid,text,text,text,text,text)'::regprocedure,
  'app_private.reward_demo_copy_club_claim(uuid,uuid,integer,uuid,text,text,text,text,text)'::regprocedure]) loop
  definition:=pg_get_functiondef(target);
  needle:=$text$if execution.plan->>'version' is distinct from '4'$text$;
  if strpos(definition,needle)=0 then raise exception 'unexpected_legacy_claim_definition';end if;
  execute replace(definition,needle,$code$if not exists(select 1 from app_private.reward_distribution_setups active_setup
   where active_setup.id=a.setup_id and active_setup.archived_at is null)
   or execution.plan->>'version' is distinct from '4'$code$);
 end loop;
 -- Public listings and direct public links follow the same retirement boundary.
 target:='app_private.reward_demo_copy_public_scope(uuid)'::regprocedure;
 definition:=pg_get_functiondef(target);
 needle:='d.chain_id=10143';
 if strpos(definition,needle)=0 then raise exception 'unexpected_public_scope_definition';end if;
 execute replace(definition,needle,needle||' and d.archived_at is null');
end $migration$;
notify pgrst,'reload schema';
commit;
