import {
  PLATFORM_STATISTICS_METRICS, buildPlatformStatisticsSeries, platformStatisticsDate, platformStatisticsWindow,
  type PlatformStatistics, type PlatformStatisticsMetric, type PlatformStatisticsPeriod,
} from "@raceson/domain";

type Dated = { id: string; created_at: string };
export type PlatformStatisticsSource = {
  athletes: Array<Dated & { status: string; merged_into_athlete_profile_id: string | null }>;
  accounts: Array<Dated>;
  organizations: Array<Dated & { name: string; status: string }>;
  series: Array<{ id: string; organization_id: string }>;
  editions: Array<Dated & { event_series_id: string; published_at: string | null; status: string; is_practice: boolean; organizer_deleted_at: string | null }>;
  categories: Array<Dated & { event_edition_id: string; status: string; results_mode: string; organizer_deleted_at: string | null }>;
  registrations: Array<Dated & { event_category_id: string; athlete_profile_id: string; status: string; source: string }>;
  clubs: Array<Dated & { status: string; merged_into_club_id: string | null }>;
  leagues: Array<Dated>;
  seasons: Array<Dated & { league_id: string; published_at: string | null }>;
  rounds: Array<{ id: string; league_season_id: string; event_edition_id: string | null }>;
  routes: Array<Dated>;
  versions: Array<{ id: string; track_template_id: string; published_at: string | null }>;
  snapshots: Array<{ id: string; track_template_id: string; event_category_id: string }>;
};

function canonicalIds<T extends Dated>(rows: T[], merge: (row: T) => string | null, valid: (row: T) => boolean) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const result = new Map<string, string>();
  for (const row of rows) {
    let current: T | undefined = row;
    const visited = new Set<string>();
    while (current && merge(current) && !visited.has(current.id)) {
      visited.add(current.id);
      current = byId.get(merge(current)!);
    }
    if (current && !merge(current) && valid(current)) result.set(row.id, current.id);
  }
  return result;
}

export function buildPlatformStatistics(source: PlatformStatisticsSource, period: PlatformStatisticsPeriod, asOf = new Date()): PlatformStatistics {
  const timestampCache = new Map<string, string | null>();
  const timestamp = (value: string | null) => {
    if (!value) return null;
    if (!timestampCache.has(value)) timestampCache.set(value, new Date(value).getTime() <= asOf.getTime() ? platformStatisticsDate(value) : null);
    return timestampCache.get(value)!;
  };
  const realIdentity = (row: { status: string }) => row.status !== "deleted" && row.status !== "practice";
  const athleteIds = canonicalIds(source.athletes, (row) => row.merged_into_athlete_profile_id, realIdentity);
  const clubIds = canonicalIds(source.clubs, (row) => row.merged_into_club_id, realIdentity);
  const organizations = new Map(source.organizations.filter((row) => row.status !== "deleted").map((row) => [row.id, row]));
  const series = new Map(source.series.filter((row) => organizations.has(row.organization_id)).map((row) => [row.id, row]));
  const editions = new Map(source.editions.filter((row) => !row.is_practice && !row.organizer_deleted_at && series.has(row.event_series_id)).map((row) => [row.id, row]));
  const categories = new Map(source.categories.filter((row) => editions.has(row.event_edition_id) && !row.organizer_deleted_at && row.results_mode !== "informative_age").map((row) => [row.id, row]));
  const registrations = source.registrations.filter((row) => categories.has(row.event_category_id) && row.status !== "draft" && timestamp(row.created_at));
  const nativeSources = new Set(["direct", "guest", "organizer_onsite"]);
  const native = registrations.filter((row) => nativeSources.has(row.source));
  // Keep imported racing history for first-observed classification, but not acquisition.
  const earliestAthleteEntry = new Map<string, string>();
  for (const row of registrations) {
    if (row.status === "cancelled") continue;
    const athlete = athleteIds.get(row.athlete_profile_id);
    const date = timestamp(row.created_at);
    if (athlete && date && (!earliestAthleteEntry.has(athlete) || earliestAthleteEntry.get(athlete)! > date)) earliestAthleteEntry.set(athlete, date);
  }
  function identityDates<T extends Dated>(rows: T[], ids: Map<string, string>) {
    const dates = new Map<string, string | null>();
    for (const row of rows) {
      const canonical = ids.get(row.id);
      if (!canonical) continue;
      const date = timestamp(row.created_at);
      if (!dates.has(canonical) || (date && (!dates.get(canonical) || date < dates.get(canonical)!))) dates.set(canonical, date);
    }
    return [...dates.values()];
  }
  const seasonsWithRounds = new Set(source.rounds.map((round) => round.league_season_id));
  const seasonsWithRealRounds = new Set(source.rounds.filter((round) => !round.event_edition_id || editions.has(round.event_edition_id)).map((round) => round.league_season_id));
  const validSeasonIds = new Set(source.seasons.filter((season) => !seasonsWithRounds.has(season.id) || seasonsWithRealRounds.has(season.id)).map((season) => season.id));
  const leagueIds = new Set(source.leagues.map((row) => row.id));
  const publishedLeagueDates = new Map<string, string>();
  for (const season of source.seasons) {
    const date = timestamp(season.published_at);
    if (!validSeasonIds.has(season.id) || !date || !leagueIds.has(season.league_id)) continue;
    if (!publishedLeagueDates.has(season.league_id) || date < publishedLeagueDates.get(season.league_id)!) publishedLeagueDates.set(season.league_id, date);
  }
  const usedRoutes = new Set(source.snapshots.map((row) => row.track_template_id));
  const realRoutes = new Set(source.snapshots.filter((row) => categories.has(row.event_category_id)).map((row) => row.track_template_id));
  const routeIds = new Set(source.routes.filter((route) => !usedRoutes.has(route.id) || realRoutes.has(route.id)).map((row) => row.id));
  const publishedRouteDates = new Map<string, string>();
  for (const version of source.versions) {
    const date = timestamp(version.published_at);
    if (!routeIds.has(version.track_template_id) || !date) continue;
    if (!publishedRouteDates.has(version.track_template_id) || date < publishedRouteDates.get(version.track_template_id)!) publishedRouteDates.set(version.track_template_id, date);
  }
  const dates: Record<PlatformStatisticsMetric, Array<string | null>> = {
    registrations: native.map((row) => timestamp(row.created_at)),
    athletes: identityDates(source.athletes, athleteIds),
    accounts: source.accounts.map((row) => timestamp(row.created_at)),
    events: [...editions.values()].filter((row) => row.status !== "draft" && row.published_at).map((row) => timestamp(row.published_at)),
    races: [...categories.values()].map((row) => timestamp(row.created_at)),
    organizers: [...organizations.values()].map((row) => timestamp(row.created_at)),
    clubs: identityDates(source.clubs, clubIds),
    leagues: [...publishedLeagueDates.values()],
    routes: [...publishedRouteDates.values()],
  };
  const earliest = Object.values(dates).flat().filter((date): date is string => date !== null).sort()[0];
  const window = platformStatisticsWindow(period, asOf, earliest);
  const inWindow = (row: Dated) => { const date = timestamp(row.created_at); return Boolean(date && date >= window.startDate && date <= window.endDate); };
  const participation = window.buckets.map((bucket) => {
    const first = new Set<string>(); const returning = new Set<string>();
    for (const row of native) {
      const date = timestamp(row.created_at)!;
      const athlete = athleteIds.get(row.athlete_profile_id);
      if (row.status === "cancelled" || !athlete || date < bucket.start || date >= bucket.end) continue;
      if (earliestAthleteEntry.get(athlete)! < bucket.start) returning.add(athlete); else first.add(athlete);
    }
    return { date: bucket.start, firstObserved: first.size, returning: returning.size, partial: bucket.partial };
  });
  const organizerActivity = new Map<string, { registrations: number; athletes: Set<string> }>();
  for (const row of native.filter(inWindow)) {
    if (row.status === "cancelled") continue;
    const category = categories.get(row.event_category_id)!;
    const organizationId = series.get(editions.get(category.event_edition_id)!.event_series_id)!.organization_id;
    const activity = organizerActivity.get(organizationId) ?? { registrations: 0, athletes: new Set<string>() };
    activity.registrations++;
    const athleteId = athleteIds.get(row.athlete_profile_id);
    if (athleteId) activity.athletes.add(athleteId);
    organizerActivity.set(organizationId, activity);
  }
  return {
    period, interval: window.interval, timezone: "Europe/Zagreb", asOf: asOf.toISOString(), startDate: window.startDate, endDate: window.endDate,
    series: PLATFORM_STATISTICS_METRICS.map((key) => buildPlatformStatisticsSeries(key, dates[key], window)),
    participation,
    organizers: [...organizerActivity].map(([id, activity]) => ({ name: organizations.get(id)!.name, registrations: activity.registrations, athletes: activity.athletes.size })).sort((a, b) => b.registrations - a.registrations || a.name.localeCompare(b.name)),
    excludedRegistrations: registrations.filter((row) => !nativeSources.has(row.source) && inWindow(row)).length,
    cancelledRegistrations: native.filter((row) => row.status === "cancelled" && inWindow(row)).length,
  };
}
