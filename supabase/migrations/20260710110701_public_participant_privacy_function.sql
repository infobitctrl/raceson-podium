alter function public.public_event_participants(uuid)
  rename to public_event_participants_unfiltered;

revoke all on function public.public_event_participants_unfiltered(uuid)
  from public, anon, authenticated;
