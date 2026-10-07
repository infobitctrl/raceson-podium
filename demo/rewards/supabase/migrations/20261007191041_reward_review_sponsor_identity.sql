begin;
-- Presentation data for the same source-bound campaigns already readable by an
-- active results reviewer. No new source, economic or recipient authority.
create function public.service_reward_demo_copy_review_branding(p_actor_user_id uuid,p_actor_session_id uuid,p_setup_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare allowed jsonb; result jsonb;
begin
 allowed:=public.service_reward_demo_copy_review_sources(p_actor_user_id,p_actor_session_id,p_setup_id);
 select coalesce(jsonb_agg(jsonb_build_object('id',scope.value->>'id','name',b.name,'logo',b.logo,
  'website',b.website,'promotion',b.promotion,'revision',coalesce(b.revision,0)) order by scope.value->>'id'),'[]'::jsonb) into result
 from jsonb_array_elements(allowed->'items') scope(value)
 left join app_private.reward_campaign_branding b on b.setup_id=(scope.value->>'id')::uuid;
 perform app_private.require_reward_demo_copy_reviewer(p_actor_user_id,p_actor_session_id);
 return result;
end $$;
revoke all on function public.service_reward_demo_copy_review_branding(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_demo_copy_review_branding(uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
