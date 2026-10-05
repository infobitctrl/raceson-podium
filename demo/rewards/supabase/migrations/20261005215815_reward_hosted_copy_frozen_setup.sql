begin;
-- Read retained economics from an actual source-bound launch, never a browser
-- snapshot or an invented organizer context. No new launch or award is written.
create function public.service_reward_demo_copy_frozen_setup(p_actor_user_id uuid,p_actor_session_id uuid,p_setup_id uuid,p_revision integer)
returns jsonb language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare result jsonb;
begin
 perform app_private.require_reward_demo_copy_setup(p_actor_user_id,p_actor_session_id,p_setup_id);
 if p_revision is null or p_revision not between 1 and 2147483645 then raise exception 'invalid_reward_setup';end if;
 select jsonb_build_object('result',jsonb_build_object('id',d.id,'chainId',d.chain_id,'revision',r.revision,
   'configuration',r.configuration,'updatedAt',to_char(r.saved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  'source',b.source_projection) into result
 from app_private.reward_distribution_setups d
 join app_private.reward_setup_revisions r on r.setup_id=d.id and r.revision=p_revision
 join app_private.reward_sponsor_launches l on l.setup_id=d.id and l.setup_revision=r.revision
 join app_private.reward_demo_copy_launch_sources b on b.launch_id=l.id
 where d.id=p_setup_id and d.chain_id=10143
  and b.batch_sha256='073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644'
 order by l.created_at desc,l.id limit 1;
 if result is null then raise exception 'reward_setup_conflict';end if;
 perform app_private.require_reward_demo_copy_setup(p_actor_user_id,p_actor_session_id,p_setup_id);
 return result;
end $$;
revoke all on function public.service_reward_demo_copy_frozen_setup(uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_demo_copy_frozen_setup(uuid,uuid,uuid,integer) to service_role;
notify pgrst,'reload schema';
commit;
