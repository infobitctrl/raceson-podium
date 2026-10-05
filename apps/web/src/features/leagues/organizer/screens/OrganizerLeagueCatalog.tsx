import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Building2,
  Calendar,
  Loader2,
  Route,
  Trash2,
  Trophy,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  LeagueSeasonDialog,
  LeagueVisibilityBadge,
} from "@/components/organizer/league/LeagueWorkspaceShared";
import {
  buildLeaguePlanningFromSource,
  getLeagueClubScoringStructureLabel,
} from "@/components/organizer/league/leaguePlanning";
import {
  formatOrganizerLeagueApiError,
  getLeaguePublishReadiness,
  getLeagueSeasonStatusMeta,
  getLeagueUniqueEventCount,
} from "@/components/organizer/league/leagueWorkspaceMeta";
import ScrollReveal from "@/components/shared/ScrollReveal";
import { summarizeLeagueDescription } from "@/features/leagues/model/leagueDescription";
import { resolveLeagueImageUrl } from "@/features/leagues/model/leagueMedia";
import { buildLeagueSeasonDateRange } from "@/features/leagues/model/leagueSeasonDateRange";
import {
  getSibenikTrailLeagueDisplayName,
  getSibenikTrailLeagueEnglishCopy,
  getSibenikTrailLeagueLocalName,
} from "@/features/leagues/model/sibenikTrailLeagueIdentity";
import {
  deleteOrganizerLeague,
  getOrganizerLeagueSeasons,
  publishOrganizerLeagueSeason,
  type OrganizerManagedLeagueSeason,
} from "@/lib/organizer-management";
import { useOrganizerAuth } from "@/lib/organizer-workspace";
import { MobileDetailDisclosure } from "@/shared/mobile/MobileDetailDisclosure";
import { useI18n } from "@/shared/i18n/I18nContext";

const leagueWorkflowSteps = [
  { step: 1, title: "League setup", note: "Identity, main image, and public summary." },
  { step: 2, title: "Competitions", note: "Scoring systems and athlete categories." },
  { step: 3, title: "Rounds", note: "Races and mapped races." },
  { step: 4, title: "Publish", note: "Review the season and make it public." },
];

function LeagueSeasonCard({
  season,
  publishing,
  deleting,
  onPublish,
  onDelete,
  organizationName,
}: {
  season: OrganizerManagedLeagueSeason;
  publishing: boolean;
  deleting: boolean;
  onPublish: () => void;
  onDelete: () => void;
  organizationName: string;
}) {
  const { formatDate, locale, localeTag, t } = useI18n();
  const planning = buildLeaguePlanningFromSource({
    description: season.description,
    scoringRules: season.scoringRules,
    clubScoringScope: season.clubScoringScope,
  });
  const seasonStatus = getLeagueSeasonStatusMeta(season.seasonStatus, season.isPublic, locale);
  const displayName = getSibenikTrailLeagueDisplayName(season.name, season.slug);
  const localName = getSibenikTrailLeagueLocalName(season.name, season.slug);
  const readiness = getLeaguePublishReadiness(season, locale, localeTag);
  const individualCompetitions = (season.competitions ?? []).filter(
    (competition) => competition.scoringTarget === "individual" && competition.status !== "archived",
  );
  const plannedRounds = Number.parseInt(planning.plannedRoundCount, 10) || season.rounds.length;
  const seasonDateRange = buildLeagueSeasonDateRange(
    season.rounds.map((round) => ({ roundNumber: round.roundNumber, dateIso: round.eventDate })),
    plannedRounds,
    localeTag,
    locale === "hr" ? "Naknadno" : "TBA",
  );
  const leagueImageUrl = resolveLeagueImageUrl(season.description, planning.imageUrl);

  const canPublish = !season.isPublic && readiness.canPublish;

  return (
    <div
      className="group grid grid-cols-[54px_minmax(0,1fr)] gap-2.5 rounded-xl sm:grid-cols-[62px_minmax(0,1fr)]"
      data-testid="organizer-league-row"
    >
      <div className="flex min-h-[126px] flex-col overflow-hidden rounded-xl border border-border bg-muted/45 text-center shadow-soft">
        <div className="bg-primary/10 px-1 py-1.5 text-[8px] font-bold uppercase tracking-[0.2em] text-primary">Season</div>
        <div className="flex flex-1 flex-col items-center justify-center px-1 py-2">
          <Trophy className="mb-2 h-5 w-5 text-primary" />
          <span className="font-display text-lg font-black leading-none">{season.year}</span>
        </div>
      </div>

      <article className="overflow-hidden rounded-xl border border-border bg-background/60 shadow-soft transition-all group-hover:-translate-y-0.5 group-hover:border-primary/30 group-hover:shadow-md">
        <div className="grid min-h-[126px] sm:grid-cols-[116px_minmax(0,1fr)]">
          <div className="h-28 overflow-hidden bg-muted/40 sm:h-full">
            <img src={leagueImageUrl} alt={locale === "hr" ? `Sličica lige ${displayName}` : `${displayName} thumbnail`} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.035]" />
          </div>

          <div className="flex min-w-0 flex-col p-3">
            <div className="flex min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Link
                to={`/organizer/leagues/${season.seasonId}`}
                className="rounded-sm font-display text-base font-bold leading-tight transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {displayName}
              </Link>
              <span data-locale-fit="pill" className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider ${seasonStatus.className}`}>
                {seasonStatus.label}
              </span>
              <LeagueVisibilityBadge isPublic={season.isPublic} />
              {!season.isPublic ? (
                <span data-locale-fit="pill" className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider ${readiness.className}`}>
                  {readiness.label}
                </span>
              ) : null}
            </div>

            {localName ? (
              <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                {localName}
              </div>
            ) : null}

            <p className="mt-1.5 line-clamp-1 max-w-3xl text-xs leading-5 text-muted-foreground">
              {locale === "hr"
                ? summarizeLeagueDescription(season.description, "Dodajte kratak javni sažetak sezone.")
                : getSibenikTrailLeagueEnglishCopy(
                    summarizeLeagueDescription(season.description, "Add a brief public season summary."),
                    season.name,
                    season.slug,
                  )}
            </p>

            <div className="mt-2 flex flex-wrap gap-1.5">
              <span data-locale-fit="pill" className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/45 px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
                <Calendar className="h-3 w-3 text-primary" />{seasonDateRange}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/45 px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
                <Route className="h-3 w-3 text-primary" />{t("organizer.league.roundsLinked", { linked: season.rounds.length, total: plannedRounds })}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/45 px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
                <Trophy className="h-3 w-3 text-primary" />{getLeagueClubScoringStructureLabel(planning.clubScoringMode, planning.clubScoringScope)}
              </span>
              <span data-locale-fit="pill" className="inline-flex items-center rounded-full border border-border/70 bg-muted/45 px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
                {season.publishedAt
                  ? t("organizer.league.publishedDate", { date: formatDate(season.publishedAt, { dateStyle: "medium" }) })
                  : "Private draft"}
              </span>
              {!season.isPublic ? (
                <span className="inline-flex items-center rounded-full border border-trail-amber/30 bg-trail-amber/[0.07] px-2.5 py-1 text-[10px] font-semibold text-trail-amber">
                  {readiness.canPublish
                    ? (locale === "hr" ? "Spremno — objavite gumbom na ovoj kartici" : "Ready — publish with the button on this card")
                    : (locale === "hr" ? "Prije objave riješite prepreke u postavkama" : "Resolve setup blockers before Publish")}
                </span>
              ) : null}
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/45 px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
                <Building2 className="h-3 w-3 text-primary" />Organizer: {organizationName}
              </span>
              {individualCompetitions.length > 0 ? individualCompetitions.map((competition) => {
                const rules = competition.scoringRules;
                const standingsLabel = competition.standingsMode === "best_time"
                  ? (locale === "hr" ? "Najbolje vrijeme" : "Best time")
                  : competition.standingsMode === "participation"
                    ? (locale === "hr" ? "Sudjelovanje" : "Participation")
                    : competition.standingsMode === "none"
                      ? (locale === "hr" ? "Samo rezultati" : "Results only")
                      : rules?.bestN ? t("organizer.league.bestCount", { count: rules.bestN }) : (locale === "hr" ? "Sva kola" : "All rounds");
                return (
                  <span key={competition.id} className="inline-flex min-h-8 items-center rounded-full border border-primary/20 bg-primary/[0.055] px-3 py-1 text-[10px] font-semibold text-foreground">
                    <span className="text-primary">{competition.name}</span>
                    <span className="mx-1.5 text-muted-foreground">·</span>
                    {standingsLabel}
                    <span className="mx-1.5 text-muted-foreground">·</span>
                    {locale === "hr"
                      ? `${competition.classifications.length} ${competition.classifications.length === 1 ? "kategorija natjecatelja" : "kategorije natjecatelja"}`
                      : `${competition.classifications.length} athlete ${competition.classifications.length === 1 ? "category" : "categories"}`}
                  </span>
                );
              }) : (
                <span className="inline-flex min-h-8 items-center rounded-full border border-dashed border-border px-3 py-1 text-[10px] font-semibold text-muted-foreground">
                  Competition setup required
                </span>
              )}
            </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-border/60 pt-2 lg:border-0 lg:pt-0">
                {!season.isPublic ? (
                  <button
                    type="button"
                    onClick={onPublish}
                    disabled={!canPublish || publishing || deleting}
                    aria-label={locale === "hr" ? `Objavi ${displayName}` : `Publish ${displayName}`}
                    title={canPublish ? (locale === "hr" ? `Objavi ${displayName}` : `Publish ${displayName}`) : readiness.detail}
                    className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1 rounded-lg bg-trail-amber/10 px-3 text-xs font-semibold text-trail-amber transition-colors hover:bg-trail-amber/15 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {publishing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    {publishing ? (locale === "hr" ? "Objavljivanje" : "Publishing") : "Publish"}
                  </button>
                ) : null}
                <Link
                  to={`/organizer/leagues/${season.seasonId}`}
                  aria-label={locale === "hr" ? `Otvori ${displayName}` : `Open ${displayName}`}
                  className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  Open <ArrowRight className="h-3 w-3" />
                </Link>
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={publishing || deleting}
                  aria-label={locale === "hr" ? `Izbriši ${displayName}` : `Delete ${displayName}`}
                  className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}

export default function OrganizerLeagueCatalog() {
  const { locale, t } = useI18n();
  const navigate = useNavigate();
  const { account, user } = useOrganizerAuth();
  const [publishingSeasonId, setPublishingSeasonId] = useState<string | null>(null);
  const [deletingLeagueId, setDeletingLeagueId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["organizer-league-seasons", account?.organizationIds[0] ?? "no-org"],
    queryFn: () => getOrganizerLeagueSeasons(account),
    enabled: Boolean(account?.hasOrganizerAccess),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const seasons = query.data ?? [];
  const privateCount = seasons.filter((season) => !season.isPublic).length;
  const totalEventRounds = seasons.reduce((sum, season) => sum + getLeagueUniqueEventCount(season), 0);
  const organizationName = account?.organizationNames[0] ?? "Organization";

  async function refresh() {
    await query.refetch();
  }

  async function handleCreated(savedSeason?: OrganizerManagedLeagueSeason | null) {
    if (savedSeason) navigate(`/organizer/leagues/${savedSeason.seasonId}`);
    void refresh();
  }

  async function handlePublish(season: OrganizerManagedLeagueSeason) {
    if (!account || season.isPublic) return;

    setPublishingSeasonId(season.seasonId);
    try {
      await publishOrganizerLeagueSeason(account, season.seasonId);
      await refresh();
      toast.success("League season published to the public website.");
    } catch (error) {
      toast.error(formatOrganizerLeagueApiError(error));
    } finally {
      setPublishingSeasonId(null);
    }
  }

  async function handleDelete(season: OrganizerManagedLeagueSeason) {
    if (!account) return;
    const displayName = getSibenikTrailLeagueDisplayName(season.name, season.slug);
    if (!window.confirm(t("organizer.league.deleteConfirm", { name: displayName }))) return;

    setDeletingLeagueId(season.leagueId);
    try {
      await deleteOrganizerLeague(account, season.leagueId);
      await refresh();
      toast.success("League deleted.");
    } catch (error) {
      toast.error(formatOrganizerLeagueApiError(error));
    } finally {
      setDeletingLeagueId(null);
    }
  }

  if (!user || !account?.hasOrganizerAccess) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center p-6 text-center">
        <p className="text-muted-foreground">Sign in with an organizer account to manage leagues.</p>
        <Link to="/auth" className="mt-4 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">
          Sign In
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      <ScrollReveal>
        <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row [&>button]:min-h-11 [&>button]:shrink-0">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">Leagues</h1>
            <p className="mt-1 text-sm text-muted-foreground">Manage league setup, scoring, rounds, and publishing for {organizationName}.</p>
          </div>
          <LeagueSeasonDialog onSaved={handleCreated} />
        </div>
      </ScrollReveal>

      <ScrollReveal delay={0.05}>
        <section className="mb-5 rounded-xl border border-border bg-card px-4 py-3 shadow-soft" aria-labelledby="league-workspace-title">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border/70 pb-2.5">
            <h2 id="league-workspace-title" className="font-display text-sm font-bold">League workspace</h2>
            <p className="text-xs text-muted-foreground">Organizer: {organizationName} · Season → competition → round → standings</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-2.5 pt-2.5 lg:grid-cols-4">
            <div className="flex items-baseline justify-between gap-3"><dt className="text-xs font-medium text-muted-foreground">Seasons</dt><dd className="font-display text-xl font-bold text-primary">{seasons.length}</dd></div>
            <div className="flex items-baseline justify-between gap-3"><dt className="text-xs font-medium text-muted-foreground">Public</dt><dd className="font-display text-xl font-bold">{seasons.length - privateCount}</dd></div>
            <div className="flex items-baseline justify-between gap-3"><dt className="text-xs font-medium text-muted-foreground">Private</dt><dd className="font-display text-xl font-bold">{privateCount}</dd></div>
            <div className="flex items-baseline justify-between gap-3"><dt className="text-xs font-medium text-muted-foreground">Linked races</dt><dd className="font-display text-xl font-bold">{totalEventRounds}</dd></div>
          </dl>
        </section>
      </ScrollReveal>

      <ScrollReveal delay={0.08}>
        <MobileDetailDisclosure
          title="League workflow"
          summary={`${leagueWorkflowSteps.length} setup-to-standings steps`}
          icon={Trophy}
          className="mb-5"
        >
          <ol className="divide-y divide-border/70">
            {leagueWorkflowSteps.map((item) => (
              <li key={item.step} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                <span className="font-display text-xs font-bold text-primary">0{item.step}</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{item.title}</h3>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{item.note}</p>
                </div>
              </li>
            ))}
          </ol>
        </MobileDetailDisclosure>
        <section className="mb-5 hidden rounded-xl border border-border bg-card px-4 py-3 shadow-soft lg:block" aria-labelledby="league-workflow-title">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border/70 pb-2.5">
            <h2 id="league-workflow-title" className="font-display text-sm font-bold">League workflow</h2>
            <p className="text-xs text-muted-foreground">Setup to published standings</p>
          </div>
          <ol className="grid divide-y divide-border/70 xl:grid-cols-4 xl:divide-x xl:divide-y-0">
            {leagueWorkflowSteps.map((item) => (
              <li key={item.step} className="flex gap-2.5 py-2.5 xl:px-3 xl:first:pl-0 xl:last:pr-0">
                <span className="font-display text-xs font-bold text-primary">0{item.step}</span>
                <div className="min-w-0"><h3 className="text-xs font-semibold">{item.title}</h3><p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{item.note}</p></div>
              </li>
            ))}
          </ol>
        </section>
      </ScrollReveal>

      <ScrollReveal delay={0.12}>
        <section className="rounded-2xl border border-border bg-card p-5 shadow-soft" aria-labelledby="saved-leagues-title">
          <div className="mb-4">
            <h2 id="saved-leagues-title" className="font-display text-lg font-bold">Saved leagues</h2>
            <p className="mt-1 text-sm text-muted-foreground">Open a season to manage competition rules, rounds, and publishing.</p>
          </div>

      {query.isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : query.error ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
          <Trophy className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <p className="mt-4 text-muted-foreground">{formatOrganizerLeagueApiError(query.error)}</p>
        </div>
      ) : seasons.length === 0 ? (
        <div className="rounded-[26px] border border-dashed border-border bg-card p-12 text-center">
          <Trophy className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <h2 className="mt-4 font-display text-xl font-bold">Create your first league season</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
            Start with identity and scoring. Race editions and race mappings come after the private season shell exists.
          </p>
          <div className="mt-6 inline-flex"><LeagueSeasonDialog onSaved={handleCreated} /></div>
        </div>
      ) : (
        <div className="space-y-2">
          {seasons.map((season) => (
            <LeagueSeasonCard
              key={season.seasonId}
              season={season}
              publishing={publishingSeasonId === season.seasonId}
              deleting={deletingLeagueId === season.leagueId}
              onPublish={() => void handlePublish(season)}
              onDelete={() => void handleDelete(season)}
              organizationName={organizationName}
            />
          ))}
        </div>
      )}
        </section>
      </ScrollReveal>
    </div>
  );
}
