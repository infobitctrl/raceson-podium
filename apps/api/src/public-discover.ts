import { z } from "zod";

export const PUBLIC_DISCOVER_PATH = "/api/v1/public/discover";

const intentSchema = z.enum(["quiet", "views", "fast", "race"]);

function isSafePublicUrl(value: string) {
  if (value.startsWith("/") && !value.startsWith("//")) {
    return !value.includes("\\") && !/[\u0000-\u001f]/.test(value);
  }

  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const publicUrlSchema = z
  .string()
  .trim()
  .min(1)
  .refine(isSafePublicUrl, "Public URLs must be root-relative or HTTPS");

const stageSchema = z.object({
  startKm: z.number().nonnegative(),
  endKm: z.number().positive(),
  title: z.string().trim().min(1),
  detail: z.string().trim().min(1),
});

const routeSchema = z.object({
  points: z
    .array(
      z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      }),
    )
    .min(2),
  elevation: z
    .array(
      z.object({
        distanceKm: z.number().nonnegative(),
        elevationM: z.number().finite(),
      }),
    )
    .min(2)
    .superRefine((points, context) => {
      points.forEach((point, index) => {
        if (index > 0 && point.distanceKm < points[index - 1].distanceKm) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Discover elevation distances must be ordered",
            path: [index, "distanceKm"],
          });
        }
      });
    }),
});

const trailSchema = z
  .object({
    id: z.string().trim().min(1),
    slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().trim().min(1),
    locationLabel: z.string().trim().min(1),
    regionLabel: z.string().trim().min(1),
    line: z.string().trim().min(1),
    distanceKm: z.number().positive(),
    elevationGainM: z.number().nonnegative(),
    durationMinutes: z.number().positive(),
    condition: z.string().trim().min(1),
    terrainNotes: z.array(z.string().trim().min(1)),
    intents: z.array(intentSchema).min(1),
    imageUrl: publicUrlSchema,
    story: z.string().trim().min(1),
    stages: z.array(stageSchema).min(1),
    packing: z.array(z.string().trim().min(1)),
    gpxDownloadUrl: publicUrlSchema.nullable().optional(),
    route: routeSchema.optional(),
  })
  .superRefine((trail, context) => {
    trail.stages.forEach((stage, index) => {
      if (
        stage.endKm <= stage.startKm
        || stage.endKm > trail.distanceKm + 0.05
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Discover stage distance is outside the trail distance",
          path: ["stages", index],
        });
      }
      if (
        index > 0
        && stage.startKm < trail.stages[index - 1].endKm
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Discover stages must be ordered and non-overlapping",
          path: ["stages", index],
        });
      }
    });
  });

export const publicDiscoverCatalogSchema = z
  .object({
    version: z.literal(1),
    generatedAt: z.string().datetime({ offset: true }),
    countryCode: z.literal("HR"),
    trails: z.array(trailSchema).min(1),
  })
  .superRefine((catalog, context) => {
    const ids = new Set<string>();
    const slugs = new Set<string>();
    catalog.trails.forEach((trail, index) => {
      if (ids.has(trail.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Discover trail ids must be unique",
          path: ["trails", index, "id"],
        });
      }
      if (slugs.has(trail.slug)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Discover trail slugs must be unique",
          path: ["trails", index, "slug"],
        });
      }
      ids.add(trail.id);
      slugs.add(trail.slug);
    });
  });

const trails = z.array(trailSchema).parse([
  {
    id: "sky-path-17",
    slug: "sky-path-17",
    name: "Sky Path 17",
    locationLabel: "Biokovo · Makarska",
    regionLabel: "Near Split",
    line: "Sea at your heels. Stone underfoot.",
    distanceKm: 17.8,
    elevationGainM: 950,
    durationMinutes: 220,
    condition: "Clear until 16:00",
    terrainNotes: ["Exposed ridge", "Technical karst", "No water"],
    intents: ["quiet", "views", "race"],
    imageUrl: "/assets/sky-path-runner.webp",
    story:
      "A high limestone traverse with the Adriatic in constant view. The path is compact but serious: open sun, sharp footing and almost no shelter once you reach the ridge.",
    stages: [
      {
        startKm: 0,
        endKm: 4,
        title: "Wake the legs",
        detail: "A steady pine-shaded climb from the old mountain road.",
      },
      {
        startKm: 4,
        endKm: 11,
        title: "Read the ridge",
        detail: "Exposed limestone, large views and the most technical movement.",
      },
      {
        startKm: 11,
        endKm: 17.8,
        title: "Follow the sea home",
        detail: "A long runnable descent with loose karst in the final switchbacks.",
      },
    ],
    packing: ["1.5 L water", "Sun cover", "Grippy shoes", "Offline route"],
    gpxDownloadUrl: null,
  },
  {
    id: "mosor-south-face",
    slug: "mosor-south-face",
    name: "Mosor South Face",
    locationLabel: "Mosor · Gornje Sitno",
    regionLabel: "Near Split",
    line: "A hard climb into the quiet above the city.",
    distanceKm: 13.2,
    elevationGainM: 1080,
    durationMinutes: 250,
    condition: "Bura easing after 12:00",
    terrainNotes: ["Steep ascent", "Sheltered return", "Spring at 6 km"],
    intents: ["quiet", "views"],
    imageUrl: "/assets/mosor.webp",
    story:
      "A direct south-face line into Mosor’s bare upper country, built around one sustained climb and a gentler return through pine and old stone hamlets.",
    stages: [
      {
        startKm: 0,
        endKm: 3,
        title: "Leave the village",
        detail: "Stone lanes turn quickly into a narrow pine path.",
      },
      {
        startKm: 3,
        endKm: 7,
        title: "Climb the face",
        detail: "The gradient stays honest all the way to the saddle.",
      },
      {
        startKm: 7,
        endKm: 13.2,
        title: "Take the long way down",
        detail: "A softer trail returns through shade and dry-stone walls.",
      },
    ],
    packing: ["Wind shell", "1 L water", "Poles optional", "Offline route"],
    gpxDownloadUrl: null,
  },
  {
    id: "marjan-dawn-loop",
    slug: "marjan-dawn-loop",
    name: "Marjan Dawn Loop",
    locationLabel: "Marjan · Split",
    regionLabel: "Near Split",
    line: "First light, empty stone steps and coffee after.",
    distanceKm: 8.6,
    elevationGainM: 280,
    durationMinutes: 65,
    condition: "Dry and calm",
    terrainNotes: ["Mostly runnable", "Urban trailhead", "Water at finish"],
    intents: ["quiet", "fast", "views"],
    imageUrl: "/assets/makarska-cliffs.webp",
    story:
      "Split’s before-work classic: old stone, pine shade and a sea-facing ridge that rewards an early alarm without asking for a full day.",
    stages: [
      {
        startKm: 0,
        endKm: 2,
        title: "Climb the steps",
        detail: "A gentle urban start becomes old stone under pine.",
      },
      {
        startKm: 2,
        endKm: 5,
        title: "Catch first light",
        detail: "The western ridge opens to islands and morning sea.",
      },
      {
        startKm: 5,
        endKm: 8.6,
        title: "Run back to town",
        detail: "Smooth trail and quiet lanes carry you toward coffee.",
      },
    ],
    packing: ["Soft flask", "Light layer", "Road-to-trail shoes", "Coffee money"],
    gpxDownloadUrl: null,
  },
]);

type PublicDiscoverHttpResponse = {
  statusCode: number;
  headers: Record<string, string>;
  payload: Record<string, unknown>;
};

function errorResponse(
  statusCode: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): PublicDiscoverHttpResponse {
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

export function resolvePublicDiscoverRequest(
  method: string,
  url: URL,
  now: () => Date = () => new Date(),
): PublicDiscoverHttpResponse | null {
  if (url.pathname !== PUBLIC_DISCOVER_PATH) return null;

  if (method !== "GET") {
    return errorResponse(
      405,
      "method_not_allowed",
      "This endpoint supports GET requests only.",
      { Allow: "GET, OPTIONS" },
    );
  }

  const countryValues = url.searchParams.getAll("country");
  const unsupportedKeys = [...url.searchParams.keys()].filter(
    (key) => key !== "country",
  );
  if (
    countryValues.length !== 1
    || countryValues[0] !== "HR"
    || unsupportedKeys.length > 0
  ) {
    return errorResponse(
      400,
      "validation_error",
      "The Discover catalog currently supports exactly country=HR.",
    );
  }

  const catalog = publicDiscoverCatalogSchema.parse({
    version: 1,
    generatedAt: now().toISOString(),
    countryCode: "HR",
    trails,
  });

  return {
    statusCode: 200,
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
      "Content-Language": "en",
    },
    payload: { data: catalog },
  };
}
