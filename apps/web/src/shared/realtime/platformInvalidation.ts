import type { QueryKey } from "@tanstack/react-query";

export const PLATFORM_INVALIDATION_TOPIC = "platform:invalidate";
export const PLATFORM_INVALIDATION_EVENT = "data_changed";

const QUERY_PREFIXES_BY_FAMILY = {
  event: [
    "event-detail",
    "events-catalog",
    "public-event-live",
    "public-event-participants",
    "public-event-results",
    "public-event-results-inline",
  ],
  results: [
    "organizer-category-results",
    "public-event-results",
    "public-event-results-inline",
    "public-results-directory",
    "public-runner-result",
  ],
  athlete: [
    "athlete-dashboard",
    "athlete-league-standings",
    "athlete-league-standings-public",
    "athlete-results-public",
    "public-athletes-catalog",
  ],
  club: ["athlete-clubs", "public-club-detail", "public-clubs-catalog"],
  track: [
    "event-category-track-preview",
    "event-races-track",
    "event-race-day-track",
    "event-results-track",
    "homepage-featured-track",
    "track-detail",
    "tracks-catalog",
  ],
  league: [
    "athlete-league-standings",
    "athlete-league-standings-public",
    "organizer-league-detail",
    "organizer-league-seasons",
    "public-league-detail",
    "public-leagues-catalog",
  ],
  rankings: ["public-rankings"],
  organizer: [
    "organizer-dashboard",
    "organizer-event-detail",
    "organizer-event-readiness",
    "organizer-event-summaries",
    "organizer-event-tracks",
    "organizer-events",
    "organizer-events-for-league-detail",
    "organizer-league-detail",
    "organizer-tracks",
    "organizer-track-detail",
    "organizer-registrations",
    "organizer-race-day",
    "organizer-race-operations",
    "race-start-control",
  ],
  homepage: [
    "homepage-featured-races",
    "homepage-featured-leagues",
    "homepage-featured-track",
    "homepage-read-model",
    "homepage-spotlight-clubs",
  ],
} as const;

export type PlatformInvalidationFamily = keyof typeof QUERY_PREFIXES_BY_FAMILY;

export type PlatformInvalidationPayload = {
  schemaVersion: 1;
  domainEventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  occurredAt: string;
  queryFamilies: PlatformInvalidationFamily[];
  eventEditionId?: string;
  eventCategoryId?: string;
  leagueSeasonId?: string;
  publicationState?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isInvalidationFamily(value: unknown): value is PlatformInvalidationFamily {
  return typeof value === "string" && value in QUERY_PREFIXES_BY_FAMILY;
}

export function parsePlatformInvalidationPayload(
  value: unknown,
): PlatformInvalidationPayload | null {
  if (
    !isRecord(value)
    || value.schemaVersion !== 1
    || !isNonEmptyString(value.domainEventId)
    || !isNonEmptyString(value.eventType)
    || !isNonEmptyString(value.aggregateType)
    || !isNonEmptyString(value.aggregateId)
    || !isNonEmptyString(value.occurredAt)
    || !Array.isArray(value.queryFamilies)
  ) {
    return null;
  }

  const queryFamilies = [...new Set(value.queryFamilies.filter(isInvalidationFamily))];
  if (queryFamilies.length === 0) {
    return null;
  }

  return {
    schemaVersion: 1,
    domainEventId: value.domainEventId,
    eventType: value.eventType,
    aggregateType: value.aggregateType,
    aggregateId: value.aggregateId,
    occurredAt: value.occurredAt,
    queryFamilies,
    ...(isNonEmptyString(value.eventEditionId) ? { eventEditionId: value.eventEditionId } : {}),
    ...(isNonEmptyString(value.eventCategoryId) ? { eventCategoryId: value.eventCategoryId } : {}),
    ...(isNonEmptyString(value.leagueSeasonId) ? { leagueSeasonId: value.leagueSeasonId } : {}),
    ...(isNonEmptyString(value.publicationState) ? { publicationState: value.publicationState } : {}),
  };
}

export function queryPrefixesForPlatformInvalidation(
  payload: PlatformInvalidationPayload,
): ReadonlySet<string> {
  return queryPrefixesForInvalidationFamilies(payload.queryFamilies);
}

export function queryPrefixesForInvalidationFamilies(
  families: readonly PlatformInvalidationFamily[],
): ReadonlySet<string> {
  return new Set(
    families.flatMap((family) => QUERY_PREFIXES_BY_FAMILY[family]),
  );
}

export function queryKeyMatchesPlatformInvalidation(
  queryKey: QueryKey,
  prefixes: ReadonlySet<string>,
) {
  return typeof queryKey[0] === "string" && prefixes.has(queryKey[0]);
}
