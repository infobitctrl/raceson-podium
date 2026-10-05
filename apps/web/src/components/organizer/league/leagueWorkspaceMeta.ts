import type { OrganizerManagedLeagueSeason } from "@/lib/organizer-management";
import type { AppLocale } from "@/shared/i18n/locales";

export function formatOrganizerLeagueApiError(error: unknown) {
  const message = error instanceof Error ? error.message : "Organizer API unavailable.";
  const normalized = message.toLowerCase();
  if (
    normalized === "request failed" ||
    normalized === "route not found" ||
    normalized.includes("fetch failed") ||
    normalized.includes("failed to fetch")
  ) {
    return "Organizer API is unavailable or out of date. Restart the local stack with npm run db:start:api.";
  }
  return message;
}

export function getLeagueSeasonStatusMeta(status: string, isPublic = true, locale: AppLocale = "en") {
  if (!isPublic && status !== "archived") {
    return {
      label: locale === "hr" ? "Skica" : "Draft",
      className: "bg-trail-amber/15 text-trail-amber",
    };
  }

  switch (status) {
    case "draft":
      return {
        label: locale === "hr" ? "Skica" : "Draft",
        className: "bg-trail-amber/15 text-trail-amber",
      };
    case "published":
      return {
        label: locale === "hr" ? "Objavljeno" : "Published",
        className: "bg-primary/10 text-primary",
      };
    case "active":
    case "registration_open":
      return {
        label: status === "registration_open"
          ? (locale === "hr" ? "Otvoreno" : "Open")
          : (locale === "hr" ? "Aktivno" : "Active"),
        className: "bg-accent/10 text-accent",
      };
    case "completed":
      return {
        label: locale === "hr" ? "Završeno" : "Completed",
        className: "bg-primary/10 text-primary",
      };
    case "archived":
      return {
        label: locale === "hr" ? "Arhivirano" : "Archived",
        className: "bg-muted text-muted-foreground",
      };
    default:
      return {
        label: status,
        className: "bg-muted text-muted-foreground",
      };
  }
}

export function getLeagueRoundStatusMeta(status: string, locale: AppLocale = "en") {
  switch (status) {
    case "completed":
      return {
        label: locale === "hr" ? "Završeno" : "Completed",
        className: "bg-primary/10 text-primary",
      };
    case "scheduled":
    case "upcoming":
      return {
        label: locale === "hr" ? "Zakazano" : "Scheduled",
        className: "bg-secondary text-secondary-foreground",
      };
    case "active":
    case "in_progress":
      return {
        label: status === "in_progress"
          ? (locale === "hr" ? "U tijeku" : "In progress")
          : (locale === "hr" ? "Aktivno" : "Active"),
        className: "bg-accent/10 text-accent",
      };
    case "registration_open":
      return {
        label: locale === "hr" ? "Otvoreno" : "Open",
        className: "bg-accent/10 text-accent",
      };
    case "cancelled":
    case "canceled":
      return {
        label: locale === "hr" ? "Otkazano" : "Cancelled",
        className: "bg-destructive/10 text-destructive",
      };
    default:
      return {
        label: status,
        className: "bg-muted text-muted-foreground",
      };
  }
}

export function getLeagueUniqueEventCount(season: OrganizerManagedLeagueSeason) {
  return new Set(season.rounds.map((round) => round.eventEditionId)).size;
}

export function getLeaguePublishReadiness(
  season: OrganizerManagedLeagueSeason,
  locale: AppLocale = "en",
  localeTag = "en-GB",
) {
  if (season.isPublic) {
    return {
      label: locale === "hr" ? "Javno" : "Public",
      detail: season.publishedAt
        ? locale === "hr"
          ? `Objavljeno ${new Intl.DateTimeFormat(localeTag, { dateStyle: "medium" }).format(new Date(season.publishedAt))}`
          : `Published ${new Intl.DateTimeFormat(localeTag, { dateStyle: "medium" }).format(new Date(season.publishedAt))}`
        : locale === "hr" ? "Objavljeno na javnoj stranici" : "Live on the public website",
      className: "bg-primary/10 text-primary",
      canPublish: false,
    };
  }

  if (!season.rounds.length) {
    return {
      label: locale === "hr" ? "Nedostaju kola" : "Rounds Missing",
      detail: locale === "hr"
        ? "Prije objave dodajte najmanje jedno izdanje utrke kao kolo."
        : "Attach at least one race edition as a round before publishing.",
      className: "bg-trail-amber/15 text-trail-amber",
      canPublish: false,
    };
  }

  const competitions = (season.competitions ?? []).filter(
    (competition) => competition.scoringTarget === "individual" && competition.status !== "archived",
  );
  if (!competitions.length || competitions.some(
    (competition) => (competition.standingsMode ?? "points") === "points" && !competition.scoringRules,
  )) {
    return {
      label: locale === "hr" ? "Nedostaje bodovanje" : "Scoring Missing",
      detail: locale === "hr"
        ? "Svako bodovno natjecanje prije objave mora imati pravila bodovanja."
        : "Every points competition needs a scoring policy before publishing.",
      className: "bg-trail-amber/15 text-trail-amber",
      canPublish: false,
    };
  }

  return {
    label: locale === "hr" ? "Spremno za objavu" : "Ready To Publish",
    detail: locale === "hr"
      ? season.rounds.length === 1
        ? `${season.rounds.length} kolo dodano je i spremno za pregled.`
        : `${season.rounds.length} kola dodana su i spremna za pregled.`
      : `${season.rounds.length} round${season.rounds.length === 1 ? "" : "s"} attached and ready for review.`,
    className: "bg-accent/10 text-accent",
    canPublish: true,
  };
}
