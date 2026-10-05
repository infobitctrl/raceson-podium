import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowUpDown,
  ArrowUpRight,
  Calendar,
  ChevronDown,
  ChevronUp,
  Clock3,
  Flag,
  LayoutGrid,
  List,
  Map,
  MapPin,
  Search,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { motion } from "framer-motion";
import EventLocationsMap, { type EventLocation } from "@/components/shared/EventLocationsMap";
import { CountryWithFlag } from "@/components/shared/CountryFlag";
import PublicCatalogCardTitle from "@/components/shared/PublicCatalogCardTitle";
import ProgressiveListControls from "@/components/shared/ProgressiveListControls";
import ScrollReveal from "@/components/shared/ScrollReveal";
import SubpageHero from "@/components/shared/SubpageHero";
import { useProgressiveList } from "@/hooks/use-progressive-list";
import { resultsHero as resultsHeroImage } from "@/assets/optimized/heroes";
import { resolveEventPreviewImage } from "@/shared/media/eventPreviewImage";
import { PublicCardImage } from "@/shared/media/PublicCardImage";
import {
  getPublicEventResultsReadModel,
  getPublicResultsDirectoryReadModel,
  type PublicEventResultsReadModel,
  type PublicResultsRow,
  type PublicResultsDirectoryEvent,
  type PublicResultsDirectoryRace,
  type PublicResultsDirectoryRaceStatus,
} from "@/lib/portal-read-models";
import { defaultCompetitiveRankingConfig } from "@/lib/ranking-config";
import {
  getFinishedResultsDirectoryEvents,
  type FinishedResultsDirectoryEvent,
  type FinishedResultsDirectoryEventKind,
} from "@/features/results/public/model/resultsDirectoryLifecycle";
import {
  buildResultStandingScopes,
  getResultStandingPlacements,
  getResultStandingRank,
  resultRowsForStandingScope,
} from "@/features/results/public/model/resultStandingScopes";
import { ResultPlaceBadge } from "@/features/results/public/components/ResultPodiumVisual";
import { MobileResultStandingRow } from "@/features/results/public/components/MobileResultStandingRow";
import { PublicResultsLifecycleNotice } from "@/features/results/public/components/PublicResultsLifecycleNotice";
import { getResultPodiumVisual } from "@/features/results/public/model/resultPodiumVisual";
import {
  formatPublicResultAverageSpeed,
  formatPublicResultWinnerGap,
  getPublicResultWinnerTimeMs,
  normalizePublicResultClubName,
} from "@/features/results/public/model/publicResultPresentation";
import {
  buildResultTimingColumns,
  formatResultCheckpointLocalTime,
  getResultFinishSplit,
  getResultTimingLabel,
  getResultTimingSplit,
  type ResultTimingColumn,
} from "@/features/results/public/model/resultTimingColumns";
import {
  sortPublicResultTableEntries,
  type PublicResultTableSortDirection,
  type PublicResultTableSortKey,
} from "@/features/results/public/model/publicResultTableSort";
import { cn } from "@/lib/utils";
import { useMobileListView } from "@/shared/mobile/useMobileListView";
import { useI18n } from "@/shared/i18n/I18nContext";
import { MobileFilterButton, MobileFilterRail, MobileFilterSelect } from "@/shared/mobile/MobileFilterRail";
import { MobileFilterPanel } from "@/shared/mobile/MobileFilterPanel";
import { localizedClassificationLabel } from "@/shared/i18n/domainLabels";

const emptyResultsDirectory = { events: [] } satisfies { events: PublicResultsDirectoryEvent[] };

type MonthAccent = {
  line: string;
  dot: string;
  dateFrame: string;
  dateTop: string;
  dateBody: string;
  dateDay: string;
  cardTint: string;
  metaTint: string;
  stripe: string;
  monthLabel: string;
  monthSubtle: string;
};

type VisibleResultsEvent = FinishedResultsDirectoryEvent & {
  visibleRaces: PublicResultsDirectoryRace[];
  dateValue: Date | null;
};

type ResultsMonthGroup = {
  key: string;
  label: string;
  countLabel: string;
  accent: MonthAccent;
  markerVariant: number;
  events: VisibleResultsEvent[];
};

type ResultsFilter = "all" | FinishedResultsDirectoryEventKind;
type ResultsViewMode = "list" | "grid" | "map";
const monthAccents: MonthAccent[] = [
  {
    line: "bg-primary/15",
    dot: "bg-primary/55",
    dateFrame: "border-primary/20 bg-card",
    dateTop: "bg-primary text-primary-foreground",
    dateBody: "bg-primary/[0.05]",
    dateDay: "text-primary",
    cardTint: "bg-primary/[0.03]",
    metaTint: "bg-primary/[0.04]",
    stripe: "bg-primary",
    monthLabel: "text-primary",
    monthSubtle: "text-primary/80",
  },
  {
    line: "bg-trail-blue/15",
    dot: "bg-trail-blue/55",
    dateFrame: "border-trail-blue/20 bg-card",
    dateTop: "bg-trail-blue text-white dark:text-trail-blue-foreground",
    dateBody: "bg-trail-blue/[0.06]",
    dateDay: "text-trail-blue",
    cardTint: "bg-trail-blue/[0.03]",
    metaTint: "bg-trail-blue/[0.05]",
    stripe: "bg-trail-blue",
    monthLabel: "text-trail-blue",
    monthSubtle: "text-trail-blue/80",
  },
  {
    line: "bg-trail-green/15",
    dot: "bg-trail-green/55",
    dateFrame: "border-trail-green/20 bg-card",
    dateTop: "bg-trail-green text-trail-green-foreground",
    dateBody: "bg-trail-green/[0.06]",
    dateDay: "text-trail-green",
    cardTint: "bg-trail-green/[0.03]",
    metaTint: "bg-trail-green/[0.05]",
    stripe: "bg-trail-green",
    monthLabel: "text-trail-green",
    monthSubtle: "text-trail-green/80",
  },
  {
    line: "bg-trail-amber/15",
    dot: "bg-trail-amber/55",
    dateFrame: "border-trail-amber/20 bg-card",
    dateTop: "bg-trail-amber text-trail-amber-foreground",
    dateBody: "bg-trail-amber/[0.08]",
    dateDay: "text-trail-amber",
    cardTint: "bg-trail-amber/[0.03]",
    metaTint: "bg-trail-amber/[0.05]",
    stripe: "bg-trail-amber",
    monthLabel: "text-trail-amber",
    monthSubtle: "text-trail-amber/80",
  },
];

const eventStatusTone: Record<FinishedResultsDirectoryEventKind, string> = {
  closed: "border-border bg-muted text-muted-foreground",
  pending: "border-trail-amber/40 bg-trail-amber/90 text-trail-amber-foreground ring-1 ring-trail-amber/25",
  finished: "border-primary/30 bg-primary/10 text-primary shadow-sm ring-1 ring-primary/10",
};

const raceStatusTone: Record<PublicResultsDirectoryRaceStatus, string> = {
  official: "border-primary/20 bg-primary/10 text-primary",
  provisional: "border-trail-amber/20 bg-trail-amber/10 text-trail-amber",
  live: "timing-lime-pill",
  published: "border-trail-blue/20 bg-trail-blue/10 text-trail-blue",
  pending: "border-border bg-background/90 text-muted-foreground",
  pre_race: "border-border bg-background/90 text-muted-foreground",
};

const resultsStatusClasses: Record<string, string> = {
  finished: "border border-primary/30 bg-primary/10 text-primary",
  started: "border border-trail-blue/15 bg-trail-blue/10 text-trail-blue",
  dnf: "border border-trail-red/15 bg-trail-red/10 text-trail-red",
  dns: "border border-border bg-muted/50 text-muted-foreground",
  dsq: "border border-trail-red/15 bg-trail-red/10 text-trail-red",
};

function CompactResultStatus({ status }: { status: PublicResultsRow["status"] }) {
  const { t } = useI18n();
  const label = status === "finished"
    ? t("common.finished")
    : status === "started"
      ? t("common.started")
      : status === "dnf"
        ? t("results.status.dnf")
        : status === "dns"
          ? t("results.status.dns")
          : t("results.status.dsq");

  if (status === "finished") {
    return (
      <span
        aria-label={label}
        title={label}
        className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${resultsStatusClasses.finished}`}
      >
        <Flag aria-hidden="true" className="h-3.5 w-3.5 fill-current" />
      </span>
    );
  }

  return (
    <span
      title={label}
      data-locale-fit="pill"
      className={`inline-flex rounded-full px-2 py-0.5 text-center text-[9px] font-bold uppercase tracking-[0.08em] ${resultsStatusClasses[status]}`}
    >
      {label}
    </span>
  );
}

function SortablePublicResultHeader({
  activeSort,
  align = "left",
  className,
  direction,
  label,
  labelClassName,
  onSort,
  sortKey,
  sortLabel = label,
  sublabel,
}: {
  activeSort: PublicResultTableSortKey;
  align?: "left" | "right";
  className?: string;
  direction: PublicResultTableSortDirection;
  label: string;
  labelClassName?: string;
  onSort: (sortKey: PublicResultTableSortKey) => void;
  sortKey: PublicResultTableSortKey;
  sortLabel?: string;
  sublabel?: string;
}) {
  const { t } = useI18n();
  const isActive = activeSort === sortKey;
  const SortIcon = isActive
    ? direction === "asc" ? ChevronUp : ChevronDown
    : ArrowUpDown;

  return (
    <th
      scope="col"
      aria-sort={isActive ? (direction === "asc" ? "ascending" : "descending") : "none"}
      className={cn(
        "px-2 py-2.5 transition-colors",
        align === "right" && "text-right",
        isActive ? "bg-primary/[0.07] text-primary" : "text-muted-foreground",
        className,
      )}
    >
      <button
        type="button"
        aria-label={t("results.page.table.sortBy", { label: sortLabel })}
        data-locale-fit="table-heading"
        onClick={() => onSort(sortKey)}
        className={cn(
          "group flex w-full items-center gap-1 text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          align === "right" && "justify-end text-right",
        )}
      >
        <span className="min-w-0">
          <span className={cn("block leading-tight", labelClassName)} title={label}>{label}</span>
          {sublabel ? (
            <span className="mt-0.5 block text-[8px] font-medium normal-case tracking-normal text-muted-foreground">
              {sublabel}
            </span>
          ) : null}
        </span>
        <SortIcon aria-hidden="true" className="h-3 w-3 shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />
      </button>
    </th>
  );
}

function parseDateValue(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatEventDate(event: VisibleResultsEvent, localeTag: string) {
  if (localeTag.startsWith("en")) return event.date;
  return event.dateValue
    ? new Intl.DateTimeFormat(localeTag, { day: "numeric", month: "short", year: "numeric" }).format(event.dateValue)
    : event.date;
}

function monthGroupKey(dateValue: Date | null, fallback: string) {
  return dateValue
    ? `${dateValue.getFullYear()}-${String(dateValue.getMonth() + 1).padStart(2, "0")}`
    : fallback;
}

function monthGroupLabel(dateValue: Date | null, localeTag: string, t: ReturnType<typeof useI18n>["t"]) {
  return dateValue
    ? new Intl.DateTimeFormat(localeTag, { month: "long", year: "numeric" }).format(dateValue)
    : t("results.page.dateTba");
}

function monthCountLabel(count: number, t: ReturnType<typeof useI18n>["t"]) {
  return t("results.page.eventsInMonth", { count });
}

function formatPublishedDate(value: string | null, localeTag: string) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat(localeTag, { day: "numeric", month: "short" }).format(parsed);
}

function buildMonthGroups(
  events: VisibleResultsEvent[],
  localeTag: string,
  t: ReturnType<typeof useI18n>["t"],
): ResultsMonthGroup[] {
  const groups: ResultsMonthGroup[] = [];

  events.forEach((event) => {
    const key = monthGroupKey(event.dateValue, event.eventSlug);
    const existing = groups.find((group) => group.key === key);

    if (existing) {
      existing.events.push(event);
      existing.countLabel = monthCountLabel(existing.events.length, t);
      return;
    }

    groups.push({
      key,
      label: monthGroupLabel(event.dateValue, localeTag, t),
      countLabel: monthCountLabel(1, t),
      accent: monthAccents[groups.length % monthAccents.length],
      markerVariant: groups.length % 4,
      events: [event],
    });
  });

  return groups;
}

function MonthMarkerArtwork({
  label,
  accent,
  variant,
}: {
  label: string;
  accent: MonthAccent;
  variant: number;
}) {
  const { t } = useI18n();
  const monthMark = label === t("results.page.dateTba") ? t("results.page.tbaShort") : label.slice(0, 3).toUpperCase();
  const pattern = variant % 4;

  return (
    <div className={`relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[20px] border shadow-soft sm:h-[84px] sm:w-[84px] sm:rounded-[28px] ${accent.dateFrame}`}>
      <div className={`absolute inset-0 ${accent.dateBody}`} />
      <div className={`absolute -right-4 -top-4 h-14 w-14 rounded-full blur-2xl ${accent.dot}`} />
      <div className={`absolute -bottom-5 left-4 h-12 w-12 rounded-full blur-xl ${accent.line}`} />
      <div className={`absolute left-2 top-2 rounded-full px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-[0.16em] sm:left-3 sm:top-3 sm:px-2 sm:py-1 sm:text-[9px] sm:tracking-[0.22em] ${accent.dateTop}`}>
        {monthMark}
      </div>
      <svg viewBox="0 0 84 84" className={`relative z-10 h-12 w-12 sm:h-16 sm:w-16 ${accent.monthLabel}`} fill="none">
        {pattern === 0 ? (
          <>
            <path d="M10 56C18 52 22 42 28 36C35 29 40 32 45 39C49 45 53 48 60 46C66 44 71 39 74 34" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
            <path d="M14 61H70" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" opacity="0.45" />
            <circle cx="62" cy="23" r="6" fill="currentColor" opacity="0.18" />
          </>
        ) : pattern === 1 ? (
          <>
            <path d="M17 54C27 44 30 32 42 26C50 22 58 23 67 18" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
            <path d="M20 63C26 56 35 55 41 47C48 38 49 29 58 24" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity="0.42" />
            <circle cx="23" cy="56" r="4" fill="currentColor" opacity="0.18" />
          </>
        ) : pattern === 2 ? (
          <>
            <path d="M14 58L28 40L38 49L51 30L70 58" stroke="currentColor" strokeWidth="3.2" strokeLinejoin="round" strokeLinecap="round" />
            <path d="M23 58H61" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity="0.4" />
            <circle cx="61" cy="22" r="5.5" fill="currentColor" opacity="0.16" />
          </>
        ) : (
          <>
            <path d="M22 59C27 53 29 43 36 36C42 31 49 31 54 38C58 44 61 48 68 49" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
            <path d="M44 51V24" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
            <path d="M44 24L56 28L44 33V24Z" fill="currentColor" />
          </>
        )}
      </svg>
    </div>
  );
}

function TimelineMonthHeader({
  label,
  countLabel,
  accent,
  variant,
}: {
  label: string;
  countLabel: string;
  accent: MonthAccent;
  variant: number;
}) {
  const { t } = useI18n();
  const monthMark = label === t("results.page.dateTba") ? t("results.page.tbaShort") : label.slice(0, 3).toUpperCase();

  return (
    <div className="relative flex items-center gap-3 overflow-hidden rounded-2xl border border-border/60 bg-card/70 px-3 py-3 shadow-soft sm:gap-4 sm:rounded-[28px] sm:px-4 sm:py-4">
      <div className="pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 font-display text-[3.4rem] font-black tracking-[0.18em] text-muted-foreground/[0.08] sm:block">
        {monthMark}
      </div>
      <MonthMarkerArtwork label={label} accent={accent} variant={variant} />
      <div className="relative z-10">
        <div className="font-display text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">{label}</div>
        <div className={`mt-0.5 text-[10px] font-bold uppercase tracking-[0.16em] sm:mt-1 sm:text-xs sm:tracking-[0.22em] ${accent.monthSubtle}`}>
          {countLabel}
        </div>
      </div>
      <div className="relative z-10 ml-auto hidden min-w-[160px] flex-1 items-center gap-3 lg:flex">
        <div className="h-px flex-1 bg-border/70" />
        <div className="flex gap-1.5">
          <span className={`h-2 w-2 rounded-full ${accent.dot}`} />
          <span className={`h-2 w-2 rounded-full ${accent.dot} opacity-70`} />
          <span className={`h-2 w-2 rounded-full ${accent.dot} opacity-45`} />
        </div>
      </div>
    </div>
  );
}

function ResultsDateBadge({
  dateValue,
  accent,
  isLast,
}: {
  dateValue: Date | null;
  accent: MonthAccent;
  isLast: boolean;
}) {
  const { localeTag, t } = useI18n();
  const monthLabel = dateValue
    ? new Intl.DateTimeFormat(localeTag, { month: "short" }).format(dateValue).toUpperCase()
    : t("results.page.tbaShort");
  const dayLabel = dateValue ? String(dateValue.getDate()).padStart(2, "0") : "—";
  const weekdayLabel = dateValue
    ? new Intl.DateTimeFormat(localeTag, { weekday: "short" }).format(dateValue).toUpperCase()
    : t("common.date").toUpperCase();

  return (
    <div className="relative hidden h-full justify-center self-stretch sm:flex">
      {!isLast ? (
        <div className={`absolute bottom-[-1.25rem] left-1/2 h-5 w-px -translate-x-1/2 ${accent.line}`} />
      ) : null}
      <div className={`relative z-10 flex h-full w-[76px] min-h-[100%] flex-col overflow-hidden rounded-[22px] border shadow-soft ${accent.dateFrame}`}>
        <div className={`px-3 py-2 text-center text-[10px] font-bold uppercase tracking-[0.24em] ${accent.dateTop}`}>
          {monthLabel}
        </div>
        <div className={`flex flex-1 flex-col items-center justify-center px-3 pb-3 pt-3 text-center ${accent.dateBody}`}>
          <div className={`font-display text-3xl font-black leading-none ${accent.dateDay}`}>{dayLabel}</div>
          <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.24em] text-muted-foreground">
            {weekdayLabel}
          </div>
        </div>
      </div>
    </div>
  );
}

function startOfCalendarDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function getLatestPublishedAt(races: PublicResultsDirectoryRace[]) {
  return races.reduce<string | null>((latest, race) => {
    if (!race.publishedAt) return latest;
    if (!latest) return race.publishedAt;
    return new Date(race.publishedAt).getTime() > new Date(latest).getTime() ? race.publishedAt : latest;
  }, null);
}

function getResultsEventMeta(
  event: VisibleResultsEvent,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (event.resultsKind === "closed") {
    return {
      kind: "closed" as const,
      label: t("results.page.status.closed"),
      badgeLabel: t("results.page.status.closed"),
      summary: t("results.page.status.closedRaceSummary"),
      tone: eventStatusTone.closed,
      ctaLabel: t("results.page.openEvent"),
    };
  }

  if (event.resultsKind === "pending") {
    return {
      kind: "pending" as const,
      label: t("results.page.status.resultsPending"),
      tone: raceStatusTone.pending,
      badgeLabel: t("results.page.status.pending"),
      summary: t("results.page.status.pendingSummary"),
      ctaLabel: t("results.page.action.openResults"),
    };
  }

  return {
    kind: "finished" as const,
    label: t("results.page.status.finished"),
    tone: eventStatusTone.finished,
    badgeLabel: t("results.page.status.finished"),
    summary: t("results.page.status.finishedSummary", { published: event.publishedRaceCount, total: event.raceCount }),
    ctaLabel: t("results.page.action.openResults"),
  };
}

function getResultsEventAccent(event: VisibleResultsEvent, fallbackAccent: MonthAccent) {
  if (event.resultsKind === "pending") return monthAccents[3];
  return fallbackAccent;
}

function pickResultsCardImage(
  event: Pick<
    PublicResultsDirectoryEvent,
    "eventSlug" | "eventName" | "location" | "coverImageUrl" | "linkedTrackImageUrl"
  >,
) {
  return resolveEventPreviewImage({
    eventImageUrl: event.coverImageUrl,
    raceImageUrls: [event.linkedTrackImageUrl],
    fallbackContext: [event.eventName, event.location, event.eventSlug],
  });
}

function buildInlineResultsShell(event: VisibleResultsEvent): PublicEventResultsReadModel {
  const categories = (event.visibleRaces.length ? event.visibleRaces : event.races).map((race, index) => {
    return {
      id: race.id,
      label: race.label,
      rankingConfig: defaultCompetitiveRankingConfig(),
      standingClassifications: [],
      publicationState: race.resultsStatusLabel,
      publishedAt: race.publishedAt,
      rows: [],
      teamStandings: [],
    };
  });

  return {
    eventSlug: event.eventSlug,
    eventName: event.eventName,
    hasPublishedResults: categories.some((category) => category.rows.length > 0),
    categories,
  };
}

function getPreferredInlineCategoryId(model: PublicEventResultsReadModel) {
  return model.categories.find((category) => category.rows.length)?.id ?? model.categories[0]?.id ?? null;
}

function ResultCheckpointTimeCell({
  row,
  column,
  timeZone,
}: {
  row: PublicResultsRow;
  column: ResultTimingColumn;
  timeZone: string;
}) {
  const { t } = useI18n();
  const split = getResultTimingSplit(row, column);
  const relativeLabel = getResultTimingLabel(row, column);

  if (!split?.recordedAt) {
    return (
      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs font-semibold text-muted-foreground">
        {relativeLabel}
      </td>
    );
  }

  const localLabel = formatResultCheckpointLocalTime(split.recordedAt, timeZone);
  return (
    <td
      className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs"
      aria-label={t("results.page.table.checkpointAria", { checkpoint: column.label, elapsed: relativeLabel, local: localLabel })}
    >
      <span className="block font-bold text-foreground">{relativeLabel}</span>
      <time dateTime={split.recordedAt} className="mt-0.5 block text-[9px] font-medium text-muted-foreground">
        {localLabel}
      </time>
    </td>
  );
}

function ResultFinishTimeCell({
  row,
  timeZone,
  winnerTimeMs,
}: {
  row: PublicResultsRow;
  timeZone: string;
  winnerTimeMs: number | null;
}) {
  const { t } = useI18n();
  const finishSplit = getResultFinishSplit(row);
  const recordedAt = finishSplit?.recordedAt ?? null;
  const localLabel = recordedAt
    ? formatResultCheckpointLocalTime(recordedAt, timeZone)
    : null;
  const winnerGapLabel = formatPublicResultWinnerGap(row, winnerTimeMs, t("common.winner"));
  const hasWinnerGap = winnerGapLabel !== "—";

  return (
    <td
      className="whitespace-nowrap px-2 py-2 text-right font-mono text-xs"
      aria-label={localLabel && hasWinnerGap
        ? t("results.page.table.finishGapLocalAria", { elapsed: row.time, gap: winnerGapLabel, local: localLabel })
        : localLabel
          ? t("results.page.table.finishLocalAria", { elapsed: row.time, local: localLabel })
          : hasWinnerGap
            ? t("results.page.table.finishGapAria", { elapsed: row.time, gap: winnerGapLabel })
            : t("results.page.table.finishAria", { elapsed: row.time })}
    >
      <span className="block font-bold text-foreground">{row.time}</span>
      {hasWinnerGap ? (
        <span className="mt-0.5 block text-[9px] font-semibold text-primary">
          {winnerGapLabel}
        </span>
      ) : null}
      {recordedAt && localLabel ? (
        <time dateTime={recordedAt} className="mt-0.5 block text-[9px] font-medium text-muted-foreground">
          {localLabel}
        </time>
      ) : null}
    </td>
  );
}

function InlineResultsPanel({
  event,
  meta,
  expanded,
}: {
  event: VisibleResultsEvent;
  meta: ReturnType<typeof getResultsEventMeta>;
  expanded: boolean;
}) {
  const { locale, localeTag, t } = useI18n();
  const canExpand = meta.kind !== "closed";
  const shellModel = useMemo(() => buildInlineResultsShell(event), [event]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(() => getPreferredInlineCategoryId(shellModel));
  const [standingScopeId, setStandingScopeId] = useState("overall");
  const [tableSortKey, setTableSortKey] = useState<PublicResultTableSortKey>("rank");
  const [tableSortDirection, setTableSortDirection] = useState<PublicResultTableSortDirection>("asc");

  const resultsQuery = useQuery({
    queryKey: ["public-event-results-inline", event.editionId],
    queryFn: async () => {
      const data = await getPublicEventResultsReadModel(event.editionId);
      return data.categories.length ? data : shellModel;
    },
    enabled: expanded && canExpand,
    placeholderData: shellModel,
    staleTime: 60_000,
  });

  const inlineResults = resultsQuery.data ?? shellModel;

  useEffect(() => {
    const nextCategoryId = getPreferredInlineCategoryId(inlineResults);
    const selectedCategoryEntry = selectedCategoryId
      ? inlineResults.categories.find((category) => category.id === selectedCategoryId) ?? null
      : null;
    const selectedCategoryHasRows = Boolean(selectedCategoryEntry?.rows.length);
    const hasAnyPublishedRows = inlineResults.categories.some((category) => category.rows.length > 0);

    if (
      !selectedCategoryId ||
      !selectedCategoryEntry ||
      (!selectedCategoryHasRows && hasAnyPublishedRows && nextCategoryId && nextCategoryId !== selectedCategoryId)
    ) {
      setSelectedCategoryId(nextCategoryId);
    }
  }, [inlineResults, selectedCategoryId]);

  const selectedCategory = inlineResults.categories.find((category) => category.id === selectedCategoryId) ?? inlineResults.categories[0] ?? null;
  const publishedLabel = formatPublishedDate(selectedCategory?.publishedAt ?? null, localeTag);
  const winnerTimeMs = useMemo(
    () => getPublicResultWinnerTimeMs(selectedCategory?.rows ?? []),
    [selectedCategory?.rows],
  );

  const scopeOptions = useMemo(() => {
    const rows = selectedCategory?.rows ?? [];
    return buildResultStandingScopes(
      selectedCategory?.rankingConfig ?? defaultCompetitiveRankingConfig(),
      rows,
      selectedCategory?.standingClassifications ?? [],
    );
  }, [selectedCategory]);
  const activeStandingScope = scopeOptions.find((scope) => scope.id === standingScopeId) ?? scopeOptions[0];
  const filteredRows = useMemo(
    () => activeStandingScope
      ? resultRowsForStandingScope(selectedCategory?.rows ?? [], activeStandingScope)
      : [],
    [activeStandingScope, selectedCategory],
  );
  const timingColumns = useMemo(() => buildResultTimingColumns(filteredRows), [filteredRows]);
  const tableEntries = useMemo(() => filteredRows.map((row) => {
    const rank = activeStandingScope
      ? getResultStandingRank(row, activeStandingScope, filteredRows)
      : row.overall;
    const categoryPlacements = activeStandingScope?.kind === "overall"
      ? getResultStandingPlacements(row, scopeOptions, selectedCategory?.rows ?? [])
      : activeStandingScope && rank > 0
        ? [{ scope: activeStandingScope, rank }]
        : [];

    return {
      row,
      rank,
      categoryPlacements,
      clubLabel: normalizePublicResultClubName(row.club),
      categoryLabel: categoryPlacements
        .map((placement) => `${placement.scope.label} #${placement.rank}`)
        .join(" · "),
    };
  }), [activeStandingScope, filteredRows, scopeOptions, selectedCategory?.rows]);
  const activeTableSortKey = tableSortKey.startsWith("checkpoint:")
    && !timingColumns.some((column) => column.id === tableSortKey.slice("checkpoint:".length))
    ? "rank"
    : tableSortKey;
  const activeTableSortDirection = activeTableSortKey === tableSortKey ? tableSortDirection : "asc";
  const sortedTableEntries = useMemo(() => sortPublicResultTableEntries(
    tableEntries,
    activeTableSortKey,
    activeTableSortDirection,
    {
      distanceKm: selectedCategory?.distanceKm,
      timingColumns,
    },
  ), [activeTableSortDirection, activeTableSortKey, selectedCategory?.distanceKm, tableEntries, timingColumns]);

  const handleTableSort = (nextSortKey: PublicResultTableSortKey) => {
    if (nextSortKey === tableSortKey) {
      setTableSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setTableSortKey(nextSortKey);
    setTableSortDirection("asc");
  };

  if (!expanded || !canExpand) {
    return null;
  }

  return (
    <div
      className="mt-2 rounded-xl border border-border/70 bg-background/80 p-2.5 sm:mt-4 sm:rounded-[24px] sm:p-4"
      onClick={(clickEvent) => clickEvent.stopPropagation()}
    >
      <div className="space-y-2 sm:space-y-3">
          <div className="flex min-w-0 items-center justify-between gap-2 sm:flex-wrap sm:gap-3">
            <h4 className="min-w-0 truncate font-display text-sm font-bold text-foreground sm:text-lg">
              {selectedCategory?.label ?? event.eventName}
            </h4>
            <div className="hidden flex-wrap gap-2 sm:flex">
              {publishedLabel ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <Clock3 className="h-3 w-3" />
                  {t("results.page.updated", { date: publishedLabel })}
                </span>
              ) : null}
              {resultsQuery.isFetching ? (
                <span className="inline-flex items-center rounded-full bg-background px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {t("results.page.syncing")}
                </span>
              ) : null}
            </div>
          </div>

          <PublicResultsLifecycleNotice
            publicationState={selectedCategory?.publicationState}
            pendingDescription={t("results.page.status.pendingSummary")}
            isRefreshing={resultsQuery.isFetching}
          />

          <div className="rounded-xl border border-border/70 bg-card/75 p-2 sm:rounded-2xl sm:p-3">
            {inlineResults.categories.length > 1 ? (
              <div className="flex min-w-0 flex-col gap-1.5 sm:gap-2.5 lg:flex-row lg:items-center">
                <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground sm:w-28 sm:shrink-0 sm:text-[10px] sm:tracking-[0.2em]">{t("common.race")}</div>
                <MobileFilterSelect
                  label={t("common.race")}
                  value={selectedCategory?.id ?? inlineResults.categories[0].id}
                  options={inlineResults.categories.map((category) => ({ value: category.id, label: category.label }))}
                  onChange={setSelectedCategoryId}
                  showLabel={false}
                />
                <div className="hidden min-w-0 flex-wrap gap-1.5 pb-1 sm:flex sm:flex-nowrap sm:overflow-x-auto sm:whitespace-nowrap">
              {inlineResults.categories.map((category) => {
                const isActive = selectedCategory?.id === category.id;
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={(clickEvent) => {
                      clickEvent.stopPropagation();
                      setSelectedCategoryId(category.id);
                    }}
                    className={`max-w-full shrink-0 overflow-hidden text-ellipsis whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors sm:px-3 sm:text-xs ${
                      isActive
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-secondary text-secondary-foreground hover:bg-muted"
                    }`}
                  >
                    {category.label}
                  </button>
                );
              })}
                </div>
              </div>
            ) : null}

            <div className={cn(
              "flex min-w-0 flex-col gap-1.5 sm:gap-2.5 lg:flex-row lg:items-center",
              inlineResults.categories.length > 1 && "mt-2 border-t border-border/60 pt-2 sm:mt-3 sm:pt-3",
            )}>
              <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground sm:w-28 sm:shrink-0 sm:text-[10px] sm:tracking-[0.2em]">{t("common.standings")}</div>
              <MobileFilterSelect<string>
                label={t("results.standingCategories")}
                value={activeStandingScope?.id ?? scopeOptions[0].id}
                options={scopeOptions.map((option) => ({
                  value: option.id,
                  label: `${option.kind === "overall" ? t("common.all") : localizedClassificationLabel(option.label, locale)} (${option.count})`,
                }))}
                onChange={setStandingScopeId}
                showLabel={false}
              />
              <div className="hidden min-w-0 flex-wrap gap-1.5 pb-1 sm:flex sm:pb-0">
            {scopeOptions.map((option) => {
              const isActive = activeStandingScope?.id === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-label={`${localizedClassificationLabel(option.label, locale)} ${option.count}`}
                  onClick={(clickEvent) => {
                    clickEvent.stopPropagation();
                    setStandingScopeId(option.id);
                  }}
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors sm:px-3 sm:text-xs ${
                    isActive
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-secondary text-secondary-foreground hover:bg-muted"
                  }`}
                >
                  <span className="sm:hidden">{option.shortLabel}</span>
                  <span data-locale-fit="pill" className="hidden sm:inline">{localizedClassificationLabel(option.label, locale)}</span>
                  <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    isActive ? "bg-white/20 text-primary-foreground dark:bg-black/20" : "bg-background text-muted-foreground"
                  }`}>
                    {option.count}
                  </span>
                </button>
              );
            })}
              </div>
            </div>
          </div>

          {filteredRows.length ? (
            <>
            <div className="max-h-[30rem] space-y-1.5 overflow-y-auto pr-0.5 md:hidden" aria-label={t("results.page.table.resultsAria", { race: selectedCategory?.label ?? event.eventName })}>
              {sortedTableEntries.map(({ row, rank }, index) => {
                return (
                  <MobileResultStandingRow
                    key={`mobile-${selectedCategory?.id ?? "results"}-${row.athleteSlug}-${index}`}
                    row={row}
                    place={rank}
                    scopeLabel={localizedClassificationLabel(activeStandingScope?.label ?? "Overall", locale)}
                    winnerTimeMs={winnerTimeMs}
                  />
                );
              })}
            </div>
            <div className="hidden overflow-hidden rounded-2xl border border-border bg-card shadow-soft md:block">
              <div className="overflow-auto" style={{ maxHeight: "50rem" }}>
                <table
                  aria-label={t("results.page.table.sortableAria", { race: selectedCategory?.label ?? event.eventName })}
                  className="w-full min-w-[1020px] text-sm"
                >
                  <thead className="sticky top-0 z-10 bg-card">
                    <tr className="border-b border-border text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      <SortablePublicResultHeader activeSort={activeTableSortKey} direction={activeTableSortDirection} label="#" onSort={handleTableSort} sortKey="rank" sortLabel={t("results.page.table.placeSort")} className="w-14" />
                      <SortablePublicResultHeader activeSort={activeTableSortKey} direction={activeTableSortDirection} label={t("common.athlete")} onSort={handleTableSort} sortKey="athlete" className="min-w-40" />
                      <SortablePublicResultHeader activeSort={activeTableSortKey} direction={activeTableSortDirection} label={t("common.country")} onSort={handleTableSort} sortKey="country" className="min-w-32" />
                      <SortablePublicResultHeader activeSort={activeTableSortKey} direction={activeTableSortDirection} label={t("common.club")} onSort={handleTableSort} sortKey="club" className="w-24 max-w-24 text-[9px]" labelClassName="max-w-16" />
                      <SortablePublicResultHeader activeSort={activeTableSortKey} direction={activeTableSortDirection} label={t("common.status")} onSort={handleTableSort} sortKey="status" className="w-16" />
                      <SortablePublicResultHeader activeSort={activeTableSortKey} direction={activeTableSortDirection} label={t("common.category")} onSort={handleTableSort} sortKey="category" sortLabel={t("results.page.table.categorySort")} className="min-w-24" />
                      <SortablePublicResultHeader activeSort={activeTableSortKey} direction={activeTableSortDirection} label={t("results.page.table.averageSpeed")} onSort={handleTableSort} sortKey="averageSpeed" className="min-w-24" />
                      {timingColumns.map((column) => (
                        <SortablePublicResultHeader
                          key={column.id}
                          activeSort={activeTableSortKey}
                          align="right"
                          className="min-w-28 whitespace-nowrap"
                          direction={activeTableSortDirection}
                          label={column.label}
                          labelClassName="max-w-24"
                          onSort={handleTableSort}
                          sortKey={`checkpoint:${column.id}`}
                          sublabel={t("results.page.table.elapsedLocal")}
                        />
                      ))}
                      <SortablePublicResultHeader activeSort={activeTableSortKey} align="right" direction={activeTableSortDirection} label={t("common.finish")} onSort={handleTableSort} sortKey="finish" sortLabel={t("results.page.table.finishTime").toLocaleLowerCase(localeTag)} sublabel={t("results.page.table.elapsedGapLocal")} className="min-w-32" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTableEntries.map(({ row, rank, clubLabel, categoryPlacements }, index) => {
                      const rankValue = rank;
                      const podiumVisual = getResultPodiumVisual(rankValue);
                      return (
                        <tr
                          key={`${selectedCategory?.id ?? "results"}-${row.athleteSlug}-${index}`}
                          className={cn(
                            "border-b border-border/30 transition-colors",
                            podiumVisual?.rowClassName,
                            !podiumVisual && index % 2 === 1 && "bg-primary/[0.025]",
                            !podiumVisual && "hover:bg-primary/[0.04]",
                          )}
                        >
                          <td className="px-2 py-2">
                            {rankValue > 0 ? (
                              <ResultPlaceBadge place={rankValue} compact scopeLabel={localizedClassificationLabel(activeStandingScope?.label ?? "Overall", locale)} />
                            ) : (
                              <span className="pl-2 text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <Link to={`/athletes/${row.athleteSlug}`} className="font-medium transition-colors hover:text-primary">
                              {row.name}
                            </Link>
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-xs text-muted-foreground">
                            <CountryWithFlag countryCode={row.countryCode} />
                          </td>
                          <td className="w-24 max-w-24 px-2 py-2 text-[10px] leading-4 text-muted-foreground">
                            <div className="truncate" title={clubLabel}>
                              {clubLabel || "—"}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-center">
                            <CompactResultStatus status={row.status} />
                          </td>
                          <td className="px-2 py-2">
                            {categoryPlacements.length ? (
                              <div className="flex flex-wrap gap-1">
                                {categoryPlacements.map((placement) => (
                                  <span key={placement.scope.id} data-locale-fit="pill" className="rounded-full bg-primary/10 px-2 py-0.5 text-center text-[10px] font-bold text-primary">
                                    {localizedClassificationLabel(placement.scope.label, locale)} #{placement.rank}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 font-mono text-xs font-semibold text-muted-foreground">
                            {formatPublicResultAverageSpeed(selectedCategory?.distanceKm, row.finishTimeMs)}
                          </td>
                          {timingColumns.map((column) => (
                            <ResultCheckpointTimeCell
                              key={column.id}
                              row={row}
                              column={column}
                              timeZone={event.timeZone}
                            />
                          ))}
                          <ResultFinishTimeCell row={row} timeZone={event.timeZone} winnerTimeMs={winnerTimeMs} />
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-card/70 p-4 text-center text-xs text-muted-foreground sm:rounded-2xl sm:p-8 sm:text-sm">
              {t("results.page.table.noRows")}
            </div>
          )}
      </div>
    </div>
  );
}

function ResultsTimelineCard({
  event,
  accent,
  expanded,
  onToggleExpanded,
}: {
  event: VisibleResultsEvent;
  accent: MonthAccent;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const { localeTag, t } = useI18n();
  const meta = getResultsEventMeta(event, t);
  const latestPublishedLabel = formatPublishedDate(getLatestPublishedAt(event.visibleRaces), localeTag);
  const canExpand = meta.kind !== "closed";
  const image = pickResultsCardImage(event);
  const updateLabel = latestPublishedLabel ?? (event.dateValue
    ? new Intl.DateTimeFormat(localeTag, { day: "numeric", month: "short" }).format(event.dateValue)
    : null);

  return (
    <div
      role={canExpand ? "button" : "article"}
      aria-label={canExpand ? t("results.page.eventStandings", { event: event.eventName }) : event.eventName}
      aria-expanded={canExpand ? expanded : undefined}
      tabIndex={canExpand ? 0 : undefined}
      onClick={canExpand ? onToggleExpanded : undefined}
      onKeyDown={canExpand
        ? (keyEvent) => {
            if (keyEvent.key === "Enter" || keyEvent.key === " ") {
              keyEvent.preventDefault();
              onToggleExpanded();
            }
          }
        : undefined}
      className={`group relative overflow-hidden rounded-2xl border border-border bg-card shadow-soft sm:rounded-[28px] ${accent.cardTint} ${
        canExpand ? "cursor-pointer transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-lg" : ""
      }`}
    >
      <div className="pointer-events-none absolute right-[-18px] top-[-18px] h-28 w-28 rounded-full bg-primary/10 blur-2xl" />
      <div className={`absolute inset-y-5 left-0 w-1 rounded-r-full ${accent.stripe}`} />

      <div className="grid min-h-28 grid-cols-[5.75rem_minmax(0,1fr)] gap-2 p-2.5 sm:min-h-0 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-4 sm:p-4">
        <div className="relative aspect-square overflow-hidden rounded-[14px] border border-white/30 bg-muted shadow-soft sm:rounded-[22px]">
          <PublicCardImage
            src={image}
            alt={event.eventName}
            sizes="(min-width: 640px) 136px, 92px"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/46 via-black/10 to-transparent" />
          <span data-locale-fit="stable-pill" className={`absolute inset-x-1 top-1.5 mx-auto w-fit max-w-[calc(100%-0.5rem)] rounded-full border px-1.5 py-1 text-center text-[9px] font-bold uppercase tracking-[0.06em] shadow-sm backdrop-blur-sm sm:top-3 sm:px-3 sm:text-[10px] sm:tracking-[0.18em] ${meta.kind === "finished" ? "border-primary bg-primary text-primary-foreground" : meta.tone}`}>
            {meta.label}
          </span>
        </div>

        <div className="flex h-full min-w-0 flex-col justify-center overflow-hidden sm:justify-between sm:overflow-visible">
          <div className="flex items-start justify-between gap-2 sm:flex-wrap sm:gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-start gap-1.5">
                <PublicCatalogCardTitle className="flex-1">
                  {event.eventName}
                </PublicCatalogCardTitle>
                <Link
                  to={`/events/${event.eventSlug}`}
                  aria-label={t("results.page.openNamedEvent", { event: event.eventName })}
                  onClick={(clickEvent) => clickEvent.stopPropagation()}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/25 text-primary sm:hidden"
                >
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </div>

              <div className="mt-1.5 min-w-0 text-[10px] leading-4 text-muted-foreground sm:hidden">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Calendar className="h-3 w-3 shrink-0 text-primary" />
                  <span className="shrink-0">{formatEventDate(event, localeTag)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{event.location}</span>
                </div>
                <div className="mt-1 flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate font-medium text-foreground/80">
                    {t("results.page.racesCount", { count: event.raceCount })} · {t("results.page.finishersCount", { count: event.finisherCount })}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-primary">
                    {canExpand ? t("common.standings") : t("results.page.status.closed")}
                    {canExpand ? (
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
                    ) : null}
                  </span>
                </div>
              </div>

              {meta.kind === "closed" ? (
                <p className="mt-2 text-[10px] leading-4 text-muted-foreground sm:text-sm sm:leading-6">{meta.summary}</p>
              ) : null}
            </div>

            <div className="hidden shrink-0 flex-col items-end gap-1.5 self-start sm:flex">
              <div className="flex items-center gap-2">
                <div data-locale-fit="info-pill" className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-background/95 px-3 py-1.5 text-center shadow-sm ring-1 ring-primary/10">
                  {canExpand ? (
                    <div className="font-display text-lg font-extrabold leading-none tracking-tight text-foreground">
                      {event.publishedRaceCount}/{event.raceCount}
                    </div>
                  ) : null}
                  <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {t(!canExpand ? "results.page.noResultsExpected" : event.publishedRaceCount > 0 ? "results.page.resultsAvailable" : "results.page.noResultsYet")}
                  </div>
                </div>

                <Link
                  to={`/events/${event.eventSlug}`}
                  onClick={(clickEvent) => clickEvent.stopPropagation()}
                  className="inline-flex items-center gap-2 rounded-full border border-primary/35 px-3 py-2 text-sm font-semibold text-primary transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground"
                >
                  {t("results.page.openEvent")}
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>

          <div className="mt-3 hidden flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3 sm:flex">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span data-locale-fit="info-pill" className={`inline-flex items-center gap-1.5 rounded-full border border-border/70 px-3 py-1.5 text-[11px] font-semibold ${accent.metaTint}`}>
                <Calendar className="h-3.5 w-3.5 text-primary" />
                <span>{formatEventDate(event, localeTag)}</span>
              </span>
              <span data-locale-fit="info-pill" className={`inline-flex items-center gap-1.5 rounded-full border border-border/70 px-3 py-1.5 text-[11px] font-semibold ${accent.metaTint}`}>
                <Flag className="h-3.5 w-3.5 text-primary" />
                <span>{t("results.page.racesCount", { count: event.raceCount })}</span>
              </span>
              <span data-locale-fit="info-pill" className={`inline-flex items-center gap-1.5 rounded-full border border-border/70 px-3 py-1.5 text-[11px] font-semibold ${accent.metaTint}`}>
                <Users className="h-3.5 w-3.5 text-primary" />
                <span>{t("results.page.registeredCount", { count: event.registeredRunnerCount })}</span>
              </span>
              <span data-locale-fit="info-pill" className={`inline-flex items-center gap-1.5 rounded-full border border-border/70 px-3 py-1.5 text-[11px] font-semibold ${accent.metaTint}`}>
                <Trophy className="h-3.5 w-3.5 text-primary" />
                <span>{t("results.page.finishersCount", { count: event.finisherCount })}</span>
              </span>
              <span data-locale-fit="info-pill" className={`inline-flex items-center gap-1.5 rounded-full border border-border/70 px-3 py-1.5 text-[11px] font-semibold ${accent.metaTint}`}>
                <MapPin className="h-3.5 w-3.5 text-primary" />
                <span className="font-medium text-foreground/85">{event.organizer}</span>
                <span className="h-1 w-1 rounded-full bg-border" />
                <span className="truncate text-muted-foreground">{event.location}</span>
              </span>
            </div>

            <div className="text-right">
              <p className="text-[11px] leading-5 text-muted-foreground">
                {updateLabel ? t("results.page.updated", { date: updateLabel }) : t("results.page.updatedRecently")}
              </p>
            </div>
          </div>

        </div>

        <div className="col-span-full">
          <InlineResultsPanel
            event={event}
            meta={meta}
            expanded={expanded}
          />
        </div>
      </div>
    </div>
  );
}

function ResultsTimelineView({
  groups,
  emptyTitle,
  emptyDescription,
  onClearFilters,
  clearFiltersLabel,
  expandedEventSlug,
  onToggleExpanded,
}: {
  groups: ResultsMonthGroup[];
  emptyTitle: string;
  emptyDescription: string;
  onClearFilters?: () => void;
  clearFiltersLabel?: string;
  expandedEventSlug: string | null;
  onToggleExpanded: (eventSlug: string) => void;
}) {
  if (!groups.length) {
    return (
      <div className="rounded-[28px] border border-dashed border-border bg-card/70 p-10 text-center shadow-soft">
        <Trophy className="mx-auto h-10 w-10 text-muted-foreground/35" />
        <h2 className="mt-4 font-display text-2xl font-bold text-foreground">{emptyTitle}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{emptyDescription}</p>
        {onClearFilters ? (
          <button
            type="button"
            onClick={onClearFilters}
            className="mt-4 min-h-11 rounded-xl border border-primary/30 px-4 text-sm font-semibold text-primary outline-none hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-primary"
          >
            {clearFiltersLabel}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-8">
      {groups.map((group) => (
        <section key={group.key} className="space-y-3 sm:space-y-5">
          <TimelineMonthHeader label={group.label} countLabel={group.countLabel} accent={group.accent} variant={group.markerVariant} />

          <div className="space-y-2 sm:space-y-4">
            {group.events.map((event, index) => {
              const accent = getResultsEventAccent(event, group.accent);
              return (
                <motion.div
                  key={event.eventSlug}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, delay: index * 0.04 }}
                  className="grid grid-cols-1 gap-2 sm:grid-cols-[88px_minmax(0,1fr)] sm:gap-4 md:gap-5"
                >
                  <ResultsDateBadge
                    dateValue={event.dateValue}
                    accent={accent}
                    isLast={index === group.events.length - 1}
                  />

                  <ResultsTimelineCard
                    event={event}
                    accent={accent}
                    expanded={expandedEventSlug === event.eventSlug}
                    onToggleExpanded={() => onToggleExpanded(event.eventSlug)}
                  />
                </motion.div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function ResultsGridCard({
  event,
  image,
}: {
  event: VisibleResultsEvent;
  image: string;
}) {
  const { localeTag, t } = useI18n();
  const meta = getResultsEventMeta(event, t);
  const href = meta.kind === "closed"
    ? `/events/${event.eventSlug}`
    : `/events/${event.eventSlug}?tab=results`;

  return (
    <Link
      to={href}
      className="group block overflow-hidden rounded-[28px] border border-border bg-card shadow-soft transition-all duration-300 hover:-translate-y-1 hover:border-primary/20 hover:shadow-lg"
    >
      <div className="relative aspect-[16/10] overflow-hidden">
        <PublicCardImage
          src={image}
          alt={event.eventName}
          sizes="(min-width: 1400px) 442px, (min-width: 1280px) calc(33.333vw - 24px), (min-width: 768px) calc(50vw - 26px), calc(100vw - 32px)"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/46 via-black/8 to-transparent" />
        <div className="absolute left-4 top-4 flex flex-wrap gap-2">
          <span data-locale-fit="pill" className={`inline-flex rounded-full border px-2.5 py-1 text-center text-[10px] font-bold uppercase tracking-[0.18em] ${meta.tone}`}>
            {meta.label}
          </span>
        </div>
        <span className="absolute bottom-4 left-4 rounded-full border border-white/25 bg-black/34 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white backdrop-blur-sm">
          {t("results.page.racesCount", { count: event.raceCount })}
        </span>
      </div>

      <div className="p-5">
        <h3 className="font-display text-2xl font-bold leading-[1.02] text-foreground transition-colors group-hover:text-primary">
          {event.eventName}
        </h3>
        <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold text-muted-foreground">
          <span data-locale-fit="info-pill" className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-primary/[0.04] px-3 py-1.5">
            <Calendar className="h-3.5 w-3.5 shrink-0 text-primary" />
            {formatEventDate(event, localeTag)}
          </span>
          <span data-locale-fit="info-pill" className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border/70 bg-primary/[0.04] px-3 py-1.5">
            <Flag className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="truncate">{event.organizer}</span>
          </span>
          <span data-locale-fit="info-pill" className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border/70 bg-primary/[0.04] px-3 py-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="truncate">{event.location}</span>
          </span>
          <span data-locale-fit="info-pill" className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-primary/[0.04] px-3 py-1.5">
            <Users className="h-3.5 w-3.5 shrink-0 text-primary" />
            {t("results.page.registeredCount", { count: event.registeredRunnerCount })}
          </span>
          <span data-locale-fit="info-pill" className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-primary/[0.04] px-3 py-1.5">
            <Trophy className="h-3.5 w-3.5 shrink-0 text-primary" />
            {t("results.page.finishersCount", { count: event.finisherCount })}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {event.visibleRaces.slice(0, 3).map((race) => (
            <span
              key={race.id}
              data-locale-fit="pill"
              className={`inline-flex rounded-full border px-2.5 py-1 text-center text-[10px] font-bold uppercase tracking-[0.18em] ${meta.kind === "closed" ? eventStatusTone.closed : raceStatusTone[race.resultsStatus]}`}
            >
              {race.label}
            </span>
          ))}
        </div>

        {meta.kind === "closed" ? <p className="mt-3 text-xs text-muted-foreground">{meta.summary}</p> : null}
        <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary">
          {meta.ctaLabel}
          <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </div>
      </div>
    </Link>
  );
}

function ResultsMapSidebarCard({
  event,
  image,
  active,
  onMouseEnter,
  onMouseLeave,
}: {
  event: VisibleResultsEvent;
  image: string;
  active: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const { localeTag, t } = useI18n();
  const meta = getResultsEventMeta(event, t);
  const href = meta.kind === "closed"
    ? `/events/${event.eventSlug}`
    : `/events/${event.eventSlug}?tab=results`;

  return (
    <Link
      to={href}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`group flex gap-3 overflow-hidden rounded-[24px] border bg-card p-3 shadow-soft transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-lg ${
        active ? "border-primary/30 ring-1 ring-primary/20" : "border-border"
      }`}
    >
      <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-[18px] border border-white/30 bg-muted">
        <PublicCardImage
          src={image}
          alt={event.eventName}
          sizes="96px"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/48 via-black/10 to-transparent" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span data-locale-fit="pill" className={`inline-flex rounded-full border px-2.5 py-1 text-center text-[10px] font-bold uppercase tracking-[0.18em] ${meta.tone}`}>
            {meta.label}
          </span>
        </div>
        <h3 className="mt-2 font-display text-lg font-bold leading-tight text-foreground transition-colors group-hover:text-primary">
          {event.eventName}
        </h3>
        <div className="mt-2 text-xs text-muted-foreground">
          {[formatEventDate(event, localeTag), event.location].filter(Boolean).join(" · ")}
        </div>
        <div className="mt-2 text-xs text-muted-foreground">{meta.summary}</div>
      </div>
    </Link>
  );
}

function ResultsDirectoryLoadingSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="space-y-3 sm:space-y-5"
    >
      <span className="sr-only">{label}</span>
      <div className="flex items-center gap-3 sm:gap-5" aria-hidden="true">
        <div className="h-16 w-16 shrink-0 animate-pulse rounded-[20px] bg-muted sm:h-[84px] sm:w-[84px] sm:rounded-[28px]" />
        <div className="space-y-2">
          <div className="h-6 w-40 animate-pulse rounded bg-muted" />
          <div className="h-3 w-24 animate-pulse rounded bg-muted/75" />
        </div>
      </div>
      <div className="space-y-2 sm:space-y-4" aria-hidden="true">
        {[0, 1].map((index) => (
          <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[88px_minmax(0,1fr)] sm:gap-4 md:gap-5">
            <div className="hidden min-h-28 animate-pulse rounded-[22px] bg-muted/75 sm:block" />
            <div className="grid min-h-28 grid-cols-[5.75rem_minmax(0,1fr)] gap-2 overflow-hidden rounded-2xl border border-border bg-card p-2.5 shadow-soft sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-4 sm:rounded-[28px] sm:p-4">
              <div className="animate-pulse rounded-[14px] bg-muted sm:rounded-[22px]" />
              <div className="flex flex-col justify-center gap-3">
                <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-muted/75" />
                <div className="h-3 w-3/4 animate-pulse rounded bg-muted/60" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ResultsPage() {
  const { localeTag, t } = useI18n();
  const query = useQuery({
    queryKey: ["public-results-directory"],
    queryFn: getPublicResultsDirectoryReadModel,
  });
  const hasDirectory = Boolean(query.data);
  const data = query.data ?? emptyResultsDirectory;

  const [search, setSearch] = useState("");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<ResultsFilter>("all");
  const [viewMode, setViewMode] = useState<ResultsViewMode>("list");
  const effectiveViewMode = useMobileListView(viewMode, "list");
  const [expandedEventSlug, setExpandedEventSlug] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | undefined>();
  const today = useMemo(() => startOfCalendarDay(new Date()), []);
  const isInitialDirectoryLoad = query.isPending;
  const finishedDirectoryEvents = useMemo(
    () => getFinishedResultsDirectoryEvents(data.events, today),
    [data.events, today],
  );

  const searchedEvents = useMemo(() => {
    const query = search.trim().toLowerCase();

    return finishedDirectoryEvents.reduce<VisibleResultsEvent[]>((accumulator, event) => {
      const eventMatches =
        !query ||
        event.eventName.toLowerCase().includes(query) ||
        event.location.toLowerCase().includes(query) ||
        event.organizer.toLowerCase().includes(query);

      const matchingRaces = event.races.filter((race) => {
        if (!query) return true;
        return race.label.toLowerCase().includes(query) || (race.distanceLabel ?? "").toLowerCase().includes(query);
      });

      if (!eventMatches && !matchingRaces.length) {
        return accumulator;
      }

      accumulator.push({
        ...event,
        visibleRaces: eventMatches ? event.races : matchingRaces,
        dateValue: parseDateValue(event.startDateIso),
      });

      return accumulator;
    }, []);
  }, [finishedDirectoryEvents, search]);

  const eventsByFilter = useMemo(() => {
    const all = [...searchedEvents].sort((left, right) => (
      (right.dateValue?.getTime() ?? 0) - (left.dateValue?.getTime() ?? 0)
    ));
    return {
      all,
      finished: all.filter((event) => event.resultsKind === "finished"),
      pending: all.filter((event) => event.resultsKind === "pending"),
      closed: all.filter((event) => event.resultsKind === "closed"),
    } satisfies Record<ResultsFilter, VisibleResultsEvent[]>;
  }, [searchedEvents]);
  const allEvents = eventsByFilter.all;
  const pendingCount = eventsByFilter.pending.length;
  const closedCount = eventsByFilter.closed.length;
  const statusFilter = selectedStatusFilter;
  const activeCollection = eventsByFilter[statusFilter];
  const statusOptions = [
    { value: "all", label: t("common.all"), count: allEvents.length },
    { value: "finished", label: t("results.page.filter.published"), count: eventsByFilter.finished.length },
    { value: "pending", label: t("results.page.status.pending"), count: pendingCount },
    { value: "closed", label: t("results.page.status.closed"), count: closedCount },
  ] as const;

  useEffect(() => {
    if (!highlightId) return;
    if (activeCollection.some((event) => event.eventSlug === highlightId)) return;
    setHighlightId(undefined);
  }, [activeCollection, highlightId]);

  useEffect(() => {
    if (!expandedEventSlug) return;
    if (activeCollection.some((event) => event.eventSlug === expandedEventSlug)) return;
    setExpandedEventSlug(null);
  }, [activeCollection, expandedEventSlug]);

  const { visibleCount, canLoadMore, loadMore, sentinelRef } = useProgressiveList({
    totalCount: activeCollection.length,
    resetKey: `${statusFilter}|${search.toLowerCase()}`,
    initialCount: 20,
    batchSize: 20,
  });

  const visibleEvents = useMemo(
    () => activeCollection.slice(0, visibleCount),
    [activeCollection, visibleCount],
  );

  const visibleGroups = useMemo(() => buildMonthGroups(visibleEvents, localeTag, t), [localeTag, t, visibleEvents]);
  const monthCount = useMemo(
    () => new Set(activeCollection.map((event) => monthGroupKey(event.dateValue, event.eventSlug))).size,
    [activeCollection],
  );

  const mapEvents: EventLocation[] = visibleEvents.map((event) => {
    const meta = getResultsEventMeta(event, t);
    return {
      id: event.eventSlug,
      title: event.eventName,
      location: event.location,
      lat: event.lat,
      lng: event.lng,
      status: "finished",
      badgeLabel: meta.badgeLabel,
      date: formatEventDate(event, localeTag),
      distance: t("results.page.racesCount", { count: event.raceCount }),
    };
  });

  const clearFilters = () => {
    setSelectedStatusFilter("all");
    setSearch("");
    setExpandedEventSlug(null);
  };

  const isUnfilteredDirectoryEmpty = hasDirectory
    && finishedDirectoryEvents.length === 0
    && statusFilter === "all"
    && !search.trim();
  const emptyState =
    isUnfilteredDirectoryEmpty
      ? {
          title: t("results.page.directoryEmpty"),
          description: t("results.page.directoryEmptyDescription"),
        }
      : statusFilter === "all"
      ? {
          title: t("results.page.filter.allEmpty"),
          description: t("results.page.filter.allEmptyDescription"),
        }
      : statusFilter === "closed"
      ? {
          title: t("results.page.filter.closedEmpty"),
          description: t("results.page.filter.closedEmptyDescription"),
        }
      : statusFilter === "pending"
        ? {
            title: t("results.page.filter.pendingEmpty"),
            description: t("results.page.filter.pendingEmptyDescription"),
          }
      : {
          title: t("results.page.filter.finishedEmpty"),
          description: t("results.page.filter.finishedEmptyDescription"),
        };

  return (
    <div className="pb-12">
      <ScrollReveal>
        <SubpageHero
          eyebrow={t("results.page.hero.eyebrow")}
          title={t("results.page.hero.title")}
          description={t("results.page.hero.description")}
          imageSrc={resultsHeroImage}
          imageAlt={t("results.page.hero.imageAlt")}
          badges={[t("results.page.hero.finished"), t("results.page.hero.unofficial"), t("results.page.hero.final")]}
          stats={[
            { label: t("common.finished"), value: hasDirectory ? String(allEvents.length) : "—", icon: Trophy, toneClassName: "text-primary" },
            { label: t("results.page.status.pending"), value: hasDirectory ? String(pendingCount) : "—", icon: Clock3, toneClassName: "text-trail-amber" },
            { label: t("results.page.status.closed"), value: hasDirectory ? String(closedCount) : "—", icon: Flag, toneClassName: "text-muted-foreground" },
          ]}
          imagePositionClassName="object-center"
        />
      </ScrollReveal>

      <div className="container mx-auto px-4 pt-4 sm:pt-8">
        {hasDirectory ? <ScrollReveal delay={0.1}>
          <MobileFilterPanel
            activeCount={Number(Boolean(search.trim())) + Number(statusFilter !== "all")}
            onClear={clearFilters}
            className="mb-4 lg:mb-8"
          >
            <div className="flex flex-col gap-4 md:flex-row md:items-center">
              <div className="flex-1 max-w-md">
                <div className="mb-2 hidden text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground sm:block">{t("common.search")}</div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder={t("results.page.searchPlaceholder")}
                    aria-label={t("results.page.searchPlaceholder")}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="min-h-11 w-full rounded-xl border border-border bg-background py-2.5 pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  {search ? (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      aria-label={t("mobile.filters.clear")}
                      className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </div>

              <MobileFilterSelect<ResultsFilter>
                label={t("common.status")}
                value={statusFilter}
                options={statusOptions.map(({ value, label, count }) => ({ value, label: `${label} (${count})` }))}
                onChange={setSelectedStatusFilter}
              />
              <MobileFilterRail>
                {statusOptions.map(({ value: filter, label, count }) => (
                  <MobileFilterButton
                    key={filter}
                    aria-pressed={statusFilter === filter}
                    onClick={() => setSelectedStatusFilter(filter)}
                    className={
                      statusFilter === filter
                        ? "bg-primary text-primary-foreground shadow-warm"
                        : "bg-secondary text-secondary-foreground hover:bg-muted"
                    }
                    data-locale-fit="pill"
                  >
                    {label}
                    <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                      statusFilter === filter
                        ? "bg-white/20 text-primary-foreground dark:bg-black/20"
                        : "bg-background text-muted-foreground"
                    }`}>
                      {count}
                    </span>
                  </MobileFilterButton>
                ))}
              </MobileFilterRail>

              <div className="ml-auto hidden items-center gap-2 sm:flex">
                <div className="flex rounded-xl border border-border bg-background p-1">
                  {([["list", List, t("results.page.listView")], ["grid", LayoutGrid, t("results.page.gridView")], ["map", Map, t("results.page.mapView")]] as const).map(([mode, Icon, label]) => (
                    <button
                      key={mode}
                      onClick={() => setViewMode(mode)}
                      aria-label={label}
                      className={`flex min-h-10 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors sm:px-3 ${
                        viewMode === mode ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Icon className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                      <span className="hidden sm:inline">{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </MobileFilterPanel>
        </ScrollReveal> : null}

        <div className="mb-5 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span>{hasDirectory ? t("results.page.eventsFound", { count: activeCollection.length }) : "—"}</span>
          <span className="hidden h-1 w-1 rounded-full bg-border md:block" />
          <span>{hasDirectory ? t("results.page.monthsInView", { count: monthCount }) : "—"}</span>
        </div>

        {query.isError ? (
          <div role="alert" className="mb-5 rounded-2xl border border-border bg-card px-5 py-6 text-center shadow-soft">
            <p className="text-sm text-muted-foreground">{t("results.page.loadError")}</p>
            <button
              type="button"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
              className="mt-3 min-h-11 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground disabled:opacity-50"
            >
              {t("common.tryAgain")}
            </button>
          </div>
        ) : null}

        {isInitialDirectoryLoad ? (
          <ResultsDirectoryLoadingSkeleton label={t("results.page.loading")} />
        ) : !hasDirectory ? null
        : activeCollection.length === 0 ? (
          <ResultsTimelineView
            groups={[]}
            emptyTitle={emptyState.title}
            emptyDescription={emptyState.description}
            onClearFilters={search.trim() || statusFilter !== "all" ? clearFilters : undefined}
            clearFiltersLabel={t("results.page.clearFilters")}
            expandedEventSlug={null}
            onToggleExpanded={() => undefined}
          />
        ) : effectiveViewMode === "map" ? (
          <ScrollReveal delay={0.15}>
            <div className="grid gap-6 lg:grid-cols-5">
              <div className="lg:col-span-3 overflow-hidden rounded-2xl border border-border shadow-soft" style={{ height: 560 }}>
                <EventLocationsMap events={mapEvents} highlightId={highlightId} className="h-full" onMarkerClick={setHighlightId} />
              </div>
              <div className="lg:col-span-2 space-y-3 max-h-[560px] overflow-y-auto pr-1">
                {visibleEvents.map((event) => (
                  <ResultsMapSidebarCard
                    key={event.eventSlug}
                    event={event}
                    image={pickResultsCardImage(event)}
                    active={highlightId === event.eventSlug}
                    onMouseEnter={() => setHighlightId(event.eventSlug)}
                    onMouseLeave={() => setHighlightId(undefined)}
                  />
                ))}
              </div>
            </div>
          </ScrollReveal>
        ) : effectiveViewMode === "grid" ? (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {visibleEvents.map((event) => (
              <ResultsGridCard
                key={event.eventSlug}
                event={event}
                image={pickResultsCardImage(event)}
              />
            ))}
          </div>
        ) : (
          <ResultsTimelineView
            groups={visibleGroups}
            emptyTitle={emptyState.title}
            emptyDescription={emptyState.description}
            expandedEventSlug={expandedEventSlug}
            onToggleExpanded={(eventSlug) => setExpandedEventSlug((current) => current === eventSlug ? null : eventSlug)}
          />
        )}

        {hasDirectory && activeCollection.length > 0 ? (
          <ProgressiveListControls
            visibleCount={visibleCount}
            totalCount={activeCollection.length}
            canLoadMore={canLoadMore}
            onLoadMore={loadMore}
            sentinelRef={sentinelRef}
            itemLabel={t("results.page.itemsGenitive")}
          />
        ) : null}
      </div>
    </div>
  );
}
