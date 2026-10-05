begin;

create or replace function public.request_jwt_claims()
returns jsonb
language sql
stable
as $$
  select coalesce(
    case
      when nullif(current_setting('request.jwt.claims', true), '') is not null
        then nullif(current_setting('request.jwt.claims', true), '')::jsonb
      else null
    end,
    '{}'::jsonb
  )
$$;

create or replace function public.request_user_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    case
      when nullif(current_setting('request.jwt.claim.sub', true), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      else null
    end,
    case
      when nullif(public.request_jwt_claims() ->> 'sub', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then nullif(public.request_jwt_claims() ->> 'sub', '')::uuid
      else null
    end
  )
$$;

create or replace function public.request_jwt_role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(public.request_jwt_claims() ->> 'role', ''),
    nullif(current_setting('role', true), ''),
    'anon'
  )
$$;

commit;
