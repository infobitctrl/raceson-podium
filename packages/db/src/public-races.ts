import { raceFeeAt, type RaceFeePeriod } from "@raceson/domain/categories";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { createAdminSupabaseClient } from "./supabase.js";
import {
  normalizeEventActivityType,
  type EventActivityType,
} from "@raceson/domain/activities";
import {
  DEFAULT_SPORT_CODE,
  normalizeSportSelection,
  type SportCode,
} from "@raceson/domain/sports";

export type PublicRaceMoney = {
  amountCents: number;
  currency: string;
};

export type PublicRaceCoverImage = {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  bytes: Uint8Array;
};

export type PublicRaceSummary = {
  editionId: string;
  activityType: EventActivityType;
  sportCodes: SportCode[];
  primarySportCode: SportCode;
  countryCode: string | null;
  slug: string;
  name: string;
  startDate: string;
  endDate: string | null;
  timezone: string;
  locationLabel: string;
  status: string;
  coverImageUrl: string | null;
  linkedTrackImageUrl: string | null;
  organizerName: string;
  categoryCount: number;
  totalCapacity: number | null;
  registeredCount: number;
  distancesKm: number[];
  maximumElevationGainM: number;
  minimumEntryFee: PublicRaceMoney | null;
  entryFees: PublicRaceMoney[];
  latestResultState: string | null;
};

export type PublicRaceDetail = {
  editionId: string;
  activityType: EventActivityType;
  sportCodes: SportCode[];
  primarySportCode: SportCode;
  countryCode: string | null;
  slug: string;
  name: string;
  description: string;
  about: string;
  organizerRules: string;
  startDate: string;
  endDate: string | null;
  timezone: string;
  locationLabel: string;
  status: string;
  registrationOpenAt: string | null;
  registrationCloseAt: string | null;
  coverImageUrl: string | null;
  organizerName: string;
  websiteUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  timeline: Array<{
    time: string;
    description: string;
  }>;
  locations: Array<{
    id: string;
    type: string;
    label: string;
    placeLabel: string | null;
    description: string | null;
    latitude: number | null;
    longitude: number | null;
  }>;
  documents: Array<{
    title: string;
    type: string;
  }>;
  categories: Array<{
    kind: "competitive" | "informative";
    sportCode: SportCode;
    id: string;
    slug: string;
    name: string;
    coverImageUrl: string | null;
    distanceKm: number | null;
    elevationGainM: number | null;
    capacity: number | null;
    registeredCount: number;
    spotsRemaining: number | null;
    entryFee: PublicRaceMoney | null;
    feePeriods?: RaceFeePeriod[];
    startAt: string | null;
    minimumAge: number | null;
    maximumAge: number | null;
    allowedGenders: Array<"F" | "M" | "U">;
    eligibilityNote: string | null;
    registrationConfigurationUrl: string | null;
    course: {
      name: string;
      slug: string;
      gpxDownloadUrl: string;
    } | null;
  }>;
};

export type PublicRaceResults = {
  editionId: string;
  countryCode: string | null;
  slug: string;
  name: string;
  categories: Array<{
    id: string;
    slug: string;
    name: string;
    classifications: Array<{
      id: string;
      label: string;
      gender: "F" | "M" | null;
      minimumAge: number | null;
      maximumAge: number | null;
    }>;
    publicationState: "provisional" | "official" | "corrected";
    publishedAt: string;
    rows: Array<{
      resultId: string;
      bib: string | null;
      name: string;
      athleteSlug: string | null;
      clubName: string | null;
      gender: "F" | "M" | "U";
      ageCategoryLabel: string | null;
      participationStatus: "not_started" | "checked_in" | "dns" | "started" | "finished" | "dnf" | "dsq";
      resultStatus: "uncomputed" | "provisional" | "official" | "corrected" | "void";
      finishTimeMs: number | null;
      rankOverall: number | null;
      rankGender: number | null;
      rankAgeCategory: number | null;
    }>;
  }>;
};

type RegistrationCountRow = {
  event_category_id: string;
  registered_count: number | null;
};

type PublishedEditionContext = {
  edition: {
    id: string;
    event_series_id: string;
    slug: string;
    name: string;
    activity_type: string | null;
    start_date: string;
    end_date: string | null;
    timezone: string;
    location_name: string | null;
    registration_open_at: string | null;
    registration_close_at: string | null;
    status: string;
    cover_image_url: string | null;
    about_text: string | null;
    organizer_rules: string | null;
    website_url: string | null;
    instagram_url: string | null;
    facebook_url: string | null;
    general_timeline_json: unknown;
  };
  series: {
    id: string;
    organization_id: string;
    description: string | null;
    location_name: string | null;
    country_code: string | null;
  };
  organizerName: string;
};

type PublishedEditionJoinedRow = PublishedEditionContext["edition"] & {
  event_series:
    | (PublishedEditionContext["series"] & {
        organizations: { name: string | null } | Array<{ name: string | null }> | null;
      })
    | Array<
        PublishedEditionContext["series"] & {
          organizations: { name: string | null } | Array<{ name: string | null }> | null;
        }
      >
    | null;
};

function singleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

const PRESERVED_EVENT_LIFECYCLE_STATUSES = new Set([
  "registration_open",
  "registration_closed",
  "in_progress",
  "completed",
  "archived",
]);

export function derivePublishedEventStatus(
  status: string | null | undefined,
  _registrationOpenAt: string | null | undefined,
  _registrationCloseAt: string | null | undefined,
  _now = new Date(),
  evidence: {
    startDate?: string | null;
    endDate?: string | null;
    hasPublishedResults?: boolean;
    timeZone?: string | null;
  } = {},
) {
  const normalizedStatus = status?.trim().toLowerCase() || "published";
  // Provisional/partial results can be published while racing is still live.
  if (normalizedStatus === "in_progress") return normalizedStatus;
  if (
    evidence.hasPublishedResults
    || normalizedStatus === "completed"
    || normalizedStatus === "archived"
  ) {
    return "completed";
  }
  if (PRESERVED_EVENT_LIFECYCLE_STATUSES.has(normalizedStatus)) {
    return normalizedStatus;
  }

  // Publishing opens a race unless the organizer explicitly chose another
  // lifecycle state. Registration windows never close or finish the race.
  return "registration_open";
}

export function resolveOrganizerEventUpdateStatus({
  requestedStatus,
}: {
  currentStatus: string;
  publishedAt: string | null;
  currentRegistrationOpenAt: string | null;
  currentRegistrationCloseAt: string | null;
  requestedStatus?: string;
  registrationOpenAt?: string | null;
  registrationCloseAt?: string | null;
}) {
  return requestedStatus;
}

export function nonNegativeInteger(value: unknown): number | null {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  const number = finiteNumber(value);
  return number != null && number >= 0 ? Math.trunc(number) : null;
}

export function positiveInteger(value: unknown): number | null {
  const number = nonNegativeInteger(value);
  return number != null && number > 0 ? number : null;
}

export function positiveNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number != null && number > 0 ? number : null;
}

export function distinctPublicRaceFees(fees: PublicRaceMoney[]) {
  return Array.from(
    new Map(
      fees.map((fee) => [`${fee.currency}:${fee.amountCents}`, fee]),
    ).values(),
  ).sort((left, right) => (
    left.amountCents - right.amountCents || left.currency.localeCompare(right.currency)
  ));
}

function safePublicUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const candidate = value.trim();
  if (candidate.startsWith("/") && !candidate.startsWith("//")) {
    return candidate.includes("\\") || /[\u0000-\u001f]/.test(candidate) ? null : candidate;
  }
  try {
    return new URL(candidate).protocol === "https:" ? candidate : null;
  } catch {
    return null;
  }
}

function localSupabasePublicObjectPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const url = new URL(value.trim());
    const isLoopbackHost = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname);
    if (
      url.protocol !== "http:"
      || !isLoopbackHost
      || !url.pathname.startsWith("/storage/v1/object/public/")
    ) {
      return null;
    }

    return `/local-supabase${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function safePublicImageUrl(value: unknown): string | null {
  return safePublicUrl(value) ?? localSupabasePublicObjectPath(value);
}

function trackGalleryPreviewImageUrl(value: unknown) {
  if (!Array.isArray(value)) return null;
  const images = value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const imageUrl = safePublicImageUrl(record.imageUrl);
    return imageUrl ? [{ imageUrl, isDefault: record.isDefault === true }] : [];
  });
  return images.find((image) => image.isDefault)?.imageUrl
    ?? images[0]?.imageUrl
    ?? null;
}

const MAX_INLINE_PUBLIC_RACE_COVER_BYTES = 10 * 1024 * 1024;
const INLINE_PUBLIC_RACE_COVER_PATTERN =
  /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

function inlinePublicRaceCoverParts(value: unknown) {
  if (typeof value !== "string") return null;
  const match = INLINE_PUBLIC_RACE_COVER_PATTERN.exec(value.trim());
  if (!match) return null;
  const contentType = match[1] as PublicRaceCoverImage["contentType"];
  const base64 = match[2];
  if (base64.length % 4 === 1) return null;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const byteLength = Math.floor(base64.length * 3 / 4) - padding;
  if (byteLength <= 0 || byteLength > MAX_INLINE_PUBLIC_RACE_COVER_BYTES) return null;
  return { contentType, base64 };
}

export function decodeInlinePublicRaceCoverImage(
  value: unknown,
): PublicRaceCoverImage | null {
  const parts = inlinePublicRaceCoverParts(value);
  if (!parts) return null;
  const bytes = Buffer.from(parts.base64, "base64");
  if (!bytes.byteLength || bytes.byteLength > MAX_INLINE_PUBLIC_RACE_COVER_BYTES) return null;
  return { contentType: parts.contentType, bytes };
}

export function resolvePublicRaceCoverImageUrl(slug: string, value: unknown) {
  return safePublicImageUrl(value)
    ?? (inlinePublicRaceCoverParts(value)
      ? `/api/v1/public/races/${encodeURIComponent(slug)}/cover-image`
      : null);
}

function timelineFromJson(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const time = "time" in item && typeof item.time === "string" ? item.time.trim() : "";
      const description =
        "description" in item && typeof item.description === "string"
          ? item.description.trim()
          : "";
      return time && description ? [{ time, description }] : [];
    })
    .slice(0, 30);
}

function normalizedGender(value: unknown): "F" | "M" | "U" {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "U";
  return normalized === "F" || normalized === "M" ? normalized : "U";
}

function publicResultClassifications(value: unknown): PublicRaceResults["categories"][number]["classifications"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const rawClassifications = "classifications" in value ? value.classifications : null;
  if (!Array.isArray(rawClassifications)) return [];

  return rawClassifications.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const label = "label" in item && typeof item.label === "string" ? item.label.trim() : "";
    if (!label) return [];
    const rawGender = "gender" in item ? normalizedGender(item.gender) : "U";
    const minimumAge = "minimumAge" in item ? finiteNumber(item.minimumAge) : null;
    const maximumAge = "maximumAge" in item ? finiteNumber(item.maximumAge) : null;
    if (minimumAge != null && minimumAge < 0) return [];
    if (maximumAge != null && maximumAge < 0) return [];
    if (minimumAge != null && maximumAge != null && minimumAge > maximumAge) return [];

    return [{
      id: "key" in item && typeof item.key === "string" && item.key.trim()
        ? item.key.trim()
        : `classification-${index + 1}`,
      label,
      gender: rawGender === "U" ? null : rawGender,
      minimumAge,
      maximumAge,
    }];
  });
}

async function registrationCounts(
  adminClient: ReturnType<typeof createAdminSupabaseClient>,
  categoryIds: string[],
) {
  if (!categoryIds.length) return new Map<string, number>();
  const { data, error } = await adminClient.rpc("public_registration_counts", {
    target_event_category_ids: categoryIds,
  });
  if (error) throw error;
  return new Map(
    ((data ?? []) as RegistrationCountRow[]).map((row) => [
      row.event_category_id,
      nonNegativeInteger(row.registered_count) ?? 0,
    ]),
  );
}

async function publishedEditionBySlug(
  slug: string,
  countryCode: string | null,
  env: ServerEnv,
): Promise<PublishedEditionContext | null> {
  const adminClient = createAdminSupabaseClient(env);
  let editionQuery = adminClient
    .from("event_editions")
    .select(
      "id,event_series_id,slug,name,activity_type,start_date,end_date,timezone,location_name,registration_open_at,registration_close_at,status,cover_image_url,about_text,organizer_rules,website_url,instagram_url,facebook_url,general_timeline_json,event_series!inner(id,organization_id,description,location_name,country_code,organizations!inner(name))",
    )
    .eq("slug", slug)
    .eq("public_visibility", "public")
    .is("organizer_deleted_at", null)
    .not("published_at", "is", null)
    .neq("status", "draft");
  if (countryCode) {
    editionQuery = editionQuery.eq("event_series.country_code", countryCode);
  }
  const { data: joinedEdition, error: editionError } = await editionQuery
    .maybeSingle<PublishedEditionJoinedRow>();
  if (editionError) throw editionError;
  if (!joinedEdition) return null;
  const series = singleRelation(joinedEdition.event_series);
  if (!series || (countryCode && series.country_code !== countryCode)) return null;
  const organization = singleRelation(series.organizations);
  const { event_series: _eventSeries, ...edition } = joinedEdition;

  return {
    edition,
    series,
    organizerName:
      typeof organization?.name === "string" && organization.name.trim()
        ? organization.name.trim()
        : "Trail organizer",
  };
}

export async function getPublicRaceDirectory(
  countryCode: string | null = null,
  env: ServerEnv = loadServerEnv(),
): Promise<PublicRaceSummary[]> {
  const adminClient = createAdminSupabaseClient(env);
  let seriesQuery = adminClient
    .from("event_series")
    .select("id,organization_id,country_code");
  if (countryCode) {
    seriesQuery = seriesQuery.eq("country_code", countryCode);
  }
  const { data: seriesRows, error: seriesError } = await seriesQuery;
  if (seriesError) throw seriesError;
  if (!seriesRows?.length) return [];

  const seriesIds = seriesRows.map((row) => row.id);
  const organizationIds = Array.from(
    new Set(seriesRows.map((row) => row.organization_id).filter(Boolean)),
  );
  const { data: editions, error: editionsError } = await adminClient
    .from("event_editions")
    .select(
      "id,event_series_id,slug,name,activity_type,start_date,end_date,timezone,location_name,registration_open_at,registration_close_at,status,cover_image_url",
    )
    .in("event_series_id", seriesIds)
    .eq("public_visibility", "public")
    .is("organizer_deleted_at", null)
    .not("published_at", "is", null)
    .neq("status", "draft")
    .order("start_date", { ascending: true })
    .limit(100);
  if (editionsError) throw editionsError;
  if (!editions?.length) return [];

  const editionIds = editions.map((edition) => edition.id);
  const [
    { data: categories, error: categoriesError },
    { data: organizations, error: organizationsError },
    { data: sportRows, error: sportsError },
  ] =
    await Promise.all([
      adminClient
        .from("event_categories")
        .select(
          "id,event_edition_id,distance_km,elevation_gain_m,capacity,registration_fee_cents,registration_fee_periods,currency,status,results_mode",
        )
        .in("event_edition_id", editionIds)
        .is("organizer_deleted_at", null),
      organizationIds.length
        ? adminClient.from("organizations").select("id,name").in("id", organizationIds)
        : Promise.resolve({ data: [], error: null }),
      adminClient
        .from("event_edition_sports")
        .select("event_edition_id,sport_code,is_primary")
        .in("event_edition_id", editionIds),
    ]);
  if (categoriesError) throw categoriesError;
  if (organizationsError) throw organizationsError;
  if (sportsError) throw sportsError;

  const allPublicCategories = (categories ?? []).filter((category) => category.status !== "draft");
  const competitiveCategories = allPublicCategories.filter(
    (category) => category.results_mode !== "informative_age",
  );
  const categoryIds = competitiveCategories.map((category) => category.id);
  const [counts, publicationsResult, snapshotsResult] = await Promise.all([
    registrationCounts(adminClient, categoryIds),
    categoryIds.length
      ? adminClient
          .from("result_publications")
          .select("event_category_id,publication_state,published_at")
          .in("event_category_id", categoryIds)
          .order("published_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    categoryIds.length
      ? adminClient
          .from("event_category_track_snapshots")
          .select("event_category_id,track_template_id,track_version_id,created_at")
          .in("event_category_id", categoryIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (publicationsResult.error) throw publicationsResult.error;
  if (snapshotsResult.error) throw snapshotsResult.error;

  const latestSnapshotByCategory = new Map<string, {
    event_category_id: string;
    track_template_id: string;
    track_version_id: string | null;
  }>();
  for (const snapshot of snapshotsResult.data ?? []) {
    if (!latestSnapshotByCategory.has(snapshot.event_category_id)) {
      latestSnapshotByCategory.set(snapshot.event_category_id, snapshot);
    }
  }
  const templateIds = Array.from(new Set(
    [...latestSnapshotByCategory.values()].map((snapshot) => snapshot.track_template_id).filter(Boolean),
  ));
  const versionIds = Array.from(new Set(
    [...latestSnapshotByCategory.values()]
      .map((snapshot) => snapshot.track_version_id)
      .filter((versionId): versionId is string => Boolean(versionId)),
  ));
  const [templatesResult, versionsResult] = await Promise.all([
    templateIds.length
      ? adminClient
          .from("track_templates")
          .select("id,gallery_items_json")
          .in("id", templateIds)
      : Promise.resolve({ data: [], error: null }),
    versionIds.length
      ? adminClient
          .from("track_versions")
          .select("id")
          .in("id", versionIds)
          .not("published_at", "is", null)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (templatesResult.error) throw templatesResult.error;
  if (versionsResult.error) throw versionsResult.error;

  const publishedVersionIds = new Set((versionsResult.data ?? []).map((version) => version.id));
  const trackImageByTemplateId = new Map(
    (templatesResult.data ?? []).map((template) => [
      template.id,
      trackGalleryPreviewImageUrl(template.gallery_items_json),
    ]),
  );

  const seriesById = new Map(seriesRows.map((series) => [series.id, series]));
  const organizerById = new Map(
    (organizations ?? []).map((organization) => [organization.id, organization.name]),
  );
  const sportsByEdition = new Map<string, Array<{ sport_code: SportCode; is_primary: boolean }>>();
  for (const row of sportRows ?? []) {
    const current = sportsByEdition.get(row.event_edition_id) ?? [];
    current.push({ sport_code: row.sport_code as SportCode, is_primary: row.is_primary });
    sportsByEdition.set(row.event_edition_id, current);
  }
  const categoriesByEdition = new Map<string, typeof competitiveCategories>();
  for (const category of competitiveCategories) {
    const current = categoriesByEdition.get(category.event_edition_id) ?? [];
    current.push(category);
    categoriesByEdition.set(category.event_edition_id, current);
  }

  const latestResultStateByCategory = new Map<string, string>();
  for (const publication of publicationsResult.data ?? []) {
    if (!latestResultStateByCategory.has(publication.event_category_id)) {
      latestResultStateByCategory.set(
        publication.event_category_id,
        publication.publication_state,
      );
    }
  }

  return editions.map((edition) => {
    const sportSelection = normalizeSportSelection({
      sportCodes: sportsByEdition.get(edition.id)?.map((row) => row.sport_code),
      primarySportCode: sportsByEdition.get(edition.id)?.find((row) => row.is_primary)?.sport_code,
    });
    const editionCategories = categoriesByEdition.get(edition.id) ?? [];
    const distancesKm = editionCategories
      .map((category) => finiteNumber(category.distance_km))
      .filter((distance): distance is number => distance != null && distance > 0)
      .sort((left, right) => right - left);
    const fees = distinctPublicRaceFees(editionCategories
      .flatMap((category) => {
        const amountCents = (category.registration_fee_periods as RaceFeePeriod[] | undefined)?.length
        ? raceFeeAt(category.registration_fee_cents, category.registration_fee_periods as RaceFeePeriod[])
        : nonNegativeInteger(category.registration_fee_cents);
        const currency =
          typeof category.currency === "string" && category.currency.trim()
            ? category.currency.trim().toUpperCase()
            : null;
        return amountCents != null && currency ? [{ amountCents, currency }] : [];
      }));
    const series = seriesById.get(edition.event_series_id);
    const linkedTrackImageUrl = editionCategories
      .map((category) => latestSnapshotByCategory.get(category.id))
      .filter((snapshot) => snapshot?.track_version_id && publishedVersionIds.has(snapshot.track_version_id))
      .map((snapshot) => trackImageByTemplateId.get(snapshot!.track_template_id) ?? null)
      .find((imageUrl): imageUrl is string => Boolean(imageUrl))
      ?? null;
    const resultStates = editionCategories
      .map((category) => latestResultStateByCategory.get(category.id) ?? null)
      .filter((state): state is string => Boolean(state));

    return {
      editionId: edition.id,
      activityType: normalizeEventActivityType(edition.activity_type),
      sportCodes: sportSelection.sportCodes,
      primarySportCode: sportSelection.primarySportCode,
      countryCode: series?.country_code?.trim().toUpperCase() || null,
      slug: edition.slug,
      name: edition.name,
      startDate: edition.start_date,
      endDate: edition.end_date,
      timezone: edition.timezone,
      locationLabel: edition.location_name?.trim() || "Croatia",
      status: derivePublishedEventStatus(
        edition.status,
        edition.registration_open_at,
        edition.registration_close_at,
        new Date(),
        {
          startDate: edition.start_date,
          endDate: edition.end_date,
          hasPublishedResults: resultStates.length > 0,
          timeZone: edition.timezone,
        },
      ),
      coverImageUrl: resolvePublicRaceCoverImageUrl(edition.slug, edition.cover_image_url),
      linkedTrackImageUrl,
      organizerName:
        (series?.organization_id && organizerById.get(series.organization_id)?.trim()) ||
        "Trail organizer",
      categoryCount: allPublicCategories.filter(
        (category) => category.event_edition_id === edition.id,
      ).length,
      totalCapacity: editionCategories.some(
        (category) => positiveInteger(category.capacity) != null,
      )
        ? editionCategories.reduce(
            (total, category) => total + (positiveInteger(category.capacity) ?? 0),
            0,
          )
        : null,
      registeredCount: editionCategories.reduce(
        (total, category) => total + (counts.get(category.id) ?? 0),
        0,
      ),
      distancesKm,
      maximumElevationGainM: editionCategories.reduce(
        (maximum, category) =>
          Math.max(maximum, nonNegativeInteger(category.elevation_gain_m) ?? 0),
        0,
      ),
      minimumEntryFee: fees[0] ?? null,
      entryFees: fees,
      latestResultState:
        resultStates.includes("corrected")
          ? "corrected"
          : resultStates.includes("official")
            ? "official"
            : resultStates.includes("provisional")
              ? "provisional"
              : null,
    };
  });
}

export async function getPublicRaceDetail(
  slug: string,
  countryCode: string | null = null,
  env: ServerEnv = loadServerEnv(),
): Promise<PublicRaceDetail | null> {
  const context = await publishedEditionBySlug(slug, countryCode, env);
  if (!context) return null;
  const adminClient = createAdminSupabaseClient(env);

  const [
    categoriesResult,
    locationsResult,
    documentsResult,
    sportsResult,
  ] = await Promise.all([
    adminClient
      .from("event_categories")
      .select(
        "id,slug,name,cover_image_url,sport_code,distance_km,elevation_gain_m,capacity,registration_fee_cents,registration_fee_periods,currency,start_at,status,results_mode,minimum_age,maximum_age,allowed_genders,eligibility_note,display_order",
      )
      .eq("event_edition_id", context.edition.id)
      .is("organizer_deleted_at", null)
      .neq("status", "draft")
      .order("display_order", { ascending: true })
      .order("distance_km", { ascending: false }),
    adminClient
      .from("event_locations")
      .select(
        "id,location_type,label,place_label,description,latitude,longitude,display_order",
      )
      .eq("event_edition_id", context.edition.id)
      .order("display_order", { ascending: true }),
    adminClient
      .from("event_documents")
      .select("title,document_type")
      .eq("event_edition_id", context.edition.id)
      .eq("visibility", "public")
      .order("created_at", { ascending: false }),
    adminClient
      .from("event_edition_sports")
      .select("sport_code,is_primary")
      .eq("event_edition_id", context.edition.id),
  ]);
  if (categoriesResult.error) throw categoriesResult.error;
  if (locationsResult.error) throw locationsResult.error;
  if (documentsResult.error) throw documentsResult.error;
  if (sportsResult.error) throw sportsResult.error;

  const sportSelection = normalizeSportSelection({
    sportCodes: sportsResult.data?.map((row) => row.sport_code),
    primarySportCode: sportsResult.data?.find((row) => row.is_primary)?.sport_code,
  });

  const categories = categoriesResult.data ?? [];
  const competitiveCategories = categories.filter(
    (category) => category.results_mode !== "informative_age",
  );
  const categoryIds = competitiveCategories.map((category) => category.id);
  const [counts, snapshotsResult, publicationsResult] = await Promise.all([
    registrationCounts(adminClient, categoryIds),
    categoryIds.length
      ? adminClient
          .from("event_category_track_snapshots")
          .select("event_category_id,track_template_id,track_version_id,created_at")
          .in("event_category_id", categoryIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    categoryIds.length
      ? adminClient
          .from("result_publications")
          .select("id")
          .in("event_category_id", categoryIds)
          .in("publication_state", ["provisional", "official", "corrected"])
          .limit(1)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (snapshotsResult.error) throw snapshotsResult.error;
  if (publicationsResult.error) throw publicationsResult.error;

  const latestSnapshotByCategory = new Map<
    string,
    {
      event_category_id: string;
      track_template_id: string;
      track_version_id: string | null;
    }
  >();
  for (const snapshot of snapshotsResult.data ?? []) {
    if (!latestSnapshotByCategory.has(snapshot.event_category_id)) {
      latestSnapshotByCategory.set(snapshot.event_category_id, snapshot);
    }
  }

  const templateIds = Array.from(
    new Set(
      [...latestSnapshotByCategory.values()]
        .map((snapshot) => snapshot.track_template_id)
        .filter(Boolean),
    ),
  );
  const versionIds = Array.from(
    new Set(
      [...latestSnapshotByCategory.values()]
        .map((snapshot) => snapshot.track_version_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const [templatesResult, versionsResult] = await Promise.all([
    templateIds.length
      ? adminClient.from("track_templates").select("id,slug,name").in("id", templateIds)
      : Promise.resolve({ data: [], error: null }),
    versionIds.length
      ? adminClient
          .from("track_versions")
          .select("id,published_at")
          .in("id", versionIds)
          .not("published_at", "is", null)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (templatesResult.error) throw templatesResult.error;
  if (versionsResult.error) throw versionsResult.error;

  const templatesById = new Map(
    (templatesResult.data ?? []).map((template) => [template.id, template]),
  );
  const publishedVersionIds = new Set(
    (versionsResult.data ?? []).map((version) => version.id),
  );

  return {
    editionId: context.edition.id,
    activityType: normalizeEventActivityType(context.edition.activity_type),
    sportCodes: sportSelection.sportCodes,
    primarySportCode: sportSelection.primarySportCode,
    countryCode: context.series.country_code?.trim().toUpperCase() || null,
    slug: context.edition.slug,
    name: context.edition.name,
    description: context.series.description?.trim() || "",
    about: context.edition.about_text?.trim() || "",
    organizerRules: context.edition.organizer_rules?.trim() || "",
    startDate: context.edition.start_date,
    endDate: context.edition.end_date,
    timezone: context.edition.timezone,
    locationLabel:
      context.edition.location_name?.trim() ||
      context.series.location_name?.trim() ||
      "Croatia",
    status: derivePublishedEventStatus(
      context.edition.status,
      context.edition.registration_open_at,
      context.edition.registration_close_at,
      new Date(),
      {
        startDate: context.edition.start_date,
        endDate: context.edition.end_date,
        hasPublishedResults: Boolean(publicationsResult.data?.length),
        timeZone: context.edition.timezone,
      },
    ),
    registrationOpenAt: context.edition.registration_open_at,
    registrationCloseAt: context.edition.registration_close_at,
    coverImageUrl: resolvePublicRaceCoverImageUrl(
      context.edition.slug,
      context.edition.cover_image_url,
    ),
    organizerName: context.organizerName,
    websiteUrl: safePublicUrl(context.edition.website_url),
    instagramUrl: safePublicUrl(context.edition.instagram_url),
    facebookUrl: safePublicUrl(context.edition.facebook_url),
    timeline: timelineFromJson(context.edition.general_timeline_json),
    locations: (locationsResult.data ?? []).map((location) => ({
      id: location.id,
      type: location.location_type,
      label: location.label,
      placeLabel: location.place_label?.trim() || null,
      description: location.description?.trim() || null,
      latitude: finiteNumber(location.latitude),
      longitude: finiteNumber(location.longitude),
    })),
    documents: (documentsResult.data ?? []).map((document) => ({
      title: document.title,
      type: document.document_type,
    })),
    categories: categories.map((category) => {
      const isInformative = category.results_mode === "informative_age";
      const capacity = isInformative ? null : positiveInteger(category.capacity);
      const registeredCount = counts.get(category.id) ?? 0;
      const amountCents = (category.registration_fee_periods as RaceFeePeriod[] | undefined)?.length
        ? raceFeeAt(category.registration_fee_cents, category.registration_fee_periods as RaceFeePeriod[])
        : nonNegativeInteger(category.registration_fee_cents);
      const currency =
        typeof category.currency === "string" && category.currency.trim()
          ? category.currency.trim().toUpperCase()
          : null;
      const snapshot = latestSnapshotByCategory.get(category.id);
      const template = snapshot
        && snapshot.track_version_id
        && publishedVersionIds.has(snapshot.track_version_id)
        ? templatesById.get(snapshot.track_template_id)
        : null;

      const normalizedAllowedGenders = Array.isArray(category.allowed_genders)
        ? Array.from(new Set(category.allowed_genders.map(normalizedGender))).slice(0, 3)
        : [];

      return {
        kind: isInformative ? "informative" : "competitive",
        sportCode: (category.sport_code as SportCode | null) ?? DEFAULT_SPORT_CODE,
        id: category.id,
        slug: category.slug,
        name: category.name,
        coverImageUrl: safePublicImageUrl(category.cover_image_url),
        distanceKm: isInformative ? null : positiveNumber(category.distance_km),
        elevationGainM: isInformative ? null : nonNegativeInteger(category.elevation_gain_m),
        capacity,
        registeredCount,
        spotsRemaining: capacity == null ? null : Math.max(0, capacity - registeredCount),
        feePeriods: (category.registration_fee_periods ?? []) as RaceFeePeriod[],
        entryFee:
          !isInformative && amountCents != null && currency ? { amountCents, currency } : null,
        startAt: isInformative ? null : category.start_at,
        minimumAge: nonNegativeInteger(category.minimum_age),
        maximumAge: nonNegativeInteger(category.maximum_age),
        allowedGenders: normalizedAllowedGenders.length
          ? normalizedAllowedGenders
          : ["F", "M", "U"],
        eligibilityNote: category.eligibility_note?.trim() || null,
        registrationConfigurationUrl: isInformative
          ? null
          : `/api/v1/public/categories/${category.id}/registration-configuration`,
        course: !isInformative && template
          ? {
              name: template.name,
              slug: template.slug,
              gpxDownloadUrl: `/api/v1/tracks/${template.slug}/gpx`,
            }
          : null,
      };
    }),
  };
}

export async function getPublicRaceCoverImage(
  slug: string,
  countryCode: string | null = null,
  env: ServerEnv = loadServerEnv(),
): Promise<PublicRaceCoverImage | null> {
  const context = await publishedEditionBySlug(slug, countryCode, env);
  if (!context) return null;
  return decodeInlinePublicRaceCoverImage(context.edition.cover_image_url);
}

export async function getPublicRaceResults(
  slug: string,
  countryCode: string | null = null,
  env: ServerEnv = loadServerEnv(),
): Promise<PublicRaceResults | null> {
  const context = await publishedEditionBySlug(slug, countryCode, env);
  if (!context) return null;
  const adminClient = createAdminSupabaseClient(env);
  const categoriesResult = await adminClient
    .from("event_categories")
    .select("id,slug,name,status,results_mode,display_order,ranking_config_json")
    .eq("event_edition_id", context.edition.id)
    .is("organizer_deleted_at", null)
    .neq("status", "draft")
    .neq("results_mode", "informative_age")
    .order("display_order", { ascending: true });
  if (categoriesResult.error) throw categoriesResult.error;
  const categories = categoriesResult.data ?? [];
  const categoryIds = categories.map((category) => category.id);

  const publicationsResult = categoryIds.length
    ? await adminClient
        .from("result_publications")
        .select("event_category_id,result_run_id,publication_state,published_at")
        .in("event_category_id", categoryIds)
        .order("published_at", { ascending: false })
    : { data: [], error: null };
  if (publicationsResult.error) throw publicationsResult.error;

  const latestPublicationByCategory = new Map<
    string,
    {
      resultRunId: string;
      publicationState: "provisional" | "official" | "corrected";
      publishedAt: string;
    }
  >();
  for (const publication of publicationsResult.data ?? []) {
    if (latestPublicationByCategory.has(publication.event_category_id)) continue;
    if (
      publication.publication_state !== "provisional"
      && publication.publication_state !== "official"
      && publication.publication_state !== "corrected"
    ) {
      continue;
    }
    latestPublicationByCategory.set(publication.event_category_id, {
      resultRunId: publication.result_run_id,
      publicationState: publication.publication_state,
      publishedAt: publication.published_at,
    });
  }

  const publishedRunIds = Array.from(
    new Set(
      [...latestPublicationByCategory.values()].map(
        (publication) => publication.resultRunId,
      ),
    ),
  );
  const [participantsResult, publishedRowsResult] = await Promise.all([
    adminClient.rpc("public_event_participants", {
      target_event_edition_id: context.edition.id,
    }),
    publishedRunIds.length
      ? adminClient
          .from("result_rows")
          .select("result_run_id,registration_id")
          .in("result_run_id", publishedRunIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (participantsResult.error) throw participantsResult.error;
  if (publishedRowsResult.error) throw publishedRowsResult.error;

  const categoryByRunId = new Map(
    [...latestPublicationByCategory.entries()].map(
      ([categoryId, publication]) => [publication.resultRunId, categoryId],
    ),
  );
  const publishedResultRegistrations = new Set(
    (publishedRowsResult.data ?? []).flatMap((row) => {
      const categoryId = categoryByRunId.get(row.result_run_id);
      return categoryId ? [`${categoryId}:${row.registration_id}`] : [];
    }),
  );

  const rowsByCategory = new Map<string, PublicRaceResults["categories"][number]["rows"]>();
  for (const row of participantsResult.data ?? []) {
    if (!latestPublicationByCategory.has(row.event_category_id)) continue;
    if (!row.publication_state) continue;
    if (
      !publishedResultRegistrations.has(
        `${row.event_category_id}:${row.registration_id}`,
      )
    ) {
      continue;
    }
    const participationStatus = [
      "not_started",
      "checked_in",
      "dns",
      "started",
      "finished",
      "dnf",
      "dsq",
    ].includes(row.participation_status)
      ? row.participation_status
      : "not_started";
    const resultStatus = [
      "uncomputed",
      "provisional",
      "official",
      "corrected",
      "void",
    ].includes(row.result_status)
      ? row.result_status
      : "uncomputed";
    const rows = rowsByCategory.get(row.event_category_id) ?? [];
    rows.push({
      resultId: row.registration_id,
      bib: row.bib_number?.trim() || null,
      name: row.athlete_name?.trim() || "Trail runner",
      athleteSlug: row.athlete_slug?.trim() || null,
      clubName: row.club_name?.trim() || null,
      gender: normalizedGender(row.gender),
      ageCategoryLabel: row.age_category_label?.trim() || null,
      participationStatus,
      resultStatus,
      finishTimeMs: nonNegativeInteger(row.finish_time_ms),
      rankOverall: nonNegativeInteger(row.rank_overall),
      rankGender: nonNegativeInteger(row.rank_gender),
      rankAgeCategory: nonNegativeInteger(row.rank_age_category),
    });
    rowsByCategory.set(row.event_category_id, rows);
  }

  return {
    editionId: context.edition.id,
    countryCode: context.series.country_code?.trim().toUpperCase() || null,
    slug: context.edition.slug,
    name: context.edition.name,
    categories: categories.flatMap((category) => {
      const publication = latestPublicationByCategory.get(category.id);
      if (!publication) return [];
      return [
        {
          id: category.id,
          slug: category.slug,
          name: category.name,
          classifications: publicResultClassifications(category.ranking_config_json),
          ...publication,
          rows: (rowsByCategory.get(category.id) ?? []).sort(
            (left, right) =>
              (left.rankOverall ?? Number.MAX_SAFE_INTEGER) -
              (right.rankOverall ?? Number.MAX_SAFE_INTEGER),
          ),
        },
      ];
    }),
  };
}
