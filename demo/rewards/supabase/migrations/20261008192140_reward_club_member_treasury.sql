begin;
create table app_private.reward_club_creation_members (
 request_id uuid primary key references app_private.reward_demo_copy_club_creations(id),
 members jsonb not null check(jsonb_typeof(members)='array' and jsonb_array_length(members)=3)
);
alter table app_private.reward_club_creation_members enable row level security;
revoke all on app_private.reward_club_creation_members from public,anon,authenticated,service_role;
create trigger immutable before update or delete on app_private.reward_club_creation_members
 for each row execute function app_private.reward_result_review_immutable_v3();
create function public.service_reward_club_creation_members(p_user_id uuid,p_session_id uuid,p_club_id uuid,p_after uuid default null,p_ids uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare clubs jsonb; rows jsonb;
begin
 clubs:=app_private.require_reward_demo_copy_club(p_user_id,p_session_id);
 if not exists(select 1 from jsonb_array_elements(clubs) c where (c->>'id')::uuid=p_club_id)
 or app_private.reward_club_owner_identity(p_club_id,p_user_id) is null then raise exception 'reward_club_owner_required';end if;
 if p_ids is not null and (cardinality(p_ids)<>3 or (select count(distinct x) from unnest(p_ids) x)<>3 or p_after is not null) then raise exception 'invalid_reward_club_creation';end if;
 select coalesce(jsonb_agg(q.body order by q.id),'[]'::jsonb) into rows from (
  select m.id,jsonb_build_object('memberId',m.id,'name',coalesce(nullif(a.display_name,''),nullif(trim(concat_ws(' ',a.first_name,a.last_name)),''),'Club member'),
   'userId',case when a.is_claimed then a.claimed_by_user_id else null end) body
  from public.club_memberships m join public.athlete_profiles a on a.id=m.athlete_profile_id
  where m.club_id=p_club_id and m.status='active' and a.status='active' and a.merged_into_athlete_profile_id is null
   and (p_after is null or m.id>p_after) and (p_ids is null or m.id=any(p_ids)) order by m.id limit 26
 ) q;
 if p_ids is not null and jsonb_array_length(rows)<>3 then raise exception 'reward_club_members_changed';end if;
 return jsonb_build_object('clubId',p_club_id,'items',case when jsonb_array_length(rows)>25 then rows-25 else rows end,
 'nextCursor',case when jsonb_array_length(rows)>25 then rows->24->>'memberId' else null end);
end $$;
-- Existing addresses and requests remain immutable. The new snapshot binds member
-- selection to verified provider addresses; it grants no member signing authority.
alter function public.service_reward_demo_copy_club_creation(uuid,uuid,text,jsonb) set schema app_private;
alter function app_private.service_reward_demo_copy_club_creation(uuid,uuid,text,jsonb) rename to reward_club_creation_raw;
revoke all on function app_private.reward_club_creation_raw(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
create function public.service_reward_demo_copy_club_creation(p_user_id uuid,p_session_id uuid,p_action text,p_input jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare result jsonb; roster jsonb; selected jsonb; row jsonb; previous jsonb;
begin
 if p_action='request' and p_input?'members' then
  selected:=p_input->'members';
  if jsonb_typeof(selected)<>'array' or jsonb_array_length(selected)<>3 then raise exception 'invalid_reward_club_creation';end if;
  roster:=public.service_reward_club_creation_members(p_user_id,p_session_id,(p_input->>'clubId')::uuid,null,
   array(select (m->>'memberId')::uuid from jsonb_array_elements(selected) m));
  if (select count(distinct m->>'userId') from jsonb_array_elements(selected) m)<>3
   or (select jsonb_agg(m->>'address' order by m->>'address') from jsonb_array_elements(selected) m) is distinct from p_input->'owners'
   then raise exception 'reward_club_members_changed';end if;
  for row in select value from jsonb_array_elements(selected) loop
   if (select count(*) from jsonb_object_keys(row))<>4 or not(row?&array['memberId','userId','name','address'])
    or not exists(select 1 from jsonb_array_elements(roster->'items') m where m->>'memberId'=row->>'memberId' and m->>'userId'=row->>'userId' and m->>'name'=row->>'name')
    then raise exception 'reward_club_members_changed';end if;
  end loop;
  -- Lock membership and claimed-profile rows through the immutable insertion.
  perform m.id from public.club_memberships m where m.id in(select (v->>'memberId')::uuid from jsonb_array_elements(selected) v) order by m.id for share;
  perform a.id from public.athlete_profiles a join public.club_memberships m on m.athlete_profile_id=a.id where m.id in(select (v->>'memberId')::uuid from jsonb_array_elements(selected) v) order by a.id for share of a;
  if roster is distinct from public.service_reward_club_creation_members(p_user_id,p_session_id,(p_input->>'clubId')::uuid,null,
   array(select (m->>'memberId')::uuid from jsonb_array_elements(selected) m)) then raise exception 'reward_club_members_changed';end if;
  result:=app_private.reward_club_creation_raw(p_user_id,p_session_id,p_action,p_input-'members');
  select members into previous from app_private.reward_club_creation_members where request_id=(p_input->>'requestId')::uuid;
  if previous is not null and previous<>selected then raise exception 'reward_ledger_idempotency_conflict';end if;
  insert into app_private.reward_club_creation_members values((p_input->>'requestId')::uuid,selected) on conflict do nothing;
  return app_private.reward_demo_copy_club_creation_document((p_input->>'requestId')::uuid,p_user_id);
 end if;
 return app_private.reward_club_creation_raw(p_user_id,p_session_id,p_action,p_input);
end $$;
alter function app_private.reward_demo_copy_club_creation_document(uuid,uuid) rename to reward_club_creation_document_raw;
create function app_private.reward_demo_copy_club_creation_document(p_id uuid,p_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select app_private.reward_club_creation_document_raw(p_id,p_user_id) || case when exists(select 1 from app_private.reward_club_creation_members where request_id=p_id) then jsonb_build_object(
 'members',coalesce((select jsonb_agg(m-'userId' order by m->>'memberId') from app_private.reward_club_creation_members b cross join lateral jsonb_array_elements(b.members) m where b.request_id=p_id),'[]'::jsonb),
 'current',coalesce((app_private.reward_club_creation_document_raw(p_id,p_user_id)->>'current')::boolean,false) and not exists(
 select 1 from app_private.reward_club_creation_members b cross join lateral jsonb_array_elements(b.members) v
 where b.request_id=p_id and not exists(select 1 from public.club_memberships m join public.athlete_profiles a on a.id=m.athlete_profile_id
 join app_private.reward_demo_copy_club_creations c on c.id=b.request_id
 where m.id=(v->>'memberId')::uuid and m.club_id=c.club_id and m.status='active' and a.status='active' and a.merged_into_athlete_profile_id is null
 and a.is_claimed and a.claimed_by_user_id=(v->>'userId')::uuid))) else '{}'::jsonb end
 where exists(select 1 from app_private.reward_demo_copy_club_creations where id=p_id and user_id=p_user_id);
$$;
revoke all on function public.service_reward_club_creation_members(uuid,uuid,uuid,uuid,uuid[]),public.service_reward_demo_copy_club_creation(uuid,uuid,text,jsonb),
 app_private.reward_demo_copy_club_creation_document(uuid,uuid),app_private.reward_club_creation_document_raw(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_club_creation_members(uuid,uuid,uuid,uuid,uuid[]),public.service_reward_demo_copy_club_creation(uuid,uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
