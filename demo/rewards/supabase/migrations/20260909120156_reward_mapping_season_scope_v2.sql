begin;
-- A planning draft's stored organization is not perpetual authority over a
-- season that has since moved. Lock the current season/league association for
-- this RPC transaction; do not take a shared draft lock before a save upgrade.
create or replace function public.service_read_reward_planning_draft(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d app_private.reward_planning_drafts%rowtype; document jsonb;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  select draft.* into d from app_private.reward_planning_drafts draft
    join public.league_seasons s on s.id=draft.season_id
    join public.leagues l on l.id=s.league_id and l.organization_id=draft.organization_id
    where draft.id=p_draft_id and draft.chain_id=p_chain_id for share of s,l;
  if not found or not app_private.reward_planning_authorized(p_actor_user_id,d.organization_id) then
    raise exception using errcode='42501',message='reward_planning_not_found';
  end if;
  document:=app_private.reward_planning_document(d);
  if document is null then raise exception 'reward_planning_not_found'; end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  return document;
end $$;
commit;
