do $$
begin
  execute 'revoke all on function public.create_registration_atomically(uuid, uuid, uuid, uuid, text, text, timestamptz, boolean, text, text) from public, anon, authenticated';
  execute 'grant execute on function public.create_registration_atomically(uuid, uuid, uuid, uuid, text, text, timestamptz, boolean, text, text) to service_role';
  execute 'revoke all on function public.publish_result_run_atomically(uuid, uuid, public.publication_state, uuid, text) from public, anon, authenticated';
  execute 'grant execute on function public.publish_result_run_atomically(uuid, uuid, public.publication_state, uuid, text) to service_role';
  execute 'revoke all on function public.public_event_participants(uuid) from public';
  execute 'grant execute on function public.public_event_participants(uuid) to anon, authenticated, service_role';
end;
$$;
