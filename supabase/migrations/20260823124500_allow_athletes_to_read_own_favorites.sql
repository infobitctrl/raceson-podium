/*
 * Favorite mutations remain behind the application API, but authenticated
 * athlete pages need to read the current user's rows to render follow state.
 * The existing athlete_favorites_select_self RLS policy limits that read to
 * athlete profiles owned by the requesting account.
 */

revoke select on table public.athlete_favorites from anon;
grant select on table public.athlete_favorites to authenticated;
