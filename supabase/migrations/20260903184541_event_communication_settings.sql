-- Private configuration only. Delivery activation requires a separate release.
create table public.event_communication_settings (
  event_edition_id uuid not null references public.event_editions(id) on delete cascade,
  template_key text not null check (template_key in ('registration', 'reminder', 'results')),
  settings_json jsonb not null check (jsonb_typeof(settings_json) = 'object'),
  updated_by_user_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (event_edition_id, template_key)
);
alter table public.event_communication_settings enable row level security;
revoke all on public.event_communication_settings from public, anon, authenticated;
grant select, insert, update, delete on public.event_communication_settings to service_role;
comment on table public.event_communication_settings is
  'Organizer email content and preferred timing; API requires edition communications.manage. No delivery queue.';
