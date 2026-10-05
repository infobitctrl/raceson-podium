import {
  getPublicRaceCoverImage,
  getPublicRaceDetail,
  getPublicRaceDirectory,
  getPublicRaceResults,
  type ServerEnv,
} from "@raceson/db";
import { EVENT_ACTIVITY_TYPES } from "@raceson/domain/activities";
import { SPORT_CODES } from "@raceson/domain/sports";
import { z } from "zod";

export const PUBLIC_RACES_PATH = "/api/v1/public/races";

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const countryCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/)
  .transform((value) => value.toUpperCase());

const publicUrlSchema = z
  .string()
  .refine((value) => {
    if (value.startsWith("/") && !value.startsWith("//")) {
      return !value.includes("\\") && !/[\u0000-\u001f]/.test(value);
    }
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  });

const moneySchema = z.object({
  amountCents: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

const resultRowLimitSchema = z.coerce.number().int().min(1).max(100);
const sportCodeSchema = z.enum(SPORT_CODES);
const activityTypeSchema = z.enum(EVENT_ACTIVITY_TYPES);

const raceSummarySchema = z.object({
  editionId: z.string().uuid(),
  activityType: activityTypeSchema,
  sportCodes: z.array(sportCodeSchema).min(1).max(SPORT_CODES.length),
  primarySportCode: sportCodeSchema,
  countryCode: countryCodeSchema.nullable(),
  slug: slugSchema,
  name: z.string().trim().min(1),
  startDate: z.string().date(),
  endDate: z.string().date().nullable(),
  timezone: z.string().trim().min(1),
  locationLabel: z.string().trim().min(1),
  status: z.string().trim().min(1),
  coverImageUrl: publicUrlSchema.nullable(),
  linkedTrackImageUrl: publicUrlSchema.nullable().optional(),
  organizerName: z.string().trim().min(1),
  categoryCount: z.number().int().nonnegative(),
  totalCapacity: z.number().int().positive().nullable(),
  registeredCount: z.number().int().nonnegative(),
  distancesKm: z.array(z.number().positive()).max(30),
  maximumElevationGainM: z.number().int().nonnegative(),
  minimumEntryFee: moneySchema.nullable(),
  entryFees: z.array(moneySchema).max(30),
  latestResultState: z.enum(["provisional", "official", "corrected"]).nullable(),
});

const raceDetailSchema = z.object({
  editionId: z.string().uuid(),
  activityType: activityTypeSchema,
  sportCodes: z.array(sportCodeSchema).min(1).max(SPORT_CODES.length),
  primarySportCode: sportCodeSchema,
  countryCode: countryCodeSchema.nullable(),
  slug: slugSchema,
  name: z.string().trim().min(1),
  description: z.string(),
  about: z.string(),
  organizerRules: z.string().optional(),
  startDate: z.string().date(),
  endDate: z.string().date().nullable(),
  timezone: z.string().trim().min(1),
  locationLabel: z.string().trim().min(1),
  status: z.string().trim().min(1),
  registrationOpenAt: z.string().datetime({ offset: true }).nullable(),
  registrationCloseAt: z.string().datetime({ offset: true }).nullable(),
  coverImageUrl: publicUrlSchema.nullable(),
  organizerName: z.string().trim().min(1),
  websiteUrl: publicUrlSchema.nullable(),
  instagramUrl: publicUrlSchema.nullable(),
  facebookUrl: publicUrlSchema.nullable(),
  timeline: z.array(
    z.object({
      time: z.string().trim().min(1),
      description: z.string().trim().min(1),
    }),
  ).max(30),
  locations: z.array(
    z.object({
      id: z.string().uuid(),
      type: z.string().trim().min(1),
      label: z.string().trim().min(1),
      placeLabel: z.string().nullable(),
      description: z.string().nullable(),
      latitude: z.number().min(-90).max(90).nullable(),
      longitude: z.number().min(-180).max(180).nullable(),
    }),
  ).max(50),
  documents: z.array(
    z.object({
      title: z.string().trim().min(1),
      type: z.string().trim().min(1),
    }),
  ).max(50),
  categories: z.array(
    z.object({
      kind: z.enum(["competitive", "informative"]),
      sportCode: sportCodeSchema,
      id: z.string().uuid(),
      slug: slugSchema,
      name: z.string().trim().min(1),
      coverImageUrl: publicUrlSchema.nullable(),
      distanceKm: z.number().positive().nullable(),
      elevationGainM: z.number().int().nonnegative().nullable(),
      capacity: z.number().int().positive().nullable(),
      registeredCount: z.number().int().nonnegative(),
      spotsRemaining: z.number().int().nonnegative().nullable(),
      entryFee: moneySchema.nullable(),
      startAt: z.string().datetime({ offset: true }).nullable(),
      minimumAge: z.number().int().nonnegative().nullable(),
      maximumAge: z.number().int().nonnegative().nullable(),
      allowedGenders: z.array(z.enum(["F", "M", "U"])).min(1).max(3),
      eligibilityNote: z.string().nullable(),
      registrationConfigurationUrl: publicUrlSchema.nullable(),
      course: z.object({
        name: z.string().trim().min(1),
        slug: slugSchema,
        gpxDownloadUrl: publicUrlSchema,
      }).nullable(),
    }),
  ).max(30),
});

const resultRowSchema = z.object({
  resultId: z.string().uuid(),
  bib: z.string().nullable(),
  name: z.string().trim().min(1),
  athleteSlug: z.string().nullable(),
  clubName: z.string().nullable(),
  gender: z.enum(["F", "M", "U"]),
  ageCategoryLabel: z.string().nullable(),
  participationStatus: z.enum([
    "not_started",
    "checked_in",
    "dns",
    "started",
    "finished",
    "dnf",
    "dsq",
  ]),
  resultStatus: z.enum([
    "uncomputed",
    "provisional",
    "official",
    "corrected",
    "void",
  ]),
  finishTimeMs: z.number().int().nonnegative().nullable(),
  rankOverall: z.number().int().nonnegative().nullable(),
  rankGender: z.number().int().nonnegative().nullable(),
  rankAgeCategory: z.number().int().nonnegative().nullable(),
});

const resultClassificationSchema = z.object({
  id: z.string().trim().min(1).max(180),
  label: z.string().trim().min(1).max(120),
  gender: z.enum(["F", "M"]).nullable(),
  minimumAge: z.number().nonnegative().max(120).nullable(),
  maximumAge: z.number().nonnegative().max(120).nullable(),
});

const raceResultsSchema = z.object({
  editionId: z.string().uuid(),
  countryCode: countryCodeSchema.nullable(),
  slug: slugSchema,
  name: z.string().trim().min(1),
  categories: z.array(
    z.object({
      id: z.string().uuid(),
      slug: slugSchema,
      name: z.string().trim().min(1),
      classifications: z.array(resultClassificationSchema).max(30),
      publicationState: z.enum(["provisional", "official", "corrected"]),
      publishedAt: z.string().datetime({ offset: true }),
      rows: z.array(resultRowSchema).max(5_000),
    }),
  ).max(30),
});

const loaders = {
  cover: getPublicRaceCoverImage,
  directory: getPublicRaceDirectory,
  detail: getPublicRaceDetail,
  results: getPublicRaceResults,
};

export type PublicRaceProjectionLoaders = typeof loaders;

type PublicRaceHttpResponse = {
  statusCode: number;
  headers: Record<string, string>;
  payload?: Record<string, unknown>;
  binaryBody?: Uint8Array;
};

function errorResponse(
  statusCode: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): PublicRaceHttpResponse {
  return {
    statusCode,
    headers,
    payload: {
      error: {
        code,
        message,
      },
    },
  };
}

function successResponse(
  data: unknown,
  generatedAt: string,
  cacheControl: string,
  metadata: Record<string, unknown>,
): PublicRaceHttpResponse {
  return {
    statusCode: 200,
    headers: {
      "Cache-Control": cacheControl,
      "Content-Language": "en",
    },
    payload: {
      data: {
        version: 2,
        generatedAt,
        ...metadata,
        ...data as Record<string, unknown>,
      },
    },
  };
}

function matchPublicRacePath(pathname: string) {
  if (pathname === PUBLIC_RACES_PATH) {
    return { kind: "directory" as const, slug: null };
  }
  const match = /^\/api\/v1\/public\/races\/([^/]+?)(\/results|\/cover-image)?$/.exec(pathname);
  if (!match) return null;
  let decodedSlug = "";
  try {
    decodedSlug = decodeURIComponent(match[1]);
  } catch {
    return { kind: "invalid" as const, slug: null };
  }
  const parsedSlug = slugSchema.safeParse(decodedSlug);
  if (!parsedSlug.success) return { kind: "invalid" as const, slug: null };
  return {
    kind:
      match[2] === "/results"
        ? "results" as const
        : match[2] === "/cover-image"
          ? "cover" as const
          : "detail" as const,
    slug: parsedSlug.data,
  };
}

export function isPublicRaceProjectionPath(url: URL) {
  return url.pathname === PUBLIC_RACES_PATH
    || url.pathname.startsWith(`${PUBLIC_RACES_PATH}/`);
}

export async function resolvePublicRaceProjectionRequest(
  method: string,
  url: URL,
  env: ServerEnv,
  projectionLoaders: PublicRaceProjectionLoaders = loaders,
  now: () => Date = () => new Date(),
): Promise<PublicRaceHttpResponse | null> {
  if (!isPublicRaceProjectionPath(url)) return null;
  const route = matchPublicRacePath(url.pathname);
  if (!route || route.kind === "invalid") {
    return errorResponse(400, "validation_error", "Invalid public race path.");
  }
  if (method !== "GET") {
    return errorResponse(
      405,
      "method_not_allowed",
      "This endpoint supports GET requests only.",
      { Allow: "GET, OPTIONS" },
    );
  }

  if (route.kind === "directory") {
    const countryValues = url.searchParams.getAll("country");
    const unsupportedKeys = [...url.searchParams.keys()].filter(
      (key) => key !== "country",
    );
    const parsedCountry = countryValues.length === 1
      ? countryCodeSchema.safeParse(countryValues[0])
      : null;
    if (countryValues.length > 1 || unsupportedKeys.length > 0 || (parsedCountry && !parsedCountry.success)) {
      return errorResponse(
        400,
        "validation_error",
        "The public race directory accepts at most one country filter.",
      );
    }
    const countryFilter = parsedCountry?.success ? parsedCountry.data : null;
    const races = z.array(raceSummarySchema).max(100).parse(
      await projectionLoaders.directory(countryFilter, env),
    );
    return successResponse(
      { races },
      now().toISOString(),
      "public, max-age=60, stale-while-revalidate=300",
      { scope: "platform", countryFilter },
    );
  }

  if (
    (route.kind === "detail" || route.kind === "cover")
    && [...url.searchParams.keys()].length > 0
  ) {
    return errorResponse(
      400,
      "validation_error",
      "Public race detail and cover endpoints do not accept query parameters.",
    );
  }

  if (route.kind === "cover") {
    const cover = await projectionLoaders.cover(route.slug, null, env);
    if (!cover) {
      return errorResponse(404, "not_found", "Published race cover image not found.");
    }
    return {
      statusCode: 200,
      headers: {
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        "Content-Type": cover.contentType,
        "Content-Length": String(cover.bytes.byteLength),
        "X-Content-Type-Options": "nosniff",
      },
      binaryBody: cover.bytes,
    };
  }

  if (route.kind === "detail") {
    const race = await projectionLoaders.detail(route.slug, null, env);
    if (!race) {
      return errorResponse(404, "not_found", "Published race not found.");
    }
    return successResponse(
      { race: raceDetailSchema.parse(race) },
      now().toISOString(),
      "public, max-age=60, stale-while-revalidate=300",
      { scope: "event" },
    );
  }

  const rowLimitValues = url.searchParams.getAll("rowLimit");
  const unsupportedResultKeys = [...url.searchParams.keys()].filter(
    (key) => key !== "rowLimit",
  );
  const parsedRowLimit = rowLimitValues.length === 1
    ? resultRowLimitSchema.safeParse(rowLimitValues[0])
    : null;
  if (
    rowLimitValues.length > 1
    || unsupportedResultKeys.length > 0
    || (parsedRowLimit && !parsedRowLimit.success)
  ) {
    return errorResponse(
      400,
      "validation_error",
      "Public race results accept at most one rowLimit between 1 and 100.",
    );
  }

  const rowLimit = parsedRowLimit?.success ? parsedRowLimit.data : null;
  const loadedResults = await projectionLoaders.results(route.slug, null, env);
  if (!loadedResults) {
    return errorResponse(404, "not_found", "Published race not found.");
  }
  const parsedResults = raceResultsSchema.parse(loadedResults);
  const results = rowLimit == null
    ? parsedResults
    : {
        ...parsedResults,
        categories: parsedResults.categories.map((category) => ({
          ...category,
          rows: category.rows.slice(0, rowLimit),
        })),
      };
  return successResponse(
    { results },
    now().toISOString(),
    rowLimit == null
      ? "public, max-age=30, stale-while-revalidate=120"
      : "public, max-age=300, stale-while-revalidate=900",
    rowLimit == null ? { scope: "event" } : { scope: "event", rowLimit },
  );
}
