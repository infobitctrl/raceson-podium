import { getPublicPlatformStats, type ServerEnv } from "@raceson/db";
import { z } from "zod";

export const PUBLIC_PLATFORM_SUMMARY_PATH = "/api/v1/public/platform-summary";

const statsSchema = z.object({
  events: z.number().int().nonnegative(),
  tracks: z.number().int().nonnegative(),
  leagues: z.number().int().nonnegative(),
  athletes: z.number().int().nonnegative(),
  registrations: z.number().int().nonnegative(),
  clubs: z.number().int().nonnegative(),
  completedDistanceKm: z.number().finite().nonnegative(),
  finishes: z.number().int().nonnegative(),
  countries: z.number().int().nonnegative(),
  countryCodes: z.array(z.string().regex(/^[A-Z]{2}$/)).max(250),
}).superRefine((stats, context) => {
  if (stats.countries !== stats.countryCodes.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Country count must match the distinct country-code list.",
      path: ["countries"],
    });
  }
});

const loaders = {
  summary: getPublicPlatformStats,
};

export type PublicPlatformSummaryLoaders = typeof loaders;

type PublicPlatformSummaryHttpResponse = {
  statusCode: number;
  headers: Record<string, string>;
  payload: Record<string, unknown>;
};

function errorResponse(
  statusCode: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): PublicPlatformSummaryHttpResponse {
  return {
    statusCode,
    headers,
    payload: { error: { code, message } },
  };
}

export function isPublicPlatformSummaryPath(url: URL) {
  return url.pathname === PUBLIC_PLATFORM_SUMMARY_PATH
    || url.pathname.startsWith(`${PUBLIC_PLATFORM_SUMMARY_PATH}/`);
}

export async function resolvePublicPlatformSummaryRequest(
  method: string,
  url: URL,
  env: ServerEnv,
  summaryLoaders: PublicPlatformSummaryLoaders = loaders,
  now: () => Date = () => new Date(),
): Promise<PublicPlatformSummaryHttpResponse | null> {
  if (!isPublicPlatformSummaryPath(url)) return null;
  if (url.pathname !== PUBLIC_PLATFORM_SUMMARY_PATH) {
    return errorResponse(400, "validation_error", "Invalid public platform summary path.");
  }
  if (method !== "GET") {
    return errorResponse(
      405,
      "method_not_allowed",
      "This endpoint supports GET requests only.",
      { Allow: "GET, OPTIONS" },
    );
  }

  if ([...url.searchParams.keys()].length > 0) {
    return errorResponse(
      400,
      "validation_error",
      "Platform-wide statistics do not accept country or entity filters.",
    );
  }

  const stats = statsSchema.parse(await summaryLoaders.summary(env));
  return {
    statusCode: 200,
    headers: {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      "Content-Language": "en",
    },
    payload: {
      data: {
        version: 2,
        generatedAt: now().toISOString(),
        scope: "platform",
        stats,
      },
    },
  };
}
