begin;

/*
 * Authenticated account support stays behind the application server boundary.
 * Requesters can see only their own conversation through the API; platform
 * administrators receive the same tickets in the unified request inbox.
 */

create table public.platform_support_tickets (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references auth.users (id) on delete cascade,
  subject text not null,
  category text not null default 'general',
  status text not null default 'open',
  assigned_to_user_id uuid references auth.users (id) on delete set null,
  last_message_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (length(trim(subject)) between 3 and 160),
  check (category in ('general', 'account', 'athlete_profile', 'club', 'event', 'technical', 'other')),
  check (status in ('open', 'in_progress', 'resolved', 'closed')),
  check (status <> 'resolved' or resolved_at is not null),
  check (status <> 'closed' or closed_at is not null)
);

create table public.platform_support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.platform_support_tickets (id) on delete cascade,
  author_user_id uuid references auth.users (id) on delete set null,
  author_kind text not null,
  body text not null,
  created_at timestamptz not null default clock_timestamp(),
  check (author_kind in ('requester', 'platform_admin')),
  check (length(trim(body)) between 1 and 5000)
);

create index platform_support_tickets_requester_idx
  on public.platform_support_tickets (requester_user_id, last_message_at desc);

create index platform_support_tickets_inbox_idx
  on public.platform_support_tickets (status, last_message_at desc);

create index platform_support_ticket_messages_thread_idx
  on public.platform_support_ticket_messages (ticket_id, created_at, id);

create trigger platform_support_tickets_set_updated_at
before update on public.platform_support_tickets
for each row execute function public.set_updated_at();

alter table public.platform_support_tickets enable row level security;
alter table public.platform_support_ticket_messages enable row level security;

revoke all on table public.platform_support_tickets
  from public, anon, authenticated;
revoke all on table public.platform_support_ticket_messages
  from public, anon, authenticated;

grant select, insert, update, delete on table public.platform_support_tickets
  to service_role;
grant select, insert, update, delete on table public.platform_support_ticket_messages
  to service_role;

create or replace function public.service_create_support_ticket(
  p_requester_user_id uuid,
  p_subject text,
  p_category text,
  p_body text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_ticket public.platform_support_tickets%rowtype;
  saved_message public.platform_support_ticket_messages%rowtype;
begin
  if p_requester_user_id is null then
    raise exception using errcode = '28000', message = 'support_ticket_authentication_required';
  end if;

  insert into public.platform_support_tickets (
    requester_user_id,
    subject,
    category
  ) values (
    p_requester_user_id,
    trim(p_subject),
    p_category
  )
  returning * into saved_ticket;

  insert into public.platform_support_ticket_messages (
    ticket_id,
    author_user_id,
    author_kind,
    body
  ) values (
    saved_ticket.id,
    p_requester_user_id,
    'requester',
    trim(p_body)
  )
  returning * into saved_message;

  insert into public.audit_log (
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  ) values (
    p_requester_user_id,
    'platform_support_ticket',
    saved_ticket.id,
    'support.ticket_created',
    jsonb_build_object('category', saved_ticket.category)
  );

  return jsonb_build_object(
    'ticketId', saved_ticket.id,
    'messageId', saved_message.id,
    'status', saved_ticket.status,
    'createdAt', saved_ticket.created_at
  );
end;
$$;

create or replace function public.service_append_support_ticket_message(
  p_actor_user_id uuid,
  p_ticket_id uuid,
  p_author_kind text,
  p_body text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ticket_row public.platform_support_tickets%rowtype;
  saved_message public.platform_support_ticket_messages%rowtype;
  next_status text;
begin
  select *
  into ticket_row
  from public.platform_support_tickets ticket
  where ticket.id = p_ticket_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'support_ticket_not_found';
  end if;

  if ticket_row.status = 'closed' then
    raise exception using errcode = '55000', message = 'support_ticket_closed';
  end if;

  if p_author_kind = 'requester' then
    if ticket_row.requester_user_id <> p_actor_user_id then
      raise exception using errcode = '42501', message = 'support_ticket_access_denied';
    end if;
    next_status := case when ticket_row.status = 'resolved' then 'open' else ticket_row.status end;
  elsif p_author_kind = 'platform_admin' then
    if not public.is_active_platform_administrator(p_actor_user_id) then
      raise exception using errcode = '42501', message = 'support_ticket_admin_required';
    end if;
    next_status := case when ticket_row.status = 'open' then 'in_progress' else ticket_row.status end;
  else
    raise exception using errcode = '22023', message = 'support_ticket_author_invalid';
  end if;

  insert into public.platform_support_ticket_messages (
    ticket_id,
    author_user_id,
    author_kind,
    body
  ) values (
    p_ticket_id,
    p_actor_user_id,
    p_author_kind,
    trim(p_body)
  )
  returning * into saved_message;

  update public.platform_support_tickets ticket
  set status = next_status,
      assigned_to_user_id = case
        when p_author_kind = 'platform_admin' then p_actor_user_id
        else ticket.assigned_to_user_id
      end,
      last_message_at = saved_message.created_at,
      resolved_at = case when next_status = 'resolved' then ticket.resolved_at else null end
  where ticket.id = p_ticket_id;

  insert into public.audit_log (
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  ) values (
    p_actor_user_id,
    'platform_support_ticket',
    p_ticket_id,
    'support.message_added',
    jsonb_build_object('authorKind', p_author_kind, 'status', next_status)
  );

  return jsonb_build_object(
    'ticketId', p_ticket_id,
    'messageId', saved_message.id,
    'status', next_status,
    'createdAt', saved_message.created_at
  );
end;
$$;

create or replace function public.service_update_support_ticket_status(
  p_actor_user_id uuid,
  p_ticket_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed_at timestamptz := clock_timestamp();
begin
  if not public.is_active_platform_administrator(p_actor_user_id) then
    raise exception using errcode = '42501', message = 'support_ticket_admin_required';
  end if;

  if p_status not in ('open', 'in_progress', 'resolved', 'closed') then
    raise exception using errcode = '22023', message = 'support_ticket_status_invalid';
  end if;

  update public.platform_support_tickets ticket
  set status = p_status,
      assigned_to_user_id = coalesce(ticket.assigned_to_user_id, p_actor_user_id),
      resolved_at = case when p_status = 'resolved' then changed_at else null end,
      closed_at = case when p_status = 'closed' then changed_at else null end
  where ticket.id = p_ticket_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'support_ticket_not_found';
  end if;

  insert into public.audit_log (
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  ) values (
    p_actor_user_id,
    'platform_support_ticket',
    p_ticket_id,
    'support.status_updated',
    jsonb_build_object('status', p_status)
  );

  return jsonb_build_object(
    'ticketId', p_ticket_id,
    'status', p_status,
    'updatedAt', changed_at
  );
end;
$$;

revoke all on function public.service_create_support_ticket(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.service_append_support_ticket_message(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.service_update_support_ticket_status(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.service_create_support_ticket(uuid, text, text, text)
  to service_role;
grant execute on function public.service_append_support_ticket_message(uuid, uuid, text, text)
  to service_role;
grant execute on function public.service_update_support_ticket_status(uuid, uuid, text)
  to service_role;

comment on table public.platform_support_tickets is
  'Authenticated account support tickets received and managed in the platform request inbox.';
comment on table public.platform_support_ticket_messages is
  'Requester and platform-administrator messages belonging to a support ticket.';

commit;
