import type {
  AthleteDailyStatistics,
  AthleteMonthlyStatistics,
  AthleteOfficialRaceStatistics,
  AthleteStatisticsHighlight,
  AthleteStatisticsRecentActivity,
  AthleteYearStatistics,
} from "@raceson/domain/athletes";
import type { RequestSession } from "@raceson/domain/auth";
import { badRequest } from "./errors.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { requireAthleteProfileId } from "./permissions.js";
import { resolvePublicRaceCoverImageUrl } from "./public-races.js";
import { createAdminSupabaseClient } from "./supabase.js";

const DEFAULT_STATISTICS_TIMEZONE = "Europe/Zagreb";
const LEGACY_GHOST_ACTIVITY_IDS = new Set([
  "40000000-0000-4000-8000-000000000020",
  "40000000-0000-4000-8000-000000000021",
  "40000000-0000-4000-8000-000000000022",
]);

export type AthleteActivityStatisticsRow = {
  id: string;
  track_template_id: string | null;
  source: string;
  title: string;
  performed_at: string;
  distance_km: number | string | null;
  elevation_gain_m: number | string | null;
  moving_time_seconds: number | string | null;
};

export type AthleteOfficialRaceStatisticsRow = {
  result_row_id: string;
  event_category_id: string;
  event_slug: string;
  event_name: string;
  event_image_url: string | null;
  category_name: string;
  distance_km: number | string | null;
  elevation_gain_m: number | string | null;
  event_date: string | null;
  finish_time_ms: number | string | null;
  rank_overall: number | string | null;
  total_finishers: number | string | null;
  outcome_label: string | null;
};

type LocalActivity = AthleteActivityStatisticsRow & {
  localDate: string;
  distanceKm: number | null;
  elevationGainM: number | null;
  movingSeconds: number | null;
};

type BuildAthleteYearStatisticsInput = {
  rows: AthleteActivityStatisticsRow[];
  year: number;
  timezone: string;
  asOf?: Date;
  earliestPerformedAt?: string | null;
  trackNames?: ReadonlyMap<string, string>;
  officialResultRows?: AthleteOfficialRaceStatisticsRow[];
};

function validTimezone(timezone: string | null | undefined) {
  const candidate = timezone?.trim() || DEFAULT_STATISTICS_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return DEFAULT_STATISTICS_TIMEZONE;
  }
}

function localDateParts(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = Number(values.get("year"));
  const month = Number(values.get("month"));
  const day = Number(values.get("day"));
  return {
    year,
    month,
    day,
    date: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function toNonNegativeNumber(value: number | string | null) {
  if (value === null || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function clampDate(year: number, month: number, day: number) {
  const safeDay = Math.min(day, daysInMonth(year, month));
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

function datesInYear(year: number) {
  const dates: string[] = [];
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  for (let cursor = start; cursor < end; cursor += 86_400_000) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return dates;
}

function isoWeekKey(localDate: string) {
  const date = new Date(`${localDate}T00:00:00Z`);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

function localizeActivities(
  rows: AthleteActivityStatisticsRow[],
  timezone: string,
) {
  return rows.flatMap<LocalActivity>((row) => {
    if (LEGACY_GHOST_ACTIVITY_IDS.has(row.id)) return [];
    const performedAt = new Date(row.performed_at);
    if (Number.isNaN(performedAt.getTime())) return [];
    return [{
      ...row,
      localDate: localDateParts(performedAt, timezone).date,
      distanceKm: toNonNegativeNumber(row.distance_km),
      elevationGainM: toNonNegativeNumber(row.elevation_gain_m),
      movingSeconds: toNonNegativeNumber(row.moving_time_seconds),
    }];
  });
}

function dailyTotals(activities: LocalActivity[]) {
  const totals = new Map<string, { activities: number; distanceKm: number }>();
  for (const activity of activities) {
    const current = totals.get(activity.localDate) ?? { activities: 0, distanceKm: 0 };
    current.activities += 1;
    current.distanceKm += activity.distanceKm ?? 0;
    totals.set(activity.localDate, current);
  }
  return totals;
}

function cumulativeTotals(year: number, totals: ReturnType<typeof dailyTotals>) {
  let runningDistance = 0;
  return new Map(datesInYear(year).map((date) => {
    runningDistance += totals.get(date)?.distanceKm ?? 0;
    return [date, round(runningDistance)] as const;
  }));
}

function availableYears(
  selectedYear: number,
  currentYear: number,
  earliestPerformedAt: string | null | undefined,
  timezone: string,
) {
  const earliestDate = earliestPerformedAt ? new Date(earliestPerformedAt) : null;
  const earliestYear = earliestDate && !Number.isNaN(earliestDate.getTime())
    ? localDateParts(earliestDate, timezone).year
    : Math.min(selectedYear, currentYear);
  const firstYear = Math.max(2000, Math.min(earliestYear, selectedYear, currentYear));
  const lastYear = Math.max(selectedYear, currentYear);
  return Array.from({ length: lastYear - firstYear + 1 }, (_, index) => lastYear - index);
}

function buildHighlights(activities: LocalActivity[]): AthleteStatisticsHighlight[] {
  let longest: LocalActivity | null = null;
  let biggestClimb: LocalActivity | null = null;

  for (const activity of activities) {
    if (activity.distanceKm !== null && (longest?.distanceKm ?? -1) < activity.distanceKm) {
      longest = activity;
    }
    if (activity.elevationGainM !== null && (biggestClimb?.elevationGainM ?? -1) < activity.elevationGainM) {
      biggestClimb = activity;
    }
  }

  return [
    ...(longest?.distanceKm !== null && longest?.distanceKm !== undefined ? [{
      kind: "longest" as const,
      activityId: longest.id,
      title: longest.title,
      value: round(longest.distanceKm, 1),
      unit: "km" as const,
    }] : []),
    ...(biggestClimb?.elevationGainM !== null && biggestClimb?.elevationGainM !== undefined ? [{
      kind: "biggest_climb" as const,
      activityId: biggestClimb.id,
      title: biggestClimb.title,
      value: Math.round(biggestClimb.elevationGainM),
      unit: "m" as const,
    }] : []),
  ];
}

function buildOfficialRaceStatistics(input: {
  rows: AthleteOfficialRaceStatisticsRow[];
  year: number;
  timezone: string;
  asOf: Date;
  selectedEndDate: string;
}): AthleteOfficialRaceStatistics {
  const results = input.rows
    .flatMap((row) => {
      if (!row.event_date || !row.event_date.startsWith(`${input.year}-`) || row.event_date > input.selectedEndDate) {
        return [];
      }
      const distanceKm = toNonNegativeNumber(row.distance_km);
      const elevationGainM = toNonNegativeNumber(row.elevation_gain_m);
      const finishTimeMs = toNonNegativeNumber(row.finish_time_ms);
      const rankOverall = toNonNegativeNumber(row.rank_overall);
      const totalFinishers = toNonNegativeNumber(row.total_finishers);
      return [{
        resultRowId: row.result_row_id,
        eventSlug: row.event_slug,
        eventName: row.event_name,
        eventImageUrl: row.event_image_url?.trim() || null,
        categoryName: row.category_name,
        eventDate: row.event_date,
        distanceKm: distanceKm === null ? null : round(distanceKm, 2),
        elevationGainM: elevationGainM === null ? null : Math.round(elevationGainM),
        finishTimeMs: finishTimeMs === null ? null : Math.round(finishTimeMs),
        rankOverall: rankOverall === null || rankOverall < 1 ? null : Math.round(rankOverall),
        totalFinishers: totalFinishers === null ? 0 : Math.round(totalFinishers),
        outcome: row.outcome_label?.trim().toLowerCase() || "unknown",
      }];
    })
    .sort((left, right) => right.eventDate.localeCompare(left.eventDate) || left.eventName.localeCompare(right.eventName));

  const finishes = results.filter((result) => result.outcome === "finished" && (result.finishTimeMs ?? 0) > 0);
  const months = Array.from({ length: 12 }, (_, index) => {
    const month = `${input.year}-${String(index + 1).padStart(2, "0")}`;
    const monthFinishes = finishes.filter((result) => result.eventDate.startsWith(month));
    return {
      month,
      finishes: monthFinishes.length,
      distanceKm: round(monthFinishes.reduce((sum, result) => sum + (result.distanceKm ?? 0), 0)),
    };
  });
  const rankedFinishes = finishes.flatMap((result) => result.rankOverall === null ? [] : [result.rankOverall]);
  const measuredDistanceFinishes = finishes.filter((result) => result.distanceKm !== null);
  const measuredElevationFinishes = finishes.filter((result) => result.elevationGainM !== null);

  return {
    meta: {
      asOf: input.asOf.toISOString(),
      timezone: input.timezone,
      coverage: {
        from: results.at(-1)?.eventDate ?? null,
        to: results[0]?.eventDate ?? null,
        completeness: "complete",
      },
      source: { kind: "official_result" },
    },
    totals: {
      participations: results.length,
      finishes: finishes.length,
      distanceKm: round(finishes.reduce((sum, result) => sum + (result.distanceKm ?? 0), 0)),
      distanceKnownFinishes: measuredDistanceFinishes.length,
      elevationGainM: measuredElevationFinishes.length
        ? Math.round(measuredElevationFinishes.reduce((sum, result) => sum + (result.elevationGainM ?? 0), 0))
        : null,
      elevationKnownFinishes: measuredElevationFinishes.length,
      podiums: finishes.filter((result) => result.rankOverall !== null && result.rankOverall <= 3).length,
      wins: finishes.filter((result) => result.rankOverall === 1).length,
      bestOverallRank: rankedFinishes.length ? Math.min(...rankedFinishes) : null,
    },
    months,
    results,
  };
}

export function buildAthleteYearStatistics({
  rows,
  year,
  timezone: requestedTimezone,
  asOf = new Date(),
  earliestPerformedAt,
  trackNames = new Map(),
  officialResultRows = [],
}: BuildAthleteYearStatisticsInput): AthleteYearStatistics {
  const timezone = validTimezone(requestedTimezone);
  const currentLocalDate = localDateParts(asOf, timezone);
  if (!Number.isInteger(year) || year < 2000 || year > currentLocalDate.year) {
    throw badRequest("Choose a valid statistics year");
  }

  const localizedActivities = localizeActivities(rows, timezone);
  const selectedEndDate = year === currentLocalDate.year
    ? currentLocalDate.date
    : `${year}-12-31`;
  const selectedActivities = localizedActivities
    .filter((activity) => (
      activity.localDate.startsWith(`${year}-`)
      && activity.localDate <= selectedEndDate
    ))
    .sort((left, right) => left.performed_at.localeCompare(right.performed_at));
  const priorYear = year - 1;
  const priorActivities = localizedActivities.filter(
    (activity) => activity.localDate.startsWith(`${priorYear}-`),
  );

  const selectedEndParts = selectedEndDate.split("-").map(Number);
  const priorEndDate = clampDate(priorYear, selectedEndParts[1], selectedEndParts[2]);

  const selectedDailyTotals = dailyTotals(selectedActivities);
  const priorDailyTotals = dailyTotals(priorActivities);
  const selectedCumulative = cumulativeTotals(year, selectedDailyTotals);
  const priorCumulative = cumulativeTotals(priorYear, priorDailyTotals);

  const days: AthleteDailyStatistics[] = datesInYear(year).map((date) => {
    const observed = date <= selectedEndDate;
    const totals = selectedDailyTotals.get(date);
    return {
      date,
      activityCount: observed ? totals?.activities ?? 0 : null,
      distanceKm: observed ? round(totals?.distanceKm ?? 0) : null,
      observed,
    };
  });

  const months: AthleteMonthlyStatistics[] = Array.from({ length: 12 }, (_, index) => {
    const monthNumber = index + 1;
    const month = `${year}-${String(monthNumber).padStart(2, "0")}`;
    const observed = `${month}-01` <= selectedEndDate;
    if (!observed) {
      return {
        month,
        distanceKm: null,
        activities: null,
        elevationGainM: null,
        observed: false,
      };
    }

    const monthActivities = selectedActivities.filter((activity) => activity.localDate.startsWith(month));
    const elevationValues = monthActivities.flatMap((activity) => (
      activity.elevationGainM === null ? [] : [activity.elevationGainM]
    ));
    return {
      month,
      distanceKm: round(monthActivities.reduce((sum, activity) => sum + (activity.distanceKm ?? 0), 0)),
      activities: monthActivities.length,
      elevationGainM: elevationValues.length
        ? Math.round(elevationValues.reduce((sum, value) => sum + value, 0))
        : null,
      observed: true,
    };
  });

  const cumulativeDistance = datesInYear(year).map((date) => {
    const [, month, day] = date.split("-").map(Number);
    const priorYearDate = clampDate(priorYear, month, day);
    const observed = date <= selectedEndDate;
    return {
      date,
      currentKm: observed ? selectedCumulative.get(date) ?? 0 : null,
      priorYearDate,
      priorYearKm: observed && priorYearDate <= priorEndDate
        ? priorCumulative.get(priorYearDate) ?? 0
        : null,
    };
  });

  const selectedDistance = round(selectedActivities.reduce(
    (sum, activity) => sum + (activity.distanceKm ?? 0),
    0,
  ));
  const comparablePriorActivities = priorActivities.filter(
    (activity) => activity.localDate <= priorEndDate,
  );
  const priorDistance = round(comparablePriorActivities.reduce(
    (sum, activity) => sum + (activity.distanceKm ?? 0),
    0,
  ));
  const elevationValues = selectedActivities.flatMap((activity) => (
    activity.elevationGainM === null ? [] : [activity.elevationGainM]
  ));
  const movingValues = selectedActivities.flatMap((activity) => (
    activity.movingSeconds === null ? [] : [activity.movingSeconds]
  ));
  const activeDates = new Set(selectedActivities.map((activity) => activity.localDate));
  const activeWeeks = new Set(selectedActivities.map((activity) => isoWeekKey(activity.localDate)));

  const recentActivities: AthleteStatisticsRecentActivity[] = selectedActivities
    .slice()
    .sort((left, right) => right.performed_at.localeCompare(left.performed_at))
    .slice(0, 8)
    .map((activity) => ({
      id: activity.id,
      title: activity.title,
      performedAt: activity.performed_at,
      source: activity.source,
      trackName: activity.track_template_id ? trackNames.get(activity.track_template_id) ?? null : null,
      distanceKm: activity.distanceKm === null ? null : round(activity.distanceKm, 1),
      elevationGainM: activity.elevationGainM === null ? null : Math.round(activity.elevationGainM),
      movingSeconds: activity.movingSeconds === null ? null : Math.round(activity.movingSeconds),
    }));
  const officialRaces = buildOfficialRaceStatistics({
    rows: officialResultRows,
    year,
    timezone,
    asOf,
    selectedEndDate,
  });
  const earliestOfficialResultDate = officialResultRows
    .flatMap((row) => row.event_date ? [row.event_date] : [])
    .sort()[0] ?? null;
  const earliestStatisticsDate = [earliestPerformedAt, earliestOfficialResultDate]
    .filter((value): value is string => Boolean(value))
    .sort()[0] ?? null;

  return {
    meta: {
      asOf: asOf.toISOString(),
      timezone,
      coverage: {
        from: selectedActivities[0]?.localDate ?? null,
        to: selectedActivities.at(-1)?.localDate ?? null,
        completeness: "complete",
      },
      source: {
        kind: "recorded_activity",
      },
    },
    year,
    availableYears: availableYears(
      year,
      currentLocalDate.year,
      earliestStatisticsDate,
      timezone,
    ),
    totals: {
      distanceKm: selectedDistance,
      activities: selectedActivities.length,
      activeDays: activeDates.size,
      activeWeeks: activeWeeks.size,
      elevationGainM: elevationValues.length
        ? Math.round(elevationValues.reduce((sum, value) => sum + value, 0))
        : null,
      movingSeconds: movingValues.length
        ? Math.round(movingValues.reduce((sum, value) => sum + value, 0))
        : null,
    },
    comparison: {
      priorYear,
      throughLocalDate: selectedEndDate,
      distanceKm: priorDistance,
      deltaPercent: priorDistance > 0
        ? round(((selectedDistance - priorDistance) / priorDistance) * 100, 1)
        : null,
    },
    cumulativeDistance,
    months,
    days,
    highlights: buildHighlights(selectedActivities),
    recentActivities,
    officialRaces,
  };
}

export async function getCurrentAthleteYearStatistics(
  session: RequestSession,
  year?: number,
  env: ServerEnv = loadServerEnv(),
): Promise<AthleteYearStatistics> {
  const athleteProfileId = requireAthleteProfileId(session);
  const timezone = validTimezone(session.account.timezone);
  const currentYear = localDateParts(new Date(), timezone).year;
  const resolvedYear = year ?? currentYear;
  if (!Number.isInteger(resolvedYear) || resolvedYear < 2000 || resolvedYear > currentYear) {
    throw badRequest("Choose a valid statistics year");
  }
  const adminClient = createAdminSupabaseClient(env);
  const rangeStart = new Date(Date.UTC(resolvedYear - 2, 11, 30)).toISOString();
  const rangeEnd = new Date(Date.UTC(resolvedYear + 1, 0, 2)).toISOString();

  const [activityResponse, earliestResponse, athleteResponse] = await Promise.all([
    adminClient
      .from("athlete_activities")
      .select("id,track_template_id,source,title,performed_at,distance_km,elevation_gain_m,moving_time_seconds")
      .eq("athlete_profile_id", athleteProfileId)
      .gte("performed_at", rangeStart)
      .lt("performed_at", rangeEnd)
      .order("performed_at", { ascending: true })
      .returns<AthleteActivityStatisticsRow[]>(),
    adminClient
      .from("athlete_activities")
      .select("performed_at")
      .eq("athlete_profile_id", athleteProfileId)
      .order("performed_at", { ascending: true })
      .limit(1)
      .maybeSingle<{ performed_at: string }>(),
    adminClient
      .from("athlete_profiles")
      .select("slug")
      .eq("id", athleteProfileId)
      .single<{ slug: string }>(),
  ]);

  if (activityResponse.error) throw activityResponse.error;
  if (earliestResponse.error) throw earliestResponse.error;
  if (athleteResponse.error) throw athleteResponse.error;

  const officialResultResponse = await adminClient.rpc("public_athlete_result_history", {
    target_athlete_slug: athleteResponse.data.slug,
  });
  if (officialResultResponse.error) throw officialResultResponse.error;

  const officialResultRows = (Array.isArray(officialResultResponse.data)
    ? officialResultResponse.data
    : []) as Array<Omit<AthleteOfficialRaceStatisticsRow, "elevation_gain_m" | "event_image_url">>;
  const officialCategoryIds = Array.from(new Set(officialResultRows.map((row) => row.event_category_id)));
  const officialEventSlugs = Array.from(new Set(officialResultRows.map((row) => row.event_slug)));
  const [snapshotResponse, categoryResponse, editionResponse] = officialCategoryIds.length
    ? await Promise.all([
        adminClient
          .from("event_category_track_snapshots")
          .select("event_category_id,elevation_gain_m")
          .in("event_category_id", officialCategoryIds)
          .returns<Array<{ event_category_id: string; elevation_gain_m: number | string | null }>>(),
        adminClient
          .from("event_categories")
          .select("id,elevation_gain_m")
          .in("id", officialCategoryIds)
          .returns<Array<{ id: string; elevation_gain_m: number | string | null }>>(),
        adminClient
          .from("event_editions")
          .select("slug,cover_image_url")
          .in("slug", officialEventSlugs)
          .returns<Array<{ slug: string; cover_image_url: string | null }>>(),
      ])
    : [
        { data: [] as Array<{ event_category_id: string; elevation_gain_m: number | string | null }>, error: null },
        { data: [] as Array<{ id: string; elevation_gain_m: number | string | null }>, error: null },
        { data: [] as Array<{ slug: string; cover_image_url: string | null }>, error: null },
      ];
  if (snapshotResponse.error) throw snapshotResponse.error;
  if (categoryResponse.error) throw categoryResponse.error;
  if (editionResponse.error) throw editionResponse.error;
  const categoryElevationById = new Map(
    (categoryResponse.data ?? []).map((category) => [category.id, category.elevation_gain_m]),
  );
  const snapshotElevationByCategoryId = new Map(
    (snapshotResponse.data ?? []).map((snapshot) => [snapshot.event_category_id, snapshot.elevation_gain_m]),
  );
  const eventImageBySlug = new Map(
    (editionResponse.data ?? []).map((edition) => [
      edition.slug,
      resolvePublicRaceCoverImageUrl(edition.slug, edition.cover_image_url),
    ]),
  );
  const enrichedOfficialResultRows: AthleteOfficialRaceStatisticsRow[] = officialResultRows.map((row) => ({
    ...row,
    event_image_url: eventImageBySlug.get(row.event_slug) ?? null,
    elevation_gain_m: snapshotElevationByCategoryId.get(row.event_category_id)
      ?? categoryElevationById.get(row.event_category_id)
      ?? null,
  }));

  const rows = activityResponse.data ?? [];
  const trackIds = Array.from(new Set(rows.flatMap((row) => (
    row.track_template_id ? [row.track_template_id] : []
  ))));
  const trackResponse = trackIds.length
    ? await adminClient
        .from("track_templates")
        .select("id,name")
        .in("id", trackIds)
        .returns<Array<{ id: string; name: string }>>()
    : { data: [] as Array<{ id: string; name: string }>, error: null };

  if (trackResponse.error) throw trackResponse.error;

  return buildAthleteYearStatistics({
    rows,
    year: resolvedYear,
    timezone,
    earliestPerformedAt: earliestResponse.data?.performed_at ?? null,
    trackNames: new Map((trackResponse.data ?? []).map((track) => [track.id, track.name])),
    officialResultRows: enrichedOfficialResultRows,
  });
}
