import { isSibenikTrailLeagueIdentity } from "@/features/leagues/model/sibenikTrailLeagueIdentity";

const sibenikTrailLeagueRaceSlugs = new Set([
  "vrpolje-trail-2026-2026",
  "torak-trail-2026",
  "trtarski-krug-2026",
  "raslina-trail-2026",
  "zlarin-trail-2026",
  "zlarin-trail-2026-2026",
]);

type HomepageFeaturedSetRace = {
  id?: string;
  slug?: string;
  organizerName?: string | null;
  leagueMemberships?: Array<{
    leagueName?: string | null;
    leagueSlug?: string | null;
  }>;
};

export function isSibenikTrailLeagueRace(race: HomepageFeaturedSetRace) {
  const slug = race.slug ?? race.id;
  if (slug && sibenikTrailLeagueRaceSlugs.has(slug)) return true;
  if (isSibenikTrailLeagueIdentity(race.organizerName)) return true;

  return race.leagueMemberships?.some((membership) => (
    isSibenikTrailLeagueIdentity(membership.leagueSlug)
    || isSibenikTrailLeagueIdentity(membership.leagueName)
  )) ?? false;
}
