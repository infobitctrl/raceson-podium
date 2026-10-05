-- Club standings can either remain inside each league competition (for
-- example, independent Short and Long club tables) or pool every mapped race
-- into one season-wide club championship. Keep existing leagues on the public
-- behavior they had before this setting, then explicitly opt the Šibenik
-- league into its intended combined Short + Long table.

alter table public.league_seasons
  add column if not exists club_scoring_scope text not null default 'per_competition';

alter table public.league_seasons
  drop constraint if exists league_seasons_club_scoring_scope_check;

alter table public.league_seasons
  add constraint league_seasons_club_scoring_scope_check
  check (club_scoring_scope in ('combined', 'per_competition'));

update public.league_seasons season
set club_scoring_scope = 'combined'
from public.leagues league
where league.id = season.league_id
  and league.slug in (
    'sibenska-trail-liga',
    'si-trail-liga',
    's-i-trail-liga',
    'sibenik-trail-league'
  );

comment on column public.league_seasons.club_scoring_scope is
  'Controls whether club standings combine mapped races across league competitions or remain separate per competition.';
