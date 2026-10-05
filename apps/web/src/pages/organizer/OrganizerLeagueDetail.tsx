import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  CheckCircle2,
  CircleDashed,
  Coins,
  Flag,
  Loader2,
  MapPin,
  MessageCircle,
  Percent,
  Route,
  Star,
  Trophy,
  UserCheck,
  Users,
} from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import ScrollReveal from "@/components/shared/ScrollReveal";
import {
  CalendarTimelineDateBadge,
} from "@/components/shared/CalendarTimeline";
import { pickCalendarTimelineAccent } from "@/components/shared/calendarTimelineAccents";
import { Button } from "@/components/ui/button";
import { buildLeagueSeasonDateRange } from "@/features/leagues/model/leagueSeasonDateRange";
import { useOrganizerAuth } from "@/lib/organizer-workspace";
import {
  deleteOrganizerLeague,
  getOrganizerEventCommunitySummaries,
  getOrganizerEvents,
  getOrganizerLeagueSeasonById,
  getOrganizerRaceDayState,
  publishOrganizerLeagueSeason,
  updateOrganizerLeagueSeason,
  type OrganizerLeagueCompetition,
  type OrganizerManagedCategory,
} from "@/lib/organizer-management";
import {
  LeagueCompetitionWorkspace,
  LeagueRoundManager,
  LeagueSeasonSetupForm,
  LeagueVisibilityBadge,
} from "@/components/organizer/league/LeagueWorkspaceShared";
import {
  buildLeaguePlanningFromSource,
  getLeagueClubScorerCount,
  getLeagueClubScoringStructureLabel,
} from "@/components/organizer/league/leaguePlanning";
import {
  formatOrganizerLeagueApiError,
  getLeaguePublishReadiness,
  getLeagueRoundStatusMeta,
  getLeagueSeasonStatusMeta,
} from "@/components/organizer/league/leagueWorkspaceMeta";
import { buildLeagueRoundSlots } from "@/features/leagues/model/leagueRoundPlanning";
import { LeaguePointsCurveChart } from "@/features/leagues/organizer/components/LeagueScoringCurveEditor";
import { RecreationalLeagueSchedulePanel } from "@/features/leagues/organizer/components/RecreationalLeagueSchedulePanel";
import {
  getSibenikTrailLeagueDisplayName,
  getSibenikTrailLeagueLocalName,
} from "@/features/leagues/model/sibenikTrailLeagueIdentity";
import { useI18n } from "@/shared/i18n/I18nContext";
import type { AppLocale } from "@/shared/i18n/locales";

const ORGANIZER_EDITOR_PANEL_CLASS = "rounded-2xl border border-border bg-card shadow-soft";
const ORGANIZER_EDITOR_SUBPANEL_CLASS = "rounded-xl border border-border/70 bg-background/55";
const leagueTabs = ["overview", "categories", "rounds", "review"] as const;

type LeagueDetailTab = (typeof leagueTabs)[number];

function parseLeagueDetailTab(value: string | null): LeagueDetailTab | null {
  if (!value) return null;
  return leagueTabs.find((tab) => tab === value) ?? null;
}

function roundDateValue(date: string | null | undefined) {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatTieBreak(value: string | null | undefined, locale: AppLocale) {
  if (!value) return locale === "hr" ? "Nije postavljeno" : "Not set";
  if (locale !== "hr") return value.replace(/_/g, " ");
  const labels: Record<string, string> = {
    best_finish: "najbolji plasman",
    best_single_result: "najbolji pojedinačni rezultat",
    head_to_head: "međusobni rezultat",
    last_round_better: "bolje završno kolo",
    most_wins: "najviše pobjeda",
  };
  return labels[value] ?? value.replace(/_/g, " ");
}

function getStandingsModeLabel(
  mode: OrganizerLeagueCompetition["standingsMode"] | undefined,
  locale: AppLocale,
) {
  switch (mode ?? "points") {
    case "best_time": return locale === "hr" ? "Najbolje vrijeme" : "Best time";
    case "participation": return locale === "hr" ? "Sudjelovanje" : "Participation";
    case "none": return locale === "hr" ? "Samo rezultati" : "Results only";
    default: return locale === "hr" ? "Bodovi" : "Points";
  }
}

function getNonPointsStandingDescription(
  mode: OrganizerLeagueCompetition["standingsMode"],
  locale: AppLocale,
) {
  switch (mode) {
    case "best_time": return locale === "hr"
      ? "Natjecatelji su poredani prema najbržem ukupnom vremenu tijekom sezone."
      : "Athletes are ranked by their fastest elapsed time across the season.";
    case "participation": return locale === "hr"
      ? "Natjecatelji su poredani prema broju završenih nastupa; krivulja bodovanja se ne koristi."
      : "Athletes are ranked by completed participations; no points curve is used.";
    default: return locale === "hr"
      ? "Rezultati kola objavljuju se bez izračuna sezonskog poretka."
      : "Round results are published without calculating season standings.";
  }
}

const STARTER_PARTICIPATION_STATUSES = new Set(["started", "finished", "dnf", "dsq"]);

function formatRoundPrice(categories: OrganizerManagedCategory[], localeTag: string, freeLabel: string) {
  const pricedCategories = categories.filter(
    (category): category is OrganizerManagedCategory & { feeCents: number } => category.feeCents != null,
  );
  if (pricedCategories.length === 0) return freeLabel;
  const lowestFee = Math.min(...pricedCategories.map((category) => category.feeCents));
  const currency = pricedCategories.find((category) => category.feeCents === lowestFee)?.currency ?? "EUR";
  const formatted = new Intl.NumberFormat(localeTag, {
    style: "currency",
    currency,
    maximumFractionDigits: lowestFee % 100 === 0 ? 0 : 2,
  }).format(lowestFee / 100);
  return pricedCategories.some((category) => category.feeCents !== lowestFee) ? `From ${formatted}` : formatted;
}

function CompetitionSetupPreview({ competition }: { competition: OrganizerLeagueCompetition }) {
  const { locale, t } = useI18n();
  const [selectedCategoryId, setSelectedCategoryId] = useState(competition.classifications[0]?.id ?? "");
  const selectedCategory = competition.classifications.find((category) => category.id === selectedCategoryId)
    ?? competition.classifications[0];
  const rules = competition.scoringRules;
  const chartPoints = rules?.pointsTable ?? [];
  const standingsMode = competition.standingsMode ?? "points";
  const usesPoints = standingsMode === "points";
  const standingSamples = standingsMode === "best_time"
    ? ["19:42", "20:18", "21:03"]
    : standingsMode === "participation"
      ? [8, 7, 6].map((count) => locale === "hr" ? `${count} završetaka` : `${count} finishes`)
      : standingsMode === "none"
        ? ["—", "—", "—"]
        : [0, 1, 2].map((index) => String(rules?.pointsTable[index] ?? "—"));

  return (
    <article
      aria-label={t("organizer.league.competitionSummary", { competition: competition.name })}
      className="w-full overflow-hidden rounded-xl border border-border/70 bg-background/55 lg:grid lg:grid-cols-[clamp(170px,18%,240px)_clamp(240px,28%,400px)_minmax(360px,1fr)]"
    >
      <div className="border-b border-border/70 p-2.5 lg:border-b-0 lg:border-r">
        <div className="flex items-start justify-between gap-2 lg:block">
          <div>
            <h4 className="font-display text-sm font-bold">{competition.name}</h4>
            <p className="mt-0.5 text-[9px] leading-3.5 text-muted-foreground">
              {usesPoints ? (rules?.name || t("organizer.league.competitionScoring", { competition: competition.name })) : getNonPointsStandingDescription(standingsMode, locale)}
            </p>
          </div>
          <span className="rounded-full border border-primary/20 bg-primary/[0.055] px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-primary lg:mt-2 lg:inline-flex">
            {usesPoints ? (rules?.scoringMethod ?? (locale === "hr" ? "Nije postavljeno" : "Not configured")) : getStandingsModeLabel(standingsMode, locale)}
          </span>
        </div>

        {usesPoints ? <dl className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-2">
          <div className="rounded-md bg-card/75 px-2 py-1.5">
            <dt className="text-[8px] uppercase tracking-[0.1em] text-muted-foreground">Winner</dt>
            <dd className="mt-0.5 text-[10px] font-bold text-foreground">{chartPoints[0] ?? "—"} pts</dd>
          </div>
          <div className="rounded-md bg-card/75 px-2 py-1.5">
            <dt className="text-[8px] uppercase tracking-[0.1em] text-muted-foreground">Rounds</dt>
            <dd className="mt-0.5 text-[10px] font-bold text-foreground">{rules?.bestN ? t("organizer.league.bestCount", { count: rules.bestN }) : (locale === "hr" ? "Sve se računa" : "All count")}</dd>
          </div>
          <div className="rounded-md bg-card/75 px-2 py-1.5">
            <dt className="text-[8px] uppercase tracking-[0.1em] text-muted-foreground">Minimum</dt>
            <dd className="mt-0.5 text-[10px] font-bold text-foreground">
              {rules?.minimumRounds ?? "—"} {locale === "hr" ? (rules?.minimumRounds === 1 ? "završetak" : "završetaka") : (rules?.minimumRounds === 1 ? "finish" : "finishes")}
            </dd>
          </div>
          <div className="rounded-md bg-card/75 px-2 py-1.5">
            <dt className="text-[8px] uppercase tracking-[0.1em] text-muted-foreground">Tie</dt>
            <dd className="mt-0.5 text-[10px] font-bold capitalize leading-3 text-foreground">{formatTieBreak(rules?.tieBreakMethod, locale)}</dd>
          </div>
        </dl> : (
          <dl className="mt-2 grid grid-cols-2 gap-1.5">
            <div className="rounded-md bg-card/75 px-2 py-1.5">
              <dt className="text-[8px] uppercase tracking-[0.1em] text-muted-foreground">Standing</dt>
              <dd className="mt-0.5 text-[10px] font-bold text-foreground">{getStandingsModeLabel(standingsMode, locale)}</dd>
            </div>
            <div className="rounded-md bg-card/75 px-2 py-1.5">
              <dt className="text-[8px] uppercase tracking-[0.1em] text-muted-foreground">Points</dt>
              <dd className="mt-0.5 text-[10px] font-bold text-foreground">Not used</dd>
            </div>
          </dl>
        )}
      </div>

      <div className="min-w-0 border-b border-border/70 p-2.5 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{usesPoints ? "Score curve" : "Standings method"}</div>
          <span className="text-[9px] text-muted-foreground">{usesPoints ? t("organizer.league.curveSummary", { places: chartPoints.length, points: rules?.participationPoints ?? 0 }) : getStandingsModeLabel(standingsMode, locale)}</span>
        </div>
        {usesPoints && chartPoints.length ? (
          <div className="mt-1.5 rounded-lg border border-border/60 bg-card/70 px-1 py-0.5">
            <LeaguePointsCurveChart
              points={chartPoints}
              scoringLabel={t("organizer.league.scoreLabel", { competition: competition.name })}
              ariaLabel={t("organizer.league.scoreChartAria", { competition: competition.name })}
              className="h-28 lg:h-36"
            />
          </div>
        ) : usesPoints ? (
          <div className="mt-1.5 flex h-28 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground lg:h-36">No score curve configured.</div>
        ) : (
          <div className="mt-1.5 flex h-28 items-center justify-center rounded-lg border border-primary/15 bg-primary/[0.035] px-6 text-center text-xs leading-5 text-muted-foreground lg:h-36">{getNonPointsStandingDescription(standingsMode, locale)}</div>
        )}
      </div>

      <div className="min-w-0 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Athlete categories</div>
            <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-primary">Preview</span>
          </div>
          {competition.classifications.length ? (
            <>
              <div className="mt-1.5 flex gap-1 overflow-x-auto pb-0.5" role="tablist" aria-label={t("organizer.league.athleteCategoriesAria", { competition: competition.name })}>
                {competition.classifications.map((category) => {
                  const selected = category.id === selectedCategory?.id;
                  return (
                    <button
                      key={category.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setSelectedCategoryId(category.id)}
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold transition-colors ${selected ? "bg-primary text-primary-foreground" : "border border-border bg-card text-muted-foreground hover:text-foreground"}`}
                    >
                      {category.name}
                    </button>
                  );
                })}
              </div>
              <div className="mt-1.5 overflow-hidden rounded-lg border border-border/70 bg-card/70">
                <table className="w-full text-left text-[10px]">
                  <caption className="sr-only">Top three sample standings for {selectedCategory?.name ?? competition.name}</caption>
                  <thead className="bg-muted/45 text-[8px] uppercase tracking-[0.13em] text-muted-foreground">
                    <tr><th className="w-12 px-2 py-1">Place</th><th className="px-2 py-1">Athlete</th><th className="px-2 py-1 text-right">{standingsMode === "best_time" ? "Best time" : standingsMode === "participation" ? "Completed" : "Score"}</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {[0, 1, 2].map((index) => (
                      <tr key={index}>
                        <td className="px-2 py-1 font-display font-bold text-primary">{index + 1}</td>
                        <td className="px-2 py-1 font-medium text-foreground">Sample athlete {index + 1}</td>
                        <td className="px-2 py-1 text-right font-semibold text-foreground">{standingSamples[index]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="mt-1.5 flex h-20 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">No athlete categories configured.</div>
          )}
      </div>
    </article>
  );
}

function ClubScoringPreview({
  scoringMode,
  scoringScope,
  competitions,
}: {
  scoringMode: string;
  scoringScope: "combined" | "per_competition";
  competitions: OrganizerLeagueCompetition[];
}) {
  const { locale, t } = useI18n();
  const scorerCount = getLeagueClubScorerCount(scoringMode);
  const enabled = scoringMode !== "none";
  const sampleScores = [100, 87, 79, 72, 66, 61, 57, 53, 49, 45].slice(0, Math.max(5, scorerCount));
  const countedScores = sampleScores.slice(0, scorerCount);
  const droppedCount = sampleScores.length - countedScores.length;
  const competitionNames = competitions.map((competition) => competition.name).join(" + ");

  return (
    <article className="mt-2 grid w-full overflow-hidden rounded-xl border border-border/70 bg-background/55 lg:grid-cols-[clamp(240px,28%,360px)_minmax(0,1fr)] lg:items-stretch">
      <div className="flex items-start gap-2.5 p-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Users className="h-3.5 w-3.5" /></span>
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Club championship</div>
          <h4 className="mt-0.5 font-display text-sm font-bold">{getLeagueClubScoringStructureLabel(scoringMode, scoringScope)}</h4>
          <p className="mt-1 text-[9px] leading-3.5 text-muted-foreground">
            {enabled
              ? scoringScope === "combined"
                ? t("organizer.league.combinedClubDescription", { competitions: competitionNames, count: scorerCount })
                : t("organizer.league.separateClubDescription", { count: scorerCount })
              : locale === "hr" ? "Liga zadržava samo pojedinačni poredak." : "League standings remain individual only."}
          </p>
        </div>
      </div>
      {enabled ? (
        <div className="border-t border-primary/15 bg-primary/[0.035] p-2.5 lg:border-l lg:border-t-0" aria-label="Club scoring example">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-primary">Five runner example</div>
              <div className="mt-0.5 text-[10px] font-semibold text-foreground">{t("organizer.league.bestResultsCount", { best: scorerCount, total: sampleScores.length })}</div>
            </div>
            <div className="flex flex-wrap gap-1">
              {competitions.map((competition) => <span key={competition.id} className="rounded-full border border-border/70 bg-card px-2 py-0.5 text-[9px] font-semibold">{competition.name}</span>)}
            </div>
          </div>

          <div className="mt-1.5 grid grid-cols-5 gap-1">
            {sampleScores.map((score, index) => {
              const counts = index < scorerCount;
              return (
                <div
                  key={`${index}-${score}`}
                  className={`min-w-0 rounded-md border px-1 py-1 text-center ${counts ? "border-primary/25 bg-card shadow-sm" : "border-dashed border-border/80 bg-muted/25 text-muted-foreground"}`}
                >
                  <div className="text-[8px] font-semibold uppercase tracking-[0.08em]">
                    <span className="sm:hidden">#{index + 1}</span>
                    <span className="hidden sm:inline">{t("organizer.league.runnerNumber", { number: index + 1 })}</span>
                  </div>
                  <div className={`mt-0.5 font-display text-xs font-bold ${counts ? "text-primary" : "text-muted-foreground line-through decoration-border"}`}>{t("organizer.league.pointsShort", { points: score })}</div>
                  <div className={`mt-0.5 text-[8px] font-bold uppercase tracking-[0.08em] ${counts ? "text-primary" : "text-muted-foreground"}`}>{counts ? (locale === "hr" ? "Računa se" : "Counts") : (locale === "hr" ? "Odbačeno" : "Dropped")}</div>
                </div>
              );
            })}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 border-t border-primary/15 pt-1.5">
            <div className="text-[9px] text-muted-foreground">
              <strong className="text-foreground">{countedScores.join(" + ")}</strong> · {t(droppedCount === 1 ? "organizer.league.lowerResultExcluded" : "organizer.league.lowerResultsExcluded", { count: droppedCount })}
            </div>
            <div className="flex items-baseline gap-1.5 rounded-md bg-primary px-2.5 py-1 text-primary-foreground">
              <span className="text-[8px] font-bold uppercase tracking-[0.12em]">Club total</span>
              <strong className="font-display text-sm">{t("organizer.league.pointsShort", { points: countedScores.reduce((sum, score) => sum + score, 0) })}</strong>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export default function OrganizerLeagueDetail() {
  const { formatDate, locale, localeTag, t } = useI18n();
  const { seasonId = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseLeagueDetailTab(searchParams.get("tab")) ?? "overview";
  const { account, user } = useOrganizerAuth();
  const [organizerRulesDraft, setOrganizerRulesDraft] = useState("");
  const [savingOrganizerRules, setSavingOrganizerRules] = useState(false);
  const [closingLeague, setClosingLeague] = useState(false);
  const seasonQuery = useQuery({
    queryKey: ["organizer-league-detail", seasonId, account?.organizationIds[0] ?? "no-org"],
    queryFn: () => getOrganizerLeagueSeasonById(account, seasonId),
    enabled: Boolean(account?.hasOrganizerAccess && seasonId),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const season = seasonQuery.data;
  useEffect(() => {
    setOrganizerRulesDraft(season?.organizerRules ?? "");
  }, [season?.seasonId, season?.organizerRules]);
  const roundEventIds = Array.from(new Set((season?.rounds ?? []).map((round) => round.eventEditionId)));
  const eventsQuery = useQuery({
    queryKey: ["organizer-events-for-league-detail", account?.organizationIds[0] ?? "no-org"],
    queryFn: () => getOrganizerEvents(account),
    enabled: Boolean(account?.hasOrganizerAccess),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const roundInsightsQuery = useQuery({
    queryKey: [
      "organizer-league-round-insights",
      account?.organizationIds[0] ?? "no-org",
      roundEventIds.join(","),
    ],
    queryFn: async () => {
      const [communitySummaries, raceDayStates] = await Promise.all([
        getOrganizerEventCommunitySummaries(account, roundEventIds).catch(() => []),
        Promise.all(roundEventIds.map(async (eventEditionId) => ({
          eventEditionId,
          state: await getOrganizerRaceDayState(account, eventEditionId).catch(() => null),
        }))),
      ]);
      return { communitySummaries, raceDayStates };
    },
    enabled: Boolean(account?.hasOrganizerAccess && roundEventIds.length),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const seasonDisplayName = getSibenikTrailLeagueDisplayName(
    season?.name ?? "",
    season?.slug,
  );
  const seasonLocalName = getSibenikTrailLeagueLocalName(
    season?.name ?? "",
    season?.slug,
  );
  const events = (eventsQuery.data ?? []).filter((event) => !event.isPractice);
  const publishReadiness = season ? getLeaguePublishReadiness(season, locale, localeTag) : null;
  const completedRounds = season?.rounds.filter((round) => round.status === "completed").length ?? 0;
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const communityByEventId = new Map(
    (roundInsightsQuery.data?.communitySummaries ?? []).map((summary) => [summary.eventEditionId, summary]),
  );
  const raceDayByEventId = new Map(
    (roundInsightsQuery.data?.raceDayStates ?? []).map((entry) => [entry.eventEditionId, entry.state]),
  );
  const individualCompetitions = (season?.competitions ?? []).filter(
    (competition) => competition.scoringTarget === "individual" && competition.status !== "archived",
  );
  const seasonPlanningOverview = buildLeaguePlanningFromSource({
    description: season?.description ?? null,
    scoringRules: season?.scoringRules ?? null,
    clubScoringScope: season?.clubScoringScope ?? null,
  });
  const hasSeasonBlueprint = Boolean(season?.description?.trim() || season?.scoringRules);
  const roundSlots = season ? buildLeagueRoundSlots(season.rounds, season.description) : [];
  const plannedRoundTarget = roundSlots.length;
  const roundRaceCountMismatches = season
    ? season.rounds.filter((round) => {
        const event = eventsById.get(round.eventEditionId);
        if (!event) return false;
        const competitiveRaceCount = event.categories.filter(
          (category) => category.categoryType === "competitive",
        ).length;
        return competitiveRaceCount !== individualCompetitions.length;
      })
    : [];
  const roundsWithIncompleteMappings = season
    ? season.rounds.filter((round) => {
        const event = eventsById.get(round.eventEditionId);
        if (!event) return false;
        const competitiveRaceCount = event.categories.filter(
          (category) => category.categoryType === "competitive",
        ).length;
        const mappedCompetitionCount = new Set(
          (round.mappings ?? [])
            .filter((mapping) => individualCompetitions.some((competition) => competition.id === mapping.competitionId))
            .map((mapping) => mapping.competitionId),
        ).size;
        return mappedCompetitionCount !== Math.min(individualCompetitions.length, competitiveRaceCount);
      })
    : [];
  const seasonDateRange = season
    ? buildLeagueSeasonDateRange(
        season.rounds.map((round) => ({ roundNumber: round.roundNumber, dateIso: round.eventDate })),
        plannedRoundTarget,
        localeTag,
        locale === "hr" ? "Naknadno" : "TBA",
      )
    : locale === "hr" ? "Naknadno – Naknadno" : "TBA - TBA";
  const publishBlockers = season
    ? [
        ...(individualCompetitions.length === 0 ? ["Add at least one individual competition."] : []),
        ...(individualCompetitions.some(
          (competition) => (competition.standingsMode ?? "points") === "points" && !competition.scoringRules,
        )
          ? ["Add scoring rules to every points competition."]
          : []),
        ...(season.rounds.length === 0 ? ["Add at least one round."] : []),
        ...(roundsWithIncompleteMappings.length > 0
          ? ["Map as many competitive races as possible in every round."]
          : []),
      ]
    : [];
  const publishWarnings = season
    ? [
        ...(!seasonPlanningOverview.seasonBrief.trim()
          ? ["Add a public season description."]
          : []),
        ...(plannedRoundTarget > 0 && season.rounds.length < plannedRoundTarget
          ? [t(plannedRoundTarget - season.rounds.length === 1 ? "organizer.league.remainingRound" : "organizer.league.remainingRounds", { count: plannedRoundTarget - season.rounds.length })]
          : []),
        ...(roundRaceCountMismatches.length > 0
          ? [t(roundRaceCountMismatches.length === 1 ? "organizer.league.roundMismatch" : "organizer.league.roundsMismatch", { count: roundRaceCountMismatches.length })]
          : []),
      ]
    : [];

  function handleTabChange(tab: LeagueDetailTab) {
    const next = new URLSearchParams(searchParams);
    if (tab === "overview") {
      next.delete("tab");
    } else {
      next.set("tab", tab);
    }
    setSearchParams(next, { replace: true });
  }

  async function refreshSeason() {
    await Promise.all([seasonQuery.refetch(), eventsQuery.refetch()]);
  }

  async function handlePublish() {
    if (!account || !season) return;

    try {
      await publishOrganizerLeagueSeason(account, season.seasonId);
      await refreshSeason();
      toast.success("League season published to the public website.");
    } catch (error) {
      toast.error(formatOrganizerLeagueApiError(error));
    }
  }

  async function handleSaveOrganizerRules() {
    if (!account || !season || savingOrganizerRules) return;

    let rulesSaved = false;
    setSavingOrganizerRules(true);
    try {
      await updateOrganizerLeagueSeason(account, {
        leagueId: season.leagueId,
        seasonId: season.seasonId,
        organizerRules: organizerRulesDraft.trim() || null,
      });
      rulesSaved = true;
      await publishOrganizerLeagueSeason(account, season.seasonId);
      await refreshSeason();
      toast.success("Organizer rules saved and published.");
    } catch (error) {
      const message = formatOrganizerLeagueApiError(error);
      toast.error(rulesSaved ? `Rules were saved, but publication failed: ${message}` : message);
    } finally {
      setSavingOrganizerRules(false);
    }
  }

  async function handleCloseLeague() {
    if (!account || !season || closingLeague) return;
    const confirmed = window.confirm(locale === "hr"
      ? `Zatvoriti ligu ${seasonDisplayName}? Liga će se prikazati kao završena na javnim stranicama.`
      : `Close ${seasonDisplayName}? The league will be shown as completed on public pages.`);
    if (!confirmed) return;

    setClosingLeague(true);
    try {
      await updateOrganizerLeagueSeason(account, {
        leagueId: season.leagueId,
        seasonId: season.seasonId,
        status: "completed",
      });
      await refreshSeason();
      toast.success(locale === "hr" ? "Liga je zatvorena." : "League closed.");
    } catch (error) {
      toast.error(formatOrganizerLeagueApiError(error));
    } finally {
      setClosingLeague(false);
    }
  }

  async function handleDelete() {
    if (!account || !season) return;
    if (!window.confirm(t("organizer.league.deleteConfirm", { name: seasonDisplayName }))) return;

    try {
      await deleteOrganizerLeague(account, season.leagueId);
      toast.success("League deleted.");
      navigate("/organizer/leagues");
    } catch (error) {
      toast.error(formatOrganizerLeagueApiError(error));
    }
  }

  if (!user || !account?.hasOrganizerAccess) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center p-6 text-center">
        <p className="text-muted-foreground">Sign in with an organizer account to manage leagues.</p>
        <Link
          to="/auth"
          className="mt-4 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          Sign In
        </Link>
      </div>
    );
  }

  if (seasonQuery.isLoading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center p-6">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (seasonQuery.error || !season) {
    return (
      <div className="p-6 lg:p-8">
        <ScrollReveal>
          <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
            <Trophy className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <h1 className="mt-4 font-display text-2xl font-bold">League Unavailable</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {seasonQuery.error ? formatOrganizerLeagueApiError(seasonQuery.error) : "This organizer league season could not be loaded."}
            </p>
            <Link
              to="/organizer/leagues"
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Leagues
            </Link>
          </div>
        </ScrollReveal>
      </div>
    );
  }

  const seasonStatusMeta = getLeagueSeasonStatusMeta(season.seasonStatus, season.isPublic, locale);

  return (
    <div key={season.seasonId} className="p-6 lg:p-8">
      <ScrollReveal>
        <div className="mb-5">
          <Link to="/organizer/leagues" className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Leagues
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <h1 className="mr-1 font-display text-2xl font-bold tracking-tight">{seasonDisplayName}</h1>
                <span data-locale-fit="pill" className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider ${seasonStatusMeta.className}`}>
                  {seasonStatusMeta.label}
                </span>
                <LeagueVisibilityBadge isPublic={season.isPublic} />
              </div>
              {seasonLocalName ? (
                <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                  {seasonLocalName}
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" />{seasonDateRange}</span>
                <span className="flex items-center gap-1.5"><Route className="h-3.5 w-3.5" />
                  {t("organizer.league.roundsLinked", { linked: season.rounds.length, total: plannedRoundTarget })}
                </span>
                <span className="flex items-center gap-1.5"><Trophy className="h-3.5 w-3.5" />{t(individualCompetitions.length === 1 ? "organizer.league.competitionCount" : "organizer.league.competitionsCount", { count: individualCompetitions.length })}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!["completed", "archived"].includes(season.seasonStatus) ? (
                <Button variant="outline" size="sm" className="h-8 rounded-full px-3 text-[10px] font-semibold" disabled={closingLeague} onClick={handleCloseLeague}>
                  {closingLeague ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
                  {locale === "hr" ? "Zatvori ligu" : "Close league"}
                </Button>
              ) : null}
              <Button variant="secondary" size="sm" className="h-8 rounded-full px-3 text-[10px] font-semibold" onClick={() => handleTabChange("categories")}>
                {t("organizer.league.competition.title")}
              </Button>
              <Button variant="ghost" size="sm" className="h-8 rounded-full px-3 text-[10px] font-semibold text-destructive hover:text-destructive" onClick={handleDelete}>
                Delete
              </Button>
            </div>
          </div>
        </div>
      </ScrollReveal>

      <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1.5 shadow-soft">
        {leagueTabs.map((tab) => {
          const active = activeTab === tab;
          const labels: Record<LeagueDetailTab, string> = {
            overview: "League setup",
            categories: t("organizer.league.competition.count", { count: individualCompetitions.length }),
            rounds: t("organizer.league.roundsCount", { count: plannedRoundTarget }),
            review: "Rules",
          };

          return (
            <button
              data-locale-fit="control"
              key={tab}
              type="button"
              onClick={() => handleTabChange(tab)}
              className={`relative whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              }`}
            >
              {labels[tab]}
              {active ? <span className="absolute inset-x-3 bottom-0.5 h-0.5 rounded-full bg-primary" /> : null}
            </button>
          );
        })}
      </div>

      {activeTab === "overview" ? (
        <div className="space-y-5">
          <ScrollReveal>
            <section className={`${ORGANIZER_EDITOR_PANEL_CLASS} p-4`} aria-labelledby="league-setup-title">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">League setup</div>
                  <h2 id="league-setup-title" className="mt-1 font-display text-lg font-bold">League details and competition rules</h2>
                </div>
                <span className="text-xs font-medium text-muted-foreground">
                  {season.publishedAt
                    ? t("organizer.league.publishedDate", { date: formatDate(season.publishedAt, { dateStyle: "medium" }) })
                    : "Private draft"}
                </span>
              </div>

              <LeagueSeasonSetupForm season={season} onSaved={refreshSeason} />

              <div data-testid="league-competition-section" className="mt-4 w-full border-t border-border/70 pt-3">
                <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Competitions</div>
                    <h3 className="mt-1 font-display text-base font-bold">Scoring systems and athlete categories</h3>
                  </div>
                  <span className="text-xs text-muted-foreground">{t("organizer.league.configuredCount", { count: individualCompetitions.length })}</span>
                </div>

                {individualCompetitions.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-background/45 p-5 text-center text-sm text-muted-foreground">No individual competitions configured.</div>
                ) : (
                  <div className="space-y-2">
                    {individualCompetitions.map((competition) => (
                      <CompetitionSetupPreview key={competition.id} competition={competition} />
                    ))}
                  </div>
                )}
                <ClubScoringPreview
                  scoringMode={hasSeasonBlueprint ? seasonPlanningOverview.clubScoringMode : "none"}
                  scoringScope={seasonPlanningOverview.clubScoringScope}
                  competitions={individualCompetitions}
                />
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
                <div className="flex items-center gap-2 text-xs">
                  {publishBlockers.length === 0 ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <CircleDashed className="h-4 w-4 text-trail-amber" />}
                  <span className="font-semibold">{publishBlockers.length === 0 ? (locale === "hr" ? "Spremno za pregled objave" : "Ready for publish review") : t(publishBlockers.length === 1 ? "organizer.league.publishBlocker" : "organizer.league.publishBlockers", { count: publishBlockers.length })}</span>
                  {publishWarnings.length > 0 ? <span className="text-muted-foreground">· {t(publishWarnings.length === 1 ? "organizer.league.recommendedCheck" : "organizer.league.recommendedChecks", { count: publishWarnings.length })}</span> : null}
                </div>
                <Button variant="secondary" size="sm" className="h-8 rounded-full px-3 text-[10px] font-semibold" onClick={() => handleTabChange("review")}>Open rules</Button>
              </div>
            </section>
          </ScrollReveal>

          <ScrollReveal delay={0.05}>
            <section className={`${ORGANIZER_EDITOR_PANEL_CLASS} overflow-hidden`} aria-labelledby="season-calendar-title">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3.5">
                <div>
                  <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Rounds</div>
                  <h2 id="season-calendar-title" className="mt-1 font-display text-base font-bold">Season calendar</h2>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{t("organizer.league.roundsComplete", { complete: completedRounds, total: plannedRoundTarget })}</span>
                  <Button variant="secondary" size="sm" className="h-8 rounded-full px-3 text-[10px] font-semibold" onClick={() => handleTabChange("rounds")}>Manage rounds</Button>
                </div>
              </div>

              <div className="px-3 pb-1">
                {roundSlots.length === 0 ? (
                  <div className="my-3 rounded-xl border border-dashed border-border bg-background/35 p-6 text-center text-sm text-muted-foreground">No rounds planned yet.</div>
                ) : roundSlots.map((slot, index) => {
                  const round = slot.round;
                  const dateValue = roundDateValue(round?.eventDate);
                  const accent = pickCalendarTimelineAccent(dateValue, round?.status === "completed");
                  const event = round ? eventsById.get(round.eventEditionId) : null;
                  const statusMeta = round ? getLeagueRoundStatusMeta(round.status, locale) : null;
                  const mappedCategoryIds = new Set((round?.mappings ?? []).map((mapping) => mapping.eventCategoryId));
                  const mappedCategories = (event?.categories ?? []).filter((category) => mappedCategoryIds.has(category.id));
                  const registrationCategories = mappedCategories.length ? mappedCategories : (event?.categories ?? []);
                  const registrationCount = registrationCategories.reduce((sum, category) => sum + category.registrationCount, 0);
                  const raceDayState = round ? raceDayByEventId.get(round.eventEditionId) : null;
                  const starterCount = raceDayState
                    ? raceDayState.expectedAthletes.filter((athlete) => (
                        (mappedCategoryIds.size === 0 || mappedCategoryIds.has(athlete.eventCategoryId))
                        && STARTER_PARTICIPATION_STATUSES.has(athlete.participationStatus)
                      )).length
                    : null;
                  const startRate = starterCount != null && registrationCount > 0
                    ? Math.round((starterCount / registrationCount) * 100)
                    : null;
                  const community = round ? communityByEventId.get(round.eventEditionId) : null;
                  return (
                    <article key={round?.id ?? `planned-round-${slot.roundNumber}`} className={`relative my-3 grid grid-cols-[62px_minmax(0,1fr)] gap-3 rounded-xl border px-2.5 py-2.5 shadow-soft sm:grid-cols-[62px_minmax(0,1fr)_auto] sm:items-center ${round ? "border-border/70 bg-background/55" : "border-dashed border-border bg-background/35"}`}>
                      <span className={`absolute inset-y-4 left-0 w-1 rounded-r-full ${accent.stripe}`} aria-hidden="true" />
                      <CalendarTimelineDateBadge dateValue={dateValue} accent={accent} isLast={index === roundSlots.length - 1} size="sm" />
                      <div className="min-w-0 sm:flex sm:items-center sm:gap-3">
                        {round && event?.coverImageUrl ? <img src={event.coverImageUrl} alt="" aria-hidden="true" className="mb-2 h-16 w-full shrink-0 rounded-lg border border-border/70 object-cover sm:mb-0 sm:w-24" /> : null}
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{t("organizer.league.roundLabel", { number: slot.roundNumber })}</span>
                            {statusMeta ? <span data-locale-fit="pill" className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider ${statusMeta.className}`}>{statusMeta.label}</span> : <span data-locale-fit="pill" className="rounded-full border border-border px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider text-muted-foreground">Race TBA</span>}
                          </div>
                          <h3 className="mt-1 font-display text-sm font-bold">{round?.eventName ?? "Planned round"}</h3>
                          {round ? (
                            <>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/45 px-2 py-1 text-[9px] text-muted-foreground"><MapPin className="h-2.5 w-2.5 text-primary" />{event?.locationName || "Location TBD"}</span>
                                {(round.mappings ?? []).map((mapping) => <span key={mapping.id} className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/45 px-2 py-1 text-[9px] text-muted-foreground"><Flag className="h-2.5 w-2.5 text-primary" />{mapping.competitionName} → {mapping.categoryName}</span>)}
                              </div>
                              <div className="mt-1.5 flex flex-wrap gap-1.5" aria-label={t("organizer.league.roundStatisticsAria", { number: slot.roundNumber })}>
                                <span data-locale-fit="pill" className="inline-flex items-center gap-1 rounded-full border border-primary/15 bg-primary/[0.045] px-2 py-1 text-[9px] font-medium text-foreground"><Users className="h-2.5 w-2.5 text-primary" />{t("organizer.league.registrationsCount", { count: registrationCount })}</span>
                                <span data-locale-fit="pill" className="inline-flex items-center gap-1 rounded-full border border-primary/15 bg-primary/[0.045] px-2 py-1 text-[9px] font-medium text-foreground"><UserCheck className="h-2.5 w-2.5 text-primary" />{t("organizer.league.startersCount", { count: starterCount ?? "—" })}</span>
                                <span data-locale-fit="pill" className="inline-flex items-center gap-1 rounded-full border border-primary/15 bg-primary/[0.045] px-2 py-1 text-[9px] font-medium text-foreground"><Percent className="h-2.5 w-2.5 text-primary" />{startRate == null ? t("organizer.league.noStartRate") : t("organizer.league.startRate", { rate: startRate })}</span>
                                <span data-locale-fit="pill" className="inline-flex items-center gap-1 rounded-full border border-primary/15 bg-primary/[0.045] px-2 py-1 text-[9px] font-medium text-foreground"><Coins className="h-2.5 w-2.5 text-primary" />{formatRoundPrice(registrationCategories, localeTag, locale === "hr" ? "Besplatno" : "Free")}</span>
                                <span data-locale-fit="pill" className="inline-flex items-center gap-1.5 rounded-full border border-primary/15 bg-primary/[0.045] px-2 py-1 text-[9px] font-medium text-foreground"><Star className="h-2.5 w-2.5 text-primary" />{t("organizer.league.reviewsCount", { count: community?.reviewCount ?? 0 })} <MessageCircle className="ml-0.5 h-2.5 w-2.5 text-primary" />{t("organizer.league.commentsCount", { count: community?.commentCount ?? 0 })}</span>
                              </div>
                            </>
                          ) : <p className="mt-1 text-xs text-muted-foreground">Assign an event and map its competitive races.</p>}
                        </div>
                      </div>
                      <div className="col-start-2 sm:col-start-auto">
                        {round ? <Link to={`/organizer/events/${round.eventEditionId}?tab=races`} className="inline-flex h-8 items-center gap-1 rounded-full bg-primary/10 px-2.5 text-[10px] font-semibold text-primary hover:bg-primary/15">Open race <ArrowRight className="h-3 w-3" /></Link> : <Button variant="secondary" size="sm" className="h-8 rounded-full px-2.5 text-[10px]" onClick={() => handleTabChange("rounds")}>Assign race</Button>}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </ScrollReveal>
        </div>
      ) : null}

      {activeTab === "rounds" ? (
        <div>
          <ScrollReveal>
            <RecreationalLeagueSchedulePanel season={season} onSaved={refreshSeason} />
          </ScrollReveal>
          <ScrollReveal>
            <LeagueRoundManager
              season={season}
              events={events}
              eventsErrorMessage={eventsQuery.error ? formatOrganizerLeagueApiError(eventsQuery.error) : null}
              onSaved={refreshSeason}
              onEditCategories={() => handleTabChange("categories")}
            />
          </ScrollReveal>
        </div>
      ) : null}

      {activeTab === "categories" ? (
        <ScrollReveal>
          <section className={`${ORGANIZER_EDITOR_PANEL_CLASS} p-4`} aria-labelledby="race-categories-title">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Competition setup</div>
                <h2 id="race-categories-title" className="mt-1 font-display text-lg font-bold">{t("organizer.league.competition.settingsTitle")}</h2>
              </div>
              <span className="text-xs text-muted-foreground">{t("organizer.league.competition.settingsHelp")}</span>
            </div>
            <LeagueCompetitionWorkspace season={season} events={events} section="categories" onSaved={refreshSeason} />
          </section>
        </ScrollReveal>
      ) : null}

      {activeTab === "review" ? (
        <div className="space-y-6">
          <ScrollReveal>
            <section className={`${ORGANIZER_EDITOR_PANEL_CLASS} p-4`} aria-labelledby="season-rules-title">
              <div className="mb-4">
                <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Rules</div>
                <h2 id="season-rules-title" className="mt-1 font-display text-lg font-bold">Season rules</h2>
              </div>

              <div className={`${ORGANIZER_EDITOR_SUBPANEL_CLASS} mb-5 p-4`}>
                <label className="block space-y-2" htmlFor="league-organizer-rules">
                  <span className="text-sm font-semibold text-foreground">Organizer rules</span>
                  <textarea
                    id="league-organizer-rules"
                    aria-label="Organizer rules"
                    value={organizerRulesDraft}
                    onChange={(event) => setOrganizerRulesDraft(event.target.value)}
                    className="min-h-44 w-full rounded-xl border border-border bg-card px-4 py-3 text-sm leading-6 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                    placeholder="Publish participation rules, scoring clarifications, conduct, safety requirements, and organizer decisions."
                  />
                  <span className="block text-xs leading-5 text-muted-foreground">
                    These rules appear above the scoring rules on the league's public Rules page.
                  </span>
                </label>
                <Button
                  className="mt-3"
                  disabled={savingOrganizerRules || publishBlockers.length > 0}
                  onClick={handleSaveOrganizerRules}
                >
                  {savingOrganizerRules ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save &amp; publish rules
                </Button>
                {publishBlockers.length > 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Resolve the publication blockers below before publishing rule changes.
                  </p>
                ) : null}
              </div>

              <LeagueCompetitionWorkspace season={season} section="operations" onSaved={refreshSeason} />
            </section>
          </ScrollReveal>
          <ScrollReveal>
            <div className={`${ORGANIZER_EDITOR_PANEL_CLASS} p-5`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Rules publication
                  </div>
                  <h2 className="mt-1 font-display text-lg font-bold">Season readiness</h2>
                  {publishReadiness ? (
                    <p className="mt-2 text-sm text-muted-foreground">{publishReadiness.detail}</p>
                  ) : null}
                </div>
                {!season.isPublic ? (
                  <Button
                    className="bg-trail-amber/10 text-trail-amber hover:bg-trail-amber/15"
                    disabled={publishBlockers.length > 0}
                    onClick={handlePublish}
                  >
                    Publish Season
                  </Button>
                ) : null}
              </div>

              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <div className={`${ORGANIZER_EDITOR_SUBPANEL_CLASS} p-4`}>
                  <div className="mb-3 flex items-center gap-2">
                    {publishBlockers.length === 0 ? (
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    ) : (
                      <CircleDashed className="h-4 w-4 text-trail-amber" />
                    )}
                    <div className="text-sm font-semibold">Publish blockers</div>
                  </div>
                  {publishBlockers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No blockers.</p>
                  ) : (
                    <div className="space-y-2">
                      {publishBlockers.map((blocker) => (
                        <div key={blocker} className="rounded-xl border border-trail-amber/30 bg-trail-amber/5 px-3 py-2 text-sm text-muted-foreground">
                          {blocker}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className={`${ORGANIZER_EDITOR_SUBPANEL_CLASS} p-4`}>
                  <div className="mb-3 flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-primary" />
                    <div className="text-sm font-semibold">Warnings</div>
                  </div>
                  {publishWarnings.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No warnings.</p>
                  ) : (
                    <div className="space-y-2">
                      {publishWarnings.map((warning) => (
                        <div key={warning} className="rounded-xl border border-border bg-background/70 px-3 py-2 text-sm text-muted-foreground">
                          {warning}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </ScrollReveal>

        </div>
      ) : null}
    </div>
  );
}
