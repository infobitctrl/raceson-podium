import { useId, useMemo, useState } from "react";
import type {
  PublicLeagueCompetitionReadModel,
  PublicLeagueDetailReadModel,
  PublicLeagueStandingItem,
} from "@/lib/league-read-models";
import { buildLeagueInsights } from "../model/leagueInsights";
import { LeagueRankRace } from "./LeagueInsightVisuals";
import { useI18n } from "@/shared/i18n/I18nContext";
import { localizedLeagueDataLabel } from "@/features/leagues/public/model/leagueLocale";

type RankGender = "M" | "F";

const COURSE_ORDER = ["short", "long"] as const;

function courseKind(competition: PublicLeagueCompetitionReadModel) {
  const label = `${competition.slug} ${competition.name}`.toLowerCase();
  return COURSE_ORDER.find((course) => label.includes(course)) ?? null;
}

function genderStandings(
  competition: PublicLeagueCompetitionReadModel,
  gender: RankGender,
): PublicLeagueStandingItem[] {
  const broadGenderClassification = competition.classifications
    .filter((classification) => (
      classification.eligibility.gender === gender
      && classification.eligibility.minimumAge == null
      && classification.eligibility.maximumAge == null
    ))
    .sort((left, right) => left.displayOrder - right.displayOrder)[0];
  const classifiedStandings = broadGenderClassification
    ? competition.classificationStandings[broadGenderClassification.slug]
    : undefined;

  return classifiedStandings?.length
    ? classifiedStandings
    : competition.individualStandings.filter((standing) => standing.gender === gender);
}

function buildCourseGenderInsight(
  league: PublicLeagueDetailReadModel,
  competition: PublicLeagueCompetitionReadModel,
  gender: RankGender,
) {
  const mappedRoundNumbers = new Set(
    competition.roundMappings.map((mapping) => mapping.roundNumber),
  );
  const mappedCategoryIds = new Set(
    competition.roundMappings.map((mapping) => mapping.eventCategoryId),
  );
  const standings = genderStandings(competition, gender);
  const rankedCount = standings.filter((standing) => {
    if (competition.standingsMode === "best_time") {
      return typeof standing.bestTimeMs === "number" && standing.bestTimeMs > 0;
    }
    if (competition.standingsMode === "participation") return standing.races > 0;
    if (competition.standingsMode === "none") return false;
    return standing.points > 0;
  }).length;
  const insights = buildLeagueInsights({
    ...league,
    rounds: mappedRoundNumbers.size
      ? league.rounds.filter((round) => mappedRoundNumbers.has(round.roundNumber))
      : league.rounds,
    entries: league.entries.filter((entry) => (
      (!mappedCategoryIds.size || mappedCategoryIds.has(entry.eventCategoryId))
      && entry.gender === gender
    )),
    individualStandings: standings,
    clubStandings: [],
    rules: competition.rules,
  }, {
    useEntryCounts: mappedCategoryIds.size > 0,
    standingsMode: competition.standingsMode,
  });

  return { insights, rankedCount };
}

export function LeagueCourseRankCharts({ league }: { league: PublicLeagueDetailReadModel }) {
  const { locale, t } = useI18n();
  const id = useId();
  const [genderByCourse, setGenderByCourse] = useState<Record<string, RankGender>>({});
  const [selectedByChart, setSelectedByChart] = useState<Record<string, string>>({});
  const courses = useMemo(() => {
    const individualCompetitions = league.competitions.filter(
      (competition) => competition.scoringTarget === "individual",
    );

    return COURSE_ORDER.flatMap((kind) => {
      const competition = individualCompetitions.find((candidate) => courseKind(candidate) === kind);
      if (!competition) return [];

      return [{
        id: competition.id,
        kind,
        name: competition.name,
        standingsMode: competition.standingsMode,
        byGender: {
          M: buildCourseGenderInsight(league, competition, "M"),
          F: buildCourseGenderInsight(league, competition, "F"),
        },
      }];
    });
  }, [league]);

  if (!courses.length) {
    return (
      <p className="mt-4 text-sm leading-6 text-muted-foreground">
        {t("league.rank.pending")}
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      {courses.map((course) => {
        const gender = genderByCourse[course.id] ?? "M";
        const chartKey = `${course.id}:${gender}`;
        const { insights, rankedCount } = course.byGender[gender];
        const selectedSlug = selectedByChart[chartKey] ?? "";
        const activeSelectedSlug = insights.history.some(
          (series) => series.athleteSlug === selectedSlug,
        ) ? selectedSlug : "";
        const headingId = `${id}-${course.kind}-rank-title`;
        const genderLabel = gender === "M" ? t("league.rank.male") : t("league.rank.female");
        const courseName = localizedLeagueDataLabel(course.name, locale);
        const courseKindLabel = course.kind === "short"
          ? t("league.rank.shortCourse")
          : t("league.rank.longCourse");
        const accentClassName = course.kind === "short" ? "text-primary" : "text-trail-green";

        return (
          <section
            key={course.id}
            className="overflow-hidden rounded-2xl border border-border/80 bg-background/55"
            aria-labelledby={headingId}
          >
            <div className="border-b border-border/70 px-3.5 py-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className={`text-[9px] font-black uppercase tracking-[0.16em] ${accentClassName}`}>
                    {courseKindLabel}
                  </div>
                  <h3 id={headingId} className="mt-0.5 font-display text-base font-black">
                    {t("league.rank.courseByRound", { course: courseName })}
                  </h3>
                </div>
                <div
                  className="inline-flex shrink-0 rounded-full border border-border bg-card p-1 shadow-sm"
                  role="group"
                  aria-label={t("league.rank.genderGroup", { course: courseName })}
                >
                  {(["M", "F"] as const).map((option) => {
                    const label = option === "M" ? t("league.rank.male") : t("league.rank.female");
                    const active = gender === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setGenderByCourse((current) => ({
                          ...current,
                          [course.id]: option,
                        }))}
                        className={`min-h-8 rounded-full px-2.5 text-[10px] font-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                          active
                            ? "bg-foreground text-background"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                <span>{t("league.rank.ranked", { gender: genderLabel, count: rankedCount })}</span>
                <span className="inline-flex items-center gap-3" aria-label={t("league.rank.chartLegend", { course: courseName })}>
                  <span className="inline-flex items-center gap-1.5"><span className="w-5 border-t-2 border-[hsl(var(--trail-green))]" />{t("league.rank.official")}</span>
                  {course.standingsMode === "points" ? (
                    <span className="inline-flex items-center gap-1.5"><span className="w-5 border-t-2 border-dashed border-muted-foreground" />{t("league.rank.projected")}</span>
                  ) : null}
                </span>
              </div>
            </div>

            {insights.history.length ? (
              <div className="px-2 pb-3" key={chartKey}>
                <LeagueRankRace
                  history={insights.history}
                  rounds={insights.rounds}
                  takeover={insights.takeover}
                  selectedSlug={activeSelectedSlug}
                  onSelectedSlugChange={(slug) => setSelectedByChart((current) => ({
                    ...current,
                    [chartKey]: slug,
                  }))}
                  showTable={false}
                  compactChart
                />
              </div>
            ) : (
              <p className="px-4 py-7 text-center text-xs leading-5 text-muted-foreground">
                {t(course.standingsMode === "best_time"
                  ? "league.rank.genderPendingBestTime"
                  : course.standingsMode === "participation"
                    ? "league.rank.genderPendingParticipation"
                    : course.standingsMode === "none"
                      ? "league.rank.genderPendingDisabled"
                      : "league.rank.genderPending", { gender: genderLabel })}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
