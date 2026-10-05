import { Fragment, useId, useMemo, useState } from "react";
import Image from "next/image";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Building2,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Flag,
  MapPin,
  Mountain,
  ShieldCheck,
  Trophy,
  Users,
  X,
} from "lucide-react";
import type {
  PublicLeagueClubStandingItem,
  PublicLeagueDetailReadModel,
  PublicLeagueRoundItem,
  PublicLeagueStandingItem,
} from "@/lib/league-read-models";
import HeroMountainDivider from "@/components/shared/HeroMountainDivider";
import ProgressiveListControls from "@/components/shared/ProgressiveListControls";
import { useProgressiveList } from "@/hooks/use-progressive-list";
import { LeagueOverviewCalendar } from "@/features/leagues/public/components/LeagueOverviewCalendar";
import { ResultPlaceBadge } from "@/features/results/public/components/ResultPodiumVisual";
import { getResultPodiumVisual } from "@/features/results/public/model/resultPodiumVisual";
import {
  getPublicRaceLifecycleLabel,
  getPublicRaceLifecycleLabelKey,
} from "@/features/events/public/model/eventStatusPresentation";
import {
  formatSexClassificationLabel,
  getClassificationLabels,
} from "@/shared/domain/competitiveClassification";
import {
  getDefaultLeagueCompetition,
  getDefaultLeagueRankingBoard,
  getLeagueCompetitionRankingBoards,
} from "@/features/leagues/public/model/leagueLeaderGroups";
import { cn } from "@/lib/utils";
import { normalizeLeagueClubScoringScope } from "@raceson/domain/leagues";
import {
  getSibenikTrailLeagueLocalName,
} from "@/features/leagues/model/sibenikTrailLeagueIdentity";
import { latestPublishedLeagueRound, type LeagueRoundOutcome } from "@/features/leagues/public/model/leaguePublicModel";
import { useI18n } from "@/shared/i18n/I18nContext";
import { MobileFilterPanel } from "@/shared/mobile/MobileFilterPanel";
import {
  localizedLeagueDataLabel,
  localizedLeagueName,
  localizedLeagueSeasonLabel,
} from "@/features/leagues/public/model/leagueLocale";
import { LocaleStablePillLabel } from "@/shared/i18n/LocaleStablePillLabel";

type LeagueCompetition = "long" | "short" | "clubs";

const competitionOptions: Array<{
  value: LeagueCompetition;
  label: string;
  icon: typeof Mountain;
}> = [
  { value: "long", label: "Long Route Cup", icon: Mountain },
  { value: "short", label: "Short Route Cup", icon: Flag },
  { value: "clubs", label: "Club Championship", icon: Users },
];

function standingLeagueCategories(standing: PublicLeagueStandingItem) {
  return (standing.leagueCategoryLabels?.length
    ? standing.leagueCategoryLabels
    : [standing.ageCategory]
  ).map(formatSexClassificationLabel);
}

function formatRoundDate(round: PublicLeagueRoundItem, style: "short" | "long" = "short") {
  if (!round.dateIso) return round.date;
  const parsed = new Date(`${round.dateIso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return round.date;
  return parsed.toLocaleDateString(undefined, style === "long"
    ? { day: "numeric", month: "short", year: "numeric" }
    : { day: "numeric", month: "short" });
}

function shortRoundName(round: PublicLeagueRoundItem, placeholder: string) {
  if (!round.eventSlug || round.name === "Race to be announced") return placeholder;
  const name = round.name.trim();
  if (name.length <= 18) return name;
  return name.split(" ").slice(0, 2).join(" ");
}

function initials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function roundRegistrationHref(round: PublicLeagueRoundItem) {
  if (round.hasPublishedResults || round.hasPartialPublishedResults) return `/events/${round.eventSlug}?tab=results`;
  if (round.status === "registration_open") return `/events/${round.eventSlug}?tab=registrations`;
  return `/events/${round.eventSlug}`;
}

function roundLifecycleLabel(
  round: PublicLeagueRoundItem,
  t?: ReturnType<typeof useI18n>["t"],
) {
  return t?.(getPublicRaceLifecycleLabelKey(round.status))
    ?? getPublicRaceLifecycleLabel(round.status);
}

function competitionPillReferenceLabel(label: string) {
  if (label === "Short") return "Short route";
  if (label === "Long") return "Long route";
  return label;
}

function classificationPillReferenceLabel(label: string) {
  if (label === "Male") return "Female";
  if (label === "Male U16") return "Female U16";
  return label;
}

function roundLifecycleAction(
  round: PublicLeagueRoundItem,
  t?: ReturnType<typeof useI18n>["t"],
) {
  if (round.status === "completed") {
    return t?.("league.hero.viewRoundResults", { round: round.roundNumber })
      ?? `View Round ${round.roundNumber} results`;
  }
  if (round.status === "in_progress") {
    return t?.("league.hero.followRound", { round: round.roundNumber })
      ?? `Follow Round ${round.roundNumber}`;
  }
  if (round.status === "registration_open") {
    return t?.("league.hero.registerRound", { round: round.roundNumber })
      ?? `Register for Round ${round.roundNumber}`;
  }
  return t?.("league.hero.viewRound", { round: round.roundNumber })
    ?? `View Round ${round.roundNumber}`;
}

function scoreBreakdown(scores: number[], bestN: number) {
  const ranked = scores
    .map((score, index) => ({ score: Number(score ?? 0), index }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const countedIndexes = new Set(ranked.slice(0, Math.max(1, bestN)).map((entry) => entry.index));
  return scores.map((score, index) => ({
    score: Number(score ?? 0),
    counted: Number(score ?? 0) > 0 && countedIndexes.has(index),
    dropped: Number(score ?? 0) > 0 && !countedIndexes.has(index),
  }));
}

function countingResultsLabel(
  league: PublicLeagueDetailReadModel,
  t?: ReturnType<typeof useI18n>["t"],
) {
  return league.rules.bestN > 0 && league.rules.bestN < league.rounds.length
    ? t?.("league.scoring.best", { count: league.rules.bestN }) ?? `Best ${league.rules.bestN}`
    : t?.("league.scoring.all", { count: league.rounds.length }) ?? `All ${league.rounds.length}`;
}

function RoundOutcomePill({ outcome }: { outcome: Exclude<LeagueRoundOutcome, "finished"> }) {
  const { t } = useI18n();
  const tone = outcome === "dns"
    ? "border-trail-amber/25 bg-trail-amber/10 text-trail-amber"
    : outcome === "dnf"
      ? "border-trail-red/25 bg-trail-red/10 text-trail-red"
      : "border-muted-foreground/25 bg-muted/50 text-muted-foreground";
  const label = outcome === "dns"
    ? t("league.results.dns")
    : outcome === "dnf"
      ? t("league.results.dnf")
      : t("league.results.dsq");
  return (
    <span data-i18n-skip className={`inline-flex min-h-9 min-w-10 items-center justify-center rounded-lg border px-1.5 font-mono text-[10px] font-black uppercase tracking-[0.08em] ${tone}`}>
      {label}
    </span>
  );
}

function MoveIndicator({ change }: { change: number }) {
  if (change > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-trail-green">
        <ArrowUp className="h-3.5 w-3.5" />
        {change}
      </span>
    );
  }
  if (change < 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-trail-red">
        <ArrowDown className="h-3.5 w-3.5" />
        {Math.abs(change)}
      </span>
    );
  }
  return <span className="text-xs font-semibold text-muted-foreground">—</span>;
}

export function LeagueSeasonHeader({
  league,
  heroImage,
  heroLogo,
  nextRound,
  view,
}: {
  league: PublicLeagueDetailReadModel;
  heroImage: string;
  heroLogo?: string | null;
  nextRound: PublicLeagueRoundItem | null;
  view: "overview" | "results" | "statistics" | "standard";
}) {
  const { locale, localeTag, t } = useI18n();
  const statusLabel = league.status === "completed"
    ? t("league.hero.seasonComplete")
    : league.status === "upcoming"
      ? t("league.hero.seasonUpcoming")
      : t("league.hero.seasonActive");
  const leagueName = localizedLeagueName(league.name, league.slug, locale);
  const seasonLabel = localizedLeagueSeasonLabel(
    league.rounds,
    localeTag,
    t("league.calendar.dateTba"),
  );

  return (
    <section
      data-league-view={view}
      className="relative min-h-[360px] overflow-hidden border-b border-border bg-trail-earth sm:min-h-[440px] md:min-h-[520px] lg:min-h-[680px]"
    >
      <div className="absolute inset-0">
        {heroImage.startsWith("/") ? (
          <Image
            src={heroImage}
            alt={t("league.hero.alt")}
            fill
            sizes="100vw"
            quality={75}
            loading="eager"
            fetchPriority="high"
            className="object-cover object-center"
          />
        ) : (
          <img
            src={heroImage}
            alt={t("league.hero.alt")}
            loading="eager"
            className="h-full w-full object-cover object-center"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/5 via-transparent to-black/70 dark:from-black/72 dark:via-black/16 dark:to-black/88" />
      </div>

      <div className="container relative z-10 flex min-h-[360px] flex-col px-4 pb-9 pt-6 sm:min-h-[440px] md:min-h-[520px] md:pb-12 md:pt-10 lg:min-h-[680px] lg:pb-14">
        <div className="inline-flex max-w-full items-center gap-2 self-start rounded-full border border-white/30 bg-white/10 px-3 py-1.5 text-[11px] text-white backdrop-blur-sm dark:border-white/25 dark:bg-black/45 md:px-4 md:py-2 md:text-xs">
          <Link to="/leagues" className="transition-colors hover:text-white">{t("common.leagues")}</Link>
          <ChevronRight className="h-3 w-3 text-primary" />
          <span className="truncate">{leagueName}</span>
        </div>

        {heroLogo ? (
          <img
            src={heroLogo}
            alt={t("league.hero.logoAlt", { name: leagueName })}
            className="pointer-events-none absolute left-1/2 top-[36%] w-[min(44vw,168px)] -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_12px_34px_rgba(0,0,0,0.28)] lg:top-[34%] lg:w-[min(32vw,390px)]"
          />
        ) : null}

        <div className="mt-auto min-w-0">
          <h1 className="mb-3 max-w-[34rem] font-display text-3xl font-black leading-[1.02] tracking-tight text-white drop-shadow-[0_4px_18px_rgba(0,0,0,0.38)] md:text-5xl lg:hidden">
            {leagueName}
          </h1>
          <div
            aria-label={t("league.hero.summary")}
            className="-mx-4 flex max-w-none flex-nowrap items-center gap-2 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:max-w-full md:flex-wrap md:gap-2.5 md:overflow-visible md:px-0 md:pb-0"
          >
            <span className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-white/30 bg-white/10 px-3 text-xs font-semibold text-white backdrop-blur-md dark:border-white/25 dark:bg-black/45">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              {statusLabel}
            </span>
            <span className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-white/30 bg-white/10 px-3 text-xs font-semibold text-white backdrop-blur-md dark:border-white/25 dark:bg-black/45">
              <Calendar className="h-3.5 w-3.5 text-primary" />
              {seasonLabel}
            </span>
            <span className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-white/30 bg-white/10 px-3 text-xs font-semibold text-white backdrop-blur-md dark:border-white/25 dark:bg-black/45">
              <Mountain className="h-3.5 w-3.5 text-primary" />
              {t("league.hero.rounds", { count: league.rounds.length })}
            </span>
            <span className="hidden h-9 shrink-0 items-center gap-2 rounded-full border border-white/30 bg-white/10 px-3 text-xs font-semibold text-white backdrop-blur-md dark:border-white/25 dark:bg-black/45 md:inline-flex">
              <Users className="h-3.5 w-3.5 text-primary" />
              {t("league.hero.registrationsAndClubs", {
                registrations: league.summary.totalRegistrations,
                clubs: league.clubCount,
              })}
            </span>
            <span className="hidden h-9 shrink-0 items-center gap-2 rounded-full border border-white/30 bg-white/10 px-3 text-xs font-semibold text-white backdrop-blur-md dark:border-white/25 dark:bg-black/45 md:inline-flex">
              <Flag className="h-3.5 w-3.5 text-primary" />
              {t("league.hero.resultsPublished", {
                published: league.summary.publishedRounds,
                total: league.rounds.length,
              })}
            </span>
            {nextRound && !nextRound.isPlaceholder ? (
              <Link
                to={roundRegistrationHref(nextRound)}
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-primary px-4 text-xs font-bold text-primary-foreground shadow-warm transition-colors hover:bg-primary/90"
              >
                {roundLifecycleAction(nextRound, t)}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : nextRound ? (
              <span className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-dashed border-white/35 bg-black/15 px-4 text-xs font-semibold text-white backdrop-blur-md">
                {t("league.hero.roundEventTba", { round: nextRound.roundNumber })}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <HeroMountainDivider />
    </section>
  );
}

export function LeagueSeasonTitle({ league }: { league: PublicLeagueDetailReadModel }) {
  const { locale, localeTag, t } = useI18n();
  const leagueName = localizedLeagueName(league.name, league.slug, locale);
  const accentSuffix = leagueName.endsWith("Trail League") ? "Trail League" : "Trail Liga";
  const hasAccentSuffix = leagueName.endsWith(accentSuffix);
  const leadingTitle = hasAccentSuffix
    ? leagueName.slice(0, -accentSuffix.length).trim()
    : leagueName;
  const localName = getSibenikTrailLeagueLocalName(leagueName, league.slug);
  const seasonLabel = localizedLeagueSeasonLabel(
    league.rounds,
    localeTag,
    t("league.calendar.dateTba"),
  );

  return (
    <section className="relative hidden overflow-hidden border-b border-border/70 bg-gradient-to-b from-primary/[0.08] via-background to-background lg:block">
      <div className="pointer-events-none absolute inset-0 route-pattern opacity-45" />
      <div className="container relative mx-auto px-4 py-8 md:py-11">
        <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.22em] text-primary md:text-xs">
          <span className="h-px w-10 bg-primary" aria-hidden="true" />
          <span>{localName ?? t("league.hero.championship")}</span>
          <span className="h-1 w-1 rounded-full bg-trail-amber" aria-hidden="true" />
          <span className="text-muted-foreground">{seasonLabel}</span>
        </div>
        <h1 className="mt-3 max-w-5xl font-display text-4xl font-extrabold leading-[1.02] tracking-tight text-foreground md:text-6xl lg:text-7xl">
          {leadingTitle}
          {hasAccentSuffix ? (
            <>
              {" "}
              <span className="text-primary">{accentSuffix}</span>
            </>
          ) : null}
        </h1>
      </div>
    </section>
  );
}

function LeaderColumn({
  label,
  tone,
  rows,
}: {
  label: string;
  tone: string;
  rows: Array<{ name: string; href: string; points: number }>;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className={`text-[10px] font-bold uppercase tracking-[0.18em] ${tone}`}>{label}</div>
      <div className="mt-3 space-y-2.5">
        {rows.length ? rows.slice(0, 3).map((row, index) => (
          <Link key={`${label}-${row.href}`} to={row.href} className="group flex items-center gap-2 text-sm">
            <span className="w-4 shrink-0 text-xs font-semibold text-muted-foreground">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate font-medium text-foreground transition-colors group-hover:text-primary">{row.name}</span>
            <span className="font-display text-sm font-bold text-foreground">{row.points}</span>
          </Link>
        )) : <div className="text-sm text-muted-foreground">Standings pending</div>}
      </div>
      <Link to="?tab=results" className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
        Full standings <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

function LegacyLeagueOverviewExperience({
  league,
  nextRound,
  roundImage,
  womenLeaders,
  menLeaders,
}: {
  league: PublicLeagueDetailReadModel;
  nextRound: PublicLeagueRoundItem | null;
  roundImage: string;
  womenLeaders: PublicLeagueStandingItem[];
  menLeaders: PublicLeagueStandingItem[];
}) {
  const { t } = useI18n();
  const [competition, setCompetition] = useState<LeagueCompetition>("long");
  const leadingAthlete = menLeaders[0] ?? womenLeaders[0] ?? league.individualStandings[0] ?? null;
  const leadingScores = Array.from(
    { length: league.rounds.length },
    (_, index) => leadingAthlete?.roundScores[index] ?? 0,
  );
  const breakdown = scoreBreakdown(leadingScores, league.rules.bestN);
  const completedRoundCount = league.rounds.filter((round) => round.status === "completed").length;

  return (
    <div className="space-y-7">
      <section>
        <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">Choose competition</div>
        <div className="mt-3 flex flex-wrap gap-3">
          {competitionOptions.map((option) => {
            const Icon = option.icon;
            const active = competition === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setCompetition(option.value)}
                aria-pressed={active}
                className={`inline-flex min-h-12 items-center gap-3 rounded-xl border px-5 text-sm font-semibold transition-colors ${
                  active
                    ? "border-primary bg-primary/[0.055] text-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.08)]"
                    : "border-border bg-card text-foreground hover:border-primary/30 hover:bg-primary/[0.025]"
                }`}
              >
                <Icon className="h-5 w-5" />
                {option.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="border-y border-border/75 py-5">
        <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
          {league.seasonLabel} · {league.rounds.length} rounds
        </div>
        <div className="overflow-x-auto pb-2">
          <div className="relative grid min-w-[960px]" style={{ gridTemplateColumns: `repeat(${Math.max(league.rounds.length, 1)}, minmax(108px, 1fr))` }}>
            <div className="absolute left-[4%] right-[4%] top-4 h-px bg-border" />
            {league.rounds.map((round) => {
              const completed = round.status === "completed";
              const current = nextRound?.roundId === round.roundId;
              return (
                <Link key={round.roundId} to={roundRegistrationHref(round)} className="group relative flex flex-col items-center px-2 text-center">
                  <span className={`relative z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border text-sm font-bold transition-colors ${
                    completed
                      ? "border-trail-green bg-trail-green text-trail-green-foreground"
                      : current
                        ? "border-2 border-primary bg-card text-primary ring-4 ring-background"
                        : "border-border bg-card text-muted-foreground"
                  }`}>
                    {completed ? <Check className="h-4 w-4" /> : round.roundNumber}
                  </span>
                  <span className="mt-3 text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Round {round.roundNumber}</span>
                  <span className={`mt-2 text-xs font-semibold ${current ? "text-primary" : "text-foreground group-hover:text-primary"}`}>{formatRoundDate(round)}</span>
                  <span className={`mt-1 max-w-[112px] text-xs leading-4 ${current ? "font-semibold text-primary" : "text-foreground"}`}>{shortRoundName(round, t("league.calendar.eventTba"))}</span>
                  <span className={`mt-2 text-[9px] font-bold uppercase tracking-[0.14em] ${
                    completed ? "text-trail-green" : current ? "text-trail-blue" : "text-muted-foreground"
                  }`}>
                    {roundLifecycleLabel(round, t)}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid border-b border-border/75 pb-7 xl:grid-cols-[minmax(0,1.03fr)_minmax(0,0.97fr)]">
        <div className="border-border/75 pr-0 xl:border-r xl:pr-8">
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">Next round</div>
          {nextRound ? (
            <div className="mt-4 grid gap-6 md:grid-cols-[minmax(0,1fr)_238px] md:items-center">
              <div>
                <h2 className="font-display text-2xl font-black tracking-tight md:text-3xl">
                  Round {nextRound.roundNumber} · {nextRound.name}
                </h2>
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-2"><Calendar className="h-4 w-4" />{formatRoundDate(nextRound, "long")}</span>
                  <span className="inline-flex items-center gap-2"><MapPin className="h-4 w-4" />{nextRound.location}</span>
                  <span className="inline-flex items-center gap-2"><Mountain className="h-4 w-4" />{nextRound.categoryName} · {nextRound.elevation}</span>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-2 rounded-full bg-trail-blue/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-trail-blue">
                    <span className="h-2 w-2 rounded-full bg-trail-blue" /> {roundLifecycleLabel(nextRound, t)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {nextRound.status === "registration_open" ? "Register on the race page" : "Open the race page for details"}
                  </span>
                </div>
                <Link to={roundRegistrationHref(nextRound)} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-warm">
                  {roundLifecycleAction(nextRound, t)} <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
              <img src={roundImage} alt={nextRound.name} className="h-44 w-full rounded-[20px] border border-border object-cover shadow-soft" />
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">Season schedule complete.</div>
          )}
        </div>

        <div className="mt-7 xl:mt-0 xl:pl-8">
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
            Current leaders · after Round {completedRoundCount}
          </div>
          <div className="mt-5 flex flex-col gap-7 md:flex-row md:divide-x md:divide-border">
            <LeaderColumn
              label="Female"
              tone="text-trail-green"
              rows={womenLeaders.map((row) => ({ name: row.name, points: row.points, href: `/athletes/${row.athleteSlug}` }))}
            />
            <div className="hidden md:block" />
            <LeaderColumn
              label="Male"
              tone="text-trail-blue"
              rows={menLeaders.map((row) => ({ name: row.name, points: row.points, href: `/athletes/${row.athleteSlug}` }))}
            />
            <div className="hidden md:block" />
            <LeaderColumn
              label="Clubs"
              tone="text-trail-amber"
              rows={league.clubStandings.map((row) => ({ name: row.name, points: row.points, href: `/clubs/${row.clubSlug}` }))}
            />
          </div>
        </div>
      </section>

      <section className="rounded-[24px] border border-primary/15 bg-primary/[0.025] px-5 py-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(260px,0.78fr)_minmax(0,1.22fr)_auto] lg:items-center">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-card text-primary">
              <Trophy className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">How scoring works</div>
              <div className="mt-1 font-display text-lg font-bold">{countingResultsLabel(league)} results count</div>
              <p className="mt-1 text-xs text-muted-foreground">Lower scores are automatically dropped as the season develops.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {breakdown.length ? breakdown.map((entry, index) => (
              <span key={`${entry.score}-${index}`} className={`inline-flex min-w-14 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 font-display text-sm font-bold ${
                entry.counted
                  ? "border-trail-green/40 bg-trail-green/[0.07] text-trail-green"
                  : entry.dropped
                    ? "border-dashed border-muted-foreground/35 bg-card text-muted-foreground line-through"
                    : "border-border bg-card text-muted-foreground"
              }`}>
                {entry.counted ? <Check className="h-3.5 w-3.5" /> : entry.dropped ? <X className="h-3.5 w-3.5" /> : null}
                {entry.score || "—"}
              </span>
            )) : <span className="text-sm text-muted-foreground">Points appear after the first official round.</span>}
          </div>
          <Link to="?tab=rules" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
            See full rules <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}

export function LeagueOverviewExperience({
  league,
  nextRound,
}: {
  league: PublicLeagueDetailReadModel;
  nextRound: PublicLeagueRoundItem | null;
  roundImage?: string;
}) {
  return (
    <LeagueOverviewCalendar
      league={league}
      nextRound={nextRound}
    />
  );
}

function StandingAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[14px] border border-border/70 bg-gradient-to-br from-primary/15 to-trail-amber/10 font-display text-xs font-bold text-primary shadow-sm">
      {avatarUrl ? (
        <img src={avatarUrl} alt={t("league.results.profilePicture", { name })} className="h-full w-full object-cover" />
      ) : initials(name)}
    </span>
  );
}

function standingClubLabel(standing: Pick<PublicLeagueStandingItem, "club" | "clubSlug">) {
  return standing.clubSlug ? standing.club : "—";
}

function IndividualStandingsTable({
  league,
  rows,
}: {
  league: PublicLeagueDetailReadModel;
  rows: PublicLeagueStandingItem[];
}) {
  const { locale, t } = useI18n();
  const [sortKey, setSortKey] = useState("rank");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const sortedRows = useMemo(() => [...rows].sort((left, right) => {
    const value = (row: PublicLeagueStandingItem) => {
      if (sortKey === "rank") return row.eligible === false ? Number.MAX_SAFE_INTEGER : row.rank;
      if (sortKey === "athlete") return row.name;
      if (sortKey === "club") return standingClubLabel(row);
      if (sortKey === "category") return standingLeagueCategories(row).join("-");
      if (sortKey === "races") return row.races;
      if (sortKey === "points") return row.points;
      if (sortKey.startsWith("round-")) return row.roundScores[Number(sortKey.slice(6))] ?? 0;
      return row.rank;
    };
    const leftValue = value(left);
    const rightValue = value(right);
    const comparison = typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true });
    return sortDirection === "asc" ? comparison : -comparison;
  }), [rows, sortDirection, sortKey]);
  const { visibleCount, canLoadMore, loadMore, sentinelRef } = useProgressiveList({
    totalCount: sortedRows.length,
    resetKey: `${sortKey}:${sortDirection}:${rows.map((row) => row.athleteId ?? row.athleteSlug).join(",")}`,
  });
  const sortHeader = (label: string, key: string) => (
    <button type="button" onClick={() => {
      if (sortKey === key) setSortDirection((current) => current === "asc" ? "desc" : "asc");
      else {
        setSortKey(key);
        setSortDirection("asc");
      }
    }} className="inline-flex items-center gap-1 text-left hover:text-primary" aria-label={t("league.results.sortStandings", { label })}>
      {label}
      {sortKey === key ? (sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ChevronDown className="h-3 w-3 opacity-30" />}
    </button>
  );

  if (!rows.length) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
        <Trophy className="h-8 w-8 text-muted-foreground/50" />
        <h3 className="mt-4 font-display text-lg font-bold">{t("league.results.noClassification")}</h3>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{t("league.results.noClassificationDescription")}</p>
      </div>
    );
  }

  return (
    <>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-background/50 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
            <th className="w-14 px-3 py-4">{sortHeader(t("league.results.rank"), "rank")}</th>
            <th className="min-w-[170px] px-3 py-4">{sortHeader(t("league.results.athlete"), "athlete")}</th>
            <th className="min-w-[130px] px-3 py-4">{sortHeader(t("league.results.club"), "club")}</th>
            <th className="min-w-[110px] px-3 py-4">{sortHeader(t("league.results.category"), "category")}</th>
            <th className="w-20 px-3 py-4 text-right">{sortHeader(t("league.results.rounds"), "races")}</th>
            <th className="w-20 px-3 py-4 text-right">{sortHeader(t("league.results.points"), "points")}</th>
            {league.rounds.map((round, roundIndex) => (
              <th key={round.roundId} className="min-w-[58px] px-1 py-4 text-center normal-case tracking-normal">
                {sortHeader(`R${round.roundNumber}`, `round-${roundIndex}`)}
                <span className="mt-1 block max-w-[58px] truncate text-[8px] font-medium text-muted-foreground">{shortRoundName(round, t("league.calendar.eventTba"))}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.slice(0, visibleCount).map((standing) => {
            const breakdown = scoreBreakdown(standing.roundScores, league.rules.bestN);
            const podiumVisual = standing.eligible === false ? null : getResultPodiumVisual(standing.rank);
            return (
              <tr
                key={standing.athleteId ?? `${standing.athleteSlug}:${standing.name}`}
                className={cn(
                  "border-b border-border/70 transition-colors hover:bg-primary/[0.018]",
                  podiumVisual?.rowClassName,
                )}
              >
                  <td className="px-3 py-4 align-middle">
                    <div className="flex items-center gap-2">
                      {standing.eligible === false ? (
                        <span className="inline-flex h-8 min-w-8 items-center justify-center text-sm font-black text-muted-foreground">—</span>
                      ) : (
                        <ResultPlaceBadge place={standing.rank} compact />
                      )}
                      {standing.eligible === false ? null : <MoveIndicator change={standing.change} />}
                    </div>
                  </td>
                  <td className="px-3 py-4 align-middle">
                    <div className="flex items-center gap-3">
                      <StandingAvatar name={standing.name} avatarUrl={standing.avatarUrl} />
                      <div className="min-w-0">
                        <Link to={`/athletes/${standing.athleteSlug}`} className="font-display text-sm font-bold text-foreground hover:text-primary">{standing.name}</Link>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-4 text-xs text-muted-foreground">
                    {standing.clubSlug ? <Link to={`/clubs/${standing.clubSlug}`} className="truncate hover:text-primary">{standing.club}</Link> : "—"}
                  </td>
                  <td className="px-3 py-4 text-xs text-muted-foreground">
                    {standingLeagueCategories(standing).map((label) => localizedLeagueDataLabel(label, locale)).join(" · ")}
                  </td>
                  <td className="px-3 py-4 text-right font-display font-bold">{standing.races}</td>
                  <td className="px-3 py-4 text-right align-middle">
                    <div className="font-display text-xl font-black text-trail-green">{standing.points}</div>
                    <div className="mt-1 text-[10px] text-muted-foreground">{countingResultsLabel(league, t)}</div>
                  </td>
                  {league.rounds.map((round, index) => {
                    const entry = breakdown[index] ?? { score: 0, counted: false, dropped: false };
                    const outcome = standing.roundStatuses?.[index];
                    return (
                      <td key={`${standing.athleteSlug}-${round.roundId}`} className="px-1 py-4 text-center align-middle">
                        {outcome && outcome !== "finished" ? (
                          <RoundOutcomePill outcome={outcome} />
                        ) : <span className={`inline-flex min-h-9 min-w-10 items-center justify-center rounded-lg border px-1.5 font-mono text-xs font-semibold ${
                          entry.counted
                            ? "border-transparent bg-trail-green/10 text-trail-green"
                            : entry.dropped
                              ? "border-dashed border-muted-foreground/35 bg-card text-muted-foreground line-through"
                              : "border-transparent text-muted-foreground"
                        }`}>
                          {entry.score || "—"}
                        </span>}
                      </td>
                    );
                  })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-5 border-t border-border bg-background/45 px-5 py-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2"><span className="h-5 w-5 rounded-md bg-trail-green/10" /> {t("league.results.counted")}</span>
        <span className="inline-flex items-center gap-2"><span className="h-5 w-5 rounded-md border border-dashed border-muted-foreground/40" /> {t("league.results.dropped")}</span>
        <span data-i18n-skip className="font-mono font-black text-trail-amber">DNS</span>
        <span data-i18n-skip className="font-mono font-black text-trail-red">DNF</span>
        <span>— {t("league.results.notRun")}</span>
      </div>
    </div>
    {sortedRows.length > 20 ? (
      <ProgressiveListControls
        visibleCount={visibleCount}
        totalCount={sortedRows.length}
        canLoadMore={canLoadMore}
        itemLabel={t("athletes.itemsGenitive")}
        onLoadMore={loadMore}
        sentinelRef={sentinelRef}
        className="mb-6"
      />
    ) : null}
    </>
  );
}

function performanceDateLabel(
  dateIso: string | null | undefined,
  fallback: string | null | undefined,
  locale: string,
) {
  if (!dateIso) return fallback || "—";
  const date = new Date(`${dateIso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return fallback || "—";
  return date.toLocaleDateString(locale === "hr" ? "hr-HR" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function BestTimeStandingsTable({
  competitionName,
  rows,
}: {
  competitionName: string;
  rows: PublicLeagueStandingItem[];
}) {
  const { locale, t } = useI18n();
  const [openAthlete, setOpenAthlete] = useState<string | null>(null);
  const mobileDetailsId = useId();

  if (!rows.length) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
        <Trophy className="h-8 w-8 text-muted-foreground/50" />
        <h3 className="mt-4 font-display text-lg font-bold">{t("league.results.noClassification")}</h3>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{t("league.results.noClassificationDescription")}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="border-b border-border bg-background/45 px-5 py-5">
        <h3 className="font-display text-xl font-black">
          {t("league.rules.bestTime")} · {localizedLeagueDataLabel(competitionName, locale)}
        </h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          {t("league.rules.bestTimeDescription")}
        </p>
      </div>
      <div data-mobile-best-time-standings className="space-y-3 p-3 sm:hidden">
        {rows.map((standing, index) => {
          const athleteKey = standing.athleteId ?? `${standing.athleteSlug}:${standing.name}`;
          const performances = standing.performances ?? [];
          const otherPerformances = performances.filter((performance) => !(
            performance.roundNumber === standing.bestRoundNumber
            && performance.finishTimeMs === standing.bestTimeMs
          ));
          const canExpand = otherPerformances.length > 0;
          const isOpen = canExpand && openAthlete === athleteKey;
          const detailsId = `${mobileDetailsId}-${index}`;
          const athleteLabelId = `${detailsId}-athlete`;
          const categories = standingLeagueCategories(standing)
            .map((label) => localizedLeagueDataLabel(label, locale))
            .join(" · ");

          return (
            <article
              key={athleteKey}
              aria-labelledby={athleteLabelId}
              className="rounded-2xl border border-border bg-background/55 p-3 shadow-sm [contain-intrinsic-size:0_10rem] [content-visibility:auto]"
            >
              <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-2.5">
                <div className="flex justify-center">
                  <ResultPlaceBadge place={standing.rank} compact />
                </div>
                <div className="flex min-w-0 items-center gap-2.5">
                  <StandingAvatar name={standing.name} avatarUrl={standing.avatarUrl} />
                  <div className="min-w-0">
                    <h4 id={athleteLabelId} className="truncate font-display text-sm font-black text-foreground">
                      <Link to={`/athletes/${standing.athleteSlug}`} className="hover:text-primary">
                        {standing.name}
                      </Link>
                    </h4>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-[10px] text-muted-foreground">
                      {standing.clubSlug ? (
                        <Link to={`/clubs/${standing.clubSlug}`} className="truncate hover:text-primary">{standing.club}</Link>
                      ) : <span>—</span>}
                      <span aria-hidden="true">·</span>
                      <span className="shrink-0">{standing.gender}</span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">{categories}</span>
                    </div>
                  </div>
                </div>
                <div className="min-w-[4.5rem] text-right">
                  <div className="text-[8px] font-bold uppercase tracking-[0.13em] text-muted-foreground">
                    {t("league.rules.bestTime")}
                  </div>
                  <div className="mt-1 whitespace-nowrap font-mono text-base font-black tabular-nums text-trail-green">
                    {standing.bestTime ?? "—"}
                  </div>
                </div>
              </div>

              <dl className="mt-3 grid grid-cols-[0.75fr_1.35fr_0.7fr] divide-x divide-border overflow-hidden rounded-xl border border-border bg-card/70">
                <div className="min-w-0 px-2.5 py-2">
                  <dt className="text-[8px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{t("league.results.round")}</dt>
                  <dd className="mt-1 font-display text-xs font-black text-foreground">R{standing.bestRoundNumber ?? "—"}</dd>
                </div>
                <div className="min-w-0 px-2.5 py-2">
                  <dt className="text-[8px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{t("common.date")}</dt>
                  <dd className="mt-1 truncate text-[10px] font-semibold text-foreground">
                    {performanceDateLabel(standing.bestDateIso, standing.bestDate, locale)}
                  </dd>
                </div>
                <div className="min-w-0 px-2.5 py-2 text-right">
                  <dt className="text-[8px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{t("league.table.races")}</dt>
                  <dd className="mt-1 font-display text-xs font-black tabular-nums text-foreground">{standing.races}</dd>
                </div>
              </dl>

              <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                {standing.bestRoundLabel ?? "—"}
              </p>

              {canExpand ? (
                <>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={detailsId}
                    onClick={() => setOpenAthlete(isOpen ? null : athleteKey)}
                    className="mt-2 flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-2 text-left text-xs font-bold text-primary outline-none hover:bg-primary/[0.05] focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span className="inline-flex items-center gap-2">
                      <ChevronRight className={cn("h-4 w-4 transition-transform", isOpen && "rotate-90")} aria-hidden="true" />
                      {t("league.rules.everyOfficialFinish")}
                    </span>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px]">{performances.length}</span>
                  </button>
                  {isOpen ? (
                    <div id={detailsId} className="mt-2 space-y-1.5 border-t border-border pt-2">
                      {performances.map((performance) => (
                        <div key={`${athleteKey}:${performance.roundId}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-xl bg-card/75 px-3 py-2 text-xs">
                          <div className="min-w-0">
                            <div className="truncate font-display font-bold text-foreground">R{performance.roundNumber} · {performance.stageLabel}</div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              {performanceDateLabel(performance.dateIso, performance.date, locale)}
                            </div>
                          </div>
                          <div className="self-center whitespace-nowrap font-mono font-black tabular-nums text-foreground">{performance.time}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
            </article>
          );
        })}
      </div>
      <div data-desktop-best-time-standings className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[980px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-background/50 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
              <th className="w-16 px-3 py-4">{t("league.results.rank")}</th>
              <th className="min-w-[180px] px-3 py-4">{t("league.results.athlete")}</th>
              <th className="min-w-[130px] px-3 py-4">{t("league.results.club")}</th>
              <th className="w-16 px-3 py-4">{t("common.gender")}</th>
              <th className="min-w-[120px] px-3 py-4">{t("league.results.category")}</th>
              <th className="min-w-[150px] px-3 py-4">{t("league.results.round")}</th>
              <th className="min-w-[105px] px-3 py-4">{t("common.date")}</th>
              <th className="w-20 px-3 py-4 text-right">{t("league.table.races")}</th>
              <th className="w-28 px-3 py-4 text-right">{t("league.rules.bestTime")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((standing) => {
              const athleteKey = standing.athleteId ?? `${standing.athleteSlug}:${standing.name}`;
              const performances = standing.performances ?? [];
              const otherPerformances = performances.filter((performance) => !(
                performance.roundNumber === standing.bestRoundNumber
                && performance.finishTimeMs === standing.bestTimeMs
              ));
              const canExpand = otherPerformances.length > 0;
              const isOpen = canExpand && openAthlete === athleteKey;
              const podiumVisual = getResultPodiumVisual(standing.rank);

              return (
                <Fragment key={athleteKey}>
                  <tr
                    className={cn(
                      "border-b border-border/70 transition-colors hover:bg-primary/[0.025] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
                      canExpand && "cursor-pointer",
                      podiumVisual?.rowClassName,
                      isOpen && "bg-primary/[0.025]",
                    )}
                    onClick={() => {
                      if (canExpand) setOpenAthlete(isOpen ? null : athleteKey);
                    }}
                    onKeyDown={(event) => {
                      if (!canExpand || event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setOpenAthlete(isOpen ? null : athleteKey);
                      }
                    }}
                    tabIndex={canExpand ? 0 : undefined}
                    aria-expanded={canExpand ? isOpen : undefined}
                  >
                    <td className="px-3 py-4">
                      <div className="flex items-center gap-2">
                        {canExpand ? <ChevronRight className={cn("h-4 w-4 text-primary transition-transform", isOpen && "rotate-90")} /> : null}
                        <ResultPlaceBadge place={standing.rank} compact />
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex items-center gap-3">
                        <StandingAvatar name={standing.name} avatarUrl={standing.avatarUrl} />
                        <Link
                          to={`/athletes/${standing.athleteSlug}`}
                          onClick={(event) => event.stopPropagation()}
                          className="font-display text-sm font-bold text-foreground hover:text-primary"
                        >
                          {standing.name}
                        </Link>
                      </div>
                    </td>
                    <td className="px-3 py-4 text-xs text-muted-foreground">
                      {standing.clubSlug ? (
                        <Link
                          to={`/clubs/${standing.clubSlug}`}
                          onClick={(event) => event.stopPropagation()}
                          className="hover:text-primary"
                        >
                          {standing.club}
                        </Link>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-4 font-semibold">{standing.gender}</td>
                    <td className="px-3 py-4 text-xs text-muted-foreground">
                      {standingLeagueCategories(standing).map((label) => localizedLeagueDataLabel(label, locale)).join(" · ")}
                    </td>
                    <td className="px-3 py-4">
                      <div className="font-display font-bold">R{standing.bestRoundNumber ?? "—"}</div>
                      <div className="mt-1 max-w-[180px] truncate text-[10px] text-muted-foreground">{standing.bestRoundLabel ?? "—"}</div>
                    </td>
                    <td className="px-3 py-4 text-xs text-muted-foreground">
                      {performanceDateLabel(standing.bestDateIso, standing.bestDate, locale)}
                    </td>
                    <td className="px-3 py-4 text-right font-display font-bold tabular-nums">{standing.races}</td>
                    <td className="px-3 py-4 text-right font-mono text-lg font-black tabular-nums text-trail-green">{standing.bestTime ?? "—"}</td>
                  </tr>
                  {isOpen ? (
                    <tr className="border-b border-border bg-background/70">
                      <td colSpan={9} className="p-0">
                        <div className="border-l-4 border-primary/40 bg-primary/[0.018] px-5 py-5">
                          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                            {t("league.rules.everyOfficialFinish")}
                          </div>
                          <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-border bg-background/70 text-left text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                  <th className="px-4 py-3">{t("league.results.round")}</th>
                                  <th className="px-4 py-3">{t("common.date")}</th>
                                  <th className="px-4 py-3 text-right">{t("common.time")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {otherPerformances.map((performance) => (
                                  <tr key={`${athleteKey}:${performance.roundId}`} className="border-b border-border/60 last:border-0">
                                    <td className="px-4 py-3">
                                      <span className="font-display font-bold">R{performance.roundNumber}</span>
                                      <span className="ml-2 text-muted-foreground">{performance.stageLabel}</span>
                                    </td>
                                    <td className="px-4 py-3 text-muted-foreground">
                                      {performanceDateLabel(performance.dateIso, performance.date, locale)}
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono font-bold tabular-nums">{performance.time}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ParticipationStandingsTable({
  competitionName,
  rows,
}: {
  competitionName: string;
  rows: PublicLeagueStandingItem[];
}) {
  const { locale, t } = useI18n();

  if (!rows.length) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
        <Users className="h-8 w-8 text-muted-foreground/50" />
        <h3 className="mt-4 font-display text-lg font-bold">{t("league.results.noClassification")}</h3>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{t("league.results.noClassificationDescription")}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="border-b border-border bg-background/45 px-5 py-5">
        <h3 className="font-display text-xl font-black">
          {t("league.rules.participation")} · {localizedLeagueDataLabel(competitionName, locale)}
        </h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          {t("league.rules.participationDescription")}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-background/50 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
              <th className="w-16 px-3 py-4">{t("league.results.rank")}</th>
              <th className="min-w-[190px] px-3 py-4">{t("league.results.athlete")}</th>
              <th className="min-w-[140px] px-3 py-4">{t("league.results.club")}</th>
              <th className="min-w-[130px] px-3 py-4">{t("league.results.category")}</th>
              <th className="w-36 px-3 py-4 text-right">{t("league.rules.completedRaces")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((standing) => (
              <tr key={standing.athleteId ?? `${standing.athleteSlug}:${standing.name}`} className="border-b border-border/70 hover:bg-primary/[0.018]">
                <td className="px-3 py-4"><ResultPlaceBadge place={standing.rank} compact /></td>
                <td className="px-3 py-4">
                  <div className="flex items-center gap-3">
                    <StandingAvatar name={standing.name} avatarUrl={standing.avatarUrl} />
                    <Link to={`/athletes/${standing.athleteSlug}`} className="font-display text-sm font-bold text-foreground hover:text-primary">{standing.name}</Link>
                  </div>
                </td>
                <td className="px-3 py-4 text-xs text-muted-foreground">
                  {standing.clubSlug ? <Link to={`/clubs/${standing.clubSlug}`} className="hover:text-primary">{standing.club}</Link> : "—"}
                </td>
                <td className="px-3 py-4 text-xs text-muted-foreground">
                  {standingLeagueCategories(standing).map((label) => localizedLeagueDataLabel(label, locale)).join(" · ")}
                </td>
                <td className="px-3 py-4 text-right font-display text-lg font-black tabular-nums text-trail-green">{standing.races}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NoSeasonStandings() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
      <Flag className="h-8 w-8 text-muted-foreground/50" />
      <h3 className="mt-4 font-display text-lg font-bold">{t("league.rules.noStandings")}</h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{t("league.results.noClassificationDescription")}</p>
    </div>
  );
}

type ClubSortKey = "rank" | "club" | "members" | "wins" | "podiums" | "points" | `round-${number}`;

function ClubStandingsTable({
  league,
  rows,
  scoringNote,
  scorerCount,
}: {
  league: PublicLeagueDetailReadModel;
  rows: PublicLeagueClubStandingItem[];
  scoringNote: string;
  scorerCount: number;
}) {
  const { t } = useI18n();
  const [openClub, setOpenClub] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<ClubSortKey>("rank");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const sortedRows = useMemo(() => [...rows].sort((left, right) => {
    const value = (row: PublicLeagueClubStandingItem) => {
      if (sortKey === "rank") return row.rank;
      if (sortKey === "club") return row.name;
      if (sortKey === "members") return row.members;
      if (sortKey === "wins") return row.wins;
      if (sortKey === "podiums") return row.podiums;
      if (sortKey.startsWith("round-")) return row.roundPoints[Number(sortKey.slice(6))] ?? 0;
      return row.points;
    };
    const leftValue = value(left);
    const rightValue = value(right);
    const comparison = typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true });
    return sortDirection === "asc" ? comparison : -comparison;
  }), [rows, sortDirection, sortKey]);
  const header = (label: string, key: ClubSortKey) => (
    <button type="button" onClick={() => {
      if (sortKey === key) setSortDirection((current) => current === "asc" ? "desc" : "asc");
      else {
        setSortKey(key);
        setSortDirection(key === "club" || key === "rank" ? "asc" : "desc");
      }
    }} className="inline-flex items-center gap-1 hover:text-primary" aria-label={t("league.results.sortClubs", { label })}>
      {label}
      {sortKey === key ? (sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ChevronDown className="h-3 w-3 opacity-30" />}
    </button>
  );

  if (!rows.length) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
        <Users className="h-8 w-8 text-muted-foreground/50" />
        <h3 className="mt-4 font-display text-lg font-bold">{t("league.results.noClubs")}</h3>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{t("league.results.noClubsDescription")}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-background/50 text-left text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            <th className="w-20 px-4 py-4">{header(t("league.results.rank"), "rank")}</th>
            <th className="min-w-[190px] px-4 py-4">{header(t("league.results.club"), "club")}</th>
            <th className="w-24 px-3 py-4 text-right">{header(t("league.results.athletes"), "members")}</th>
            <th className="w-20 px-3 py-4 text-right">{header(t("league.results.wins"), "wins")}</th>
            <th className="w-24 px-3 py-4 text-right">{header(t("league.results.podiums"), "podiums")}</th>
            <th className="w-24 px-3 py-4 text-right">{header(t("league.results.points"), "points")}</th>
            {league.rounds.map((round, roundIndex) => (
              <th key={round.roundId} className="min-w-[70px] px-2 py-4 text-center normal-case tracking-normal">
                {header(`R${round.roundNumber}`, `round-${roundIndex}`)}
                <span className="mt-1 block max-w-[70px] truncate text-[8px] font-medium text-muted-foreground">{shortRoundName(round, t("league.calendar.eventTba"))}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((club) => {
            const isOpen = openClub === club.clubSlug;
            const memberRows = club.memberRows ?? [];
            const countedRoundTotals = league.rounds.map((_, roundIndex) => memberRows.reduce(
              (sum, member) => sum + (member.countedRounds?.[roundIndex]
                ? Number(member.roundScores?.[roundIndex] ?? 0)
                : 0),
              0,
            ));
            const countedSeasonTotal = countedRoundTotals.reduce((sum, points) => sum + points, 0);
            const podiumVisual = getResultPodiumVisual(club.rank);
            return (
              <Fragment key={club.clubSlug}>
                <tr
                  className={cn(
                    "cursor-pointer border-b border-border/70 transition-colors hover:bg-primary/[0.025] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
                    podiumVisual?.rowClassName,
                    isOpen && "bg-primary/[0.025]",
                  )}
                  onClick={() => setOpenClub(isOpen ? null : club.clubSlug)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setOpenClub(isOpen ? null : club.clubSlug);
                    }
                  }}
                  tabIndex={0}
                  aria-expanded={isOpen}
                >
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2">
                      <ChevronRight className={`h-4 w-4 text-primary transition-transform ${isOpen ? "rotate-90" : ""}`} />
                      <ResultPlaceBadge place={club.rank} compact />
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <Link
                      to={`/clubs/${club.clubSlug}`}
                      onClick={(event) => event.stopPropagation()}
                      className="font-display font-bold text-foreground hover:text-primary"
                    >
                      {club.name}
                    </Link>
                    <div className="mt-1 text-[10px] text-muted-foreground">{t("league.results.openMembers")}</div>
                  </td>
                  <td className="px-3 py-4 text-right font-display font-bold tabular-nums">{club.members}</td>
                  <td className="px-3 py-4 text-right font-display font-bold tabular-nums">{club.wins}</td>
                  <td className="px-3 py-4 text-right font-display font-bold tabular-nums">{club.podiums}</td>
                  <td className="px-3 py-4 text-right font-display text-xl font-black text-trail-green tabular-nums">{club.points}</td>
                  {league.rounds.map((round, roundIndex) => {
                    const roundPoints = club.roundPoints?.[roundIndex] ?? 0;
                    return (
                      <td key={`${club.clubSlug}-${round.roundId}`} className="px-2 py-4 text-center">
                        <span className={`inline-flex min-h-9 min-w-11 items-center justify-center rounded-lg px-2 font-mono text-xs font-semibold tabular-nums ${
                          roundPoints > 0 ? "bg-trail-green/10 text-trail-green" : "text-muted-foreground"
                        }`}>
                          {roundPoints || "—"}
                        </span>
                      </td>
                    );
                  })}
                </tr>
                {isOpen ? (
                  <tr className="border-b border-border bg-background/70">
                    <td colSpan={league.rounds.length + 6} className="p-0">
                      <div className="border-l-4 border-primary/40 bg-primary/[0.018] px-5 py-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">{t("league.results.contributors", { club: club.name })}</div>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("league.results.contributorDescription", { count: scorerCount })}</p>
                          </div>
                          <span className="timing-lime-pill rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em]">{t("league.results.bestPerRound", { count: scorerCount })}</span>
                        </div>
                        <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card">
                          <table className="w-full min-w-[760px] border-collapse text-xs">
                            <thead>
                              <tr className="border-b border-border bg-background/70 text-left text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                <th className="min-w-[190px] px-4 py-3">{t("league.results.athlete")}</th>
                                <th className="w-16 px-2 py-3 text-right">{t("league.results.wins")}</th>
                                <th className="w-20 px-2 py-3 text-right">{t("league.results.podiums")}</th>
                                <th className="w-24 px-2 py-3 text-right">{t("league.results.clubPoints")}</th>
                                {league.rounds.map((round) => <th key={`${club.clubSlug}-member-${round.roundId}`} className="min-w-[74px] px-2 py-3 text-center">R{round.roundNumber}</th>)}
                              </tr>
                            </thead>
                            <tbody>
                              {memberRows.length ? memberRows.map((member) => {
                                const isCountedContributor = member.countedRounds?.some(Boolean) ?? false;
                                return (
                                <tr key={`${club.clubSlug}-${member.athleteSlug ?? member.name}`} className={`border-b border-border/60 ${isCountedContributor ? "bg-trail-green/[0.045]" : ""}`}>
                                  <td className="px-4 py-3">
                                    <div className="flex items-center gap-2.5">
                                      <StandingAvatar name={member.name} avatarUrl={member.avatarUrl} />
                                      <div className="min-w-0">
                                        {member.athleteSlug ? (
                                          <Link to={`/athletes/${member.athleteSlug}`} className="font-semibold text-foreground hover:text-primary">{member.name}</Link>
                                        ) : <span className="font-semibold text-foreground">{member.name}</span>}
                                        {isCountedContributor ? <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-trail-green">{t("league.results.topContributor")}</div> : null}
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-2 py-3 text-right font-semibold tabular-nums">{member.wins}</td>
                                  <td className="px-2 py-3 text-right font-semibold tabular-nums">{member.podiums}</td>
                                  <td className="px-2 py-3 text-right">
                                    <div className="font-display text-sm font-black text-trail-green tabular-nums">{member.countedPoints}</div>
                                    {member.points !== member.countedPoints ? <div className="mt-0.5 text-[9px] text-muted-foreground">{t("league.results.earned", { points: member.points })}</div> : null}
                                  </td>
                                  {league.rounds.map((round, roundIndex) => {
                                    const score = member.roundScores?.[roundIndex] ?? 0;
                                    const place = member.roundPlaces?.[roundIndex] ?? 0;
                                    const counted = member.countedRounds?.[roundIndex] ?? false;
                                    const outcome = member.roundStatuses?.[roundIndex];
                                    return (
                                      <td key={`${club.clubSlug}-${member.athleteSlug ?? member.name}-${round.roundId}`} className="px-2 py-3 text-center">
                                        {outcome && outcome !== "finished" ? (
                                          <RoundOutcomePill outcome={outcome} />
                                        ) : score > 0 ? (
                                          <span className={`inline-flex min-w-12 flex-col items-center justify-center rounded-lg border px-2 py-1.5 ${
                                            counted
                                              ? "border-trail-green/20 bg-trail-green/10 text-trail-green"
                                              : "border-border bg-background text-muted-foreground"
                                          }`}>
                                            <span className="text-[9px] font-medium">#{place}</span>
                                            <span className="font-mono text-xs font-bold tabular-nums">{score} pts</span>
                                          </span>
                                        ) : <span className="text-muted-foreground">—</span>}
                                      </td>
                                    );
                                  })}
                                </tr>
                              );}) : (
                                <tr>
                                  <td colSpan={league.rounds.length + 4} className="px-4 py-6 text-center text-sm text-muted-foreground">{t("league.results.memberScoresPending")}</td>
                                </tr>
                              )}
                            </tbody>
                            {memberRows.length ? (
                              <tfoot>
                                <tr className="border-t-2 border-primary/20 bg-primary/[0.055] font-bold">
                                  <th scope="row" className="px-4 py-3 text-left font-display text-xs uppercase tracking-[0.12em] text-foreground">
                                    {t("league.results.countedTotal")}
                                  </th>
                                  <td />
                                  <td />
                                  <td className="px-2 py-3 text-right font-display text-sm font-black text-trail-green tabular-nums">{countedSeasonTotal}</td>
                                  {league.rounds.map((round, roundIndex) => (
                                    <td key={`${club.clubSlug}-counted-total-${round.roundId}`} className="px-2 py-3 text-center font-mono text-xs font-black text-trail-green tabular-nums">
                                      {countedRoundTotals[roundIndex] || "—"}
                                    </td>
                                  ))}
                                </tr>
                              </tfoot>
                            ) : null}
                          </table>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-5 border-t border-border bg-background/45 px-5 py-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2"><span className="h-5 w-5 rounded-md bg-trail-green/10" /> {scoringNote}</span>
        <span>{t("league.results.openMembersFooter")}</span>
      </div>
    </div>
  );
}

export function LeagueResultsExperience({
  league,
  focusOptions,
  focus,
  onFocusChange,
  view,
  onViewChange,
}: {
  league: PublicLeagueDetailReadModel;
  nextRound: PublicLeagueRoundItem | null;
  focusOptions: Array<{ value: string; label: string }>;
  focus: string;
  onFocusChange: (value: string) => void;
  view: "individual" | "clubs" | "categories";
  onViewChange: (value: "individual" | "clubs") => void;
}) {
  const { locale, t } = useI18n();
  const competitions = useMemo(() => {
    const defined = league.competitions.filter((competition) => competition.scoringTarget === "individual");
    if (defined.length) return defined;
    return [{
      id: "overall",
      slug: "overall",
      name: "Overall",
      description: "",
      scoringTarget: "individual" as const,
      resultBasis: "finish_place",
      standingsMode: "points" as const,
      displayOrder: 0,
      isDefault: true,
      classifications: [{
        id: "overall",
        slug: "overall",
        name: "Overall",
        eligibility: {},
        awardDepth: null,
        displayOrder: 0,
        isDefault: true,
      }],
      roundMappings: [],
      individualStandings: league.individualStandings,
      classificationStandings: { overall: league.individualStandings },
      clubStandings: league.clubStandings,
      rules: league.rules,
    }];
  }, [league]);
  const defaultCompetition = getDefaultLeagueCompetition({ competitions });
  const [competitionId, setCompetitionId] = useState(() => defaultCompetition?.id ?? "overall");
  const activeCompetition = competitions.find((competition) => competition.id === competitionId)
    ?? defaultCompetition
    ?? competitions[0];
  const rankingBoards = useMemo(
    () => activeCompetition ? getLeagueCompetitionRankingBoards(activeCompetition) : [],
    [activeCompetition],
  );
  const defaultRankingBoard = activeCompetition
    ? getDefaultLeagueRankingBoard({ competitions: [activeCompetition] })
    : null;
  const [classificationId, setClassificationId] = useState(
    () => defaultRankingBoard?.classification.id ?? "overall",
  );
  const activeRankingBoard = rankingBoards.find(
    (board) => board.classification.id === classificationId,
  ) ?? defaultRankingBoard ?? rankingBoards[0];
  const individualRows = activeRankingBoard?.standings ?? [];
  const supportsClubStandings = activeCompetition?.standingsMode === "points";
  const effectiveView = supportsClubStandings && view === "clubs" ? "clubs" : "individual";
  const usesCombinedClubTable = normalizeLeagueClubScoringScope(league.clubScoringScope) === "combined";
  const publishedCategoryIds = new Set(activeCompetition?.roundMappings.map((mapping) => mapping.eventCategoryId) ?? []);
  const latestPublishedRound = latestPublishedLeagueRound(league.entries.filter((entry) => (
    (effectiveView === "clubs" && usesCombinedClubTable)
    || !publishedCategoryIds.size || publishedCategoryIds.has(entry.eventCategoryId)
  )));
  const publicationLabel = latestPublishedRound > 0 ? t("league.results.official") : t("league.results.pending");
  const competitionLeague = useMemo(() => activeCompetition && !(effectiveView === "clubs" && usesCombinedClubTable) ? {
    ...league,
    individualStandings: activeCompetition.individualStandings,
    clubStandings: activeCompetition.clubStandings,
    rules: activeCompetition.rules,
  } : league, [activeCompetition, effectiveView, league, usesCombinedClubTable]);
  const clubScorerCount = (() => {
    const mode = competitionLeague.rules.clubScoringMode;
    if (mode === "best_two") return 2;
    if (mode === "best_four") return 4;
    const custom = mode.match(/^best_(\d+)$/);
    return custom ? Number(custom[1]) : 3;
  })();
  const clubScoringNote = usesCombinedClubTable
    ? t("league.results.combinedScoring", { count: clubScorerCount })
    : t("league.results.categoryScoring", {
      category: localizedLeagueDataLabel(
        activeCompetition?.name ?? t("league.results.categoryFallback"),
        locale,
      ),
      count: clubScorerCount,
    });

  function selectCompetition(id: string) {
    const selected = competitions.find((competition) => competition.id === id);
    setCompetitionId(id);
    const selectedDefaultBoard = selected
      ? getDefaultLeagueRankingBoard({ competitions: [selected] })
      : null;
    setClassificationId(selectedDefaultBoard?.classification.id ?? "overall");
  }

  return (
    <div className="space-y-4">
      <nav aria-label={t("league.results.filters")}>
        <MobileFilterPanel
          summary={localizedLeagueDataLabel(activeCompetition?.name ?? t("league.results.categoryFallback"), locale)}
          className="lg:rounded-2xl lg:p-3 [&_button]:min-h-11"
        >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          {effectiveView === "clubs" && usesCombinedClubTable ? (
            <div className="flex items-center gap-2" aria-label={t("league.results.clubScope")}>
              <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{t("league.results.clubTable")}</span>
              <span className="rounded-lg border border-primary/20 bg-primary/[0.08] px-3 py-2 text-xs font-semibold text-primary">
                {t("league.results.allCategoriesCombined")}
              </span>
            </div>
          ) : (
          <div className="flex min-w-0 max-w-full items-center gap-2 max-sm:w-full">
            <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{t("league.results.course")}</span>
            <select
              aria-label={t("league.results.competition")}
              value={activeCompetition?.id ?? ""}
              onChange={(event) => selectCompetition(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-foreground sm:hidden"
            >
              {competitions.map((competition) => <option key={competition.id} value={competition.id}>{localizedLeagueDataLabel(competition.name, locale)}</option>)}
            </select>
            <div className="hidden min-w-0 flex-wrap rounded-lg border border-border bg-background/70 p-1 sm:inline-flex" aria-label={t("league.results.competition")}>
              {competitions.map((competition) => (
                <button
                  key={competition.id}
                  type="button"
                  aria-pressed={activeCompetition?.id === competition.id}
                  onClick={() => selectCompetition(competition.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    activeCompetition?.id === competition.id
                      ? "bg-primary/[0.1] text-primary shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <LocaleStablePillLabel referenceLabel={competitionPillReferenceLabel(competition.name)}>
                    {localizedLeagueDataLabel(competition.name, locale)}
                  </LocaleStablePillLabel>
                </button>
              ))}
            </div>
          </div>
          )}

          {supportsClubStandings ? (
            <>
              <span className="hidden h-7 w-px bg-border sm:block" />
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{t("league.results.view")}</span>
                <div className="inline-flex rounded-lg border border-border bg-background/70 p-1" aria-label={t("league.results.standingsView")}>
                  <button type="button" aria-pressed={effectiveView === "individual"} onClick={() => onViewChange("individual")} className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${effectiveView === "individual" ? "bg-primary/[0.1] text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                    <LocaleStablePillLabel referenceLabel="Individual">{t("league.results.individual")}</LocaleStablePillLabel>
                  </button>
                  <button type="button" aria-pressed={effectiveView === "clubs"} onClick={() => onViewChange("clubs")} className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${effectiveView === "clubs" ? "bg-primary/[0.1] text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                    <LocaleStablePillLabel referenceLabel="Clubs">{t("league.results.clubs")}</LocaleStablePillLabel>
                  </button>
                </div>
              </div>
            </>
          ) : null}

          {effectiveView === "individual" ? (
            <>
              <span className="hidden h-7 w-px bg-border lg:block" />
              <div className="flex min-w-0 items-center gap-2 max-sm:w-full">
                <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{t("league.results.category")}</span>
                <select
                  aria-label={t("league.results.classification")}
                  value={activeRankingBoard?.classification.id ?? ""}
                  onChange={(event) => setClassificationId(event.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-foreground sm:hidden"
                >
                  {rankingBoards.map((board) => <option key={board.classification.id} value={board.classification.id}>{localizedLeagueDataLabel(getClassificationLabels(board.classification.name).label, locale)}</option>)}
                </select>
                <div className="hidden max-w-full gap-0.5 overflow-x-auto rounded-lg border border-border bg-background/70 p-1 sm:flex" aria-label={t("league.results.classification")}>
                  {rankingBoards.map((board) => {
                    const labels = getClassificationLabels(board.classification.name);
                    return (
                      <button key={board.classification.id} type="button" aria-label={localizedLeagueDataLabel(labels.label, locale)} aria-pressed={activeRankingBoard?.classification.id === board.classification.id} onClick={() => setClassificationId(board.classification.id)} className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${activeRankingBoard?.classification.id === board.classification.id ? "bg-primary/[0.1] text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                        <span className="sm:hidden">{labels.shortLabel}</span>
                        <LocaleStablePillLabel className="hidden sm:inline-block" referenceLabel={classificationPillReferenceLabel(labels.label)}>
                          {localizedLeagueDataLabel(labels.label, locale)}
                        </LocaleStablePillLabel>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          ) : null}

          <span className="hidden h-7 w-px bg-border xl:block" />

          <div className="flex min-w-0 max-w-full items-center gap-2 xl:ml-auto">
            <label htmlFor="league-result-scope" className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{t("league.results.round")}</label>
            <div className="relative min-w-0">
              <select id="league-result-scope" aria-label={t("league.results.scope")} className="min-h-11 max-w-full appearance-none rounded-lg border border-border bg-background py-1.5 pl-3 pr-8 text-xs font-semibold text-foreground focus:border-primary focus:outline-none" value={focus} onChange={(event) => onFocusChange(event.target.value)}>
                {focusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground xl:ml-0">
            <ShieldCheck className="h-3.5 w-3.5 text-trail-green" />
            <span className="font-semibold text-trail-green">{publicationLabel}</span>
            <span>{latestPublishedRound > 0
              ? t("league.results.afterRound", { round: latestPublishedRound })
              : t("league.results.beforeRound")}</span>
          </div>
        </div>
        </MobileFilterPanel>
      </nav>

      <section className="overflow-hidden rounded-[20px] border border-border bg-card shadow-soft">
          {activeCompetition?.standingsMode === "best_time" ? (
            <BestTimeStandingsTable competitionName={activeCompetition.name} rows={individualRows} />
          ) : activeCompetition?.standingsMode === "participation" ? (
            <ParticipationStandingsTable competitionName={activeCompetition.name} rows={individualRows} />
          ) : activeCompetition?.standingsMode === "none" ? (
            <NoSeasonStandings />
          ) : effectiveView === "clubs" ? (
            <ClubStandingsTable
              league={competitionLeague}
              rows={usesCombinedClubTable ? league.clubStandings : (activeCompetition?.clubStandings ?? league.clubStandings)}
              scoringNote={clubScoringNote}
              scorerCount={clubScorerCount}
            />
          ) : (
            <IndividualStandingsTable league={competitionLeague} rows={individualRows} />
          )}
      </section>

      <div className="text-center text-xs leading-5 text-muted-foreground">
        {t("league.results.footer", {
          status: publicationLabel.toLocaleLowerCase(locale),
          round: latestPublishedRound > 0
            ? ` ${t("league.results.afterRound", { round: latestPublishedRound })}`
            : "",
        })}
      </div>
    </div>
  );
}
