begin;
-- Discovery only. Membership does not confer treasury management or signing.
create function public.service_reward_club_memberships(p_user_id uuid,p_session_id uuid,p_after uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;
begin
 perform app_private.reward_demo_web_session(p_user_id,p_session_id);
 select coalesce(jsonb_agg(body order by club_id),'[]'::jsonb) into rows from (
  select club.id club_id,jsonb_build_object('clubId',club.id,'name',club.name,
   'role',case when app_private.reward_club_owner_identity(club.id,p_user_id) is not null then 'manager' else 'member' end,
   'canSign',exists(
    select 1 from app_private.reward_demo_copy_club_creations c
    join app_private.reward_club_creation_members selected on selected.request_id=c.id
    join app_private.reward_demo_copy_club_creation_events event on event.request_id=c.id and event.kind='verified'
    where c.club_id=club.id
     and exists(select 1 from jsonb_array_elements(selected.members) owner where owner->>'userId'=p_user_id::text and c.owners ? (owner->>'address'))
     and coalesce((app_private.reward_demo_copy_club_creation_document(c.id,c.user_id)->>'current')::boolean,false)
   )) body
  from public.clubs club
  where club.status='active' and club.merged_into_club_id is null and (p_after is null or club.id>p_after) and exists(
   select 1 from public.club_memberships m join public.athlete_profiles a on a.id=m.athlete_profile_id
   where m.club_id=club.id and a.status='active' and a.merged_into_athlete_profile_id is null and a.is_claimed and a.claimed_by_user_id=p_user_id
    and app_private.reward_club_member_eligible(m.id)
  ) order by club.id limit 26
 ) q;
 return jsonb_build_object('items',case when jsonb_array_length(rows)>25 then rows-25 else rows end,
  'nextCursor',case when jsonb_array_length(rows)>25 then rows->24->>'clubId' else null end);
end $$;
revoke all on function public.service_reward_club_memberships(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_club_memberships(uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
