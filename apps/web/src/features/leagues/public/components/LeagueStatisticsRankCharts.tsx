import { useId, useMemo, useState } from "react";
import type {
  PublicLeagueClassificationDefinition,
  PublicLeagueCompetitionReadModel,
  PublicLeagueDetailReadModel,
  PublicLeagueStandingItem,
} from "@/lib/league-read-models";
import { matchesLeagueClassification } from "../model/leaguePublicModel";
import { buildLeagueCompetitionScope, buildLeagueInsights } from "../model/leagueInsights";
import { LeagueRankRace } from "./LeagueInsightVisuals";
import { useI18n } from "@/shared/i18n/I18nContext";
import { localizedLeagueDataLabel } from "@/features/leagues/public/model/leagueLocale";

type RankCategory = {
  id: string;
  label: string;
  classification: PublicLeagueClassificationDefinition | null;
};

function isOverallClassification(classification: PublicLeagueClassificationDefinition) {
  const eligibility = classification.eligibility;
  const hasEligibility = eligibility.gender != null
    || eligibility.minimumAge != null
    || eligibility.maximumAge != null;
  const normalizedLabel = `${classification.slug} ${classification.name}`.trim().toLowerCase();
  return !hasEligibility && (
    classification.isDefault
    || /(^|\s)(overall|open|all athletes)(\s|$)/.test(normalizedLabel)
  );
}

function rankCategories(competition: PublicLeagueCompetitionReadModel): RankCategory[] {
  return [
    { id: "overall", label: "Overall", classification: null },
    ...competition.classifications
      .filter((classification) => !isOverallClassification(classification))
      .sort((left, right) => left.displayOrder - right.displayOrder)
      .map((classification) => ({
        id: `classification:${classification.slug}`,
        label: classification.name,
        classification,
      })),
  ];
}

function categoryStandings(
  competition: PublicLeagueCompetitionReadModel,
  category: RankCategory,
): PublicLeagueStandingItem[] {
  if (!category.classification) return competition.individualStandings;
  const published = competition.classificationStandings[category.classification.slug];
  if (published) return published;
  return competition.individualStandings.filter((standing) => (
    matchesLeagueClassification(standing, category.classification!.eligibility)
  ));
}

function buildCategoryInsights(
  league: PublicLeagueDetailReadModel,
  competition: PublicLeagueCompetitionReadModel,
  category: RankCategory,
) {
  const competitionScope = buildLeagueCompetitionScope(league, competition);
  const standings = categoryStandings(competition, category);
  const entries = competitionScope.entries.filter((entry) => (
    !category.classification || matchesLeagueClassification(entry, category.classification.eligibility)
  ));
  const insights = buildLeagueInsights({
    ...league,
    rounds: competitionScope.rounds,
    entries,
    individualStandings: standings,
    clubStandings: [],
    rules: competition.rules,
  }, {
    useEntryCounts: competitionScope.usesMappedCategories,
    standingsMode: competition.standingsMode,
    topHistoryBasis: "published",
  });

  const rankedCount = standings.filter((standing) => {
    if (competition.standingsMode === "best_time") {
      return typeof standing.bestTimeMs === "number" && standing.bestTimeMs > 0;
    }
    if (competition.standingsMode === "participation") return standing.races > 0;
    if (competition.standingsMode === "none") return false;
    return standing.points > 0;
  }).length;

  return {
    insights,
    rankedCount,
  };
}

function pendingMessageKey(standingsMode: PublicLeagueCompetitionReadModel["standingsMode"]) {
  if (standingsMode === "best_time") return "league.stats.categoryPendingBestTime";
  if (standingsMode === "participation") return "league.stats.categoryPendingParticipation";
  if (standingsMode === "none") return "league.stats.categoryPendingDisabled";
  return "league.stats.categoryPending";
}

function LeagueStatisticsRankChart({
  league,
  competition,
  accentIndex,
}: {
  league: PublicLeagueDetailReadModel;
  competition: PublicLeagueCompetitionReadModel;
  accentIndex: number;
}) {
  const { locale, t } = useI18n();
  const id = useId();
  const categories = useMemo(() => rankCategories(competition), [competition]);
  const [categoryId, setCategoryId] = useState("overall");
  const [selectedByCategory, setSelectedByCategory] = useState<Record<string, string>>({});
  const activeCategory = categories.find((category) => category.id === categoryId) ?? categories[0]!;
  const { insights, rankedCount } = useMemo(
    () => buildCategoryInsights(league, competition, activeCategory),
    [activeCategory, competition, league],
  );
  const selectedSlug = selectedByCategory[activeCategory.id] ?? "";
  const activeSelectedSlug = insights.history.some((series) => series.athleteSlug === selectedSlug)
    ? selectedSlug
    : "";
  const headingId = `${id}-${competition.id}-statistics-rank-title`;
  const accentClassName = accentIndex % 2 === 0 ? "text-primary" : "text-trail-green";
  const competitionName = localizedLeagueDataLabel(competition.name, locale);
  const categoryLabel = localizedLeagueDataLabel(activeCategory.label, locale);
  const metric = competition.standingsMode === "none" ? "rank" : competition.standingsMode;

  return (
    <figure
      className="min-w-0 overflow-hidden rounded-[28px] border border-border bg-card shadow-soft"
      aria-labelledby={headingId}
    >
      <figcaption className="border-b border-border/70 px-5 py-5 sm:px-7">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className={`text-[10px] font-bold uppercase tracking-[0.18em] ${accentClassName}`}>
              {t("league.stats.topProgression", { competition: competitionName })}
            </div>
            <h3 id={headingId} className="mt-1 font-display text-xl font-black">
              {t(metric === "best_time" ? "league.stats.bestTimeByRound" : metric === "participation" ? "league.stats.participationByRound" : "league.stats.pointsByRound", { course: competitionName })}
            </h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t(rankedCount === 1 ? "league.stats.categoryRanked" : "league.stats.categoryRankedPlural", {
                category: categoryLabel,
                count: rankedCount,
              })}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t(metric === "best_time" ? "league.stats.bestTimeMethod" : metric === "participation" ? "league.stats.participationMethod" : competition.rules.bestN > 0 ? "league.stats.pointsMethod" : "league.stats.allPointsMethod", { count: competition.rules.bestN })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-[0.62rem] font-black uppercase tracking-[0.1em] text-muted-foreground" aria-label={t("league.rank.chartLegend", { course: competitionName })}>
            <span className="inline-flex items-center gap-2"><span className="w-8 border-t-2 border-[hsl(var(--trail-green))]" />{t("league.stats.published")}</span>
            {competition.standingsMode === "points" ? (
              <>
                <span className="inline-flex items-center gap-2"><span className="w-8 border-t-2 border-dashed border-muted-foreground" />{t("league.rank.projected")}</span>
                <span>{t("league.stats.best", { count: insights.bestN })}</span>
              </>
            ) : null}
          </div>
        </div>

        <div
          className="mt-4 flex max-w-full gap-1.5 overflow-x-auto rounded-2xl border border-border/80 bg-background/65 p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible"
          role="group"
          aria-label={`${competition.name} rank category`}
        >
          {categories.map((category) => {
            const active = category.id === activeCategory.id;
            return (
              <button
                key={category.id}
                type="button"
                aria-pressed={active}
                onClick={() => setCategoryId(category.id)}
                className={`min-h-9 shrink-0 rounded-xl px-3 text-[11px] font-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  active
                    ? "bg-foreground text-background shadow-sm"
                    : "text-muted-foreground hover:bg-card hover:text-foreground"
                }`}
              >
                {localizedLeagueDataLabel(category.label, locale)}
              </button>
            );
          })}
        </div>
      </figcaption>

      {insights.history.length ? (
        <div className="p-5 pt-1 sm:p-7 sm:pt-1" key={activeCategory.id}>
          <LeagueRankRace
            history={insights.history}
            rounds={insights.rounds}
            takeover={insights.takeover}
            selectedSlug={activeSelectedSlug}
            onSelectedSlugChange={(slug) => setSelectedByCategory((current) => ({
              ...current,
              [activeCategory.id]: slug,
            }))}
            expandedChart
            metric={metric}
          />
        </div>
      ) : (
        <div className="m-5 rounded-2xl border border-dashed border-border bg-muted/15 px-5 py-10 text-center text-sm text-muted-foreground sm:m-7">
          {t(pendingMessageKey(competition.standingsMode), { category: categoryLabel })}
        </div>
      )}
    </figure>
  );
}

export function LeagueStatisticsRankCharts({ league }: { league: PublicLeagueDetailReadModel }) {
  const { t } = useI18n();
  const competitions = useMemo(() => league.competitions
    .filter((competition) => competition.scoringTarget === "individual")
    .sort((left, right) => left.displayOrder - right.displayOrder), [league.competitions]);

  if (!competitions.length) {
    return (
      <div className="rounded-[28px] border border-dashed border-border bg-muted/15 px-5 py-10 text-center text-sm text-muted-foreground">
        {t("league.stats.rankPendingAll")}
      </div>
    );
  }

  return (
    <section className="space-y-6" aria-label={t("league.stats.shortLongRank")}>
      {competitions.map((competition, index) => (
        <LeagueStatisticsRankChart
          key={competition.id}
          league={league}
          competition={competition}
          accentIndex={index}
        />
      ))}
    </section>
  );
}
