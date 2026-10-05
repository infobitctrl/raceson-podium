import { documentTitleKey, useDocumentTitle } from "@/shared/navigation/documentTitle";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  ArrowDown,
  ArrowUp,
  Building2,
  Calendar,
  ChevronRight,
  CircleHelp,
  Clock3,
  Compass,
  ExternalLink,
  FileText,
  Flag,
  ListFilter,
  Loader2,
  Mail,
  MapPin,
  Minus,
  Mountain,
  Phone,
  Route,
  Shield,
  Star,
  Trophy,
  Users,
  Globe,
} from "lucide-react";
import ScrollReveal from "@/components/shared/ScrollReveal";
import { useStickyTabs } from "@/hooks/use-sticky-tabs";
import { ResponsiveSectionTabs } from "@/shared/navigation/ResponsiveSectionTabs";
import { brandLandscapes } from "@/assets/brand-landscapes";
import medvednicaRoundImageAsset from "@/assets/track-themes/medvednica-autumn-forest-card.webp";
import {
  LeagueOverviewExperience,
  LeagueResultsExperience,
  LeagueSeasonHeader,
  LeagueSeasonTitle,
} from "@/features/leagues/public/components/LeagueSeasonExperience";
import { LeagueInsightsPanel } from "@/features/leagues/public/components/LeagueInsightsPanel";
import {
  buildLeagueRoundLookupByCategory,
  buildUniqueLeagueRoster,
  type LeagueRosterRow,
} from "@/features/leagues/public/model/leaguePublicModel";
import {
  getLeagueCompetitionRankingBoards,
} from "@/features/leagues/public/model/leagueLeaderGroups";
import {
  isSibenikTrailLeague,
  SIBENIK_TRAIL_LEAGUE_MEDIA,
} from "@/features/leagues/public/data/sibenikTrailLeague";
import {
  getLeaguePlanningDescriptionMetadata,
  summarizeLeagueDescription,
  type LeaguePlanningDescriptionMetadata,
} from "@/features/leagues/model/leagueDescription";
import { LeaguePointsCurveChart } from "@/features/leagues/organizer/components/LeagueScoringCurveEditor";
import {
  normalizePublicResultClubName,
} from "@/features/results/public/model/publicResultPresentation";
import {
  getPublicRaceLifecycleLabel,
  getPublicRaceLifecycleLabelKey,
  getPublicRaceLifecycleStatus,
} from "@/features/events/public/model/eventStatusPresentation";
import {
  getPublicLeagueDetail,
  type PublicLeagueClubStandingItem,
  type PublicLeagueCompetitionReadModel,
  type PublicLeagueDetailReadModel,
  type PublicLeagueEntryItem,
  type PublicLeagueRoundItem,
  type PublicLeagueStandingItem,
} from "@/lib/league-read-models";
import {
  getPublicEventParticipantsReadModel,
  type PublicEventParticipantRow,
} from "@/lib/portal-read-models";
import { staticAssetUrl } from "@/lib/static-asset";
import { PLATFORM_AGE_CATEGORIES, platformAgeCategoryOrder } from "@/shared/domain/ageCategories";
import {
  formatSexClassificationLabel,
  formatUniversalAgeCategoryLabel,
} from "@/shared/domain/competitiveClassification";
import { MobileDetailDisclosure } from "@/shared/mobile/MobileDetailDisclosure";
import {
  OrganizationSocialLinks,
} from "@/shared/organizer/OrganizationSocialLinks";
import { organizationHasSocialLinks } from "@/shared/organizer/publicOrganizationSocialLinks";
import { SportBadgeList } from "@/shared/sports";
import { useI18n } from "@/shared/i18n/I18nContext";
import {
  localizedLeagueDataLabel,
  localizedLeagueLocation,
} from "@/features/leagues/public/model/leagueLocale";

const leagueFeaturedImage = brandLandscapes.mountainRidgeSunny;
const leagueRidgeImage = brandLandscapes.karstBasinClouds;
const leagueRiverImage = brandLandscapes.lakeReflection;
const promoLeagueImage = brandLandscapes.coastHighRidge;
const medvednicaRoundImage = staticAssetUrl(medvednicaRoundImageAsset);

const tabs = ["Overview", "Registrations", "Results", "Statistics", "Rules"] as const;
type LeagueTab = (typeof tabs)[number];
const tabMessageKeys = {
  Overview: "league.tab.overview",
  Registrations: "league.tab.registrations",
  Results: "league.tab.results",
  Statistics: "league.tab.statistics",
  Rules: "league.tab.rules",
} as const;

const ALL_STAGES_VALUE = "__all_stages__";
const LEAGUE_RANKING_VALUE = "__league_ranking__";
type RegistrationView = "athletes" | "clubs" | "categories";
type ResultsView = "individual" | "clubs" | "categories";

const resultStatusClasses: Record<string, string> = {
  registered: "bg-muted/60 text-muted-foreground border border-border",
  checked_in: "bg-primary/10 text-primary border border-primary/15",
  started: "bg-trail-amber/10 text-trail-amber border border-trail-amber/15",
  finished: "timing-lime-pill border",
  dnf: "bg-trail-red/10 text-trail-red border border-trail-red/15",
  dns: "bg-muted/60 text-muted-foreground border border-border",
  dsq: "bg-trail-red/10 text-trail-red border border-trail-red/15",
};

function coerceLeagueTab(value: string | null): LeagueTab {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "registrations" || normalized === "registration") return "Registrations";
  if (normalized === "results") return "Results";
  if (normalized === "insights" || normalized === "statistics" || normalized === "stats") return "Statistics";
  if (normalized === "rules") return "Rules";
  return "Overview";
}

function formatLeagueStatusLabel(status: PublicLeagueDetailReadModel["status"]) {
  if (status === "completed") return "Season complete";
  if (status === "upcoming") return "Season upcoming";
  return "Season active";
}

function getLeagueHeroVisual(slug: string) {
  if (slug.includes("adriatic")) {
    return {
      imageSrc: leagueRiverImage,
      imageAlt: "Coastal league season backdrop",
      imagePositionClassName: "object-[center_62%]",
      eyebrow: "Coastal League Season",
    };
  }

  if (slug.includes("sky") || slug.includes("balkan")) {
    return {
      imageSrc: leagueRidgeImage,
      imageAlt: "Mountain ridge league season backdrop",
      imagePositionClassName: "object-[center_58%]",
      eyebrow: "Mountain League Season",
    };
  }

  if (slug.includes("winter") || slug.includes("night")) {
    return {
      imageSrc: promoLeagueImage,
      imageAlt: "League season backdrop",
      imagePositionClassName: "object-[center_52%]",
      eyebrow: "Special League Season",
    };
  }

  return {
    imageSrc: leagueFeaturedImage,
    imageAlt: "Trail league season backdrop",
    imagePositionClassName: "object-[center_60%]",
    eyebrow: "League Season",
  };
}

function buildLeagueHeroDescription(league: PublicLeagueDetailReadModel) {
  const fallback = league.summary.nextStageLabel
    ? `Track the full season through linked race stages, with registrations, results, club scoring, and category ranking all anchored around ${league.summary.nextStageLabel}.`
    : "Track the full season through linked race stages, with registrations, results, club scoring, and category ranking all visible from one public league hub.";

  return summarizeLeagueDescription(league.description, fallback);
}

function formatRegistrationStatusLabel(
  status: string,
  t?: ReturnType<typeof useI18n>["t"],
) {
  const normalized = status.trim().toLowerCase();
  if (normalized === "confirmed") return t?.("league.status.confirmed") ?? "Confirmed";
  if (normalized === "pending") return t?.("league.status.pending") ?? "Pending";
  if (normalized === "waitlisted") return t?.("league.status.waitlisted") ?? "Waitlisted";
  return normalized.replace(/_/g, " ");
}

function formatParticipationStatusLabel(
  status: string,
  t?: ReturnType<typeof useI18n>["t"],
) {
  const normalized = status.trim().toLowerCase();
  if (normalized === "not_started") return t?.("league.status.registered") ?? "Registered";
  if (normalized === "checked_in") return t?.("league.status.checkedIn") ?? "Checked in";
  if (normalized === "started") return t?.("league.status.onCourse") ?? "On route";
  if (normalized === "finished") return t?.("league.status.finished") ?? "Finished";
  if (normalized === "dnf") return "DNF";
  if (normalized === "dns") return "DNS";
  if (normalized === "dsq") return "DSQ";
  return normalized.replace(/_/g, " ");
}

function resolveEntryResultStatus(
  entry: PublicLeagueEntryItem,
  t?: ReturnType<typeof useI18n>["t"],
) {
  if (entry.participationStatus === "finished" && entry.time !== "-") {
    return { key: "finished", label: t?.("league.status.finished") ?? "Finished" };
  }
  if (entry.participationStatus === "dnf") {
    return { key: "dnf", label: "DNF" };
  }
  if (entry.participationStatus === "dns") {
    return { key: "dns", label: "DNS" };
  }
  if (entry.participationStatus === "dsq" || entry.resultStatus === "void") {
    return { key: "dsq", label: "DSQ" };
  }
  if (entry.participationStatus === "checked_in") {
    return { key: "checked_in", label: t?.("league.status.checkedIn") ?? "Checked in" };
  }
  if (entry.participationStatus === "started") {
    return { key: "started", label: t?.("league.status.onCourse") ?? "On route" };
  }
  return { key: "registered", label: formatRegistrationStatusLabel(entry.registrationStatus, t) };
}

function formatRoundStatusLabel(
  round: PublicLeagueRoundItem,
  t?: ReturnType<typeof useI18n>["t"],
) {
  return t?.(getPublicRaceLifecycleLabelKey(round.status))
    ?? getPublicRaceLifecycleLabel(round.status);
}

function roundStatusClasses(round: PublicLeagueRoundItem) {
  if (getPublicRaceLifecycleStatus(round.status) === "finished") return "timing-lime-pill border";
  return "bg-primary/10 text-primary border border-primary/15";
}

type LeagueSeasonPhase = "season_start" | "early_season" | "mid_season" | "late_season" | "season_finish";

const leagueSeasonLabels: Record<LeagueSeasonPhase, string> = {
  season_start: "Season Start",
  early_season: "Early Season",
  mid_season: "Mid Season",
  late_season: "Late Season",
  season_finish: "Season Finish",
};

const leagueSeasonOverlayClasses: Record<LeagueSeasonPhase, string> = {
  season_start: "!border-[rgba(125,211,252,0.96)] !bg-[rgba(2,132,199,0.96)] !text-white ring-1 ring-[rgba(224,242,254,0.34)] shadow-[0_16px_34px_-18px_rgba(2,132,199,0.98)] dark:!bg-[rgba(3,105,161,0.98)] dark:shadow-[0_16px_34px_-18px_rgba(3,105,161,0.98)]",
  early_season: "!border-[rgba(110,231,183,0.96)] !bg-[rgba(5,150,105,0.96)] !text-white ring-1 ring-[rgba(209,250,229,0.34)] shadow-[0_16px_34px_-18px_rgba(5,150,105,0.98)] dark:!bg-[rgba(4,120,87,0.98)] dark:shadow-[0_16px_34px_-18px_rgba(4,120,87,0.98)]",
  mid_season: "!border-[rgba(252,211,77,0.96)] !bg-[rgba(217,119,6,0.96)] !text-white ring-1 ring-[rgba(254,243,199,0.34)] shadow-[0_16px_34px_-18px_rgba(217,119,6,0.98)]",
  late_season: "!border-[rgba(253,186,116,0.96)] !bg-[rgba(234,88,12,0.96)] !text-white ring-1 ring-[rgba(254,215,170,0.34)] shadow-[0_16px_34px_-18px_rgba(234,88,12,0.98)] dark:!bg-[rgba(194,65,12,0.98)] dark:shadow-[0_16px_34px_-18px_rgba(194,65,12,0.98)]",
  season_finish: "!border-[rgba(253,164,175,0.96)] !bg-[rgba(225,29,72,0.96)] !text-white ring-1 ring-[rgba(254,205,211,0.34)] shadow-[0_16px_34px_-18px_rgba(225,29,72,0.98)]",
};

const featuredMarkerPillClass =
  "inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/[0.08] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-primary";

const glassInfoPillClass =
  "inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/28 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur-md";

const featuredActionButtonClass =
  "inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-warm transition-all hover:shadow-glow";

function getLeagueSeasonPhase(completedRounds: number, totalRounds: number): LeagueSeasonPhase {
  if (totalRounds <= 0) return "season_start";
  if (completedRounds <= 0) return "season_start";

  const progress = completedRounds / totalRounds;
  if (progress >= 1) return "season_finish";
  if (progress <= 0.34) return "early_season";
  if (progress <= 0.67) return "mid_season";
  return "late_season";
}

function getLeagueRoundDisplay(completedRounds: number, totalRounds: number) {
  if (totalRounds <= 0) return "0/0";
  return `${Math.min(completedRounds + 1, totalRounds)}/${totalRounds}`;
}

function getLeagueCoverageLabel(
  groupedRoundEvents: ReturnType<typeof groupRoundsByEvent>,
) {
  const venueCount = groupedRoundEvents.length;
  const countries = new Set(
    groupedRoundEvents
      .map((group) => group.location.split(",").slice(-1)[0]?.trim())
      .filter(Boolean),
  );

  if (countries.size === 1) {
    return `${venueCount} venue${venueCount === 1 ? "" : "s"} · ${Array.from(countries)[0]}-wide`;
  }

  if (countries.size > 1) {
    return `${venueCount} venue${venueCount === 1 ? "" : "s"} · Regional circuit`;
  }

  return `${venueCount} venue${venueCount === 1 ? "" : "s"} · League season`;
}

function getLeagueTopByGender(
  standings: PublicLeagueStandingItem[],
  gender: PublicLeagueStandingItem["gender"],
  limit = 3,
) {
  return standings
    .filter((standing) => standing.gender === gender)
    .slice(0, limit);
}

function getRoundCalendarBits(round: PublicLeagueRoundItem) {
  if (round.dateIso) {
    const parsed = new Date(`${round.dateIso}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      return {
        month: parsed.toLocaleString("en-US", { month: "short" }).toUpperCase(),
        day: parsed.toLocaleString("en-US", { day: "2-digit" }),
      };
    }
  }

  const parsed = new Date(round.date);
  if (!Number.isNaN(parsed.getTime())) {
    return {
      month: parsed.toLocaleString("en-US", { month: "short" }).toUpperCase(),
      day: parsed.toLocaleString("en-US", { day: "2-digit" }),
    };
  }

  return { month: "TBA", day: "--" };
}

function categorySortIndex(value: string) {
  const leagueDefaultIndex = ["Overall", "Female", "Male"].indexOf(
    formatSexClassificationLabel(value),
  );
  if (leagueDefaultIndex >= 0) return leagueDefaultIndex;
  const normalized = formatUniversalAgeCategoryLabel(value);
  const platformIndex = platformAgeCategoryOrder(normalized);
  if (platformIndex < PLATFORM_AGE_CATEGORIES.length) return 10 + platformIndex;
  if (normalized === "Open") return Number.MAX_SAFE_INTEGER;

  const minimumAge = normalized.match(/\d+/)?.[0];
  return minimumAge ? Number(minimumAge) : Number.MAX_SAFE_INTEGER - 1;
}

function leagueCategoryLabels(
  value: Pick<PublicLeagueEntryItem | PublicLeagueStandingItem, "leagueCategoryLabels">,
) {
  const labels = value.leagueCategoryLabels?.length
    ? value.leagueCategoryLabels
    : ["Open"];
  return Array.from(new Set(labels.map(formatSexClassificationLabel)));
}

function compareEntries(left: PublicLeagueEntryItem, right: PublicLeagueEntryItem) {
  if (left.roundNumber !== right.roundNumber) return left.roundNumber - right.roundNumber;
  if (left.overall > 0 && right.overall > 0) return left.overall - right.overall;
  if (left.overall > 0) return -1;
  if (right.overall > 0) return 1;
  return left.name.localeCompare(right.name);
}

function normalizeLeagueEntryGender(value: string): PublicLeagueEntryItem["gender"] {
  const normalized = value.trim().toUpperCase();
  if (normalized === "M") return "M";
  if (normalized === "F") return "F";
  return "U";
}

function mapParticipantRowToLeagueEntry(
  row: PublicEventParticipantRow,
  round: PublicLeagueRoundItem,
  existingEntry?: PublicLeagueEntryItem,
): PublicLeagueEntryItem {
  const club = normalizePublicResultClubName(row.club);
  return {
    registrationId: row.registrationId,
    athleteId: row.athleteId,
    roundId: round.roundId,
    roundNumber: round.roundNumber,
    eventEditionId: round.eventEditionId,
    eventCategoryId: row.categoryId,
    eventSlug: round.eventSlug,
    eventName: round.name,
    categorySlug: row.categorySlug || existingEntry?.categorySlug || "",
    categoryName: row.categoryLabel || existingEntry?.categoryName || round.categoryName,
    stageLabel: round.stageLabel,
    roundStatus: round.status === "completed" ? "completed" : "upcoming",
    date: round.date,
    dateIso: round.dateIso,
    location: round.location,
    bib: row.bib ?? existingEntry?.bib ?? "—",
    athleteSlug: row.athleteSlug || existingEntry?.athleteSlug || "athletes",
    name: row.name || existingEntry?.name || "Trail Runner",
    club,
    clubSlug: club ? row.clubSlug : null,
    gender: normalizeLeagueEntryGender(row.gender),
    ageCategory: row.ageCategory || existingEntry?.ageCategory || "Open",
    leagueCategoryLabels: existingEntry?.leagueCategoryLabels?.length
      ? existingEntry.leagueCategoryLabels
      : [row.classificationLabel],
    age: existingEntry?.age ?? null,
    registrationStatus: row.registrationStatus || existingEntry?.registrationStatus || "confirmed",
    participationStatus: row.participationStatus || existingEntry?.participationStatus || "not_started",
    resultStatus: row.resultStatus || existingEntry?.resultStatus || "uncomputed",
    publicationState: row.publicationState ?? existingEntry?.publicationState ?? null,
    publishedAt: row.publishedAt ?? existingEntry?.publishedAt ?? null,
    time: row.time || existingEntry?.time || "-",
    overall: row.overall || existingEntry?.overall || 0,
    genderRank: row.genderRank || existingEntry?.genderRank || 0,
    ageRank: row.ageRank || existingEntry?.ageRank || 0,
    leaguePoints: existingEntry?.leaguePoints ?? 0,
    leagueRank: existingEntry?.leagueRank ?? null,
  };
}

function representedLeagueClub(entry: Pick<PublicLeagueEntryItem, "club" | "clubSlug">) {
  const club = normalizePublicResultClubName(entry.club);
  if (!club) return null;
  const clubSlug = entry.clubSlug?.trim() || null;
  return {
    key: clubSlug ?? club,
    club,
    clubSlug,
  };
}

function groupRoundsByEvent(rounds: PublicLeagueRoundItem[]) {
  const grouped = new Map<
    string,
    {
      eventEditionId: string;
      eventSlug: string;
      eventName: string;
      date: string;
      dateIso: string | null;
      location: string;
      rounds: PublicLeagueRoundItem[];
    }
  >();

  for (const round of rounds) {
    const existing = grouped.get(round.eventEditionId);
    if (existing) {
      existing.rounds.push(round);
      continue;
    }
    grouped.set(round.eventEditionId, {
      eventEditionId: round.eventEditionId,
      eventSlug: round.eventSlug,
      eventName: round.name,
      date: round.date,
      dateIso: round.dateIso,
      location: round.location,
      rounds: [round],
    });
  }

  return Array.from(grouped.values()).sort((left, right) => {
    if (left.dateIso && right.dateIso) {
      return left.dateIso.localeCompare(right.dateIso);
    }
    if (left.dateIso) return -1;
    if (right.dateIso) return 1;
    return left.eventName.localeCompare(right.eventName);
  });
}

function buildRegistrationClubSummary(entries: PublicLeagueEntryItem[]) {
  const grouped = new Map<
    string,
    {
      key: string;
      club: string;
      clubSlug: string | null;
      runners: number;
      confirmed: number;
      pending: number;
      stages: Set<string>;
      categories: Set<string>;
      athletes: Set<string>;
      confirmedAthletes: Set<string>;
      pendingAthletes: Set<string>;
    }
  >();

  for (const entry of entries) {
    const representedClub = representedLeagueClub(entry);
    if (!representedClub) continue;
    const current = grouped.get(representedClub.key) ?? {
      key: representedClub.key,
      club: representedClub.club,
      clubSlug: representedClub.clubSlug,
      runners: 0,
      confirmed: 0,
      pending: 0,
      stages: new Set<string>(),
      categories: new Set<string>(),
      athletes: new Set<string>(),
      confirmedAthletes: new Set<string>(),
      pendingAthletes: new Set<string>(),
    };
    const athleteKey = entry.athleteId || entry.athleteSlug || entry.name;
    current.athletes.add(athleteKey);
    if (entry.registrationStatus === "confirmed") current.confirmedAthletes.add(athleteKey);
    if (entry.registrationStatus === "pending") current.pendingAthletes.add(athleteKey);
    current.runners = current.athletes.size;
    current.confirmed = current.confirmedAthletes.size;
    current.pending = current.pendingAthletes.size;
    current.stages.add(entry.roundId);
    for (const category of leagueCategoryLabels(entry)) current.categories.add(category);
    grouped.set(representedClub.key, current);
  }

  return Array.from(grouped.values()).sort((left, right) => {
    if (left.runners !== right.runners) return right.runners - left.runners;
    return left.club.localeCompare(right.club);
  });
}

function buildRegistrationCategorySummary(entries: PublicLeagueEntryItem[]) {
  const grouped = new Map<
    string,
    {
      category: string;
      runners: number;
      confirmed: number;
      pending: number;
      clubs: Set<string>;
      stages: Set<string>;
      athletes: Set<string>;
      confirmedAthletes: Set<string>;
      pendingAthletes: Set<string>;
    }
  >();

  for (const entry of entries) {
    for (const category of leagueCategoryLabels(entry)) {
      const current = grouped.get(category) ?? {
        category,
        runners: 0,
        confirmed: 0,
        pending: 0,
        clubs: new Set<string>(),
        stages: new Set<string>(),
        athletes: new Set<string>(),
        confirmedAthletes: new Set<string>(),
        pendingAthletes: new Set<string>(),
      };
      const athleteKey = entry.athleteId || entry.athleteSlug || entry.name;
      current.athletes.add(athleteKey);
      if (entry.registrationStatus === "confirmed") current.confirmedAthletes.add(athleteKey);
      if (entry.registrationStatus === "pending") current.pendingAthletes.add(athleteKey);
      current.runners = current.athletes.size;
      current.confirmed = current.confirmedAthletes.size;
      current.pending = current.pendingAthletes.size;
      const representedClub = representedLeagueClub(entry);
      if (representedClub) current.clubs.add(representedClub.key);
      current.stages.add(entry.roundId);
      grouped.set(category, current);
    }
  }

  return Array.from(grouped.values()).sort((left, right) => {
    const orderDelta = categorySortIndex(left.category) - categorySortIndex(right.category);
    if (orderDelta !== 0) return orderDelta;
    return left.category.localeCompare(right.category);
  });
}

function buildResultClubSummary(entries: PublicLeagueEntryItem[]) {
  const grouped = new Map<
    string,
    {
      key: string;
      club: string;
      clubSlug: string | null;
      runners: number;
      finishers: number;
      points: number;
      bestRank: number | null;
      stages: Set<string>;
      topAthletes: string[];
    }
  >();

  for (const entry of entries) {
    const representedClub = representedLeagueClub(entry);
    if (!representedClub) continue;
    const current = grouped.get(representedClub.key) ?? {
      key: representedClub.key,
      club: representedClub.club,
      clubSlug: representedClub.clubSlug,
      runners: 0,
      finishers: 0,
      points: 0,
      bestRank: null,
      stages: new Set<string>(),
      topAthletes: [],
    };
    current.runners += 1;
    current.finishers += entry.participationStatus === "finished" || entry.overall > 0 ? 1 : 0;
    current.points += entry.leaguePoints;
    current.stages.add(entry.roundId);
    if (entry.overall > 0 && (current.bestRank == null || entry.overall < current.bestRank)) {
      current.bestRank = entry.overall;
    }
    if (!current.topAthletes.includes(entry.name) && current.topAthletes.length < 3) {
      current.topAthletes.push(entry.name);
    }
    grouped.set(representedClub.key, current);
  }

  return Array.from(grouped.values()).sort((left, right) => {
    if (left.points !== right.points) return right.points - left.points;
    if (left.finishers !== right.finishers) return right.finishers - left.finishers;
    return left.club.localeCompare(right.club);
  });
}

function groupStandingsByCategory(standings: PublicLeagueStandingItem[]) {
  const grouped = new Map<string, PublicLeagueStandingItem[]>();
  for (const standing of standings) {
    for (const category of leagueCategoryLabels(standing)) {
      const current = grouped.get(category) ?? [];
      current.push(standing);
      grouped.set(category, current);
    }
  }

  return Array.from(grouped.entries())
    .sort((left, right) => {
      const orderDelta = categorySortIndex(left[0]) - categorySortIndex(right[0]);
      if (orderDelta !== 0) return orderDelta;
      return left[0].localeCompare(right[0]);
    })
    .map(([category, rows]) => ({
      category,
      rows: [...rows].sort((left, right) => left.rank - right.rank),
    }));
}

function groupResultsByCategory(entries: PublicLeagueEntryItem[]) {
  const grouped = new Map<string, PublicLeagueEntryItem[]>();
  for (const entry of entries) {
    for (const category of leagueCategoryLabels(entry)) {
      const current = grouped.get(category) ?? [];
      current.push(entry);
      grouped.set(category, current);
    }
  }

  return Array.from(grouped.entries())
    .sort((left, right) => {
      const orderDelta = categorySortIndex(left[0]) - categorySortIndex(right[0]);
      if (orderDelta !== 0) return orderDelta;
      return left[0].localeCompare(right[0]);
    })
    .map(([category, rows]) => ({
      category,
      rows: [...rows].sort(compareEntries),
    }));
}

function formatResultsContextLabel(
  focus: string,
  rounds: PublicLeagueRoundItem[],
  locale: ReturnType<typeof useI18n>["locale"],
  t: ReturnType<typeof useI18n>["t"],
) {
  if (focus === LEAGUE_RANKING_VALUE) return t("league.scope.leagueRanking");
  if (focus === ALL_STAGES_VALUE) return t("league.scope.allStages");
  const stageLabel = rounds.find((round) => round.roundId === focus)?.stageLabel;
  return stageLabel ? localizedLeagueDataLabel(stageLabel, locale) : t("league.scope.selectedStage");
}

function ChangeIndicator({ change }: { change: number }) {
  if (change > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-trail-green">
        <ArrowUp className="h-3 w-3" />
        {change}
      </span>
    );
  }

  if (change < 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-trail-red">
        <ArrowDown className="h-3 w-3" />
        {Math.abs(change)}
      </span>
    );
  }

  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
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

function PillGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isActive = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
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
    </div>
  );
}

function LeagueStatCard({
  label,
  value,
  detail,
  accent = false,
}: {
  label: string;
  value: string | number;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-5 shadow-soft ${accent ? "border-primary/20 bg-primary/[0.04]" : "border-border bg-card"}`}>
      <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">{label}</div>
      <div className="mt-3 font-display text-3xl font-bold text-foreground">{value}</div>
      <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

function RoundCalendarBadge({ round }: { round: PublicLeagueRoundItem }) {
  const { month, day } = getRoundCalendarBits(round);

  return (
    <span className="min-w-[3.2rem] shrink-0 rounded-[12px] border border-primary/14 bg-primary/[0.07] px-2 py-1.5 text-center text-primary shadow-none">
      <span className="block text-[7px] font-bold uppercase tracking-[0.18em] text-primary">{month}</span>
      <span className="mt-0.5 block font-display text-[0.92rem] font-black leading-none text-primary">{day}</span>
    </span>
  );
}

function LeagueOverviewShowcase({
  league,
  rounds,
  groupedRoundEvents,
  heroImage,
  leaderMenTop,
  leaderWomenTop,
}: {
  league: PublicLeagueDetailReadModel;
  rounds: PublicLeagueRoundItem[];
  groupedRoundEvents: ReturnType<typeof groupRoundsByEvent>;
  heroImage: string;
  leaderMenTop: PublicLeagueStandingItem[];
  leaderWomenTop: PublicLeagueStandingItem[];
}) {
  const completed = Math.min(league.summary.completedRounds, rounds.length);
  const currentRound = rounds.length ? Math.min(completed + 1, rounds.length) : 0;
  const roundDisplay = getLeagueRoundDisplay(completed, rounds.length);
  const seasonPhase = getLeagueSeasonPhase(completed, rounds.length);
  const seasonOverlayPillClass = leagueSeasonOverlayClasses[seasonPhase];
  const nextRound =
    [...rounds]
      .filter((round) => round.status !== "completed")
      .sort((left, right) => {
        if (left.dateIso && right.dateIso) return left.dateIso.localeCompare(right.dateIso);
        if (left.dateIso) return -1;
        if (right.dateIso) return 1;
        return left.roundNumber - right.roundNumber;
      })[0] ?? null;
  const registeredLabel = `${league.summary.totalRegistrations.toLocaleString("en-US")} Registered`;
  const coverageLabel = getLeagueCoverageLabel(groupedRoundEvents);

  return (
    <div className="group relative block h-full overflow-hidden rounded-[34px] border border-border/70 bg-card shadow-[0_20px_70px_-34px_hsl(25_30%_12%_/_0.35)] transition-all duration-300">
      <div className="absolute inset-0 bg-gradient-to-br from-white/65 via-transparent to-primary/[0.03] dark:from-white/[0.025] dark:via-transparent dark:to-primary/[0.055]" />
      <div className="absolute inset-0 route-pattern opacity-55" />
      <div className="grid h-full min-h-[520px] gap-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(320px,0.88fr)]">
        <div className="relative z-10 flex flex-col p-6 md:p-8">
          <div className="max-w-xl">
            <span className={featuredMarkerPillClass}>
              <Star className="h-3.5 w-3.5" />
              Featured League
            </span>
            <SportBadgeList
              sportCodes={league.sportCodes}
              primarySportCode={league.primarySportCode}
              className="mt-3"
            />
            <h2 className="mt-3 font-display text-4xl font-black leading-tight text-foreground md:text-[3.2rem]">
              {league.name}
            </h2>
            <p className="mt-4 max-w-lg text-sm leading-7 text-muted-foreground md:text-base">
              {buildLeagueHeroDescription(league)}
            </p>
          </div>

          <div className="mt-8 grid gap-3">
            <div className="rounded-[24px] border border-border/70 bg-background/85 p-4 shadow-soft">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                <Compass className="h-3.5 w-3.5 text-trail-amber" />
                Series footprint
              </div>
              <div className="mt-2 text-base font-semibold text-foreground">{coverageLabel}</div>
              <div className="mt-3 grid gap-1.5">
                {rounds.map((round, roundIndex) => (
                  <Link
                    key={round.roundId}
                    to={`/events/${round.eventSlug}${round.hasPublishedResults ? "?tab=results" : "?tab=registrations"}`}
                    className="group/round flex items-center gap-2.5 py-0.5"
                  >
                    <div className="flex h-11 w-2 shrink-0 items-center justify-center">
                      <div
                        className={`w-1.5 rounded-full ${
                          roundIndex < completed
                            ? "h-11 bg-primary"
                            : roundIndex === currentRound - 1
                              ? "h-11 border border-primary bg-primary/12"
                              : "h-11 bg-border/85"
                        }`}
                      />
                    </div>
                    <RoundCalendarBadge round={round} />
                    <div className="min-w-0">
                      <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground transition-colors group-hover/round:text-primary">
                        Round {round.roundNumber}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span className="min-w-0 text-[13px] font-semibold leading-4 text-foreground transition-colors group-hover/round:text-primary">
                          {round.stageLabel}
                        </span>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-primary opacity-0 transition-all group-hover/round:translate-x-0.5 group-hover/round:opacity-100" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            <div className="rounded-[24px] border border-border/70 bg-background/85 p-4 shadow-soft">
              <div className="flex items-center gap-2.5">
                <div className="flex w-8 shrink-0 items-center justify-center self-stretch text-trail-amber">
                  <Trophy className="h-5 w-5" />
                </div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-trail-amber">Current leaders</div>
              </div>
              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                {[
                  { label: "Male", shortLabel: "M", leaders: leaderMenTop },
                  { label: "Female", shortLabel: "F", leaders: leaderWomenTop },
                ].map((group) => (
                  <div key={group.label} className="px-1 py-1">
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/16 bg-primary/10 text-[11px] font-black uppercase tracking-[0.18em] text-primary">
                        {group.shortLabel}
                      </span>
                      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{group.label}</div>
                    </div>
                    <div className="mt-2.5 space-y-1.5">
                      {group.leaders.length ? (
                        group.leaders.map((leader, leaderIndex) => (
                          <Link
                            key={`${group.label}-${leader.athleteSlug}`}
                            to={`/athletes/${leader.athleteSlug}`}
                            className="group/leader flex items-center gap-2"
                          >
                            <span className="inline-flex w-4 shrink-0 justify-center text-[10px] font-bold text-primary">
                              {leaderIndex + 1}
                            </span>
                            <span className="min-w-0 text-[13px] font-semibold leading-4 text-foreground transition-colors group-hover/leader:text-primary">
                              {leader.name}
                            </span>
                            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-primary opacity-0 transition-all group-hover/leader:translate-x-0.5 group-hover/leader:opacity-100" />
                          </Link>
                        ))
                      ) : (
                        <div className="text-[13px] text-muted-foreground">Standings pending</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="relative min-h-[300px] border-l border-border/60">
          <div className="absolute inset-0 overflow-hidden rounded-b-[34px] [transform:translateZ(0)] lg:rounded-b-none lg:rounded-r-[34px]">
            <img
              src={heroImage}
              alt={league.name}
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 will-change-transform group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.08] via-trail-amber/[0.04] to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-t from-[hsl(215_18%_11%_/_0.72)] via-[hsl(215_18%_11%_/_0.3)] to-[hsl(15_100%_50%_/_0.1)]" />
            <div className="absolute inset-0 grain-overlay opacity-40" />
            <div className="absolute inset-0 topo-pattern opacity-60" />
            <div className="absolute -right-8 top-10 h-48 w-48 rounded-full bg-white/8 blur-3xl" />
            <div className="absolute -left-8 bottom-16 h-44 w-44 rounded-full bg-primary/18 blur-3xl" />
          </div>

          <div className={`absolute left-5 top-5 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] ${seasonOverlayPillClass}`}>
            {leagueSeasonLabels[seasonPhase]}
          </div>

          <div className="absolute right-5 top-5 flex flex-col items-end">
            <div className="flex min-w-[5.5rem] flex-col items-center justify-center rounded-[26px] border border-primary/30 bg-black/30 px-4 py-3 text-center text-white shadow-[0_16px_34px_-20px_rgba(0,0,0,0.72)] backdrop-blur-md">
              <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/70">ROUND</div>
              <div className="mt-1 font-display text-3xl font-black leading-none text-white">{roundDisplay}</div>
            </div>
          </div>

          <div className="absolute inset-x-5 bottom-5 flex flex-col items-start gap-4">
            {nextRound ? (
              <Link
                to={`/events/${nextRound.eventSlug}${nextRound.hasPublishedResults ? "?tab=results" : "?tab=registrations"}`}
                className="group/next inline-flex max-w-[15rem] flex-col rounded-[20px] border border-white/18 bg-black/28 px-3 py-3 text-left text-white shadow-[0_18px_36px_-24px_rgba(0,0,0,0.78)] backdrop-blur-md transition-all hover:border-primary hover:bg-primary hover:shadow-warm"
              >
                <div className="flex items-center justify-between gap-2 text-[9px] font-bold uppercase tracking-[0.2em] text-white">
                  <span>Next race</span>
                  <ArrowRight className="h-3.5 w-3.5 text-white transition-transform group-hover/next:translate-x-0.5" />
                </div>
                <div className="mt-2 flex items-start gap-2">
                  <Calendar className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold leading-5 text-white">{nextRound.stageLabel}</div>
                    <div className="mt-1 text-xs font-medium text-white">{nextRound.date}</div>
                  </div>
                </div>
              </Link>
            ) : null}

            <Link to={`/leagues/${league.slug}?tab=results`} className={featuredActionButtonClass}>
              View League Results <ArrowRight className="h-4 w-4" />
            </Link>

            <div className="flex flex-wrap justify-start gap-2">
              <span className={glassInfoPillClass}>
                <Users className="h-3.5 w-3.5 text-trail-amber" />
                {registeredLabel}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LeagueStandingsTable({
  rounds,
  rows,
}: {
  rounds: PublicLeagueRoundItem[];
  rows: PublicLeagueStandingItem[];
}) {
  if (!rows.length) {
    return (
      <EmptyState
        title="No league standings yet."
        description="League ranking will appear here once scored rounds are completed and standings are published."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
      <table className="table-zebra-orange w-full min-w-[1080px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            <th className="w-14 px-4 py-3.5">#</th>
            <th className="px-4 py-3.5">Athlete</th>
            <th className="px-4 py-3.5">Club</th>
            <th className="px-4 py-3.5">League Category</th>
            {rounds.map((round) => (
              <th key={round.roundId} className="px-4 py-3.5 text-center">
                R{round.roundNumber}
              </th>
            ))}
            <th className="px-4 py-3.5">Scored</th>
            <th className="px-4 py-3.5">Total</th>
            <th className="w-16 px-4 py-3.5">Move</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((standing) => (
            <tr key={standing.athleteSlug} className="border-b border-border/30 transition-colors hover:bg-primary/[0.02]">
              <td className="px-4 py-3.5">
                <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${standing.rank <= 3 ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}>
                  {standing.rank}
                </span>
              </td>
              <td className="px-4 py-3.5">
                <Link to={`/athletes/${standing.athleteSlug}`} className="font-medium transition-colors hover:text-primary">
                  {standing.name}
                </Link>
              </td>
              <td className="px-4 py-3.5 text-muted-foreground">
                {standing.clubSlug ? (
                  <Link to={`/clubs/${standing.clubSlug}`} className="transition-colors hover:text-primary">
                    {standing.club}
                  </Link>
                ) : (
                  standing.club
                )}
              </td>
              <td className="px-4 py-3.5 text-xs text-muted-foreground">{leagueCategoryLabels(standing).join(" · ")}</td>
              {rounds.map((round, index) => (
                <td key={`${standing.athleteSlug}-${round.roundId}`} className="px-4 py-3.5 text-center font-mono text-xs text-muted-foreground">
                  {standing.roundScores[index] ?? "—"}
                </td>
              ))}
              <td className="px-4 py-3.5 text-muted-foreground">{standing.races}</td>
              <td className="px-4 py-3.5 font-display font-bold text-primary">{standing.points}</td>
              <td className="px-4 py-3.5">
                <ChangeIndicator change={standing.change} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CategoryStandingsSections({
  sections,
}: {
  sections: Array<{ category: string; rows: PublicLeagueStandingItem[] }>;
}) {
  if (!sections.length) {
    return (
      <EmptyState
        title="No category league rankings yet."
        description="Category league ranking will appear here once the season has scored results."
      />
    );
  }

  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <div key={section.category} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">League Category</div>
              <h4 className="mt-2 font-display text-lg font-bold">{section.category}</h4>
            </div>
            <span className="rounded-full bg-secondary px-3 py-1 text-[11px] font-semibold text-secondary-foreground">
              {section.rows.length} ranked athletes
            </span>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-border bg-background/60">
            <table className="table-zebra-orange w-full min-w-[780px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  <th className="w-14 px-4 py-3.5">#</th>
                  <th className="px-4 py-3.5">Athlete</th>
                  <th className="px-4 py-3.5">Club</th>
                  <th className="px-4 py-3.5">Scored</th>
                  <th className="px-4 py-3.5">Points</th>
                  <th className="w-16 px-4 py-3.5">Move</th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map((standing, index) => (
                  <tr key={`${section.category}-${standing.athleteSlug}`} className="border-b border-border/30 transition-colors hover:bg-primary/[0.02]">
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${index < 3 ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}>
                        {index + 1}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <Link to={`/athletes/${standing.athleteSlug}`} className="font-medium transition-colors hover:text-primary">
                        {standing.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {standing.clubSlug ? (
                        <Link to={`/clubs/${standing.clubSlug}`} className="transition-colors hover:text-primary">
                          {standing.club}
                        </Link>
                      ) : (
                        standing.club
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">{standing.races}</td>
                    <td className="px-4 py-3.5 font-display font-bold text-primary">{standing.points}</td>
                    <td className="px-4 py-3.5">
                      <ChangeIndicator change={standing.change} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function LeagueClubStandingsTable({
  rows,
}: {
  rows: PublicLeagueClubStandingItem[];
}) {
  if (!rows.length) {
    return (
      <EmptyState
        title="No club standings yet."
        description="Club standings will appear here once the league has published scored results."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
      <table className="table-zebra-orange w-full min-w-[860px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            <th className="w-14 px-4 py-3.5">#</th>
            <th className="px-4 py-3.5">Club</th>
            <th className="px-4 py-3.5">Scoring athletes</th>
            <th className="px-4 py-3.5">Avg / scorer</th>
            <th className="px-4 py-3.5">Total points</th>
            <th className="w-16 px-4 py-3.5">Move</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((club) => (
            <tr key={club.clubSlug} className="border-b border-border/30 transition-colors hover:bg-primary/[0.02]">
              <td className="px-4 py-3.5">
                <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${club.rank <= 3 ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}>
                  {club.rank}
                </span>
              </td>
              <td className="px-4 py-3.5">
                <Link to={`/clubs/${club.clubSlug}`} className="font-medium transition-colors hover:text-primary">
                  {club.name}
                </Link>
              </td>
              <td className="px-4 py-3.5">
                <div className="text-muted-foreground">{club.members}</div>
                {club.scorers.length ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {club.scorers.map((scorer) => scorer.name).join(" · ")}
                  </div>
                ) : null}
              </td>
              <td className="px-4 py-3.5 text-muted-foreground">{club.avgPoints.toFixed(1)}</td>
              <td className="px-4 py-3.5 font-display font-bold text-primary">{club.points}</td>
              <td className="px-4 py-3.5">
                <ChangeIndicator change={club.change} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type RosterSortKey = "last_name" | "first_name" | "club" | "registrations" | "rounds" | "races" | "age_category" | "race_status";

function RegistrationAthletesTable({
  rows,
  isLoading = false,
}: {
  rows: LeagueRosterRow[];
  isLoading?: boolean;
}) {
  const { locale, t } = useI18n();
  const [sortKey, setSortKey] = useState<RosterSortKey>("last_name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const sortedRows = useMemo(() => {
    const values: Record<RosterSortKey, (row: LeagueRosterRow) => string | number> = {
      last_name: (row) => row.lastName,
      first_name: (row) => row.firstName,
      club: (row) => row.club,
      registrations: (row) => row.registrationCount,
      rounds: (row) => row.rounds.join("-"),
      races: (row) => row.startedRaceCount,
      age_category: (row) => row.ageCategory,
      race_status: (row) => `${row.latestRaceStatus}-${row.latestRoundNumber}`,
    };
    return [...rows].sort((left, right) => {
      const leftValue = values[sortKey](left);
      const rightValue = values[sortKey](right);
      const comparison = typeof leftValue === "number" && typeof rightValue === "number"
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true });
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [rows, sortDirection, sortKey]);

  const toggleSort = (key: RosterSortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  };

  const header = (label: string, key: RosterSortKey) => (
    <button type="button" onClick={() => toggleSort(key)} className="inline-flex items-center gap-1.5 text-left transition-colors hover:text-primary" aria-label={t("league.table.sortBy", { label })}>
      {label}
      {sortKey === key ? (sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowDown className="h-3 w-3 opacity-30" />}
    </button>
  );

  if (isLoading && !rows.length) {
    return (
      <div className="flex min-h-[220px] items-center justify-center rounded-2xl border border-border bg-card shadow-soft">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  if (!rows.length) {
    return (
      <EmptyState
        title={t("league.table.noRegistrations")}
        description={t("league.table.noRegistrationsDescription")}
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
      <table className="table-zebra-orange w-full min-w-[980px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            <th className="px-3 py-2.5">{header(t("league.table.surname"), "last_name")}</th>
            <th className="px-3 py-2.5">{header(t("league.table.name"), "first_name")}</th>
            <th className="px-3 py-2.5">{header(t("league.table.club"), "club")}</th>
            <th className="px-3 py-2.5">{header(t("league.table.registrations"), "registrations")}</th>
            <th className="px-3 py-2.5">{header(t("league.table.rounds"), "rounds")}</th>
            <th className="px-3 py-2.5">{header(t("league.table.races"), "races")}</th>
            <th className="px-3 py-2.5">{header(t("league.table.category"), "age_category")}</th>
            <th className="px-3 py-2.5">{header(t("league.table.latestStatus"), "race_status")}</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((entry) => (
            <tr key={entry.key} className="border-b border-border/30 transition-colors hover:bg-primary/[0.02]">
              <td className="px-3 py-2">
                <Link to={`/athletes/${entry.athleteSlug}`} className="font-medium transition-colors hover:text-primary">
                  {entry.lastName}
                </Link>
              </td>
              <td className="px-3 py-2 font-medium text-foreground">{entry.firstName}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {entry.clubSlug ? (
                  <Link to={`/clubs/${entry.clubSlug}`} className="transition-colors hover:text-primary">
                    {entry.club}
                  </Link>
                ) : (
                  entry.club
                )}
              </td>
              <td className="px-3 py-2">
                <div className="font-display font-bold tabular-nums text-foreground">{entry.registrationCount}</div>
              </td>
              <td className="px-3 py-2 font-mono text-xs font-semibold text-muted-foreground">{entry.roundLabels.join(" · ") || "—"}</td>
              <td className="px-3 py-2 font-display font-bold tabular-nums text-foreground">{entry.startedRaceCount}</td>
              <td className="px-3 py-2 text-xs font-medium text-muted-foreground">{localizedLeagueDataLabel(entry.ageCategory, locale)}</td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${resultStatusClasses[entry.latestRaceStatus] ?? resultStatusClasses.registered}`}>
                    {formatParticipationStatusLabel(entry.latestRaceStatus, t)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{t("league.table.latestRound", { round: entry.latestRoundNumber })}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RegistrationClubsTable({
  rows,
}: {
  rows: ReturnType<typeof buildRegistrationClubSummary>;
}) {
  const { locale, t } = useI18n();
  if (!rows.length) {
    return (
      <EmptyState
        title={t("league.table.noClubRegistrations")}
        description={t("league.table.noClubRegistrationsDescription")}
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
      <table className="table-zebra-orange w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            <th className="px-4 py-3.5">{t("league.table.club")}</th>
            <th className="px-4 py-3.5">{t("league.table.runners")}</th>
            <th className="px-4 py-3.5">{t("league.table.stagesEntered")}</th>
            <th className="px-4 py-3.5">{t("league.table.leagueCategories")}</th>
            <th className="px-4 py-3.5">{t("league.table.confirmed")}</th>
            <th className="px-4 py-3.5">{t("league.table.pending")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-border/30 transition-colors hover:bg-primary/[0.02]">
              <td className="px-4 py-3.5">
                {row.clubSlug ? (
                  <Link to={`/clubs/${row.clubSlug}`} className="font-medium transition-colors hover:text-primary">
                    {row.club}
                  </Link>
                ) : (
                  <span className="font-medium">{row.club}</span>
                )}
              </td>
              <td className="px-4 py-3.5 font-display font-bold text-foreground">{row.runners}</td>
              <td className="px-4 py-3.5 text-muted-foreground">{row.stages.size}</td>
              <td className="px-4 py-3.5 text-muted-foreground">{Array.from(row.categories).map((label) => localizedLeagueDataLabel(label, locale)).join(" · ")}</td>
              <td className="px-4 py-3.5 text-muted-foreground">{row.confirmed}</td>
              <td className="px-4 py-3.5 text-muted-foreground">{row.pending}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RegistrationCategoriesTable({
  rows,
}: {
  rows: ReturnType<typeof buildRegistrationCategorySummary>;
}) {
  const { locale, t } = useI18n();
  if (!rows.length) {
    return (
      <EmptyState
        title={t("league.table.noCategoryRegistrations")}
        description={t("league.table.noCategoryRegistrationsDescription")}
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
      <table className="table-zebra-orange w-full min-w-[860px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            <th className="px-4 py-3.5">{t("league.registrations.leagueCategorySummary")}</th>
            <th className="px-4 py-3.5">{t("league.table.runners")}</th>
            <th className="px-4 py-3.5">{t("league.registrations.clubsRepresented")}</th>
            <th className="px-4 py-3.5">{t("league.table.stagesActive")}</th>
            <th className="px-4 py-3.5">{t("league.table.confirmed")}</th>
            <th className="px-4 py-3.5">{t("league.table.pending")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.category} className="border-b border-border/30 transition-colors hover:bg-primary/[0.02]">
              <td className="px-4 py-3.5 font-medium">{localizedLeagueDataLabel(row.category, locale)}</td>
              <td className="px-4 py-3.5 font-display font-bold text-foreground">{row.runners}</td>
              <td className="px-4 py-3.5 text-muted-foreground">{row.clubs.size}</td>
              <td className="px-4 py-3.5 text-muted-foreground">{row.stages.size}</td>
              <td className="px-4 py-3.5 text-muted-foreground">{row.confirmed}</td>
              <td className="px-4 py-3.5 text-muted-foreground">{row.pending}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultsEntriesTable({
  rows,
}: {
  rows: PublicLeagueEntryItem[];
}) {
  const { locale, t } = useI18n();
  if (!rows.length) {
    return (
      <EmptyState
        title={t("league.table.noRunnerResults")}
        description={t("league.table.noRunnerResultsDescription")}
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
      <table className="table-zebra-orange w-full min-w-[1220px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            <th className="w-14 px-4 py-3.5">#</th>
            <th className="px-4 py-3.5">{t("league.table.stage")}</th>
            <th className="px-4 py-3.5">{t("league.results.athlete")}</th>
            <th className="px-4 py-3.5">{t("league.table.club")}</th>
            <th className="px-4 py-3.5">{t("league.registrations.leagueCategorySummary")}</th>
            <th className="px-4 py-3.5">{t("league.table.time")}</th>
            <th className="px-4 py-3.5">{t("league.rank.points")}</th>
            <th className="px-4 py-3.5">{t("league.table.leagueRank")}</th>
            <th className="px-4 py-3.5">{t("league.table.status")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => {
            const status = resolveEntryResultStatus(entry, t);
            return (
              <tr key={entry.registrationId} className={`border-b border-border/30 transition-colors hover:bg-primary/[0.02] ${entry.overall > 0 && entry.overall <= 3 ? "bg-primary/[0.015]" : ""}`}>
                <td className="px-4 py-3.5">
                  {entry.overall > 0 ? (
                    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${entry.overall <= 3 ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}>
                      {entry.overall}
                    </span>
                  ) : (
                    <span className="pl-2 text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3.5">
                  <div className="font-medium text-foreground">{entry.stageLabel}</div>
                  <div className="text-xs text-muted-foreground">{entry.date}</div>
                </td>
                <td className="px-4 py-3.5">
                  <Link to={`/athletes/${entry.athleteSlug}`} className="font-medium transition-colors hover:text-primary">
                    {entry.name}
                  </Link>
                </td>
                <td className="px-4 py-3.5 text-muted-foreground">
                  {entry.clubSlug ? (
                    <Link to={`/clubs/${entry.clubSlug}`} className="transition-colors hover:text-primary">
                      {entry.club}
                    </Link>
                  ) : (
                    entry.club
                  )}
                </td>
                <td className="px-4 py-3.5 text-xs text-muted-foreground">{leagueCategoryLabels(entry).map((label) => localizedLeagueDataLabel(label, locale)).join(" · ")}</td>
                <td className="px-4 py-3.5 font-mono text-xs font-semibold">{entry.time}</td>
                <td className="px-4 py-3.5 font-display font-bold text-primary">{entry.leaguePoints || "—"}</td>
                <td className="px-4 py-3.5 text-muted-foreground">{entry.leagueRank ?? "—"}</td>
                <td className="px-4 py-3.5">
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${resultStatusClasses[status.key] ?? resultStatusClasses.registered}`}>
                    {status.key === "finished"
                      ? t("league.status.finished")
                      : status.key === "checked_in"
                        ? t("league.status.checkedIn")
                        : status.key === "started"
                          ? t("league.status.onCourse")
                          : status.key === "registered"
                            ? t("league.status.registered")
                            : status.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ResultsClubsTable({
  rows,
}: {
  rows: ReturnType<typeof buildResultClubSummary>;
}) {
  const { t } = useI18n();
  if (!rows.length) {
    return (
      <EmptyState
        title={t("league.table.noClubResults")}
        description={t("league.table.noClubResultsDescription")}
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
      <table className="table-zebra-orange w-full min-w-[920px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            <th className="px-4 py-3.5">{t("league.table.club")}</th>
            <th className="px-4 py-3.5">{t("league.table.runners")}</th>
            <th className="px-4 py-3.5">{t("league.table.finishers")}</th>
            <th className="px-4 py-3.5">{t("league.table.stagesScored")}</th>
            <th className="px-4 py-3.5">{t("league.table.bestStageFinish")}</th>
            <th className="px-4 py-3.5">{t("league.rank.points")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-border/30 transition-colors hover:bg-primary/[0.02]">
              <td className="px-4 py-3.5">
                {row.clubSlug ? (
                  <Link to={`/clubs/${row.clubSlug}`} className="font-medium transition-colors hover:text-primary">
                    {row.club}
                  </Link>
                ) : (
                  <span className="font-medium">{row.club}</span>
                )}
                {row.topAthletes.length ? (
                  <div className="mt-1 text-xs text-muted-foreground">{row.topAthletes.join(" · ")}</div>
                ) : null}
              </td>
              <td className="px-4 py-3.5 text-muted-foreground">{row.runners}</td>
              <td className="px-4 py-3.5 text-muted-foreground">{row.finishers}</td>
              <td className="px-4 py-3.5 text-muted-foreground">{row.stages.size}</td>
              <td className="px-4 py-3.5 text-muted-foreground">{row.bestRank ?? "—"}</td>
              <td className="px-4 py-3.5 font-display font-bold text-primary">{row.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultsCategorySections({
  sections,
}: {
  sections: Array<{ category: string; rows: PublicLeagueEntryItem[] }>;
}) {
  const { locale, t } = useI18n();
  if (!sections.length) {
    return (
      <EmptyState
        title={t("league.table.noCategoryResults")}
        description={t("league.table.noCategoryResultsDescription")}
      />
    );
  }

  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <div key={section.category} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">{t("league.registrations.leagueCategorySummary")}</div>
              <h4 className="mt-2 font-display text-lg font-bold">{localizedLeagueDataLabel(section.category, locale)}</h4>
            </div>
            <span className="rounded-full bg-secondary px-3 py-1 text-[11px] font-semibold text-secondary-foreground">
              {t("league.table.runnerRows", { count: section.rows.length })}
            </span>
          </div>
          <ResultsEntriesTable rows={section.rows} />
        </div>
      ))}
    </div>
  );
}

function formatLeagueRuleValue(value: string) {
  const normalized = value.replace(/_/g, " ").trim();
  return normalized ? `${normalized[0].toUpperCase()}${normalized.slice(1)}` : "—";
}

export function LeagueCompetitionRulesPanel({
  competition,
  totalRounds,
  planningMetadata,
}: {
  competition: PublicLeagueCompetitionReadModel;
  totalRounds: number;
  planningMetadata: LeaguePlanningDescriptionMetadata;
}) {
  const { locale, t } = useI18n();
  const competitionName = localizedLeagueDataLabel(competition.name, locale);
  const usesPoints = competition.standingsMode === "points";
  const standingsModeLabel = competition.standingsMode === "best_time"
    ? t("league.rules.bestTime")
    : competition.standingsMode === "participation"
      ? t("league.rules.participation")
      : competition.standingsMode === "none"
        ? t("league.rules.noStandings")
        : t("league.rules.pointsStandings");
  const nonPointsDescription = competition.standingsMode === "best_time"
    ? t("league.rules.bestTimeDescription")
    : competition.standingsMode === "participation"
      ? t("league.rules.participationDescription")
      : t("league.rules.noStandingsDescription");
  const countedRacesLabel = usesPoints
    ? t("league.rules.countedRaces")
    : t("league.rules.includedRaces");
  const localizedRuleValue = (value: string) => {
    const normalized = value.replace(/_/g, " ").trim().toLowerCase();
    if (normalized === "best finish") return t("league.scoring.bestFinish");
    if (normalized === "best three") return t("league.rules.bestThree");
    if (normalized === "after every round") return t("league.rules.afterEveryRound");
    if (normalized === "72 hours") return t("league.rules.hours72");
    return formatLeagueRuleValue(value);
  };
  const [sortKey, setSortKey] = useState<"place" | "points">("place");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const pointRows = useMemo(
    () => (usesPoints ? competition.rules.pointsTable : [])
      .map((points, index) => ({ place: index + 1, points }))
      .sort((left, right) => {
        const comparison = sortKey === "place" ? left.place - right.place : left.points - right.points;
        return sortDirection === "asc" ? comparison : -comparison;
      }),
    [competition.rules.pointsTable, sortDirection, sortKey, usesPoints],
  );
  const header = (label: string, key: "place" | "points") => (
    <button type="button" onClick={() => {
      if (sortKey === key) setSortDirection((current) => current === "asc" ? "desc" : "asc");
      else {
        setSortKey(key);
        setSortDirection("asc");
      }
    }} className="inline-flex items-center gap-1.5 hover:text-primary" aria-label={t("league.rules.sort", { label })}>
      {label}
      {sortKey === key ? (sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowDown className="h-3 w-3 opacity-30" />}
    </button>
  );
  const operations = (planningMetadata.operations ?? "")
    .split("·")
    .map((value) => value.trim())
    .filter(Boolean);
  const publishCadence = operations.find((value) => /publish|standings update/i.test(value)) ?? null;
  const protestWindow = operations.find((value) => /protest|appeal/i.test(value)) ?? null;
  const rankingBoards = getLeagueCompetitionRankingBoards(competition);
  const midpointIndex = Math.floor((competition.rules.pointsTable.length - 1) / 2);
  const pointHighlights = competition.rules.pointsTable.length ? [
    { label: t("league.rules.winner"), place: 1, points: competition.rules.pointsTable[0] },
    { label: t("league.rules.midPack"), place: midpointIndex + 1, points: competition.rules.pointsTable[midpointIndex] },
    { label: t("league.rules.lastGraded"), place: competition.rules.pointsTable.length, points: competition.rules.pointsTable.at(-1) },
  ] : [];
  const operationalRulePills = [
    ...(publishCadence ? [{ label: t("league.rules.updates"), value: localizedRuleValue(publishCadence.replace(/^publish\s+/i, "")) }] : []),
    ...(protestWindow ? [{ label: t("league.rules.protests"), value: localizedRuleValue(protestWindow.replace(/^protest(?:\/appeal)?\s+window\s+/i, "")) }] : []),
  ];
  const rulePills = usesPoints ? [
    { label: t("league.rules.winner"), value: competition.rules.pointsTable.length ? `${competition.rules.pointsTable[0]} ${t("league.stats.pointsShort")}` : t("league.rules.notConfigured") },
    { label: t("league.rules.graded"), value: t("league.rules.places", { count: competition.rules.pointsTable.length }) },
    { label: t("league.rules.finisherFloor"), value: `${competition.rules.participationPoints} ${t("league.stats.pointsShort")}` },
    {
      label: t("league.rules.counting"),
      value: competition.rules.bestN > 0 && competition.rules.bestN < totalRounds
        ? t("league.rules.bestOf", { best: competition.rules.bestN, total: totalRounds })
        : t("league.scoring.all", { count: totalRounds }),
    },
    {
      label: t("league.rules.classify"),
      value: `${competition.rules.minimumRounds || 0} ${competition.rules.minimumRounds === 1 ? t("league.rules.finish") : t("league.rules.finishes")}`,
    },
    { label: t("league.scoring.tieBreak"), value: localizedRuleValue(competition.rules.tieBreakMethod) },
    { label: t("league.rules.clubScoring"), value: localizedRuleValue(competition.rules.clubScoringMode) },
    ...operationalRulePills,
  ] : [
    { label: t("league.rules.standingsMethod"), value: standingsModeLabel },
    {
      label: t("league.rules.rankingBasis"),
      value: competition.standingsMode === "best_time"
        ? t("league.rules.elapsedTime")
        : competition.standingsMode === "participation"
          ? t("league.rules.completedRaces")
          : t("league.rules.notApplicable"),
    },
    {
      label: t("league.rules.countingResult"),
      value: competition.standingsMode === "best_time"
        ? t("league.rules.fastestOfficialFinish")
        : competition.standingsMode === "participation"
          ? t("league.rules.everyOfficialFinish")
          : t("league.rules.notApplicable"),
    },
    { label: t("league.rules.points"), value: t("league.rules.notUsed") },
    ...operationalRulePills,
  ];

  return (
    <ScrollReveal>
      <article className="track-shell-card overflow-hidden">
        <header className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/80 bg-background/90 text-primary shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <CircleHelp className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{t("league.rules.competition")}</div>
              <h2 className="mt-1 font-display text-lg font-bold">{competitionName}</h2>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
                {competition.description || t("league.rules.defaultDescription")}
              </p>
            </div>
          </div>
          <span className="w-fit rounded-full border border-primary/20 bg-primary/[0.07] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
            {t("league.rules.raceCategory", { category: competitionName })}
          </span>
        </header>

        <section className="border-t border-border/70 px-4 py-3 sm:px-5" aria-label={t("league.rules.athleteCategoriesAria", { competition: competitionName })}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{t("league.rules.athleteCategories")}</div>
            <div className="flex flex-wrap gap-1.5">
              {rankingBoards.map(({ classification }) => (
                <span key={classification.id} className="rounded-full border border-primary/20 bg-primary/[0.06] px-2.5 py-1 text-[11px] font-semibold text-primary">
                  {localizedLeagueDataLabel(formatSexClassificationLabel(classification.name), locale)}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-border/70 bg-background/35 px-4 py-3 sm:px-5" aria-label={t("league.rules.summaryAria", { competition: competitionName })}>
          <dl className="flex flex-wrap gap-1.5">
            {rulePills.map(({ label, value }) => (
              <div key={label} className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border/70 bg-card px-3 py-1.5 shadow-[0_4px_14px_rgba(15,23,42,0.03)]">
                <dt className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
                <dd className="text-[11px] font-semibold text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 border-l-2 border-primary/35 pl-3 text-xs leading-5 text-muted-foreground">
            {usesPoints ? t("league.rules.officialScoring") : nonPointsDescription}
          </p>
          {planningMetadata.standings || planningMetadata.roundPlan ? (
            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[11px] leading-5 text-muted-foreground">
              {planningMetadata.roundPlan ? <div className="inline-flex gap-1.5"><dt className="font-bold uppercase tracking-wider text-foreground">{t("league.rules.season")}</dt><dd>{planningMetadata.roundPlan}</dd></div> : null}
              {planningMetadata.standings ? <div className="inline-flex gap-1.5"><dt className="font-bold uppercase tracking-wider text-foreground">{t("league.rules.tables")}</dt><dd>{planningMetadata.standings}</dd></div> : null}
            </dl>
          ) : null}
        </section>

        <section className="border-t border-border/70 px-4 py-3 sm:px-5" aria-label={usesPoints
          ? t("league.rules.countedRacesAria", { competition: competitionName })
          : t("league.rules.includedRacesAria", { competition: competitionName })}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{countedRacesLabel}</div>
            {competition.roundMappings.length ? (
              <div className="flex flex-wrap gap-1.5">
                {competition.roundMappings.map((mapping) => {
                  const content = <><span className="font-black text-primary">R{mapping.roundNumber}</span><span>{localizedLeagueDataLabel(mapping.categoryName, locale)}</span></>;
                  return mapping.eventSlug ? (
                    <Link key={`${mapping.roundId}:${mapping.eventCategoryId}`} to={`/events/${mapping.eventSlug}`} title={`${mapping.eventName} · ${mapping.categoryName}`} className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-[11px] font-semibold text-foreground hover:border-primary/25 hover:text-primary">
                      {content}
                    </Link>
                  ) : (
                    <span key={`${mapping.roundId}:${mapping.eventCategoryId}`} className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-[11px] font-semibold text-foreground">
                      {content}
                    </span>
                  );
                })}
              </div>
            ) : <span className="text-xs text-muted-foreground">{usesPoints ? t("league.rules.noCountedRaces") : t("league.rules.noIncludedRaces")}</span>}
          </div>
        </section>

        {usesPoints ? <div className="grid items-start border-t border-border/70 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)]">
          <figure className="min-w-0 px-4 py-4 sm:px-5">
            <figcaption className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{t("league.rules.pointsDistribution")}</div>
                <h3 className="mt-1 font-display text-lg font-bold">{t("league.rules.curveTitle")}</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("league.rules.curveDescription")}</p>
              </div>
              <div className="flex flex-wrap justify-end gap-1.5">
                {pointHighlights.map((highlight) => (
                  <span key={highlight.label} className="rounded-full border border-border/70 bg-card px-2.5 py-1 text-[10px] font-semibold">
                    {t("league.rules.highlight", { label: highlight.label, place: highlight.place, points: highlight.points ?? 0 })}
                  </span>
                ))}
              </div>
            </figcaption>
            {competition.rules.pointsTable.length ? (
              <LeaguePointsCurveChart
                points={competition.rules.pointsTable}
                scoringLabel={t("league.rules.score", { competition: competitionName })}
                ariaLabel={t("league.rules.curveAria", {
                  competition: competitionName,
                  first: competition.rules.pointsTable[0],
                  middlePlace: midpointIndex + 1,
                  middle: competition.rules.pointsTable[midpointIndex],
                  lastPlace: competition.rules.pointsTable.length,
                  last: competition.rules.pointsTable.at(-1) ?? 0,
                })}
                className="mt-2 h-60 md:h-64"
              />
            ) : (
              <div className="mt-3 flex h-44 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">{t("league.rules.noCurve")}</div>
            )}
          </figure>

          <section className="min-w-0 border-t border-border/70 xl:border-l xl:border-t-0" aria-label={t("league.rules.exactAria", { competition: competitionName })}>
            <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-3 sm:px-5">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{t("league.rules.exactValues")}</div>
                <h4 className="mt-0.5 text-sm font-bold">{t("league.rules.placeTable")}</h4>
              </div>
              <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold text-secondary-foreground">{t("league.rules.places", { count: pointRows.length })}</span>
            </div>
            <div className="max-h-[350px] overflow-auto">
              <table className="table-zebra-orange w-full text-sm">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    <th className="px-5 py-3.5">{header(t("league.rules.place"), "place")}</th>
                    <th className="px-5 py-3.5 text-right">{header(t("league.rules.points"), "points")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pointRows.map((row) => (
                    <tr key={row.place} className="border-b border-border/30 hover:bg-primary/[0.02]">
                      <td className="px-5 py-3 font-medium">{row.place}</td>
                      <td className="px-5 py-3 text-right font-display font-bold text-primary">{row.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border bg-background/60 px-4 py-2.5 text-[11px] text-muted-foreground sm:px-5">{t("league.rules.floorFooter", { place: pointRows.length + 1, points: competition.rules.participationPoints })}</div>
          </section>
        </div> : null}
      </article>
    </ScrollReveal>
  );
}

export function LeagueRulesPanel({ league }: { league: PublicLeagueDetailReadModel }) {
  const { locale, t } = useI18n();
  const sourcePlanningMetadata = getLeaguePlanningDescriptionMetadata(league.description);
  const planningMetadata = locale === "hr" && isSibenikTrailLeague(league.slug)
    ? {
      ...sourcePlanningMetadata,
      roundPlan: t("league.rules.sibenikRoundPlan"),
      standings: t("league.rules.sibenikStandings"),
    }
    : sourcePlanningMetadata;
  const competitions = league.competitions.length
    ? league.competitions
    : [{
        id: `${league.slug}:default`,
        slug: "overall",
        name: "Overall competition",
        description: "",
        scoringTarget: "individual" as const,
        resultBasis: "finish_place",
        standingsMode: "points" as const,
        displayOrder: 0,
        isDefault: true,
        classifications: [],
        roundMappings: [],
        individualStandings: league.individualStandings,
        classificationStandings: {},
        clubStandings: league.clubStandings,
        rules: league.rules,
      } satisfies PublicLeagueCompetitionReadModel];

  return (
    <div className="space-y-6">
      {league.organizerRules?.trim() ? (
        <ScrollReveal>
          <section
            aria-labelledby="league-organizer-rules-title"
            className="rounded-[28px] border border-primary/20 bg-card p-5 shadow-soft sm:p-6"
          >
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
              {t("league.rules.officialGuidance")}
            </div>
            <h2 id="league-organizer-rules-title" className="mt-2 font-display text-2xl font-black">
              {t("league.rules.organizerTitle")}
            </h2>
            <p
              className="mt-4 whitespace-pre-line text-sm leading-7 text-muted-foreground"
              data-i18n-skip
              translate="no"
            >
              {league.organizerRules.trim()}
            </p>
            <p className="mt-5 border-t border-border/70 pt-4 text-xs leading-5 text-muted-foreground">
              {t("league.rules.hierarchyNotice")} {" "}
              <Link to="/legal#rules" className="font-semibold text-primary hover:underline">
                {t("league.rules.openLegalCenter")}
              </Link>
            </p>
          </section>
        </ScrollReveal>
      ) : null}
      {competitions.map((competition) => (
        <LeagueCompetitionRulesPanel
          key={competition.id}
          competition={competition}
          totalRounds={league.rounds.length}
          planningMetadata={planningMetadata}
        />
      ))}
    </div>
  );
}

export function LeagueOrganizerContactLinks({
  organizer,
}: {
  organizer: PublicLeagueDetailReadModel["organizer"];
}) {
  const { t } = useI18n();
  if (
    !organizer.contactEmail
    && !organizer.contactPhone
    && !organizer.websiteUrl
    && !organizationHasSocialLinks(organizer)
  ) return null;

  return (
    <div className="flex shrink-0 flex-wrap gap-2">
      {organizer.contactEmail ? (
        <a href={`mailto:${organizer.contactEmail}`} className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-2 text-xs font-semibold hover:text-primary">
          <Mail className="h-3.5 w-3.5" /> {organizer.contactEmail}
        </a>
      ) : null}
      {organizer.contactPhone ? (
        <a href={`tel:${organizer.contactPhone}`} className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-2 text-xs font-semibold hover:text-primary">
          <Phone className="h-3.5 w-3.5" /> {organizer.contactPhone}
        </a>
      ) : null}
      {organizer.websiteUrl ? (
        <a href={organizer.websiteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-2 text-xs font-semibold hover:text-primary">
          <Globe className="h-3.5 w-3.5" /> {t("league.contact.website")} <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
      <OrganizationSocialLinks
        organization={organizer}
        linkClassName="inline-flex items-center gap-2 rounded-full border border-border px-3 py-2 text-xs font-semibold hover:text-primary"
        showExternalIcon
      />
    </div>
  );
}

export default function LeaguePage() {
  const { locale, t } = useI18n();
  const params = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const leagueId = params.id ?? "croatian-trail-league-2026";
  const requestedTab = coerceLeagueTab(searchParams.get("tab"));
  const [activeTab, setActiveTab] = useState<LeagueTab>(requestedTab);
  const [registrationScope, setRegistrationScope] = useState(ALL_STAGES_VALUE);
  const [registrationView, setRegistrationView] = useState<RegistrationView>("athletes");
  const [resultsFocus, setResultsFocus] = useState(LEAGUE_RANKING_VALUE);
  const [resultsView, setResultsView] = useState<ResultsView>("individual");
  const { stickyRef: tabsRef, isStuck: areTabsStuck } = useStickyTabs();

  useEffect(() => {
    setActiveTab(requestedTab);
  }, [requestedTab]);

  const query = useQuery({
    queryKey: ["public-league-detail", leagueId],
    queryFn: () => getPublicLeagueDetail(leagueId),
    staleTime: 60_000,
  });

  const league = query.data;
  useDocumentTitle(documentTitleKey("league", leagueId), league?.name);
  const currentSearch = searchParams.toString();

  useEffect(() => {
    if (!league || league.slug === leagueId) return;
    navigate(`/leagues/${league.slug}${currentSearch ? `?${currentSearch}` : ""}`, { replace: true });
  }, [currentSearch, league, leagueId, navigate]);

  const registrationRosterQuery = useQuery({
    queryKey: [
      "public-league-registration-roster",
      leagueId,
      ...(league?.rounds ?? [])
        .filter((round) => !round.isPlaceholder)
        .map((round) => `${round.eventEditionId}:${round.eventCategoryId}:${round.roundId}`),
      ...(league?.competitions ?? []).flatMap((competition) =>
        competition.roundMappings.map((mapping) => `${competition.id}:${mapping.eventCategoryId}`),
      ),
    ],
    enabled: activeTab === "Registrations" && Boolean(league?.rounds.some((round) => !round.isPlaceholder)),
    staleTime: 60_000,
    queryFn: async () => {
      const rounds = (league?.rounds ?? []).filter((round) => !round.isPlaceholder);
      const roundsByEditionId = new Map<string, PublicLeagueRoundItem[]>();
      const existingEntriesByRegistrationId = new Map(
        (league?.entries ?? []).map((entry) => [entry.registrationId, entry]),
      );

      for (const round of rounds) {
        const current = roundsByEditionId.get(round.eventEditionId) ?? [];
        current.push(round);
        roundsByEditionId.set(round.eventEditionId, current);
      }

      const participantResponses = await Promise.all(
        Array.from(roundsByEditionId.keys()).map(async (editionId) => ({
          editionId,
          data: await getPublicEventParticipantsReadModel(editionId),
        })),
      );

      return participantResponses
        .flatMap(({ editionId, data }) => {
          const editionRounds = roundsByEditionId.get(editionId) ?? [];
          const roundByCategoryId = buildLeagueRoundLookupByCategory(
            editionRounds,
            (league?.competitions ?? []).flatMap((competition) =>
              competition.roundMappings.filter((mapping) => mapping.eventEditionId === editionId),
            ),
          );
          return data.rows
            .map((row) => {
              const round = roundByCategoryId.get(row.categoryId);
              if (!round) return null;
              return mapParticipantRowToLeagueEntry(
                row,
                round,
                existingEntriesByRegistrationId.get(row.registrationId),
              );
            })
            .filter((entry): entry is PublicLeagueEntryItem => Boolean(entry));
        })
        .sort(compareEntries);
    },
  });

  const groupedRoundEvents = useMemo(
    () => groupRoundsByEvent((league?.rounds ?? []).filter((round) => !round.isPlaceholder)),
    [league],
  );
  const resultsFocusOptions = useMemo(
    () => [
      { value: LEAGUE_RANKING_VALUE, label: t("league.scope.leagueRanking") },
      { value: ALL_STAGES_VALUE, label: t("league.scope.allStages") },
      ...(league?.rounds ?? []).filter((round) => !round.isPlaceholder).map((round) => ({
        value: round.roundId,
        label: `R${round.roundNumber} · ${round.categoryName}`,
      })),
    ],
    [league, t],
  );
  const registrationScopeOptions = useMemo(
    () => [
      { value: ALL_STAGES_VALUE, label: t("league.scope.allStages") },
      ...(league?.rounds ?? []).filter((round) => !round.isPlaceholder).map((round) => ({
        value: round.roundId,
        label: `R${round.roundNumber} · ${round.categoryName}`,
      })),
    ],
    [league, t],
  );

  const registrationSourceEntries = useMemo(() => {
    const rosterEntries = registrationRosterQuery.data ?? [];
    if (rosterEntries.length) return rosterEntries;
    return league?.entries ?? [];
  }, [league, registrationRosterQuery.data]);

  const registrationEntries = useMemo(() => {
    const entries = registrationSourceEntries;
    if (registrationScope === ALL_STAGES_VALUE) return [...entries].sort(compareEntries);
    return entries.filter((entry) => entry.roundId === registrationScope).sort(compareEntries);
  }, [registrationScope, registrationSourceEntries]);
  const registrationRosterRows = useMemo(
    () => buildUniqueLeagueRoster(registrationEntries),
    [registrationEntries],
  );

  const registrationClubRows = useMemo(
    () => buildRegistrationClubSummary(registrationEntries),
    [registrationEntries],
  );
  const registrationCategoryRows = useMemo(
    () => buildRegistrationCategorySummary(registrationEntries),
    [registrationEntries],
  );

  const resultStageEntries = useMemo(() => {
    const entries = league?.entries ?? [];
    if (resultsFocus === ALL_STAGES_VALUE) return [...entries].sort(compareEntries);
    if (resultsFocus === LEAGUE_RANKING_VALUE) return [];
    return entries.filter((entry) => entry.roundId === resultsFocus).sort(compareEntries);
  }, [league, resultsFocus]);
  const resultClubRows = useMemo(() => buildResultClubSummary(resultStageEntries), [resultStageEntries]);
  const resultCategorySections = useMemo(() => groupResultsByCategory(resultStageEntries), [resultStageEntries]);
  const leagueCategorySections = useMemo(
    () => groupStandingsByCategory(league?.individualStandings ?? []),
    [league],
  );

  const registrationConfirmedCount = registrationEntries.filter(
    (entry) => entry.registrationStatus.trim().toLowerCase() === "confirmed",
  ).length;
  const registrationTotalCount = registrationScope === ALL_STAGES_VALUE
    ? league?.summary.totalRegistrations ?? 0
    : league?.rounds.find((round) => round.roundId === registrationScope)?.participants ?? 0;
  const registrationClubsRepresented = new Set(
    registrationEntries
      .map((entry) => representedLeagueClub(entry)?.key ?? null)
      .filter((value): value is string => Boolean(value)),
  ).size;

  const resultVisibleRunners = resultStageEntries.length;
  const resultFinishers = resultStageEntries.filter((entry) => entry.participationStatus === "finished" || entry.overall > 0).length;
  const resultPending = resultStageEntries.filter((entry) => resolveEntryResultStatus(entry).key === "registered").length;
  const resultClubsRepresented = new Set(
    resultStageEntries
      .map((entry) => representedLeagueClub(entry)?.key ?? null)
      .filter((value): value is string => Boolean(value)),
  ).size;

  function handleTabChange(tab: LeagueTab) {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    if (tab === "Overview") {
      next.delete("tab");
    } else {
      next.set("tab", tab.toLowerCase());
    }
    setSearchParams(next, { replace: true });
  }

  if (query.isLoading) {
    return (
      <div aria-busy="true" aria-label={t("app.loading")}>
        <section
          data-league-loading-hero
          className="relative min-h-[360px] overflow-hidden border-b border-border bg-[linear-gradient(145deg,hsl(207_33%_7%),hsl(205_24%_15%)_58%,hsl(24_55%_18%))] sm:min-h-[440px] md:min-h-[520px] lg:min-h-[680px]"
        >
          <div className="absolute inset-0 ridge-pattern opacity-20" />
          <div className="absolute inset-0 grain-overlay opacity-15" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/65" />
          <div className="container relative z-10 flex min-h-[360px] items-end px-4 pb-10 sm:min-h-[440px] md:min-h-[520px] lg:min-h-[680px]">
            <div className="w-full max-w-xl animate-pulse space-y-3">
              <div className="h-4 w-32 rounded-full bg-white/25" />
              <div className="h-11 w-4/5 rounded-xl bg-white/20" />
              <div className="flex gap-2">
                <div className="h-9 w-28 rounded-full bg-white/20" />
                <div className="h-9 w-36 rounded-full bg-white/20" />
              </div>
            </div>
          </div>
        </section>
        <div className="h-[57px] border-b border-border/70 bg-background/90" />
        <div className="container mx-auto min-h-[32rem] px-4 py-10">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="h-28 rounded-2xl border border-border bg-card" />
            <div className="h-28 rounded-2xl border border-border bg-card" />
            <div className="h-28 rounded-2xl border border-border bg-card" />
          </div>
          <div className="mt-6 flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span>{t("app.loading")}</span>
          </div>
        </div>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div role="alert" className="rounded-2xl border border-border bg-card p-10 text-center">
          <Trophy className="mx-auto h-8 w-8 text-muted-foreground" />
          <h1 className="mt-4 font-display text-2xl font-bold">{t("league.loadError.title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("league.loadError.description")}</p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            className="mt-6 min-h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {t("common.tryAgain")}
          </button>
        </div>
      </div>
    );
  }

  if (!league) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <Trophy className="mx-auto h-8 w-8 text-muted-foreground" />
          <h1 className="mt-4 font-display text-2xl font-bold">{t("league.unavailable.title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("league.unavailable.description")}
          </p>
          <Link
            to="/leagues"
            className="mt-6 inline-flex items-center rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            {t("league.unavailable.back")}
          </Link>
        </div>
      </div>
    );
  }

  const pointsPreviewPlaces = Array.from(new Set(
    [1, 2, 3, 5, 10, 20, 50, 100, league.rules.pointsTable.length]
      .filter((place) => place >= 1 && place <= league.rules.pointsTable.length),
  )).sort((left, right) => left - right);

  const leadingAthlete = league.individualStandings[0] ?? null;
  const leadingClub = league.clubStandings[0] ?? null;
  const focusedRound = league.rounds.find((round) => round.roundId === registrationScope) ?? null;
  const focusedResultsRound = league.rounds.find((round) => round.roundId === resultsFocus) ?? null;
  const nextLeagueRound = [...league.rounds]
    .filter((round) => round.status !== "completed")
    .sort((left, right) => {
      if (left.dateIso && right.dateIso) return left.dateIso.localeCompare(right.dateIso);
      if (left.dateIso) return -1;
      if (right.dateIso) return 1;
      return left.roundNumber - right.roundNumber;
    })[0] ?? null;
  const heroVisual = getLeagueHeroVisual(league.slug);
  const heroBadges = [
    formatLeagueStatusLabel(league.status),
    league.seasonLabel,
    league.summary.nextStageLabel ? `Next: ${league.summary.nextStageLabel}` : "Final standings live",
  ];
  const transitionPills = [
    `${league.rounds.length} stages`,
    `${league.summary.completedRounds} completed`,
    `${league.summary.publishedRounds} published`,
    `${league.summary.totalRegistrations} registrations`,
    `${league.summary.clubsRepresented} clubs`,
  ];
  const transitionSummary = leadingAthlete
    ? `${leadingAthlete.name} leads the individual table with ${leadingAthlete.points} points, while ${leadingClub?.name ?? "the club standings"} ${
        leadingClub ? `tops the club race with ${leadingClub.points} points.` : "will settle as more scored stages arrive."
      }`
    : league.summary.nextStageLabel
      ? `${league.summary.nextStageLabel} is the next counted stage shaping the season roster and the early standings.`
      : "This season page brings the stage calendar, registrations, results, and league tables into one public race-series view.";
  const leaderMenTop = getLeagueTopByGender(league.individualStandings, "M");
  const leaderWomenTop = getLeagueTopByGender(league.individualStandings, "F");
  const leagueHeroImage = league.imageUrl ?? heroVisual.imageSrc;
  const leagueHeroLogo = isSibenikTrailLeague(league.slug)
    ? SIBENIK_TRAIL_LEAGUE_MEDIA.headerLogo
    : null;
  const showLegacyOverview = searchParams.get("legacyOverview") === "1";

  return (
    <div>
      <LeagueSeasonHeader
        league={league}
        heroImage={leagueHeroImage}
        heroLogo={leagueHeroLogo}
        nextRound={nextLeagueRound}
        view={activeTab === "Overview"
          ? "overview"
          : activeTab === "Results"
            ? "results"
            : activeTab === "Statistics"
              ? "statistics"
              : "standard"}
      />

      <div
        ref={tabsRef}
        className={`sticky top-[calc(4rem+1px)] z-[80] border-y border-border/70 bg-background/90 backdrop-blur-md ${
          areTabsStuck
            ? "relative shadow-sm before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-primary/70"
            : ""
        }`}
      >
        <div className="container mx-auto px-4 py-2">
          <ResponsiveSectionTabs
            label={t("league.sections")}
            items={tabs.map((tab) => ({ value: tab, label: t(tabMessageKeys[tab]) }))}
            value={activeTab}
            onChange={handleTabChange}
          />
        </div>
      </div>

      {activeTab !== "Statistics" ? (
        <>
          <LeagueSeasonTitle league={league} />
          <div className="container mx-auto px-4 pt-3">
            <SportBadgeList
              sportCodes={league.sportCodes}
              primarySportCode={league.primarySportCode}
            />
          </div>

          {league.organizer.name ? (
            <div className="container mx-auto px-4 pt-6">
              <MobileDetailDisclosure
                title={league.organizer.name}
                summary={league.organizer.locationLabel
                  ? localizedLeagueLocation(league.organizer.locationLabel, locale)
                  : t("league.organizer.fallback")}
                icon={Building2}
              >
                {league.organizer.description ? (
                  <p className="text-sm leading-6 text-muted-foreground">{league.organizer.description}</p>
                ) : null}
                <div className="mt-3"><LeagueOrganizerContactLinks organizer={league.organizer} /></div>
              </MobileDetailDisclosure>
              <section className="hidden rounded-[28px] border border-border/70 bg-card p-5 shadow-soft sm:p-6 lg:block">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex min-w-0 items-start gap-4">
                    {league.organizer.logoImageUrl ? (
                      <img src={league.organizer.logoImageUrl} alt={t("league.organizer.logoAlt", { name: league.organizer.name })} className="h-16 w-16 shrink-0 rounded-2xl border border-border/70 object-cover" />
                    ) : (
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-primary/15 bg-primary/[0.08] text-primary">
                        <Building2 className="h-7 w-7" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{t("league.organizer.label")}</div>
                      <h2 className="mt-1 font-display text-xl font-black">{league.organizer.name}</h2>
                      {league.organizer.locationLabel ? (
                        <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5 text-primary" />
                          {localizedLeagueLocation(league.organizer.locationLabel, locale)}
                        </div>
                      ) : null}
                      {league.organizer.description ? (
                        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{league.organizer.description}</p>
                      ) : null}
                    </div>
                  </div>
                  <LeagueOrganizerContactLinks organizer={league.organizer} />
                </div>
              </section>
            </div>
          ) : null}
        </>
      ) : null}

      <div className="container mx-auto px-4 pb-12 pt-6">
        {activeTab === "Overview" ? (
          <LeagueOverviewExperience
            league={league}
            nextRound={nextLeagueRound}
            roundImage={medvednicaRoundImage}
          />
        ) : null}

        {activeTab === "Statistics" ? <LeagueInsightsPanel league={league} /> : null}

        {showLegacyOverview && activeTab === "Overview" && (
          <div className="space-y-8">
            <ScrollReveal>
              <LeagueOverviewShowcase
                league={league}
                rounds={league.rounds}
                groupedRoundEvents={groupedRoundEvents}
                heroImage={leagueHeroImage}
                leaderMenTop={leaderMenTop}
                leaderWomenTop={leaderWomenTop}
              />
            </ScrollReveal>

            <div className="grid gap-8 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
              <div className="space-y-6">
                {groupedRoundEvents.map((group, index) => {
                  const groupRegistrations = group.rounds.reduce((sum, round) => sum + round.participants, 0);
                  const groupFinishers = group.rounds.reduce((sum, round) => sum + round.finishers, 0);
                  return (
                    <ScrollReveal key={group.eventEditionId} delay={0.05 + index * 0.04}>
                      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
                              Race group
                            </div>
                            <h3 className="mt-3 font-display text-xl font-bold">{group.eventName}</h3>
                            <div className="mt-2 flex flex-wrap gap-3 text-sm text-muted-foreground">
                              <span className="inline-flex items-center gap-1.5">
                                <Calendar className="h-4 w-4 text-primary" />
                                {group.date}
                              </span>
                              <span className="inline-flex items-center gap-1.5">
                                <MapPin className="h-4 w-4 text-primary" />
                                {group.location}
                              </span>
                            </div>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-3">
                            <div className="rounded-2xl border border-border/70 bg-background/60 px-4 py-3 text-sm">
                              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">League stages</div>
                              <div className="mt-2 font-display text-2xl font-bold text-foreground">{group.rounds.length}</div>
                            </div>
                            <div className="rounded-2xl border border-border/70 bg-background/60 px-4 py-3 text-sm">
                              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Registrations</div>
                              <div className="mt-2 font-display text-2xl font-bold text-foreground">{groupRegistrations}</div>
                            </div>
                            <div className="rounded-2xl border border-border/70 bg-background/60 px-4 py-3 text-sm">
                              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Finishers</div>
                              <div className="mt-2 font-display text-2xl font-bold text-foreground">{groupFinishers}</div>
                            </div>
                          </div>
                        </div>

                        <div className="mt-5 space-y-3">
                          {group.rounds.map((round) => (
                            <div key={round.roundId} className="rounded-2xl border border-border/70 bg-background/55 p-4">
                              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-secondary-foreground">
                                      Round {round.roundNumber}
                                    </span>
                                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${roundStatusClasses(round)}`}>
                                      {formatRoundStatusLabel(round, t)}
                                    </span>
                                  </div>
                                  <div className="mt-3 font-display text-lg font-bold">{round.categoryName}</div>
                                  <div className="mt-1 flex flex-wrap gap-3 text-sm text-muted-foreground">
                                    <span className="inline-flex items-center gap-1">
                                      <Flag className="h-3.5 w-3.5 text-primary" />
                                      {round.distance}
                                    </span>
                                    <span className="inline-flex items-center gap-1">
                                      <Mountain className="h-3.5 w-3.5 text-primary" />
                                      {round.elevation}
                                    </span>
                                  </div>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[330px]">
                                  <div className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm">
                                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Registered</div>
                                    <div className="mt-1 font-display text-lg font-bold text-foreground">{round.participants}</div>
                                  </div>
                                  <div className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm">
                                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Finishers</div>
                                    <div className="mt-1 font-display text-lg font-bold text-foreground">{round.finishers}</div>
                                  </div>
                                  <Link
                                    to={`/events/${round.eventSlug}${round.hasPublishedResults ? "?tab=results" : "?tab=registrations"}`}
                                    className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-primary/25 hover:bg-primary/[0.03]"
                                  >
                                    Open race page
                                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                  </Link>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </ScrollReveal>
                  );
                })}
              </div>

              <div className="space-y-4">
                <ScrollReveal delay={0.12} direction="right" distance={16}>
                  <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
                    <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Scoring frame</div>
                    <h3 className="mt-2 font-display text-lg font-bold">Organizer rule snapshot</h3>
                    <div className="mt-4 space-y-3 text-sm text-muted-foreground">
                      <div className="rounded-2xl border border-border/70 bg-background/60 p-4">
                        <div className="font-semibold text-foreground">Best results counted</div>
                        <p className="mt-2 leading-6">{league.rules.bestN > 0 && league.rules.bestN < league.rounds.length ? `Best ${league.rules.bestN}` : `All ${league.rounds.length}`} stage scores count toward the final league table.</p>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-background/60 p-4">
                        <div className="font-semibold text-foreground">Minimum participation</div>
                        <p className="mt-2 leading-6">Athletes need {league.rules.minimumRounds} scored stages to fully classify in the league.</p>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-background/60 p-4">
                        <div className="font-semibold text-foreground">Team scoring</div>
                        <p className="mt-2 leading-6">Club scoring mode is <span className="font-medium text-foreground">{league.rules.clubScoringMode.replace(/_/g, " ")}</span>, with tie-breaks handled by <span className="font-medium text-foreground">{league.rules.tieBreakMethod.replace(/_/g, " ")}</span>.</p>
                      </div>
                    </div>
                  </div>
                </ScrollReveal>
              </div>
            </div>
          </div>
        )}

        {activeTab === "Registrations" && (
          <div className="space-y-6">
            <ScrollReveal>
              <div className="track-shell-card p-5 md:p-6">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/80 bg-background/90 text-primary shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                    <Users className="h-4 w-4" />
                  </span>
                  <h2 className="font-display text-[15px] font-bold">{t("league.registrations.title")}</h2>
                </div>
                <p className="mt-4 max-w-3xl text-[13px] leading-6 text-muted-foreground">
                  {t("league.registrations.description")}
                </p>
              </div>
            </ScrollReveal>

            <ScrollReveal delay={0.05}>
              <div className="flex flex-wrap gap-2 rounded-2xl border border-border bg-card p-3 shadow-soft">
                {[
                  [t("league.registrations.registrations"), registrationTotalCount],
                  [t("league.registrations.uniqueAthletes"), registrationRosterRows.length],
                  [t("league.registrations.confirmed"), registrationConfirmedCount],
                  [t("league.registrations.clubsRepresented"), registrationClubsRepresented],
                ].map(([label, value], index) => (
                  <div key={label} className={`min-w-[9rem] flex-1 rounded-xl border px-4 py-3 ${index === 0 ? "border-primary/20 bg-primary/[0.04]" : "border-border bg-background/60"}`}>
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
                    <div className="mt-1 font-display text-2xl font-bold text-foreground">{value}</div>
                  </div>
                ))}
              </div>
            </ScrollReveal>

            <div className="track-shell-card space-y-5 p-5 md:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">{t("league.registrations.filters")}</div>
                    <h3 className="mt-2 font-display text-xl font-bold">{registrationScope === ALL_STAGES_VALUE ? t("league.scope.allStages") : focusedRound?.stageLabel ?? t("league.scope.selectedStage")}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {t("league.registrations.filterDescription")}
                    </p>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground">
                    <ListFilter className="h-3.5 w-3.5" />
                    {registrationView === "athletes"
                      ? t("league.registrations.athleteRoster")
                      : registrationView === "clubs"
                        ? t("league.registrations.clubSummary")
                        : t("league.registrations.categorySummary")}
                  </div>
                </div>

                <PillGroup
                  label={t("league.registrations.stageScope")}
                  options={registrationScopeOptions}
                  value={registrationScope}
                  onChange={setRegistrationScope}
                />
                <PillGroup
                  label={t("league.registrations.display")}
                  options={[
                    { value: "athletes", label: t("league.registrations.athletes") },
                    { value: "clubs", label: t("league.registrations.clubs") },
                    { value: "categories", label: t("league.registrations.categories") },
                  ]}
                  value={registrationView}
                  onChange={(value) => setRegistrationView(value as RegistrationView)}
                />

                {registrationView === "athletes" ? (
                  <div className="space-y-3">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">{t("league.registrations.registeredAthletes")}</div>
                      <h4 className="mt-2 font-display text-lg font-bold">{t("league.registrations.fullRoster")}</h4>
                    </div>
                    <RegistrationAthletesTable
                      rows={registrationRosterRows}
                      isLoading={registrationRosterQuery.isLoading || registrationRosterQuery.isFetching}
                    />
                  </div>
                ) : null}

                {registrationView === "clubs" ? (
                  <div className="space-y-3">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">{t("league.registrations.clubSummary")}</div>
                      <h4 className="mt-2 font-display text-lg font-bold">{t("league.registrations.groupedClubs")}</h4>
                    </div>
                    <RegistrationClubsTable rows={registrationClubRows} />
                  </div>
                ) : null}

                {registrationView === "categories" ? (
                  <div className="space-y-3">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">{t("league.registrations.leagueCategorySummary")}</div>
                      <h4 className="mt-2 font-display text-lg font-bold">{t("league.registrations.groupedCategories")}</h4>
                    </div>
                    <RegistrationCategoriesTable rows={registrationCategoryRows} />
                  </div>
                ) : null}
            </div>
          </div>
        )}

        {activeTab === "Results" && resultsFocus === LEAGUE_RANKING_VALUE ? (
          <LeagueResultsExperience
            league={league}
            nextRound={nextLeagueRound}
            focusOptions={resultsFocusOptions}
            focus={resultsFocus}
            onFocusChange={setResultsFocus}
            view={resultsView}
            onViewChange={setResultsView}
          />
        ) : null}

        {activeTab === "Results" && resultsFocus !== LEAGUE_RANKING_VALUE && (
          <div className="space-y-6">
            <ScrollReveal>
              <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
                <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">{t("league.tab.results")}</div>
                <h2 className="mt-2 font-display text-2xl font-bold">{t("league.results.pageTitle")}</h2>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
                  {t("league.results.pageDescription")}
                </p>
              </div>
            </ScrollReveal>

            <ScrollReveal delay={0.05}>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <LeagueStatCard
                  label={resultsFocus === LEAGUE_RANKING_VALUE ? t("league.registrations.athletes") : t("league.results.runnerRows")}
                  value={resultsFocus === LEAGUE_RANKING_VALUE ? league.individualStandings.length : resultVisibleRunners}
                  detail={resultsFocus === LEAGUE_RANKING_VALUE
                    ? t("league.results.athletesInRanking")
                    : t("league.results.currentScope", { scope: formatResultsContextLabel(resultsFocus, league.rounds, locale, t) })}
                  accent
                />
                <LeagueStatCard
                  label={resultsFocus === LEAGUE_RANKING_VALUE ? t("league.results.clubs") : t("league.results.finishers")}
                  value={resultsFocus === LEAGUE_RANKING_VALUE ? league.clubStandings.length : resultFinishers}
                  detail={resultsFocus === LEAGUE_RANKING_VALUE
                    ? t("league.results.clubsScoring")
                    : t("league.results.runnersPending", { count: resultPending })}
                />
                <LeagueStatCard
                  label={t("league.results.publishedStages")}
                  value={league.summary.publishedRounds}
                  detail={t("league.results.publishedStagesDetail")}
                />
                <LeagueStatCard
                  label={resultsFocus === LEAGUE_RANKING_VALUE ? t("league.registrations.clubsRepresented") : t("league.results.clubsInView")}
                  value={resultsFocus === LEAGUE_RANKING_VALUE ? league.summary.clubsRepresented : resultClubsRepresented}
                  detail={t("league.results.breadthDetail")}
                />
              </div>
            </ScrollReveal>

            <ScrollReveal delay={0.08}>
              <div className="space-y-5 rounded-2xl border border-border bg-card p-6 shadow-soft">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">{t("league.results.resultFilters")}</div>
                    <h3 className="mt-2 font-display text-xl font-bold">{formatResultsContextLabel(resultsFocus, league.rounds, locale, t)}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {t("league.results.filterDescription")}
                    </p>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground">
                    <Trophy className="h-3.5 w-3.5" />
                    {t("league.results.resultView", { view: resultsView === "individual"
                      ? t("league.results.individual")
                      : resultsView === "clubs"
                        ? t("league.results.clubView")
                        : t("league.results.categoryView") })}
                  </div>
                </div>

                <PillGroup
                  label={t("league.results.focus")}
                  options={resultsFocusOptions}
                  value={resultsFocus}
                  onChange={setResultsFocus}
                />
                <PillGroup
                  label={t("league.registrations.display")}
                  options={[
                    { value: "individual", label: t("league.results.individual") },
                    { value: "clubs", label: t("league.results.clubs") },
                    { value: "categories", label: t("league.registrations.categories") },
                  ]}
                  value={resultsView}
                  onChange={(value) => setResultsView(value as ResultsView)}
                />

                {resultsFocus === LEAGUE_RANKING_VALUE ? (
                  resultsView === "individual" ? (
                    <LeagueStandingsTable rounds={league.rounds} rows={league.individualStandings} />
                  ) : resultsView === "clubs" ? (
                    <LeagueClubStandingsTable rows={league.clubStandings} />
                  ) : (
                    <CategoryStandingsSections sections={leagueCategorySections} />
                  )
                ) : resultsView === "individual" ? (
                  <ResultsEntriesTable rows={resultStageEntries} />
                ) : resultsView === "clubs" ? (
                  <ResultsClubsTable rows={resultClubRows} />
                ) : (
                  <ResultsCategorySections sections={resultCategorySections} />
                )}
              </div>
            </ScrollReveal>

            {focusedResultsRound ? (
              <ScrollReveal delay={0.12}>
                <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">{t("league.scope.selectedStage")}</div>
                      <h3 className="mt-2 font-display text-xl font-bold">{focusedResultsRound.stageLabel}</h3>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {t("league.results.selectedStageDescription")}
                      </p>
                    </div>
                    <Link
                      to={`/events/${focusedResultsRound.eventSlug}${focusedResultsRound.hasPublishedResults ? "?tab=results" : "?tab=registrations"}`}
                      className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
                    >
                      {t("league.results.openRace")}
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </div>
                  <div className="mt-5 grid gap-4 md:grid-cols-4">
                    <LeagueStatCard label={t("league.results.registered")} value={focusedResultsRound.participants} detail={t("league.results.rosterSizeDetail")} accent />
                    <LeagueStatCard label={t("league.results.finishers")} value={focusedResultsRound.finishers} detail={t("league.results.finishersDetail")} />
                    <LeagueStatCard label={t("league.results.resultState")} value={formatRoundStatusLabel(focusedResultsRound, t)} detail={t("league.results.resultStateDetail")} />
                    <LeagueStatCard label={t("league.results.route")} value={focusedResultsRound.distance} detail={focusedResultsRound.elevation} />
                  </div>
                </div>
              </ScrollReveal>
            ) : null}
          </div>
        )}

        {activeTab === "Rules" ? <LeagueRulesPanel league={league} /> : null}

      </div>
    </div>
  );
}
