import { PublicEventInitialSummary, usePublicEventInitialData } from "@/features/events/public/components/PublicEventInitialData";
import { getPublicTrackPreviewImage } from "@/features/events/public/data/publicTrackPreviewImage";
import { storedEventSlug } from "@/features/events/model/eventUrl";
import { RaceFeePeriods } from "@/features/events/public/components/RaceFeePeriods";
import { documentTitleKey, useDocumentTitle } from "@/shared/navigation/documentTitle";
import {
  lazy,
  Suspense,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { hr } from "date-fns/locale";
import Image from "next/image";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowRight,
  ArrowUpDown,
  ArrowUpRight,
  Calendar,
  Camera,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock3,
  CloudSun,
  Droplets,
  ExternalLink,
  FileText,
  Flag,
  Globe,
  Images,
  Loader2,
  Mail,
  MapPin,
  Mountain,
  Navigation,
  Play,
  Phone,
  Radio,
  Route,
  Search,
  ShieldAlert,
  Star,
  Tent,
  Trophy,
  Ticket,
  Users,
  Wind,
} from "lucide-react";
import EventTabFeatureBanner from "@/components/shared/EventTabFeatureBanner";
import { CountryFlag, CountryWithFlag } from "@/components/shared/CountryFlag";
import HeroMountainDivider from "@/components/shared/HeroMountainDivider";
import type { ElevPoint } from "@/components/shared/InteractiveElevation";
import type { EventLocation, EventMapRoute } from "@/components/shared/EventLocationsMap";
import ScrollReveal from "@/components/shared/ScrollReveal";
import EventCommunityFeedback from "@/features/events/public/components/EventCommunityFeedback";
import { EventDetailAvailabilityState } from "@/features/events/public/components/EventDetailAvailabilityState";
import { EventStatisticsPanel } from "@/features/events/public/components/EventStatisticsPanel";
import { EventLeagueRoundPill } from "@/features/events/public/components/EventLeagueRoundPill";
import { EventSectionNavigation, type EventNavigationItem } from "@/features/events/public/components/EventSectionNavigation";
import { EventRaceInfo } from "@/features/events/public/components/EventRaceInfo";
import { LeagueRoundNavigation } from "@/features/leagues/public/components/LeagueRoundNavigation";
import { submitEventPhotoFiles } from "@/features/events/public/data/eventPhotoSubmissions";
import { buildEventEligibilityPresentation } from "@/features/events/public/model/eventPublicPresentation";
import {
  eventCountryLabel,
  formatEventPriceLabels,
  formatEventDistanceKm,
  localizedEventDateLabel,
  localizedEventDistanceLabel,
  localizedEventPriceLabel,
} from "@/features/events/public/model/eventInfoPresentation";
import { useI18n } from "@/shared/i18n/I18nContext";
import type { AppLocale } from "@/shared/i18n/locales";
import { translate } from "@/shared/i18n/messages";
import { eventRulesSafetyValues, eventSegmentPresentation, eventPointName, isPublicRacePointRequired } from "@/features/events/public/model/eventDetailCopy";
import { buildEventRegistrationScopeSummary } from "@/features/events/public/model/eventRegistrationSummary";
import { getEventDetailQueryScope } from "@/features/events/public/model/eventDetailQueryScope";
import { mergePublicCoursePoints } from "@/features/events/public/model/publicCoursePoints";
import TrackRecordTimeLink from "@/features/tracks/public/components/TrackRecordTimeLink";
import { resolveTrackRecordOccurredAt } from "@/features/tracks/public/model/trackRecords";
import { ResultPlaceBadge } from "@/features/results/public/components/ResultPodiumVisual";
import { LiveCheckpointProgressGrid } from "@/features/results/public/components/LiveCheckpointProgressGrid";
import { PublicResultsLifecycleNotice } from "@/features/results/public/components/PublicResultsLifecycleNotice";
import { ResultStandingScopePills } from "@/features/results/public/components/ResultStandingScopePills";
import { getResultPodiumVisual } from "@/features/results/public/model/resultPodiumVisual";
import {
  formatPublicResultAverageSpeed,
  formatPublicResultPublicationLabel,
  formatPublicResultWinnerGap,
  getPublicResultWinnerTimeMs,
  normalizePublicResultClubName,
} from "@/features/results/public/model/publicResultPresentation";
import {
  buildResultStandingScopes,
  getResultStandingPlacements,
  getResultStandingRank,
  resultRowsForStandingScope,
  type ResultStandingPlacement,
} from "@/features/results/public/model/resultStandingScopes";
import { Skeleton } from "@/components/ui/skeleton";
import { brandLandscapes } from "@/assets/brand-landscapes";
import { brand } from "@/shared/brand/brand";
import { getTrackThemeHero } from "@/lib/track-image-themes";
import weatherClearDayIconAsset from "@/assets/weather-icons/clear-day.svg";
import weatherClearNightIconAsset from "@/assets/weather-icons/clear-night.svg";
import weatherPartlyCloudyDayIconAsset from "@/assets/weather-icons/partly-cloudy-day.svg";
import weatherPartlyCloudyNightIconAsset from "@/assets/weather-icons/partly-cloudy-night.svg";
import weatherCloudyIconAsset from "@/assets/weather-icons/cloudy.svg";
import weatherFogDayIconAsset from "@/assets/weather-icons/fog-day.svg";
import weatherDrizzleIconAsset from "@/assets/weather-icons/drizzle.svg";
import weatherOvercastDayRainIconAsset from "@/assets/weather-icons/overcast-day-rain.svg";
import weatherOvercastNightRainIconAsset from "@/assets/weather-icons/overcast-night-rain.svg";
import weatherExtremeDayIconAsset from "@/assets/weather-icons/extreme-day.svg";
import weatherExtremeDaySnowIconAsset from "@/assets/weather-icons/extreme-day-snow.svg";
import weatherWindIconAsset from "@/assets/weather-icons/wind.svg";
import { getLiveWeatherSnapshots, type LiveWeatherSnapshot } from "@/lib/live-weather";
import {
  getEventDetail,
  getPublicEventGeometry,
  isEventFinishedStatus,
  isEventRegistrationOpenStatus,
  getTrackDetail,
  PublicEventNotFoundError,
  type EventDetailData,
  type PortalCheckpoint,
  type PortalEventCategory,
  type PortalEventLocation,
  type PortalRaceCheckpoint,
  type TrackDetailData,
} from "@/lib/portal-data";
import {
  getPublicEventParticipantsReadModel,
  getPublicEventResultsReadModel,
  getPublicLiveEditionReadModel,
  type PublicEventParticipantRow,
} from "@/lib/portal-read-models";
import { buildRegistrationPath } from "@/lib/navigation";
import { getPublicLeagueDetail } from "@/lib/league-read-models";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { staticAssetUrl } from "@/lib/static-asset";
import { isNextOptimizablePublicImageUrl } from "@/shared/media/optimizedPublicImage";
import {
  formatSexLabel,
} from "@/shared/domain/competitiveClassification";
import { countryName } from "@/shared/domain/countries";
import { MobileDetailDisclosure } from "@/shared/mobile/MobileDetailDisclosure";
import {
  OrganizationSocialLinks,
} from "@/shared/organizer/OrganizationSocialLinks";
import { organizationHasSocialLinks } from "@/shared/organizer/publicOrganizationSocialLinks";
import { SportBadge, SportBadgeList } from "@/shared/sports";
import { ActivityTypeBadge } from "@/shared/activities";
import {
  coerceEventTab,
  eventTabs,
  type EventTab,
} from "@/features/events/public/model/eventTab";

const featuredEventHeroImage = brandLandscapes.highRidgePath;
const leagueRiverImage = brandLandscapes.lakeShoreGold;
const ridgePortraitImage = brandLandscapes.highRidgePathPortrait;
const torakLandscapeImage = brandLandscapes.coastalHeadlandPath;
const weatherClearDayIcon = staticAssetUrl(weatherClearDayIconAsset);
const weatherClearNightIcon = staticAssetUrl(weatherClearNightIconAsset);
const weatherPartlyCloudyDayIcon = staticAssetUrl(weatherPartlyCloudyDayIconAsset);
const weatherPartlyCloudyNightIcon = staticAssetUrl(weatherPartlyCloudyNightIconAsset);
const weatherCloudyIcon = staticAssetUrl(weatherCloudyIconAsset);
const weatherFogDayIcon = staticAssetUrl(weatherFogDayIconAsset);
const weatherDrizzleIcon = staticAssetUrl(weatherDrizzleIconAsset);
const weatherOvercastDayRainIcon = staticAssetUrl(weatherOvercastDayRainIconAsset);
const weatherOvercastNightRainIcon = staticAssetUrl(weatherOvercastNightRainIconAsset);
const weatherExtremeDayIcon = staticAssetUrl(weatherExtremeDayIconAsset);
const weatherExtremeDaySnowIcon = staticAssetUrl(weatherExtremeDaySnowIconAsset);
const weatherWindIcon = staticAssetUrl(weatherWindIconAsset);

const LazyEventGalleryMosaic = lazy(
  () => import("@/features/events/public/components/EventGalleryMosaic"),
);
const LazyEventLocationsMap = lazy(
  () => import("@/components/shared/EventLocationsMap"),
);
const LazyInteractiveElevation = lazy(
  () => import("@/components/shared/InteractiveElevation"),
);
const LazyTrackMap = lazy(
  () => import("@/components/shared/TrackMap"),
);

const staticTabs = eventTabs;
type StaticEventTab = EventTab;
type EventLifecycle = "before" | "during" | "after";
const ALL_RACES_VALUE = "__all_races__";
const EMPTY_EVENT_CATEGORIES: PortalEventCategory[] = [];
const EMPTY_EVENT_DOCUMENTS: EventDetailData["documents"] = [];
const EMPTY_EVENT_PARTICIPANT_ROWS: PublicEventParticipantRow[] = [];
const premiumGlassPillClass =
  "inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/28 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur-md";
const premiumMarkerPillClass =
  "inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/[0.08] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-primary";
const premiumCardActionPillClass =
  "relative inline-flex w-[8.75rem] items-center justify-center rounded-full border border-white/15 bg-black/28 px-4 py-2 text-[11px] font-semibold text-white backdrop-blur-md shadow-soft transition-all duration-300 group-hover:bg-primary group-hover:text-primary-foreground group-hover:shadow-glow";
const eventHeroInfoPillClass =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-white/18 bg-black/32 px-2.5 text-[10px] font-semibold text-white backdrop-blur-md dark:border-white/25 dark:bg-black/62";

function DeferredViewportContent({
  children,
  className,
  rootMargin = "240px 0px",
}: {
  children: ReactNode;
  className: string;
  rootMargin?: string;
}) {
  const boundaryRef = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    const boundary = boundaryRef.current;
    if (!boundary || typeof IntersectionObserver === "undefined") {
      setShouldRender(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setShouldRender(true);
        observer.disconnect();
      },
      { rootMargin },
    );
    observer.observe(boundary);
    return () => observer.disconnect();
  }, [rootMargin]);

  return (
    <div ref={boundaryRef} className={className}>
      {shouldRender ? children : <div aria-hidden="true" className="h-full w-full animate-pulse rounded-[inherit] bg-muted/35" />}
    </div>
  );
}

function DeferredEventLocationsMap(
  props: ComponentProps<typeof LazyEventLocationsMap>,
) {
  return (
    <DeferredViewportContent className={cn("min-h-[360px]", props.className)}>
      <Suspense fallback={<div aria-hidden="true" className="h-full w-full animate-pulse rounded-xl bg-muted/35" />}>
        <LazyEventLocationsMap {...props} className="h-full" />
      </Suspense>
    </DeferredViewportContent>
  );
}

function DeferredEventGalleryMosaic(
  props: ComponentProps<typeof LazyEventGalleryMosaic>,
) {
  const placeholderHeight = props.mode === "preview" ? "min-h-[32rem]" : "min-h-[52rem]";
  return (
    <DeferredViewportContent
      className={placeholderHeight}
      rootMargin={props.mode === "preview" ? "160px 0px" : "80px 0px"}
    >
      <Suspense fallback={<div aria-hidden="true" className="h-full w-full animate-pulse rounded-[20px] bg-muted/35" />}>
        <LazyEventGalleryMosaic {...props} />
      </Suspense>
    </DeferredViewportContent>
  );
}

function EventHeroImage({ src, alt }: { src: string; alt: string }) {
  if (isNextOptimizablePublicImageUrl(src)) {
    return (
      <Image
        data-event-client-hero-image
        src={src}
        alt={alt}
        fill
        sizes="100vw"
        quality={60}
        loading="eager"
        fetchPriority="high"
        className="object-cover object-center"
      />
    );
  }

  return (
    <img
      data-event-client-hero-image
      src={src}
      alt={alt}
      decoding="async"
      loading="eager"
      fetchPriority="high"
      className="absolute inset-0 h-full w-full object-cover object-center"
    />
  );
}

function EventContentImage({
  src,
  alt,
  sizes,
  className,
}: {
  src: string;
  alt: string;
  sizes: string;
  className?: string;
}) {
  if (isNextOptimizablePublicImageUrl(src)) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        quality={75}
        loading="lazy"
        className={className}
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      decoding="async"
      loading="lazy"
      className={cn("absolute inset-0 h-full w-full", className)}
    />
  );
}

function formatDateTime(value: string | null) {
  if (!value) return "not yet";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

type ScheduleItem = {
  time: string;
  label: string;
  tone: "neutral" | "primary" | "accent";
};

type InfoModuleItem = {
  label: string;
  value: string;
  isAuthorContent?: boolean;
};

type ParticipantFilters = {
  search: string;
  gender: string;
  club: string;
  registrationStatus: string;
  raceStatus: string;
  sortBy: string;
  sortDirection: "asc" | "desc";
};

type FilterOption = {
  value: string;
  label: string;
  count: number;
};

type RosterFilterPanelProps = {
  title: string;
  description: string;
  filters: ParticipantFilters;
  defaultFilters: ParticipantFilters;
  genderOptions: FilterOption[];
  clubOptions: FilterOption[];
  registrationStatusOptions: FilterOption[];
  raceStatusOptions: FilterOption[];
  sortOptions: Array<{ value: string; label: string }>;
  filteredCount: number;
  totalCount: number;
  searchPlaceholder: string;
  onFiltersChange: (next: ParticipantFilters) => void;
  onReset: () => void;
};

const defaultRegistrationFilters: ParticipantFilters = {
  search: "",
  gender: "all",
  club: "all",
  registrationStatus: "all",
  raceStatus: "all",
  sortBy: "bib",
  sortDirection: "desc",
};

const defaultResultsFilters: ParticipantFilters = {
  search: "",
  gender: "all",
  club: "all",
  registrationStatus: "all",
  raceStatus: "all",
  sortBy: "overall",
  sortDirection: "asc",
};

const registrationSortOptions = [
  { value: "name", label: "Athlete A-Z" },
  { value: "bib", label: "Bib number" },
  { value: "club", label: "Club" },
  { value: "country", label: "Country" },
  { value: "race", label: "Race" },
  { value: "category", label: "Category" },
  { value: "registration_status", label: "Registration status" },
] as const;

const resultsSortOptions = [
  { value: "overall", label: "Overall place" },
  { value: "time", label: "Finish time" },
  { value: "name", label: "Athlete A-Z" },
  { value: "club", label: "Club" },
  { value: "country", label: "Country" },
  { value: "race_status", label: "Race status" },
] as const;

const locationTypeLabels: Record<string, string> = {
  parking: "Parking",
  start_zone: "Start Zone",
  finish_zone: "Finish Zone",
  registration: "Registration Desk",
  info_point: "Info Point",
  weather_point: "Weather Point",
  medical_point: "Emergency / Medical",
  toilets: "Toilets",
  showers: "Showers",
  drop_bags: "Drop Bags",
};

const racePointTagLabels: Record<string, string> = {
  checkpoint: "Checkpoint",
  timing_split: "Timing Split",
  water: "Water",
  refreshment: "Food & Water",
  medical: "Medical",
  marshal: "Marshal",
  danger_point: "Danger Point",
  route_split: "Route Split",
  route_merge: "Route Merge",
  start: "Start",
  finish: "Finish",
};

const resultsStatusClasses: Record<string, string> = {
  registered: "bg-muted/50 text-muted-foreground border border-border",
  checked_in: "bg-primary/10 text-primary border border-primary/15",
  started: "bg-trail-amber/10 text-trail-amber border border-trail-amber/15",
  finished: "timing-lime-pill border",
  dnf: "bg-trail-red/10 text-trail-red border border-trail-red/15",
  dns: "bg-muted/50 text-muted-foreground border border-border",
  dsq: "bg-trail-red/10 text-trail-red border border-trail-red/15",
};

const registrationStatusClasses: Record<string, string> = {
  confirmed: "timing-lime-pill border",
  pending: "bg-trail-amber/10 text-trail-amber border border-trail-amber/15",
  waitlisted: "bg-muted/50 text-muted-foreground border border-border",
};

type WeatherVisualVariant =
  | "clearDay"
  | "partlyCloudyDay"
  | "overcastDay"
  | "fogDay"
  | "drizzleDay"
  | "showersDay"
  | "rainDay"
  | "stormDay"
  | "snowDay"
  | "windyDay"
  | "clearNight"
  | "cloudyNight"
  | "rainNight";

const weatherVariantIcons: Record<WeatherVisualVariant, string> = {
  clearDay: weatherClearDayIcon,
  partlyCloudyDay: weatherPartlyCloudyDayIcon,
  overcastDay: weatherCloudyIcon,
  fogDay: weatherFogDayIcon,
  drizzleDay: weatherDrizzleIcon,
  showersDay: weatherOvercastDayRainIcon,
  rainDay: weatherOvercastDayRainIcon,
  stormDay: weatherExtremeDayIcon,
  snowDay: weatherExtremeDaySnowIcon,
  windyDay: weatherWindIcon,
  clearNight: weatherClearNightIcon,
  cloudyNight: weatherPartlyCloudyNightIcon,
  rainNight: weatherOvercastNightRainIcon,
};

function formatRegistrationStatusLabel(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === "confirmed") return "Confirmed";
  if (normalized === "pending") return "Pending";
  if (normalized === "waitlisted") return "Waitlisted";
  return normalized.replace(/_/g, " ");
}

function formatRaceStatusFilterLabel(status: string) {
  if (status === "registered") return "Registered";
  if (status === "checked_in") return "Checked in";
  if (status === "started") return "On route";
  if (status === "finished") return "Finished";
  if (status === "dnf") return "DNF";
  if (status === "dns") return "DNS";
  if (status === "dsq") return "DSQ";
  return status.replace(/_/g, " ");
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function parseBibSortValue(value: string | null | undefined) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return Number.MAX_SAFE_INTEGER;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function parseElapsedTimeToSeconds(value: string | null | undefined) {
  if (!value || value === "TBA" || value === "—") return Number.MAX_SAFE_INTEGER;
  const parts = value.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return Number.MAX_SAFE_INTEGER;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number.MAX_SAFE_INTEGER;
}

function getClubFilterValue(row: PublicEventParticipantRow) {
  const base = row.clubSlug?.trim() || row.club.trim().toLowerCase();
  return base.replace(/[^a-z0-9]+/gi, "-");
}

function buildCountedOptions(values: string[], formatLabel: (value: string) => string) {
  const counts = new Map<string, number>();

  values.forEach((value) => {
    if (!value) return;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });

  return Array.from(counts.entries())
    .sort((left, right) => compareText(formatLabel(left[0]), formatLabel(right[0])))
    .map(([value, count]) => ({
      value,
      label: formatLabel(value),
      count,
    }));
}

function buildGenderFilterOptions(rows: PublicEventParticipantRow[]) {
  return buildCountedOptions(
    rows.map((row) => row.gender),
    (value) => {
      if (value === "F") return "Female";
      if (value === "M") return "Male";
      if (value === "U") return "Unspecified";
      return value;
    },
  );
}

function buildClubFilterOptions(rows: PublicEventParticipantRow[]) {
  const counts = new Map<string, { label: string; count: number }>();

  rows.forEach((row) => {
    const value = getClubFilterValue(row);
    const current = counts.get(value);
    if (current) {
      current.count += 1;
      return;
    }

    counts.set(value, {
      label: row.club,
      count: 1,
    });
  });

  return Array.from(counts.entries())
    .sort((left, right) => compareText(left[1].label, right[1].label))
    .map(([value, record]) => ({
      value,
      label: record.label,
      count: record.count,
    }));
}

function buildRegistrationStatusOptions(rows: PublicEventParticipantRow[]) {
  return buildCountedOptions(
    rows.map((row) => row.registrationStatus),
    formatRegistrationStatusLabel,
  );
}

function buildRaceStatusOptions(rows: PublicEventParticipantRow[]) {
  return buildCountedOptions(
    rows.map((row) => resolvePublicResultStatus(row).key),
    formatRaceStatusFilterLabel,
  );
}

function hasActiveParticipantFilters(filters: ParticipantFilters, defaults: ParticipantFilters) {
  return Object.entries(filters).some(([key, value]) => value !== defaults[key as keyof ParticipantFilters]);
}

function getRaceStatusSortWeight(row: PublicEventParticipantRow) {
  const status = resolvePublicResultStatus(row).key;
  if (status === "finished") return 0;
  if (status === "started") return 1;
  if (status === "checked_in") return 2;
  if (status === "registered") return 3;
  if (status === "dnf") return 4;
  if (status === "dns") return 5;
  if (status === "dsq") return 6;
  return 7;
}

function getOverallSortWeight(row: PublicEventParticipantRow) {
  if (row.overall > 0) return row.overall;
  return 10_000 + getRaceStatusSortWeight(row) * 100 + parseBibSortValue(row.bib);
}

function sortParticipantRows(
  rows: PublicEventParticipantRow[],
  sortBy: string,
  sortDirection: ParticipantFilters["sortDirection"],
) {
  return [...rows].sort((left, right) => {
    let comparison = 0;

    if (sortBy === "bib") {
      const leftBib = parseBibSortValue(left.bib);
      const rightBib = parseBibSortValue(right.bib);
      const leftEmpty = leftBib === Number.MAX_SAFE_INTEGER;
      const rightEmpty = rightBib === Number.MAX_SAFE_INTEGER;
      if (leftEmpty !== rightEmpty) return leftEmpty ? -1 : 1;
      comparison = leftBib - rightBib;
    } else if (sortBy === "club") {
      comparison = compareText(left.club, right.club);
    } else if (sortBy === "country") {
      comparison = compareText(countryName(left.countryCode), countryName(right.countryCode));
    } else if (sortBy === "race") {
      comparison = compareText(left.categoryLabel, right.categoryLabel);
    } else if (sortBy === "category") {
      comparison = compareText(left.classificationLabel, right.classificationLabel);
    } else if (sortBy === "gender") {
      comparison = compareText(left.gender, right.gender);
    } else if (sortBy === "registration_status") {
      const registrationStatusOrder = {
        confirmed: 0,
        pending: 1,
        waitlisted: 2,
      } as const;

      comparison = (registrationStatusOrder[left.registrationStatus as keyof typeof registrationStatusOrder] ?? 99)
        - (registrationStatusOrder[right.registrationStatus as keyof typeof registrationStatusOrder] ?? 99);
    } else if (sortBy === "race_status" || sortBy === "status") {
      comparison = getRaceStatusSortWeight(left) - getRaceStatusSortWeight(right)
        || getOverallSortWeight(left) - getOverallSortWeight(right);
    } else if (sortBy === "overall") {
      comparison = getOverallSortWeight(left) - getOverallSortWeight(right);
    } else if (sortBy === "time") {
      comparison = parseElapsedTimeToSeconds(left.time) - parseElapsedTimeToSeconds(right.time)
        || getOverallSortWeight(left) - getOverallSortWeight(right);
    } else if (sortBy === "division") {
      comparison = compareText(left.classificationLabel, right.classificationLabel)
        || compareText(left.gender, right.gender);
    } else {
      comparison = compareText(left.name, right.name)
        || compareText(left.categoryLabel, right.categoryLabel);
    }

    const directed = sortDirection === "desc" ? -comparison : comparison;
    return directed || compareText(left.name, right.name);
  });
}

function toggleParticipantSort(filters: ParticipantFilters, sortBy: string): ParticipantFilters {
  if (filters.sortBy === sortBy) {
    return { ...filters, sortDirection: filters.sortDirection === "asc" ? "desc" : "asc" };
  }
  return {
    ...filters,
    sortBy,
    sortDirection: sortBy === "bib" ? "desc" : "asc",
  };
}

function applyDerivedOverallPositions(rows: PublicEventParticipantRow[]) {
  const rankedFinishers = [...rows]
    .filter((row) => row.participationStatus === "finished" && parseElapsedTimeToSeconds(row.time) < Number.MAX_SAFE_INTEGER)
    .sort((left, right) => parseElapsedTimeToSeconds(left.time) - parseElapsedTimeToSeconds(right.time));
  const derivedRankByRegistration = new Map(
    rankedFinishers.map((row, index) => [row.registrationId, index + 1]),
  );

  return rows.map((row) => (
    row.overall > 0
      ? row
      : { ...row, overall: derivedRankByRegistration.get(row.registrationId) ?? 0 }
  ));
}

function filterParticipantRows(rows: PublicEventParticipantRow[], filters: ParticipantFilters) {
  const searchValue = filters.search.trim().toLowerCase();

  const filteredRows = rows.filter((row) => {
    if (searchValue) {
      const haystack = [
        row.name,
        row.club,
        row.categoryLabel,
        row.classificationLabel,
        row.bib,
        row.countryCode ?? "",
        countryName(row.countryCode),
      ]
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(searchValue)) return false;
    }

    if (filters.gender !== "all" && row.gender !== filters.gender) return false;
    if (filters.club !== "all" && getClubFilterValue(row) !== filters.club) return false;
    if (filters.registrationStatus !== "all" && row.registrationStatus !== filters.registrationStatus) return false;
    if (filters.raceStatus !== "all" && resolvePublicResultStatus(row).key !== filters.raceStatus) return false;

    return true;
  });

  return sortParticipantRows(filteredRows, filters.sortBy, filters.sortDirection);
}

function resolvePublicResultStatus(row: PublicEventParticipantRow) {
  if (row.participationStatus === "finished" && row.time !== "TBA") {
    return { key: "finished", label: "Finished" };
  }
  if (["dnf", "withdrawn", "stopped", "evacuated", "missing"].includes(row.participationStatus)) {
    return { key: "dnf", label: "DNF" };
  }
  if (
    row.participationStatus === "dns"
    || (
      ["official", "corrected"].includes(row.publicationState ?? "")
      && ["not_started", "checked_in"].includes(row.participationStatus)
    )
  ) {
    return { key: "dns", label: "DNS" };
  }
  if (row.participationStatus === "dsq") {
    return { key: "dsq", label: "DSQ" };
  }
  if (
    ["official", "corrected"].includes(row.publicationState ?? "")
    && row.participationStatus === "started"
    && row.time === "TBA"
  ) {
    return { key: "dnf", label: "DNF" };
  }
  if (row.resultStatus === "void") {
    return { key: "dsq", label: "DSQ" };
  }
  if (row.participationStatus === "checked_in") {
    return { key: "checked_in", label: "Checked in" };
  }
  if (row.participationStatus === "started") {
    return { key: "started", label: "On route" };
  }
  return {
    key: "registered",
    label: formatRegistrationStatusLabel(row.registrationStatus),
  };
}

function hasStartedRace(row: PublicEventParticipantRow) {
  return ["finished", "dnf", "dsq", "started"].includes(resolvePublicResultStatus(row).key);
}

function formatTrackRecordDate(value: string | null | undefined) {
  if (!value) return "Official result";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Official result";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(parsed);
}

function getCategoryFillWidth(category: PortalEventCategory | null | undefined) {
  if (!category || category.maxParticipants <= 0) return 0;
  return Math.min(100, Math.round((category.participants / category.maxParticipants) * 100));
}

function extractFirstNumber(value: string | null | undefined) {
  if (!value) return 0;
  const match = value.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return 0;
  return Number(match[1].replace(",", "."));
}

function parseTimeLabel(value: string | null | undefined) {
  if (!value) return null;
  const [hoursRaw, minutesRaw] = value.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function formatTime(totalMinutes: number) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function getEventCalendarBadgeBits(dateLabel: string, startDateIso: string | null | undefined, localeTag = "en-GB") {
  const parsed = startDateIso ? new Date(startDateIso) : new Date(dateLabel);
  if (Number.isNaN(parsed.getTime())) {
    return {
      month: "TBA",
      day: "--",
    };
  }

  return {
    month: localeTag.startsWith("hr")
      ? new Intl.DateTimeFormat("hr-HR", { month: "short" }).format(parsed).toUpperCase()
      : format(parsed, "MMM").toUpperCase(),
    day: format(parsed, "dd"),
  };
}

function EventHeroCalendarBadge({
  dateLabel,
  startDateIso,
  className,
}: {
  dateLabel: string;
  startDateIso: string | null | undefined;
  className?: string;
}) {
  const { localeTag } = useI18n();
  const { month, day } = getEventCalendarBadgeBits(dateLabel, startDateIso, localeTag);
  const parsed = startDateIso ? new Date(startDateIso) : new Date(dateLabel);
  const year = Number.isNaN(parsed.getTime()) ? null : format(parsed, "yyyy");

  return (
    <time
      dateTime={startDateIso ?? undefined}
      aria-label={localizedEventDateLabel(dateLabel, localeTag)}
      title={localizedEventDateLabel(dateLabel, localeTag)}
      className={cn(
        "flex min-w-[4rem] shrink-0 flex-col items-center overflow-hidden rounded-[14px] border border-white/28 bg-black/48 text-center text-white shadow-[0_16px_34px_-20px_rgba(0,0,0,0.8)] backdrop-blur-md",
        className,
      )}
    >
      <span className="w-full bg-trail-amber px-2 py-1 text-[8px] font-black uppercase tracking-[0.2em] text-[#2b170d]">
        {month}
      </span>
      <span className="px-3 pt-1.5 font-display text-2xl font-black leading-none">{day}</span>
      {year ? <span className="px-2 pb-1.5 pt-0.5 text-[8px] font-semibold text-white/72">{year}</span> : null}
    </time>
  );
}

function formatTimelineTime(value: string, locale: AppLocale = "en") {
  const normalized = value.trim();
  if (!normalized) return value;
  if (/^\d{1,2}:\d{2}$/.test(normalized)) return normalized;

  const dateTimeCandidate = /^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}/.test(normalized)
    ? normalized.replace(" ", "T")
    : normalized;
  const parsed = new Date(dateTimeCandidate);
  if (Number.isNaN(parsed.getTime())) return value;

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return format(parsed, locale === "hr" ? "d. MMM" : "MMM d", { locale: locale === "hr" ? hr : undefined });
  }

  if (/^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}/.test(normalized)) {
    return format(parsed, locale === "hr" ? "d. MMM · HH:mm" : "MMM d · HH:mm", { locale: locale === "hr" ? hr : undefined });
  }

  return format(parsed, "HH:mm");
}

function mapCourseCheckpoints(checkpoints: PortalCheckpoint[], locale: AppLocale = "en") {
  return checkpoints.map((checkpoint, index) => ({
    ...checkpoint,
    name: eventPointName(checkpoint.name, locale),
    type:
      index === 0
        ? ("start" as const)
        : index === checkpoints.length - 1
          ? ("finish" as const)
          : ("checkpoint" as const),
  }));
}

function buildDirectionsHref(lat: number | null | undefined, lng: number | null | undefined) {
  if (lat == null || lng == null) return null;
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

function buildMapsPinHref(lat: number | null | undefined, lng: number | null | undefined) {
  if (lat == null || lng == null) return null;
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function isPlaceholderAbout(value: string | null | undefined) {
  if (!value) return true;
  const normalized = value.toLowerCase();
  if (value.trim().length < 80) return true;
  return normalized.includes("placeholder") || normalized.includes("coming soon") || normalized.includes("lorem ipsum");
}

function buildDerivedSummary(data: EventDetailData, categories: PortalEventCategory[]) {
  const raceCount = categories.length;
  const raceLabel = raceCount === 1 ? "race option" : "race options";
  const distanceLabel = categories.map((category) => category.distance.replace(" km", "")).join(" and ");
  return `${data.name} takes place in ${data.locationLabel} on ${data.dateLabel} with ${raceCount} published ${raceLabel}${distanceLabel ? ` across ${distanceLabel} km formats` : ""}.`;
}

function buildHeroSummary(subtitle: string, aboutText: string, derivedSummary: string) {
  const trimmedSubtitle = subtitle.trim();
  if (trimmedSubtitle) return trimmedSubtitle;

  const trimmedAbout = aboutText.trim();
  if (trimmedAbout && trimmedAbout !== derivedSummary) {
    const firstSentence = trimmedAbout.match(/^(.+?[.!?])(?:\s|$)/)?.[1]?.trim();
    return firstSentence && firstSentence.length <= 220 ? firstSentence : trimmedAbout.slice(0, 220).trim();
  }

  return derivedSummary;
}

function buildOverviewPreviewText(aboutText: string, heroSummary: string) {
  const trimmedAbout = aboutText.trim();
  if (!trimmedAbout) return heroSummary;

  const sentences = trimmedAbout
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length <= 4) return trimmedAbout;

  const preview = sentences.slice(0, 4).join(" ").trim();
  return preview.length >= 220 ? preview : `${preview} ${heroSummary}`.trim();
}

function buildRaceDaySchedule(data: EventDetailData, categories: PortalEventCategory[], locale: AppLocale): ScheduleItem[] {
  if (data.timeline.length) {
    return data.timeline.map((item) => {
      const normalized = item.description.toLowerCase();
      const tone =
        normalized.includes("start")
          ? "primary"
          : normalized.includes("award") || normalized.includes("brief")
            ? "accent"
            : "neutral";

      return {
        time: formatTimelineTime(item.time, locale),
        label: item.description,
        tone,
      };
    });
  }

  const starts = categories
    .filter((category) => Boolean(category.startLabel))
    .map((category) => ({
      category,
      timeMinutes: parseTimeLabel(category.startLabel),
    }))
    .filter((entry): entry is { category: PortalEventCategory; timeMinutes: number } => entry.timeMinutes != null)
    .sort((left, right) => left.timeMinutes - right.timeMinutes);

  return starts.map(({ category, timeMinutes }) => ({
    time: formatTime(timeMinutes),
    label: `Start — ${category.name}`,
    tone: "primary",
  }));
}

function buildCategoryTimeline(data: EventDetailData, category: PortalEventCategory | null, locale: AppLocale): ScheduleItem[] {
  if (!category) return [];

  const categoryStart = category.startLabel?.trim() || "TBA";
  const publishedTimeline = data.timeline
    .map((item) => {
      const label = item.description.trim();
      const normalized = label.toLowerCase();
      const mentionsCategory = compareText(label, category.name) === 0 || normalized.includes(category.name.toLowerCase());
      const isStart = normalized.includes("start");
      const isGeneral =
        normalized.includes("office")
        || normalized.includes("brief")
        || normalized.includes("finish")
        || normalized.includes("award")
        || normalized.includes("podium");

      if (!mentionsCategory && !isGeneral && !isStart) return null;

      return {
        time: formatTimelineTime(item.time, locale),
        label: mentionsCategory || (isStart && !normalized.includes("main category"))
          ? label
          : isStart
            ? `Start — ${category.name}`
            : label,
        tone: isStart ? "primary" : normalized.includes("award") || normalized.includes("brief") ? "accent" : "neutral",
      } satisfies ScheduleItem;
    })
    .filter((item): item is ScheduleItem => Boolean(item));

  if (publishedTimeline.length) {
    const seen = new Set<string>();
    return publishedTimeline.filter((item) => {
      const key = `${item.time}-${item.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 6);
  }

  const parsedStart = parseTimeLabel(category.startLabel);
  if (parsedStart == null) {
    return [{ time: "TBA", label: "Start time not published.", tone: "neutral" }];
  }

  return [
    { time: formatTime(parsedStart - 90), label: "Race office opens for bib pickup", tone: "neutral" },
    { time: formatTime(parsedStart - 45), label: "Drop bag and support handoff deadline", tone: "neutral" },
    { time: formatTime(parsedStart - 20), label: `Briefing — ${category.name}`, tone: "accent" },
    { time: categoryStart, label: `Start — ${category.name}`, tone: "primary" },
    { time: formatTime(parsedStart + 300), label: "Expected first finishers", tone: "neutral" },
    { time: formatTime(parsedStart + 660), label: "Awards and podium", tone: "accent" },
  ];
}

function locationTypeLabel(type: string) {
  return locationTypeLabels[type] ?? type.replace(/_/g, " ");
}

function formatRacePointTag(tag: string, locale: AppLocale = "en") {
  if (tag === "split") return translate(locale, "event.detail.pointSplit");
  if (tag === "refreshment") return translate(locale, "event.detail.pointRefreshment");
  return racePointTagLabels[tag] ?? tag.replace(/_/g, " ");
}

function publicRacePointTags(checkpoint: PortalRaceCheckpoint) {
  return checkpoint.typeTags.length ? checkpoint.typeTags : [checkpoint.type];
}

function publicRacePointCounts(checkpoints: PortalRaceCheckpoint[]) {
  return {
    controlPoints: checkpoints.filter((checkpoint) => publicRacePointTags(checkpoint).includes("checkpoint")).length,
    waterPoints: checkpoints.filter((checkpoint) => publicRacePointTags(checkpoint).includes("water")).length,
    foodAndWaterPoints: checkpoints.filter((checkpoint) => publicRacePointTags(checkpoint).includes("refreshment")).length,
  };
}

function formatRaceCheckpointMeta(checkpoint: PortalRaceCheckpoint, locale: AppLocale = "en") {
  const parts = [];
  if (checkpoint.km != null) parts.push(`km ${checkpoint.km.toLocaleString(locale === "hr" ? "hr-HR" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  if (checkpoint.cutoffLabel) {
    const parsed = new Date(checkpoint.cutoffLabel);
    parts.push(Number.isNaN(parsed.getTime()) ? checkpoint.cutoffLabel : translate(locale, "event.detail.pointCutoff", { time: format(parsed, "HH:mm") }));
  }
  if (isPublicRacePointRequired(checkpoint)) parts.push(translate(locale, "event.detail.requiredCoursePoint"));
  return parts.join(" · ");
}

function getEventStartIso(data: EventDetailData | undefined, categories: PortalEventCategory[]) {
  const categoryStarts = categories
    .map((category) => category.startAtIso)
    .filter((value): value is string => Boolean(value))
    .sort();

  if (categoryStarts.length) return categoryStarts[0];
  if (data?.startDateIso) return `${data.startDateIso}T00:00:00`;
  return null;
}

function deriveEventLifecycle(
  eventStartIso: string | null,
  hasPublishedResults: boolean,
  hasOfficialRows: boolean,
  eventStatus: string,
): EventLifecycle {
  if (isEventFinishedStatus(eventStatus)) return "after";
  if (["live", "in_progress", "in progress"].includes(eventStatus.trim().toLowerCase())) return "during";

  if (!eventStartIso) {
    return hasPublishedResults ? "after" : "before";
  }

  const eventStart = new Date(eventStartIso);
  if (Number.isNaN(eventStart.getTime())) {
    return hasPublishedResults ? "after" : "before";
  }

  const now = new Date();
  if (now < eventStart) return "before";
  if (hasPublishedResults || hasOfficialRows) return "after";
  return "during";
}

function pickPrimaryWeatherTarget(
  locations: PortalEventLocation[],
  routeCheckpoints: PortalCheckpoint[],
) {
  const preferredTypes = ["weather_point", "start_zone", "registration", "parking", "finish_zone", "info_point"];
  for (const type of preferredTypes) {
    const location = locations.find((item) => item.type === type && item.lat != null && item.lng != null);
    if (location?.lat != null && location.lng != null) {
      return {
        id: location.id,
        label: location.place ?? location.label,
        lat: location.lat,
        lng: location.lng,
      };
    }
  }

  const routeStart = routeCheckpoints[0];
  if (routeStart) {
    return {
      id: "route-start",
      label: routeStart.name,
      lat: routeStart.lat,
      lng: routeStart.lng,
    };
  }

  return null;
}

function buildLogisticsMapLocations(
  locations: PortalEventLocation[],
  dateLabel: string,
  distanceSummary: string,
): EventLocation[] {
  return locations
    .filter((location) => location.lat != null && location.lng != null)
    .map((location) => ({
      id: location.id,
      title: location.label,
      location: location.place ?? "Race logistics",
      lat: location.lat!,
      lng: location.lng!,
      status: "open",
      date: dateLabel,
      distance: location.description ?? distanceSummary,
      badgeLabel: locationTypeLabel(location.type),
    }));
}

function buildSelectedRaceFacts(category: PortalEventCategory | null, routeDistance: number | null, routeElevation: number | null) {
  if (!category) return [];

  const routeDistanceLabel = routeDistance != null ? `${formatEventDistanceKm(routeDistance)} km` : category.distance;
  const routeElevationLabel = routeElevation != null ? `${Math.round(routeElevation)} m D+` : category.elevation;

  return [
    { label: "Distance", value: routeDistanceLabel },
    { label: "Elevation", value: routeElevationLabel },
    { label: "Start", value: category.startLabel ?? "TBA" },
    { label: "Fee", value: category.price },
    { label: "Capacity", value: `${category.participants}/${category.maxParticipants}` },
    { label: "Fill", value: `${getCategoryFillWidth(category)}%` },
  ];
}

function buildRegistrationTermsModule(
  category: PortalEventCategory | null,
  eventLifecycle: EventLifecycle,
  documentsCount: number,
): InfoModuleItem[] {
  if (!category) return [];

  return [
    { label: "Registration status", value: eventLifecycle === "before" ? "Open for entries." : "Registration closed." },
    { label: "Entry fee", value: category.price || "Not published." },
    { label: "Field size", value: `${category.participants}/${category.maxParticipants} runners.` },
    { label: "Race start", value: category.startLabel || "Not published." },
    { label: "Cut-off", value: category.cutoff || "Not published." },
    { label: "Official docs", value: documentsCount ? `${documentsCount} published document${documentsCount === 1 ? "" : "s"}.` : "None published." },
  ];
}

function buildRunnerInfoModule(
  category: PortalEventCategory | null,
  selectedTrack: TrackDetailData | undefined,
  raceCheckpoints: PortalRaceCheckpoint[],
  logisticsLocationCount: number,
): InfoModuleItem[] {
  if (!category) return [];
  const racePointCounts = publicRacePointCounts(raceCheckpoints);

  return [
    { label: "Route guide", value: selectedTrack ? `${selectedTrack.name}: map, elevation, and terrain.` : "Not published." },
    { label: "Route support", value: `${racePointCounts.controlPoints} control · ${racePointCounts.waterPoints} water · ${racePointCounts.foodAndWaterPoints} food & water.` },
    { label: "Terrain", value: selectedTrack ? `${selectedTrack.surface} · ${selectedTrack.waterPoints} water point${selectedTrack.waterPoints === 1 ? "" : "s"}.` : "Not published." },
    { label: "GPX", value: selectedTrack?.gpxDownloadUrl ? "Available." : "Not published." },
    { label: "Race locations", value: logisticsLocationCount ? `${logisticsLocationCount} published point${logisticsLocationCount === 1 ? "" : "s"}.` : "None published." },
  ];
}

function buildTravelLogisticsModule(
  data: EventDetailData,
  locations: PortalEventLocation[],
  parkingLocation: PortalEventLocation | undefined,
): InfoModuleItem[] {
  const registrationLocation = locations.find((location) => location.type === "registration");
  const startLocation = locations.find((location) => location.type === "start_zone");
  const finishLocation = locations.find((location) => location.type === "finish_zone");

  return [
    { label: "Arrival area", value: data.locationLabel },
    { label: "Parking", value: parkingLocation ? `${parkingLocation.label}${parkingLocation.place ? `, ${parkingLocation.place}` : ""}.` : "Parking details are not published yet." },
    { label: "Bib pickup", value: registrationLocation ? `${registrationLocation.label}${registrationLocation.place ? `, ${registrationLocation.place}` : ""}.` : "Bib pickup location has not been published yet." },
    { label: "Start access", value: startLocation ? `${startLocation.label}${startLocation.place ? `, ${startLocation.place}` : ""}.` : "Not published." },
    { label: "Finish zone", value: finishLocation ? `${finishLocation.label}${finishLocation.place ? `, ${finishLocation.place}` : ""}.` : "Finish-zone details are not published yet." },
    { label: "Travel planning", value: data.websiteUrl ? "Organizer website available." : "No travel guide published." },
  ];
}

function buildRulesSafetyModule(
  selectedTrack: TrackDetailData | undefined,
  raceCheckpoints: PortalRaceCheckpoint[],
  documentsCount: number,
  locale: AppLocale,
): InfoModuleItem[] {
  const copy = eventRulesSafetyValues({ warnings: selectedTrack?.warnings, checkpoints: raceCheckpoints, documentsCount }, locale);
  return [
    { label: "Runner responsibility", value: copy.responsibility },
    { label: "Marked route", value: copy.markedCourse },
    { label: "Checkpoints & cut-offs", value: copy.checkpoints },
    { label: "Weather & terrain", value: copy.weather, isAuthorContent: copy.hasAuthorWarning },
    { label: "Organizer note", value: copy.organizerNote },
    { label: "Official regulations", value: copy.regulations },
  ];
}

function formatPublishedAt(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return format(parsed, "MMM d, yyyy HH:mm");
}

function resolveEventWeatherVisualVariant(
  snapshot: LiveWeatherSnapshot | null | undefined,
  isToday: boolean,
): WeatherVisualVariant {
  if (!snapshot) return isToday ? "partlyCloudyDay" : "overcastDay";

  const currentHour = new Date().getHours();
  const isNight = currentHour < 6 || currentHour >= 20;
  const wind = snapshot.windKph ?? 0;
  const precipChance = snapshot.precipitationProbability ?? Math.min(100, Math.round((snapshot.precipitationMm ?? 0) * 28));
  const label = (snapshot.conditionLabel ?? "").toLowerCase();

  if (label.includes("snow")) return "snowDay";
  if (label.includes("storm") || label.includes("thunder")) return "stormDay";
  if (wind >= 30 || label.includes("wind")) return "windyDay";
  if (label.includes("fog")) return "fogDay";
  if (label.includes("drizzle")) return "drizzleDay";
  if (precipChance >= 60 || label.includes("rain") || label.includes("shower")) {
    return isNight ? "rainNight" : precipChance >= 80 ? "rainDay" : "showersDay";
  }
  if (label.includes("sun") || label.includes("clear")) return isNight ? "clearNight" : "clearDay";
  if (label.includes("partly")) return isNight ? "cloudyNight" : "partlyCloudyDay";
  if (label.includes("cloud")) return isNight ? "cloudyNight" : "overcastDay";
  return isNight ? "cloudyNight" : "partlyCloudyDay";
}

function getEventWeatherCardVisuals(variant: WeatherVisualVariant) {
  if (variant === "clearDay") {
    return {
      shellClassName: "text-sky-950",
      badgeClassName: "border-white/70 bg-white/55 text-sky-900",
      accentBarClassName: "bg-sky-400/70",
      orbClassName: "bg-amber-200/45",
      iconClassName: "text-sky-700",
      textClassName: "text-sky-900/90",
    };
  }
  if (variant === "partlyCloudyDay" || variant === "overcastDay" || variant === "windyDay") {
    return {
      shellClassName: "text-slate-900",
      badgeClassName: "border-white/70 bg-white/55 text-slate-800",
      accentBarClassName: "bg-sky-500/45",
      orbClassName: "bg-sky-100/45",
      iconClassName: "text-slate-700",
      textClassName: "text-slate-800/90",
    };
  }
  if (variant === "fogDay" || variant === "snowDay") {
    return {
      shellClassName: "text-slate-900",
      badgeClassName: "border-white/70 bg-white/60 text-slate-700",
      accentBarClassName: "bg-slate-300/70",
      orbClassName: "bg-white/55",
      iconClassName: "text-slate-600",
      textClassName: "text-slate-700/90",
    };
  }
  if (variant === "drizzleDay" || variant === "showersDay" || variant === "rainDay" || variant === "rainNight" || variant === "stormDay") {
    return {
      shellClassName: "text-slate-950",
      badgeClassName: "border-white/65 bg-white/45 text-slate-900",
      accentBarClassName: "bg-blue-500/55",
      orbClassName: "bg-blue-200/35",
      iconClassName: "text-blue-800",
      textClassName: "text-slate-900/90",
    };
  }
  return {
    shellClassName: "text-slate-950",
    badgeClassName: "border-white/65 bg-white/45 text-slate-900",
    accentBarClassName: "bg-indigo-400/45",
    orbClassName: "bg-indigo-200/30",
    iconClassName: "text-slate-900",
    textClassName: "text-slate-900/90",
  };
}

function getEventWeatherBackdropStyle(
  snapshot: LiveWeatherSnapshot | null | undefined,
  variant: WeatherVisualVariant,
) {
  const temp = snapshot?.temp ?? 16;
  const moisture = Math.min(1, ((snapshot?.precipitationProbability ?? 0) / 100));
  const warmth = Math.max(0, Math.min(1, (temp - 2) / 28));

  if (variant === "clearDay") {
    return {
      backgroundImage: `radial-gradient(circle at 82% 18%, rgba(255,222,122,0.42) 0%, transparent 22%), linear-gradient(180deg, rgba(157,219,255,0.92) 0%, rgba(221,241,255,0.92) 58%, rgba(246,250,255,0.98) 100%)`,
    };
  }
  if (variant === "partlyCloudyDay" || variant === "overcastDay" || variant === "windyDay") {
    return {
      backgroundImage: `radial-gradient(circle at 74% 18%, rgba(255,255,255,0.34) 0%, transparent 24%), linear-gradient(180deg, rgba(${190 - Math.round(moisture * 30)},219,241,0.94) 0%, rgba(229,237,244,0.96) 58%, rgba(247,249,251,0.98) 100%)`,
    };
  }
  if (variant === "fogDay" || variant === "snowDay") {
    return {
      backgroundImage: "radial-gradient(circle at 50% 18%, rgba(255,255,255,0.28) 0%, transparent 38%), linear-gradient(180deg, rgba(224,232,238,0.95) 0%, rgba(242,246,249,0.98) 58%, rgba(250,252,253,1) 100%)",
    };
  }
  if (variant === "drizzleDay" || variant === "showersDay" || variant === "rainDay" || variant === "rainNight" || variant === "stormDay") {
    return {
      backgroundImage: "linear-gradient(180deg, rgba(157,178,205,0.95) 0%, rgba(205,218,230,0.96) 52%, rgba(240,245,250,0.99) 100%)",
    };
  }

  const topBlue = 178 - Math.round(warmth * 25);
  return {
    backgroundImage: `linear-gradient(180deg, rgba(${topBlue},188,220,0.92) 0%, rgba(216,223,238,0.95) 56%, rgba(243,246,252,0.99) 100%)`,
  };
}

function getEventCompactWeatherNote(
  snapshot: LiveWeatherSnapshot | null | undefined,
  variant: WeatherVisualVariant,
) {
  if (!snapshot) return "Loading race weather";

  const precipitationChance = snapshot.precipitationProbability ?? Math.min(100, Math.round((snapshot.precipitationMm ?? 0) * 28));
  if (variant === "stormDay") return "Storm energy building";
  if (variant === "snowDay") return "Colder race window";
  if (variant === "fogDay") return "Reduced visibility";
  if (variant === "drizzleDay" || variant === "showersDay" || variant === "rainDay" || variant === "rainNight") {
    return precipitationChance >= 45 ? "Wet race window" : "Possible passing showers";
  }
  if (variant === "windyDay" || (snapshot.windKph ?? 0) >= 30) return "Exposed areas breezy";
  if ((snapshot.temp ?? 0) >= 26) return "Warm race conditions";
  if ((snapshot.temp ?? 0) <= 7) return "Cool start expected";
  return "Stable race conditions";
}

function isEventWeatherUnavailable(snapshot: LiveWeatherSnapshot | null | undefined) {
  if (!snapshot) return true;
  if ((snapshot.conditionLabel ?? "").toLowerCase() === "unavailable") return true;
  const hasTemperature = snapshot.temp != null && Number.isFinite(snapshot.temp);
  const hasWind = snapshot.windKph != null && Number.isFinite(snapshot.windKph);
  const hasPrecip = snapshot.precipitationMm != null || snapshot.precipitationProbability != null;
  return !hasTemperature && !hasWind && !hasPrecip;
}

function formatEventWeatherTimeLabel(observationTime: string | null | undefined) {
  if (!observationTime) return null;
  const parsed = new Date(observationTime);
  if (Number.isNaN(parsed.getTime())) return null;
  return format(parsed, "HH:mm");
}

function formatEventWeatherDateInput(date: Date) {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatEventWeatherDateLabel(dateValue: string) {
  const parsed = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateValue;

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "numeric",
  }).format(parsed);
}

function addEventWeatherDays(baseDate: Date, days: number) {
  const nextDate = new Date(baseDate);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function buildEventUpcomingWeatherDates(baseDate: Date, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const value = addEventWeatherDays(baseDate, index + 1);
    return {
      date: formatEventWeatherDateInput(value),
      shortLabel: new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(value),
    };
  });
}

function getEventWeatherTemperatureProgress(
  value: number | null | undefined,
  min: number | null,
  max: number | null,
) {
  if (value == null || min == null || max == null || max <= min) return "40%";
  const clamped = Math.max(min, Math.min(max, value));
  const ratio = (clamped - min) / (max - min);
  return `${Math.max(14, Math.min(100, 14 + ratio * 86))}%`;
}

function buildMockEventWeatherSnapshot(
  targetLabel: string | null | undefined,
  eventStartIso: string | null,
): LiveWeatherSnapshot {
  const referenceDate = eventStartIso ? new Date(eventStartIso) : new Date();
  const month = Number.isNaN(referenceDate.getTime()) ? new Date().getMonth() : referenceDate.getMonth();
  const seedSource = `${targetLabel ?? "event-start"}-${eventStartIso ?? "default"}`;
  const seed = Array.from(seedSource).reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const variant = seed % 3;

  if (month === 11 || month <= 1) {
    const winterPresets = [
      { temp: 3, humidity: 82, windKph: 19, precipitationProbability: 45, precipitationMm: 1.2, condition: "cloudy" as const, conditionLabel: "Cold and cloudy" },
      { temp: 5, humidity: 76, windKph: 14, precipitationProbability: 25, precipitationMm: 0.4, condition: "sunny" as const, conditionLabel: "Cold with brighter spells" },
      { temp: 2, humidity: 88, windKph: 23, precipitationProbability: 58, precipitationMm: 1.8, condition: "rain" as const, conditionLabel: "Cold with passing showers" },
    ];
    const selected = winterPresets[variant];
    return {
      locationId: "weather-preview",
      stationCount: 3,
      temp: selected.temp,
      humidity: selected.humidity,
      windKph: selected.windKph,
      precipitationMm: selected.precipitationMm,
      precipitationProbability: selected.precipitationProbability,
      condition: selected.condition,
      conditionLabel: selected.conditionLabel,
      observationTime: null,
      stations: [],
      errorMessage: "Preview weather mockup",
    };
  }

  if (month >= 2 && month <= 4) {
    const springPresets = [
      { temp: 14, humidity: 62, windKph: 12, precipitationProbability: 18, precipitationMm: 0.1, condition: "sunny" as const, conditionLabel: "Mild and mostly clear" },
      { temp: 12, humidity: 68, windKph: 16, precipitationProbability: 32, precipitationMm: 0.6, condition: "cloudy" as const, conditionLabel: "Cool with broken cloud" },
      { temp: 11, humidity: 74, windKph: 18, precipitationProbability: 44, precipitationMm: 1.1, condition: "rain" as const, conditionLabel: "Changeable spring showers" },
    ];
    const selected = springPresets[variant];
    return {
      locationId: "weather-preview",
      stationCount: 4,
      temp: selected.temp,
      humidity: selected.humidity,
      windKph: selected.windKph,
      precipitationMm: selected.precipitationMm,
      precipitationProbability: selected.precipitationProbability,
      condition: selected.condition,
      conditionLabel: selected.conditionLabel,
      observationTime: null,
      stations: [],
      errorMessage: "Preview weather mockup",
    };
  }

  if (month >= 5 && month <= 7) {
    const summerPresets = [
      { temp: 24, humidity: 48, windKph: 11, precipitationProbability: 8, precipitationMm: 0, condition: "sunny" as const, conditionLabel: "Warm and clear" },
      { temp: 22, humidity: 55, windKph: 14, precipitationProbability: 16, precipitationMm: 0.1, condition: "cloudy" as const, conditionLabel: "Warm with scattered cloud" },
      { temp: 21, humidity: 61, windKph: 20, precipitationProbability: 28, precipitationMm: 0.5, condition: "wind" as const, conditionLabel: "Warm and breezy" },
    ];
    const selected = summerPresets[variant];
    return {
      locationId: "weather-preview",
      stationCount: 5,
      temp: selected.temp,
      humidity: selected.humidity,
      windKph: selected.windKph,
      precipitationMm: selected.precipitationMm,
      precipitationProbability: selected.precipitationProbability,
      condition: selected.condition,
      conditionLabel: selected.conditionLabel,
      observationTime: null,
      stations: [],
      errorMessage: "Preview weather mockup",
    };
  }

  const autumnPresets = [
    { temp: 13, humidity: 72, windKph: 13, precipitationProbability: 24, precipitationMm: 0.3, condition: "sunny" as const, conditionLabel: "Cool and settled" },
    { temp: 11, humidity: 78, windKph: 15, precipitationProbability: 36, precipitationMm: 0.8, condition: "cloudy" as const, conditionLabel: "Cool with low cloud" },
    { temp: 10, humidity: 84, windKph: 18, precipitationProbability: 52, precipitationMm: 1.4, condition: "rain" as const, conditionLabel: "Cool with rain risk" },
  ];
  const selected = autumnPresets[variant];
  return {
    locationId: "weather-preview",
    stationCount: 4,
    temp: selected.temp,
    humidity: selected.humidity,
    windKph: selected.windKph,
    precipitationMm: selected.precipitationMm,
    precipitationProbability: selected.precipitationProbability,
    condition: selected.condition,
    conditionLabel: selected.conditionLabel,
    observationTime: null,
    stations: [],
    errorMessage: "Preview weather mockup",
  };
}

function getYouTubeEmbedUrl(url: string) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "");
    const videoId = hostname === "youtu.be"
      ? parsed.pathname.split("/").filter(Boolean)[0]
      : hostname.endsWith("youtube.com")
        ? parsed.searchParams.get("v") ?? parsed.pathname.split("/").filter(Boolean).pop()
        : null;
    return videoId ? `https://www.youtube-nocookie.com/embed/${videoId}` : null;
  } catch {
    return null;
  }
}

function EventDetailLoadingState() {
  return (
    <div className="pb-16">
      <div className="border-b border-border/40 bg-card/40">
        <div className="container mx-auto px-4 py-8 md:py-10">
          <Skeleton className="h-9 w-52 rounded-full" />
          <div className="mt-8 max-w-5xl space-y-4">
            <Skeleton className="h-20 w-full max-w-4xl rounded-3xl md:h-28" />
            <Skeleton className="h-6 w-full max-w-2xl rounded-full" />
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={`event-hero-pill-${index}`} className="h-8 w-24 rounded-full" />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 pt-10">
        <Skeleton className="h-12 w-full rounded-2xl" />
        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.9fr)]">
          <div className="space-y-6">
            <Skeleton className="h-[220px] rounded-[28px]" />
            <Skeleton className="h-[320px] rounded-[28px]" />
          </div>
          <div className="space-y-6">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={`event-side-skeleton-${index}`} className="h-[180px] rounded-[28px]" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function RaceFocusSelector({
  title,
  description,
  categories,
  selectedValue,
  onSelect,
  allowAll = false,
  allLabel = "All races",
  visual = false,
  imageBySlug,
  summaryPills = [],
}: {
  title: string;
  description: string;
  categories: PortalEventCategory[];
  selectedValue: string;
  onSelect: (value: string) => void;
  allowAll?: boolean;
  allLabel?: string;
  visual?: boolean;
  imageBySlug?: ReadonlyMap<string, string>;
  summaryPills?: Array<{ label: string; value: string }>;
}) {
  const { t, localeTag } = useI18n();
  if (!categories.length) return null;

  const options = allowAll
    ? [{ value: ALL_RACES_VALUE, label: allLabel }, ...categories.map((category) => ({ value: category.slug, label: category.name }))]
    : categories.map((category) => ({ value: category.slug, label: category.name }));

  if (visual) {
    return (
      <div className="overflow-hidden rounded-[28px] border border-border/80 bg-card shadow-[0_18px_55px_-34px_hsl(25_30%_12%_/_0.38)]" title={description}>
        <div className="hidden flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-4 lg:flex">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">{title}</div>
            <div className="mt-1 text-sm font-semibold text-foreground">Choose the race you want to explore</div>
          </div>
          <span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
            {t("event.detail.racesCount", { count: categories.length })}
          </span>
        </div>

        <label className="block p-3 lg:hidden">
          <span className="mb-2 block text-xs font-semibold text-muted-foreground">{t("event.detail.chooseCategory")}</span>
          <span className="relative block">
            <select
              aria-label={t("event.detail.chooseCategory")}
              value={selectedValue}
              onChange={(event) => {
                const option = options.find((item) => item.value === event.currentTarget.value);
                if (option) onSelect(option.value);
              }}
              className="min-h-11 w-full min-w-0 appearance-none rounded-xl border border-border bg-background py-2 pl-3 pr-10 text-base font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {options.map((option) => {
                const category = categories.find((item) => item.slug === option.value);
                return <option key={option.value} value={option.value}>{category ? `${localizedEventDistanceLabel(category.distance, localeTag)} · ${option.label}` : option.label}</option>;
              })}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          </span>
        </label>

        <div className="hidden gap-3 p-3 lg:grid lg:grid-cols-2">
          {options.map((option) => {
            const category = categories.find((item) => item.slug === option.value);
            const isActive = option.value === selectedValue;
            const imageUrl = category ? imageBySlug?.get(category.slug) : null;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onSelect(option.value)}
                aria-pressed={isActive}
                className={cn(
                  "group relative min-h-[150px] overflow-hidden rounded-[22px] border text-left outline-none transition duration-300 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                  isActive
                    ? "border-primary shadow-[0_14px_35px_-22px_hsl(var(--primary))]"
                    : "border-border/80 hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-lg",
                )}
              >
                {imageUrl ? (
                  <EventContentImage
                    src={imageUrl}
                    alt=""
                    sizes="(min-width: 768px) 50vw, 100vw"
                    className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.035]"
                  />
                ) : (
                  <span className="absolute inset-0 route-pattern bg-secondary" />
                )}
                <span className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-black/5" />
                <span className="relative flex min-h-[150px] flex-col justify-end p-4 text-white">
                  <span className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0 break-words font-display text-lg font-bold leading-tight">{option.label}</span>
                    <span data-locale-fit="stable-pill" className={cn(
                      "mt-0.5 shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.16em] backdrop-blur-md",
                      isActive ? "border-white/40 bg-primary text-primary-foreground" : "border-white/25 bg-black/25 text-white",
                    )}>
                      {isActive ? "Selected" : t("event.detail.viewRace")}
                    </span>
                  </span>
                  {category ? (
                    <span className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-white/90">
                      <span className="rounded-full border border-white/20 bg-black/25 px-2.5 py-1 backdrop-blur-sm">{localizedEventDistanceLabel(category.distance, localeTag)}</span>
                      <span className="rounded-full border border-white/20 bg-black/25 px-2.5 py-1 backdrop-blur-sm">{category.elevation}</span>
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>

        {summaryPills.length ? (
          <div className="flex flex-wrap gap-2 border-t border-border/70 bg-background/55 px-4 py-3">
            {summaryPills.map((item) => (
              <span key={item.label} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] shadow-sm">
                <span className="font-semibold text-muted-foreground">{item.label}</span>
                <span className="font-display font-bold text-foreground">{item.value}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-soft" title={description}>
      <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{title}</span>
      <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary">
        {t("event.detail.racesCount", { count: categories.length })}
      </span>

      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isActive = option.value === selectedValue;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onSelect(option.value)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RosterFilterPanel({
  title,
  description,
  filters,
  defaultFilters,
  genderOptions,
  clubOptions,
  registrationStatusOptions,
  raceStatusOptions,
  sortOptions,
  filteredCount,
  totalCount,
  searchPlaceholder,
  onFiltersChange,
  onReset,
}: RosterFilterPanelProps) {
  const hasActiveFilters = hasActiveParticipantFilters(filters, defaultFilters);
  const selectClassName =
    "h-9 rounded-full border border-border bg-background px-3 text-xs font-semibold text-foreground outline-none transition-colors hover:border-primary/30 focus:border-primary focus:ring-2 focus:ring-primary/20";

  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-soft" title={description}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{title}</span>
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary">
          {filteredCount}/{totalCount}
        </span>

        <label className="min-w-[13rem] flex-1 sm:max-w-[19rem]">
          <span className="sr-only">Search</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={filters.search}
              onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
              placeholder={searchPlaceholder}
              className="h-9 w-full rounded-full border border-border bg-background pl-9 pr-3 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </label>

        <label>
          <span className="sr-only">Gender</span>
          <select
            value={filters.gender}
            onChange={(event) => onFiltersChange({ ...filters, gender: event.target.value })}
            className={selectClassName}
          >
            <option value="all">All genders</option>
            {genderOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} ({option.count})
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="sr-only">Club</span>
          <select
            value={filters.club}
            onChange={(event) => onFiltersChange({ ...filters, club: event.target.value })}
            className={selectClassName}
          >
            <option value="all">All clubs</option>
            {clubOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} ({option.count})
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="sr-only">Registration</span>
          <select
            value={filters.registrationStatus}
            onChange={(event) => onFiltersChange({ ...filters, registrationStatus: event.target.value })}
            className={selectClassName}
          >
            <option value="all">All registration states</option>
            {registrationStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} ({option.count})
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="sr-only">Race status</span>
          <select
            value={filters.raceStatus}
            onChange={(event) => onFiltersChange({ ...filters, raceStatus: event.target.value })}
            className={selectClassName}
          >
            <option value="all">All race states</option>
            {raceStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} ({option.count})
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="sr-only">Sort</span>
          <select
            value={filters.sortBy}
            onChange={(event) => onFiltersChange({ ...filters, sortBy: event.target.value })}
            className={selectClassName}
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {hasActiveFilters ? (
          <button
            type="button"
            onClick={onReset}
            className="h-9 rounded-full border border-border bg-background px-3 text-[11px] font-semibold text-foreground transition-colors hover:border-primary/30 hover:text-primary"
          >
            Reset
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SortableTableHeading({
  label,
  sortKey,
  activeSort,
  direction,
  className,
  onSort,
}: {
  label: string;
  sortKey: string;
  activeSort: string;
  direction: ParticipantFilters["sortDirection"];
  className?: string;
  onSort: (sortKey: string) => void;
}) {
  const isActive = activeSort === sortKey;
  const Icon = isActive ? (direction === "asc" ? ChevronUp : ChevronDown) : ArrowUpDown;

  return (
    <th className={cn("px-3 py-2.5", className)}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn("inline-flex items-center gap-1.5 transition-colors hover:text-primary", isActive && "text-primary")}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <Icon className="h-3 w-3" />
      </button>
    </th>
  );
}

function PublicRegistrationsTable({
  rows,
  sortBy,
  sortDirection,
  onSort,
}: {
  rows: PublicEventParticipantRow[];
  sortBy: string;
  sortDirection: ParticipantFilters["sortDirection"];
  onSort: (sortKey: string) => void;
}) {
  const { t } = useI18n();
  if (!rows.length) {
    return (
      <EmptyState
        title="No public registrations yet."
        description={t("event.detail.registrationListEmpty")}
      />
    );
  }

  return (
    <>
    <div className="space-y-2 md:hidden" aria-label="Public registrations">
      {rows.map((row, index) => {
        const raceStatus = resolvePublicResultStatus(row);
        return (
          <Link
            key={`mobile-${row.registrationId}-${index}`}
            to={`/athletes/${row.athleteSlug}`}
            className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-soft active:bg-primary/[0.04]"
          >
            <div className="rounded-xl bg-secondary px-2 py-2 text-center">
              <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Bib</div>
              <div className="mt-0.5 font-mono text-sm font-bold text-foreground">{row.bib}</div>
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5">
                <CountryFlag countryCode={row.countryCode} className="text-sm" />
                <span className="truncate text-sm font-semibold text-foreground">{row.name}</span>
              </div>
              <div className="mt-1 truncate text-xs text-muted-foreground">{normalizePublicResultClubName(row.club)}</div>
              <div className="mt-1.5 flex min-w-0 gap-1 overflow-hidden">
                <span className="truncate rounded-full bg-secondary px-2 py-0.5 text-[9px] font-bold text-secondary-foreground">{row.categoryLabel}</span>
                <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-bold text-primary">{row.classificationLabel}</span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${registrationStatusClasses[row.registrationStatus] ?? registrationStatusClasses.pending}`}>
                {formatRegistrationStatusLabel(row.registrationStatus)}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${resultsStatusClasses[raceStatus.key] ?? resultsStatusClasses.registered}`}>
                {raceStatus.label}
              </span>
            </div>
          </Link>
        );
      })}
    </div>
    <div className="hidden overflow-x-auto rounded-2xl border border-border bg-card shadow-soft md:block">
      <table className="table-zebra-orange w-full min-w-[1220px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            <SortableTableHeading label="Bib" sortKey="bib" activeSort={sortBy} direction={sortDirection} onSort={onSort} />
            <SortableTableHeading label="Athlete" sortKey="name" activeSort={sortBy} direction={sortDirection} onSort={onSort} />
            <SortableTableHeading label={t("common.country")} sortKey="country" activeSort={sortBy} direction={sortDirection} onSort={onSort} />
            <SortableTableHeading label="Club" sortKey="club" activeSort={sortBy} direction={sortDirection} onSort={onSort} />
            <SortableTableHeading label="Race" sortKey="race" activeSort={sortBy} direction={sortDirection} onSort={onSort} />
            <SortableTableHeading label="Category" sortKey="category" activeSort={sortBy} direction={sortDirection} onSort={onSort} />
            <SortableTableHeading label="Gender" sortKey="gender" activeSort={sortBy} direction={sortDirection} onSort={onSort} />
            <SortableTableHeading label="Registration" sortKey="registration_status" activeSort={sortBy} direction={sortDirection} onSort={onSort} />
            <SortableTableHeading label="Race status" sortKey="race_status" activeSort={sortBy} direction={sortDirection} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.registrationId}-${index}`} className="border-b border-border/30 transition-colors hover:bg-primary/[0.02]">
              <td className="px-3 py-2.5 font-mono text-xs font-semibold">{row.bib}</td>
              <td className="px-3 py-2.5">
                <Link to={`/athletes/${row.athleteSlug}`} className="block truncate font-medium transition-colors hover:text-primary">
                  {row.name}
                </Link>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                <CountryWithFlag countryCode={row.countryCode} />
              </td>
              <td className="px-3 py-2.5 text-muted-foreground">
                {row.clubSlug ? (
                  <Link to={`/clubs/${row.clubSlug}`} className="transition-colors hover:text-primary">
                    {row.club}
                  </Link>
                ) : (
                  row.club
                )}
              </td>
              <td className="px-3 py-2.5">
                <span className="whitespace-nowrap text-xs font-semibold text-foreground">{row.categoryLabel}</span>
              </td>
              <td className="px-3 py-2.5">
                <span className="whitespace-nowrap rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">{row.classificationLabel}</span>
              </td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground">{formatSexLabel(row.gender)}</td>
              <td className="px-3 py-2.5">
                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${registrationStatusClasses[row.registrationStatus] ?? registrationStatusClasses.pending}`}>
                  {formatRegistrationStatusLabel(row.registrationStatus)}
                </span>
              </td>
              <td className="px-3 py-2.5">
                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${resultsStatusClasses[resolvePublicResultStatus(row).key] ?? resultsStatusClasses.registered}`}>
                  {resolvePublicResultStatus(row).label}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

function PublicResultsTable({
  rows,
  placementsByRegistrationId,
  rankByRegistrationId,
  rankingScopeLabel,
  eventSlug,
  distanceKm,
  winnerTimeMs,
  sortBy,
  sortDirection,
  onSort,
}: {
  rows: PublicEventParticipantRow[];
  placementsByRegistrationId: ReadonlyMap<string, ResultStandingPlacement[]>;
  rankByRegistrationId: ReadonlyMap<string, number>;
  rankingScopeLabel: string;
  eventSlug: string;
  distanceKm: number | null | undefined;
  winnerTimeMs: number | null;
  sortBy: string;
  sortDirection: ParticipantFilters["sortDirection"];
  onSort: (sortKey: string) => void;
}) {
  const { t } = useI18n();
  if (!rows.length) {
    return (
      <EmptyState
        title="No starters for this race yet."
        description={t("event.detail.results.emptyDescription")}
      />
    );
  }

  return (
    <>
    <div className="space-y-2 md:hidden" aria-label="Public race results">
      {rows.map((row, index) => {
        const status = resolvePublicResultStatus(row);
        const placements = placementsByRegistrationId.get(row.registrationId) ?? [];
        const primaryPlacement = placements[0] ?? null;
        const rank = rankByRegistrationId.get(row.registrationId) ?? row.overall;
        const runnerResultPath = row.publicationState && row.registrationId
          ? `/events/${eventSlug}/results/${row.registrationId}`
          : `/athletes/${row.athleteSlug}`;
        const winnerGapLabel = formatPublicResultWinnerGap(row, winnerTimeMs, "Winner");

        return (
          <Link
            key={`mobile-result-${row.registrationId}-${index}`}
            to={runnerResultPath}
            className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-soft active:bg-primary/[0.04]"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-sm font-bold text-muted-foreground">
              {rank > 0 ? rank : "—"}
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <CountryFlag countryCode={row.countryCode} className="text-sm" />
                <span className="truncate text-sm font-semibold text-foreground">{row.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">#{row.bib}</span>
              </div>
              <div className="mt-1 truncate text-xs text-muted-foreground">{normalizePublicResultClubName(row.club)}</div>
              <div className="mt-1.5 flex min-w-0 gap-1 overflow-hidden">
                {(placements.length ? placements : primaryPlacement ? [primaryPlacement] : []).slice(0, 2).map((placement) => (
                  <span key={placement.scope.id} className="truncate rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-bold text-primary-readable">
                    {placement.scope.label} #{placement.rank}
                  </span>
                ))}
                {!placements.length ? (
                  <span className="truncate rounded-full bg-secondary px-2 py-0.5 text-[9px] font-bold text-secondary-foreground">
                    {row.classificationLabel}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-sm font-bold text-foreground">{row.time}</div>
              {winnerGapLabel !== "—" ? (
                <div className="mt-0.5 font-mono text-[10px] font-semibold text-primary-readable">{winnerGapLabel}</div>
              ) : null}
              <div className="mt-1 text-[10px] font-semibold text-muted-foreground">{formatPublicResultAverageSpeed(distanceKm, row.finishTimeMs)}</div>
              <span className={`mt-1.5 inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${resultsStatusClasses[status.key] ?? resultsStatusClasses.registered}`}>
                {status.label}
              </span>
            </div>
          </Link>
        );
      })}
    </div>
    <div className="hidden overflow-x-auto rounded-2xl border border-border bg-card shadow-soft md:block">
      <table className="w-full min-w-[1160px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            <SortableTableHeading label="#" sortKey="overall" activeSort={sortBy} direction={sortDirection} onSort={onSort} className="w-16" />
            <SortableTableHeading label="Bib" sortKey="bib" activeSort={sortBy} direction={sortDirection} onSort={onSort} />
            <SortableTableHeading label="Athlete" sortKey="name" activeSort={sortBy} direction={sortDirection} onSort={onSort} />
            <SortableTableHeading label={t("common.country")} sortKey="country" activeSort={sortBy} direction={sortDirection} onSort={onSort} />
            <SortableTableHeading label="Club" sortKey="club" activeSort={sortBy} direction={sortDirection} onSort={onSort} />
            <SortableTableHeading label="Finish / gap" sortKey="time" activeSort={sortBy} direction={sortDirection} onSort={onSort} />
            <th className="px-3 py-2.5">Avg. speed</th>
            <SortableTableHeading label="Status" sortKey="status" activeSort={sortBy} direction={sortDirection} onSort={onSort} />
            <SortableTableHeading label="Category" sortKey="division" activeSort={sortBy} direction={sortDirection} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const status = resolvePublicResultStatus(row);
            const placements = placementsByRegistrationId.get(row.registrationId) ?? [];
            const primaryPlacement = placements[0] ?? null;
            const rank = rankByRegistrationId.get(row.registrationId) ?? row.overall;
            const podiumVisual = primaryPlacement && primaryPlacement.rank <= 3
              ? getResultPodiumVisual(primaryPlacement.rank)
              : null;
            const runnerResultPath = row.publicationState && row.registrationId
              ? `/events/${eventSlug}/results/${row.registrationId}`
              : null;
            const winnerGapLabel = formatPublicResultWinnerGap(row, winnerTimeMs, "Winner");
            return (
              <tr key={`${row.registrationId}-${index}`} className={cn(
                "border-b border-border/30 transition-colors",
                podiumVisual?.rowClassName,
                !podiumVisual && index % 2 === 1 && "bg-gradient-to-r from-primary/[0.05] to-trail-amber/[0.025] dark:from-primary/[0.12] dark:to-trail-amber/[0.06]",
                !podiumVisual && "hover:bg-primary/[0.04]",
              )}>
                <td className="px-3 py-2.5">
                  {rank > 0 ? (
                    <span
                      className="inline-flex h-8 min-w-8 items-center justify-center rounded-full px-1.5 text-[10px] font-bold text-muted-foreground"
                      aria-label={`${rankingScopeLabel} place ${rank}`}
                      title={`${rankingScopeLabel} #${rank}`}
                    >
                      {rank}
                    </span>
                  ) : (
                    <span className="pl-2 text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs font-semibold">{row.bib}</td>
                <td className="px-3 py-2.5">
                  {runnerResultPath ? (
                    <Link to={runnerResultPath} className="inline-flex max-w-full items-center gap-1.5 font-medium transition-colors hover:text-primary">
                      <span className="truncate">{row.name}</span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                    </Link>
                  ) : (
                    <Link to={`/athletes/${row.athleteSlug}`} className="block truncate font-medium transition-colors hover:text-primary">
                      {row.name}
                    </Link>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                  <CountryWithFlag countryCode={row.countryCode} />
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">
                  {row.clubSlug && normalizePublicResultClubName(row.club) ? (
                    <Link to={`/clubs/${row.clubSlug}`} className="transition-colors hover:text-primary">
                      {normalizePublicResultClubName(row.club)}
                    </Link>
                  ) : (
                    normalizePublicResultClubName(row.club)
                  )}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs font-semibold">
                  <span className="block">
                    {runnerResultPath && row.time !== "TBA" ? (
                      <Link to={runnerResultPath} className="transition-colors hover:text-primary">{row.time}</Link>
                    ) : row.time === "TBA" ? (
                      <span className="text-muted-foreground">TBA</span>
                    ) : (
                      row.time
                    )}
                  </span>
                  {winnerGapLabel !== "—" ? (
                    <span className="mt-0.5 block text-[10px] font-semibold text-primary">{winnerGapLabel}</span>
                  ) : null}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap font-mono text-xs font-semibold text-muted-foreground">
                  {formatPublicResultAverageSpeed(distanceKm, row.finishTimeMs)}
                </td>
                <td className="px-3 py-2.5">
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${resultsStatusClasses[status.key] ?? resultsStatusClasses.registered}`}>
                    {status.label}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  {placements.length ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {placements.map((placement) => (
                        <span
                          key={placement.scope.id}
                          className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 py-0.5 pl-2 pr-1 text-[10px] font-bold uppercase tracking-wider text-primary"
                        >
                          {placement.scope.label}
                          <ResultPlaceBadge
                            place={placement.rank}
                            compact
                            scopeLabel={placement.scope.label}
                          />
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-secondary-foreground">
                      {row.classificationLabel}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-background/50 p-6 text-sm text-muted-foreground">
      <div className="font-semibold text-foreground">{title}</div>
      <p className="mt-2 leading-6">{description}</p>
    </div>
  );
}

function getInfoItemValue(items: InfoModuleItem[], label: string) {
  return items.find((item) => item.label === label)?.value ?? "";
}

function resolveEventInfoValue(value: string, fallback: string) {
  const normalized = value.trim();
  if (!normalized || /^add\b/i.test(normalized) || /^tba$/i.test(normalized)) {
    return fallback;
  }
  return normalized;
}

function parseChecklistItems(value: string) {
  return value
    .split("\n")
    .map((item) => item.replace(/^\[\s?\]\s*/, "").trim())
    .filter(Boolean);
}

function parseNumberedItems(value: string) {
  return value
    .split("\n")
    .map((item) => item.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
}

function renderTextWithLinks(value: string) {
  return value.split(/(https?:\/\/[^\s]+)/g).map((part, index) => {
    if (/^https?:\/\/[^\s]+$/.test(part)) {
      return (
        <a
          key={`${part}-${index}`}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary underline decoration-primary/40 underline-offset-4 transition-[filter] hover:brightness-90"
        >
          {part}
        </a>
      );
    }

    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function RichInfoText({
  value,
  className = "space-y-2 text-sm leading-6 text-slate-700",
}: {
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      {value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, index) => (
          <p key={`${line}-${index}`}>{renderTextWithLinks(line)}</p>
        ))}
    </div>
  );
}

function InfoKeyStat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Calendar;
}) {
  return (
    <div className="rounded-[24px] border border-white/12 bg-black/24 p-4 text-white shadow-soft backdrop-blur-md">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white/68">
        <Icon className="h-3.5 w-3.5 text-trail-amber" />
        {label}
      </div>
      <div className="mt-3 text-base font-semibold leading-6 text-white">{value}</div>
    </div>
  );
}

function InfoFactCard({
  label,
  value,
  icon: Icon,
  tone = "warm",
}: {
  label: string;
  value: string;
  icon: typeof Calendar;
  tone?: "warm" | "dark";
}) {
  const warmTone = tone === "warm";

  return (
    <div
      className={cn(
        "rounded-[24px] border p-4 shadow-soft",
        warmTone
          ? "border-border/70 bg-background/75"
          : "border-white/12 bg-white/8 text-white backdrop-blur-sm",
      )}
    >
      <div
        className={cn(
          "inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em]",
          warmTone ? "text-primary/80" : "text-white/68",
        )}
      >
        <span
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-full border",
            warmTone
              ? "border-primary/15 bg-primary/[0.08] text-primary"
              : "border-white/14 bg-black/18 text-trail-amber",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        {label}
      </div>
      <p className={cn("mt-3 text-sm leading-6", warmTone ? "text-muted-foreground" : "text-white/88")}>{value}</p>
    </div>
  );
}

function CompactInfoList({
  items,
  tone = "light",
}: {
  items: InfoModuleItem[];
  tone?: "light" | "dark";
}) {
  const darkTone = tone === "dark";

  return (
    <div className="space-y-2.5">
      {items.map((item) => (
        <div
          key={item.label}
          className={cn(
            "rounded-[20px] border px-4 py-3",
            darkTone ? "border-white/10 bg-white/8 backdrop-blur-sm" : "border-border/60 bg-background/70",
          )}
        >
          <div
            className={cn(
              "text-[10px] font-bold uppercase tracking-[0.18em]",
              darkTone ? "text-white/64" : "text-primary/80",
            )}
          >
            {item.label}
          </div>
          <p className={cn("mt-2 text-sm leading-6", darkTone ? "text-white/86" : "text-muted-foreground")} data-i18n-skip={item.isAuthorContent || undefined}>{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function RegistrationTermsShowcase({
  items,
  heroImage,
}: {
  items: InfoModuleItem[];
  heroImage: string;
}) {
  const whatsIncluded = parseChecklistItems(getInfoItemValue(items, "What’s included"));

  return (
    <div className="overflow-hidden rounded-[32px] border border-border/70 bg-card shadow-[0_20px_60px_-34px_hsl(25_30%_12%_/_0.35)]">
      <div className="grid xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="relative overflow-hidden border-b border-border/60 xl:border-b-0 xl:border-r">
          <EventContentImage
            src={heroImage}
            alt="Registration overview"
            sizes="(min-width: 1280px) 58vw, 100vw"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(18_42%_8%_/_0.18)] via-[hsl(215_18%_10%_/_0.46)] to-[hsl(215_18%_9%_/_0.9)]" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/28 to-transparent" />
          <div className="absolute inset-0 grain-overlay opacity-35" />
          <div className="absolute inset-0 topo-pattern opacity-45" />
          <div className="relative p-6 md:p-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/18 bg-black/28 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white backdrop-blur-md">
              <CheckCircle className="h-3.5 w-3.5 text-trail-amber" />
              Registration Terms
            </div>
            <h3 className="mt-4 max-w-xl font-display text-3xl font-black leading-[1.04] text-white">
              Entry, pricing, and published conditions
            </h3>
            <p className="mt-4 max-w-xl text-sm leading-6 text-white/86">
              Fee visibility and runner inclusions stay grouped here in a lighter, easier-to-scan format.
            </p>
          </div>
        </div>

        <div className="relative bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(250,245,239,0.98))] p-6 dark:bg-[linear-gradient(180deg,hsl(var(--raised)),hsl(var(--card)))] md:p-7">
          <div className="absolute inset-0 route-pattern opacity-30" />
          <div className="relative">
            <div className="rounded-[24px] border border-[#ead8ca] bg-white p-5 text-slate-950 shadow-[0_18px_40px_-32px_rgba(17,12,8,0.24)] dark:border-border dark:bg-raised dark:text-foreground dark:shadow-earth">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">What’s included</div>
              <div className="mt-4 space-y-2.5">
                {whatsIncluded.map((item) => (
                  <div key={item} className="flex items-start gap-3 rounded-[18px] border border-[#f2e3d7] bg-[#fffaf6] px-3.5 py-2.5 dark:border-border/80 dark:bg-card">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#fff1e6] text-primary dark:bg-primary/12">
                      <CheckCircle className="h-3 w-3" />
                    </span>
                    <span className="text-sm leading-6 text-slate-800 dark:text-secondary-foreground">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RulesSafetyShowcase({
  items,
}: {
  items: InfoModuleItem[];
}) {
  const { t } = useI18n();
  const runnerResponsibility = getInfoItemValue(items, "Runner responsibility");
  const markedCourse = getInfoItemValue(items, "Marked route");
  const checkpointsCutoffs = getInfoItemValue(items, "Checkpoints & cut-offs");
  const weatherTerrain = getInfoItemValue(items, "Weather & terrain");
  const organizerNote = getInfoItemValue(items, "Organizer note");
  const officialRegulations = getInfoItemValue(items, "Official regulations");

  return (
    <div className="overflow-hidden rounded-[32px] border border-[#ead8ca] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(249,244,238,0.98))] shadow-[0_24px_64px_-40px_rgba(20,17,12,0.24)] dark:border-border dark:bg-[linear-gradient(180deg,hsl(var(--raised)),hsl(var(--card)))] dark:shadow-earth">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 route-pattern opacity-20" />
        <div className="relative p-6 md:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[#f0d8c4] bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-primary dark:border-primary/25 dark:bg-primary/10">
                <ShieldAlert className="h-3.5 w-3.5 text-primary" />
                Rules & Safety
              </div>
              <h3 className="mt-4 max-w-2xl font-display text-3xl font-black leading-[1.04] text-slate-950 dark:text-foreground">
                {t("event.detail.rulesTitle")}
              </h3>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-700 dark:text-muted-foreground">
                {t("event.detail.rulesDescription")}
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <CompactInfoList
              items={[
                { label: "Weather & terrain", value: weatherTerrain, isAuthorContent: items.find((item) => item.label === "Weather & terrain")?.isAuthorContent },
                { label: "Organizer note", value: organizerNote },
                { label: "Runner responsibility", value: runnerResponsibility },
              ]}
            />
            <CompactInfoList
              items={[
                { label: "Marked route", value: markedCourse },
                { label: "Checkpoints & cut-offs", value: checkpointsCutoffs },
                { label: "Official regulations", value: officialRegulations },
              ]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function OrganizerOperationsShowcase({
  registrationItems,
  entryFee,
}: {
  registrationItems: InfoModuleItem[];
  entryFee: string;
}) {
  const whatsIncluded = parseChecklistItems(getInfoItemValue(registrationItems, "What’s included"));

  return (
    <div className="overflow-hidden rounded-[32px] border border-[#ead8ca] bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(249,244,238,0.99))] shadow-[0_24px_64px_-40px_rgba(20,17,12,0.22)] dark:border-border dark:bg-[linear-gradient(180deg,hsl(var(--raised)),hsl(var(--card)))] dark:shadow-earth">
      <div className="border-b border-[#f0dfd2] bg-white p-6 dark:border-border dark:bg-raised md:p-7">
        <div>
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#f0d8c4] bg-[#fff7f1] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-primary dark:border-primary/25 dark:bg-primary/10">
              <CheckCircle className="h-3.5 w-3.5 text-primary" />
              Registration Terms
            </div>
            <h3 className="mt-4 font-display text-3xl font-black leading-[1.04] text-slate-950 dark:text-foreground">
              Entry, pricing, and published conditions
            </h3>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-700 dark:text-muted-foreground">
              Registration opens on January 15, 2026 and closes on April 5, 2026 at 23:59. Payments received by March
              20, 2026 include the full start package; after that date, runners keep their race entry but selected
              items may be limited by remaining stock. Registration is confirmed only after the payment is recorded by
              the organizer, and race-day payment is not available on site.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-6 md:grid-cols-2 md:p-7">
        <div className="rounded-[24px] border border-[#ead8ca] bg-white p-5 shadow-sm dark:border-border dark:bg-raised md:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">What’s included</div>
              <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-[#f0d8c4] bg-[#fff7f1] px-3 py-1.5 text-sm font-semibold text-slate-950 dark:border-border dark:bg-card dark:text-foreground">
                <Trophy className="h-4 w-4 text-primary" />
                <span className="text-slate-600 dark:text-muted-foreground">Entry fee</span>
                <span>{entryFee}</span>
              </div>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2.5">
            {whatsIncluded.map((item) => (
              <span
                key={item}
                className="inline-flex items-center gap-2 rounded-full border border-[#f2e3d7] bg-[#fffaf6] px-3.5 py-2 text-sm font-medium text-slate-800 dark:border-border dark:bg-card dark:text-secondary-foreground"
              >
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#fff1e6] text-primary dark:bg-primary/12">
                  <CheckCircle className="h-3 w-3" />
                </span>
                {item}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoModuleCard({
  eyebrow,
  title,
  description,
  items,
}: {
  eyebrow: string;
  title: string;
  description: string;
  items: InfoModuleItem[];
}) {
  return (
    <div className="overflow-hidden rounded-[28px] border border-border/70 bg-card shadow-[0_18px_48px_-30px_hsl(25_30%_12%_/_0.32)]">
      <div className="relative border-b border-border/60 p-5">
        <div className="absolute inset-0 bg-gradient-to-r from-white/92 via-white/84 to-primary/[0.04] dark:from-raised dark:via-card/95 dark:to-primary/[0.08]" />
        <div className="absolute inset-0 route-pattern opacity-30" />
        <div className="relative">
          <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground">{eyebrow}</div>
          <h3 className="mt-2 font-display text-xl font-black text-foreground">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="space-y-3 p-5">
        {items.map((item) => (
          <div key={item.label} className="rounded-[22px] border border-border/70 bg-background/60 p-4 shadow-soft">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary/80">{item.label}</div>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground">{item.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CompactInfoModuleCard({
  eyebrow,
  title,
  description,
  items,
}: {
  eyebrow: string;
  title: string;
  description: string;
  items: InfoModuleItem[];
}) {
  return (
    <div className="overflow-hidden rounded-[28px] border border-border/70 bg-card shadow-[0_18px_48px_-30px_hsl(25_30%_12%_/_0.32)]">
      <div className="relative border-b border-border/60 p-5">
        <div className="absolute inset-0 bg-gradient-to-r from-white/92 via-white/84 to-primary/[0.04] dark:from-raised dark:via-card/95 dark:to-primary/[0.08]" />
        <div className="absolute inset-0 route-pattern opacity-30" />
        <div className="relative">
          <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground">{eyebrow}</div>
          <h3 className="mt-2 font-display text-xl font-black text-foreground">{title}</h3>
          {description ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      <div className="p-5">
        <div className="divide-y divide-border/60 rounded-[22px] border border-border/60 bg-background/55">
          {items.map((item) => (
            <div key={item.label} className="px-4 py-3.5">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary/80">{item.label}</div>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{item.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function EventDetailPage() {
  const { locale, localeTag, t, formatNumber } = useI18n();
  const params = useParams();
  const { user, account } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const eventSlug = storedEventSlug(params.eventId ?? params.id ?? "");
  const eventsPath = params.locale === "hr" || params.locale === "en" ? `/${params.locale}/events` : "/events";
  const leagueSlug = params.leagueId ?? "";
  const requestedTabParam = searchParams.get("tab");
  const requestedTab = coerceEventTab(requestedTabParam);
  const requestedRaceFilter = searchParams.get("race");
  const [activeTab, setActiveTab] = useState<string>(requestedTab ?? requestedTabParam?.trim() ?? "Info");
  const [selectedCategorySlug, setSelectedCategorySlug] = useState(
    requestedRaceFilter ?? (requestedTab == null ? requestedTabParam?.trim() ?? "" : ""),
  );
  const [raceDayCategorySlug, setRaceDayCategorySlug] = useState("");
  const [registrationsCategorySlug, setRegistrationsCategorySlug] = useState(ALL_RACES_VALUE);
  const [resultsCategorySlug, setResultsCategorySlug] = useState(
    requestedTab === "Results" && requestedRaceFilter ? requestedRaceFilter : "",
  );
  const [resultsStandingScopeId, setResultsStandingScopeId] = useState("overall");
  const [registrationFilters, setRegistrationFilters] = useState<ParticipantFilters>(defaultRegistrationFilters);
  const [resultsFilters, setResultsFilters] = useState<ParticipantFilters>(defaultResultsFilters);
  const [communityPhotoFiles, setCommunityPhotoFiles] = useState<File[]>([]);
  const [isSubmittingCommunityPhotos, setIsSubmittingCommunityPhotos] = useState(false);
  const [hoverPoint, setHoverPoint] = useState<ElevPoint | null>(null);
  const [selectedElevationPoint, setSelectedElevationPoint] = useState<ElevPoint | null>(null);

  const eventQuery = useQuery({
    queryKey: ["event-detail", eventSlug],
    queryFn: () => getEventDetail(eventSlug),
    retry: false,
    staleTime: 15 * 60 * 1000,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });

  const leagueQuery = useQuery({
    queryKey: ["public-league-detail", leagueSlug],
    queryFn: () => getPublicLeagueDetail(leagueSlug),
    enabled: Boolean(leagueSlug),
    staleTime: 60_000,
  });

  const data = eventQuery.data;
  const initialEvent = usePublicEventInitialData(params.eventId ?? params.id ?? "");
  const initialEventAvailable = eventQuery.isPending || (eventQuery.isError && !(eventQuery.error instanceof PublicEventNotFoundError));
  useDocumentTitle(documentTitleKey("event", params.eventId ?? params.id ?? ""), data?.name ?? (initialEventAvailable ? initialEvent?.name : undefined));
  const categories = data?.categories ?? EMPTY_EVENT_CATEGORIES;
  const eventDocuments = data?.documents ?? EMPTY_EVENT_DOCUMENTS;
  useEffect(() => {
    setActiveTab(requestedTab ?? requestedTabParam?.trim() ?? "Info");
    if (requestedRaceFilter) {
      setSelectedCategorySlug(requestedRaceFilter);
      if (requestedTab === "Results") setResultsCategorySlug(requestedRaceFilter);
    }
  }, [eventSlug, requestedTab, requestedTabParam, requestedRaceFilter]);
  useEffect(() => {
    setRegistrationsCategorySlug(ALL_RACES_VALUE);
  }, [eventSlug, requestedTab]);
  useEffect(() => {
    if (requestedTab !== "Registrations" || !requestedRaceFilter) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("race");
      return next;
    }, { replace: true });
  }, [requestedTab, requestedRaceFilter, setSearchParams]);
  const queryScope = getEventDetailQueryScope(
    activeTab,
    categories.map((category) => category.slug),
  );
  const eventGeometryQuery = useQuery({
    queryKey: ["public-event-geometry", data?.editionId],
    queryFn: () => getPublicEventGeometry(data!.editionId!),
    enabled: queryScope.courseGeometry && Boolean(data?.editionId),
    staleTime: 15 * 60 * 1000,
  });
  const geometryByCategoryId = new Map(
    (eventGeometryQuery.data ?? []).map((geometry) => [geometry.eventCategoryId, geometry]),
  );

  useEffect(() => {
    if (!data) return;
    if (!categories.length) {
      setSelectedCategorySlug("");
      setRaceDayCategorySlug("");
      setRegistrationsCategorySlug(ALL_RACES_VALUE);
      setResultsCategorySlug("");
      setActiveTab((current) => (staticTabs.includes(current as StaticEventTab) ? current : "Info"));
      return;
    }

    if (!categories.some((category) => category.slug === selectedCategorySlug)) {
      const requestedCategory = requestedRaceFilter && categories.some((category) => category.slug === requestedRaceFilter)
        ? requestedRaceFilter
        : activeTab && !staticTabs.includes(activeTab as StaticEventTab) && categories.some((category) => category.slug === activeTab)
          ? activeTab
          : categories[0]?.slug ?? "";
      setSelectedCategorySlug(requestedCategory);
    }
    if (!categories.some((category) => category.slug === raceDayCategorySlug)) {
      setRaceDayCategorySlug(categories[0]?.slug ?? "");
    }
    if (registrationsCategorySlug !== ALL_RACES_VALUE && !categories.some((category) => category.slug === registrationsCategorySlug)) {
      setRegistrationsCategorySlug(ALL_RACES_VALUE);
    }
    if (!categories.some((category) => category.slug === resultsCategorySlug)) {
      setResultsCategorySlug(categories[0]?.slug ?? "");
    }
    if (!staticTabs.includes(activeTab as StaticEventTab) && !categories.some((category) => category.slug === activeTab)) {
      setActiveTab("Info");
    }
  }, [
    activeTab,
    categories,
    data,
    raceDayCategorySlug,
    registrationsCategorySlug,
    requestedRaceFilter,
    resultsCategorySlug,
    selectedCategorySlug,
  ]);

  useEffect(() => {
    if (categories.some((category) => category.slug === activeTab) && activeTab !== selectedCategorySlug) {
      setSelectedCategorySlug(activeTab);
    }
  }, [activeTab, categories, selectedCategorySlug]);

  const selectedCategory = categories.find((category) => category.slug === selectedCategorySlug) ?? categories[0] ?? null;
  const raceDayCategory = categories.find((category) => category.slug === raceDayCategorySlug) ?? categories[0] ?? null;
  const resultsFocusCategory = categories.find((category) => category.slug === resultsCategorySlug) ?? categories[0] ?? null;
  const communityCategory = categories[0] ?? null;
  const selectedCategoryGeometry = selectedCategory?.id
    ? geometryByCategoryId.get(selectedCategory.id) ?? null
    : null;
  const raceDayCategoryGeometry = raceDayCategory?.id
    ? geometryByCategoryId.get(raceDayCategory.id) ?? null
    : null;

  const selectedTrackSlug = selectedCategory?.linkedTrackSlug ?? null;
  const raceDayTrackSlug = raceDayCategory?.linkedTrackSlug ?? null;
  const resultsTrackSlug = resultsFocusCategory?.linkedTrackSlug ?? null;
  const raceTrackQuery = useQuery({
    queryKey: ["event-races-track", selectedTrackSlug],
    queryFn: () => getTrackDetail(selectedTrackSlug!),
    enabled: queryScope.selectedRaceTrack && Boolean(selectedTrackSlug),
  });

  const categoryTrackQueries = useQueries({
    queries: categories.map((category) => ({
      queryKey: ["event-category-track-preview", category.linkedTrackSlug],
      queryFn: () => getPublicTrackPreviewImage(category.linkedTrackSlug!),
      enabled: (activeTab === "Info" || queryScope.categoryTracks) && Boolean(category.linkedTrackSlug) && !category.coverImageUrl,
      staleTime: 60_000,
      refetchOnMount: "always" as const,
      refetchOnWindowFocus: "always" as const,
    })),
  });

  const raceDayTrackQuery = useQuery({
    queryKey: ["event-race-day-track", raceDayTrackSlug],
    queryFn: () => getTrackDetail(raceDayTrackSlug!),
    enabled: queryScope.raceDayTrack && Boolean(raceDayTrackSlug),
  });

  const resultsTrackQuery = useQuery({
    queryKey: ["event-results-track", resultsTrackSlug],
    queryFn: () => getTrackDetail(resultsTrackSlug!),
    enabled: queryScope.resultsTrack && Boolean(resultsTrackSlug),
  });

  const resultsQuery = useQuery({
    queryKey: ["public-event-results", data?.editionId],
    queryFn: () => getPublicEventResultsReadModel(data!.editionId!),
    enabled: queryScope.results && Boolean(data?.editionId),
    refetchInterval: activeTab === "Results" ? 30_000 : false,
    staleTime: 15_000,
  });

  const participantsQuery = useQuery({
    queryKey: ["public-event-participants", data?.editionId],
    queryFn: () => getPublicEventParticipantsReadModel(data!.editionId!),
    enabled: queryScope.participantRows && Boolean(data?.editionId),
    refetchInterval: activeTab === "Results" ? 30_000 : false,
    staleTime: 15_000,
  });
  const resultsInitiallyLoading = resultsQuery.isPending || participantsQuery.isPending;
  const resultsLoadFailed = (resultsQuery.isError && !resultsQuery.data)
    || (participantsQuery.isError && !participantsQuery.data);
  const resultsUnconfirmed = resultsInitiallyLoading || resultsLoadFailed;

  const publicLiveQuery = useQuery({
    queryKey: ["public-event-live", data?.editionId],
    queryFn: () => getPublicLiveEditionReadModel(data!.editionId!),
    enabled: queryScope.publicLiveState && Boolean(data?.editionId),
    refetchInterval: queryScope.publicLiveState ? 30_000 : false,
  });

  const selectedTrack = raceTrackQuery.data ?? null;
  const raceDayTrack = raceDayTrackQuery.data ?? null;
  const resultsTrack = resultsTrackQuery.data ?? null;
  const raceCheckpoints = selectedCategoryGeometry?.raceCheckpoints
    ?? selectedCategory?.raceCheckpoints
    ?? [];
  const rulesSafetyItems = buildRulesSafetyModule(
    selectedTrack ?? undefined,
    raceCheckpoints,
    eventDocuments.length,
    locale,
  );
  const routeCheckpoints = mergePublicCoursePoints(
    selectedTrack?.checkpoints
      ?? selectedCategoryGeometry?.checkpoints
      ?? selectedCategory?.checkpoints
      ?? [],
    raceCheckpoints,
  );
  const mappedRouteCheckpoints = mapCourseCheckpoints(routeCheckpoints, locale);
  const routeTrackPoints = selectedTrack?.trackPoints
    ?? selectedCategoryGeometry?.trackPoints
    ?? selectedCategory?.trackPoints
    ?? [];
  const routeElevationPoints = selectedTrack?.elevationPoints
    ?? selectedCategoryGeometry?.elevationPoints
    ?? selectedCategory?.elevationPoints
    ?? [];
  const raceDayRouteCheckpoints = raceDayTrack?.checkpoints
    ?? raceDayCategoryGeometry?.checkpoints
    ?? [];
  const raceDayRaceCheckpoints = raceDayCategoryGeometry?.raceCheckpoints
    ?? raceDayCategory?.raceCheckpoints
    ?? [];
  const logisticsLocations = data?.locations ?? [];
  const logisticsMapLocations = buildLogisticsMapLocations(logisticsLocations, data?.dateLabel ?? "", data?.distanceSummary ?? "");
  const eventRaceRoutes = categories.flatMap((category, index): EventMapRoute[] => {
    const points = (category.id ? geometryByCategoryId.get(category.id)?.trackPoints : null)
      ?? category.trackPoints
      ?? [];
    if (points.length < 2) return [];
    return [{
      id: category.slug,
      label: category.name,
      points,
      color: [brand.colors.raceOrange, "#38bdf8", "#84cc16", "#e879f9"][index % 4] ?? brand.colors.raceOrange,
    }];
  });
  const weatherCheckpoints = selectedCategoryGeometry?.checkpoints?.length
    ? selectedCategoryGeometry.checkpoints
    : data?.checkpoints?.length
      ? data.checkpoints
      : raceDayRouteCheckpoints;
  const primaryWeatherTarget = pickPrimaryWeatherTarget(logisticsLocations, weatherCheckpoints);

  const weatherQuery = useQuery({
    queryKey: ["event-race-day-weather", primaryWeatherTarget?.id, primaryWeatherTarget?.lat, primaryWeatherTarget?.lng],
    enabled: activeTab === "Info" && Boolean(primaryWeatherTarget),
    queryFn: async () => {
      if (!primaryWeatherTarget) return null;
      const response = await getLiveWeatherSnapshots([primaryWeatherTarget]);
      return response.locations[0] ?? null;
    },
  });
  const eventWeatherToday = new Date();
  const eventUpcomingWeatherDates = buildEventUpcomingWeatherDates(eventWeatherToday, 6);
  const forecastWeatherQuery = useQuery({
    queryKey: [
      "event-live-weather-forecast",
      data?.slug ?? "event",
      primaryWeatherTarget?.lat ?? null,
      primaryWeatherTarget?.lng ?? null,
      ...eventUpcomingWeatherDates.map((entry) => entry.date),
    ],
    enabled: activeTab === "Info" && Boolean(primaryWeatherTarget),
    staleTime: 15 * 60 * 1000,
    queryFn: async () => {
      if (!primaryWeatherTarget) return [];
      const responses = await Promise.all(
        eventUpcomingWeatherDates.map(async (entry) => {
          const response = await getLiveWeatherSnapshots([{
            id: `${primaryWeatherTarget.id}-${entry.date}`,
            lat: primaryWeatherTarget.lat,
            lng: primaryWeatherTarget.lng,
          }], entry.date);

          return {
            ...entry,
            snapshot: response.locations[0] ?? null,
          };
        }),
      );

      return responses;
    },
  });

  useEffect(() => {
    setHoverPoint(null);
    setSelectedElevationPoint(null);
  }, [selectedTrackSlug]);

  const participantRows = participantsQuery.data?.rows ?? EMPTY_EVENT_PARTICIPANT_ROWS;
  const registrationBaseRows = useMemo(
    () => (
      registrationsCategorySlug === ALL_RACES_VALUE
        ? participantRows
        : participantRows.filter((row) => row.categorySlug === registrationsCategorySlug)
    ),
    [participantRows, registrationsCategorySlug],
  );
  const registrationScopeSummary = useMemo(
    () => buildEventRegistrationScopeSummary({
      categories,
      publicRows: registrationBaseRows,
      categorySlug: registrationsCategorySlug === ALL_RACES_VALUE ? null : registrationsCategorySlug,
    }),
    [categories, registrationBaseRows, registrationsCategorySlug],
  );
  const resultsRosterRows = useMemo(
    () => (
      resultsFocusCategory
        ? participantRows.filter((row) => row.categorySlug === resultsFocusCategory.slug)
        : []
    ),
    [participantRows, resultsFocusCategory],
  );
  const resultsBaseRows = useMemo(
    () => applyDerivedOverallPositions(resultsRosterRows.filter(hasStartedRace)),
    [resultsRosterRows],
  );
  const resultsWinnerTimeMs = useMemo(
    () => getPublicResultWinnerTimeMs(resultsBaseRows),
    [resultsBaseRows],
  );

  const registrationGenderOptions = useMemo(() => buildGenderFilterOptions(registrationBaseRows), [registrationBaseRows]);
  const registrationClubOptions = useMemo(() => buildClubFilterOptions(registrationBaseRows), [registrationBaseRows]);
  const registrationStatusOptions = useMemo(() => buildRegistrationStatusOptions(registrationBaseRows), [registrationBaseRows]);
  const registrationRaceStatusOptions = useMemo(() => buildRaceStatusOptions(registrationBaseRows), [registrationBaseRows]);

  const resultsGenderOptions = useMemo(() => buildGenderFilterOptions(resultsBaseRows), [resultsBaseRows]);
  const resultsClubOptions = useMemo(() => buildClubFilterOptions(resultsBaseRows), [resultsBaseRows]);
  const resultsRegistrationStatusOptions = useMemo(() => buildRegistrationStatusOptions(resultsBaseRows), [resultsBaseRows]);
  const resultsRaceStatusOptions = useMemo(() => buildRaceStatusOptions(resultsBaseRows), [resultsBaseRows]);

  const deferredRegistrationSearch = useDeferredValue(registrationFilters.search);
  const deferredResultsSearch = useDeferredValue(resultsFilters.search);

  const filteredRegistrationRows = useMemo(
    () => filterParticipantRows(registrationBaseRows, { ...registrationFilters, search: deferredRegistrationSearch }),
    [deferredRegistrationSearch, registrationBaseRows, registrationFilters],
  );
  const resultsFilterMatchedRows = useMemo(
    () => filterParticipantRows(resultsBaseRows, { ...resultsFilters, search: deferredResultsSearch }),
    [deferredResultsSearch, resultsBaseRows, resultsFilters],
  );

  useEffect(() => {
    setRegistrationFilters((current) => {
      let changed = false;
      let next = current;

      if (current.gender !== "all" && !registrationGenderOptions.some((option) => option.value === current.gender)) {
        next = { ...next, gender: "all" };
        changed = true;
      }
      if (next.club !== "all" && !registrationClubOptions.some((option) => option.value === next.club)) {
        next = { ...next, club: "all" };
        changed = true;
      }
      if (
        next.registrationStatus !== "all"
        && !registrationStatusOptions.some((option) => option.value === next.registrationStatus)
      ) {
        next = { ...next, registrationStatus: "all" };
        changed = true;
      }
      if (next.raceStatus !== "all" && !registrationRaceStatusOptions.some((option) => option.value === next.raceStatus)) {
        next = { ...next, raceStatus: "all" };
        changed = true;
      }

      return changed ? next : current;
    });
  }, [registrationClubOptions, registrationGenderOptions, registrationRaceStatusOptions, registrationStatusOptions]);

  useEffect(() => {
    setResultsFilters((current) => {
      let changed = false;
      let next = current;

      if (current.gender !== "all" && !resultsGenderOptions.some((option) => option.value === current.gender)) {
        next = { ...next, gender: "all" };
        changed = true;
      }
      if (next.club !== "all" && !resultsClubOptions.some((option) => option.value === next.club)) {
        next = { ...next, club: "all" };
        changed = true;
      }
      if (
        next.registrationStatus !== "all"
        && !resultsRegistrationStatusOptions.some((option) => option.value === next.registrationStatus)
      ) {
        next = { ...next, registrationStatus: "all" };
        changed = true;
      }
      if (next.raceStatus !== "all" && !resultsRaceStatusOptions.some((option) => option.value === next.raceStatus)) {
        next = { ...next, raceStatus: "all" };
        changed = true;
      }

      return changed ? next : current;
    });
  }, [resultsClubOptions, resultsGenderOptions, resultsRaceStatusOptions, resultsRegistrationStatusOptions]);

  if (eventQuery.isLoading) {
    return initialEvent ? (
      <div data-event-detail-ready className="container mx-auto px-4 py-16">
        <PublicEventInitialSummary data={initialEvent} />
        <div data-nosnippet=""><EventDetailLoadingState /></div>
      </div>
    ) : <EventDetailLoadingState />;
  }

  if (eventQuery.isError && !data && !(eventQuery.error instanceof PublicEventNotFoundError)) {
    return (
      <EventDetailAvailabilityState
        eventsPath={eventsPath}
        fetching={eventQuery.isFetching}
        onRetry={() => void eventQuery.refetch()}
        state="error"
        initialEvent={initialEvent}
      />
    );
  }

  if (!data) {
    return <EventDetailAvailabilityState eventsPath={eventsPath} state="unavailable" />;
  }

  const handleCommunityPhotoSubmit = async () => {
    if (!user) {
      toast.error("Sign in to share race photos.");
      return;
    }
    if (!data.editionId || !communityCategory?.id) {
      toast.error("This race is not ready for community photo submissions.");
      return;
    }

    setIsSubmittingCommunityPhotos(true);
    try {
      const uploadedCount = await submitEventPhotoFiles({
        eventEditionId: data.editionId,
        eventCategoryId: communityCategory.id,
        userId: user.id,
        files: communityPhotoFiles,
      });
      setCommunityPhotoFiles([]);
      toast.success(`${uploadedCount} photo${uploadedCount === 1 ? "" : "s"} sent for review.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to upload race photos.");
    } finally {
      setIsSubmittingCommunityPhotos(false);
    }
  };

  const selectedRaceRegisterHref = buildRegistrationPath({
    eventSlug: data.slug,
    categorySlug: selectedCategory?.slug,
  });
  const totalParticipants = categories.reduce((sum, category) => sum + Math.max(category.participants, 0), 0);
  const eventPriceLabel = localizedEventPriceLabel(formatEventPriceLabels(categories.map((category) => category.price)), localeTag);
  const schedule = buildRaceDaySchedule(data, categories, locale);
  const eventStartIso = getEventStartIso(data, categories);
  const resultsData = resultsQuery.data;
  const allPublishedResultRows = resultsData?.categories.flatMap((category) => category.rows) ?? [];
  const representedClubCount = new Set(
    participantRows
      .map((row) => ({ key: row.clubSlug ?? row.club.trim().toLowerCase(), label: row.club.trim().toLowerCase() }))
      .filter(({ key, label }) => Boolean(key) && label !== "independent")
      .map(({ key }) => key),
  ).size;
  const selectedResultsCategory = resultsFocusCategory
    ? resultsData?.categories.find((category) => (
      category.id === resultsFocusCategory.id
      || compareText(category.label, resultsFocusCategory.name) === 0
    )) ?? null
    : null;
  const selectedCategoryResultsCategory = selectedCategory
    ? resultsData?.categories.find((category) => (
      category.id === selectedCategory.id
      || compareText(category.label, selectedCategory.name) === 0
    )) ?? null
    : null;
  const selectedResultRows = selectedResultsCategory?.rows ?? [];
  const resultStandingScopes = selectedResultsCategory
    ? buildResultStandingScopes(
        selectedResultsCategory.rankingConfig,
        selectedResultRows,
        selectedResultsCategory.standingClassifications,
      )
    : [];
  const activeResultsStandingScope = resultStandingScopes.find((scope) => scope.id === resultsStandingScopeId)
    ?? resultStandingScopes[0]
    ?? null;
  const activeStandingResultRows = activeResultsStandingScope
    ? resultRowsForStandingScope(selectedResultRows, activeResultsStandingScope)
    : selectedResultRows;
  const activeStandingRegistrationIds = new Set(
    activeStandingResultRows.map((row) => row.registrationId).filter(Boolean),
  );
  const filteredResultsRows = !activeResultsStandingScope || activeResultsStandingScope.kind === "overall"
    ? resultsFilterMatchedRows
    : resultsFilterMatchedRows.filter((row) => activeStandingRegistrationIds.has(row.registrationId));
  const activeStandingRankByRegistrationId = new Map<string, number>();
  for (const row of activeStandingResultRows) {
    if (!row.registrationId || !activeResultsStandingScope) continue;
    activeStandingRankByRegistrationId.set(
      row.registrationId,
      getResultStandingRank(row, activeResultsStandingScope, activeStandingResultRows),
    );
  }
  const resultPlacementsByRegistrationId = new Map<string, ResultStandingPlacement[]>();
  for (const row of selectedResultRows) {
    if (!row.registrationId) continue;
    const placements = getResultStandingPlacements(row, resultStandingScopes, selectedResultRows);
    resultPlacementsByRegistrationId.set(
      row.registrationId,
      activeResultsStandingScope?.kind === "overall"
        ? placements
        : placements.filter((placement) => placement.scope.id === activeResultsStandingScope?.id),
    );
  }
  const categoryWinnerRows = resultStandingScopes.flatMap((scope) => {
    if (scope.kind === "overall") return [];
    const scopedRows = resultRowsForStandingScope(selectedResultRows, scope);
    const winner = scopedRows.find((row) => getResultStandingRank(row, scope, scopedRows) === 1);
    return winner ? [{ row: winner, scope }] : [];
  });
  const hasOfficialRows = (resultsData?.categories.some((category) => category.rows.length > 0) ?? false);
  const eventLifecycle = deriveEventLifecycle(
    eventStartIso,
    resultsData?.hasPublishedResults ?? false,
    hasOfficialRows,
    data.statusLabel,
  );
  const liveWindowStartAt = eventStartIso ? new Date(eventStartIso).getTime() - 48 * 60 * 60 * 1_000 : null;
  const liveWindowEndAt = new Date(data.endDateIso ?? eventStartIso ?? "").getTime() + 48 * 60 * 60 * 1_000;
  const eventNow = Date.now();
  const showLiveTab = Boolean(data.editionId) && (
    eventLifecycle === "during"
    || (liveWindowStartAt != null && Number.isFinite(liveWindowEndAt) && eventNow >= liveWindowStartAt && eventNow <= liveWindowEndAt)
  );
  const canRegister = eventLifecycle === "before" && isEventRegistrationOpenStatus(data.statusLabel);
  const derivedSummary = buildDerivedSummary(data, categories);
  const aboutText = isPlaceholderAbout(data.about) ? derivedSummary : data.about;
  const heroSummary = buildHeroSummary(data.subtitle, aboutText, derivedSummary);
  const overviewPreviewText = buildOverviewPreviewText(aboutText, heroSummary);
  const selectedRaceFacts = buildSelectedRaceFacts(selectedCategory, selectedTrack?.distance ?? null, selectedTrack?.elevation ?? null);
  const categoryTimeline = buildCategoryTimeline(data, selectedCategory, locale);
  const raceDayRaceFacts = buildSelectedRaceFacts(raceDayCategory, raceDayTrack?.distance ?? null, raceDayTrack?.elevation ?? null);
  const selectedStartDirectionsHref = buildDirectionsHref(routeCheckpoints[0]?.lat, routeCheckpoints[0]?.lng);
  const raceDayStartDirectionsHref = buildDirectionsHref(raceDayRouteCheckpoints[0]?.lat, raceDayRouteCheckpoints[0]?.lng);
  const selectedParkingLocation = logisticsLocations.find((location) => (
    location.type === "parking" || /parking/i.test(location.label) || /parking/i.test(location.place ?? "")
  )) ?? logisticsLocations[0] ?? null;
  const selectedParkingDirectionsHref = buildDirectionsHref(selectedParkingLocation?.lat, selectedParkingLocation?.lng)
    ?? buildMapsPinHref(selectedParkingLocation?.lat, selectedParkingLocation?.lng);
  const podiumRows = [...resultsBaseRows]
    .filter((row) => resolvePublicResultStatus(row).key === "finished" && row.overall > 0)
    .sort((left, right) => left.overall - right.overall)
    .slice(0, 3);
  const officialTrackRecords = podiumRows.map((row, index) => ({
    rank: index + 1,
    name: row.name,
    time: row.time,
    date: formatTrackRecordDate(resolveTrackRecordOccurredAt({
      sourceKind: "race",
      eventStartedAt: resultsFocusCategory?.startAtIso ?? eventStartIso,
    })),
    verified: ["official", "corrected"].includes(selectedResultsCategory?.publicationState ?? ""),
    strava: null,
    gender: row.gender === "F" || row.gender === "M" ? row.gender : null,
    sourceKind: "race" as const,
    sourceLabel: data.name,
    sourceHref: `/events/${data.slug}`,
  }));
  const selectedCategoryTrackRecords = applyDerivedOverallPositions(
    participantRows
      .filter((row) => row.categorySlug === selectedCategory?.slug && hasStartedRace(row))
      .filter((row) => resolvePublicResultStatus(row).key === "finished"),
  )
    .sort((left, right) => left.overall - right.overall)
    .slice(0, 3)
    .map((row, index) => ({
      rank: index + 1,
      name: row.name,
      time: row.time,
      date: formatTrackRecordDate(resolveTrackRecordOccurredAt({
        sourceKind: "race",
        eventStartedAt: selectedCategory?.startAtIso ?? eventStartIso,
      })),
      verified: ["official", "corrected"].includes(selectedCategoryResultsCategory?.publicationState ?? ""),
      strava: null,
      gender: row.gender === "F" || row.gender === "M" ? row.gender : null,
      sourceKind: "race" as const,
      sourceLabel: data.name,
      sourceHref: `/events/${data.slug}`,
    }));
  const selectedTrackRecords = selectedTrack?.leaderboard.length
    ? selectedTrack.leaderboard.slice(0, 3)
    : selectedCategoryTrackRecords;
  const resultsTrackRecords = resultsTrack?.leaderboard.length
    ? resultsTrack.leaderboard.slice(0, 3)
    : officialTrackRecords;
  const selectedResultsFinishersCount = resultsBaseRows.filter((row) => resolvePublicResultStatus(row).key === "finished").length;
  const selectedResultsDnsCount = resultsRosterRows.filter((row) => resolvePublicResultStatus(row).key === "dns").length;
  const selectedResultsPendingCount = resultsRosterRows.filter((row) => row.registrationStatus === "pending").length;
  const selectedResultsPublicationState = selectedResultsCategory?.publicationState
    ?? filteredResultsRows.find((row) => row.publicationState)?.publicationState
    ?? null;
  const selectedResultsPublicationLabel = formatPublicResultPublicationLabel(selectedResultsPublicationState)
    || (eventLifecycle === "before" ? t("event.detail.results.before") : "Pending");
  const visibleRegistrationClubCount = new Set(filteredRegistrationRows.map((row) => row.clubSlug ?? row.club)).size;
  const visibleResultsClubCount = new Set(filteredResultsRows.map((row) => row.clubSlug ?? row.club)).size;
  const selectedTrackGalleryImage =
    selectedTrack?.gallery.find((item) => item.isDefault)?.imageUrl
    ?? selectedTrack?.gallery[0]?.imageUrl
    ?? null;
  const selectedCategoryHeroImage = selectedCategory?.coverImageUrl ?? selectedTrackGalleryImage ?? data.coverImageUrl ?? featuredEventHeroImage;
  const categoryPreviewImageBySlug = new Map(categories.map((category, index) => {
    const uploadedImage = categoryTrackQueries[index]?.data ?? null;
    return [category.slug, category.coverImageUrl ?? uploadedImage ?? data.coverImageUrl ?? featuredEventHeroImage] as const;
  }));
  const selectedCategorySurfaceLabel = selectedCategory?.sportCode === "swimming"
    ? t("event.course.swimSurface") : selectedTrack?.surface || t("event.detail.mixedTerrain");
  const selectedCategorySummary = selectedCategory
    ? t(selectedCategory.sportCode === "swimming" ? "event.course.swimSummary" : "event.detail.categorySummary", { name: selectedCategory.name, distance: localizedEventDistanceLabel(selectedCategory.distance, localeTag), elevation: selectedCategory.elevation, surface: selectedCategorySurfaceLabel, waterPoints: selectedTrack?.waterPoints ?? 0, start: selectedCategory.startLabel ?? t("event.card.priceTba") })
    : t("event.detail.categoryPending");
  const selectedCategoryEligibility = buildEventEligibilityPresentation({
    minimumAge: selectedCategory?.minimumAge,
    maximumAge: selectedCategory?.maximumAge,
    allowedGenders: selectedCategory?.allowedGenders,
    note: selectedCategory?.eligibilityNote,
  }, locale);
  const selectedCategoryCalendarBits = getEventCalendarBadgeBits(data.dateLabel, data.startDateIso, localeTag);
  const infoEventCalendarBits = getEventCalendarBadgeBits(data.dateLabel, data.startDateIso, localeTag);
  const resultsTrackGalleryImage =
    resultsTrack?.gallery.find((item) => item.isDefault)?.imageUrl
    ?? resultsTrack?.gallery[0]?.imageUrl
    ?? null;
  const infoWeatherSnapshot = weatherQuery.data ?? null;
  const infoWeatherUnavailable = isEventWeatherUnavailable(infoWeatherSnapshot) && !weatherQuery.isPending;
  const infoWeatherFallbackSnapshot = !weatherQuery.isPending && primaryWeatherTarget && infoWeatherUnavailable
    ? buildMockEventWeatherSnapshot(primaryWeatherTarget.label, eventStartIso)
    : null;
  const infoWeatherDisplaySnapshot = infoWeatherFallbackSnapshot ?? infoWeatherSnapshot;
  const infoWeatherIsMock = Boolean(infoWeatherFallbackSnapshot);
  const upcomingEventWeather = forecastWeatherQuery.data ?? [];
  const eventWeatherCards = primaryWeatherTarget
    ? [
        {
          id: "today",
          date: formatEventWeatherDateInput(eventWeatherToday),
          shortLabel: "Today",
          snapshot: infoWeatherDisplaySnapshot,
          isToday: true,
          isMock: infoWeatherIsMock,
        },
        ...eventUpcomingWeatherDates.map((entry, index) => {
          const liveSnapshot = upcomingEventWeather[index]?.snapshot ?? null;
          const fallbackSnapshot = primaryWeatherTarget
            ? buildMockEventWeatherSnapshot(primaryWeatherTarget.label, `${entry.date}T12:00:00+02:00`)
            : null;
          const unavailable = isEventWeatherUnavailable(liveSnapshot);
          return {
            id: entry.date,
            date: entry.date,
            shortLabel: entry.shortLabel,
            snapshot: unavailable ? fallbackSnapshot : liveSnapshot,
            isToday: false,
            isMock: unavailable,
          };
        }),
      ]
    : [];
  const todayEventWeatherCard = eventWeatherCards[0] ?? null;
  const upcomingEventForecastCards = eventWeatherCards.slice(1);
  const eventWeatherTemperatureValues = eventWeatherCards
    .map((entry) => entry.snapshot?.temp)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const eventWeatherMinTemp = eventWeatherTemperatureValues.length ? Math.min(...eventWeatherTemperatureValues) : null;
  const eventWeatherMaxTemp = eventWeatherTemperatureValues.length ? Math.max(...eventWeatherTemperatureValues) : null;
  const eventInfoItems = data.infoItems.map(([label, value]) => ({ label, value }));
  const raceDayTabImage = data.coverImageUrl ?? selectedTrackGalleryImage ?? ridgePortraitImage;
  const registrationsTabImage = selectedTrackGalleryImage ?? data.coverImageUrl ?? torakLandscapeImage;
  const resultsTabImage = resultsTrackGalleryImage ?? data.coverImageUrl ?? leagueRiverImage;
  function handleElevationHover(point: ElevPoint | null) {
    setHoverPoint(point);
  }

  function handleElevationSelect(point: ElevPoint) {
    setSelectedElevationPoint(point);
  }

  const socialLinks = [
    data.websiteUrl ? { label: "Website", href: data.websiteUrl, icon: Globe } : null,
    data.instagramUrl ? { label: "Instagram", href: data.instagramUrl, icon: Camera } : null,
    data.facebookUrl ? { label: "Facebook", href: data.facebookUrl, icon: Users } : null,
  ].filter((item): item is { label: string; href: string; icon: typeof Globe } => Boolean(item));
  const eventNavItems = [
    { key: "Info", label: "Info", type: "static" as const },
    ...(categories.length ? [{ key: "Race info", label: t("event.raceInfo"), type: "static" as const }] : []),
    { key: "Rules", label: "Rules", type: "static" as const },
    ...categories.map((category) => ({
      key: category.slug,
      label: category.name,
      detail: localizedEventDistanceLabel(category.distance, localeTag),
      type: "category" as const,
    })),
    ...(data.gallery.length || data.videos.length ? [{ key: "Gallery", label: "Gallery", type: "static" as const }] : []),
    { key: "Registrations", label: "Registrations", type: "static" as const },
    ...(showLiveTab ? [{ key: "Live", label: "Live", type: "static" as const }] : []),
    { key: "Results", label: "Results", type: "static" as const },
    { key: "Statistics", label: "Statistics", type: "static" as const },
    { key: "Community", label: "Community", type: "static" as const },
  ];
  const isCategoryView = queryScope.selectedRaceTrack;

  function openRaceInfo(slug: string) {
    setSelectedCategorySlug(slug);
    setActiveTab("Race info");
    const next = new URLSearchParams(searchParams);
    next.set("tab", "race-info");
    next.set("race", slug);
    setSearchParams(next);
  }

  function activateEventTab(tab: EventNavigationItem) {
    if (tab.type === "category" || tab.key === "Race info") {
      openRaceInfo(tab.type === "category" ? tab.key : selectedCategory?.slug ?? "");
      return;
    }
    if (tab.key === "Registrations") {
      setRegistrationsCategorySlug(ALL_RACES_VALUE);
    }
    if (tab.key === "Results" && selectedCategorySlug) {
      setResultsCategorySlug(selectedCategorySlug);
    }
    setActiveTab(tab.key);
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab.key.toLowerCase());
    if (tab.key === "Registrations") next.delete("race");
    else if (selectedCategorySlug) next.set("race", selectedCategorySlug);
    setSearchParams(next);
  }

  return (
    <div data-event-detail-ready>
      <section
        data-event-client-hero
        className="relative min-h-[286px] overflow-hidden border-b border-border bg-trail-earth lg:min-h-[640px]"
      >
        <EventHeroImage
          src={isCategoryView
            ? selectedCategoryHeroImage
            : data.coverImageUrl || selectedTrackGalleryImage || getTrackThemeHero(data.name, data.locationLabel)}
          alt={data.name}
        />
        <div className="absolute inset-0 z-[2] bg-gradient-to-b from-black/10 via-black/18 to-black/82 lg:hidden" />
        <div className="absolute inset-0 z-[2] hidden bg-gradient-to-b from-black/12 via-transparent to-black/74 dark:from-black/30 dark:via-black/5 dark:to-black/82 lg:block" />

        <div className="lg:hidden">
          <div className="absolute inset-x-4 top-4 z-20 flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            {data.leagueMemberships?.map((membership) => (
              <EventLeagueRoundPill
                key={`${membership.leagueSlug}-${membership.roundNumber}`}
                membership={membership}
                compact
                className="h-7 max-w-[15rem] !px-2.5 !py-0 !text-[10px] backdrop-blur-md"
              />
            ))}
          </div>
          <EventHeroCalendarBadge
            dateLabel={data.dateLabel}
            startDateIso={data.startDateIso}
          />
        </div>
          <div className="relative z-10 flex min-h-[286px] flex-col justify-end px-4 pb-7 pt-10 text-white">
          <span className={cn(
            "inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] backdrop-blur-md",
            eventLifecycle === "after"
              ? "border-primary/50 bg-primary text-primary-foreground"
              : eventLifecycle === "during"
                ? "timing-lime-pill"
                : "border-white/25 bg-black/28",
          )}>
            <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />
            {data.statusLabel}
          </span>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <ActivityTypeBadge
              activityType={data.activityType}
              compact
              className="!border-white/25 !bg-black/28 !text-white backdrop-blur-md"
            />
            <SportBadgeList
              sportCodes={data.sportCodes}
              primarySportCode={data.primarySportCode}
            />
          </div>
          <h1 className="mt-3 max-w-[22rem] font-display text-[2.15rem] font-extrabold leading-[1.02] tracking-tight drop-shadow-[0_4px_20px_rgba(0,0,0,0.4)]">
            {data.name}
          </h1>
          <div className="mt-4 flex min-w-0 items-center gap-3 text-sm font-medium text-white/92">
            <MapPin className="h-4 w-4 text-trail-amber" aria-hidden="true" />
            <span className="truncate">{data.locationLabel}</span>
          </div>
          </div>
        </div>

        <div className="hidden lg:block">
          <div className="container pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 px-4 pt-8">
          <div className="pointer-events-auto flex min-w-0 flex-col items-start gap-2">
            {data.leagueMemberships?.map((membership) => (
              <EventLeagueRoundPill
                key={`${membership.leagueSlug}-${membership.roundNumber}`}
                membership={membership}
                compact
                className="h-7 max-w-[20rem] !px-2.5 !py-0 !text-[10px] backdrop-blur-md"
              />
            ))}
          </div>
          <EventHeroCalendarBadge
            dateLabel={data.dateLabel}
            startDateIso={data.startDateIso}
          />
        </div>

          <div className="container relative z-10 flex min-h-[640px] items-end px-4 pb-20">
          <div className="w-full max-w-6xl">
            <h1 className="max-w-5xl font-display text-3xl font-extrabold leading-[1.04] text-white drop-shadow-[0_4px_20px_rgba(0,0,0,0.38)] sm:text-4xl md:text-6xl">
              {data.name}
            </h1>

            <div className="mt-4 flex max-w-full items-center gap-1.5 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <ActivityTypeBadge
                activityType={data.activityType}
                compact
                className="h-7 !border-trail-amber/50 !bg-black/28 !px-2 !py-1 !text-[10px] !text-white backdrop-blur-md"
              />
              <SportBadgeList
                sportCodes={data.sportCodes}
                primarySportCode={data.primarySportCode}
                compact
                className="shrink-0"
                badgeClassName="!gap-1 !px-2 !py-1 !text-[10px]"
              />
              <span className={cn(
                "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-bold backdrop-blur-md",
                eventLifecycle === "after"
                  ? "border-primary/50 bg-primary text-primary-foreground shadow-warm"
                  : eventLifecycle === "during"
                    ? "timing-lime-pill"
                    : "border-trail-blue/50 bg-trail-blue/90 text-white dark:text-trail-blue-foreground",
              )}>
                <CheckCircle className="h-3 w-3" />
                {data.statusLabel}
              </span>
              <span className={eventHeroInfoPillClass}>
                <MapPin className="h-3 w-3 text-trail-amber" />
                {data.locationLabel}
              </span>
              <span className={cn(eventHeroInfoPillClass, "hidden sm:inline-flex")}>
                <Route className="h-3 w-3 text-trail-amber" />
                {localizedEventDistanceLabel(categories.map((category) => category.distance).join(" / "), localeTag)}
              </span>
              <span className={cn(eventHeroInfoPillClass, "hidden sm:inline-flex")}>
                <Ticket className="h-3 w-3 text-trail-amber" />
                {eventPriceLabel}
              </span>
              <span className={cn(eventHeroInfoPillClass, "hidden sm:inline-flex")}>
                <Globe className="h-3 w-3 text-trail-amber" />
                {eventCountryLabel(data.countryCode)}
              </span>
              <span className={cn(eventHeroInfoPillClass, "hidden sm:inline-flex")}>
                <Users className="h-3 w-3 text-trail-amber" />
                {totalParticipants} registered
              </span>
              <span className={cn(eventHeroInfoPillClass, "hidden sm:inline-flex")}>
                <Flag className="h-3 w-3 text-trail-amber" />
                {representedClubCount} clubs
              </span>
            </div>
          </div>
        </div>

          <HeroMountainDivider />
        </div>
      </section>

      {leagueQuery.data ? (
        <LeagueRoundNavigation
          eventSlug={eventSlug}
          league={leagueQuery.data}
        />
      ) : null}

      <EventSectionNavigation items={eventNavItems} activeKey={activeTab} selectedRaceKey={selectedCategory?.slug} onSelect={activateEventTab} />

      <div className="container mx-auto px-4 py-5 lg:py-10">
        {isCategoryView ? (
          <EventRaceInfo
            eventEditionId={data.editionId}
            categories={categories.map((category) => ({
              ...category,
              raceCheckpoints: (category.id ? geometryByCategoryId.get(category.id)?.raceCheckpoints : undefined) ?? category.raceCheckpoints,
            }))}
            selectedCategory={selectedCategory}
          />
        ) : null}
        {activeTab === "Info" && (
          <div className="space-y-4 lg:hidden">
            <section className="overflow-hidden rounded-2xl border border-border/75 bg-card shadow-soft">
              <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Race snapshot</div>
                  <h2 className="mt-0.5 font-display text-lg font-black">At a glance</h2>
                </div>
                <span className="rounded-full bg-primary/[0.08] px-2.5 py-1 text-[10px] font-bold text-primary">
                  {t("event.detail.racesCount", { count: categories.length })}
                </span>
              </div>
              <dl className="grid grid-cols-2">
                {[
                  { label: "Organizer", value: data.organizerName, icon: Star },
                  { label: "Registered", value: String(totalParticipants), icon: Users },
                  { label: "Distance", value: localizedEventDistanceLabel(categories.map((category) => category.distance).join(" / "), localeTag), icon: Route },
                  { label: "Entry", value: eventPriceLabel, icon: Ticket },
                ].map((item) => (
                  <div key={item.label} className="min-w-0 border-b border-r border-border/65 px-3 py-3 even:border-r-0">
                    <dt className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                      <item.icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                      {item.label}
                    </dt>
                    <dd className="mt-1 break-words text-sm font-bold leading-5 text-foreground">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="overflow-hidden rounded-2xl border border-border/75 bg-card shadow-soft" aria-labelledby="mobile-event-races-title">
              <div className="flex items-end justify-between gap-3 border-b border-border/70 px-4 py-3">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Choose a race</div>
                  <h2 id="mobile-event-races-title" className="mt-0.5 font-display text-lg font-black">Categories</h2>
                </div>
                <span className="text-xs font-semibold text-muted-foreground">{localizedEventDateLabel(data.dateLabel, localeTag)}</span>
              </div>
              <div className="divide-y divide-border/70">
                {categories.map((category) => (
                  <article key={category.slug} className="px-4 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-display text-base font-bold leading-tight">{category.name}</h3>
                        <SportBadge sportCode={category.sportCode} compact className="mt-1.5" />
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>{category.startLabel ?? "Start TBA"}</span>
                          <span>{localizedEventPriceLabel(category.price, localeTag)}</span>
                          <span>{category.participants} entered</span>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-display text-sm font-black">{localizedEventDistanceLabel(category.distance, localeTag)}</div>
                        <div className="mt-0.5 text-xs font-semibold text-primary">{category.elevation}</div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          openRaceInfo(category.slug);
                        }}
                        className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-semibold text-foreground transition-colors hover:border-primary/30 hover:text-primary"
                      >
                        Race details
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      {canRegister ? (
                        <Link
                          to={buildRegistrationPath({ eventSlug: data.slug, categorySlug: category.slug })}
                          className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-bold text-primary-foreground shadow-warm"
                        >
                          Register
                          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <MobileDetailDisclosure
              title="About this race"
              summary="Overview and public race labels"
              icon={Flag}
            >
              {data.subtitle.trim() && data.subtitle.trim() !== overviewPreviewText.trim() ? (
                <p className="font-semibold leading-6 text-foreground/85">{data.subtitle}</p>
              ) : null}
              <p className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground">{overviewPreviewText}</p>
              {data.informativeLabels?.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {data.informativeLabels.map((label) => (
                    <span key={label.id} className="rounded-full bg-primary/[0.08] px-2.5 py-1 text-[10px] font-bold text-primary">{label.name}</span>
                  ))}
                </div>
              ) : null}
            </MobileDetailDisclosure>

            <MobileDetailDisclosure
              title="Race-day essentials"
              summary={`${schedule.length} schedule items · directions and key locations`}
              icon={Navigation}
            >
              {infoWeatherDisplaySnapshot ? (
                <div className="mb-3 flex items-center gap-3 rounded-xl border border-border/70 bg-background/70 px-3 py-2.5">
                  <CloudSun className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-foreground">Current race-area weather</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {infoWeatherDisplaySnapshot.conditionLabel ?? "Forecast pending"}
                      {infoWeatherDisplaySnapshot.temp != null ? ` · ${infoWeatherDisplaySnapshot.temp}°` : ""}
                    </div>
                  </div>
                </div>
              ) : null}
              {schedule.length ? (
                <div className="divide-y divide-border/65">
                  {schedule.map((item) => (
                    <div key={`${item.time}-${item.label}`} className="flex items-center gap-3 py-2.5 first:pt-0">
                      <span className="w-14 shrink-0 font-display text-sm font-black text-primary">{item.time}</span>
                      <span className="text-sm font-medium text-foreground">{item.label}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">The organizer has not published the race schedule yet.</p>
              )}
              {logisticsLocations.length ? (
                <div className="mt-3 divide-y divide-border/65 rounded-xl border border-border/70">
                  {logisticsLocations.slice(0, 3).map((location) => {
                    const directionsHref = buildDirectionsHref(location.lat, location.lng) ?? buildMapsPinHref(location.lat, location.lng);
                    return (
                      <div key={location.id} className="flex items-center gap-3 px-3 py-2.5">
                        <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{location.label}</span>
                        {directionsHref ? (
                          <a href={directionsHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 rounded-full px-2 text-xs font-bold text-primary">
                            Go <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : selectedParkingDirectionsHref ? (
                <a href={selectedParkingDirectionsHref} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-full border border-primary/25 px-3 text-xs font-bold text-primary">
                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                  Open arrival directions
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              ) : null}
            </MobileDetailDisclosure>

            <MobileDetailDisclosure
              title="Organizer & documents"
              summary={`${data.organizerName} · ${eventDocuments.length} public document${eventDocuments.length === 1 ? "" : "s"}`}
              icon={FileText}
            >
              <div className="flex items-center gap-3">
                {data.organizerLogoImageUrl ? (
                  <img src={data.organizerLogoImageUrl} alt="" className="h-11 w-11 rounded-xl border border-border object-cover" />
                ) : (
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/[0.09] font-display text-sm font-black text-primary">
                    {data.organizerName.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0">
                  <div className="font-display text-sm font-bold">{data.organizerName}</div>
                  {data.organizerLocationLabel ? <div className="mt-0.5 text-xs text-muted-foreground">{data.organizerLocationLabel}</div> : null}
                </div>
              </div>
              {eventDocuments.length ? (
                <div className="mt-4 divide-y divide-border/65 rounded-xl border border-border/70">
                  {eventDocuments.map((document) => (
                    <div key={document.storagePath} className="flex items-center gap-2 px-3 py-2.5 text-xs font-semibold">
                      <FileText className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{document.title}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {data.organizerContactEmail ? <a href={`mailto:${data.organizerContactEmail}`} className="rounded-full border border-border px-3 py-2 text-xs font-semibold">Email</a> : null}
                {data.organizerContactPhone ? <a href={`tel:${data.organizerContactPhone}`} className="rounded-full border border-border px-3 py-2 text-xs font-semibold">Call</a> : null}
                {data.organizerWebsiteUrl ? <a href={data.organizerWebsiteUrl} target="_blank" rel="noopener noreferrer" className="rounded-full border border-border px-3 py-2 text-xs font-semibold">Organizer website</a> : null}
                <OrganizationSocialLinks
                  organization={data.organizer}
                  linkClassName="inline-flex items-center gap-2 rounded-full border border-border px-3 py-2 text-xs font-semibold"
                />
                {socialLinks.map((item) => (
                  <a key={item.label} href={item.href} target="_blank" rel="noopener noreferrer" className="rounded-full border border-border px-3 py-2 text-xs font-semibold">{item.label}</a>
                ))}
              </div>
            </MobileDetailDisclosure>
          </div>
        )}

        {activeTab === "Info" && (
          <div className="hidden gap-8 lg:grid xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] xl:items-start">
            <div className="space-y-6">
              <ScrollReveal>
                <section className="rounded-[32px] border border-border/70 bg-card p-6 shadow-[0_20px_70px_-34px_hsl(25_30%_12%_/_0.35)] md:p-8">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-primary">About the race</div>
                      <h2 className="mt-2 font-display text-3xl font-black leading-tight text-foreground">Race overview</h2>
                    </div>
                    <span className="rounded-full border border-primary/15 bg-primary/[0.07] px-3 py-1.5 text-[11px] font-bold text-primary">
                      {t("event.detail.racesCount", { count: categories.length })}
                    </span>
                  </div>
                  {data.subtitle.trim() && data.subtitle.trim() !== overviewPreviewText.trim() ? (
                    <p className="mt-5 max-w-3xl text-base font-semibold leading-7 text-foreground/85">
                      {data.subtitle}
                    </p>
                  ) : null}
                  <div className="mt-5 border-l-2 border-primary/35 pl-4">
                    <p className="max-w-none text-sm leading-7 text-muted-foreground md:text-[15px]">
                      {overviewPreviewText}
                    </p>
                  </div>
                </section>
              </ScrollReveal>

              {data.informativeLabels?.length ? (
                <ScrollReveal delay={0.08}>
                  <section className="rounded-[28px] border border-border/70 bg-card p-5 shadow-soft sm:p-6">
                    <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
                      Race labels
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {data.informativeLabels.map((label) => (
                        <span
                          key={label.id}
                          className="rounded-full border border-primary/20 bg-primary/[0.08] px-3 py-1.5 text-sm font-semibold text-primary"
                        >
                          {label.name}
                        </span>
                      ))}
                    </div>
                  </section>
                </ScrollReveal>
              ) : null}

              <ScrollReveal delay={0.1}>
                <div className="overflow-hidden rounded-[32px] border border-border/70 bg-card shadow-[0_20px_60px_-34px_hsl(25_30%_12%_/_0.35)]">
                  <div className="relative border-b border-border/60 p-6">
                    <div className="absolute inset-0 bg-gradient-to-r from-white/92 via-white/84 to-primary/[0.04] dark:from-raised dark:via-card/95 dark:to-primary/[0.08]" />
                    <div className="absolute inset-0 route-pattern opacity-30" />
                    <div className="relative flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Arrival map</div>
                        <h3 className="mt-2 font-display text-2xl font-black">Parking, bib pickup & start</h3>
                      </div>
                      <span className="rounded-full bg-primary/10 px-3 py-1 text-[11px] font-bold text-primary">
                        {t("event.detail.locationsCount", { count: logisticsMapLocations.length })}
                      </span>
                    </div>
                  </div>
                  <div className="p-4 sm:p-6">
                    {logisticsMapLocations.length ? (
                      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(17rem,0.9fr)]">
                        <div>
                          <DeferredEventLocationsMap events={logisticsMapLocations} routes={eventRaceRoutes} className="h-[360px]" />
                          {eventRaceRoutes.length ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {eventRaceRoutes.map((route) => (
                                <span key={route.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">
                                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: route.color }} />
                                  {route.label}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className="overflow-hidden rounded-[22px] border border-border/70 bg-background/65">
                          {[
                            {
                              type: "parking",
                              label: "Parking",
                              icon: MapPin,
                              note: "Park and follow race signs.",
                            },
                            {
                              type: "registration",
                              label: "Bib pickup",
                              icon: Tent,
                              note: "Collect your bib here.",
                            },
                            {
                              type: "start_zone",
                              label: "Start",
                              icon: Navigation,
                              note: "Be here 15 min early.",
                            },
                          ].map(({ type, label, icon: Icon, note }) => {
                            const location = logisticsLocations.find((item) => item.type === type);
                            const href = buildDirectionsHref(location?.lat, location?.lng);
                            if (!location) return null;
                            return (
                              <div key={type} className="flex items-center gap-3 border-b border-border/60 px-3 py-3 last:border-b-0">
                                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/[0.09] text-primary">
                                  <Icon className="h-4 w-4" />
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-bold text-foreground">{label}</div>
                                  <div className="mt-0.5 truncate text-[11px] font-medium text-foreground/65">{location.label}</div>
                                  <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{note}</p>
                                </div>
                                {href ? (
                                  <a
                                    href={href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={`Navigate to ${label}`}
                                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-primary/20 bg-card px-3 text-[11px] font-bold text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                                  >
                                    Go
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <EmptyState
                        title="Arrival map is not published yet."
                        description="Parking, registration, and start information are shared by all categories in this race."
                      />
                    )}
                  </div>
                </div>
              </ScrollReveal>

              {eventLifecycle !== "after" ? (
              <ScrollReveal delay={0.18}>
                <div className="overflow-hidden rounded-[32px] border border-border/70 bg-card shadow-[0_20px_60px_-34px_hsl(25_30%_12%_/_0.35)]">
                  <div className="relative border-b border-border/60 p-6">
                    <div className="absolute inset-0 bg-gradient-to-r from-white/92 via-white/84 to-primary/[0.04] dark:from-raised dark:via-card/95 dark:to-primary/[0.08]" />
                    <div className="absolute inset-0 route-pattern opacity-30" />
                    <div className="relative flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">{t("event.detail.weather")}</div>
                        <h3 className="mt-2 font-display text-2xl font-black">{t("event.detail.forecastTitle")}</h3>
                      </div>
                      {primaryWeatherTarget ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">
                          <MapPin className="h-3 w-3 text-primary" />
                          {primaryWeatherTarget.label}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="p-6">
                    {primaryWeatherTarget ? (
                      <div className={cn(
                        "grid gap-2 xl:items-stretch",
                        todayEventWeatherCard && upcomingEventForecastCards.length > 0 && "xl:min-h-[184px]",
                        todayEventWeatherCard && upcomingEventForecastCards.length > 0 && "xl:grid-cols-[minmax(0,0.96fr)_minmax(0,2.04fr)]",
                      )}>
                        {todayEventWeatherCard ? (() => {
                          const snapshot = todayEventWeatherCard.snapshot;
                          const weatherVariant = resolveEventWeatherVisualVariant(snapshot, true);
                          const iconSrc = weatherVariantIcons[weatherVariant];
                          const visuals = getEventWeatherCardVisuals(weatherVariant);
                          const isLoading = weatherQuery.isPending;
                          const isMock = todayEventWeatherCard.isMock;
                          const liveTimeLabel = formatEventWeatherTimeLabel(snapshot?.observationTime);
                          const precipitationLabel = snapshot?.precipitationProbability != null
                            ? `${snapshot.precipitationProbability}%`
                            : snapshot?.precipitationMm != null
                              ? `${snapshot.precipitationMm} mm`
                              : "—";
                          const windLabel = snapshot?.windKph != null ? `${snapshot.windKph} km/h` : "—";

                          return (
                            <div
                              key={todayEventWeatherCard.id}
                              className={cn(
                                "track-shell-muted-panel relative min-h-[158px] overflow-hidden px-3.5 py-3.5 sm:min-h-[164px]",
                                visuals.shellClassName,
                                "dark:border-border/80 dark:bg-card",
                                isMock
                                  ? "border-border/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(247,244,239,0.92))] shadow-soft dark:bg-[linear-gradient(180deg,hsl(var(--raised)),hsl(var(--card)))]"
                                  : "border-primary/18 shadow-[0_20px_44px_rgba(25,20,12,0.055)] ring-1 ring-primary/6",
                                upcomingEventForecastCards.length > 0 && "xl:h-full xl:min-h-0",
                              )}
                              style={isMock ? undefined : getEventWeatherBackdropStyle(snapshot, weatherVariant)}
                            >
                              <div className={cn("pointer-events-none absolute inset-x-0 top-0 h-[3px]", visuals.accentBarClassName)} />
                              <div className={cn("pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full blur-3xl", visuals.orbClassName)} />
                              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.18),rgba(255,255,255,0.05)_58%,rgba(255,255,255,0.02))] dark:bg-[linear-gradient(180deg,hsl(var(--raised)),hsl(var(--card)))]" />
                              <div className="relative flex h-full flex-col">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className={cn(
                                        "rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em]",
                                        isMock ? "border-border/70 bg-white/72 text-muted-foreground dark:bg-raised" : visuals.badgeClassName,
                                        "dark:border-border/80 dark:bg-raised/90",
                                      )}>
                                        {isMock ? "Weather preview" : todayEventWeatherCard.shortLabel}
                                      </span>
                                      <span className="text-[10px] text-muted-foreground">
                                        {formatEventWeatherDateLabel(todayEventWeatherCard.date)}
                                      </span>
                                    </div>
                                  </div>
                                  <div
                                    className={cn(
                                      "flex h-16 w-16 items-center justify-center rounded-[20px] border border-white/72 bg-white/38 shadow-[0_12px_28px_rgba(25,20,12,0.06)] backdrop-blur-sm dark:border-border dark:bg-raised/80 dark:shadow-earth",
                                      !isMock && visuals.iconClassName,
                                      "dark:text-muted-foreground",
                                    )}
                                  >
                                    {snapshot || !isLoading ? (
                                      <img
                                        src={iconSrc}
                                        alt=""
                                        aria-hidden="true"
                                        className={cn(
                                          "h-14 w-14 saturate-[1.08] contrast-[1.04] drop-shadow-[0_10px_20px_rgba(255,255,255,0.16)]",
                                          isMock && "opacity-75",
                                        )}
                                      />
                                    ) : (
                                      <Loader2 className="h-5 w-5 animate-spin" />
                                    )}
                                  </div>
                                </div>

                                <div className="mt-4 flex items-end justify-between gap-3">
                                  <div className="font-display text-[30px] font-bold leading-none text-foreground">
                                    {snapshot?.temp != null ? `${snapshot.temp}°` : isLoading ? "…" : "—"}
                                  </div>
                                  {eventWeatherMinTemp != null && eventWeatherMaxTemp != null ? (
                                    <div className="text-right">
                                      <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                                        Week
                                      </div>
                                      <div className={cn("mt-1 text-[12px] font-semibold", visuals.textClassName, "dark:text-secondary-foreground")}>
                                        {eventWeatherMinTemp}° — {eventWeatherMaxTemp}°
                                      </div>
                                    </div>
                                  ) : null}
                                </div>

                                <div className={cn("mt-2.5 text-[13px] font-semibold", visuals.textClassName, "dark:text-secondary-foreground")}>
                                  {snapshot?.conditionLabel ?? (isLoading ? "Loading conditions" : "Awaiting forecast")}
                                </div>
                                <div className="mt-1 text-[10px] text-foreground/60">
                                  {isLoading
                                    ? "Preparing race weather detail…"
                                    : isMock
                                      ? "Using the route forecast while the live read reconnects."
                                      : liveTimeLabel
                                        ? t("event.detail.weatherUpdated", { time: liveTimeLabel })
                                        : getEventCompactWeatherNote(snapshot, weatherVariant)}
                                </div>

                                <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
                                  <div className="inline-flex items-center gap-1.5">
                                    <Droplets className="h-3 w-3 text-primary" />
                                    {precipitationLabel}
                                  </div>
                                  <div className="inline-flex items-center justify-end gap-1.5">
                                    <Wind className="h-3 w-3 text-primary" />
                                    {windLabel}
                                  </div>
                                </div>

                                <div className="mt-auto pt-2.5">
                                  <div className="h-1.5 overflow-hidden rounded-full bg-white/78 dark:bg-background/70">
                                    <div
                                      className={cn("h-full rounded-full", visuals.accentBarClassName)}
                                      style={{ width: getEventWeatherTemperatureProgress(snapshot?.temp, eventWeatherMinTemp, eventWeatherMaxTemp) }}
                                    />
                                  </div>
                                  <div className="mt-1.5 flex items-center justify-between text-[9px] text-muted-foreground">
                                    <span>{eventWeatherMinTemp != null ? `${eventWeatherMinTemp}°` : "—"}</span>
                                    <span>{eventWeatherMaxTemp != null ? `${eventWeatherMaxTemp}°` : "—"}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })() : null}

                        {upcomingEventForecastCards.length > 0 ? (
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:h-full xl:grid-cols-3 xl:grid-rows-2">
                            {upcomingEventForecastCards.map((entry) => {
                              const snapshot = entry.snapshot;
                              const weatherVariant = resolveEventWeatherVisualVariant(snapshot, false);
                              const iconSrc = weatherVariantIcons[weatherVariant];
                              const visuals = getEventWeatherCardVisuals(weatherVariant);
                              const isLoading = forecastWeatherQuery.isPending;
                              const isMock = entry.isMock;
                              const precipitationLabel = snapshot?.precipitationProbability != null
                                ? `${snapshot.precipitationProbability}%`
                                : snapshot?.precipitationMm != null
                                  ? `${snapshot.precipitationMm} mm`
                                  : "—";
                              const windLabel = snapshot?.windKph != null ? `${snapshot.windKph} km/h` : "—";

                              return (
                                <div
                                  key={entry.id}
                                  className={cn(
                                    "track-shell-muted-panel relative min-h-[88px] overflow-hidden px-2.5 py-2.5 shadow-[0_5px_14px_rgba(25,20,12,0.025)] xl:h-full xl:min-h-0",
                                    isMock ? "border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(246,242,236,0.84))] dark:bg-[linear-gradient(180deg,hsl(var(--raised)),hsl(var(--card)))]" : visuals.shellClassName,
                                    "dark:border-border/80 dark:bg-card",
                                  )}
                                  style={isMock ? undefined : getEventWeatherBackdropStyle(snapshot, weatherVariant)}
                                >
                                  <div className={cn("pointer-events-none absolute inset-x-0 top-0 h-[2px]", isMock ? "bg-slate-300/70" : visuals.accentBarClassName)} />
                                  <div className={cn("pointer-events-none absolute -right-5 -top-5 h-16 w-16 rounded-full blur-2xl", isMock ? "bg-slate-200/40" : visuals.orbClassName)} />
                                  <div className={cn(
                                    "pointer-events-none absolute inset-0",
                                    isMock
                                      ? "bg-[linear-gradient(180deg,rgba(255,255,255,0.70),rgba(255,255,255,0.28)_62%,rgba(255,255,255,0.12))]"
                                      : "bg-[linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.04)_62%,rgba(255,255,255,0.02))]",
                                    "dark:bg-[linear-gradient(180deg,hsl(var(--raised)),hsl(var(--card)))]",
                                  )} />
                                  <div className="relative flex h-full flex-col justify-between">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                            {entry.shortLabel}
                                          </span>
                                          <span className="text-[9px] text-muted-foreground">
                                            {formatEventWeatherDateLabel(entry.date)}
                                          </span>
                                        </div>
                                        <div className="mt-1.5 flex items-end gap-1.5">
                                          <div className="font-display text-[21px] font-bold leading-none text-foreground">
                                            {snapshot?.temp != null ? `${snapshot.temp}°` : isLoading ? "…" : "—"}
                                          </div>
                                          <div className={cn("min-w-0 truncate pb-0.5 text-[10px] font-medium", isMock ? "text-muted-foreground" : visuals.textClassName, "dark:text-secondary-foreground")}>
                                            {isMock ? "Preview" : snapshot?.conditionLabel ?? (isLoading ? "Loading" : "Forecast")}
                                          </div>
                                        </div>
                                      </div>
                                      <div
                                        className={cn(
                                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-white/78 bg-white/52 shadow-[0_8px_18px_rgba(25,20,12,0.05)] backdrop-blur-sm dark:border-border dark:bg-raised/80 dark:shadow-earth",
                                          !isMock && visuals.iconClassName,
                                          "dark:text-muted-foreground",
                                        )}
                                      >
                                        {snapshot || !isLoading ? (
                                          <img
                                            src={iconSrc}
                                            alt=""
                                            aria-hidden="true"
                                            className={cn(
                                              "h-9 w-9 saturate-[1.15] contrast-110 drop-shadow-[0_8px_14px_rgba(255,255,255,0.14)]",
                                              isMock && "opacity-75",
                                            )}
                                          />
                                        ) : (
                                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        )}
                                      </div>
                                    </div>

                                    <div className="mt-1.5 flex items-center justify-between gap-2 text-[9px] text-muted-foreground">
                                      <span className="inline-flex min-w-0 items-center gap-1">
                                        <Droplets className="h-2.5 w-2.5 shrink-0 text-primary" />
                                        <span className="truncate">{precipitationLabel}</span>
                                      </span>
                                      <span className="inline-flex min-w-0 items-center gap-1">
                                        <Wind className="h-2.5 w-2.5 shrink-0 text-primary" />
                                        <span className="truncate">{windLabel}</span>
                                      </span>
                                    </div>

                                    <div className="mt-1.5">
                                      <div className="h-1 overflow-hidden rounded-full bg-white/80 dark:bg-background/70">
                                        <div
                                          className={cn("h-full rounded-full", isMock ? "bg-slate-400/75" : visuals.accentBarClassName)}
                                          style={{ width: getEventWeatherTemperatureProgress(snapshot?.temp, eventWeatherMinTemp, eventWeatherMaxTemp) }}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                        Weather is unavailable for this race.
                      </div>
                    )}
                  </div>
                </div>
              </ScrollReveal>
              ) : null}

              {data.gallery.length ? <ScrollReveal delay={0.31}>
                <div className="overflow-hidden rounded-[32px] border border-border/70 bg-card shadow-[0_20px_60px_-34px_hsl(25_30%_12%_/_0.35)]">
                  <div className="border-b border-border/60 bg-white p-6 dark:bg-raised/55">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Album preview</div>
                        <h3 className="mt-2 font-display text-2xl font-black">Race-day photos</h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab("Gallery")}
                        className="rounded-full bg-primary/10 px-3 py-1 text-[11px] font-bold text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                      >
                        View all {data.gallery.length}
                      </button>
                    </div>
                  </div>
                  <div className="p-6">
                    <div className="rounded-[1.4rem] border border-border bg-background/70 p-3 sm:p-4">
                      <DeferredEventGalleryMosaic items={data.gallery} mode="preview" limit={7} />
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">
                      {Math.min(data.gallery.length, 7)} photo{Math.min(data.gallery.length, 7) === 1 ? "" : "s"} from this race.
                    </p>
                  </div>
                </div>
              </ScrollReveal> : null}

            </div>

            <div className="space-y-4">
              <ScrollReveal delay={0.06}>
                <div className="flex items-center justify-between gap-3 px-1">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">{t("event.detail.categories")}</div>
                    <h3 className="mt-2 font-display text-2xl font-black">
                      {t(eventLifecycle === "after" ? "event.detail.exploreRaces" : "event.detail.chooseCategory")}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => openRaceInfo(selectedCategory?.slug ?? categories[0]?.slug ?? "")}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    {t("event.detail.viewRaces")}
                  </button>
                </div>
              </ScrollReveal>

              <ScrollReveal delay={0.1}>
                <div className="grid gap-4">
                  {categories.map((category) => (
                    <div key={category.slug} className="space-y-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (canRegister) {
                            window.location.assign(buildRegistrationPath({ eventSlug: data.slug, categorySlug: category.slug }));
                            return;
                          }
                          openRaceInfo(category.slug);
                        }}
                        className="group relative isolate min-h-[250px] w-full overflow-hidden rounded-[28px] border border-border/70 bg-card text-left shadow-[0_18px_45px_-28px_hsl(25_30%_12%_/_0.35)] transition-all duration-300 hover:-translate-y-1 hover:border-primary/20 hover:shadow-[0_24px_56px_-28px_hsl(25_30%_12%_/_0.42)]"
                      >
                      <div className="absolute inset-0 overflow-hidden rounded-[28px]">
                        <EventContentImage
                          src={categoryPreviewImageBySlug.get(category.slug) ?? data.coverImageUrl ?? featuredEventHeroImage}
                          alt={category.name}
                          sizes="(min-width: 1280px) 38vw, (min-width: 1024px) 42vw, 100vw"
                          className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 will-change-transform group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-gradient-to-br from-[hsl(18_42%_8%_/_0.12)] via-[hsl(215_18%_10%_/_0.38)] to-[hsl(215_18%_9%_/_0.88)]" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/76 via-black/24 to-transparent" />
                        <div className="absolute inset-0 grain-overlay opacity-30" />
                        <div className="absolute inset-0 topo-pattern opacity-50" />
                      </div>

                      <div className="relative z-10 flex h-full flex-col justify-between p-5 text-white">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <span className={cn(
                              "inline-flex rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.18em]",
                              eventLifecycle === "after"
                                ? "border-primary/45 bg-primary text-primary-foreground shadow-warm"
                                : "border-[rgba(110,231,183,0.96)] bg-[rgba(5,150,105,0.96)] text-white shadow-[0_16px_34px_-18px_rgba(5,150,105,0.98)] dark:bg-[rgba(4,120,87,0.98)] dark:shadow-[0_16px_34px_-18px_rgba(4,120,87,0.98)]",
                            )}>
                              {category.statusLabel ?? data.statusLabel}
                            </span>
                            <h4 className="mt-3 font-display text-[1.7rem] font-black leading-[1.02] text-white drop-shadow-[0_6px_18px_rgba(0,0,0,0.45)]">
                              {category.name}
                            </h4>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-2">
                            <div className="flex min-w-[5.5rem] flex-col items-center justify-center rounded-[26px] border border-primary/30 bg-black/30 px-4 py-3 text-center text-white shadow-[0_16px_34px_-20px_rgba(0,0,0,0.72)] backdrop-blur-md">
                              <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/70">{infoEventCalendarBits.month}</div>
                              <div className="mt-1 font-display text-4xl font-black leading-none text-white">{infoEventCalendarBits.day}</div>
                            </div>
                          </div>
                        </div>

                        <div className="mt-5 flex flex-1 flex-col justify-end">
                          <div className="ml-auto">
                            <span className={premiumCardActionPillClass}>
                              {canRegister ? t("event.card.register") : t("event.detail.viewRace")}
                              <ArrowRight className="pointer-events-none absolute right-3 h-4 w-4 opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:opacity-100" />
                            </span>
                          </div>

                          <div className="mt-4 flex flex-wrap justify-center gap-2">
                            <span className={premiumGlassPillClass}>
                              <Flag className="h-3.5 w-3.5 text-trail-amber" />
                              {localizedEventDistanceLabel(category.distance, localeTag)}
                            </span>
                            <span className={premiumGlassPillClass}>
                              <Mountain className="h-3.5 w-3.5 text-trail-amber" />
                              {category.elevation}
                            </span>
                            <span className={premiumGlassPillClass}>
                              <Users className="h-3.5 w-3.5 text-trail-amber" />
                              {category.participants}/{category.maxParticipants}
                            </span>
                            <span className={premiumGlassPillClass}>
                              {locale !== "hr" ? <span className="text-[0.95rem] font-black leading-none text-trail-amber">€</span> : null}
                              <span>{locale === "hr" ? localizedEventPriceLabel(category.price, localeTag) : category.price.replace(/^€/, "")}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                      </button>
                      {category.linkedTrackSlug && category.linkedTrackName ? (
                        <Link
                          to={`/tracks/${category.linkedTrackSlug}`}
                          className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card px-3 py-2 text-xs font-semibold text-primary transition-colors hover:border-primary/35 hover:bg-primary/5"
                        >
                          <Route className="h-3.5 w-3.5" />
                          {category.linkedTrackName}
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </Link>
                      ) : null}
                    </div>
                  ))}
                </div>
              </ScrollReveal>

              {schedule.length ? <ScrollReveal delay={0.14}>
                <div className="rounded-[24px] border border-border/70 bg-background/85 p-4 shadow-soft">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    <Route className="h-3.5 w-3.5 text-trail-amber" />
                    {t("event.detail.timeline")}
                  </div>
                  <div className="mt-2 text-base font-semibold text-foreground">
                    {t("event.detail.scheduleCount", { count: schedule.length })}
                  </div>
                  <div className="mt-3 grid gap-1.5">
                    {schedule.map((item, itemIndex) => (
                      <div
                        key={`${item.time}-${item.label}`}
                        className="group/timeline flex items-center gap-2.5 py-0.5"
                      >
                        <div className="flex h-11 w-2 shrink-0 items-center justify-center">
                          <div
                            className={`w-1.5 rounded-full ${
                              item.tone === "primary"
                                ? "h-11 bg-primary"
                                : item.tone === "accent"
                                  ? "h-11 border border-primary bg-primary/12"
                                  : "h-11 bg-border/85"
                            }`}
                          />
                        </div>
                        <div className="min-w-[4.4rem] rounded-[12px] border border-primary/14 bg-primary/[0.07] px-2 py-1.5 text-center text-primary shadow-none">
                          <div className="text-[7px] font-bold uppercase tracking-[0.18em] text-primary">{t("event.detail.scheduleSlot", { number: String(itemIndex + 1).padStart(2, "0") })}</div>
                          <div className="mt-0.5 block font-display text-[0.92rem] font-black leading-none text-primary">{item.time}</div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                            {t(item.tone === "primary" ? "event.detail.raceStart" : item.tone === "accent" ? "event.detail.keyMoment" : "event.detail.operations")}
                          </div>
                          <div className="mt-0.5 text-[13px] font-semibold leading-4 text-foreground">
                            {item.label}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </ScrollReveal> : null}

              <ScrollReveal delay={0.08} direction="right" distance={16}>
                <div className="overflow-hidden rounded-[28px] border border-border/70 bg-card shadow-[0_18px_48px_-30px_hsl(25_30%_12%_/_0.32)]">
                  <div className="relative border-b border-border/60 p-5">
                    <div className="absolute inset-0 bg-gradient-to-r from-white/92 via-white/84 to-primary/[0.04] dark:from-raised dark:via-card/95 dark:to-primary/[0.08]" />
                    <div className="absolute inset-0 route-pattern opacity-30" />
                    <h3 className="relative font-display text-sm font-bold uppercase tracking-[0.22em] text-muted-foreground">Organizer</h3>
                  </div>
                  <div className="space-y-5 p-5">
                    <div className="flex items-start gap-3">
                      {data.organizerLogoImageUrl ? (
                        <img
                          src={data.organizerLogoImageUrl}
                          alt={`${data.organizerName} logo`}
                          className="h-14 w-14 shrink-0 rounded-2xl border border-border/70 bg-background object-cover"
                        />
                      ) : (
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-primary/15 bg-primary/[0.08] font-display text-lg font-black text-primary">
                          {data.organizerName.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-display text-base font-black text-foreground">{data.organizerName}</div>
                        {data.organizerLocationLabel ? (
                          <div className="mt-1 flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
                            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                            <span>{locale === "hr" ? data.organizerLocationLabel.replace(/, Croatia$/, ", Hrvatska") : data.organizerLocationLabel}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {data.organizerDescription ? (
                      <p className="text-sm leading-6 text-muted-foreground">{data.organizerDescription}</p>
                    ) : null}

                    {data.organizerContactEmail || data.organizerContactPhone || data.organizerWebsiteUrl || organizationHasSocialLinks(data.organizer) ? (
                      <div>
                        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Organizer contact &amp; social</div>
                        <div className="flex flex-wrap gap-2">
                          {data.organizerContactEmail ? (
                            <a href={`mailto:${data.organizerContactEmail}`} className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary">
                              <Mail className="h-3.5 w-3.5 text-primary" />
                              {data.organizerContactEmail}
                            </a>
                          ) : null}
                          {data.organizerContactPhone ? (
                            <a href={`tel:${data.organizerContactPhone}`} className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary">
                              <Phone className="h-3.5 w-3.5 text-primary" />
                              {data.organizerContactPhone}
                            </a>
                          ) : null}
                          {data.organizerWebsiteUrl ? (
                            <a href={data.organizerWebsiteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary">
                              <Globe className="h-3.5 w-3.5 text-primary" />
                              Organizer website
                              <ExternalLink className="h-3 w-3 text-muted-foreground" />
                            </a>
                          ) : null}
                          <OrganizationSocialLinks
                            organization={data.organizer}
                            linkClassName="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
                            showExternalIcon
                          />
                        </div>
                      </div>
                    ) : null}

                    <div>
                      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Race links</div>
                      {socialLinks.length ? (
                        <div className="flex flex-wrap gap-2">
                          {socialLinks.map((item) => (
                            <a
                              key={item.label}
                              href={item.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex w-auto items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
                            >
                              <item.icon className="h-3.5 w-3.5 text-primary" />
                              <span>{item.label}</span>
                              <ExternalLink className="h-3 w-3 text-muted-foreground" />
                            </a>
                          ))}
                        </div>
                      ) : (
                        <EmptyState
                          title={t("event.detail.linksEmpty")}
                          description={t("event.detail.linksEmptyDescription")}
                        />
                      )}
                    </div>

                  </div>
                </div>
              </ScrollReveal>

              <ScrollReveal delay={0.12} direction="right" distance={16}>
                <div className="overflow-hidden rounded-[28px] border border-border/70 bg-card shadow-[0_18px_48px_-30px_hsl(25_30%_12%_/_0.32)]">
                  <div className="relative border-b border-border/60 p-5">
                    <div className="absolute inset-0 bg-gradient-to-r from-white/92 via-white/84 to-primary/[0.04] dark:from-raised dark:via-card/95 dark:to-primary/[0.08]" />
                    <div className="absolute inset-0 route-pattern opacity-30" />
                    <h3 className="relative font-display text-sm font-bold uppercase tracking-[0.22em] text-muted-foreground">Documents</h3>
                  </div>
                  <div className="p-5">
                    {eventDocuments.length ? (
                      <div className="space-y-2">
                        {eventDocuments.map((document) => (
                          <div
                            key={document.storagePath}
                            className="flex w-full items-center gap-2 rounded-xl bg-muted/40 px-4 py-2.5 text-xs font-medium text-foreground"
                          >
                            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                            {document.title}
                            <span className="ml-auto rounded-full bg-background px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              Published
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-border bg-background/50 p-5 text-sm text-muted-foreground">
                        No public documents.
                      </div>
                    )}
                  </div>
                </div>
              </ScrollReveal>

              <ScrollReveal delay={0.16} direction="right" distance={16}>
                <div className="overflow-hidden rounded-[28px] border border-border/70 bg-card shadow-[0_18px_48px_-30px_hsl(25_30%_12%_/_0.32)]">
                  <div className="relative border-b border-border/60 p-5">
                    <div className="absolute inset-0 bg-gradient-to-r from-white/92 via-white/84 to-primary/[0.04] dark:from-raised dark:via-card/95 dark:to-primary/[0.08]" />
                    <div className="absolute inset-0 route-pattern opacity-30" />
                    <h3 className="relative font-display text-sm font-bold uppercase tracking-[0.22em] text-muted-foreground">Previous Editions</h3>
                  </div>
                  <div className="p-5">
                    {data.previousEditions.length ? (
                      <div className="space-y-2 text-sm">
                        {data.previousEditions.map((edition) => (
                          <Link
                            key={edition.slug}
                            to={`/events/${edition.slug}`}
                            className="flex items-center justify-between rounded-lg px-2 py-1.5 text-muted-foreground transition-colors hover:bg-primary/[0.04] hover:text-primary"
                          >
                            <span>{edition.label}</span>
                            <ChevronRight className="h-3 w-3" />
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-border bg-background/50 p-5 text-sm text-muted-foreground">
                        Earlier editions will appear here once archived.
                      </div>
                    )}
                  </div>
                </div>
              </ScrollReveal>
            </div>
          </div>
        )}

        {activeTab === "Rules" ? (
          <div className="space-y-6">
            <ScrollReveal>
              <section
                aria-labelledby="event-organizer-rules-title"
                className="overflow-hidden rounded-[28px] border border-primary/20 bg-card shadow-soft"
              >
                <div className="border-b border-border/70 bg-primary/[0.045] p-5 sm:p-6">
                  <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                    <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                    Official race guidance
                  </div>
                  <h2 id="event-organizer-rules-title" className="mt-2 font-display text-2xl font-black sm:text-3xl">
                    Organizer rules
                  </h2>
                </div>
                <div className="p-5 sm:p-6">
                  {data.organizerRules?.trim() ? (
                    <p
                      className="whitespace-pre-line text-sm leading-7 text-muted-foreground sm:text-[15px]"
                      data-i18n-skip
                      translate="no"
                    >
                      {data.organizerRules.trim()}
                    </p>
                  ) : (
                    <p className="text-sm leading-6 text-muted-foreground">
                      The organizer has not published additional race rules yet.
                    </p>
                  )}

                  {eventDocuments.length ? (
                    <div className="mt-6 border-t border-border/70 pt-5">
                      <h3 className="text-sm font-bold">Published documents</h3>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {eventDocuments.map((document) => (
                          <div key={document.storagePath} className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/60 px-3 py-2.5 text-sm font-medium">
                            <FileText className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                            <span className="min-w-0 truncate">{document.title}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </section>
            </ScrollReveal>

            <ScrollReveal delay={0.08}>
              <RulesSafetyShowcase items={rulesSafetyItems} />
            </ScrollReveal>
          </div>
        ) : null}

        {activeTab === "Gallery" && (
          <div className="space-y-6">
            <ScrollReveal>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-primary">
                    <Images className="h-4 w-4" />
                    Race gallery
                  </div>
                  <h2 className="mt-2 font-display text-3xl font-black text-foreground">{data.name} media</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    Photos and videos published by the organizer.
                  </p>
                </div>
                <span className="rounded-full border border-primary/15 bg-primary/[0.07] px-3 py-1.5 text-xs font-bold text-primary">
                  {data.gallery.length} photos · {data.videos.length} video{data.videos.length === 1 ? "" : "s"}
                </span>
              </div>
            </ScrollReveal>

            {data.videos.length ? (
              <ScrollReveal delay={0.04}>
                <div className="grid gap-4 lg:grid-cols-2">
                  {data.videos.map((video) => {
                    const youtubeEmbedUrl = getYouTubeEmbedUrl(video.url);
                    return (
                      <article key={video.id} className="overflow-hidden rounded-[28px] border border-border bg-card shadow-soft">
                        <div className="aspect-video bg-black">
                          {youtubeEmbedUrl ? (
                            <iframe
                              src={youtubeEmbedUrl}
                              title={video.title}
                              className="h-full w-full"
                              loading="lazy"
                              referrerPolicy="strict-origin-when-cross-origin"
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                              allowFullScreen
                            />
                          ) : (
                            <video controls playsInline preload="metadata" poster={video.posterUrl ?? undefined} className="h-full w-full object-cover">
                              <source src={video.url} />
                            </video>
                          )}
                        </div>
                        <div className="flex items-center gap-2 px-4 py-3 text-sm font-semibold text-foreground">
                          <Play className="h-4 w-4 text-primary" />
                          {video.title}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </ScrollReveal>
            ) : null}

            {data.gallery.length ? (
              <ScrollReveal delay={0.08} amount={0.01}>
                <DeferredEventGalleryMosaic items={data.gallery} mode="gallery" />
              </ScrollReveal>
            ) : null}
          </div>
        )}

        {isCategoryView && (
          <div className="space-y-4 lg:hidden">
            <section className="overflow-hidden rounded-2xl border border-border/75 bg-card shadow-soft">
              <div className="relative min-h-[166px] overflow-hidden p-4">
                <div className="absolute inset-0 route-pattern opacity-35" />
                <div className="relative">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/[0.09] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.18em] text-primary">
                    <Route className="h-3.5 w-3.5" aria-hidden="true" />
                    Selected race
                  </span>
                  <h2 className="mt-3 font-display text-2xl font-black leading-tight">{selectedCategory?.name ?? "Race"}</h2>
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
                    {selectedTrack?.overview || selectedCategorySummary}
                  </p>
                </div>
              </div>
              <dl className="grid grid-cols-3 border-t border-border/70">
                {[
                  { label: "Distance", value: localizedEventDistanceLabel(selectedCategory?.distance ?? "TBA", localeTag), icon: Flag },
                  { label: "Climb", value: selectedCategory?.elevation ?? "TBA", icon: Mountain },
                  { label: "Start", value: selectedCategory?.startLabel ?? "TBA", icon: Calendar },
                  { label: "Fee", value: localizedEventPriceLabel(selectedCategory?.price ?? "TBA", localeTag), icon: Ticket },
                  { label: "Entered", value: `${selectedCategory?.participants ?? 0}/${selectedCategory?.maxParticipants ?? 0}`, icon: Users },
                  { label: "Cutoff", value: selectedCategory?.cutoff ?? "TBA", icon: Clock3 },
                ].map((fact) => (
                  <div key={fact.label} className="min-w-0 border-b border-r border-border/65 px-2.5 py-3 text-center last:border-r-0">
                    <dt className="flex items-center justify-center gap-1 text-[8px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                      <fact.icon className="h-3 w-3 text-primary" aria-hidden="true" />
                      {fact.label}
                    </dt>
                    <dd className="mt-1 truncate text-xs font-bold">{fact.value}</dd>
                  </div>
                ))}
              </dl>
              <RaceFeePeriods timezone={data.timezone} periods={selectedCategory?.feePeriods} currency={selectedCategory?.feeCurrency} startAt={selectedCategory?.startAtIso} />
              <div className="flex gap-2 p-3">
                {canRegister ? (
                  <Link to={selectedRaceRegisterHref} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-warm">
                    Register
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    activateEventTab({ key: "Registrations", label: "Registrations", type: "static" });
                  }}
                  className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-border px-4 text-sm font-semibold text-foreground"
                >
                  Registrations
                </button>
              </div>
            </section>

            <MobileDetailDisclosure
              title="Route & elevation"
              summary={t("event.detail.routeSummary", { surface: selectedCategorySurfaceLabel, count: routeCheckpoints.length })}
              icon={Route}
            >
              <p className="text-sm leading-6 text-muted-foreground">{selectedTrack?.overview || selectedCategorySummary}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-border/70 bg-background/60 px-3 py-2.5">
                  <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Surface</div>
                  <div className="mt-1 text-xs font-bold">{selectedCategorySurfaceLabel}</div>
                </div>
                <div className="rounded-xl border border-border/70 bg-background/60 px-3 py-2.5">
                  <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Water points</div>
                  <div className="mt-1 text-xs font-bold">{selectedTrack?.waterPoints ?? 0}</div>
                </div>
              </div>
              {selectedCategory?.linkedTrackSlug ? (
                <Link to={`/tracks/${selectedCategory.linkedTrackSlug}`} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-full border border-primary/25 px-3 text-xs font-bold text-primary">
                  Open full route map & profile
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              ) : null}
            </MobileDetailDisclosure>

            <MobileDetailDisclosure
              title="Race-day flow"
              summary={t("event.detail.scheduleSummary", { count: categoryTimeline.length, checkpoints: raceCheckpoints.length })}
              icon={Navigation}
            >
              <div className="divide-y divide-border/65">
                {categoryTimeline.map((item) => (
                  <div key={`${item.time}-${item.label}`} className="flex items-center gap-3 py-2.5 first:pt-0">
                    <span className="w-14 shrink-0 font-display text-xs font-black text-primary">{item.time}</span>
                    <span className="text-sm font-medium">{item.label}</span>
                  </div>
                ))}
              </div>
              {raceCheckpoints.length ? (
                <div className="mt-3 divide-y divide-border/65 rounded-xl border border-border/70">
                  {raceCheckpoints.map((checkpoint) => (
                    <div key={`${checkpoint.name}-${checkpoint.km ?? "event"}`} className="flex items-center gap-2 px-3 py-2.5 text-xs">
                      <Flag className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate font-semibold">{eventPointName(checkpoint.name, locale)}</span>
                      <span className="shrink-0 text-muted-foreground">{checkpoint.km != null ? `km ${formatNumber(checkpoint.km, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "Race point"}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </MobileDetailDisclosure>

            <MobileDetailDisclosure
              title="Eligibility & records"
              summary={`${selectedCategoryEligibility.ageLabel} · ${selectedCategoryEligibility.genderLabel}`}
              icon={Trophy}
            >
              {selectedCategoryEligibility.note ? <p className="text-sm leading-6 text-muted-foreground">{selectedCategoryEligibility.note}</p> : null}
              {selectedTrackRecords.length ? (
                <div className="mt-3 divide-y divide-border/65 rounded-xl border border-border/70">
                  {selectedTrackRecords.map((record) => (
                    <div key={`${record.name}-${record.rank}`} className="flex items-center gap-3 px-3 py-2.5 text-xs">
                      <span className="font-display font-black text-primary">#{record.rank}</span>
                      <span className="min-w-0 flex-1 truncate font-semibold">{record.name}</span>
                      <span className="font-mono font-bold">{record.time}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">Route records will appear after official results are published.</p>
              )}
            </MobileDetailDisclosure>
          </div>
        )}

        {isCategoryView && (
          <div className="hidden gap-6 lg:grid xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] xl:items-start">
            <div className="space-y-6">
              <ScrollReveal>
                <div className="relative overflow-hidden rounded-[34px] border border-border/70 bg-card shadow-[0_20px_70px_-34px_hsl(25_30%_12%_/_0.35)]">
                  <div className="absolute inset-0 bg-gradient-to-br from-white/70 via-transparent to-primary/[0.03] dark:from-white/[0.025] dark:via-transparent dark:to-primary/[0.06]" />
                  <div className="absolute inset-0 route-pattern opacity-45" />
                  <div className="relative z-10 flex min-h-[260px] flex-col p-6 md:p-8">
                    <div className="max-w-2xl">
                      <span className={premiumMarkerPillClass}>
                        <Route className="h-3.5 w-3.5" />
                        Category route
                      </span>
                      <h2 className="mt-3 font-display text-3xl font-black leading-[1.04] text-foreground md:text-[3rem]">
                        {selectedCategory?.name ?? "Category"}
                      </h2>
                      <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground md:text-base">
                        {selectedTrack?.overview || selectedCategorySummary}
                      </p>
                    </div>

                  </div>
                </div>
              </ScrollReveal>

              <ScrollReveal delay={0.1}>
                {routeTrackPoints.length > 1 ? (
                  <div className="overflow-hidden rounded-[30px] border border-border/70 bg-card shadow-[0_18px_48px_-30px_hsl(25_30%_12%_/_0.34)]">
                      <div className="relative border-b border-border/60 p-5">
                        <div className="absolute inset-0 bg-gradient-to-r from-white/92 via-white/84 to-primary/[0.04] dark:from-raised dark:via-card/95 dark:to-primary/[0.08]" />
                        <div className="absolute inset-0 topo-pattern opacity-35" />
                        <div className="relative flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Route layer</div>
                            <h3 className="mt-2 font-display text-xl font-black text-foreground">Full route map</h3>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card px-3 py-2 text-[11px] font-semibold text-foreground shadow-soft">
                              <Route className="h-3.5 w-3.5 text-primary" />
                              {t("event.detail.pointsCount", { count: routeCheckpoints.length })}
                            </span>
                            <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card px-3 py-2 text-[11px] font-semibold text-foreground shadow-soft">
                              <Mountain className="h-3.5 w-3.5 text-primary" />
                              {localizedEventDistanceLabel(selectedCategory?.distance ?? "Distance TBA", localeTag)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <Suspense fallback={<div aria-hidden="true" className="h-[520px] animate-pulse bg-muted/35" />}>
                        <LazyTrackMap
                          trackPoints={routeTrackPoints}
                          checkpoints={mappedRouteCheckpoints}
                          interactivePoints={routeElevationPoints}
                          hoverPoint={hoverPoint ? { lat: hoverPoint.lat, lng: hoverPoint.lng } : null}
                          selectedPoint={selectedElevationPoint ? { lat: selectedElevationPoint.lat, lng: selectedElevationPoint.lng } : null}
                          onHoverRoutePoint={handleElevationHover}
                          className="h-[520px] border-0"
                          showCheckpointLabels
                        />
                      </Suspense>
                    </div>
                  ) : (
                    <EmptyState
                      title="Route preview not published yet."
                      description={t("event.detail.routeMapEmptyDescription")}
                    />
                  )}
                </ScrollReveal>

                <ScrollReveal delay={0.14}>
                  {routeElevationPoints.length ? (
                    <Suspense fallback={<div aria-hidden="true" className="h-[158px] animate-pulse rounded-xl bg-muted/35" />}>
                      <LazyInteractiveElevation
                        points={routeElevationPoints}
                        checkpoints={routeCheckpoints}
                        hoveredPoint={hoverPoint}
                        onHover={handleElevationHover}
                        onSelect={handleElevationSelect}
                        selectedKm={selectedElevationPoint?.distKm ?? null}
                      />
                    </Suspense>
                  ) : (
                    <EmptyState
                      title="Elevation profile not published yet."
                      description={t("event.detail.elevationEmptyDescription")}
                    />
                  )}
                </ScrollReveal>

                <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                  <ScrollReveal delay={0.18}>
                    <div className="overflow-hidden rounded-[28px] border border-border/70 bg-card shadow-[0_18px_48px_-30px_hsl(25_30%_12%_/_0.34)]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="w-full p-6">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Route Layer</div>
                              <h3 className="mt-2 font-display text-xl font-black">Public route points</h3>
                            </div>
                            <div className="rounded-full bg-primary/10 px-3 py-1 text-[11px] font-bold text-primary">
                              {t("event.detail.pointsCount", { count: routeCheckpoints.length })}
                            </div>
                          </div>
                        </div>
                      </div>

                      {routeCheckpoints.length ? (
                        <div className="px-6 pb-6">
                          <div className="space-y-3">
                          {routeCheckpoints.map((checkpoint, index) => (
                            <div key={`${checkpoint.name}-${index}`} className="flex gap-4 rounded-[24px] border border-border/70 bg-background/60 p-4 shadow-soft">
                              <div className="flex flex-col items-center pt-1">
                                <div className={`flex h-11 w-11 items-center justify-center rounded-[16px] border text-xs font-bold shadow-sm ${
                                  index === 0 || index === routeCheckpoints.length - 1
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-border bg-card text-foreground"
                                }`}>
                                  {index === 0 ? "S" : index === routeCheckpoints.length - 1 ? "F" : String(index).padStart(2, "0")}
                                </div>
                                {index < routeCheckpoints.length - 1 ? <div className="my-1 w-px flex-1 bg-border" /> : null}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <div className="font-display text-base font-bold">{eventPointName(checkpoint.name, locale)}</div>
                                    <div className="mt-0.5 text-sm text-muted-foreground">
                                      {t("event.detail.pointElevation", { km: formatNumber(checkpoint.km, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), elevation: formatNumber(checkpoint.elev) })}
                                    </div>
                                  </div>
                                  <span className="rounded-full border border-border/70 bg-card px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                    {checkpoint.type === "checkpoint" ? t("event.detail.checkpoint") : checkpoint.type ? formatRacePointTag(checkpoint.type, locale) : index === 0 ? "start" : index === routeCheckpoints.length - 1 ? "finish" : t("event.detail.coursePoint")}
                                  </span>
                                </div>
                                {checkpoint.type ? (
                                  <div className="mt-3 text-xs uppercase tracking-[0.18em] text-primary/80">
                                    Route-defined marker
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          ))}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-5">
                          <EmptyState
                            title="Public route points are not published yet."
                            description="Route points are shown here. Race-day checkpoints are listed separately below."
                          />
                        </div>
                      )}
                    </div>
                  </ScrollReveal>

                  <ScrollReveal delay={0.22}>
                    <div className="overflow-hidden rounded-[28px] border border-border/70 bg-card shadow-[0_18px_48px_-30px_hsl(25_30%_12%_/_0.34)]">
                      <div className="relative border-b border-border/60 p-6">
                        <div className="absolute inset-0 bg-gradient-to-r from-white/92 via-white/84 to-primary/[0.04] dark:from-raised dark:via-card/95 dark:to-primary/[0.08]" />
                        <div className="absolute inset-0 route-pattern opacity-30" />
                        <div className="relative">
                          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                            <Mountain className="h-4 w-4 text-primary" />
                            Route segments
                          </div>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {t("event.detail.segmentDescription")}
                          </p>
                        </div>
                      </div>

                      {selectedTrack?.segments.length ? (
                        <div className="p-6 pt-5 space-y-4">
                          {selectedTrack.segments.map((segment) => {
                            const segmentCopy = eventSegmentPresentation(segment, locale);
                            return (
                            <div key={segment.id} className="rounded-[24px] border border-border/70 bg-background/60 p-4 shadow-soft">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary/80">
                                    {segmentCopy.type}
                                  </div>
                                  <div className="mt-1 font-display text-base font-bold text-foreground" data-i18n-skip>{segmentCopy.name}</div>
                                  <div className="mt-1 text-sm text-muted-foreground">
                                    {segmentCopy.range}
                                  </div>
                                </div>
                                <span className="rounded-full border border-border bg-background px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                  {segmentCopy.difficulty}
                                </span>
                              </div>
                              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                                <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5 text-sm">
                                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Elevation change</div>
                                  <div className="mt-1 font-medium text-foreground">
                                    {segment.endElev >= segment.startElev ? "+" : ""}{segment.endElev - segment.startElev} m
                                  </div>
                                </div>
                                <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5 text-sm">
                                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Average grade</div>
                                  <div className="mt-1 font-medium text-foreground">
                                    {segmentCopy.grade}
                                  </div>
                                </div>
                                <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5 text-sm">
                                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Section type</div>
                                  <div className="mt-1 font-medium capitalize text-foreground">{segmentCopy.type}</div>
                                </div>
                              </div>
                              <p className="mt-4 text-sm leading-relaxed text-muted-foreground" data-i18n-skip={segmentCopy.hasAuthorComment || undefined}>
                                {segmentCopy.comment}
                              </p>
                            </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="mt-5">
                          <EmptyState
                            title="Segment breakdown is not published yet."
                            description={t("event.detail.segmentsEmptyDescription")}
                          />
                        </div>
                      )}
                    </div>
                  </ScrollReveal>
                </div>
              <ScrollReveal delay={0.24}>
                <div className="overflow-hidden rounded-[30px] border border-border/70 bg-card shadow-[0_18px_48px_-30px_hsl(25_30%_12%_/_0.34)]">
                  <div className="relative border-b border-border/60 p-6">
                    <div className="absolute inset-0 bg-gradient-to-r from-white/92 via-white/84 to-primary/[0.04] dark:from-raised dark:via-card/95 dark:to-primary/[0.08]" />
                    <div className="absolute inset-0 topo-pattern opacity-30" />
                    <div className="relative flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Route gallery</div>
                        <h3 className="mt-2 font-display text-xl font-black">Short gallery overview</h3>
                      </div>
                      <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-semibold text-muted-foreground">
                        {selectedTrack?.gallery.length ?? 0} images
                      </span>
                    </div>
                  </div>

                  {selectedTrack?.gallery.length ? (
                    <div className="p-6 pt-5 grid gap-4 md:grid-cols-3">
                      {selectedTrack.gallery.slice(0, 3).map((item) => (
                        <figure key={item.id} className="overflow-hidden rounded-[24px] border border-border/70 bg-background/60 shadow-soft">
                          <div className="relative h-52 w-full">
                            <EventContentImage
                              src={item.imageUrl}
                              alt={item.caption ?? selectedTrack.name}
                              sizes="(min-width: 768px) 33vw, 100vw"
                              className="object-cover"
                            />
                          </div>
                          <figcaption className="p-4 text-sm text-muted-foreground">
                            {item.caption ?? selectedTrack.name}
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-5">
                      <EmptyState
                        title="No route images published yet."
                        description={t("event.detail.routePhotosEmptyDescription")}
                      />
                    </div>
                  )}
                </div>
              </ScrollReveal>
            </div>

            <div className="space-y-6">
              <ScrollReveal>
                <div className="relative overflow-hidden rounded-[34px] border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(248,244,239,0.98))] shadow-[0_20px_70px_-34px_hsl(25_30%_12%_/_0.28)] dark:bg-[linear-gradient(180deg,hsl(var(--raised)),hsl(var(--card)))] dark:shadow-earth">
                  <div className="absolute inset-0 route-pattern opacity-20" />
                  <div className="relative min-h-[420px] p-6 text-foreground md:p-8">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Selected Race</div>
                        <h3 className="mt-2 font-display text-2xl font-black">{selectedCategory?.name ?? "Race"}</h3>
                      </div>
                      <span className="rounded-full border border-border/70 bg-background/80 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Route-led
                      </span>
                    </div>

                    <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
                      {[
                        { label: "Distance", value: localizedEventDistanceLabel(selectedCategory?.distance ?? "Distance TBA", localeTag), icon: Flag },
                        { label: "Elevation", value: selectedCategory?.elevation ?? "Climb TBA", icon: Mountain },
                        { label: "Start", value: selectedCategory?.startLabel ?? "Start TBA", icon: Calendar },
                        { label: "Fee", value: localizedEventPriceLabel(selectedCategory?.price ?? "Fee TBA", localeTag), icon: Trophy },
                        {
                          label: "Capacity",
                          value: `${selectedCategory?.participants ?? 0}/${selectedCategory?.maxParticipants ?? 0}`,
                          icon: Users,
                        },
                        { label: "Fill", value: `${getCategoryFillWidth(selectedCategory)}%`, icon: AlertCircle },
                        { label: "Best time", value: selectedTrack?.bestTime || "TBA", icon: Route },
                      ].map((fact) => (
                        <div key={fact.label} className="rounded-[20px] border border-border/70 bg-background/70 px-4 py-3 shadow-soft">
                          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                            <fact.icon className="h-3.5 w-3.5 text-primary" />
                            {fact.label}
                          </div>
                          <div className="mt-2 text-sm font-bold text-foreground">{fact.value}</div>
                        </div>
                      ))}
                    </div>

                    <RaceFeePeriods timezone={data.timezone} periods={selectedCategory?.feePeriods} currency={selectedCategory?.feeCurrency} startAt={selectedCategory?.startAtIso} />
                    <div className="mt-4 rounded-[20px] border border-border/70 bg-background/70 px-4 py-3 shadow-soft">
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                        <Users className="h-3.5 w-3.5 text-primary" />
                        Eligibility
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Age</div>
                          <div className="mt-1 text-sm font-bold text-foreground">{selectedCategoryEligibility.ageLabel}</div>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Gender</div>
                          <div className="mt-1 text-sm font-bold text-foreground">{selectedCategoryEligibility.genderLabel}</div>
                        </div>
                      </div>
                      {selectedCategoryEligibility.note ? (
                        <p className="mt-3 border-t border-border/60 pt-3 text-sm leading-6 text-muted-foreground">
                          {selectedCategoryEligibility.note}
                        </p>
                      ) : null}
                    </div>

                    {canRegister ? (
                      <a
                        href={selectedRaceRegisterHref}
                        className="group mt-5 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.08] px-5 py-3 text-sm font-bold text-foreground shadow-soft transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/[0.14]"
                      >
                        Register
                        <ArrowRight className="h-4 w-4 text-primary transition-transform group-hover:translate-x-0.5" />
                      </a>
                    ) : null}

                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-border/70">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary to-trail-amber transition-all"
                        style={{ width: `${getCategoryFillWidth(selectedCategory)}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span>{selectedCategory?.participants ?? 0}/{selectedCategory?.maxParticipants ?? 0} registered</span>
                      <span>{getCategoryFillWidth(selectedCategory)}% filled</span>
                    </div>
                  </div>
                </div>
              </ScrollReveal>

              <ScrollReveal delay={0.08} direction="right" distance={16}>
                <div className="rounded-[24px] border border-border/70 bg-background/85 p-4 shadow-soft">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    <Route className="h-3.5 w-3.5 text-trail-amber" />
                    {t("event.detail.timeline")}
                  </div>
                  <div className="mt-2 text-base font-semibold text-foreground">
                    {t("event.detail.raceSchedule", { race: selectedCategory?.name ?? t("event.detail.viewRace") })}
                  </div>
                  <div className="mt-3 grid gap-1.5">
                    {categoryTimeline.map((item, itemIndex) => (
                      <div
                        key={`${item.time}-${item.label}`}
                        className="group/timeline flex items-center gap-2.5 py-0.5"
                      >
                        <div className="flex h-11 w-2 shrink-0 items-center justify-center">
                          <div
                            className={`w-1.5 rounded-full ${
                              item.tone === "primary"
                                ? "h-11 bg-primary"
                                : item.tone === "accent"
                                  ? "h-11 border border-primary bg-primary/12"
                                  : "h-11 bg-border/85"
                            }`}
                          />
                        </div>
                        <div className="min-w-[4.4rem] rounded-[12px] border border-primary/14 bg-primary/[0.07] px-2 py-1.5 text-center text-primary shadow-none">
                          <div className="text-[7px] font-bold uppercase tracking-[0.18em] text-primary">{t("event.detail.scheduleSlot", { number: String(itemIndex + 1).padStart(2, "0") })}</div>
                          <div className="mt-0.5 block font-display text-[0.92rem] font-black leading-none text-primary">{item.time}</div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                            {t(item.tone === "primary" ? "event.detail.raceStart" : item.tone === "accent" ? "event.detail.keyMoment" : "event.detail.operations")}
                          </div>
                          <div className="mt-0.5 text-[13px] font-semibold leading-4 text-foreground">
                            {item.label}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </ScrollReveal>

              <ScrollReveal delay={0.12} direction="right" distance={16}>
                <div className="overflow-hidden rounded-[28px] border border-border/70 bg-card shadow-[0_18px_48px_-30px_hsl(25_30%_12%_/_0.34)]">
                  <div className="relative border-b border-border/60 p-5">
                      <div className="absolute inset-0 bg-gradient-to-r from-white/92 via-white/84 to-primary/[0.04] dark:from-raised dark:via-card/95 dark:to-primary/[0.08]" />
                      <div className="absolute inset-0 topo-pattern opacity-30" />
                      <div className="relative flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Route records</div>
                          <h3 className="mt-2 font-display text-lg font-black">
                            {selectedCategory?.name ?? "Race"} top 3
                          </h3>
                        </div>
                        <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-semibold text-muted-foreground">
                          History
                        </span>
                      </div>
                    </div>
                    <div className="p-5">
                      {selectedTrackRecords.length ? (
                        <div className="space-y-2.5">
                          {selectedTrackRecords.map((record) => (
                            <div
                              key={`${record.name}-${record.rank}`}
                              className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-[20px] border border-border/70 bg-background/60 px-3.5 py-3 shadow-soft"
                            >
                              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-[11px] font-black text-primary">
                                {record.rank}
                              </div>
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-foreground">{record.name}</div>
                                <div className="mt-0.5 text-[11px] text-muted-foreground">
                                  {localizedEventDateLabel(record.date, localeTag)} {record.gender ? `· ${record.gender}` : ""}
                                </div>
                              </div>
                              <div className="text-right">
                                <TrackRecordTimeLink
                                  time={record.time}
                                  sourceKind={record.sourceKind}
                                  sourceLabel={record.sourceLabel}
                                  sourceHref={record.sourceHref}
                                  className="font-mono text-sm font-bold text-foreground"
                                />
                                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                                  {record.verified ? "Verified" : "Pending"}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <EmptyState
                          title="Route records are not published yet."
                          description={t("event.detail.recordsEmptyDescription")}
                        />
                      )}
                    </div>
                  </div>
                </ScrollReveal>

                <ScrollReveal delay={0.14} direction="right" distance={16}>
                  <div className="overflow-hidden rounded-[28px] border border-border/70 bg-card shadow-[0_18px_48px_-30px_hsl(25_30%_12%_/_0.34)]">
                    <div className="relative border-b border-border/60 p-6">
                      <div className="absolute inset-0 bg-gradient-to-r from-white/92 via-white/84 to-primary/[0.04] dark:from-raised dark:via-card/95 dark:to-primary/[0.08]" />
                      <div className="absolute inset-0 topo-pattern opacity-30" />
                      <div className="relative">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Race checkpoints</div>
                            <h3 className="mt-2 font-display text-lg font-black">Official race-day checkpoints</h3>
                          </div>
                          <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-semibold text-muted-foreground">
                            Operations overlay
                          </span>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-muted-foreground">
                          Official race-day stations and control points for this race are listed separately from route points.
                        </p>
                        <div className="mt-4 grid grid-cols-3 gap-2">
                          {[
                            [t("event.detail.controlPoints"), publicRacePointCounts(raceCheckpoints).controlPoints],
                            ["Water", publicRacePointCounts(raceCheckpoints).waterPoints],
                            ["Food & Water", publicRacePointCounts(raceCheckpoints).foodAndWaterPoints],
                          ].map(([label, value]) => (
                            <div key={label} className="rounded-xl border border-border/70 bg-background/70 px-2 py-2.5 text-center">
                              <div className="text-lg font-black text-foreground">{value}</div>
                              <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {raceCheckpoints.length ? (
                      <div className="p-6 pt-5 space-y-3">
                        {raceCheckpoints.map((checkpoint, index) => (
                          <div key={`${checkpoint.name}-${index}`} className="rounded-[24px] border border-border/70 bg-background/60 p-4 shadow-soft">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="font-display text-base font-bold text-foreground">{eventPointName(checkpoint.name, locale)}</div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {formatRaceCheckpointMeta(checkpoint, locale) || t("event.detail.coursePoint")}
                                </div>
                              </div>
                              <div className="flex flex-wrap justify-end gap-1.5">
                                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                                  isPublicRacePointRequired(checkpoint)
                                    ? "bg-primary/10 text-primary"
                                    : "bg-muted text-muted-foreground"
                                }`}>
                                  {isPublicRacePointRequired(checkpoint) ? "Required" : t("event.detail.pointInformative")}
                                </span>
                                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
                                  {formatRacePointTag(checkpoint.type, locale)}
                                </span>
                              </div>
                            </div>
                            {checkpoint.typeTags.length ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {checkpoint.typeTags.map((tag) => (
                                  <span key={`${checkpoint.name}-${tag}`} className="rounded-full border border-border bg-card px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                    {formatRacePointTag(tag, locale)}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            {checkpoint.athleteNote ? (
                              <p className="mt-3 text-sm leading-6 text-muted-foreground">{checkpoint.athleteNote}</p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-5">
                        <EmptyState
                          title="Official race checkpoints are not published yet."
                          description="Race-day stations and checkpoints are listed separately from route points."
                        />
                      </div>
                    )}
                  </div>
                </ScrollReveal>

                <ScrollReveal delay={0.18} direction="right" distance={16}>
                  <div className="overflow-hidden rounded-[28px] border border-border/70 bg-card shadow-[0_18px_48px_-30px_hsl(25_30%_12%_/_0.34)]">
                    <div className="relative border-b border-border/60 p-5">
                      <div className="absolute inset-0 bg-gradient-to-r from-white/92 via-white/84 to-primary/[0.04] dark:from-raised dark:via-card/95 dark:to-primary/[0.08]" />
                      <div className="absolute inset-0 route-pattern opacity-30" />
                      <div className="relative">
                        <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Route actions</div>
                        <h3 className="mt-2 font-display text-lg font-black text-foreground">Practical race actions</h3>
                      </div>
                    </div>
                    <div className="space-y-3 p-5">
                      {canRegister ? (
                        <a
                          href={selectedRaceRegisterHref}
                          className="inline-flex w-full items-center justify-center rounded-xl border border-primary/25 bg-primary/[0.07] px-5 py-3 text-sm font-bold text-foreground shadow-soft transition-colors hover:bg-primary/[0.12]"
                        >
                          Register for {selectedCategory?.name ?? "this race"}
                        </a>
                      ) : null}

                      {selectedTrack?.gpxDownloadUrl ? (
                        <a
                          href={selectedTrack.gpxDownloadUrl}
                          download={selectedTrack.gpxFileName ?? undefined}
                          className="inline-flex w-full items-center justify-center rounded-xl border border-border/70 bg-card px-5 py-3 text-sm font-bold text-foreground shadow-soft transition-colors hover:border-primary/20 hover:bg-secondary"
                        >
                          Download GPX
                        </a>
                      ) : (
                        <div className="inline-flex w-full items-center justify-center rounded-xl border border-border/70 bg-background/60 px-5 py-3 text-sm font-semibold text-muted-foreground">
                          GPX coming soon
                        </div>
                      )}

                      {selectedTrackSlug ? (
                        <Link
                          to={`/tracks/${selectedTrackSlug}`}
                          className="flex items-center justify-between rounded-xl border border-border/70 bg-background/60 px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
                        >
                          Open full route guide
                          <ChevronRight className="h-4 w-4 text-primary" />
                        </Link>
                      ) : null}

                      {selectedStartDirectionsHref ? (
                        <a
                          href={selectedStartDirectionsHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between rounded-xl border border-border/70 bg-background/60 px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
                        >
                          Navigate to start
                          <ExternalLink className="h-4 w-4 text-primary" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                </ScrollReveal>

                <ScrollReveal delay={0.22} direction="right" distance={16}>
                  <div className="overflow-hidden rounded-[28px] border border-border/70 bg-card shadow-[0_18px_48px_-30px_hsl(25_30%_12%_/_0.34)]">
                    <div className="relative border-b border-border/60 p-5">
                      <div className="absolute inset-0 bg-gradient-to-r from-white/92 via-white/84 to-primary/[0.04] dark:from-raised dark:via-card/95 dark:to-primary/[0.08]" />
                      <div className="absolute inset-0 route-pattern opacity-30" />
                      <div className="relative">
                        <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Safety notes</div>
                        <h3 className="mt-2 font-display text-lg font-black text-foreground">Route safety notes</h3>
                      </div>
                    </div>
                    <div className="space-y-3 p-5">
                      <div className="rounded-[20px] border border-border/70 bg-background/60 px-4 py-3 shadow-soft">
                        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary/80">Route warning</div>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          {selectedTrack?.warnings || t("event.detail.noSafetyNote")}
                        </p>
                      </div>
                    </div>
                  </div>
                </ScrollReveal>
            </div>
          </div>
        )}

        {activeTab === "Live" && (
          <div className="grid gap-8 xl:grid-cols-[minmax(0,1.15fr)_360px]">
            <div className="space-y-6">
              <ScrollReveal>
                <EventTabFeatureBanner
                  eyebrow="Race Day"
                  title={raceDayCategory ? `${raceDayCategory.name} operations view` : "Logistics, timing windows, and weather"}
                  description="Parking, timing, weather, safety, and station information for this race."
                  imageSrc={raceDayTabImage}
                  imageAlt={`${data.name} race day`}
                  badges={[
                    `${logisticsLocations.length} logistics points`,
                    `${schedule.length} timeline items`,
                    "Weather and safety layer",
                  ]}
                  stats={[
                    {
                      label: "Start window",
                      value: raceDayCategory?.startLabel ?? "TBA",
                      icon: Flag,
                      helper: raceDayCategory
                        ? `${raceDayCategory.name} keeps its own stations, notes, and arrival plan.`
                        : "Switch race-specific starts, stations, and notes without losing shared logistics.",
                    },
                    {
                      label: "Stations",
                      value: String(raceDayRaceCheckpoints.length),
                      icon: Navigation,
                      helper: "Official support and control points for the active race.",
                      tone: "warm",
                    },
                    {
                      label: "Logistics points",
                      value: String(logisticsMapLocations.length),
                      icon: MapPin,
                      helper: "Parking, registration, start zones, and public access points.",
                      tone: "cool",
                    },
                  ]}
                />
              </ScrollReveal>

              <ScrollReveal delay={0.04}>
                <RaceFocusSelector
                  title="Race Focus"
                  description="View race-wide parking, registration, notices, and schedule. Select a category for start, route, safety, and support details."
                  categories={categories}
                  selectedValue={raceDayCategory?.slug ?? ""}
                  onSelect={setRaceDayCategorySlug}
                />
              </ScrollReveal>

              {publicLiveQuery.data?.categories.length ? (
                <ScrollReveal delay={0.05}>
                  <div className="overflow-hidden rounded-[28px] border border-primary/20 bg-card shadow-[0_18px_48px_-30px_hsl(25_30%_12%_/_0.34)]">
                    <div className="relative border-b border-border/60 p-5">
                      <div className="absolute inset-0 bg-gradient-to-r from-primary/[0.08] via-white/90 to-white/80" />
                      <div className="absolute inset-0 route-pattern opacity-30" />
                      <div className="relative flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.24em] text-primary">
                            <Radio className="h-4 w-4" />
                            Delayed live race state
                          </div>
                          <h3 className="mt-2 font-display text-xl font-black text-foreground">Field progress</h3>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Privacy-filtered aggregate observations. This is not an emergency tracking service.
                          </p>
                        </div>
                        <span className="rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
                          auto-refresh 30s
                        </span>
                      </div>
                    </div>
                    <div className="space-y-4 p-5">
                      {publicLiveQuery.data.categories
                        .filter((category) => !raceDayCategory || category.slug === raceDayCategory.slug)
                        .map((liveCategory) => (
                          <div key={liveCategory.id}>
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <div className="font-display text-base font-bold">{liveCategory.name}</div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  Visible through {formatDateTime(liveCategory.visibleThrough)} · {liveCategory.delaySeconds}s delay
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase ${
                                  liveCategory.isSuppressed
                                    ? "bg-amber-500/10 text-amber-700 dark:bg-warning/10 dark:text-warning"
                                    : "bg-accent/10 text-accent"
                                }`}>
                                  {liveCategory.isSuppressed ? "updates paused" : "live"}
                                </span>
                                <Link
                                  to={`/live/${data.slug}/${liveCategory.slug}`}
                                  className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary px-3 text-[10px] font-black uppercase tracking-[0.08em] text-primary-foreground transition hover:bg-primary/90"
                                >
                                  Open live workspace
                                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                                </Link>
                              </div>
                            </div>

                            {liveCategory.isSuppressed ? (
                              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5 text-sm text-muted-foreground">
                                {liveCategory.suppressionMessage ?? "Live updates are temporarily paused by the organizer."}
                              </div>
                            ) : (
                              <>
                                <div className="grid gap-3 sm:grid-cols-4">
                                  {[
                                    ["Started", liveCategory.participantCounts?.started ?? 0],
                                    ["On route", liveCategory.participantCounts?.onCourse ?? 0],
                                    ["Finished", liveCategory.participantCounts?.finished ?? 0],
                                    ["Withdrawn", liveCategory.participantCounts?.withdrawn ?? 0],
                                  ].map(([label, value]) => (
                                    <div key={String(label)} className="rounded-2xl border border-border/70 bg-background/65 p-4">
                                      <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
                                      <div className="mt-1 font-display text-2xl font-black text-foreground">{value}</div>
                                    </div>
                                  ))}
                                </div>
                                {liveCategory.checkpointProgress.length ? (
                                  <LiveCheckpointProgressGrid
                                    checkpoints={liveCategory.checkpointProgress}
                                    timeZone={publicLiveQuery.data.timezone}
                                    effectiveStartAt={liveCategory.effectiveStartAt}
                                  />
                                ) : null}
                              </>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                </ScrollReveal>
              ) : null}

              <ScrollReveal delay={0.06}>
                <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Logistics Map</div>
                      <h3 className="mt-2 font-display text-xl font-bold">Parking, registration, and start access</h3>
                    </div>
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-[11px] font-bold text-primary">
                      {t("event.detail.locationsCount", { count: logisticsMapLocations.length })}
                    </span>
                  </div>

                  {logisticsMapLocations.length ? (
                    <div className="mt-5 space-y-5">
                      <DeferredEventLocationsMap events={logisticsMapLocations} className="h-[420px]" />
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {logisticsLocations.map((location) => (
                          <div key={location.id} className="rounded-2xl border border-border/70 bg-background/60 p-4">
                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                              {locationTypeLabel(location.type)}
                            </div>
                            <div className="mt-2 font-display text-base font-bold text-foreground">{location.label}</div>
                            <div className="mt-2 text-sm text-muted-foreground">{location.place ?? data.locationLabel}</div>
                            {location.description ? (
                              <p className="mt-3 text-sm leading-6 text-muted-foreground">{location.description}</p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-5">
                      <EmptyState
                        title="Shared race logistics are not published yet."
                        description="Parking, registration, and start locations will appear when published."
                      />
                    </div>
                  )}
                </div>
              </ScrollReveal>

              <ScrollReveal delay={0.1}>
                <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
                  <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Schedule</div>
                  <h3 className="mt-2 font-display text-xl font-bold">Day-of timing</h3>
                  <div className="mt-5 space-y-3">
                    {schedule.map((item) => {
                      const rowClasses =
                        item.tone === "primary"
                          ? "border-primary/20 bg-primary/[0.05]"
                          : item.tone === "accent"
                            ? "border-trail-blue/20 bg-trail-blue/[0.05]"
                            : "border-border bg-background";
                      const timeClasses =
                        item.tone === "primary"
                          ? "text-primary"
                          : item.tone === "accent"
                            ? "text-trail-blue"
                            : "text-muted-foreground";

                      return (
                        <div key={`${item.time}-${item.label}`} className={`flex items-center gap-4 rounded-2xl border px-5 py-3.5 ${rowClasses}`}>
                          <span className={`w-16 font-mono text-sm font-bold ${timeClasses}`}>{item.time}</span>
                          <span className="text-sm text-foreground">{item.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </ScrollReveal>

              <ScrollReveal delay={0.14}>
                <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Safety & Weather</div>
                      <h3 className="mt-2 font-display text-xl font-bold">What matters today</h3>
                    </div>
                    {primaryWeatherTarget ? (
                      <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-semibold text-muted-foreground">
                        {primaryWeatherTarget.label}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                    <div className="rounded-2xl border border-border/70 bg-background/60 p-5">
                      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <CloudSun className="h-4 w-4 text-primary" />
                        Live weather
                      </div>
                      {weatherQuery.isPending ? (
                        <div className="mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading route weather...
                        </div>
                      ) : weatherQuery.data ? (
                        <div className="mt-4 space-y-3">
                          <div className="font-display text-4xl font-bold text-foreground">
                            {weatherQuery.data.temp != null ? `${weatherQuery.data.temp}°` : "—"}
                          </div>
                          <div className="text-sm font-semibold text-primary">
                            {weatherQuery.data.conditionLabel}
                          </div>
                          <div className="grid grid-cols-2 gap-3 text-sm text-muted-foreground">
                            <div>Wind {weatherQuery.data.windKph != null ? `${weatherQuery.data.windKph} km/h` : "—"}</div>
                            <div>Rain {weatherQuery.data.precipitationProbability != null ? `${weatherQuery.data.precipitationProbability}%` : "—"}</div>
                            <div>Humidity {weatherQuery.data.humidity != null ? `${weatherQuery.data.humidity}%` : "—"}</div>
                            <div>Stations {weatherQuery.data.stationCount}</div>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-4 text-sm text-muted-foreground">
                          Weather will appear here once a usable race or route location is available.
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl border border-trail-amber/30 bg-trail-amber/5 p-5">
                      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <ShieldAlert className="h-4 w-4 text-trail-amber" />
                        Safety notes
                      </div>
                      <p className="mt-4 text-sm leading-7 text-muted-foreground">
                        {raceDayTrack?.warnings || "Safety notes for the linked route will appear here once published."}
                      </p>
                      {raceDayRaceCheckpoints.length ? (
                        <div className="mt-4 rounded-2xl border border-border/70 bg-white/75 p-4 text-sm text-muted-foreground dark:bg-raised/70">
                          <div className="font-semibold text-foreground">Official support summary</div>
                          <div className="mt-2 leading-6">
                            {raceDayRaceCheckpoints
                              .filter((checkpoint) => checkpoint.typeTags.includes("water") || checkpoint.typeTags.includes("refreshment"))
                              .map((checkpoint) => checkpoint.name)
                              .join(" · ") || "No official water or aid stations have been published yet."}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </ScrollReveal>

              <ScrollReveal delay={0.18}>
                <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
                  <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Stations By Race</div>
                  <h3 className="mt-2 font-display text-xl font-bold">Official race-day station picture</h3>
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    {categories.map((category) => (
                      <button
                        key={category.slug}
                        type="button"
                        onClick={() => setRaceDayCategorySlug(category.slug)}
                        className={`rounded-2xl border bg-background/60 p-4 text-left transition-colors ${
                          raceDayCategory?.slug === category.slug
                            ? "border-primary/35 bg-primary/[0.05]"
                            : "border-border/70 hover:border-primary/25 hover:bg-muted/25"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-display text-base font-bold text-foreground">{category.name}</div>
                            <div className="mt-1 text-sm text-muted-foreground">
                              {localizedEventDistanceLabel(category.distance, localeTag)} · start {category.startLabel ?? "TBA"}
                            </div>
                          </div>
                          <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            {category.raceCheckpoints?.length ?? 0} stations
                          </span>
                        </div>
                        {category.raceCheckpoints?.length ? (
                          <div className="mt-4 flex flex-wrap gap-2">
                            {category.raceCheckpoints.map((checkpoint) => (
                              <span
                                key={`${category.slug}-${checkpoint.name}`}
                                className="rounded-full border border-border bg-card px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                              >
                                {checkpoint.name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-4 text-sm text-muted-foreground">
                            Official race-day stations are not published yet.
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </ScrollReveal>
            </div>

            <div className="space-y-4">
              <ScrollReveal delay={0.03} direction="right" distance={16}>
                <div className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-6 shadow-soft">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Race Focus</div>
                      <h3 className="mt-2 font-display text-lg font-bold">{raceDayCategory?.name ?? "Race"}</h3>
                    </div>
                    <span className="rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary-foreground">
                      Race-specific
                    </span>
                  </div>
                  <dl className="mt-4 space-y-3 text-sm">
                    {raceDayRaceFacts.map((fact) => (
                      <div key={fact.label} className="flex justify-between gap-4">
                        <dt className="text-muted-foreground">{fact.label}</dt>
                        <dd className="font-medium text-right">{fact.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </ScrollReveal>

              <ScrollReveal delay={0.05} direction="right" distance={16}>
                <div className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-6 shadow-soft">
                  <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Arrival</div>
                  <h3 className="mt-2 font-display text-lg font-bold">Essential day-of points</h3>
                  <div className="mt-4 space-y-3">
                    {["parking", "registration", "start_zone"].map((type) => {
                      const location = logisticsLocations.find((item) => item.type === type);
                      if (!location) return null;
                      return (
                        <div key={type} className="rounded-2xl border border-border/70 bg-white/75 p-4 dark:bg-raised/70">
                          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                            {locationTypeLabel(type)}
                          </div>
                          <div className="mt-2 font-semibold text-foreground">{location.label}</div>
                          <div className="mt-1 text-sm text-muted-foreground">{location.place ?? data.locationLabel}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </ScrollReveal>

              <ScrollReveal delay={0.09} direction="right" distance={16}>
                <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
                  <h3 className="mb-4 font-display text-sm font-bold">Directions</h3>
                  <div className="space-y-3">
                    {selectedParkingDirectionsHref ? (
                      <a
                        href={selectedParkingDirectionsHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between rounded-xl border border-border bg-background/70 px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
                      >
                        <span className="inline-flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-primary" />
                          Open parking directions
                        </span>
                        <ExternalLink className="h-4 w-4 text-muted-foreground" />
                      </a>
                    ) : null}
                    {raceDayStartDirectionsHref ? (
                      <a
                        href={raceDayStartDirectionsHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between rounded-xl border border-border bg-background/70 px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
                      >
                        <span className="inline-flex items-center gap-2">
                          <Navigation className="h-4 w-4 text-primary" />
                          Open {raceDayCategory?.name ?? "race"} start directions
                        </span>
                        <ExternalLink className="h-4 w-4 text-muted-foreground" />
                      </a>
                    ) : null}
                    {!selectedParkingDirectionsHref && !raceDayStartDirectionsHref ? (
                      <EmptyState
                        title="Directions are not published yet."
                        description="Race Day will show direct navigation links once race logistics or the linked route start point are published."
                      />
                    ) : null}
                  </div>
                </div>
              </ScrollReveal>

              <ScrollReveal delay={0.13} direction="right" distance={16}>
                <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
                  <h3 className="mb-4 font-display text-sm font-bold">Public Notices</h3>
                  {eventDocuments.length ? (
                    <div className="space-y-2">
                      {eventDocuments.map((document) => (
                        <div
                          key={document.storagePath}
                          className="flex w-full items-center gap-2 rounded-xl bg-muted/40 px-4 py-2.5 text-xs font-medium text-foreground"
                        >
                          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                          {document.title}
                          <span className="ml-auto rounded-full bg-background px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Published
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-border bg-background/50 p-5 text-sm text-muted-foreground">
                      No public notices or documents.
                    </div>
                  )}
                </div>
              </ScrollReveal>
            </div>
          </div>
        )}

        {activeTab === "Registrations" && (
          <div className="space-y-6">
            <div className="hidden" aria-hidden="true">
              <EventTabFeatureBanner
                eyebrow="Registrations"
                title="Premium public start list for every race"
                description="Browse all registrations or filter by race, athlete, club, gender, registration status, and race status."
                imageSrc={registrationsTabImage}
                imageAlt={`${data.name} registrations`}
                action={canRegister ? {
                  label: selectedCategory ? `Register for ${selectedCategory.name}` : "Register for this race",
                  href: selectedRaceRegisterHref,
                  helper: "Creates an account-linked or guest entry using the selected race scope.",
                } : undefined}
                badges={[
                  registrationsCategorySlug === ALL_RACES_VALUE ? "All races view" : "Single race focus",
                  "Search, club, gender, and status filters",
                  "Full public roster",
                ]}
                stats={[
                  {
                    label: "Visible runners",
                    value: String(filteredRegistrationRows.length),
                    icon: Users,
                    helper: registrationsCategorySlug === ALL_RACES_VALUE ? "Across every published race." : "Within the selected race scope.",
                    tone: "accent",
                  },
                  {
                    label: "Confirmed",
                    value: String(registrationScopeSummary.confirmedRegistrations),
                    icon: CheckCircle,
                    helper: "Confirmed entries in the selected race scope.",
                    tone: "warm",
                  },
                  {
                    label: "Clubs visible",
                    value: String(visibleRegistrationClubCount),
                    icon: Flag,
                    helper: "Club diversity in the current roster slice.",
                    tone: "cool",
                  },
                ]}
              />
            </div>

            <ScrollReveal delay={0.06}>
              <div className="flex flex-wrap gap-2 rounded-2xl border border-border bg-card p-3 shadow-soft">
                <div className="min-w-[9rem] flex-1 rounded-xl border border-primary/20 bg-primary/[0.04] px-4 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Total registrations</div>
                  <div className="mt-1 font-display text-2xl font-bold text-foreground">{registrationScopeSummary.totalRegistrations}</div>
                </div>
                <div className="min-w-[9rem] flex-1 rounded-xl border border-border bg-background/60 px-4 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Publicly visible</div>
                  <div className="mt-1 font-display text-2xl font-bold text-foreground">{registrationScopeSummary.publiclyVisibleRegistrations}</div>
                </div>
                <div className="min-w-[9rem] flex-1 rounded-xl border border-border bg-background/60 px-4 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Confirmed</div>
                  <div className="mt-1 font-display text-2xl font-bold text-foreground">{registrationScopeSummary.confirmedRegistrations}</div>
                </div>
                <div className="min-w-[9rem] flex-1 rounded-xl border border-border bg-background/60 px-4 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Pending</div>
                  <div className="mt-1 font-display text-2xl font-bold text-foreground">{registrationScopeSummary.pendingRegistrations}</div>
                </div>
                <div className="min-w-[9rem] flex-1 rounded-xl border border-border bg-background/60 px-4 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Registration</div>
                  <div className="mt-1 font-display text-lg font-bold text-foreground">{canRegister ? "Open" : eventLifecycle === "after" ? "Closed" : data.statusLabel}</div>
                </div>
              </div>
            </ScrollReveal>

            <ScrollReveal delay={0.1}>
              <MobileDetailDisclosure
                title="Runner filters"
                summary={`${filteredRegistrationRows.length} of ${registrationBaseRows.length} visible · search, club and status`}
                icon={Search}
                hideOnDesktop={false}
                expandOnDesktop
                hideSummaryOnDesktop
                className="lg:border-0 lg:bg-transparent lg:shadow-none"
              >
                <RosterFilterPanel
                  title="Runner Filters"
                  description="Use the race scope first, then narrow the public start list by runner name, club, gender, registration state, or live race status."
                  filters={registrationFilters}
                  defaultFilters={defaultRegistrationFilters}
                  genderOptions={registrationGenderOptions}
                  clubOptions={registrationClubOptions}
                  registrationStatusOptions={registrationStatusOptions}
                  raceStatusOptions={registrationRaceStatusOptions}
                  sortOptions={[...registrationSortOptions]}
                  filteredCount={filteredRegistrationRows.length}
                  totalCount={registrationBaseRows.length}
                  searchPlaceholder="Search runner, club, bib, or category..."
                  onFiltersChange={setRegistrationFilters}
                  onReset={() => setRegistrationFilters(defaultRegistrationFilters)}
                />
              </MobileDetailDisclosure>
            </ScrollReveal>

            <ScrollReveal delay={0.14}>
              <div className="rounded-2xl border border-border bg-card p-4 shadow-soft lg:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Registered athletes</div>
                    <h3 className="mt-2 font-display text-xl font-bold">
                      {registrationsCategorySlug === ALL_RACES_VALUE
                        ? "Full race roster"
                        : t("event.detail.registrationListTitle", { race: categories.find((category) => category.slug === registrationsCategorySlug)?.name ?? t("event.detail.viewRace") })}
                    </h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {registrationsCategorySlug === ALL_RACES_VALUE
                        ? t("event.detail.registrationListAll")
                        : t("event.detail.registrationListDescription")}
                    </p>
                  </div>
                  {participantsQuery.isFetching ? (
                    <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-[11px] font-semibold text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Refreshing
                    </span>
                  ) : null}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {[
                    { value: ALL_RACES_VALUE, label: "All races" },
                    ...categories.map((category) => ({ value: category.slug, label: category.name })),
                  ].map((option) => {
                    const isActive = option.value === registrationsCategorySlug;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setRegistrationsCategorySlug(option.value)}
                        className={`rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-5 rounded-2xl border border-border/60 bg-background/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-foreground">
                      {t("event.detail.visibleAthletes", { count: filteredRegistrationRows.length })}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Bib, athlete, club, race, category, gender, registration state, and race status
                    </div>
                  </div>
                </div>
                <div className="mt-4">
                  <PublicRegistrationsTable
                    rows={filteredRegistrationRows}
                    sortBy={registrationFilters.sortBy}
                    sortDirection={registrationFilters.sortDirection}
                    onSort={(sortKey) => setRegistrationFilters((current) => toggleParticipantSort(current, sortKey))}
                  />
                </div>
              </div>
            </ScrollReveal>
          </div>
        )}

        {activeTab === "Results" && (
          <div id="results" className="space-y-6">
            <div className="hidden" aria-hidden="true">
              <EventTabFeatureBanner
                eyebrow="Results"
                title={
                  eventLifecycle === "before"
                    ? "Category results view before race day"
                    : eventLifecycle === "during"
                      ? "Live category standings"
                      : "Final category results"
                }
                description="Results include finishers, DNF, and DSQ. DNS and pending entries remain under Registrations."
                imageSrc={resultsTabImage}
                imageAlt={`${data.name} results`}
                badges={[
                  resultsFocusCategory?.name ?? "Selected race",
                  "Starter-only results table",
                  "Podium and team standings",
                ]}
                  stats={[
                    {
                      label: "Race distance",
                      value: resultsFocusCategory?.distance ?? "—",
                      icon: Trophy,
                      helper: resultsFocusCategory
                        ? `${resultsFocusCategory.name} stays category-specific and includes every athlete who started.`
                        : "Results stay category-specific and include every athlete who started.",
                      tone: "warm",
                    },
                  {
                    label: "Publication",
                    value: selectedResultsPublicationLabel,
                    icon: CheckCircle,
                    helper: selectedResultsCategory?.publishedAt
                      ? `Published ${formatPublishedAt(selectedResultsCategory.publishedAt)}`
                      : "Waiting for an official public run.",
                    tone: "accent",
                  },
                  {
                    label: "Clubs visible",
                    value: String(visibleResultsClubCount),
                    icon: Flag,
                    helper: "How many clubs are represented in the filtered results table.",
                    tone: "cool",
                  },
                ]}
              />
            </div>

            <ScrollReveal delay={0.06}>
              <RaceFocusSelector
                title="Result Scope"
                description="Select a race to view its full result table."
                categories={categories}
                selectedValue={resultsFocusCategory?.slug ?? ""}
                onSelect={setResultsCategorySlug}
                visual
                imageBySlug={categoryPreviewImageBySlug}
                summaryPills={[
                  { label: "Registered", value: String(resultsFocusCategory?.participants ?? 0) },
                  { label: "Finishers", value: resultsUnconfirmed ? "—" : String(selectedResultsFinishersCount) },
                  { label: "Publication", value: resultsUnconfirmed ? "—" : selectedResultsPublicationLabel },
                  { label: "DNS / pending", value: resultsUnconfirmed ? "—" : `${selectedResultsDnsCount} / ${selectedResultsPendingCount}` },
                ]}
              />
            </ScrollReveal>

            <ScrollReveal delay={0.12}>
              <MobileDetailDisclosure
                title="Results filters"
                summary={`${filteredResultsRows.length} of ${resultsBaseRows.length} visible · athlete, club and status`}
                icon={Search}
                hideOnDesktop={false}
                expandOnDesktop
                hideSummaryOnDesktop
                className="lg:border-0 lg:bg-transparent lg:shadow-none"
              >
                <RosterFilterPanel
                  title="Results Filters"
                  description="Filter results by athlete, club, gender, registration status, or result status."
                  filters={resultsFilters}
                  defaultFilters={defaultResultsFilters}
                  genderOptions={resultsGenderOptions}
                  clubOptions={resultsClubOptions}
                  registrationStatusOptions={resultsRegistrationStatusOptions}
                  raceStatusOptions={resultsRaceStatusOptions}
                  sortOptions={[...resultsSortOptions]}
                  filteredCount={filteredResultsRows.length}
                  totalCount={resultsBaseRows.length}
                  searchPlaceholder="Search runner, club, bib, or status..."
                  onFiltersChange={setResultsFilters}
                  onReset={() => setResultsFilters(defaultResultsFilters)}
                />
              </MobileDetailDisclosure>
            </ScrollReveal>

            <ScrollReveal delay={0.16}>
              <div className="space-y-6 rounded-2xl border border-border bg-card p-4 shadow-soft lg:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Result Table</div>
                    <h3 className="mt-2 font-display text-xl font-bold">{resultsFocusCategory?.name ?? "Selected race"}</h3>
                  </div>
                  {(resultsQuery.isFetching || participantsQuery.isFetching) ? (
                    <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-[11px] font-semibold text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Refreshing
                    </span>
                  ) : null}
                </div>

                <PublicResultsLifecycleNotice
                  publicationState={selectedResultsPublicationState}
                  isRefreshing={resultsQuery.isFetching || participantsQuery.isFetching}
                  isLoading={resultsInitiallyLoading}
                  hasLoadError={resultsLoadFailed}
                  onRetry={() => { void resultsQuery.refetch(); void participantsQuery.refetch(); }}
                />

                <ResultStandingScopePills
                  scopes={resultStandingScopes}
                  activeScopeId={activeResultsStandingScope?.id ?? null}
                  onScopeChange={setResultsStandingScopeId}
                  ariaLabel={`${resultsFocusCategory?.name ?? "Selected race"} standing categories`}
                />

                {categoryWinnerRows.length ? (
                  <div className="grid gap-4 md:grid-cols-3">
                    {categoryWinnerRows.map(({ row, scope }) => {
                      const podiumVisual = getResultPodiumVisual(1);
                      if (!podiumVisual) return null;
                      return (
                        <div
                          key={`${scope.id}-${row.athleteSlug}`}
                          className={cn(
                            "relative overflow-hidden rounded-2xl border p-5 transition-transform duration-200 hover:-translate-y-0.5",
                            podiumVisual.cardClassName,
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className={cn("text-[10px] font-bold uppercase tracking-[0.18em]", podiumVisual.labelClassName)}>
                                {podiumVisual.shortLabel} · {scope.label} #1
                              </div>
                              <div className="mt-2 font-display text-lg font-bold text-foreground">{row.name}</div>
                            </div>
                            <ResultPlaceBadge place={1} scopeLabel={scope.label} />
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">{normalizePublicResultClubName(row.club)}</div>
                          <div className="mt-4 font-mono text-xl font-bold text-foreground">{row.time}</div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {!resultsUnconfirmed ? <PublicResultsTable
                  rows={filteredResultsRows}
                  placementsByRegistrationId={resultPlacementsByRegistrationId}
                  rankByRegistrationId={activeStandingRankByRegistrationId}
                  rankingScopeLabel={activeResultsStandingScope?.label ?? "Overall"}
                  eventSlug={data.slug}
                  distanceKm={selectedResultsCategory?.distanceKm}
                  winnerTimeMs={resultsWinnerTimeMs}
                  sortBy={resultsFilters.sortBy}
                  sortDirection={resultsFilters.sortDirection}
                  onSort={(sortKey) => setResultsFilters((current) => toggleParticipantSort(current, sortKey))}
                /> : null}

                {selectedResultsCategory?.teamStandings.length ? (
                  <div className="rounded-2xl border border-border/70 bg-background/60 p-5">
                    <div className="mb-4 flex items-center gap-2">
                      <Trophy className="h-4 w-4 text-primary" />
                      <h4 className="font-display text-lg font-bold">Team standings</h4>
                    </div>
                    <div className="space-y-3">
                      {selectedResultsCategory.teamStandings.map((standing) => (
                        <div key={standing.clubId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card px-4 py-3">
                          <div>
                            <div className="font-semibold">{standing.rank}. {standing.clubName}</div>
                            <div className="text-xs text-muted-foreground">{standing.scorerNames.join(" · ")}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-mono text-sm font-bold text-primary">{standing.score} pts</div>
                            <div className="text-xs text-muted-foreground">Ranks {standing.scorerRanks.join(", ")}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </ScrollReveal>

            <ScrollReveal delay={0.18}>
              <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
                  <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Records</div>
                  <h3 className="mt-2 font-display text-xl font-bold">
                    {resultsFocusCategory ? t("event.detail.results.courseRecords", { race: resultsFocusCategory.name }) : "Route records"}
                  </h3>
                  {resultsTrackRecords.length ? (
                    <div className="mt-5 space-y-3">
                      {resultsTrackRecords.map((record) => (
                        <div key={`${record.name}-${record.rank}`} className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/60 px-4 py-3">
                          <div>
                            <div className="font-semibold">{record.rank}. {record.name}</div>
                            <div className="text-xs text-muted-foreground">{localizedEventDateLabel(record.date, localeTag)}</div>
                          </div>
                          <div className="text-right">
                            <TrackRecordTimeLink
                              time={record.time}
                              sourceKind={record.sourceKind}
                              sourceLabel={record.sourceLabel}
                              sourceHref={record.sourceHref}
                              className="font-mono text-sm font-bold text-foreground"
                            />
                            <div className="text-xs text-muted-foreground">{record.verified ? "Verified" : "Pending"}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-5 text-sm text-muted-foreground">
                      No route records yet.
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
                  <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">History</div>
                  <h3 className="mt-2 font-display text-xl font-bold">Previous editions</h3>
                  {data.previousEditions.length ? (
                    <div className="mt-5 space-y-2">
                      {data.previousEditions.map((edition) => (
                        <Link
                          key={edition.slug}
                          to={`/events/${edition.slug}`}
                          className="flex items-center justify-between rounded-xl border border-border/70 bg-background/60 px-4 py-3 text-sm text-foreground transition-colors hover:bg-secondary"
                        >
                          <span>{edition.label}</span>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-5 text-sm text-muted-foreground">
                      Archived editions will appear here once race history is available.
                    </div>
                  )}
                </div>
              </div>
            </ScrollReveal>
          </div>
        )}

        {activeTab === "Statistics" ? (
          <EventStatisticsPanel
            eventName={data.name}
            categories={categories}
            rows={participantRows}
            selectedCategorySlug={selectedCategory?.slug}
            onSelectedCategorySlugChange={setSelectedCategorySlug}
          />
        ) : null}

        {activeTab === "Community" && (
          <div className="grid gap-8 xl:grid-cols-[minmax(0,1.1fr)_360px]">
            <div className="space-y-6">
              <ScrollReveal delay={0.06}>
                <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Runner contributions</div>
                      <h3 className="mt-2 font-display text-xl font-bold">Share race-day photos</h3>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                        All signed-in users can contribute up to six JPG, PNG, or WebP photos. New uploads stay private while the organizer reviews them.
                      </p>
                    </div>
                    <Camera className="h-5 w-5 text-primary" />
                  </div>

                  {user ? (
                    <div className="mt-5 rounded-2xl border border-dashed border-primary/30 bg-primary/[0.035] p-4">
                      <label className="block">
                        <span className="text-sm font-semibold text-foreground">Choose photos</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          multiple
                          onChange={(event) => setCommunityPhotoFiles(Array.from(event.target.files ?? []).slice(0, 6))}
                          className="mt-3 block w-full cursor-pointer rounded-xl border border-border bg-background text-sm text-muted-foreground file:mr-4 file:border-0 file:bg-primary file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-primary-foreground hover:file:bg-primary/90"
                        />
                      </label>
                      {communityPhotoFiles.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {communityPhotoFiles.map((file) => (
                            <span key={`${file.name}-${file.lastModified}`} className="max-w-full truncate rounded-full bg-background px-3 py-1 text-xs text-muted-foreground">
                              {file.name}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                        <span className="text-xs text-muted-foreground">Maximum 20 MB per photo.</span>
                        <button
                          type="button"
                          onClick={handleCommunityPhotoSubmit}
                          disabled={!communityPhotoFiles.length || isSubmittingCommunityPhotos}
                          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-warm transition-all hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isSubmittingCommunityPhotos ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                          {isSubmittingCommunityPhotos ? "Uploading…" : t("event.detail.sendForReview")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/70 bg-background/60 p-4">
                      <p className="text-sm text-muted-foreground">Sign in to upload photos from this race.</p>
                      <Link
                        to={`/auth?${new URLSearchParams({ next: `/events/${data.slug}?tab=community` }).toString()}`}
                        className="inline-flex items-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-warm"
                      >
                        Sign in to contribute
                      </Link>
                    </div>
                  )}
                </div>
              </ScrollReveal>

              {data.editionId ? (
                <ScrollReveal delay={0.1}>
                  <EventCommunityFeedback
                    eventEditionId={data.editionId}
                    eventSlug={data.slug}
                    viewerAthleteProfileId={account?.primaryAthleteProfileId ?? null}
                  />
                </ScrollReveal>
              ) : null}
            </div>

            <div className="space-y-4">
              <ScrollReveal delay={0.12} direction="right" distance={16}>
                <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
                  <div className="mb-4 flex items-center gap-2">
                    <Globe className="h-4 w-4 text-primary" />
                    <h3 className="font-display text-sm font-bold">Follow the Race</h3>
                  </div>
                  {socialLinks.length ? (
                    <div className="space-y-3">
                      {socialLinks.map((item) => (
                        <a
                          key={item.label}
                          href={item.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between rounded-xl border border-border bg-background/70 px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
                        >
                          <span className="inline-flex items-center gap-2">
                            <item.icon className="h-4 w-4 text-primary" />
                            {item.label}
                          </span>
                          <ExternalLink className="h-4 w-4 text-muted-foreground" />
                        </a>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      Public social links will appear after they are added to the race.
                    </div>
                  )}
                </div>
              </ScrollReveal>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
