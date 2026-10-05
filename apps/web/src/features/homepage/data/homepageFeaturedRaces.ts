import { apiRequest, resolveApiUrl } from "@/lib/api";
import { resolveRecoveredPublicMediaUrl } from "@/shared/media/recoveredPublicMedia";
import type { PortalEventCategory } from "@/lib/portal-data";
import type { PortalEventCatalogItem } from "@/lib/portal-read-models";
import { formatEventDistanceKm, formatEventEntryFees } from "@/features/events/public/model/eventInfoPresentation";
import { selectHomepageRaceCards } from "@/features/homepage/model/homepageRaceCards";
import { eventHasFinished } from "@/features/events/model/eventCompletion";
import type { SportCode } from "@raceson/domain/sports";
import { normalizeEventActivityType, type EventActivityType } from "@raceson/domain/activities";

type PublicRaceMoney = {
  amountCents: number;
  currency: string;
};

type PublicRaceSummaryContract = {
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
  linkedTrackImageUrl?: string | null;
  organizerName: string;
  categoryCount: number;
  registeredCount: number;
  distancesKm: number[];
  maximumElevationGainM: number;
  minimumEntryFee: PublicRaceMoney | null;
  entryFees?: PublicRaceMoney[];
  latestResultState: "provisional" | "official" | "corrected" | null;
};

type PublicRaceDirectoryContract = {
  races: PublicRaceSummaryContract[];
};

type PublicRaceCategoryContract = {
  kind?: "competitive" | "informative";
  sportCode: SportCode;
  slug: string;
  name: string;
  distanceKm: number | null;
  elevationGainM: number | null;
  capacity: number | null;
  registeredCount: number;
  entryFee: PublicRaceMoney | null;
  startAt: string | null;
  course: {
    name: string;
    slug: string;
  } | null;
};

type PublicRaceDetailContract = {
  race: {
    categories: PublicRaceCategoryContract[];
  };
};

function formatMoney(money: PublicRaceMoney | null) {
  if (!money) return "TBA";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: money.currency,
    maximumFractionDigits: money.amountCents % 100 === 0 ? 0 : 2,
  }).format(money.amountCents / 100);
}

function resolvePublicRaceCoverUrl(value: string | null | undefined) {
  const coverImageUrl = value?.trim();
  if (!coverImageUrl) return null;
  return coverImageUrl.startsWith("/api/")
    ? resolveApiUrl(coverImageUrl.slice("/api".length))
    : resolveRecoveredPublicMediaUrl(coverImageUrl);
}

function formatStatus(
  status: string,
  startDate: string,
  endDate: string | null,
  latestResultState: PublicRaceSummaryContract["latestResultState"],
  timeZone: string,
): PortalEventCatalogItem["status"] {
  const normalized = status.trim().toLowerCase();
  if (["in_progress", "in-progress", "live"].includes(normalized)) return "live";
  if (eventHasFinished({ status, startDate, endDate, timeZone, hasPublishedResults: Boolean(latestResultState) })) return "finished";
  if (["sold_out", "sold-out", "full"].includes(normalized)) return "sold_out";
  if (["registration_closed", "registration-closed", "closed"].includes(normalized)) return "closed";
  if (["open", "registration_open", "registration-open"].includes(normalized)) return "open";
  return normalized === "draft" ? "upcoming" : "open";
}

function mapRaceSummary(race: PublicRaceSummaryContract): PortalEventCatalogItem {
  return {
    id: race.slug,
    activityType: normalizeEventActivityType(race.activityType),
    sportCodes: race.sportCodes,
    primarySportCode: race.primarySportCode,
    title: race.name,
    date: new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${race.startDate}T00:00:00Z`)),
    location: race.locationLabel,
    distance: race.distancesKm.length
      ? `${race.distancesKm.map((distance) => formatEventDistanceKm(distance)).join(" / ")} km`
      : "TBA",
    elevation: race.maximumElevationGainM > 0 ? `${race.maximumElevationGainM.toLocaleString("en-US")} m+` : "TBA",
    status: formatStatus(race.status, race.startDate, race.endDate, race.latestResultState, race.timezone),
    participants: race.registeredCount,
    clubs: 0,
    price: formatEventEntryFees(
      race.entryFees?.length
        ? race.entryFees
        : race.minimumEntryFee
          ? [race.minimumEntryFee]
          : [],
    ),
    countryCode: race.countryCode,
    organizer: race.organizerName,
    lat: 0,
    lng: 0,
    tags: [],
    archiveBadges: race.latestResultState ? ["Results"] : undefined,
    coverImageUrl: resolvePublicRaceCoverUrl(race.coverImageUrl),
    linkedTrackImageUrl: resolvePublicRaceCoverUrl(race.linkedTrackImageUrl),
  };
}

function formatStartTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Zagreb",
  }).format(date);
}

export async function getHomepageFeaturedRaces() {
  const directory = await apiRequest<PublicRaceDirectoryContract>({
    path: "/v1/public/races",
    accessToken: null,
    cache: "no-store",
  });

  return selectHomepageRaceCards(directory.races.map(mapRaceSummary));
}

export async function getHomepageFeaturedRaceCategories(slug: string): Promise<PortalEventCategory[]> {
  const payload = await apiRequest<PublicRaceDetailContract>({
    path: `/v1/public/races/${encodeURIComponent(slug)}`,
    accessToken: null,
    cache: "no-store",
  });

  return payload.race.categories
    .filter((category) => category.kind !== "informative")
    .map((category) => ({
    slug: category.slug,
    name: category.name,
    sportCode: category.sportCode,
    distance: category.distanceKm == null ? "TBA" : `${formatEventDistanceKm(category.distanceKm)} km`,
    elevation: category.elevationGainM == null ? "TBA" : `${category.elevationGainM.toLocaleString("en-US")} m+`,
    participants: category.registeredCount,
    maxParticipants: category.capacity ?? 0,
    price: formatMoney(category.entryFee),
    cutoff: "TBA",
    startLabel: formatStartTime(category.startAt),
    startAtIso: category.startAt,
    linkedTrackSlug: category.course?.slug ?? null,
    linkedTrackName: category.course?.name ?? null,
    }));
}
