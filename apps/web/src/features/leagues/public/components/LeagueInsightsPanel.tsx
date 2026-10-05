import { useMemo, useState } from "react";
import {
  CalendarClock,
  Repeat2,
  TrendingUp,
  Users,
} from "lucide-react";
import type { PublicLeagueDetailReadModel } from "@/lib/league-read-models";
import { buildLeagueInsights } from "../model/leagueInsights";
import {
  AgeShape,
  AthleteParticipationBars,
  ClubRegistrationBars,
  CompetitionParticipationDonut,
  CountryRing,
  CourseAgeRings,
  GenderRing,
  LeagueRankRace,
} from "./LeagueInsightVisuals";
import { LeagueStatisticsRankCharts } from "./LeagueStatisticsRankCharts";
import { LeagueRegistrationCharts } from "./LeagueRegistrationCharts";
import { useI18n } from "@/shared/i18n/I18nContext";
import {
  buildLeagueCompetitionParticipation,
  buildLeagueRegistrationRounds,
} from "../model/leagueRegistrationCharts";

function formatPublishedAt(
  value: string | null,
  localeTag: string,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (!value) return t("league.stats.waitingFirstResult");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("league.stats.latestAvailable");
  return t("league.stats.updated", { date: new Intl.DateTimeFormat(localeTag, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date) });
}

export function LeagueInsightsPanel({ league }: { league: PublicLeagueDetailReadModel }) {
  const { localeTag, t } = useI18n();
  const insights = useMemo(
    () => buildLeagueInsights(league, { useEntryCounts: true, topHistoryBasis: "published" }),
    [league],
  );
  const registrationRounds = useMemo(() => buildLeagueRegistrationRounds(league), [league]);
  const competitionParticipation = useMemo(() => buildLeagueCompetitionParticipation(league), [league]);
  const [selectedClubSlug, setSelectedClubSlug] = useState("");
  const activeClubSlug = insights.clubHistory.some((series) => series.athleteSlug === selectedClubSlug)
    ? selectedClubSlug
    : "";
  const storyTitle = insights.takeover
    ? t("league.stats.leadChanged", { round: insights.takeover.roundNumber })
    : insights.currentLeader
      ? t("league.stats.currentLeagueLeader")
      : t("league.stats.notPublished");
  const facts = [
    {
      icon: Repeat2,
      value: t(insights.leadChanges === 1 ? "league.stats.leadChanges" : "league.stats.leadChangesPlural", { count: insights.leadChanges }),
      detail: insights.takeover
        ? t("league.stats.tookOver", { name: insights.takeover.currentLeaderName, round: insights.takeover.roundNumber })
        : t("league.stats.stableLead"),
    },
    {
      icon: Users,
      value: t(insights.returningAthletes === 1 ? "league.stats.returningAthlete" : "league.stats.returningAthletes", { count: insights.returningAthletes }),
      detail: t("league.stats.returningRate", { rate: insights.returningRate, athletes: insights.demographics.athletes }),
    },
    {
      icon: TrendingUp,
      value: insights.biggestMover
        ? t("league.stats.gainedPlaces", { name: insights.biggestMover.name, places: insights.biggestMover.places })
        : t("league.stats.rankPending"),
      detail: insights.biggestMover
        ? t("league.stats.betweenRounds", { from: insights.biggestMover.fromRound, to: insights.biggestMover.toRound })
        : t("league.stats.twoRoundsNeeded"),
    },
  ];

  return (
    <div id="statistics" className="space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/80 bg-card px-4 py-3 shadow-soft" aria-label={t("league.stats.controls")}>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">{t("league.stats.controls")}</div>
          <p className="mt-0.5 text-xs font-bold text-muted-foreground">{league.name}</p>
        </div>
        <span className="inline-flex min-h-9 items-center gap-2 rounded-full bg-[hsl(var(--trail-green))]/10 px-3.5 text-[0.62rem] font-black uppercase tracking-[0.08em] text-[hsl(var(--trail-forest))]"><span className="h-2 w-2 rounded-full bg-[hsl(var(--trail-green))]" />{t("league.stats.roundsOfficial", { published: insights.publishedRounds, total: league.rounds.length })}</span>
      </section>

      <LeagueRegistrationCharts rounds={registrationRounds} />

      <section className="grid gap-5 rounded-[28px] border border-border bg-card p-5 shadow-soft sm:p-6 lg:grid-cols-[minmax(14rem,0.78fr)_minmax(0,1.42fr)] lg:items-center" aria-labelledby="league-statistics-title">
          <div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">{t("league.stats.seasonStandings")}</div>
              <h2 id="league-statistics-title" className="mt-1 font-display text-xl font-black uppercase leading-tight tracking-[-0.02em] sm:text-2xl">{storyTitle}</h2>
            </div>
            {insights.currentLeader ? <div className="mt-4 inline-flex items-baseline gap-2 rounded-full bg-primary/[0.08] px-3 py-1.5"><span className="text-[0.58rem] font-black uppercase tracking-[0.12em] text-muted-foreground">{t("league.stats.currentLeader")}</span><span className="font-display text-sm font-black">{insights.currentLeader.name}</span></div> : null}
          </div>
          <div className="grid gap-2.5 sm:grid-cols-3">
            {facts.map(({ icon: Icon, value, detail }) => (
              <article key={value} className="grid min-h-[5.4rem] grid-cols-[1.7rem_minmax(0,1fr)] items-start gap-2.5 rounded-2xl border border-border/75 bg-background/55 p-3.5">
                <Icon className="mt-0.5 h-5 w-5 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
                <div><p className="font-display text-sm font-black leading-tight">{value}</p><p className="mt-1 text-[0.65rem] leading-4 text-muted-foreground">{detail}</p></div>
              </article>
            ))}
          </div>
      </section>

      <LeagueStatisticsRankCharts league={league} />

      <figure className="min-w-0 rounded-[28px] border border-border bg-card p-5 shadow-soft sm:p-7" aria-labelledby="league-club-rank-race-title">
        <figcaption className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">{t("league.stats.clubCombined")}</div>
            <h3 id="league-club-rank-race-title" className="mt-1 font-display text-xl font-black">{t("league.stats.clubRank")}</h3>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-[0.62rem] font-black uppercase tracking-[0.1em] text-muted-foreground" aria-label={t("league.stats.clubLegend")}>
            <span className="inline-flex items-center gap-2"><span className="w-8 border-t-2 border-[hsl(var(--trail-green))]" />{t("league.stats.published")}</span>
            <span className="inline-flex items-center gap-2"><span className="w-8 border-t-2 border-dashed border-muted-foreground" />{t("league.rank.projected")}</span>
          </div>
        </figcaption>

        {insights.clubHistory.length ? (
          <LeagueRankRace
            history={insights.clubHistory}
            rounds={insights.rounds}
            takeover={null}
            selectedSlug={activeClubSlug}
            onSelectedSlugChange={setSelectedClubSlug}
            metric="points"
          />
        ) : (
          <div className="mt-5 rounded-2xl border border-dashed border-border bg-muted/15 px-5 py-8 text-center text-sm text-muted-foreground">
            {t("league.stats.clubRankPending")}
          </div>
        )}
      </figure>

      <section className="min-w-0 rounded-[28px] border border-border bg-card p-5 shadow-soft sm:p-7" aria-labelledby="league-athlete-participation-title">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">{t("league.stats.roundParticipation")}</div>
        <h3 id="league-athlete-participation-title" className="mt-1 font-display text-xl font-black">{t("league.stats.participations")}</h3>
        <AthleteParticipationBars athletes={insights.athleteParticipation} />
      </section>

      <section className="min-w-0 rounded-[28px] border border-border bg-card p-5 shadow-soft sm:p-7" aria-labelledby="league-club-presence-title">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">{t("league.stats.clubParticipation")}</div>
        <h3 id="league-club-presence-title" className="mt-1 font-display text-xl font-black">{t(insights.clubs.length === 1 ? "league.stats.participatingClub" : "league.stats.participatingClubs", { count: insights.clubs.length })}</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("league.stats.clubRegistrationPresenceDescription")}</p>
        <ClubRegistrationBars clubs={insights.clubs} />
      </section>

      <section className="rounded-[28px] border border-border bg-card p-5 shadow-soft sm:p-7" aria-labelledby="league-participant-shape-title" data-pie-chart-section>
        <div className="max-w-3xl">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[hsl(var(--trail-green))]">{t("league.stats.participants")}</div>
          <h3 id="league-participant-shape-title" className="mt-1 font-display text-xl font-black">{t("league.stats.participantBreakdown")}</h3>
        </div>
        <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <figure className="flex min-w-0 flex-col rounded-2xl border border-border bg-background/55 p-4" aria-labelledby="league-distance-class-title">
            <figcaption id="league-distance-class-title" className="text-xs font-black uppercase tracking-[0.14em] text-muted-foreground">{t("league.stats.distanceParticipation")}</figcaption>
            <CompetitionParticipationDonut groups={competitionParticipation} />
          </figure>
          <figure className="flex min-w-0 flex-col rounded-2xl border border-border bg-background/55 p-4" aria-labelledby="league-gender-shape-title">
            <figcaption id="league-gender-shape-title" className="text-xs font-black uppercase tracking-[0.14em] text-muted-foreground">{t("league.stats.sexComposition")}</figcaption>
            {insights.demographics.gender.length ? <GenderRing groups={insights.demographics.gender} /> : <p className="mt-5 text-sm text-muted-foreground">{t("league.stats.noDemographics")}</p>}
          </figure>
          <figure className="flex min-w-0 flex-col rounded-2xl border border-border bg-background/55 p-4" aria-labelledby="league-age-shape-title">
            <figcaption id="league-age-shape-title" className="text-xs font-black uppercase tracking-[0.14em] text-muted-foreground">{t("league.stats.ageBands")}</figcaption>
            <AgeShape groups={insights.demographics.ages} />
          </figure>
          <figure className="flex min-w-0 flex-col rounded-2xl border border-border bg-background/55 p-4" aria-labelledby="league-country-shape-title">
            <figcaption id="league-country-shape-title" className="text-xs font-black uppercase tracking-[0.14em] text-muted-foreground">{t("league.stats.countryDistribution")}</figcaption>
            {insights.demographics.countries.length ? <CountryRing groups={insights.demographics.countries} /> : <p className="mt-5 text-sm text-muted-foreground">{t("league.stats.noDemographics")}</p>}
          </figure>
        </div>
        {insights.courseAgeDistributions.length ? <div className="mt-6 border-t border-border/70 pt-5"><h4 className="mb-3 font-display text-base font-black">{t("league.stats.ageByCourse")}</h4><CourseAgeRings courses={insights.courseAgeDistributions} /></div> : null}
      </section>

      <section className="flex items-start gap-3 rounded-2xl border border-border bg-muted/20 px-5 py-4 text-xs leading-5 text-muted-foreground" aria-label={t("league.stats.sourceNote")}>
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <p><strong className="text-foreground">{t("league.stats.sourceLabel")}</strong> {t("league.stats.source", {
          competition: league.name,
          bestN: insights.bestN,
          updated: formatPublishedAt(insights.latestPublishedAt, localeTag, t),
        })}</p>
      </section>
      <div className="sr-only" aria-live="polite">{t("league.stats.showing", { competition: league.name })}</div>
    </div>
  );
}
