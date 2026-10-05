begin;

-- Keep the storage-policy helper out of the anonymous RPC surface. Supabase
-- may assign explicit role grants in addition to PostgreSQL's PUBLIC grant.
revoke all on function public.can_submit_event_photo(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.can_submit_event_photo(uuid, uuid, uuid)
  to authenticated, service_role;

commit;
