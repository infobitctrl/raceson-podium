import type { ReactNode } from "react";
import { ArrowRight, Calendar, Flag, MapPin, Mountain, ShieldCheck, Trophy, Users } from "lucide-react";
import { Link } from "react-router-dom";
import {
  CalendarTimelineDateBadge,
} from "@/components/shared/CalendarTimeline";
import { pickCalendarTimelineAccent } from "@/components/shared/calendarTimelineAccents";
import { getLeagueAboutDescription, summarizeLeagueDescription } from "@/features/leagues/model/leagueDescription";
import { buildLeagueCalendarRoundHref } from "@/features/leagues/public/model/leagueRoundNavigation";
import { LeagueCourseRankCharts } from "@/features/leagues/public/components/LeagueCourseRankCharts";
import type {
  PublicLeagueDetailReadModel,
  PublicLeagueRoundItem,
} from "@/lib/league-read-models";
import { MobileDetailDisclosure } from "@/shared/mobile/MobileDetailDisclosure";
import { useI18n } from "@/shared/i18n/I18nContext";
import { isSibenikTrailLeague } from "@/features/leagues/public/data/sibenikTrailLeague";
import {
  localizedLeagueDataLabel,
  localizedLeagueLocation,
  localizedLeagueSeasonLabel,
} from "@/features/leagues/public/model/leagueLocale";
import { sortCalendarItemsLatestFirst } from "@/shared/calendar/calendarChronology";
import { getPublicRaceLifecycleLabelKey } from "@/features/events/public/model/eventStatusPresentation";

type LeagueTranslate = ReturnType<typeof useI18n>["t"];

function roundPresentation(round: PublicLeagueRoundItem, t: LeagueTranslate) {
  if (round.isPlaceholder) {
    return {
      label: t("league.calendar.planned"),
      badgeClassName: "border-border bg-muted/55 text-muted-foreground",
      action: t("league.calendar.awaitingEvent"),
    };
  }
  if (round.status === "completed") {
    return {
      label: t(getPublicRaceLifecycleLabelKey(round.status)),
      badgeClassName: "timing-lime-pill",
      action: round.hasPublishedResults || round.hasPartialPublishedResults
        ? t("league.calendar.viewResults")
        : t("league.calendar.eventDetails"),
    };
  }
  if (round.status === "in_progress") {
    return {
      label: t(getPublicRaceLifecycleLabelKey(round.status)),
      badgeClassName: "border-primary/20 bg-primary/10 text-primary",
      action: t("league.calendar.followEvent"),
    };
  }
  if (round.status === "registration_open") {
    return {
      label: t(getPublicRaceLifecycleLabelKey(round.status)),
      badgeClassName: "border-primary/20 bg-primary/10 text-primary",
      action: t("league.calendar.enterRound"),
    };
  }
  if (round.status === "registration_closed") {
    return {
      label: t(getPublicRaceLifecycleLabelKey(round.status)),
      badgeClassName: "border-primary/20 bg-primary/10 text-primary",
      action: t("league.calendar.eventDetails"),
    };
  }
  return {
    label: t(getPublicRaceLifecycleLabelKey(round.status)),
    badgeClassName: "border-primary/20 bg-primary/10 text-primary",
    action: t("league.calendar.eventDetails"),
  };
}

function RoundCalendarCard({
  isLast,
  isNext,
  leagueSlug,
  round,
}: {
  isLast: boolean;
  isNext: boolean;
  leagueSlug: string;
  round: PublicLeagueRoundItem;
}) {
  const { locale, t } = useI18n();
  const dateValue = roundDateValue(round);
  const timelineAccent = pickCalendarTimelineAccent(dateValue, round.status === "completed");
  const presentation = roundPresentation(round, t);
  const shellClassName = `group relative my-3 grid gap-3 rounded-[22px] border border-border/70 bg-card px-3 py-3.5 shadow-[0_16px_44px_-34px_hsl(25_30%_12%_/_0.42)] sm:grid-cols-[68px_minmax(0,1fr)] sm:gap-4 md:my-4 md:grid-cols-[76px_minmax(0,1fr)_auto] md:items-center md:gap-5 md:rounded-[28px] md:px-4 md:py-4 ${round.isPlaceholder ? "grid-cols-[minmax(0,1fr)] opacity-75" : "grid-cols-[68px_minmax(0,1fr)] transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_24px_54px_-32px_hsl(24_100%_45%_/_0.3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"}`;
  const content = (
    <>
      <span className={`absolute inset-y-5 left-0 w-1 rounded-r-full ${timelineAccent.stripe}`} aria-hidden="true" />
      <div className={round.isPlaceholder ? "hidden sm:block" : ""}>
        <CalendarTimelineDateBadge
          dateValue={dateValue}
          accent={timelineAccent}
          isLast={isLast}
        />
      </div>

      <div className="min-w-0 md:flex md:items-center md:gap-4">
        {round.eventImageUrl ? (
          <div className="relative mb-3 h-28 w-full shrink-0 overflow-hidden rounded-[18px] border border-border/70 shadow-soft md:mb-0 md:h-24 md:w-36 md:rounded-[20px]">
            <img
              src={round.eventImageUrl}
              alt=""
              aria-hidden="true"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />
          </div>
        ) : (
          <div className={`relative mb-3 flex h-28 w-full shrink-0 items-center justify-center overflow-hidden rounded-[18px] border border-border/70 md:mb-0 md:h-24 md:w-36 md:rounded-[20px] ${timelineAccent.cardTint}`} aria-hidden="true">
            <div className="absolute inset-0 route-pattern opacity-35" />
            <Mountain className="relative h-9 w-9 text-muted-foreground/45" />
          </div>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span data-locale-fit="table-heading" className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{t("league.calendar.round", { round: round.roundNumber })}</span>
            {isNext ? <span data-locale-fit="pill" className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-primary">{t("league.calendar.next")}</span> : null}
            <span data-locale-fit="pill" className={`rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.16em] ${presentation.badgeClassName}`}>{presentation.label}</span>
          </div>
          <h3 className="mt-1.5 font-display text-base font-bold tracking-tight text-foreground transition-colors group-hover:text-primary md:mt-2 md:text-lg">
            {round.isPlaceholder ? t("league.calendar.eventTba") : round.name}
          </h3>
          <div className="mt-2 flex flex-wrap gap-1.5 md:mt-3 md:gap-2">
            <span className="hidden sm:inline-flex"><InfoPill icon={MapPin}>{localizedLeagueLocation(round.location, locale)}</InfoPill></span>
            <InfoPill icon={Mountain}>
              {round.isPlaceholder
                ? t("league.calendar.metricsTba")
                : `${localizedLeagueDataLabel(round.categoryName, locale)} · ${round.distance} · ${round.elevation}`}
            </InfoPill>
            <InfoPill icon={Users}>{t(
              round.participants === 1
                ? "league.overview.registration"
                : "league.overview.registrations",
              { count: round.participants },
            )}</InfoPill>
          </div>
        </div>
      </div>

      <span data-locale-fit="control" className={`${round.isPlaceholder ? "col-start-1 sm:col-start-2" : "col-start-2"} inline-flex w-fit items-center gap-2 rounded-full px-3.5 py-2 text-xs font-semibold md:col-start-auto ${
        round.isPlaceholder
          ? "border border-dashed border-border text-muted-foreground"
          : "border border-primary/25 text-primary transition-colors group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground"
      }`}>
        {presentation.action}
        {!round.isPlaceholder ? <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /> : null}
      </span>
    </>
  );

  if (round.isPlaceholder) {
    return <article className={shellClassName}>{content}</article>;
  }

  return (
    <Link
      to={buildLeagueCalendarRoundHref(leagueSlug, round)}
      aria-label={t("league.calendar.openRound", { round: round.roundNumber, name: round.name })}
      className={shellClassName}
    >
      {content}
    </Link>
  );
}

function roundDateValue(round: PublicLeagueRoundItem) {
  if (!round.dateIso) return null;
  const parsed = new Date(`${round.dateIso}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function conciseDescription(league: PublicLeagueDetailReadModel, t: LeagueTranslate) {
  if (isSibenikTrailLeague(league.slug)) return t("league.description.sibenikBrief");
  return summarizeLeagueDescription(
    league.description,
    t("league.overview.fallbackDescription", {
      rounds: league.rounds.length,
      season: league.seasonLabel,
    }),
  );
}

function InfoPill({ icon: Icon, children }: { icon: typeof Calendar; children: ReactNode }) {
  return (
    <span data-locale-fit="info-pill" className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground">
      <Icon className="h-3.5 w-3.5 text-primary" />
      {children}
    </span>
  );
}

function PanelTitle({ icon: Icon, children }: { icon: typeof Calendar; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-foreground">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/80 bg-background/90 text-primary shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        <Icon className="h-4 w-4" />
      </span>
      <h2 className="font-display text-[15px] font-bold tracking-[-0.01em]">{children}</h2>
    </div>
  );
}

export function LeagueOverviewCalendar({
  league,
  nextRound,
}: {
  league: PublicLeagueDetailReadModel;
  nextRound: PublicLeagueRoundItem | null;
}) {
  const { localeTag, t } = useI18n();
  const completedRoundCount = league.rounds.filter((round) => round.status === "completed").length;
  const statusLabel = league.status === "completed"
    ? t("league.hero.seasonComplete")
    : league.status === "upcoming"
      ? t("league.hero.seasonUpcoming")
      : t("league.hero.seasonActive");
  const countingResultsLabel = league.rules.bestN > 0 && league.rules.bestN < league.rounds.length
    ? t("league.scoring.best", { count: league.rules.bestN })
    : t("league.scoring.all", { count: league.rounds.length });
  const aboutLeague = isSibenikTrailLeague(league.slug)
    ? t("league.description.sibenikAbout")
    : getLeagueAboutDescription(league.description);
  const seasonLabel = localizedLeagueSeasonLabel(
    league.rounds,
    localeTag,
    t("league.calendar.dateTba"),
  );
  const calendarRounds = sortCalendarItemsLatestFirst(
    league.rounds,
    (round) => round.dateIso ?? round.date,
  );

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_384px]">
      <div className="min-w-0 space-y-6">
        <section className="track-shell-card p-4 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <PanelTitle icon={Trophy}>{t("league.overview.title")}</PanelTitle>
            <span className="rounded-full border border-primary/15 bg-primary/[0.07] px-3 py-1.5 text-[11px] font-bold text-primary">
              {t("league.overview.rounds", { count: league.rounds.length })}
            </span>
          </div>
          <p className="mt-4 max-w-3xl text-[13px] leading-6 text-muted-foreground">
            {conciseDescription(league, t)}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="hidden lg:inline-flex"><InfoPill icon={Calendar}>{seasonLabel}</InfoPill></span>
            <InfoPill icon={Flag}>{t("league.overview.completed", { completed: completedRoundCount, total: league.rounds.length })}</InfoPill>
            <InfoPill icon={Users}>{t("league.overview.registrations", { count: league.summary.totalRegistrations })}</InfoPill>
            <InfoPill icon={ShieldCheck}>{t("league.overview.registrationClubs", { count: league.clubCount })}</InfoPill>
            <span className="hidden lg:inline-flex"><InfoPill icon={Trophy}>{statusLabel}</InfoPill></span>
          </div>
        </section>

        {aboutLeague ? (
          <MobileDetailDisclosure
            title={t("league.overview.about")}
            summary={t("league.overview.aboutSummary")}
            icon={Flag}
            hideOnDesktop={false}
            expandOnDesktop
          >
            <p className="whitespace-pre-line text-sm leading-6 text-muted-foreground">{aboutLeague}</p>
          </MobileDetailDisclosure>
        ) : null}

        <section className="track-shell-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/70 px-5 py-5 md:px-6">
            <PanelTitle icon={Calendar}>{t("league.calendar.title")}</PanelTitle>
            <span className="text-xs font-semibold text-muted-foreground">{t("league.calendar.complete", { completed: completedRoundCount, total: league.rounds.length })}</span>
          </div>

          <div className="px-3 pb-1 md:px-5">
            {calendarRounds.map((round, index) => {
              const isNext = nextRound?.roundId === round.roundId;
              return (
                <RoundCalendarCard
                  key={round.roundId}
                  round={round}
                  leagueSlug={league.slug}
                  isNext={isNext}
                  isLast={index === calendarRounds.length - 1}
                />
              );
            })}
          </div>
        </section>
      </div>

      <aside className="min-w-0 space-y-6">
        <Link to="?tab=results" className="track-shell-card flex min-h-14 items-center gap-3 p-4 text-sm font-semibold text-foreground lg:hidden">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-trail-amber/10 text-trail-summit">
            <Trophy className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display font-bold">{t("league.overview.standings")}</span>
            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{t("league.overview.openStandings")}</span>
          </span>
          <ArrowRight className="h-4 w-4 text-primary" aria-hidden="true" />
        </Link>

        <section className="track-shell-card hidden p-5 lg:block lg:p-6">
          <PanelTitle icon={ShieldCheck}>{t("league.scoring.title")}</PanelTitle>
          <div className="mt-4">
            <div className="track-detail-row text-sm"><span className="text-muted-foreground">{t("league.scoring.countingResults")}</span><strong>{countingResultsLabel}</strong></div>
            <div className="track-detail-row text-sm"><span className="text-muted-foreground">{t("league.scoring.minimumFinishes")}</span><strong>{league.rules.minimumRounds || "—"}</strong></div>
            <div className="track-detail-row text-sm"><span className="text-muted-foreground">{t("league.scoring.tieBreak")}</span><strong className="max-w-[52%] text-right capitalize">{league.rules.tieBreakMethod === "best_finish" ? t("league.scoring.bestFinish") : league.rules.tieBreakMethod.replace(/_/g, " ")}</strong></div>
          </div>
          <Link to="?tab=rules" className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            {t("league.scoring.fullRules")} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </section>

        <section className="track-shell-card overflow-hidden p-5 lg:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <PanelTitle icon={Trophy}>{t("league.rank.byRound")}</PanelTitle>
            <span className="rounded-full border border-trail-amber/25 bg-trail-amber/10 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-trail-summit">
              {t("league.rank.topTen")}
            </span>
          </div>
          <LeagueCourseRankCharts league={league} />
          <Link to="?tab=statistics" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">{t("league.rank.openStatistics")} <ArrowRight className="h-3.5 w-3.5" /></Link>
        </section>
      </aside>
    </div>
  );
}
