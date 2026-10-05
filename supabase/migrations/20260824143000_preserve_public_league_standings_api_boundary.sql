-- The complete official league standings RPC remains available only to
-- authenticated/server roles. Public pages receive the narrower club
-- contribution projection through the application API.

revoke execute on function public.public_league_standings(uuid)
  from public, anon;

do $$
begin
  if has_function_privilege(
    'anon',
    'public.public_league_standings(uuid)',
    'execute'
  ) then
    raise exception 'Anonymous callers must use the bounded league club standings API';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.public_league_standings(uuid)',
    'execute'
  ) then
    raise exception 'Service role must retain league standings RPC access';
  end if;
end
$$;
