-- Transactional inbox delivery. No provider calls, historical backfill or cron.
create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  context_type text not null,
  context_id uuid not null,
  created_at timestamptz not null default clock_timestamp()
);
create table public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.notification_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  category text not null check (category in ('clubs', 'account', 'events', 'platform')),
  club_name text not null default '',
  person_name text not null default '',
  role_name text not null default '',
  target_path text not null check (target_path ~ '^/[^/]' and target_path !~ '[[:cntrl:]\\]'),
  priority smallint not null default 0,
  action_required boolean not null default false,
  resolved_at timestamptz,
  read_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique(event_id, user_id)
);
create index user_notifications_inbox_idx on public.user_notifications(user_id, created_at desc, id desc);
create index user_notifications_unread_idx on public.user_notifications(user_id) where read_at is null and archived_at is null;
create index notification_events_context_idx on public.notification_events(context_type, context_id);
alter table public.notification_events enable row level security;
alter table public.user_notifications enable row level security;
revoke all on public.notification_events, public.user_notifications from public, anon, authenticated;
grant select, insert, update, delete on public.notification_events, public.user_notifications to service_role;
-- The API owns reads/writes. This policy remains defense in depth if SELECT is
-- explicitly granted later; it does not grant browser access by itself.
create policy notifications_own_read on public.user_notifications for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function app_private.deliver_notification(
  p_source_key text, p_context_type text, p_context_id uuid, p_user_id uuid,
  p_kind text, p_club_name text, p_person_name text, p_role_name text,
  p_target_path text, p_priority smallint default 0, p_action_required boolean default false
) returns void language plpgsql security definer set search_path = '' as $$
declare v_event_id uuid;
begin
  if p_user_id is null or not exists (
    select 1 from public.user_profiles where user_id = p_user_id and status = 'active'
  ) then return; end if;
  insert into public.notification_events(source_key, context_type, context_id)
    values(p_source_key, p_context_type, p_context_id)
    on conflict(source_key) do update set source_key = excluded.source_key
    returning id into v_event_id;
  insert into public.user_notifications(event_id, user_id, kind, category, club_name,
    person_name, role_name, target_path, priority, action_required)
  values(v_event_id, p_user_id, p_kind, 'clubs', coalesce(p_club_name,''),
    coalesce(p_person_name,''), coalesce(p_role_name,''), p_target_path, p_priority, p_action_required)
  on conflict(event_id, user_id) do update set kind = excluded.kind,
    club_name = excluded.club_name, person_name = excluded.person_name,
    role_name = excluded.role_name, target_path = excluded.target_path,
    priority = excluded.priority, action_required = excluded.action_required
  where excluded.priority >= user_notifications.priority;
end;
$$;
revoke all on function app_private.deliver_notification(text,text,uuid,uuid,text,text,text,text,text,smallint,boolean)
  from public, anon, authenticated, service_role;

create or replace function app_private.notify_club_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_club public.clubs%rowtype;
  v_user uuid;
  v_person text;
  v_role text;
  v_key text := 'club-membership:' || new.id::text || ':' || txid_current()::text;
  v_recipient record;
  v_kind text;
begin
  if tg_op = 'UPDATE' and new.status = old.status and new.club_role_id is not distinct from old.club_role_id then return new; end if;
  select * into v_club from public.clubs where id = new.club_id;
  select claimed_by_user_id, display_name into v_user, v_person from public.athlete_profiles
    where id = new.athlete_profile_id and status = 'active';
  select name into v_role from public.club_roles where id = new.club_role_id;
  if new.status <> 'pending' then
    update public.user_notifications n set resolved_at = clock_timestamp()
      from public.notification_events e where n.event_id = e.id
      and e.context_type = 'club_membership' and e.context_id = new.id
      and n.action_required and n.resolved_at is null;
  end if;
  if new.status = 'pending' then
    for v_recipient in
      select distinct a.claimed_by_user_id as user_id from public.club_memberships m
      join public.athlete_profiles a on a.id = m.athlete_profile_id and a.status = 'active'
      join public.club_roles r on r.id = m.club_role_id and r.status = 'active'
      where m.club_id = new.club_id and m.status = 'active'
        and 'club.members.manage' = any(r.permission_keys)
        and a.claimed_by_user_id is distinct from v_user
    loop
      perform app_private.deliver_notification(v_key, 'club_membership', new.id, v_recipient.user_id,
        'club.membership.pending', v_club.name, v_person, '',
        '/athlete/clubs/' || v_club.slug || '/club?section=applications', 0::smallint, true);
    end loop;
    return new;
  end if;
  if new.status = 'active' then
    if tg_op = 'UPDATE' and old.status = 'active' then v_kind := 'club.role.changed';
    else v_kind := 'club.membership.approved'; end if;
  elsif new.status = 'rejected' then v_kind := 'club.membership.rejected';
  else v_kind := 'club.membership.ended'; end if;
  perform app_private.deliver_notification(v_key, 'club_membership', new.id, v_user,
    v_kind, v_club.name, v_person, v_role,
    case when new.status = 'active' then '/athlete/clubs/' || v_club.slug || '/club' else '/athlete/clubs' end, 10::smallint);
  -- A newly assigned owner is significant to the entire active club. The
  -- recipient's personal role/approval message has higher priority.
  if new.status = 'active' and new.membership_role = 'owner'
     and (tg_op = 'INSERT' or old.membership_role is distinct from 'owner' or old.status <> 'active') then
    for v_recipient in
      select distinct a.claimed_by_user_id as user_id from public.club_memberships m
      join public.athlete_profiles a on a.id = m.athlete_profile_id and a.status = 'active'
      where m.club_id = new.club_id and m.status = 'active'
    loop
      perform app_private.deliver_notification(v_key, 'club_membership', new.id, v_recipient.user_id,
        'club.owner.changed', v_club.name, v_person, '', '/clubs/' || v_club.slug, 0::smallint);
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function app_private.notify_club_membership() from public, anon, authenticated, service_role;
create trigger club_membership_notifications after insert or update on public.club_memberships
  for each row execute function app_private.notify_club_membership();

create or replace function app_private.notify_club_access_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_club public.clubs%rowtype;
  v_person text;
  v_recipient record;
  v_membership_id uuid;
  v_key text;
  v_context text := 'club_request';
  v_context_id uuid := new.id;
  v_kind text;
begin
  if tg_op = 'UPDATE' and new.status = old.status then return new; end if;
  select * into v_club from public.clubs where id = new.club_id;
  select display_name into v_person from public.athlete_profiles where id = new.athlete_profile_id;
  v_key := 'club-request:' || new.id::text || ':' || new.status;
  if new.status = 'pending' then
    for v_recipient in select user_id from public.platform_administrators
      where is_active and (new.requested_role_key <> 'owner' or platform_role = 'super_admin')
    loop
      perform app_private.deliver_notification(v_key, v_context, v_context_id, v_recipient.user_id,
        case when new.requested_role_key = 'owner' then 'club.owner.pending' else 'club.admin.pending' end,
        v_club.name, v_person, '', '/organizer/requests', 0::smallint, true);
    end loop;
  else
    update public.user_notifications n set resolved_at = clock_timestamp()
      from public.notification_events e where n.event_id = e.id
      and e.context_type = 'club_request' and e.context_id = new.id
      and n.action_required and n.resolved_at is null;
    if new.status not in ('approved', 'rejected') then return new; end if;
    if new.status = 'approved' then
      select id into v_membership_id from public.club_memberships
        where club_id = new.club_id and athlete_profile_id = new.athlete_profile_id and status = 'active';
      if v_membership_id is not null then
        v_key := 'club-membership:' || v_membership_id::text || ':' || txid_current()::text;
        v_context := 'club_membership'; v_context_id := v_membership_id;
      end if;
      v_kind := case when new.requested_role_key = 'owner' then 'club.owner.approved' else 'club.admin.approved' end;
    else v_kind := 'club.request.rejected'; end if;
    perform app_private.deliver_notification(v_key, v_context, v_context_id, new.claimant_user_id,
      v_kind, v_club.name, v_person, '', '/athlete/clubs/' || v_club.slug || '/club?section=roles', 20::smallint);
  end if;
  return new;
end;
$$;
revoke all on function app_private.notify_club_access_request() from public, anon, authenticated, service_role;
create trigger club_access_request_notifications after insert or update on public.club_admin_role_requests
  for each row execute function app_private.notify_club_access_request();

-- No caller-controlled recipient in the browser contract: API derives p_user_id
-- exclusively from the freshly authenticated account. One statement snapshot.
create or replace function public.service_notification_inbox(
  p_user_id uuid, p_filter text default 'all', p_before_at timestamptz default null,
  p_before_id uuid default null, p_limit integer default 25
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with page as (
    select n.* from public.user_notifications n
    where n.user_id = p_user_id
      and case when p_filter = 'archived' then n.archived_at is not null
        else n.archived_at is null and (p_filter <> 'unread' or n.read_at is null) end
      and (p_before_at is null or (n.created_at,n.id) < (p_before_at,p_before_id))
    order by n.created_at desc,n.id desc limit least(greatest(p_limit,1),50) + 1
  ) select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'kind',kind,'category',category,'clubName',club_name,'personName',person_name,
      'roleName',role_name,'targetPath',target_path,'actionRequired',action_required,
      'resolvedAt',resolved_at,'readAt',read_at,'archivedAt',archived_at,'createdAt',created_at
    ) order by created_at desc,id desc) from page), '[]'::jsonb),
    'unreadCount', (select count(*) from public.user_notifications where user_id = p_user_id and read_at is null and archived_at is null),
    'snapshotAt', statement_timestamp()
  );
$$;
revoke all on function public.service_notification_inbox(uuid,text,timestamptz,uuid,integer) from public, anon, authenticated;
grant execute on function public.service_notification_inbox(uuid,text,timestamptz,uuid,integer) to service_role;
comment on table public.user_notifications is 'Private per-account inbox. Atomic source delivery; no evidence, emails or internal decision notes.';
