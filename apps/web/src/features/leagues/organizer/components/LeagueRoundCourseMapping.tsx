import { getLeagueCourseCoverageIssue } from "@raceson/domain/leagues";
import { Checkbox } from "@/components/ui/checkbox";
import { useI18n } from "@/shared/i18n/I18nContext";
import type { OrganizerManagedEvent, OrganizerManagedLeagueSeason } from "@/lib/organizer-management";

export function LeagueRoundCourseMapping({ competitions, races, sportCodes, selectedRaceIds, suggestedRaceIds, excludedCourseIds, confirmed, onChange, onConfirm }: {
  competitions: OrganizerManagedLeagueSeason["competitions"];
  races: OrganizerManagedEvent["categories"];
  sportCodes: string[];
  selectedRaceIds: Record<string, string>;
  suggestedRaceIds?: Record<string, string>;
  excludedCourseIds: string[];
  confirmed: boolean;
  onChange: (mappings: Record<string, string>, exclusions: string[]) => void;
  onConfirm: (confirmed: boolean) => void;
}) {
  const { t } = useI18n();
  const mappings = competitions.flatMap((competition) => selectedRaceIds[competition.id]
    ? [{ competitionId: competition.id, eventCategoryId: selectedRaceIds[competition.id] }] : []);
  const issue = getLeagueCourseCoverageIssue({ competitionIds: competitions.map((competition) => competition.id), courseIds: races.map((race) => race.id), mappings, excludedCourseIds });
  const unused = competitions.filter((competition) => !selectedRaceIds[competition.id]);
  const unresolved = races.filter((race) => !mappings.some((mapping) => mapping.eventCategoryId === race.id) && !excludedCourseIds.includes(race.id));
  function decide(courseId: string, decision: string) {
    const next = Object.fromEntries(Object.entries(selectedRaceIds).filter(([, raceId]) => raceId && raceId !== courseId));
    const exclusions = excludedCourseIds.filter((id) => id !== courseId);
    if (decision === "exclude") exclusions.push(courseId);
    else if (decision) next[decision] = courseId;
    onChange(next, exclusions);
  }
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold" role="status">{t("organizer.league.competition.coverage", { mapped: mappings.length, total: races.length, excluded: excludedCourseIds.length, unresolved: unresolved.length })}</p>
      <div className="space-y-2">
        {races.map((race) => {
          const competition = competitions.find((item) => selectedRaceIds[item.id] === race.id);
          const excluded = excludedCourseIds.includes(race.id);
          const compatible = sportCodes.includes(race.sportCode);
          const modeKey = competition?.standingsMode === "best_time" ? "bestTimeMode" : competition?.standingsMode === "participation" ? "participationMode" : competition?.standingsMode === "none" ? "noneMode" : "pointsMode";
          return (
            <div key={race.id} className="grid gap-2 rounded-xl border border-border bg-background/70 p-3 sm:grid-cols-2">
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">{t("organizer.league.competition.course")}</div>
                <div className="break-words text-sm font-semibold">{race.name}{race.distanceKm ? ` · ${race.distanceKm < 2 ? `${Math.round(race.distanceKm * 1000)} m` : `${race.distanceKm} km`}` : ""}</div>
                {!compatible ? <p className="mt-1 text-xs text-trail-amber">{t("organizer.league.competition.sportExcluded")}</p> : null}
              </div>
              <div className="min-w-0">
                <label className="block text-xs text-muted-foreground">
                  {t("organizer.league.competition.competition")}
                  <select aria-label={t("organizer.league.competition.courseLabel", { course: race.name })} value={competition?.id ?? (excluded ? "exclude" : "")} onChange={(event) => decide(race.id, event.target.value)} className="mt-1 w-full min-w-0 rounded-lg border border-border bg-card p-2 text-sm text-foreground">
                    <option value="">{t("organizer.league.competition.chooseCompetition")}</option>
                    {competitions.map((item) => <option key={item.id} value={item.id} disabled={!compatible || Boolean(selectedRaceIds[item.id] && selectedRaceIds[item.id] !== race.id)}>{item.name}</option>)}
                    <option value="exclude">{t("organizer.league.competition.exclude")}</option>
                  </select>
                </label>
                <p className="mt-1 text-xs text-muted-foreground">{competition ? t(`organizer.league.competition.${modeKey}`) : t(excluded ? "organizer.league.competition.excluded" : "organizer.league.competition.unassigned")}</p>
                {competition && !confirmed ? <p className="mt-1 text-xs font-medium text-primary">{t(suggestedRaceIds?.[competition.id] === race.id ? "organizer.league.competition.suggested" : "organizer.league.competition.unconfirmed")}</p> : null}
              </div>
            </div>
          );
        })}
      </div>
      {unused.length ? <p className="text-xs text-muted-foreground">{t("organizer.league.competition.unusedCompetitions", { names: unused.map((item) => item.name).join(", ") })}</p> : null}
      {issue ? <p className="text-xs text-trail-amber">{t("organizer.league.competition.coverageRequired")}</p> : null}
      <label className="flex items-start gap-2 rounded-xl border border-primary/20 p-3 text-sm">
        <Checkbox aria-label={t("organizer.league.competition.confirm")} checked={confirmed} disabled={Boolean(issue)} onCheckedChange={(value) => onConfirm(value === true)} />
        <span>{t("organizer.league.competition.confirm")}<span className="mt-1 block text-xs text-muted-foreground">{t("organizer.league.competition.confirmationHelp")}</span></span>
      </label>
    </div>
  );
}
