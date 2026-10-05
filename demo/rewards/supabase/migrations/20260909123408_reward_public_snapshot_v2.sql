begin;
-- Isolated, operator-imported published evidence. No athlete/Auth/claim rows.
-- One read-only snapshot per copied season; corrections require a new reviewed
-- snapshot workflow, not mutable replacement under an existing payout proposal.
create table app_private.reward_public_snapshots_v2 (
  season_id uuid primary key references public.league_seasons(id),
  organization_id uuid not null references public.organizations(id),
  payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=2097152
    and payload->>'version'='2' and payload->>'sourceOrigin'='https://www.raceson.com'),
  imported_at timestamptz not null default clock_timestamp(),
  source_hash text not null check(source_hash ~ '^[0-9a-f]{64}$')
);
create function app_private.seal_reward_public_snapshot_v2() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
  if tg_op<>'INSERT' then raise exception 'reward_snapshot_immutable'; end if;
  new.source_hash:=encode(sha256(convert_to(new.payload::text,'UTF8')),'hex'); return new;
end $$;
revoke all on function app_private.seal_reward_public_snapshot_v2() from public,anon,authenticated,service_role;
create trigger reward_public_snapshot_immutable_v2 before insert or update or delete on app_private.reward_public_snapshots_v2
  for each row execute function app_private.seal_reward_public_snapshot_v2();
alter table app_private.reward_public_snapshots_v2 enable row level security;
revoke all on app_private.reward_public_snapshots_v2 from public,anon,authenticated,service_role;
grant select on app_private.reward_public_snapshots_v2 to service_role;

-- Preserve the synthetic/ordinary local catalogue. Imported IDs are explicitly
-- source references, not local event/profile IDs or ownership assignments.
alter function app_private.reward_mapping_catalogue_v2(uuid,uuid) rename to reward_local_mapping_catalogue_v2;
create function app_private.reward_mapping_catalogue_v2(p_season_id uuid,p_organization_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce((select payload->'catalogue' from app_private.reward_public_snapshots_v2
    where season_id=p_season_id and organization_id=p_organization_id),
    app_private.reward_local_mapping_catalogue_v2(p_season_id,p_organization_id))
$$;

create function public.service_read_reward_published_preview_v2(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d app_private.reward_planning_drafts%rowtype; record jsonb; workspace jsonb; snapshot jsonb; source_hash text;
begin
  perform public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  select * into d from app_private.reward_planning_drafts where id=p_draft_id for share;
  -- Rules and mapping writers take an exclusive lock on this same draft row.
  record:=public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  workspace:=public.service_read_reward_mapping_v2(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  select s.payload,s.source_hash into snapshot,source_hash from app_private.reward_public_snapshots_v2 s
    where s.season_id=d.season_id and s.organization_id=d.organization_id;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_planning_authorized(p_actor_user_id,d.organization_id) then raise exception 'reward_planning_not_found'; end if;
  return jsonb_build_object('record',record,'workspace',workspace,'snapshot',snapshot,'sourceHash',source_hash);
end $$;
revoke all on function app_private.reward_mapping_catalogue_v2(uuid,uuid),
  public.service_read_reward_published_preview_v2(uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_mapping_catalogue_v2(uuid,uuid),
  public.service_read_reward_published_preview_v2(uuid,uuid,integer,uuid) to service_role;
commit;
