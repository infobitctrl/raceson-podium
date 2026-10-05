begin;
-- Demo-only owner projection. Match deletion's exact predicate; a saved launch
-- is not a deletable draft even when its original configuration still says draft.
create or replace function app_private.reward_setup_document(d app_private.reward_distribution_setups)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',d.id,'chainId',d.chain_id,'revision',d.revision,'configuration',d.configuration,
 'updatedAt',to_char(d.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'lifecycle',jsonb_build_object(
   'state',case when e.funding_hash is not null then 'funded'
     when e.deployment_hash is not null then 'deposit'
     when e.setup_id is not null or exists(select 1 from app_private.reward_sponsor_launches where setup_id=d.id) then 'saved'
     else 'draft' end,
   'canDelete',d.archived_at is null and coalesce(d.configuration->>'stage'='draft',false) and e.setup_id is null
     and not exists(select 1 from app_private.reward_sponsor_launches where setup_id=d.id)))
 from (select 1) seed left join app_private.reward_sponsor_executions e on e.setup_id=d.id;
$$;
revoke all on function app_private.reward_setup_document(app_private.reward_distribution_setups) from public,anon,authenticated;
grant execute on function app_private.reward_setup_document(app_private.reward_distribution_setups) to service_role;
commit;
