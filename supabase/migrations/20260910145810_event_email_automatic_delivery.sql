-- Delivery is activated separately after the exact-source production release,
-- Gmail authorization and scheduler verification. No historical confirmation blast.
create table public.event_email_runtime (
  singleton boolean primary key default true check (singleton),
  enabled_at timestamptz,
  paused boolean not null default true,
  last_worker_at timestamptz
);
create table public.event_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations(id) on delete cascade,
  template_key text not null check (template_key in ('registration','reminder','results')),
  state text not null default 'queued' check (state in ('queued','sending','sent','failed','uncertain')),
  claim_token uuid,
  payload_json jsonb,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  attempted_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  failure_code text,
  unique(registration_id, template_key)
);
create index event_email_deliveries_pending_idx on public.event_email_deliveries(next_attempt_at)
  where state = 'queued';
alter table public.event_email_runtime enable row level security;
alter table public.event_email_deliveries enable row level security;
revoke all on public.event_email_runtime, public.event_email_deliveries from public, anon, authenticated;
grant select, insert, update, delete on public.event_email_runtime, public.event_email_deliveries to service_role;

-- Service-only projection: recipient course, current schedule, active profile and
-- latest publication are re-read at each claim, never copied from preview data.
create view public.event_email_candidates with (security_invoker = true) as
select r.id registration_id, s.template_key, e.id event_edition_id,
  case s.template_key when 'registration' then r.created_at else
    (((c.start_at at time zone e.timezone)::date +
      case s.template_key when 'reminder' then -1 when 'results' then case s.settings_json #>> '{schedule,daysAfter}' when '2' then 2 else 1 end end)
      + (s.settings_json #>> '{schedule,localTime}')::time) at time zone e.timezone end due_at,
  r.created_at, c.start_at,
  ((c.start_at at time zone e.timezone)::date::timestamp at time zone e.timezone) reminder_expires_at,
  (s.template_key <> 'results' or
    (p.publication_state in ('official','corrected') and rr.id is not null and e.results_visibility = 'public')) ready,
  jsonb_build_object(
    'templateKey', s.template_key, 'settings', s.settings_json, 'settingsVersion', s.updated_at,
    'recipient', a.primary_email, 'firstName', a.first_name, 'fullName', a.display_name,
    'editionId', e.id, 'eventSlug', e.slug, 'eventName', e.name, 'timezone', e.timezone,
    'courseSlug', c.slug, 'courseName', c.name, 'startAt', c.start_at,
    'distanceKm', c.distance_km, 'elevationM', c.elevation_gain_m,
    'location', coalesce((select l.label from public.event_locations l where l.event_edition_id = e.id
       and l.location_type in ('start_zone','start') order by (l.location_type = 'start_zone') desc, l.display_order, l.id limit 1), e.location_name, ''),
    'socialLinks', jsonb_build_array(
      jsonb_build_object('label','Web','url',coalesce(nullif(e.website_url,''),o.website_url)),
      jsonb_build_object('label','Instagram','url',coalesce(nullif(e.instagram_url,''),o.instagram_url)),
      jsonb_build_object('label','Facebook','url',coalesce(nullif(e.facebook_url,''),o.facebook_url)),
      jsonb_build_object('label','LinkedIn','url',o.linkedin_url),
      jsonb_build_object('label','YouTube','url',o.youtube_url),
      jsonb_build_object('label','TikTok','url',o.tiktok_url),
      jsonb_build_object('label','X','url',o.x_url)),
    'timeline', coalesce(e.general_timeline_json,'[]'::jsonb),
    'organizerName', o.name, 'registrationStatus', r.status, 'paymentStatus', r.payment_status,
    'bibNumber', (select b.bib_number from public.bib_assignments b where b.registration_id = r.id and b.revoked_at is null order by b.id limit 1),
    'publicationId', case when s.template_key = 'results' then p.id end,
    'resultStatus', rr.result_status, 'finishTimeMs', rr.finish_time_ms,
    'rankOverall', rr.rank_overall, 'rankGender', rr.rank_gender, 'rankCategory', rr.rank_age_category
  ) payload_json
from public.registrations r
join public.event_categories c on c.id = r.event_category_id
join public.event_editions e on e.id = c.event_edition_id
join public.event_series es on es.id = e.event_series_id
join public.organizations o on o.id = es.organization_id
join public.athlete_profiles a on a.id = r.athlete_profile_id
join public.event_communication_settings s on s.event_edition_id = e.id
left join lateral (select p.* from public.result_publications p where p.event_category_id = c.id
  order by p.published_at desc, p.created_at desc, p.id desc limit 1) p on true
left join public.result_rows rr on rr.result_run_id = p.result_run_id and rr.registration_id = r.id
where not e.is_practice and e.published_at is not null and e.public_visibility = 'public'
  and e.organizer_deleted_at is null and c.organizer_deleted_at is null
  and e.status::text not in ('archived','cancelled') and c.status::text <> 'cancelled'
  and r.organizer_removed_at is null and r.status::text in ('pending','confirmed','waitlisted','offered')
  and a.status = 'active' and a.primary_email is not null
  and (s.template_key <> 'reminder' or (c.status::text <> 'completed' and e.status::text <> 'completed'))
  and (s.template_key <> 'registration' or r.source in ('direct','guest','organizer_onsite'))
  and (s.settings_json #>> '{schedule,localTime}') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  and ((s.template_key = 'registration' and s.settings_json #>> '{schedule,mode}' = 'registration')
    or (s.template_key = 'reminder' and s.settings_json #>> '{schedule,mode}' = 'day_before')
    or (s.template_key = 'results' and s.settings_json #>> '{schedule,mode}' = 'after_race'
       and s.settings_json #>> '{schedule,daysAfter}' in ('1','2')));
revoke all on public.event_email_candidates from public, anon, authenticated;
grant select on public.event_email_candidates to service_role;

create function public.service_claim_event_email() returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare runtime public.event_email_runtime%rowtype; delivery public.event_email_deliveries%rowtype; source jsonb;
begin
  select * into runtime from public.event_email_runtime where singleton for update;
  if runtime.enabled_at is null or runtime.paused then return null; end if;
  update public.event_email_runtime set last_worker_at = clock_timestamp() where singleton;
  -- A worker may have died after Gmail accepted its message. Never automatically
  -- resend an ambiguous attempt; an operator must reconcile the Sent mailbox.
  update public.event_email_deliveries set state = 'uncertain', failure_code = 'worker_interrupted'
    where state = 'sending' and attempted_at < now() - interval '5 minutes';
  if (select count(*) from public.event_email_deliveries where attempted_at > now() - interval '24 hours') >= 400 then return null; end if;
  insert into public.event_email_deliveries(registration_id, template_key)
    select c.registration_id, c.template_key from public.event_email_candidates c
    where c.ready and c.due_at >= runtime.enabled_at and c.due_at <= now()
      and (c.template_key <> 'reminder' or c.reminder_expires_at > now())
      and not exists (select 1 from public.event_email_deliveries d
        where d.registration_id = c.registration_id and d.template_key = c.template_key)
    order by c.due_at, c.registration_id, c.template_key limit 100
    on conflict (registration_id, template_key) do nothing;
  select d.* into delivery from public.event_email_deliveries d
    join public.event_email_candidates c using (registration_id, template_key)
    where d.state = 'queued' and d.next_attempt_at <= now() and c.ready
      and c.due_at >= runtime.enabled_at and c.due_at <= now()
      and (c.template_key <> 'reminder' or c.reminder_expires_at > now())
    order by c.due_at, d.id for update of d skip locked limit 1;
  if delivery.id is null then return null; end if;
  select c.payload_json into source from public.event_email_candidates c
    where c.registration_id = delivery.registration_id and c.template_key = delivery.template_key;
  update public.event_email_deliveries set state = 'sending', claim_token = gen_random_uuid(),
    payload_json = source, attempt_count = attempt_count + 1, attempted_at = clock_timestamp(), failure_code = null
    where id = delivery.id returning * into delivery;
  return jsonb_build_object('id', delivery.id, 'token', delivery.claim_token, 'payload', delivery.payload_json);
end;
$$;

-- Recheck after rendering, immediately before external IO. Cancellation, schedule
-- edits, identity changes and withdrawn/replaced results invalidate this attempt.
create function public.service_check_event_email(p_id uuid, p_token uuid) returns boolean
language sql security invoker set search_path = '' as $$
  select exists(select 1 from public.event_email_deliveries d
    join public.event_email_candidates c using(registration_id, template_key)
    join public.event_email_runtime runtime on runtime.singleton
    where d.id = p_id and d.claim_token = p_token and d.state = 'sending'
      and d.attempted_at > now() - interval '2 minutes' and not runtime.paused
      and runtime.enabled_at is not null and c.due_at >= runtime.enabled_at and c.due_at <= now()
      and c.ready and c.payload_json = d.payload_json
      and (c.template_key <> 'reminder' or c.reminder_expires_at > now()));
$$;
create function public.service_finish_event_email(p_id uuid, p_token uuid, p_outcome text, p_provider_id text default null)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare affected integer;
begin
  if p_outcome not in ('sent','failed','uncertain','retry','changed') or
    (p_outcome = 'sent' and nullif(p_provider_id,'') is null) then raise exception 'email_outcome_invalid'; end if;
  update public.event_email_deliveries set
    state = case when p_outcome = 'changed' or (p_outcome = 'retry' and attempt_count < 5) then 'queued'
      when p_outcome = 'retry' then 'failed' else p_outcome end,
    next_attempt_at = now() + case when p_outcome = 'changed' then interval '1 minute' else interval '10 minutes' end,
    failure_code = case when p_outcome = 'sent' then null else p_outcome end,
    sent_at = case when p_outcome = 'sent' then now() end, provider_message_id = p_provider_id
  where id = p_id and claim_token = p_token and state in ('sending','uncertain');
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;
revoke all on function public.service_claim_event_email(), public.service_check_event_email(uuid,uuid),
  public.service_finish_event_email(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.service_claim_event_email(), public.service_check_event_email(uuid,uuid),
  public.service_finish_event_email(uuid,uuid,text,text) to service_role;

create function public.service_event_email_status(p_edition_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  select jsonb_build_object('active', enabled_at is not null and not paused
      and coalesce(last_worker_at > now() - interval '3 minutes', false),
    'enabled', enabled_at is not null and not paused,
    'lastWorkerAt', last_worker_at,
    'attentionCount', (select count(*) from public.event_email_deliveries d
      join public.registrations r on r.id = d.registration_id
      join public.event_categories c on c.id = r.event_category_id
      where c.event_edition_id = p_edition_id and d.state in ('failed','uncertain')))
  from public.event_email_runtime where singleton;
$$;
revoke all on function public.service_event_email_status(uuid) from public, anon, authenticated;
grant execute on function public.service_event_email_status(uuid) to service_role;
