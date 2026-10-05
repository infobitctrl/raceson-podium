import {
  getCurrentPublishedResultPage,
  getPublicLeagueClubStandingDetails,
  type CurrentPublishedResultFilter,
  type ServerEnv,
} from "@raceson/db";
import { z } from "zod";

export const PUBLIC_CURRENT_RESULTS_PATH = "/api/v1/public/results/current";
export const PUBLIC_LEAGUE_CLUB_STANDINGS_PATH = "/api/v1/public/leagues/club-standings";
const PUBLIC_CURRENT_RESULTS_PAGE_SIZE = 50;

const uuidListSchema = z.array(z.string().uuid()).min(1).max(200);
const querySchema = z.object({
  athleteProfileIds: uuidListSchema.optional(),
  representedClubIds: uuidListSchema.optional(),
  eventCategoryIds: uuidListSchema.optional(),
  leagueSeasonId: z.string().uuid().optional(),
  offset: z.number().int().min(0).max(100_000).default(0),
}).strict().superRefine((value, context) => {
  const filterCount = [
    value.athleteProfileIds,
    value.representedClubIds,
    value.eventCategoryIds,
  ].filter(Boolean).length;
  if (filterCount !== 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide exactly one result filter.",
    });
  }
});

const resultRowSchema = z.object({
  leagueClassificationIds: z.array(z.string().uuid()).optional(),
  publicationId: z.string().uuid(),
  publicationState: z.enum(["official", "corrected"]),
  publishedAt: z.string().datetime({ offset: true }),
  resultRowId: z.string().uuid(),
  resultRunId: z.string().uuid(),
  athleteProfileId: z.string().uuid(),
  eventCategoryId: z.string().uuid(),
  resultStatus: z.enum(["official", "corrected"]),
  participationStatus: z.string().trim().min(1).nullable(),
  bib: z.string().trim().min(1).nullable(),
  finishTimeMs: z.number().nonnegative().nullable(),
  gapMs: z.number().nullable(),
  rankOverall: z.number().int().nonnegative().nullable(),
  rankGender: z.number().int().nonnegative().nullable(),
  rankAgeCategory: z.number().int().nonnegative().nullable(),
  clubPoints: z.number().nullable(),
  representedClubId: z.string().uuid().nullable(),
  resultCreatedAt: z.string().datetime({ offset: true }),
});

const resultPageSchema = z.object({
  rows: z.array(resultRowSchema).max(500),
  nextOffset: z.number().int().positive().nullable(),
});

const leagueClubStandingQuerySchema = z.object({
  leagueSeasonId: z.string().uuid(),
}).strict();

const leagueClubStandingDetailsSchema = z.object({
  clubs: z.array(z.object({
    clubId: z.string().uuid(),
    points: z.number().nonnegative(),
    scoredRounds: z.number().int().nonnegative(),
    rank: z.number().int().positive().nullable(),
    contributions: z.array(z.object({
      leagueRoundId: z.string().uuid(),
      roundNumber: z.number().int().positive(),
      points: z.number().nonnegative(),
      members: z.array(z.object({
        athleteProfileId: z.string().uuid(),
        rank: z.number().int().positive(),
        points: z.number().nonnegative(),
      })).max(10),
    })).max(100),
  })).max(500),
});

const loaders = {
  currentPage: getCurrentPublishedResultPage,
  leagueClubStandings: getPublicLeagueClubStandingDetails,
};

export type PublicResultProjectionLoaders = typeof loaders;

type PublicResultHttpResponse = {
  statusCode: number;
  headers: Record<string, string>;
  payload: Record<string, unknown>;
};

export function isPublicCurrentResultsPath(url: URL) {
  return url.pathname === PUBLIC_CURRENT_RESULTS_PATH;
}

export function isPublicLeagueClubStandingsPath(url: URL) {
  return url.pathname === PUBLIC_LEAGUE_CLUB_STANDINGS_PATH;
}

export async function resolvePublicCurrentResultsRequest(
  method: string,
  url: URL,
  body: unknown,
  env: ServerEnv,
  projectionLoaders: PublicResultProjectionLoaders = loaders,
): Promise<PublicResultHttpResponse | null> {
  if (!isPublicCurrentResultsPath(url)) return null;
  if ([...url.searchParams.keys()].length > 0) {
    return {
      statusCode: 400,
      headers: {},
      payload: { error: { code: "validation_error", message: "Query parameters are not supported." } },
    };
  }
  if (method !== "POST") {
    return {
      statusCode: 405,
      headers: { Allow: "POST, OPTIONS" },
      payload: { error: { code: "method_not_allowed", message: "This endpoint supports POST requests only." } },
    };
  }

  const parsed = querySchema.safeParse(body);
  if (!parsed.success) {
    return {
      statusCode: 400,
      headers: {},
      payload: { error: { code: "validation_error", message: "Invalid current-result query." } },
    };
  }

  const { offset, leagueSeasonId, ...filterInput } = parsed.data;
  const filter = (
    filterInput.athleteProfileIds
      ? { athleteProfileIds: filterInput.athleteProfileIds }
      : filterInput.representedClubIds
        ? { representedClubIds: filterInput.representedClubIds }
        : { eventCategoryIds: filterInput.eventCategoryIds ?? [] }
  ) satisfies CurrentPublishedResultFilter;
  const resultPage = resultPageSchema.parse(
    await projectionLoaders.currentPage(filter, offset, PUBLIC_CURRENT_RESULTS_PAGE_SIZE, env, leagueSeasonId),
  );

  return {
    statusCode: 200,
    headers: {
      "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
      "Content-Language": "en",
    },
    payload: { data: resultPage },
  };
}

export async function resolvePublicLeagueClubStandingsRequest(
  method: string,
  url: URL,
  body: unknown,
  env: ServerEnv,
  projectionLoaders: PublicResultProjectionLoaders = loaders,
): Promise<PublicResultHttpResponse | null> {
  if (!isPublicLeagueClubStandingsPath(url)) return null;
  if ([...url.searchParams.keys()].length > 0) {
    return {
      statusCode: 400,
      headers: {},
      payload: { error: { code: "validation_error", message: "Query parameters are not supported." } },
    };
  }
  if (method !== "POST") {
    return {
      statusCode: 405,
      headers: { Allow: "POST, OPTIONS" },
      payload: { error: { code: "method_not_allowed", message: "This endpoint supports POST requests only." } },
    };
  }

  const parsed = leagueClubStandingQuerySchema.safeParse(body);
  if (!parsed.success) {
    return {
      statusCode: 400,
      headers: {},
      payload: { error: { code: "validation_error", message: "Invalid league-season query." } },
    };
  }

  const details = leagueClubStandingDetailsSchema.parse(
    await projectionLoaders.leagueClubStandings(parsed.data.leagueSeasonId, env),
  );
  return {
    statusCode: 200,
    headers: {
      "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
      "Content-Language": "en",
    },
    payload: { data: details },
  };
}
