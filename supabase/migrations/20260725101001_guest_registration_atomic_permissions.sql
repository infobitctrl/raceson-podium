do $$
begin
  execute 'revoke all on function public.create_guest_registration_atomically(
    uuid, text, text, text, text, text, date, text, text, text, text,
    text, text, text, text, boolean, text, text
  ) from public, anon, authenticated';

  execute 'grant execute on function public.create_guest_registration_atomically(
    uuid, text, text, text, text, text, date, text, text, text, text,
    text, text, text, text, boolean, text, text
  ) to service_role';
end
$$;
