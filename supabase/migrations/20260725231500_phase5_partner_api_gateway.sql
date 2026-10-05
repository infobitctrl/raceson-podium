-- SiTrail V2 Phase 5: partner API request authentication and distributed rate limiting.

create table public.partner_api_rate_limit_windows (
  partner_api_client_id uuid not null
    references public.partner_api_clients (id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  last_request_at timestamptz not null default now(),
  primary key (partner_api_client_id, window_started_at)
);
create index partner_api_rate_limit_windows_last_request_idx
  on public.partner_api_rate_limit_windows (last_request_at);
create or replace function public.service_authenticate_partner_api_request(
  p_raw_credential text,
  p_source_ip inet
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $partner_request$
declare
  credential_digest text;
  client_row public.partner_api_clients%rowtype;
  resolved_window timestamptz;
  resolved_request_count integer;
  ip_allowed boolean;
begin
  if p_raw_credential !~ '^stp_live_[0-9a-f]{64}$' then
    return null;
  end if;

  credential_digest := encode(public.digest(p_raw_credential, 'sha256'), 'hex');
  select client.*
  into client_row
  from public.partner_api_clients client
  where client.credential_digest_sha256 = credential_digest
    and client.client_state = 'active'
    and (client.expires_at is null or client.expires_at > clock_timestamp())
  for update;
  if not found then
    return null;
  end if;

  if cardinality(client_row.allowed_ip_cidrs) > 0 then
    select p_source_ip is not null and exists (
      select 1
      from unnest(client_row.allowed_ip_cidrs) allowed(cidr_text)
      where p_source_ip <<= allowed.cidr_text::cidr
    )
    into ip_allowed;
    if not coalesce(ip_allowed, false) then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'ip_not_allowed',
        'clientId', client_row.id
      );
    end if;
  end if;

  resolved_window := date_trunc('minute', clock_timestamp());
  insert into public.partner_api_rate_limit_windows (
    partner_api_client_id,
    window_started_at,
    request_count,
    last_request_at
  )
  values (
    client_row.id,
    resolved_window,
    1,
    clock_timestamp()
  )
  on conflict (partner_api_client_id, window_started_at)
  do update set
    request_count = public.partner_api_rate_limit_windows.request_count + 1,
    last_request_at = clock_timestamp()
  returning request_count into resolved_request_count;

  update public.partner_api_clients client
  set last_used_at = clock_timestamp()
  where client.id = client_row.id;

  delete from public.partner_api_rate_limit_windows rate_window
  where rate_window.partner_api_client_id = client_row.id
    and rate_window.window_started_at < resolved_window - interval '2 days';

  if resolved_request_count > client_row.rate_limit_per_minute then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'rate_limited',
      'clientId', client_row.id,
      'rateLimitPerMinute', client_row.rate_limit_per_minute,
      'requestCount', resolved_request_count,
      'retryAfterSeconds', greatest(
        1,
        extract(epoch from (resolved_window + interval '1 minute' - clock_timestamp()))::integer
      )
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'clientId', client_row.id,
    'organizationId', client_row.organization_id,
    'clientKey', client_row.client_key,
    'scopes', to_jsonb(client_row.scopes),
    'rateLimitPerMinute', client_row.rate_limit_per_minute,
    'requestCount', resolved_request_count,
    'windowStartedAt', resolved_window,
    'allowedIpCidrs', to_jsonb(client_row.allowed_ip_cidrs)
  );
end
$partner_request$;
alter table public.partner_api_rate_limit_windows enable row level security;
revoke all on table public.partner_api_rate_limit_windows
  from public, anon, authenticated;
revoke all on function public.service_authenticate_partner_api_request(text,inet)
  from public, anon, authenticated;
grant execute on function public.service_authenticate_partner_api_request(text,inet)
  to service_role;
