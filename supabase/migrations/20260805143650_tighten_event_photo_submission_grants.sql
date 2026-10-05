begin;

-- Supabase may grant browser roles table privileges automatically for newly
-- created objects. Keep metadata writes behind the server/service-role path;
-- authenticated athletes may only inspect or delete their own pending rows
-- through the RLS policies created with the table.
revoke all on table public.event_photo_submissions from authenticated;
grant select, delete on table public.event_photo_submissions to authenticated;

commit;
