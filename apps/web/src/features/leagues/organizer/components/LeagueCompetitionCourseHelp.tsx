import { Link } from "react-router-dom";
import { useI18n } from "@/shared/i18n/I18nContext";
import type { OrganizerManagedLeagueSeason } from "@/lib/organizer-management";

export function LeagueCompetitionCourseHelp({ competitionKey, season, bestTime }: {
  competitionKey: string;
  season?: OrganizerManagedLeagueSeason;
  bestTime: boolean;
}) {
  const { t } = useI18n();
  return (
    <aside className="space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm" aria-label={t("organizer.league.competition.mappingTitle")}>
      <p id={`league-competition-help-${competitionKey}`}>{t("organizer.league.competition.nameHelp")}</p>
      <p className="text-xs text-muted-foreground">{t("organizer.league.competition.example")}</p>
      {bestTime ? <p className="text-xs font-medium">{t("organizer.league.competition.bestTimeHelp")}</p> : null}
      <h4 className="pt-1 font-semibold">{t("organizer.league.competition.mappingTitle")}</h4>
      {!season?.rounds.length ? <p className="text-xs text-muted-foreground">{t("organizer.league.competition.notAssigned")}</p> : (
        <ul className="space-y-1 text-xs">
          {season.rounds.map((round) => {
            const mapping = round.mappings.find((item) => item.competitionId === competitionKey && item.status === "mapped");
            return <li key={round.id}>{t(mapping ? "organizer.league.competition.roundCourse" : "organizer.league.competition.missingRound", {
              round: round.roundNumber, event: round.eventName, course: mapping?.categoryName ?? "",
            })}</li>;
          })}
        </ul>
      )}
      {season ? <Link className="inline-block font-semibold text-primary underline underline-offset-4" to={`/organizer/leagues/${season.seasonId}?tab=rounds`}>{t("organizer.league.competition.openRounds")}</Link> : null}
    </aside>
  );
}
