-- Audited organizer activity and a bounded, read-by-default history import.
-- This migration does not replay business decisions or send external messages.
begin;
alter table public.user_notifications
  add column event_name text not null default '',
  add column is_historical boolean not null default false,
  add column registration_id uuid references public.registrations(id) on delete cascade,
  add column event_edition_id uuid references public.event_editions(id) on delete cascade,
  add column required_permission text,
  add constraint notification_organizer_scope check (
    (category <> 'events' and registration_id is null and event_edition_id is null and required_permission is null)
    or (category = 'events' and registration_id is not null and event_edition_id is not null
      and required_permission is not null and required_permission in ('entrants.manage','finance.manage'))
  );

-- Deliberately no platform-admin bypass: the inbox follows ordinary organizer
-- membership. Temporary/event-day operators do not receive organization alerts.
create function app_private.organizer_notification_recipients(
  p_edition_id uuid, p_permission text, p_occurred_at timestamptz
) returns table(user_id uuid) language sql stable security definer set search_path = '' as $$
  select distinct m.user_id
  from public.event_editions e
  join public.event_series s on s.id=e.event_series_id
  join public.organizations o on o.id=s.organization_id and o.status='active'
  join public.organization_memberships m on m.organization_id=o.id
  join public.user_profiles u on u.user_id=m.user_id and u.status='active'
  where e.id=p_edition_id and not e.is_practice and e.organizer_deleted_at is null
    and m.status='active' and m.membership_type='permanent'
    and (m.expires_at is null or m.expires_at>now())
    and coalesce(m.joined_at,m.created_at)<=p_occurred_at
    and (m.role='owner' or (m.role='admin' and p_permission=any(m.permission_keys)));
$$;
revoke all on function app_private.organizer_notification_recipients(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function app_private.organizer_notification_recipients(uuid,text,timestamptz) to service_role;

create function app_private.deliver_organizer_notification(
  p_registration_id uuid, p_source_key text, p_kind text, p_occurred_at timestamptz,
  p_historical boolean default false
) returns void language plpgsql security definer set search_path = '' as $$
declare v_source record; v_event uuid; v_permission text;
begin
  if p_kind not in ('registration.created','registration.cancelled','registration.payment.reported') then
    raise exception 'Unsupported organizer notification kind';
  end if;
  select e.id edition_id,e.name event_name,a.display_name person_name into v_source
  from public.registrations r
  join public.event_categories c on c.id=r.event_category_id
  join public.event_editions e on e.id=c.event_edition_id
  join public.athlete_profiles a on a.id=r.athlete_profile_id and a.status='active'
  where r.id=p_registration_id and r.organizer_removed_at is null
    and r.source in ('direct','guest','organizer_onsite')
    and c.organizer_deleted_at is null and e.organizer_deleted_at is null and not e.is_practice;
  if not found then return; end if;
  v_permission := case when p_kind='registration.payment.reported' then 'finance.manage' else 'entrants.manage' end;
  insert into public.notification_events(source_key,context_type,context_id,created_at)
    values(p_source_key,'registration',p_registration_id,p_occurred_at)
    on conflict(source_key) do update set source_key=excluded.source_key returning id into v_event;
  insert into public.user_notifications(event_id,user_id,kind,category,event_name,person_name,
    target_path,registration_id,event_edition_id,required_permission,created_at,read_at,is_historical)
  select v_event,recipient.user_id,p_kind,'events',v_source.event_name,v_source.person_name,
    '/organizer/registrations' || case when v_permission='finance.manage' then '/finance' else '' end
      || '?edition=' || v_source.edition_id::text,
    p_registration_id,v_source.edition_id,v_permission,p_occurred_at,
    case when p_historical then statement_timestamp() end,p_historical
  from app_private.organizer_notification_recipients(v_source.edition_id,v_permission,p_occurred_at) recipient
  on conflict(event_id,user_id) do nothing;
end;
$$;
revoke all on function app_private.deliver_organizer_notification(uuid,text,text,timestamptz,boolean) from public,anon,authenticated,service_role;

-- Submission keys are stable per registration. Confirmation of an existing
-- pending entry is not another registration; each audited cancellation is distinct.
create function app_private.notify_registration_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.to_status in ('pending','confirmed') and (new.from_status is null or new.from_status='draft') then
    perform app_private.deliver_organizer_notification(new.registration_id,
      'registration:' || new.registration_id::text || ':submitted','registration.created',new.created_at);
  elsif new.to_status='cancelled' and new.from_status in ('pending','confirmed') then
    perform app_private.deliver_organizer_notification(new.registration_id,
      'registration-status:' || new.id::text,'registration.cancelled',new.created_at);
  end if;
  return new;
end;
$$;
revoke all on function app_private.notify_registration_status() from public,anon,authenticated,service_role;
create trigger registration_status_notifications after insert on public.registration_status_history
  for each row execute function app_private.notify_registration_status();

create function app_private.notify_registration_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.event_type='reported' and new.source='athlete' then
    perform app_private.deliver_organizer_notification(new.registration_id,
      'registration-payment:' || new.id::text,'registration.payment.reported',new.created_at);
  end if;
  return new;
end;
$$;
revoke all on function app_private.notify_registration_payment() from public,anon,authenticated,service_role;
create trigger registration_payment_notifications after insert on public.registration_payment_events
  for each row execute function app_private.notify_registration_payment();

-- Reuse the exact same source keys and recipient rules for history and live
-- writes. A retry cannot reset read/archive state or duplicate an existing item.
create function app_private.backfill_notification_history(p_from timestamptz,p_before timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare v_source record; v_event uuid; v_recipient record;
begin
  if p_from is null or p_before is null or p_from>=p_before or p_before-p_from>interval '31 days' then
    raise exception 'Notification history requires a bounded window of at most 31 days';
  end if;
  for v_source in
    select h.registration_id,
      case when h.to_status='cancelled' then 'registration-status:' || h.id::text
        else 'registration:' || h.registration_id::text || ':submitted' end source_key,
      case when h.to_status='cancelled' then 'registration.cancelled' else 'registration.created' end kind,
      h.created_at
    from public.registration_status_history h
    where h.created_at>=p_from and h.created_at<p_before
      and ((h.to_status in ('pending','confirmed') and (h.from_status is null or h.from_status='draft'))
        or (h.to_status='cancelled' and h.from_status in ('pending','confirmed')))
    union all
    select p.registration_id,'registration-payment:' || p.id::text,'registration.payment.reported',p.created_at
    from public.registration_payment_events p
    where p.created_at>=p_from and p.created_at<p_before and p.event_type='reported' and p.source='athlete'
    order by created_at
  loop
    perform app_private.deliver_organizer_notification(v_source.registration_id,v_source.source_key,
      v_source.kind,v_source.created_at,true);
  end loop;

  -- Saved access decisions only: do not infer old decisions from current roles.
  for v_source in
    select q.*,c.name club_name,c.slug club_slug,a.display_name person_name,m.id membership_id
    from public.club_admin_role_requests q
    join public.clubs c on c.id=q.club_id and c.status='active'
    join public.athlete_profiles a on a.id=q.athlete_profile_id and a.status='active'
    left join public.club_memberships m on m.club_id=q.club_id and m.athlete_profile_id=q.athlete_profile_id
    where q.status in ('approved','rejected') and q.reviewed_at>=p_from and q.reviewed_at<p_before
      and not exists (
        select 1 from public.notification_events e join public.user_notifications n on n.event_id=e.id
        where n.user_id=q.claimant_user_id
          and (e.context_type='club_request' and e.context_id=q.id
            or e.context_type='club_membership' and e.context_id=m.id and n.created_at>=q.submitted_at)
          and n.kind in ('club.owner.approved','club.admin.approved','club.request.rejected')
      )
  loop
    insert into public.notification_events(source_key,context_type,context_id,created_at)
      values('club-request-history:' || v_source.id::text,'club_request',v_source.id,v_source.reviewed_at)
      on conflict(source_key) do update set source_key=excluded.source_key returning id into v_event;
    for v_recipient in
      select v_source.claimant_user_id user_id,
        case when v_source.status='rejected' then 'club.request.rejected'
          when v_source.requested_role_key='owner' then 'club.owner.approved' else 'club.admin.approved' end kind
      union all
      select distinct a.claimed_by_user_id,'club.owner.changed'
      from public.club_memberships m join public.athlete_profiles a on a.id=m.athlete_profile_id and a.status='active'
      where v_source.status='approved' and v_source.requested_role_key='owner'
        and m.club_id=v_source.club_id and m.status='active'
        and coalesce(m.joined_at,m.created_at)<=v_source.reviewed_at
        and a.claimed_by_user_id is distinct from v_source.claimant_user_id
    loop
      insert into public.user_notifications(event_id,user_id,kind,category,club_name,person_name,
        target_path,created_at,read_at,is_historical)
      select v_event,v_recipient.user_id,v_recipient.kind,'clubs',v_source.club_name,v_source.person_name,
        case when v_recipient.kind='club.owner.changed' then '/clubs/' || v_source.club_slug
          else '/athlete/clubs' end,v_source.reviewed_at,statement_timestamp(),true
      where exists(select 1 from public.user_profiles where user_id=v_recipient.user_id and status='active')
      on conflict(event_id,user_id) do nothing;
    end loop;
  end loop;
end;
$$;
revoke all on function app_private.backfill_notification_history(timestamptz,timestamptz) from public,anon,authenticated,service_role;

-- Current permission and source availability apply to every page AND the badge.
-- Removing organizer access immediately hides its private registration activity.
create or replace function public.service_notification_inbox(
  p_user_id uuid,p_filter text default 'all',p_before_at timestamptz default null,
  p_before_id uuid default null,p_limit integer default 25
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with visible as materialized (
    select n.* from public.user_notifications n where n.user_id=p_user_id
      and (n.category<>'events' or exists (
        select 1 from public.registrations r
        join public.event_categories c on c.id=r.event_category_id and c.organizer_deleted_at is null
        join public.athlete_profiles a on a.id=r.athlete_profile_id and a.status='active'
        where r.id=n.registration_id and r.organizer_removed_at is null and c.event_edition_id=n.event_edition_id
          and exists(select 1 from app_private.organizer_notification_recipients(n.event_edition_id,n.required_permission,now()) recipient
            where recipient.user_id=p_user_id)
      ))
  ), page as (
    select n.* from visible n
    where case when p_filter='archived' then n.archived_at is not null
      else n.archived_at is null and (p_filter<>'unread' or n.read_at is null) end
      and (p_before_at is null or (n.created_at,n.id)<(p_before_at,p_before_id))
    order by n.created_at desc,n.id desc limit least(greatest(p_limit,1),50)+1
  ) select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'kind',kind,'category',category,'clubName',club_name,'personName',person_name,
      'eventName',event_name,'isHistorical',is_historical,
      'roleName',role_name,'targetPath',target_path,'actionRequired',action_required,
      'resolvedAt',resolved_at,'readAt',read_at,'archivedAt',archived_at,'createdAt',created_at
    ) order by created_at desc,id desc) from page),'[]'::jsonb),
    'unreadCount',(select count(*) from visible where read_at is null and archived_at is null),
    'snapshotAt',statement_timestamp()
  );
$$;
revoke all on function public.service_notification_inbox(uuid,text,timestamptz,uuid,integer) from public,anon,authenticated;
grant execute on function public.service_notification_inbox(uuid,text,timestamptz,uuid,integer) to service_role;

-- Fresh database: do not invoke historical notification backfill.
commit;
