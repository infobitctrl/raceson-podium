import {
  getPublicAthleteAgeCategories,
  getPublicAthleteFingerprintBenchmark,
  getPublicAthleteLeagueCompetitionStandings,
  getPublicAthleteResultHistory,
  type ServerEnv,
} from "@raceson/db";
import { isAllowedProfileAvatarUrl } from "@raceson/domain/athletes";
import { z } from "zod";

export const PUBLIC_ATHLETES_PATH = "/api/v1/public/athletes";

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const ageCategorySchema = z.object({
  athleteProfileId: z.string().uuid(),
  ageCategoryLabel: z.string().trim().min(1).nullable(),
  avatarUrl: z.string().trim().max(2048).refine(isAllowedProfileAvatarUrl).nullable(),
  coverImageUrl: z.string().trim().max(2048).refine(isAllowedProfileAvatarUrl).nullable(),
});

const resultHistorySchema = z.object({
  resultRowId: z.string().uuid(),
  eventCategoryId: z.string().uuid(),
  eventSlug: slugSchema,
  eventName: z.string().trim().min(1),
  categoryName: z.string().trim().min(1),
  distanceKm: z.number().nonnegative().nullable(),
  elevationGainM: z.number().int().nonnegative().nullable(),
  eventDate: z.string().date().nullable(),
  finishTimeMs: z.number().int().positive().nullable(),
  rankOverall: z.number().int().positive().nullable(),
  totalFinishers: z.number().int().nonnegative(),
  outcomeLabel: z.enum([
    "finished",
    "dns",
    "dnf",
    "dsq",
    "withdrawn",
    "stopped",
    "evacuated",
    "missing",
    "unknown",
  ]),
  splits: z.array(z.object({
    elapsedTimeMs: z.number().int().nonnegative().nullable(),
    sequenceNumber: z.number().int().nonnegative(),
  })).max(100),
});

const leagueStandingSchema = z.object({
  athleteSlug: slugSchema,
  leagueSlug: slugSchema,
  leagueName: z.string().trim().min(1).max(240),
  seasonLabel: z.string().trim().min(1).max(240),
  seasonYear: z.number().int().nullable(),
  competitionSlug: slugSchema,
  competitionName: z.string().trim().min(1).max(240),
  rank: z.number().int().positive().nullable(),
  points: z.number().int().nonnegative(),
  scoredRounds: z.number().int().nonnegative(),
});

const nullableMetricSchema = z.number().finite().nonnegative().nullable();
const nullablePositionMetricSchema = z.number().finite().min(0).max(100).nullable();
const fingerprintBenchmarkSchema = z.object({
  populationAthletes: z.number().int().nonnegative(),
  asOf: z.string().datetime({ offset: true }).nullable(),
  platform: z.object({
    avgRaces: nullableMetricSchema,
    avgDistanceKm: nullableMetricSchema,
    avgClimbM: nullableMetricSchema,
    avgPositionPercent: nullablePositionMetricSchema,
    avgAgeYears: nullableMetricSchema,
  }),
  athlete: z.object({
    races: z.number().int().nonnegative(),
    avgDistanceKm: nullableMetricSchema,
    avgClimbM: nullableMetricSchema,
    avgPositionPercent: nullablePositionMetricSchema,
  }).nullable(),
});

const loaders = {
  ageCategories: getPublicAthleteAgeCategories,
  fingerprint: getPublicAthleteFingerprintBenchmark,
  leagueStandings: getPublicAthleteLeagueCompetitionStandings,
  results: getPublicAthleteResultHistory,
};

export type PublicAthleteProjectionLoaders = typeof loaders;

type PublicAthleteHttpResponse = {
  statusCode: number;
  headers: Record<string, string>;
  payload: Record<string, unknown>;
};

function response(
  statusCode: number,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
): PublicAthleteHttpResponse {
  return { statusCode, headers, payload };
}

function matchPath(pathname: string) {
  if (pathname === `${PUBLIC_ATHLETES_PATH}/age-categories`) {
    return { kind: "age-categories" as const, slug: null };
  }

  if (pathname === `${PUBLIC_ATHLETES_PATH}/league-standings`) {
    return { kind: "league-standings" as const, slug: null };
  }

  const match = new RegExp(`^${PUBLIC_ATHLETES_PATH}/([^/]+)/(results|league-standings|fingerprint)$`).exec(pathname);
  if (!match) return null;
  let decodedSlug = "";
  try {
    decodedSlug = decodeURIComponent(match[1]);
  } catch {
    return { kind: "invalid" as const, slug: null };
  }
  const parsedSlug = slugSchema.safeParse(decodedSlug);
  return parsedSlug.success
    ? { kind: match[2] as "results" | "league-standings" | "fingerprint", slug: parsedSlug.data }
    : { kind: "invalid" as const, slug: null };
}

export function isPublicAthleteProjectionPath(url: URL) {
  return url.pathname.startsWith(`${PUBLIC_ATHLETES_PATH}/`);
}

export async function resolvePublicAthleteProjectionRequest(
  method: string,
  url: URL,
  env: ServerEnv,
  projectionLoaders: PublicAthleteProjectionLoaders = loaders,
): Promise<PublicAthleteHttpResponse | null> {
  if (!isPublicAthleteProjectionPath(url)) return null;
  const route = matchPath(url.pathname);
  if (!route || route.kind === "invalid" || [...url.searchParams.keys()].length > 0) {
    return response(400, {
      error: { code: "validation_error", message: "Invalid public athlete path." },
    });
  }
  if (method !== "GET") {
    return response(
      405,
      { error: { code: "method_not_allowed", message: "This endpoint supports GET requests only." } },
      { Allow: "GET, OPTIONS" },
    );
  }

  if (route.kind === "age-categories") {
    const ageCategories = z.array(ageCategorySchema).max(10_000).parse(
      await projectionLoaders.ageCategories(env),
    );
    return response(
      200,
      { data: ageCategories },
      { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
    );
  }

  if (route.kind === "league-standings") {
    const standings = z.array(leagueStandingSchema).max(10_000).parse(
      await projectionLoaders.leagueStandings(route.slug, env),
    );
    return response(
      200,
      { data: standings },
      { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
    );
  }

  if (route.kind === "fingerprint") {
    const benchmark = fingerprintBenchmarkSchema.parse(
      await projectionLoaders.fingerprint(route.slug, env),
    );
    return response(
      200,
      { data: benchmark },
      { "Cache-Control": "public, max-age=300, stale-while-revalidate=900" },
    );
  }

  const results = z.array(resultHistorySchema).max(500).parse(
    await projectionLoaders.results(route.slug, env),
  );
  return response(
    200,
    { data: results },
    { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
  );
}
