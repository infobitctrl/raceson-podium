begin;
-- Results-team access is checked against the copied league's real organization.
-- Provisioning metadata alone cannot grant source-review authority.
create function app_private.require_reward_demo_copy_reviewer(p_user_id uuid,p_session_id uuid)
returns void language plpgsql stable security definer set search_path='' as $$
declare actor jsonb; org uuid;
begin
 actor:=app_private.reward_demo_web_session(p_user_id,p_session_id);
 select organization_id into org from public.leagues where id='ba81ced7-b2c5-4d51-95b6-d95d8c04fa36';
 if org is null or (actor->>'kind' in('reviewer','platform_admin')) is distinct from true
  or not public.service_user_has_organization_permission(org,p_user_id,'results.manage') then
  raise exception 'reward_demo_reviewer_required';
 end if;
end $$;
revoke all on function app_private.require_reward_demo_copy_reviewer(uuid,uuid) from public,anon,authenticated,service_role;

create function public.service_reward_demo_copy_review_sources(p_actor_user_id uuid,p_actor_session_id uuid,p_setup_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare result jsonb;
begin
 perform app_private.require_reward_demo_copy_reviewer(p_actor_user_id,p_actor_session_id);
 select jsonb_build_object('version','podium-copy-review-sources-v1','items',coalesce(jsonb_agg(jsonb_build_object(
  'id',x.id,'launch',jsonb_build_object('id',x.launch_id,'state','prepared','configurationHash',x.configuration_hash,
   'createdAt',to_char(x.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'setup',jsonb_build_object('id',x.id,'chainId',10143,'revision',x.revision,'configuration',x.configuration,
    'updatedAt',to_char(x.saved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
  'execution',x.execution,'source',case when p_setup_id is null then null else x.source_projection end) order by x.created_at desc,x.id),'[]'::jsonb)) into result
 from (
  select distinct on(d.id) d.id,l.id as launch_id,l.configuration_hash,l.created_at,r.revision,r.configuration,r.saved_at,b.source_projection,
   case when e.launch_id=l.id then jsonb_build_object('plan',e.plan,'deploymentHash',e.deployment_hash,'fundingHash',e.funding_hash) else null end as execution
  from app_private.reward_distribution_setups d
  join app_private.reward_demo_copy_setup_bindings s on s.setup_id=d.id
  join app_private.reward_sponsor_launches l on l.setup_id=d.id
  join app_private.reward_setup_revisions r on r.setup_id=d.id and r.revision=l.setup_revision
  join app_private.reward_demo_copy_launch_sources b on b.launch_id=l.id
  left join app_private.reward_sponsor_executions e on e.setup_id=d.id
  where d.chain_id=10143 and d.archived_at is null
   and b.batch_sha256='073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644'
   and s.batch_sha256=b.batch_sha256 and (p_setup_id is null or d.id=p_setup_id)
  order by d.id,(e.launch_id=l.id) desc nulls last,l.created_at desc,l.id limit 200
 ) x;
 perform app_private.require_reward_demo_copy_reviewer(p_actor_user_id,p_actor_session_id);
 return result;
end $$;
revoke all on function public.service_reward_demo_copy_review_sources(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_demo_copy_review_sources(uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
