import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/I18nContext";
import type { OrganizerManagedEvent, OrganizerManagedLeagueSeason } from "@/lib/organizer-management";
import type { LeagueCompetitionDraft } from "../model/leagueCompetitionPlanning";
import { createCourseCompetitions } from "../model/courseCompetitionSetup";

export function LeagueCourseCompetitionBuilder({ events, season, competitions, activeCompetitionKey, sportCodes, onChange }: {
  events: OrganizerManagedEvent[];
  season?: OrganizerManagedLeagueSeason;
  competitions: LeagueCompetitionDraft[];
  activeCompetitionKey: string;
  sportCodes: string[];
  onChange: (drafts: LeagueCompetitionDraft[]) => void;
}) {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const [eventId, setEventId] = useState(params.get("sourceEvent") ?? "");
  const compatibleEvents = events.filter((event) => !event.isPractice && event.categories.some((course) => course.categoryType === "competitive" && sportCodes.includes(course.sportCode)));
  const source = compatibleEvents.find((event) => event.id === eventId);
  const replaceUnused = !season?.rounds.length;
  const mappedIds = new Set(season?.rounds.filter((round) => round.eventEditionId === source?.id).flatMap((round) => round.mappings.map((mapping) => mapping.eventCategoryId)) ?? []);
  const courses = source?.categories.filter((course) => course.categoryType === "competitive" && sportCodes.includes(course.sportCode) && !mappedIds.has(course.id)) ?? [];
  const template = competitions.find((competition) => competition.key === activeCompetitionKey) ?? competitions[0];
  const proposed = template ? createCourseCompetitions(courses, competitions, template, replaceUnused) : [];
  return (
    <details className="rounded-xl border border-border bg-background/60 p-3" open={Boolean(params.get("sourceEvent")) || undefined}>
      <summary className="cursor-pointer text-sm font-semibold">{t("organizer.league.competition.importTitle")}</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-muted-foreground">{t("organizer.league.competition.importHelp")}</p>
        <label className="block text-sm font-medium">
          {t("organizer.league.competition.sourceEvent")}
          <select className="mt-1 w-full rounded-lg border border-border bg-card p-2" value={eventId} onChange={(event) => setEventId(event.target.value)}>
            <option value="">{t("organizer.league.competition.chooseEvent")}</option>
            {compatibleEvents.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
          </select>
        </label>
        {!compatibleEvents.length ? <p className="text-xs">{t("organizer.league.competition.importNoEvents")}</p> : null}
        {source && template ? <>
          <p className="text-sm">{t("organizer.league.competition.template")}: <strong>{template.name}</strong></p>
          <p className="text-xs text-muted-foreground">{t(replaceUnused ? "organizer.league.competition.replaceHelp" : "organizer.league.competition.addHelp")}</p>
          <ul className="flex flex-wrap gap-2 text-xs">{proposed.map((competition) => <li key={competition.key} className="rounded border border-border px-2 py-1">{competition.name}</li>)}</ul>
          {proposed.length > 12 ? <p role="alert" className="text-sm text-destructive">{t("organizer.league.competition.importLimit")}</p> : null}
          <Button type="button" className="h-auto max-w-full whitespace-normal text-left" disabled={!courses.length || proposed.length > 12} onClick={() => onChange(proposed)}>{t("organizer.league.competition.importButton", { count: courses.length })}</Button>
        </> : null}
      </div>
    </details>
  );
}
