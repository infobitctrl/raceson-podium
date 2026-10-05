import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Calendar, CheckCircle2, ChevronLeft, ChevronRight, Flag, Globe, ImagePlus, Loader2, Lock, MapPin, Pencil, Plus, Save, Trash2, Trophy, Users } from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  CalendarTimelineDateBadge,
} from "@/components/shared/CalendarTimeline";
import { pickCalendarTimelineAccent } from "@/components/shared/calendarTimelineAccents";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  buildLeaguePlanningDescription,
  buildLeagueClubScoringMode,
  buildLeaguePlanningFromSource,
  getLeagueClubScorerCount,
  getLeagueClubScoringLabel,
  getLeagueClubScoringStructureLabel,
  getLeaguePointsTableFromPreset,
  getLeagueParticipationPoints,
  getLeaguePointsForPlace,
  getLeaguePlanningOptionLabel,
  leagueCloseoutOptions,
  leagueCreationWorkflowSteps,
  leagueProtestWindowOptions,
  leagueResultsCadenceOptions,
  leagueTieBreakOptions,
  type LeaguePlanningOption,
  type LeagueSeasonPlanningDraft,
  validateLeaguePlanningDraft,
} from "@/components/organizer/league/leaguePlanning";
import {
  autoMapLeagueEventRaces,
  buildLeagueCompetitionDrafts,
  buildLeagueCompetitionInputs,
  createAdditionalLeagueCompetitionDraft,
  createLeagueClassificationPresetDraft,
  describeLeagueClassification,
  getLeagueClassificationConflicts,
  getLeagueCompetitionPointsTable,
  validateLeagueCompetitionDraft,
  validateLeagueCompetitionDrafts,
  type LeagueClassificationDraft,
  type LeagueClassificationPreset,
  type LeagueCompetitionDraft,
} from "@/features/leagues/organizer/model/leagueCompetitionPlanning";
import {
  hasMeaningfulLeagueSeasonEditorDraft,
  leagueSeasonEditorDraftStorageKey,
  loadLeagueSeasonEditorDraft,
  removeLeagueSeasonEditorDraft,
  saveLeagueSeasonEditorDraft,
  type LeagueSeasonEditorDraftData,
} from "@/features/leagues/organizer/model/leagueSeasonEditorDraft";
import { LeagueScoringCurveEditor } from "@/features/leagues/organizer/components/LeagueScoringCurveEditor";
import { LeagueCompetitionCourseHelp } from "@/features/leagues/organizer/components/LeagueCompetitionCourseHelp";
import { LeagueCourseCompetitionBuilder } from "@/features/leagues/organizer/components/LeagueCourseCompetitionBuilder";
import { LeagueRoundCourseMapping } from "@/features/leagues/organizer/components/LeagueRoundCourseMapping";
import { copyCompetitionRules } from "@/features/leagues/organizer/model/courseCompetitionSetup";
import {
  leagueScoringMethodOptions,
  type LeagueScoringMethod,
} from "@/features/leagues/organizer/model/leagueScoringCurve";
import { buildLeagueRoundSlots } from "@/features/leagues/model/leagueRoundPlanning";
import { resolveLeagueImageUrl } from "@/features/leagues/model/leagueMedia";
import {
  formatOrganizerLeagueApiError,
  getLeagueRoundStatusMeta,
  getLeagueUniqueEventCount,
} from "@/components/organizer/league/leagueWorkspaceMeta";
import { useOrganizerAuth } from "@/lib/organizer-workspace";
import { uploadLeagueImage } from "@/lib/league-storage";
import {
  getSibenikTrailLeagueDisplayName,
  getSibenikTrailLeagueEnglishCopy,
} from "@/features/leagues/model/sibenikTrailLeagueIdentity";
import {
  attachOrganizerLeagueRound,
  createOrganizerLeagueSeason,
  detachAllOrganizerLeagueRounds,
  detachOrganizerLeagueRound,
  publishOrganizerLeagueSeasonRaces,
  updateOrganizerLeagueSeason,
  type OrganizerManagedEvent,
  type OrganizerManagedLeagueSeason,
} from "@/lib/organizer-management";
import { SportSelector } from "@/shared/sports";
import { useI18n } from "@/shared/i18n/I18nContext";
import { localizeOrganizerLeagueText } from "@/features/leagues/organizer/model/organizerLeagueLocalization";
import { getLeagueCourseCoverageIssue, type LeagueClubScoringScope } from "@raceson/domain/leagues";
import { DEFAULT_SPORT_CODE, type SportCode } from "@raceson/domain/sports";

const LEAGUE_EDITOR_DIALOG_OVERLAY_CLASS = "bg-background/34 backdrop-blur-md";
const LEAGUE_EDITOR_DIALOG_CLASS =
  "max-h-[94vh] overflow-y-auto border-white/18 bg-background/62 shadow-[0_28px_80px_-36px_rgba(15,23,42,0.58)] backdrop-blur-2xl [&>button]:right-5 [&>button]:top-5 [&>button]:rounded-full [&>button]:border [&>button]:border-border/60 [&>button]:bg-background/92 [&>button]:text-foreground [&>button]:backdrop-blur-sm";
const leagueStandingsModeOptions = [
  { value: "points", label: "Points standings", detail: "Award points by finishing place." },
  { value: "best_time", label: "Best time (no points)", detail: "Rank each athlete by their fastest elapsed time." },
  { value: "participation", label: "Participation only", detail: "Rank by completed participations without place points." },
  { value: "none", label: "Results only", detail: "Publish round results without season standings." },
] as const;

function defaultLeagueDialogTrigger(season?: OrganizerManagedLeagueSeason) {
  if (season) {
    return (
      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Edit league">
        <Pencil className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <Button aria-label="Create league">
      <Plus className="mr-2 h-4 w-4" />
      Create League
    </Button>
  );
}

function getLeagueSeasonPlanning(season?: OrganizerManagedLeagueSeason) {
  return buildLeaguePlanningFromSource({
    description: season?.description
      ? getSibenikTrailLeagueEnglishCopy(season.description, season.name, season.slug)
      : null,
    scoringRules: season?.scoringRules ?? null,
    clubScoringScope: season?.clubScoringScope ?? null,
    organizerNotes: season?.organizerNotes ?? null,
  });
}

function LeaguePlanningSelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly LeaguePlanningOption[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function formatLeagueOrdinal(place: number, locale: "en" | "hr" = "en") {
  if (locale === "hr") return `${place}.`;
  const remainder100 = place % 100;
  if (remainder100 >= 11 && remainder100 <= 13) return `${place}th`;
  switch (place % 10) {
    case 1:
      return `${place}st`;
    case 2:
      return `${place}nd`;
    case 3:
      return `${place}rd`;
    default:
      return `${place}th`;
  }
}

function LeaguePointsTableExample({
  label,
  points,
  participationPoints,
}: {
  label: string;
  points: number[];
  participationPoints: number;
}) {
  const { locale, t } = useI18n();
  const previewPlaces = Array.from(new Set(
    [1, 2, 3, 5, 10, points.length].filter((place) => place >= 1 && place <= points.length),
  )).sort((left, right) => left - right);

  return (
    <div
      className="overflow-x-auto rounded-xl border border-primary/20 bg-primary/[0.035] p-3"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-primary">Scoring example</div>
        <div className="text-[10px] font-medium text-muted-foreground">{label} · {t("league.rules.places", { count: points.length })}</div>
      </div>

      {points.length ? (
        <>
          <dl className="mt-2 grid min-w-[680px] grid-flow-col auto-cols-fr gap-1.5">
            {previewPlaces.map((place) => (
              <div
                key={place}
                className={`rounded-lg border px-2.5 py-1.5 text-center ${
                  place <= 3
                    ? "border-primary/20 bg-card text-primary"
                    : "border-border/70 bg-background/70 text-foreground"
                }`}
              >
                <dt className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{formatLeagueOrdinal(place, locale)}</dt>
                <dd className="font-display text-xs font-bold">{t("organizer.league.pointsShort", { points: points[place - 1] })}</dd>
              </div>
            ))}
            <div className="rounded-lg border border-trail-green/25 bg-trail-green/[0.06] px-2 py-1.5 text-center">
              <dt className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Later finishers</dt>
              <dd className="font-display text-xs font-bold text-trail-green">{t("organizer.league.pointsShort", { points: participationPoints })}</dd>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/70 px-2 py-1.5 text-center">
              <dt className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">No finish</dt>
              <dd className="font-display text-xs font-bold">0 pts</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Enter a points value to show the example.
        </p>
      )}
    </div>
  );
}

function LeagueScoringPreview({ planning }: { planning: LeagueSeasonPlanningDraft }) {
  const { locale, t } = useI18n();
  const plannedRounds = Math.min(10, Math.max(1, Number.parseInt(planning.plannedRoundCount, 10) || 1));
  const pointsTable = getLeaguePointsTableFromPreset(planning.pointsTablePreset, planning.customPoints);
  const participationPoints = getLeagueParticipationPoints(planning.pointsTablePreset, planning.participationPoints);
  const sourcePlacements = [1, 8, 3, Math.max(12, Math.round(pointsTable.length / 2)), pointsTable.length + 7, 5, pointsTable.length, pointsTable.length + 25, 2, 18];
  const roundResults = sourcePlacements.slice(0, plannedRounds).map((place) => ({
    place,
    score: getLeaguePointsForPlace(pointsTable, participationPoints, place),
    isParticipationFloor: place > pointsTable.length,
  }));
  const countedTarget = planning.countingMode === "all_rounds"
    ? plannedRounds
    : Math.min(plannedRounds, Math.max(1, Number.parseInt(planning.bestN, 10) || 1));
  const countedIndexes = new Set(
    roundResults
      .map((result, index) => ({ score: result.score, index }))
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .slice(0, countedTarget)
      .map((entry) => entry.index),
  );
  const total = roundResults.reduce(
    (sum, result, index) => sum + (countedIndexes.has(index) ? result.score : 0),
    0,
  );

  return (
    <div className="overflow-x-auto rounded-xl border border-primary/20 bg-primary/[0.035] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold">
          Example · {planning.countingMode === "all_rounds"
            ? t("organizer.league.allRoundsExample", { count: plannedRounds })
            : t("organizer.league.bestRoundsExample", { best: countedTarget, total: plannedRounds })}
        </div>
        <div className="rounded-lg border border-primary/15 bg-card px-2.5 py-1 text-xs font-bold text-primary">
          {locale === "hr" ? "Ukupno" : "Total"} {total}
        </div>
      </div>
      <div className="mt-2 grid min-w-[640px] grid-flow-col auto-cols-fr gap-1.5">
        {roundResults.map((result, index) => {
          const counted = countedIndexes.has(index);
          return (
            <div
              key={`${result.place}-${index}`}
              className={`min-w-14 rounded-lg border px-2 py-1.5 text-center ${
                counted
                  ? "border-trail-green/35 bg-trail-green/[0.08] text-trail-green"
                  : "border-dashed border-muted-foreground/35 bg-card text-muted-foreground"
              }`}
            >
              <div className="text-[8px] font-bold uppercase tracking-wider">{locale === "hr" ? "K" : "R"}{index + 1} · {formatLeagueOrdinal(result.place, locale)}</div>
              <div className={`font-display text-xs font-bold ${counted ? "" : "line-through"}`}>{t("organizer.league.pointsShort", { points: result.score })}</div>
              {result.isParticipationFloor ? <div className="text-[7px] font-semibold uppercase tracking-wider">Floor</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const leagueClassificationQuickAdds: Array<{
  preset: LeagueClassificationPreset;
  label: string;
  gender?: LeagueClassificationDraft["gender"];
  minimumAge?: string;
  maximumAge?: string;
}> = [
  { preset: "custom", label: "Custom group" },
  { preset: "female", label: "Female", gender: "F", minimumAge: "16", maximumAge: "64.99" },
  { preset: "male", label: "Male", gender: "M", minimumAge: "16", maximumAge: "64.99" },
  { preset: "girls_u16", label: "Female U16", gender: "F", maximumAge: "15.99" },
  { preset: "boys_u16", label: "Male U16", gender: "M", maximumAge: "15.99" },
  { preset: "senior", label: "Senior 65+", gender: "any", minimumAge: "65" },
];

function LeagueClassificationEditor({
  competition,
  winnerPoints,
  onChange,
}: {
  competition: LeagueCompetitionDraft;
  winnerPoints: number;
  onChange: (classifications: LeagueClassificationDraft[]) => void;
}) {
  const { locale, t } = useI18n();
  const [selectedPreset, setSelectedPreset] = useState<LeagueClassificationPreset>("custom");
  const conflicts = getLeagueClassificationConflicts(competition.classifications);
  const conflictByClassificationKey = new Map(
    conflicts.map((conflict) => [conflict.classificationKey, conflict]),
  );

  function updateClassification(key: string, patch: Partial<LeagueClassificationDraft>) {
    onChange(competition.classifications.map((classification) =>
      classification.key === key ? { ...classification, ...patch } : classification
    ));
  }

  function updateAge(
    classification: LeagueClassificationDraft,
    field: "minimumAge" | "maximumAge",
    value: string,
  ) {
    const otherValue = field === "minimumAge"
      ? classification.maximumAge
      : classification.minimumAge;
    updateClassification(classification.key, {
      [field]: value,
      anyAge: value === "" && otherValue === "",
    });
  }

  function presetIsUsed(preset: (typeof leagueClassificationQuickAdds)[number]) {
    if (preset.preset === "custom") return false;
    return competition.classifications.some((classification) => (
      classification.gender === (preset.gender ?? "any")
      && classification.minimumAge === (preset.minimumAge ?? "")
      && classification.maximumAge === (preset.maximumAge ?? "")
    ));
  }

  function addSelectedPreset() {
    onChange([
      ...competition.classifications,
      createLeagueClassificationPresetDraft(selectedPreset, competition.classifications),
    ]);
    setSelectedPreset("custom");
  }

  const selectedPresetOption = leagueClassificationQuickAdds.find(
    (item) => item.preset === selectedPreset,
  ) ?? leagueClassificationQuickAdds[0];
  const selectedPresetIsUsed = presetIsUsed(selectedPresetOption);

  return (
    <section className="border-t border-border/70 pt-2.5">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-primary">Scoring groups</div>
            <span className="text-[10px] font-medium text-muted-foreground">
              {locale === "hr"
                ? `${competition.classifications.length} ${competition.classifications.length === 1 ? "skupina" : "skupine"}`
                : `${competition.classifications.length} ${competition.classifications.length === 1 ? "group" : "groups"}`}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t(competition.standingsMode === "points" ? "organizer.league.competition.pointsGroupsHelp" : "organizer.league.competition.noPoints")}
          </p>
        </div>
        <div className="flex w-full gap-1.5 lg:w-auto" aria-label="Add scoring group">
          <label className="min-w-0 flex-1 lg:w-44 lg:flex-none">
            <span className="sr-only">Scoring group preset</span>
            <select
              aria-label="Scoring group preset"
              value={selectedPreset}
              onChange={(event) => setSelectedPreset(event.target.value as LeagueClassificationPreset)}
              className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {leagueClassificationQuickAdds.map((item) => (
                <option key={item.preset} value={item.preset} disabled={presetIsUsed(item)}>
              {presetIsUsed(item) ? t("organizer.league.presetAdded", { label: localizeOrganizerLeagueText(item.label, locale) }) : localizeOrganizerLeagueText(item.label, locale)}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            size="sm"
            disabled={selectedPresetIsUsed}
            className="h-8 shrink-0 rounded-lg px-3 text-xs"
            onClick={addSelectedPreset}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add group
          </Button>
        </div>
      </div>

      <div className="mt-2 overflow-hidden rounded-lg border border-border/70 bg-card/55 divide-y divide-border/70">
        {competition.classifications.length === 0 ? (
          <div className="bg-background/45 px-3 py-3 text-center">
            <div className="text-sm font-semibold">No scoring groups yet</div>
            <div className="mt-0.5 text-xs text-muted-foreground">Choose a preset above to add the first group.</div>
          </div>
        ) : null}
        {competition.classifications.map((classification, index) => {
          const conflict = conflictByClassificationKey.get(classification.key);
          return (
          <fieldset
            key={classification.key}
            className={`p-2 ${conflict ? "bg-destructive/[0.035]" : "bg-card/45"}`}
          >
            <legend className="sr-only">{locale === "hr" ? `Bodovna skupina ${index + 1}` : `Scoring group ${index + 1}`}</legend>
            <div className="grid gap-1.5 sm:grid-cols-2 md:grid-cols-[minmax(150px,1.15fr)_minmax(120px,0.75fr)_minmax(82px,0.5fr)_minmax(82px,0.5fr)_auto] md:items-end">
              <label className="block space-y-1">
                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Group name</span>
                <Input
                  value={classification.name}
                  onChange={(event) => updateClassification(classification.key, { name: event.target.value })}
                  placeholder="Children U16"
                  className="h-8 rounded-lg"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Participants</span>
                <select
                  aria-label={locale === "hr" ? `${classification.name || `Skupina ${index + 1}`} – sudionici` : `${classification.name || `Group ${index + 1}`} participants`}
                  value={classification.gender}
                  onChange={(event) => updateClassification(classification.key, {
                    gender: event.target.value as LeagueClassificationDraft["gender"],
                  })}
                  className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="any">Everyone</option>
                  <option value="F">Female</option>
                  <option value="M">Male</option>
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Age from</span>
                <Input
                  aria-label={locale === "hr" ? `${classification.name || `Skupina ${index + 1}`} – dob od` : `${classification.name || `Group ${index + 1}`} age from`}
                  type="number"
                  min="0"
                  max="120"
                  step="0.01"
                  value={classification.anyAge ? "" : classification.minimumAge}
                  onChange={(event) => updateAge(classification, "minimumAge", event.target.value)}
                  placeholder="Any"
                  className="h-8 rounded-lg"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Age through</span>
                <Input
                  aria-label={locale === "hr" ? `${classification.name || `Skupina ${index + 1}`} – dob do` : `${classification.name || `Group ${index + 1}`} age through`}
                  type="number"
                  min="0"
                  max="120"
                  step="0.01"
                  value={classification.anyAge ? "" : classification.maximumAge}
                  onChange={(event) => updateAge(classification, "maximumAge", event.target.value)}
                  placeholder="Any"
                  className="h-8 rounded-lg"
                />
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={locale === "hr" ? `Ukloni ${classification.name || `bodovnu skupinu ${index + 1}`}` : `Remove ${classification.name || `scoring group ${index + 1}`}`}
                className="h-8 w-8 self-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:col-span-2 md:col-span-1"
                onClick={() => onChange(competition.classifications.filter((candidate) => candidate.key !== classification.key))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {conflict ? (
              <div className="mt-1.5 flex items-start gap-2 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{locale === "hr" ? "Isti natjecatelji kao" : "Same runners as"} <strong>{conflict.conflictingClassificationName}</strong>. {locale === "hr" ? "Promijenite sudionike ili dobno polje." : "Change Participants or an age field."}</span>
              </div>
            ) : (
              <div className="mt-1 text-[10px] font-medium text-foreground/75">
                {localizeOrganizerLeagueText(describeLeagueClassification(classification), locale)}
                {competition.standingsMode === "points" ? <> · {locale === "hr" ? "pobjednik" : "winner"} {t("organizer.league.pointsShort", { points: winnerPoints })}</> : null}
              </div>
            )}
          </fieldset>
          );
        })}
      </div>
    </section>
  );
}

function LeagueClubScoringEditor({
  competitions,
  value,
  scope,
  onChange,
}: {
  competitions: LeagueCompetitionDraft[];
  value: string;
  scope: LeagueClubScoringScope;
  onChange: (value: string, scope: LeagueClubScoringScope) => void;
}) {
  const { locale } = useI18n();
  const enabled = value !== "none";
  const scorerCount = getLeagueClubScorerCount(value);
  const structureLabel = locale === "hr"
    ? scope === "combined"
      ? `Jedna objedinjena klupska tablica · najboljih ${scorerCount}`
      : `Odvojene klupske tablice prema kategoriji utrke · najboljih ${scorerCount}`
    : getLeagueClubScoringStructureLabel(value, scope);
  const combinedCompetitionLabel = competitions.length
    ? competitions.map((competition) => competition.name).join(" + ")
    : "No race categories yet";
  const scoreSources = competitions.flatMap((competition) => {
    const points = getLeagueCompetitionPointsTable(competition);
    const groups = competition.classifications.length
      ? competition.classifications.slice(0, 2).map((classification) => classification.name)
      : ["Race result"];
    return groups.map((group, index) => ({
      label: `${competition.name} · ${group}`,
      points: points[index] ?? (Number(competition.participationPoints) || 0),
    }));
  }).sort((left, right) => right.points - left.points);
  const sampleClubs = ["Trail Collective", "Summit Runners", "Peak Club"].map((club, clubIndex) => {
    const scores = scoreSources.map((score, scoreIndex) => ({
      ...score,
      points: Math.max(1, score.points - clubIndex * 7 - scoreIndex * 2),
    })).sort((left, right) => right.points - left.points);
    const countedScores = scores.slice(0, scorerCount);
    return {
      club,
      scores: countedScores,
      total: countedScores.reduce((sum, score) => sum + score.points, 0),
    };
  });

  return (
    <section className="rounded-lg border border-border/70 bg-card/55 p-2.5">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="rounded-lg bg-trail-amber/15 p-1.5 text-trail-amber"><Trophy className="h-4 w-4" /></div>
          <div>
            <h4 className="font-display text-sm font-bold">Club championship</h4>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Choose whether race categories feed one club championship or keep independent club tables.
            </p>
          </div>
        </div>
        <div className="grid shrink-0 gap-1 rounded-lg border border-border bg-background/70 p-1 text-left text-xs font-semibold sm:grid-cols-3" role="radiogroup" aria-label="Club scoring structure">
          <button
            type="button"
            aria-pressed={!enabled}
            onClick={() => onChange("none", scope)}
            className={`rounded-md px-3 py-2 transition-colors ${!enabled ? "bg-primary/10 text-primary shadow-sm" : "text-muted-foreground hover:bg-muted/40"}`}
          >
            <span className="block">Off</span>
            <span className="mt-0.5 block text-[9px] font-normal">No club leaderboard</span>
          </button>
          <button
            type="button"
            aria-label="Combine all race categories"
            aria-pressed={enabled && scope === "combined"}
            onClick={() => onChange(buildLeagueClubScoringMode(scorerCount), "combined")}
            className={`rounded-md px-3 py-2 transition-colors ${enabled && scope === "combined" ? "bg-primary/10 text-primary shadow-sm" : "text-muted-foreground hover:bg-muted/40"}`}
          >
            <span className="block">One combined table</span>
            <span className="mt-0.5 block text-[9px] font-normal">{combinedCompetitionLabel}</span>
          </button>
          <button
            type="button"
            aria-label="Separate club tables by race category"
            aria-pressed={enabled && scope === "per_competition"}
            onClick={() => onChange(buildLeagueClubScoringMode(scorerCount), "per_competition")}
            className={`rounded-md px-3 py-2 transition-colors ${enabled && scope === "per_competition" ? "bg-primary/10 text-primary shadow-sm" : "text-muted-foreground hover:bg-muted/40"}`}
          >
            <span className="block">Separate tables</span>
            <span className="mt-0.5 block text-[9px] font-normal">One per race category</span>
          </button>
        </div>
      </div>

      {enabled ? (
        <div className="mt-2 grid gap-2 lg:grid-cols-[180px_minmax(0,1fr)] lg:items-start">
          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Athletes counted per race</span>
            <Input
              aria-label="Athletes counted per race"
              type="number"
              min="1"
              max="10"
              value={scorerCount}
              onChange={(event) => onChange(buildLeagueClubScoringMode(Number(event.target.value) || 1), scope)}
            />
            <span className="block text-[10px] leading-4 text-muted-foreground">
              {scope === "combined"
                ? competitions.length === 1
                  ? `The best scores are selected from ${combinedCompetitionLabel}.`
                  : `The best scores are selected from the full ${combinedCompetitionLabel} pool.`
                : "Each race category selects this many athletes independently."}
            </span>
          </label>
          {scope === "combined" ? (
            <div className="overflow-hidden rounded-lg border border-primary/20 bg-primary/[0.03]">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-2">
                <div className="text-xs font-semibold">{structureLabel}</div>
                <div className="text-[10px] font-medium text-muted-foreground">
                  {competitions.map((competition) => competition.name).join(" + ")}
                </div>
              </div>
              <div className="overflow-x-auto border-t border-primary/15">
                <table className="w-full text-left text-xs">
                  <thead className="bg-background/65 text-[9px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-bold">Rank</th>
                      <th className="px-3 py-2 font-bold">Club</th>
                      <th className="px-3 py-2 font-bold">Best scores from every race category</th>
                      <th className="px-3 py-2 text-right font-bold">Combined total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sampleClubs.map((club, index) => (
                      <tr key={club.club} className="border-t border-border/60 bg-card/55">
                        <td className="px-3 py-2 font-display font-bold text-primary">#{index + 1}</td>
                        <td className="px-3 py-2 font-semibold">{club.club}</td>
                        <td className="px-3 py-2">
                          <span className="text-[10px] text-muted-foreground">
                            {club.scores.map((score) => `${score.label} ${score.points}`).join(" · ") || "No scores yet"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-display font-bold">{club.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-primary/20 bg-primary/[0.03] p-3">
              <div className="text-xs font-semibold">{structureLabel}</div>
              <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                Points never cross between these tables. Athletes and clubs can rank differently in every race category.
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {competitions.map((competition) => (
                  <div key={competition.key} className="rounded-lg border border-border/70 bg-card/70 px-3 py-2">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Independent club table</div>
                    <div className="mt-0.5 font-display text-sm font-bold">{competition.name}</div>
                    <div className="mt-1 text-[10px] text-muted-foreground">{locale === "hr" ? `Najboljih ${scorerCount} natjecatelja · bodovi samo za ${competition.name}` : `Best ${scorerCount} athletes · ${competition.name} points only`}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function LeagueCompetitionScoringEditor({
  competition,
  planning,
  onChange,
}: {
  competition: LeagueCompetitionDraft;
  planning: LeagueSeasonPlanningDraft;
  onChange: (patch: Partial<LeagueCompetitionDraft>) => void;
}) {
  const { t } = useI18n();
  const activePointsTable = getLeagueCompetitionPointsTable(competition);
  const activeParticipationPoints = competition.scoringMethod === "custom"
    ? getLeagueParticipationPoints(competition.pointsTablePreset, competition.participationPoints)
    : Math.max(1, Number.parseInt(competition.participationPoints, 10) || 1);
  const previewPlanning: LeagueSeasonPlanningDraft = {
    ...planning,
    pointsTablePreset: "custom",
    customPoints: activePointsTable.join(", "),
    participationPoints: competition.participationPoints,
    countingMode: competition.countingMode,
    bestN: competition.bestN,
    minimumRounds: competition.minimumRounds,
    tieBreakMethod: competition.tieBreakMethod,
  };

  if (competition.standingsMode !== "points") {
    return (
      <div className="space-y-2.5">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{t("organizer.league.competition.name")}</span>
            <Input
              aria-describedby={`league-competition-help-${competition.key}`}
              value={competition.name}
              onChange={(event) => onChange({ name: event.target.value })}
              placeholder="Swimming"
            />
          </label>
          <LeaguePlanningSelectField
            label="Standings"
            value={competition.standingsMode}
            options={leagueStandingsModeOptions}
            onChange={(value) => onChange({
              standingsMode: value as LeagueCompetitionDraft["standingsMode"],
            })}
          />
        </div>
        <div className="rounded-xl border border-trail-blue/20 bg-trail-blue/[0.05] px-3 py-2.5 text-sm text-muted-foreground">
          {competition.standingsMode === "best_time"
            ? "The league keeps each athlete’s fastest elapsed time. No points table is created."
            : competition.standingsMode === "participation"
              ? "The league records participation without place-based points."
              : "Race results are retained without calculating league standings."}
        </div>
        <LeagueClassificationEditor
          competition={competition}
          winnerPoints={0}
          onChange={(classifications) => onChange({ classifications })}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="grid gap-2.5 sm:grid-cols-3">
        <label className="block space-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{t("organizer.league.competition.name")}</span>
          <Input
            aria-describedby={`league-competition-help-${competition.key}`}
            value={competition.name}
            onChange={(event) => onChange({ name: event.target.value })}
            placeholder="Short"
          />
        </label>

        <LeaguePlanningSelectField
          label="Standings"
          value={competition.standingsMode}
          options={leagueStandingsModeOptions}
          onChange={(value) => onChange({
            standingsMode: value as LeagueCompetitionDraft["standingsMode"],
          })}
        />

        <LeaguePlanningSelectField
          label="Scoring system"
          value={competition.scoringMethod}
          options={leagueScoringMethodOptions}
          onChange={(value) => onChange({
            scoringMethod: value as LeagueScoringMethod,
            pointsTablePreset: "custom",
            customPoints: activePointsTable.join(", "),
          })}
        />
      </div>

      {competition.scoringMethod === "custom" ? (
        <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_180px]">
          <label className="block space-y-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Graded points by place</span>
            <Textarea
              value={competition.customPoints}
              onChange={(event) => onChange({ customPoints: event.target.value })}
              rows={2}
              placeholder="100, 90, 82, 75, 70"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Later finisher points</span>
            <Input
              type="number"
              min="0"
              max="10000"
              value={competition.participationPoints}
              onChange={(event) => onChange({ participationPoints: event.target.value })}
            />
          </label>
        </div>
      ) : (
        <LeagueScoringCurveEditor
          method={competition.scoringMethod}
          maximumPoints={competition.maximumPoints}
          expectedFinishers={competition.expectedFinishers}
          participationPoints={competition.participationPoints}
          hybridEmphasis={competition.hybridEmphasis}
          onChange={onChange}
        />
      )}

      <LeaguePointsTableExample
        label={getLeaguePlanningOptionLabel(
          leagueScoringMethodOptions,
          competition.scoringMethod,
          "Manual points table",
        )}
        points={activePointsTable}
        participationPoints={activeParticipationPoints}
      />

      <LeagueClassificationEditor
        competition={competition}
        winnerPoints={activePointsTable[0] ?? 0}
        onChange={(classifications) => onChange({ classifications })}
      />

      <div className="border-t border-border/70 pt-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Results counted</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-[auto_auto_110px_130px_minmax(180px,1fr)] lg:items-end">
          <div className="grid grid-cols-2 gap-2 sm:col-span-2 lg:col-span-2">
            <button
              type="button"
              aria-pressed={competition.countingMode === "all_rounds"}
              onClick={() => onChange({ countingMode: "all_rounds" })}
              className={`rounded-xl border px-3 py-2 text-left transition-colors ${competition.countingMode === "all_rounds" ? "border-primary bg-primary/5 text-primary" : "border-border bg-background/70 hover:bg-muted/40"}`}
            >
              <div className="text-sm font-semibold">All rounds count</div>
            </button>
            <button
              type="button"
              aria-pressed={competition.countingMode === "best_n"}
              onClick={() => onChange({ countingMode: "best_n" })}
              className={`rounded-xl border px-3 py-2 text-left transition-colors ${competition.countingMode === "best_n" ? "border-primary bg-primary/5 text-primary" : "border-border bg-background/70 hover:bg-muted/40"}`}
            >
              <div className="text-sm font-semibold">Best N of total</div>
            </button>
          </div>
          {competition.countingMode === "best_n" ? (
            <label className="block space-y-1.5">
              <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Best N</span>
              <Input
                type="number"
                min="1"
                max={planning.plannedRoundCount}
                value={competition.bestN}
                onChange={(event) => onChange({ bestN: event.target.value })}
              />
            </label>
          ) : (
            <div className="rounded-xl border border-border/70 bg-muted/25 px-3 py-2">
              <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Rounds</div>
              <div className="text-sm font-bold">{planning.plannedRoundCount}</div>
            </div>
          )}
          <label className="block space-y-1.5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Minimum finishes</span>
            <Input
              type="number"
              min="1"
              max={planning.plannedRoundCount}
              value={competition.minimumRounds}
              onChange={(event) => onChange({ minimumRounds: event.target.value })}
            />
          </label>
          <LeaguePlanningSelectField
            label="Athlete tie-break"
            value={competition.tieBreakMethod}
            options={leagueTieBreakOptions}
            onChange={(value) => onChange({ tieBreakMethod: value })}
          />
        </div>

        <div className="mt-2">
          <LeagueScoringPreview planning={previewPlanning} />
        </div>
      </div>
    </div>
  );
}

export function LeagueSeasonSetupForm({
  season,
  onSaved,
}: {
  season: OrganizerManagedLeagueSeason;
  onSaved: () => Promise<void>;
}) {
  const { account } = useOrganizerAuth();
  const baseline = useMemo(() => buildLeagueSeasonEditorBaseline(season, 1), [season]);
  const draftStorageKey = account?.userId
    ? leagueSeasonEditorDraftStorageKey(
        account.userId,
        account.organizationIds[0] ?? "unscoped",
        `${season.seasonId}.setup`,
      )
    : null;
  const [name, setName] = useState(baseline.name);
  const [year, setYear] = useState(baseline.year);
  const [startsOn, setStartsOn] = useState(baseline.startsOn);
  const [endsOn, setEndsOn] = useState(baseline.endsOn);
  const [status, setStatus] = useState(baseline.status);
  const [sportCodes, setSportCodes] = useState<SportCode[]>(baseline.sportCodes);
  const [primarySportCode, setPrimarySportCode] = useState<SportCode>(baseline.primarySportCode);
  const [planning, setPlanning] = useState<LeagueSeasonPlanningDraft>(baseline.planning);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const initializedSeasonRef = useRef<string | null>(null);
  const draftBaselineRef = useRef(baseline);
  const draftSnapshot = useMemo<LeagueSeasonEditorDraftData>(() => ({
    step: 1,
    name,
    year,
    startsOn,
    endsOn,
    organizerRules: baseline.organizerRules,
    status,
    sportCodes,
    primarySportCode,
    planning,
    competitionDrafts: draftBaselineRef.current.competitionDrafts,
    activeCompetitionKey: draftBaselineRef.current.activeCompetitionKey,
  }), [baseline.organizerRules, endsOn, name, planning, primarySportCode, sportCodes, startsOn, status, year]);

  const applySetupDraft = useCallback((draft: LeagueSeasonEditorDraftData) => {
    setName(draft.name);
    setYear(draft.year);
    setStartsOn(draft.startsOn);
    setEndsOn(draft.endsOn);
    setStatus(season.isPublic ? draft.status : "draft");
    setSportCodes(draft.sportCodes);
    setPrimarySportCode(draft.primarySportCode);
    setPlanning(draft.planning);
  }, [season.isPublic]);

  useEffect(() => {
    if (initializedSeasonRef.current === season.seasonId) return;
    const storedDraft = draftStorageKey && typeof window !== "undefined"
      ? loadLeagueSeasonEditorDraft(window.localStorage, draftStorageKey, baseline)
      : null;
    draftBaselineRef.current = baseline;
    applySetupDraft(storedDraft ?? baseline);
    setDraftSavedAt(storedDraft?.updatedAt ?? null);
    setDraftRestored(Boolean(storedDraft));
    initializedSeasonRef.current = season.seasonId;
    setDraftReady(true);
  }, [applySetupDraft, baseline, draftStorageKey, season.seasonId]);

  useEffect(() => {
    if (!draftReady || !draftStorageKey || typeof window === "undefined") return;
    const timeoutId = window.setTimeout(() => {
      try {
        if (!hasMeaningfulLeagueSeasonEditorDraft(draftSnapshot, draftBaselineRef.current)) {
          removeLeagueSeasonEditorDraft(window.localStorage, draftStorageKey);
          setDraftSavedAt(null);
          setDraftRestored(false);
          return;
        }
        const savedDraft = saveLeagueSeasonEditorDraft(window.localStorage, draftStorageKey, draftSnapshot);
        setDraftSavedAt(savedDraft.updatedAt);
      } catch {
        toast.error("Unable to autosave the league setup draft in this browser.");
      }
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [draftReady, draftSnapshot, draftStorageKey]);

  function persistDraftNow() {
    if (!draftReady || !draftStorageKey || typeof window === "undefined") return;
    try {
      if (!hasMeaningfulLeagueSeasonEditorDraft(draftSnapshot, draftBaselineRef.current)) return;
      const savedDraft = saveLeagueSeasonEditorDraft(window.localStorage, draftStorageKey, draftSnapshot);
      setDraftSavedAt(savedDraft.updatedAt);
    } catch {
      toast.error("Unable to save the league setup draft in this browser.");
    }
  }

  function handleDiscardDraft() {
    if (draftStorageKey && typeof window !== "undefined") {
      removeLeagueSeasonEditorDraft(window.localStorage, draftStorageKey);
    }
    draftBaselineRef.current = baseline;
    applySetupDraft(baseline);
    setDraftSavedAt(null);
    setDraftRestored(false);
    toast.success("League setup draft discarded.");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!account) return;
    persistDraftNow();
    const parsedYear = Number.parseInt(year, 10);
    if (!name.trim()) {
      toast.error("League name is required.");
      return;
    }
    if (!Number.isFinite(parsedYear) || parsedYear < 2020 || parsedYear > 2100) {
      toast.error("Enter a valid season year.");
      return;
    }
    if (!planning.seasonBrief.trim()) {
      toast.error("Add a short season summary.");
      return;
    }
    if (startsOn && endsOn && endsOn < startsOn) {
      toast.error("Season end date must be on or after its start date.");
      return;
    }

    setSaving(true);
    try {
      await updateOrganizerLeagueSeason(account, {
        leagueId: season.leagueId,
        seasonId: season.seasonId,
        name: name.trim(),
        sportCodes,
        primarySportCode,
        description: buildLeaguePlanningDescription(planning),
        organizerNotes: planning.organizerNotes,
        year: parsedYear,
        startsOn: startsOn || null,
        endsOn: endsOn || null,
        timezone: season.timezone || "Europe/Zagreb",
        status,
      });
      if (draftStorageKey && typeof window !== "undefined") {
        removeLeagueSeasonEditorDraft(window.localStorage, draftStorageKey);
      }
      draftBaselineRef.current = draftSnapshot;
      setDraftSavedAt(null);
      setDraftRestored(false);
      toast.success("League setup saved.");
      void onSaved().catch(() => {
        toast.error("The league setup was saved, but the refreshed view could not be loaded yet.");
      });
    } catch (error) {
      persistDraftNow();
      toast.error(formatOrganizerLeagueApiError(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleImageChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const organizationId = account?.organizationIds[0];
    event.target.value = "";
    if (!file || !organizationId) return;
    setUploadingImage(true);
    try {
      const imageUrl = await uploadLeagueImage(organizationId, file);
      setPlanning((current) => ({ ...current, imageUrl }));
      toast.success("League image uploaded. Save the setup to apply it everywhere.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The league image could not be uploaded.");
    } finally {
      setUploadingImage(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/15 bg-primary/[0.04] px-3 py-2 text-xs">
        <div className="flex items-center gap-2 text-muted-foreground" aria-live="polite">
          <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
          <span>{draftRestored ? "Draft restored and autosaving." : draftSavedAt ? "Draft saved in this browser." : "Autosaving changes in this browser."}</span>
        </div>
        {draftSavedAt || hasMeaningfulLeagueSeasonEditorDraft(draftSnapshot, draftBaselineRef.current) ? (
          <button type="button" onClick={handleDiscardDraft} className="font-semibold text-destructive hover:text-destructive/80">
            Discard draft
          </button>
        ) : null}
      </div>
      <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-xl border border-border/70 bg-background/55">
          <div className="relative h-32 overflow-hidden bg-muted sm:h-36 lg:h-full lg:min-h-40">
            <img src={resolveLeagueImageUrl(null, planning.imageUrl)} alt="League main image preview" className="h-full w-full object-cover" />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/75 via-black/45 to-transparent px-3 pb-2.5 pt-8 text-white">
              <div><div className="text-[8px] font-bold uppercase tracking-[0.18em] text-white/75">Main image</div><div className="text-[10px] font-semibold">Cards + public hero</div></div>
              <label className="inline-flex h-8 cursor-pointer items-center rounded-full border border-white/30 bg-black/35 px-3 text-[10px] font-semibold backdrop-blur-sm transition-colors hover:bg-black/55">
                {uploadingImage ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="mr-1.5 h-3.5 w-3.5" />}
                {uploadingImage ? "Uploading" : "Replace"}
                <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Upload league main image" className="sr-only" disabled={uploadingImage} onChange={handleImageChange} />
              </label>
            </div>
          </div>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          <label className="block space-y-1 xl:col-span-2"><span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">League name</span><Input required aria-label="League name" value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="block space-y-1"><span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Season year</span><Input required aria-label="Season year" type="number" min="2020" max="2100" value={year} onChange={(event) => setYear(event.target.value)} /></label>
          <div className="block space-y-1" aria-label="Publication status">
            <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Publication</span>
            <div className="flex h-10 items-center rounded-xl border border-border bg-background px-3 text-sm font-semibold">
              {season.isPublic ? "Public" : "Private draft"}
            </div>
          </div>
          <label className="block space-y-1"><span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Starts</span><Input aria-label="Season start date" type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></label>
          <label className="block space-y-1"><span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Ends</span><Input aria-label="Season end date" type="date" min={startsOn || undefined} value={endsOn} onChange={(event) => setEndsOn(event.target.value)} /></label>
          <label className="block space-y-1 sm:col-span-2 xl:col-span-2"><span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Public league summary</span><Textarea aria-label="Public league summary" rows={4} value={planning.seasonBrief} onChange={(event) => setPlanning((current) => ({ ...current, seasonBrief: event.target.value }))} placeholder="A short, direct overview shown to athletes." /></label>
          <label className="block space-y-1 sm:col-span-2 xl:col-span-2"><span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">About the league <span className="normal-case tracking-normal">(optional)</span></span><Textarea aria-label="About the league" rows={4} value={planning.aboutLeague} onChange={(event) => setPlanning((current) => ({ ...current, aboutLeague: event.target.value }))} placeholder="Describe the league, terrain, season, and eligibility for the public page." /></label>
        </div>
      </div>
      <div className="mt-3 rounded-xl border border-border/70 bg-background/55 p-3">
        <SportSelector
          selectedSportCodes={sportCodes}
          primarySportCode={primarySportCode}
          onChange={(nextSportCodes, nextPrimarySportCode) => {
            setSportCodes(nextSportCodes);
            setPrimarySportCode(nextPrimarySportCode);
          }}
          description="Choose the sports whose races can count toward this league."
        />
      </div>
      <div className="mt-3 flex justify-end border-t border-border/70 pt-3">
        <Button type="submit" size="sm" className="h-8 rounded-full px-3 text-[10px] font-semibold" disabled={saving || uploadingImage}>
          {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
          Save league setup
        </Button>
      </div>
    </form>
  );
}

type LeagueSeasonEditorProps = {
  season?: OrganizerManagedLeagueSeason;
  events?: OrganizerManagedEvent[];
  trigger?: ReactNode;
  onSaved: (savedSeason?: OrganizerManagedLeagueSeason | null) => Promise<void>;
  embeddedSection?: "categories" | "operations";
};

function buildLeagueSeasonEditorBaseline(
  season: OrganizerManagedLeagueSeason | undefined,
  firstStep: number,
): LeagueSeasonEditorDraftData {
  const planning = buildLeaguePlanningFromSource({
    description: season?.description
      ? getSibenikTrailLeagueEnglishCopy(season.description, season.name, season.slug)
      : null,
    scoringRules: season?.scoringRules ?? null,
    organizerNotes: season?.organizerNotes ?? null,
    clubScoringScope: season?.clubScoringScope ?? null,
  });
  const competitionDrafts = buildLeagueCompetitionDrafts(season?.competitions, planning);
  const firstCompetitionWithIssue = competitionDrafts.find(
    (competition) => validateLeagueCompetitionDraft(competition, planning),
  );
  return {
    step: firstStep,
    name: getSibenikTrailLeagueDisplayName(season?.name ?? "", season?.slug),
    year: String(season?.year ?? new Date().getFullYear()),
    startsOn: season?.startsOn ?? "",
    endsOn: season?.endsOn ?? "",
    organizerRules: season?.organizerRules ?? "",
    status: season?.isPublic ? season.seasonStatus : "draft",
    sportCodes: season?.sportCodes ?? [DEFAULT_SPORT_CODE],
    primarySportCode: season?.primarySportCode ?? DEFAULT_SPORT_CODE,
    planning,
    competitionDrafts,
    activeCompetitionKey: (season ? firstCompetitionWithIssue : null)?.key ?? competitionDrafts[0]?.key ?? "",
  };
}

function LeagueSeasonEditor({
  season,
  events = [],
  trigger,
  onSaved,
  embeddedSection,
}: LeagueSeasonEditorProps) {
  const { locale, t } = useI18n();
  const { account } = useOrganizerAuth();
  const dialogContentRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const firstStep = embeddedSection === "operations" ? 3 : season ? 2 : 1;
  const workflowSteps = season
    ? leagueCreationWorkflowSteps.filter((item) => item.step !== 1)
    : leagueCreationWorkflowSteps;
  const baseline = useMemo(
    () => buildLeagueSeasonEditorBaseline(season, firstStep),
    [firstStep, season],
  );
  const editorScope = season
    ? `${season.seasonId}.${embeddedSection ?? "dialog"}`
    : "create";
  const draftStorageKey = account?.userId
    ? leagueSeasonEditorDraftStorageKey(
        account.userId,
        account.organizationIds[0] ?? "unscoped",
        editorScope,
      )
    : null;
  const [step, setStep] = useState(baseline.step);
  const [name, setName] = useState(baseline.name);
  const [year, setYear] = useState(baseline.year);
  const [startsOn, setStartsOn] = useState(baseline.startsOn);
  const [endsOn, setEndsOn] = useState(baseline.endsOn);
  const [organizerRules, setOrganizerRules] = useState(baseline.organizerRules);
  const [status, setStatus] = useState(baseline.status);
  const [sportCodes, setSportCodes] = useState<SportCode[]>(baseline.sportCodes);
  const [primarySportCode, setPrimarySportCode] = useState<SportCode>(baseline.primarySportCode);
  const [planning, setPlanning] = useState<LeagueSeasonPlanningDraft>(baseline.planning);
  const [competitionDrafts, setCompetitionDrafts] = useState<LeagueCompetitionDraft[]>(baseline.competitionDrafts);
  const [activeCompetitionKey, setActiveCompetitionKey] = useState(baseline.activeCompetitionKey);
  const [saving, setSaving] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const initializedEditorSessionRef = useRef<string | null>(null);
  const draftBaselineRef = useRef(baseline);
  const draftSnapshot = useMemo<LeagueSeasonEditorDraftData>(() => ({
    step,
    name,
    year,
    startsOn,
    endsOn,
    organizerRules,
    status,
    sportCodes,
    primarySportCode,
    planning,
    competitionDrafts,
    activeCompetitionKey,
  }), [
    activeCompetitionKey,
    competitionDrafts,
    endsOn,
    name,
    organizerRules,
    planning,
    primarySportCode,
    sportCodes,
    startsOn,
    status,
    step,
    year,
  ]);

  const applyEditorDraft = useCallback((draft: LeagueSeasonEditorDraftData) => {
    setStep(draft.step);
    setName(draft.name);
    setYear(draft.year);
    setStartsOn(draft.startsOn);
    setEndsOn(draft.endsOn);
    setOrganizerRules(draft.organizerRules);
    setStatus(season?.isPublic ? draft.status : "draft");
    setSportCodes(draft.sportCodes);
    setPrimarySportCode(draft.primarySportCode);
    setPlanning(draft.planning);
    setCompetitionDrafts(draft.competitionDrafts);
    setActiveCompetitionKey(draft.activeCompetitionKey);
  }, [season?.isPublic]);

  useEffect(() => {
    const active = open || Boolean(embeddedSection);
    if (!active) {
      initializedEditorSessionRef.current = null;
      setDraftReady(false);
      return;
    }
    const editorSessionKey = `${draftStorageKey ?? editorScope}:${embeddedSection ?? "dialog"}`;
    if (initializedEditorSessionRef.current === editorSessionKey) return;

    const storedDraft = draftStorageKey && typeof window !== "undefined"
      ? loadLeagueSeasonEditorDraft(window.localStorage, draftStorageKey, baseline)
      : null;
    draftBaselineRef.current = baseline;
    applyEditorDraft(storedDraft ?? baseline);
    setDraftSavedAt(storedDraft?.updatedAt ?? null);
    setDraftRestored(Boolean(storedDraft));
    initializedEditorSessionRef.current = editorSessionKey;
    setDraftReady(true);
  }, [applyEditorDraft, baseline, draftStorageKey, editorScope, embeddedSection, open]);

  useEffect(() => {
    const active = open || Boolean(embeddedSection);
    if (!active || !draftReady || !draftStorageKey || typeof window === "undefined") return;

    const timeoutId = window.setTimeout(() => {
      try {
        if (!hasMeaningfulLeagueSeasonEditorDraft(draftSnapshot, draftBaselineRef.current)) {
          removeLeagueSeasonEditorDraft(window.localStorage, draftStorageKey);
          setDraftSavedAt(null);
          setDraftRestored(false);
          return;
        }
        const savedDraft = saveLeagueSeasonEditorDraft(
          window.localStorage,
          draftStorageKey,
          draftSnapshot,
        );
        setDraftSavedAt(savedDraft.updatedAt);
      } catch {
        toast.error("Unable to autosave the league draft in this browser.");
      }
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [draftReady, draftSnapshot, draftStorageKey, embeddedSection, open]);

  useEffect(() => {
    if (!open || embeddedSection) return;
    dialogContentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [embeddedSection, open, step]);

  function persistDraftNow() {
    if (!draftReady || !draftStorageKey || typeof window === "undefined") return;
    try {
      if (!hasMeaningfulLeagueSeasonEditorDraft(draftSnapshot, draftBaselineRef.current)) {
        removeLeagueSeasonEditorDraft(window.localStorage, draftStorageKey);
        setDraftSavedAt(null);
        return;
      }
      const savedDraft = saveLeagueSeasonEditorDraft(window.localStorage, draftStorageKey, draftSnapshot);
      setDraftSavedAt(savedDraft.updatedAt);
    } catch {
      toast.error("Unable to save the league draft in this browser.");
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) persistDraftNow();
    setOpen(nextOpen);
  }

  function handleDiscardDraft() {
    if (draftStorageKey && typeof window !== "undefined") {
      removeLeagueSeasonEditorDraft(window.localStorage, draftStorageKey);
    }
    draftBaselineRef.current = baseline;
    applyEditorDraft(baseline);
    setDraftSavedAt(null);
    setDraftRestored(false);
    toast.success("League work-in-progress draft discarded.");
  }

  function validateLeagueBasics() {
    if (!name.trim()) {
      return "League name is required.";
    }

    const parsedYear = Number.parseInt(year, 10);
    if (!Number.isFinite(parsedYear) || parsedYear < 2020 || parsedYear > 2100) {
      return "Enter a valid season year.";
    }

    if (!planning.seasonBrief.trim()) {
      return "Add a short season brief before continuing.";
    }

    if (startsOn && endsOn && endsOn < startsOn) {
      return "Season end date must be on or after its start date.";
    }

    const plannedRoundCount = Number.parseInt(planning.plannedRoundCount, 10);
    if (!Number.isFinite(plannedRoundCount) || plannedRoundCount < 1) {
      return "Planned rounds must be at least 1.";
    }

    return null;
  }

  function validateLeagueWorkflow() {
    const basicsValidationError = season ? null : validateLeagueBasics();
    if (basicsValidationError) return basicsValidationError;

    const competitionValidationError = validateLeagueCompetitionDrafts(competitionDrafts, planning);
    if (competitionValidationError) return competitionValidationError;

    const firstCompetition = competitionDrafts[0];
    if (firstCompetition?.standingsMode !== "points") return null;
    const firstPointsTable = firstCompetition
      ? getLeagueCompetitionPointsTable(firstCompetition)
      : [];
    return validateLeaguePlanningDraft({
      ...planning,
      roundMappingStrategy: "race_categories",
      scoringMethod: firstCompetition?.scoringMethod ?? planning.scoringMethod,
      maximumPoints: firstCompetition?.maximumPoints ?? planning.maximumPoints,
      expectedFinishers: firstCompetition?.expectedFinishers ?? planning.expectedFinishers,
      hybridEmphasis: firstCompetition?.hybridEmphasis ?? planning.hybridEmphasis,
      pointsTablePreset: firstCompetition?.scoringMethod === "custom"
        ? firstCompetition.pointsTablePreset
        : "custom",
      customPoints: firstPointsTable.length ? firstPointsTable.join(", ") : planning.customPoints,
      participationPoints: firstCompetition?.participationPoints ?? planning.participationPoints,
      countingMode: firstCompetition?.countingMode ?? planning.countingMode,
      bestN: firstCompetition?.bestN ?? planning.bestN,
      minimumRounds: firstCompetition?.minimumRounds ?? planning.minimumRounds,
      tieBreakMethod: firstCompetition?.tieBreakMethod ?? planning.tieBreakMethod,
    });
  }

  function handleNextStep() {
    const validationError = step === 1
      ? validateLeagueBasics()
      : step === 2
        ? validateLeagueWorkflow()
        : null;
    if (validationError) {
      if (step === 2) {
        const competitionWithIssue = competitionDrafts.find(
          (competition) => validateLeagueCompetitionDraft(competition, planning),
        );
        if (competitionWithIssue) setActiveCompetitionKey(competitionWithIssue.key);
      }
      toast.error(localizeOrganizerLeagueText(validationError, locale));
      return;
    }

    if (step === 1) {
      const competitionWithIssue = competitionDrafts.find(
        (competition) => validateLeagueCompetitionDraft(competition, planning),
      );
      if (competitionWithIssue) setActiveCompetitionKey(competitionWithIssue.key);
    }

    setStep((current) => Math.min(workflowSteps[workflowSteps.length - 1]?.step ?? current, current + 1));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!account) return;
    persistDraftNow();
    const parsedYear = Number.parseInt(year, 10);
    const validationError = validateLeagueWorkflow();
    if (validationError) {
      if (!season && validateLeagueBasics()) {
        setStep(1);
      } else {
        const competitionWithIssue = competitionDrafts.find(
          (competition) => validateLeagueCompetitionDraft(competition, planning),
        );
        if (competitionWithIssue) {
          setActiveCompetitionKey(competitionWithIssue.key);
          setStep(2);
        } else {
          setStep(3);
        }
      }
      toast.error(localizeOrganizerLeagueText(validationError, locale));
      return;
    }

    setSaving(true);
    try {
      const firstCompetition = competitionDrafts[0];
      const firstPointsTable = firstCompetition
        ? getLeagueCompetitionPointsTable(firstCompetition)
        : [];
      const planningForSave: LeagueSeasonPlanningDraft = {
        ...planning,
        roundMappingStrategy: "race_categories",
        scoringMethod: firstCompetition?.scoringMethod ?? planning.scoringMethod,
        maximumPoints: firstCompetition?.maximumPoints ?? planning.maximumPoints,
        expectedFinishers: firstCompetition?.expectedFinishers ?? planning.expectedFinishers,
        hybridEmphasis: firstCompetition?.hybridEmphasis ?? planning.hybridEmphasis,
        pointsTablePreset: firstCompetition?.scoringMethod === "custom"
          ? firstCompetition.pointsTablePreset
          : "custom",
        customPoints: firstPointsTable.length ? firstPointsTable.join(", ") : planning.customPoints,
        participationPoints: firstCompetition?.participationPoints ?? planning.participationPoints,
        countingMode: firstCompetition?.countingMode ?? planning.countingMode,
        bestN: firstCompetition?.bestN ?? planning.bestN,
        minimumRounds: firstCompetition?.minimumRounds ?? planning.minimumRounds,
        tieBreakMethod: firstCompetition?.tieBreakMethod ?? planning.tieBreakMethod,
      };
      const generatedDescription = buildLeaguePlanningDescription(planningForSave);
      const competitions = buildLeagueCompetitionInputs(competitionDrafts, planningForSave);
      const scoringRules = competitions[0]?.scoringRules ?? null;
      let savedSeason: OrganizerManagedLeagueSeason | null = null;
      if (season) {
        savedSeason = await updateOrganizerLeagueSeason(account, {
          leagueId: season.leagueId,
          seasonId: season.seasonId,
          name: name.trim(),
          sportCodes,
          primarySportCode,
          description: generatedDescription,
          organizerNotes: planningForSave.organizerNotes,
          organizerRules: organizerRules.trim() || null,
          year: parsedYear,
          startsOn: startsOn || null,
          endsOn: endsOn || null,
          timezone: season.timezone || "Europe/Zagreb",
          status,
          scoringRules,
          clubScoringScope: planningForSave.clubScoringScope,
          competitions,
        });
        toast.success("League season updated.");
      } else {
        savedSeason = await createOrganizerLeagueSeason(account, {
          organizationId: account.organizationIds[0],
          name: name.trim(),
          sportCodes,
          primarySportCode,
          description: generatedDescription,
          organizerNotes: planningForSave.organizerNotes,
          organizerRules: organizerRules.trim() || null,
          year: parsedYear,
          startsOn: startsOn || null,
          endsOn: endsOn || null,
          timezone: "Europe/Zagreb",
          status,
          scoringRules,
          clubScoringScope: planningForSave.clubScoringScope,
          competitions,
        });
        toast.success("League season created.");
      }

      if (draftStorageKey && typeof window !== "undefined") {
        removeLeagueSeasonEditorDraft(window.localStorage, draftStorageKey);
      }
      draftBaselineRef.current = draftSnapshot;
      setDraftSavedAt(null);
      setDraftRestored(false);
      setStep(firstStep);
      if (!embeddedSection) setOpen(false);
      void onSaved(savedSeason).catch(() => {
        toast.error("The league was saved, but the refreshed view could not be loaded yet.");
      });
    } catch (error) {
      persistDraftNow();
      toast.error(formatOrganizerLeagueApiError(error));
    } finally {
      setSaving(false);
    }
  }

  function renderWizardStepContent() {
    if (step === 1) {
      return (
        <div className="rounded-xl border border-border/70 bg-background/60 p-3">
          <div className="mb-3">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Season basics</div>
            <h3 className="mt-1 font-display text-base font-bold">Season details</h3>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="block space-y-1.5 xl:col-span-2">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">League Name</span>
              <Input
                required
                value={name}
                onChange={(inputEvent) => setName(inputEvent.target.value)}
                placeholder="Šibenik Trail League"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Season Year</span>
              <Input
                required
                type="number"
                min="2020"
                max="2100"
                value={year}
                onChange={(inputEvent) => setYear(inputEvent.target.value)}
              />
            </label>
            <div className="block space-y-1.5" aria-label="Publication status">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Publication</span>
              <div className="flex h-10 items-center rounded-xl border border-border bg-card px-3 text-sm font-semibold">
                Private draft
              </div>
              <p className="text-[10px] leading-4 text-muted-foreground">
                Add rounds, then publish from the league review.
              </p>
            </div>
            <label className="block space-y-1.5 sm:col-span-2 xl:col-span-3">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Season Brief</span>
              <Textarea
                value={planning.seasonBrief}
                onChange={(event) => setPlanning({ ...planning, seasonBrief: event.target.value })}
                rows={2}
                placeholder="Short public league description."
              />
            </label>

            <label className="block space-y-1.5 sm:col-span-2 xl:col-span-4">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">League Rules <span className="normal-case tracking-normal">(optional)</span></span>
              <Textarea
                aria-label="League rules"
                rows={6}
                maxLength={20_000}
                value={organizerRules}
                onChange={(event) => setOrganizerRules(event.target.value)}
                placeholder="Eligibility, counted rounds, protests, penalties, exceptions, awards, and league-wide obligations."
              />
              <span className="block text-[10px] leading-4 text-muted-foreground">These rules appear on the public league Rules tab. Race-day safety and entry terms stay with each race.</span>
            </label>

            <label className="block space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Planned Rounds</span>
              <Input
                type="number"
                min="1"
                value={planning.plannedRoundCount}
                onChange={(event) => setPlanning({ ...planning, plannedRoundCount: event.target.value })}
              />
            </label>

            <fieldset
              aria-label="Season dates"
              className="grid grid-cols-1 gap-3 sm:col-span-2 sm:grid-cols-2 xl:col-span-2 xl:col-start-1"
            >
              <legend className="sr-only">Season dates</legend>
              <label className="block space-y-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Starts</span>
                <Input
                  aria-label="Season start date"
                  type="date"
                  value={startsOn}
                  onChange={(event) => setStartsOn(event.target.value)}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Ends</span>
                <Input
                  aria-label="Season end date"
                  type="date"
                  min={startsOn || undefined}
                  value={endsOn}
                  onChange={(event) => setEndsOn(event.target.value)}
                />
              </label>
            </fieldset>
          </div>
          <div className="mt-3 rounded-xl border border-border/70 bg-card/60 p-3">
            <SportSelector
              selectedSportCodes={sportCodes}
              primarySportCode={primarySportCode}
              onChange={(nextSportCodes, nextPrimarySportCode) => {
                setSportCodes(nextSportCodes);
                setPrimarySportCode(nextPrimarySportCode);
              }}
              description="Choose the sports whose races can count toward this league."
            />
          </div>
        </div>
      );
    }

    if (step === 2) {
      const activeCompetition = competitionDrafts.find(
        (competition) => competition.key === activeCompetitionKey,
      ) ?? competitionDrafts[0];

      function updateActiveCompetition(patch: Partial<LeagueCompetitionDraft>) {
        if (!activeCompetition) return;
        setCompetitionDrafts((current) => current.map((competition) =>
          competition.key === activeCompetition.key ? { ...competition, ...patch } : competition
        ));
      }

      return (
        <div className="space-y-3 rounded-xl border border-border/70 bg-background/45 p-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{t("organizer.league.competition.title")}</div>
              <h3 className="mt-1 font-display text-base font-bold">{t("organizer.league.competition.settingsTitle")}</h3>
            </div>
            <p className="text-xs text-muted-foreground">{t("organizer.league.competition.settingsHelp")}</p>
          </div>

          <div
            role="tablist"
            aria-label={t("organizer.league.competition.title")}
            className="flex flex-wrap items-center gap-1.5 border-b border-border/70 pb-2"
          >
            {competitionDrafts.map((competition) => {
              const active = competition.key === activeCompetition?.key;
              const categoryName = competition.name || "Untitled category";
              const categoryIssue = validateLeagueCompetitionDraft(competition, planning);
              return (
                <div
                  key={competition.key}
                  className={`inline-flex items-center rounded-lg border transition-colors ${active ? "border-primary bg-primary/10 text-primary" : categoryIssue ? "border-destructive/40 bg-destructive/[0.035] text-foreground" : "border-border/70 bg-card/70 text-foreground hover:bg-muted/50"}`}
                >
                  <button
                    type="button"
                    role="tab"
                    id={`league-competition-tab-${competition.key}`}
                    aria-selected={active}
                    aria-controls={`league-competition-panel-${competition.key}`}
                    onClick={() => setActiveCompetitionKey(competition.key)}
                    className="inline-flex min-h-8 items-center gap-2 rounded-lg px-2.5 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
                  >
                    <span className="text-sm font-semibold">{categoryName}</span>
                    {categoryIssue ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-destructive">
                        <AlertCircle className="h-3 w-3" />
                        Fix setup
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {competition.isDefault
                          ? "Public default"
                          : getLeaguePlanningOptionLabel(
                              competition.standingsMode === "points" ? leagueScoringMethodOptions : leagueStandingsModeOptions,
                              competition.standingsMode === "points" ? competition.scoringMethod : competition.standingsMode,
                            )}
                      </span>
                    )}
                  </button>
                  {competitionDrafts.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${categoryName}`}
                      className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => {
                        const remaining = competitionDrafts.filter(
                          (candidate) => candidate.key !== competition.key,
                        );
                        if (competition.isDefault && remaining[0]) {
                          remaining[0] = { ...remaining[0], isDefault: true };
                        }
                        setCompetitionDrafts(remaining);
                        if (active) setActiveCompetitionKey(remaining[0]?.key ?? "");
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>
              );
            })}

            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-9 rounded-lg px-3"
              onClick={() => {
                const nextCompetition = createAdditionalLeagueCompetitionDraft(
                  planning,
                  competitionDrafts.length,
                );
                setCompetitionDrafts((current) => [...current, nextCompetition]);
                setActiveCompetitionKey(nextCompetition.key);
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Add
            </Button>
          </div>

          <LeagueCourseCompetitionBuilder
            events={events}
            season={season}
            competitions={competitionDrafts}
            activeCompetitionKey={activeCompetitionKey}
            sportCodes={sportCodes}
            onChange={(drafts) => {
              setCompetitionDrafts(drafts);
              setActiveCompetitionKey(drafts[0]?.key ?? "");
            }}
          />

          {activeCompetition ? (
            <div
              role="tabpanel"
              id={`league-competition-panel-${activeCompetition.key}`}
              aria-labelledby={`league-competition-tab-${activeCompetition.key}`}
              className="w-full"
            >
              <LeagueCompetitionCourseHelp competitionKey={activeCompetition.key} season={season} bestTime={activeCompetition.standingsMode === "best_time"} />
              {competitionDrafts.length > 1 ? <div className="my-3 space-y-1">
                <Button type="button" variant="secondary" className="h-auto max-w-full whitespace-normal text-left" onClick={() => {
                  setCompetitionDrafts((current) => current.map((draft) => copyCompetitionRules(activeCompetition, draft)));
                  toast.success(t("organizer.league.competition.rulesCopied"));
                }}>{t("organizer.league.competition.copyRules")}</Button>
                <p className="text-xs text-muted-foreground">{t("organizer.league.competition.copyHelp")}</p>
              </div> : null}
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-2">
                <div className="text-xs font-semibold">{t("organizer.league.competition.publicDefault")}</div>
                <Button
                  type="button"
                  variant={activeCompetition.isDefault ? "secondary" : "outline"}
                  size="sm"
                  className="h-8 rounded-lg"
                  aria-pressed={activeCompetition.isDefault}
                  onClick={() => setCompetitionDrafts((current) => current.map((competition) => ({
                    ...competition,
                    isDefault: competition.key === activeCompetition.key,
                  })))}
                >
                  <CheckCircle2 className="mr-1.5 h-4 w-4" />
                  {activeCompetition.isDefault ? "Current default" : "Set as default"}
                </Button>
              </div>
              <LeagueCompetitionScoringEditor
                competition={activeCompetition}
                planning={planning}
                onChange={updateActiveCompetition}
              />
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Add a league race category to continue.
            </div>
          )}

          {competitionDrafts.some((competition) => competition.standingsMode === "points") ? <LeagueClubScoringEditor
            competitions={competitionDrafts.filter((competition) => competition.standingsMode === "points")}
            value={planning.clubScoringMode}
            scope={planning.clubScoringScope}
            onChange={(clubScoringMode, clubScoringScope) => setPlanning({
              ...planning,
              clubScoringMode,
              clubScoringScope,
            })}
          /> : <p className="text-xs text-muted-foreground">{t("organizer.league.competition.clubPointsOnly")}</p>}
        </div>
      );
    }


    const scoringGroupCount = competitionDrafts.reduce(
      (total, competition) => total + competition.classifications.length,
      0,
    );
    const summaryPills = [
      { label: "Season", value: `${name.trim() || "Untitled league"} · ${year}` },
      { label: "Rounds", value: `${planning.plannedRoundCount} planned` },
      { label: "Race categories", value: String(competitionDrafts.length) },
      { label: "Scoring groups", value: String(scoringGroupCount) },
    ];

    return (
      <div className="space-y-3 rounded-xl border border-border/70 bg-background/60 p-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Operations & review</div>
            <h3 className="mt-1 font-display text-base font-bold">Finish league setup</h3>
          </div>
          <span className="timing-lime-pill rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider">
            Ready to save
          </span>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {summaryPills.map((item) => (
            <div key={item.label} className="rounded-xl border border-border/70 bg-card/75 px-3 py-2.5">
              <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{item.label}</div>
              <div className="mt-0.5 truncate text-sm font-semibold">{item.value}</div>
            </div>
          ))}
        </div>

        <div>
          <section className="rounded-xl border border-border/70 bg-card/70 p-3">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-primary/10 p-2 text-primary"><Calendar className="h-4 w-4" /></div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Race operations</div>
                <div className="text-sm font-bold">Results and closeout</div>
              </div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              <LeaguePlanningSelectField
                label="Results cadence"
                value={planning.resultsCadence}
                options={leagueResultsCadenceOptions}
                onChange={(value) => setPlanning({ ...planning, resultsCadence: value })}
              />
              <LeaguePlanningSelectField
                label="Protest window"
                value={planning.protestWindow}
                options={leagueProtestWindowOptions}
                onChange={(value) => setPlanning({ ...planning, protestWindow: value })}
              />
              <LeaguePlanningSelectField
                label="Closeout plan"
                value={planning.closeoutPlan}
                options={leagueCloseoutOptions}
                onChange={(value) => setPlanning({ ...planning, closeoutPlan: value })}
              />
              <label className="block space-y-1.5 sm:col-span-3 xl:col-span-1">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Organizer notes</span>
                <Textarea
                  value={planning.organizerNotes}
                  onChange={(event) => setPlanning({ ...planning, organizerNotes: event.target.value })}
                  rows={2}
                  placeholder="Optional internal notes."
                />
              </label>
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-border/70 bg-card/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-primary/10 p-2 text-primary"><Users className="h-4 w-4" /></div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">League summary</div>
                <div className="text-sm font-bold">Race categories and scoring</div>
              </div>
            </div>
            <span className="rounded-full border border-border/70 bg-background px-3 py-1 text-[10px] font-semibold">
              {getLeagueClubScoringStructureLabel(planning.clubScoringMode, planning.clubScoringScope)}
            </span>
          </div>

          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {competitionDrafts.map((competition) => (
              <div key={competition.key} className="rounded-xl border border-border/70 bg-background/70 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-display text-sm font-bold">{competition.name}</div>
                  <div className="flex flex-wrap gap-1">
                    <span className="rounded-full border border-primary/15 bg-primary/[0.05] px-2 py-0.5 text-[9px] font-semibold text-primary">
                      {getLeaguePlanningOptionLabel(leagueScoringMethodOptions, competition.scoringMethod)}
                    </span>
                    <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[9px] font-semibold">
                      {competition.countingMode === "all_rounds" ? "All rounds" : `Best ${competition.bestN}`}
                    </span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {competition.classifications.length ? competition.classifications.map((classification) => (
                    <span key={classification.key} className="timing-lime-pill rounded-full border px-2.5 py-1 text-[10px] font-semibold">
                      {classification.name} · {describeLeagueClassification(classification)}
                    </span>
                  )) : (
                    <span className="rounded-full border border-dashed border-border px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">
                      No scoring groups
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  if (embeddedSection) {
    return (
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/15 bg-primary/[0.04] px-3 py-2 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground" aria-live="polite">
            <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
            <span>{draftRestored ? "Draft restored and autosaving." : draftSavedAt ? "Draft saved in this browser." : "Autosaving changes in this browser."}</span>
          </div>
          {draftSavedAt || hasMeaningfulLeagueSeasonEditorDraft(draftSnapshot, draftBaselineRef.current) ? (
            <button type="button" onClick={handleDiscardDraft} className="font-semibold text-destructive hover:text-destructive/80">
              Discard draft
            </button>
          ) : null}
        </div>
        {renderWizardStepContent()}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
          <p className="text-xs text-muted-foreground">
            {embeddedSection === "categories"
              ? t("organizer.league.competition.saveHelp")
              : "Save results cadence, closeout, and organizer notes together."}
          </p>
          <Button type="submit" size="sm" className="h-9 rounded-full px-4" disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {embeddedSection === "categories" ? t("organizer.league.competition.save") : "Save operations"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger ?? defaultLeagueDialogTrigger(season)}</DialogTrigger>
      <DialogContent
        ref={dialogContentRef}
        overlayClassName={LEAGUE_EDITOR_DIALOG_OVERLAY_CLASS}
        className={`${LEAGUE_EDITOR_DIALOG_CLASS} sm:max-w-5xl`}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-bold">
            {season ? "Edit competitions" : "Create League"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {season
              ? "Edit league race categories, per-category scoring, and competition operations."
              : "Define the season, league race categories, per-category scoring, and operations before adding race rounds."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/15 bg-primary/[0.04] px-3 py-2 text-xs">
            <div className="flex items-center gap-2 text-muted-foreground" aria-live="polite">
              <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
              <span>{draftRestored ? "Draft restored and autosaving." : draftSavedAt ? "Draft saved in this browser." : "Autosaving in this browser."}</span>
            </div>
            {draftSavedAt || hasMeaningfulLeagueSeasonEditorDraft(draftSnapshot, draftBaselineRef.current) ? (
              <button type="button" onClick={handleDiscardDraft} className="font-semibold text-destructive hover:text-destructive/80">
                Discard draft
              </button>
            ) : null}
          </div>
          <div className={`grid gap-2 ${workflowSteps.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3"}`}>
            {workflowSteps.map((item) => {
              const active = item.step === step;
              const done = item.step < step;
              const reachable = item.step <= step + 1;
              return (
                <button
                  key={item.step}
                  type="button"
                  aria-current={active ? "step" : undefined}
                  disabled={!reachable}
                  onClick={() => {
                    if (item.step <= step) {
                      setStep(item.step);
                    } else {
                      handleNextStep();
                    }
                  }}
                  className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                    active
                      ? "border-primary bg-primary/5 shadow-[0_0_0_1px_hsl(var(--primary)/0.18)]"
                      : reachable
                        ? "border-border bg-background/60 hover:bg-secondary/60"
                        : "cursor-not-allowed border-border bg-background/40 opacity-65"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`font-display text-sm font-bold ${active ? "text-primary" : "text-muted-foreground"}`}>0{item.step}</div>
                    <div className="min-w-0 flex-1 truncate text-sm font-semibold">{item.title}</div>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                        done
                          ? "bg-primary/10 text-primary"
                          : active
                            ? "bg-trail-amber/15 text-trail-amber"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {done ? <CheckCircle2 className="h-3 w-3" /> : null}
                      {done ? "done" : active ? "current" : "next"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          <div>{renderWizardStepContent()}</div>

          <div className="sticky bottom-0 z-20 -mx-6 -mb-6 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 bg-background/95 px-6 py-3 backdrop-blur-xl">
            <div className="text-xs font-medium text-muted-foreground">
              Step {workflowSteps.findIndex((item) => item.step === step) + 1} of {workflowSteps.length}
            </div>
            <div className="flex flex-wrap gap-2">
              {step > firstStep ? (
                <Button type="button" variant="ghost" onClick={() => setStep((current) => Math.max(firstStep, current - 1))}>
                  <ChevronLeft className="mr-2 h-4 w-4" />
                  Back
                </Button>
              ) : null}
              {step < (workflowSteps[workflowSteps.length - 1]?.step ?? step) ? (
                <Button type="button" onClick={handleNextStep}>
                  Next
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              ) : null}
              <Button type="submit" variant={step < (workflowSteps[workflowSteps.length - 1]?.step ?? step) ? "secondary" : "default"} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {season ? "Save League" : "Create League"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LeagueSeasonDialog(props: Omit<LeagueSeasonEditorProps, "embeddedSection">) {
  return <LeagueSeasonEditor {...props} />;
}

export function LeagueCompetitionWorkspace({
  season,
  events = [],
  section,
  onSaved,
}: {
  season: OrganizerManagedLeagueSeason;
  events?: OrganizerManagedEvent[];
  section: "categories" | "operations";
  onSaved: () => Promise<void>;
}) {
  return (
    <LeagueSeasonEditor
      season={season}
      events={events}
      embeddedSection={section}
      onSaved={onSaved}
    />
  );
}

function getLeagueSportCompatibleRaces(
  seasonSportCodes: SportCode[],
  races: OrganizerManagedEvent["categories"],
) {
  const leagueSportCodes = new Set(seasonSportCodes.length ? seasonSportCodes : [DEFAULT_SPORT_CODE]);
  return races.filter((race) => leagueSportCodes.has(race.sportCode ?? DEFAULT_SPORT_CODE));
}

export function LeagueRoundManager({
  season,
  events,
  eventsErrorMessage,
  onSaved,
}: {
  season: OrganizerManagedLeagueSeason;
  events: OrganizerManagedEvent[];
  eventsErrorMessage?: string | null;
  onSaved: () => Promise<void>;
  onEditCategories?: () => void;
}) {
  const { locale, t } = useI18n();
  const { account } = useOrganizerAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedRaceIds, setSelectedRaceIds] = useState<Record<string, string>>({});
  const [mappingConfirmed, setMappingConfirmed] = useState(false);
  const [excludedCourseIds, setExcludedCourseIds] = useState<string[]>([]);
  const [selectedRoundNumber, setSelectedRoundNumber] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingRoundId, setEditingRoundId] = useState<string | null>(null);
  const [editingRaceIds, setEditingRaceIds] = useState<Record<string, string>>({});
  const [editingMappingConfirmed, setEditingMappingConfirmed] = useState(false);
  const [editingExcludedCourseIds, setEditingExcludedCourseIds] = useState<string[]>([]);
  const [savingRoundId, setSavingRoundId] = useState<string | null>(null);
  const [removingRoundId, setRemovingRoundId] = useState<string | null>(null);
  const [deleteAllRoundsOpen, setDeleteAllRoundsOpen] = useState(false);
  const [deletingAllRounds, setDeletingAllRounds] = useState(false);
  const [publishAllRacesOpen, setPublishAllRacesOpen] = useState(false);
  const [publishingAllRaces, setPublishingAllRaces] = useState(false);
  const returnSelectionHandledRef = useRef<string | null>(null);
  const seasonPlanning = getLeagueSeasonPlanning(season);
  const [plannedRoundCount, setPlannedRoundCount] = useState(seasonPlanning.plannedRoundCount);
  const [savingRoundPlan, setSavingRoundPlan] = useState(false);
  const roundPlanDirty = plannedRoundCount !== seasonPlanning.plannedRoundCount;
  const roundPickerRef = useRef<HTMLSelectElement>(null);
  const draftPlanning = { ...seasonPlanning, plannedRoundCount };
  const roundSlots = buildLeagueRoundSlots(season.rounds, buildLeaguePlanningDescription(draftPlanning));
  const emptyRoundSlots = roundSlots.filter((slot) => !slot.round);
  const targetRoundNumber = selectedRoundNumber != null
    && emptyRoundSlots.some((slot) => slot.roundNumber === selectedRoundNumber)
    ? selectedRoundNumber
    : emptyRoundSlots[0]?.roundNumber ?? season.rounds.length + 1;
  const scoredCompetitions = (season.competitions ?? []).filter(
    (competition) => competition.scoringTarget === "individual" && competition.status !== "archived",
  );
  const attachedEventIds = new Set(season.rounds.map((round) => round.eventEditionId));
  const availableEvents = events
    .map((event) => {
      const races = event.categories.filter(
        (category) => category.categoryType === "competitive",
      );
      return {
        ...event,
        races,
        compatibleRaces: getLeagueSportCompatibleRaces(season.sportCodes, races),
      };
    })
    .filter((event) => event.races.length > 0 && !attachedEventIds.has(event.id));
  const selectableEvents = availableEvents.filter((event) => event.compatibleRaces.length > 0);
  const eventsWithoutCompetitiveCourses = events.filter(
    (event) => !event.categories.some((category) => category.categoryType === "competitive"),
  ).length;
  const alreadyLinkedEvents = events.filter((event) => attachedEventIds.has(event.id)).length;
  const incompatibleSportEvents = availableEvents.filter((event) => event.compatibleRaces.length === 0).length;
  const requestedEventId = searchParams.get("selectEvent");
  const requestedRoundNumber = Number(searchParams.get("round"));
  const leagueReturnPath = `${location.pathname}?tab=rounds&round=${targetRoundNumber}`;
  const createRaceParams = new URLSearchParams({
    createRace: "1",
    returnTo: leagueReturnPath,
    leagueRound: String(targetRoundNumber),
  });
  const createRaceHref = `/organizer/events?${createRaceParams.toString()}`;
  const selectedEvent = selectableEvents.find((event) => event.id === selectedEventId) ?? null;
  const selectedMappings = scoredCompetitions.flatMap((competition) => selectedRaceIds[competition.id]
    ? [{ competitionId: competition.id, eventCategoryId: selectedRaceIds[competition.id] }] : []);
  const selectedCoverageIssue = selectedEvent ? getLeagueCourseCoverageIssue({
    competitionIds: scoredCompetitions.map((competition) => competition.id),
    courseIds: selectedEvent.races.map((race) => race.id),
    mappings: selectedMappings,
    excludedCourseIds,
  }) : "No race";
  const canAttachRound = !selectedCoverageIssue && mappingConfirmed;
  const linkedEventIds = new Set(season.rounds.map((round) => round.eventEditionId));
  const linkedEvents = events.filter((event) => linkedEventIds.has(event.id));
  const linkedCompetitiveRaces = linkedEvents
    .flatMap((event) => event.categories.filter((category) => category.categoryType === "competitive"));
  const draftLinkedRaceCount = linkedCompetitiveRaces.filter((race) => race.status === "draft").length;
  const privateLinkedEventCount = linkedEvents.filter(
    (event) => !event.publishedAt || event.publicVisibility === "private",
  ).length;
  const hasPendingLinkedPublication = draftLinkedRaceCount > 0 || privateLinkedEventCount > 0;

  useEffect(() => {
    setPlannedRoundCount(getLeagueSeasonPlanning(season).plannedRoundCount);
  }, [season]);

  useEffect(() => {
    if (!requestedEventId) {
      returnSelectionHandledRef.current = null;
      return;
    }
    const requestKey = `${requestedEventId}:${requestedRoundNumber}`;
    if (returnSelectionHandledRef.current === requestKey) return;
    const requestedEvent = selectableEvents.find((event) => event.id === requestedEventId);
    if (!requestedEvent) return;
    returnSelectionHandledRef.current = requestKey;

    if (Number.isInteger(requestedRoundNumber) && emptyRoundSlots.some((slot) => slot.roundNumber === requestedRoundNumber)) {
      setSelectedRoundNumber(requestedRoundNumber);
    }
    setSelectedEventId(requestedEvent.id);
    setMappingConfirmed(false);
    setExcludedCourseIds([]);
    setSelectedRaceIds(autoMapLeagueEventRaces(scoredCompetitions, requestedEvent.compatibleRaces));
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("selectEvent");
      next.delete("round");
      return next;
    }, { replace: true });
  }, [
    emptyRoundSlots,
    requestedEventId,
    requestedRoundNumber,
    scoredCompetitions,
    selectableEvents,
    setSearchParams,
  ]);

  async function handleSaveRoundPlan() {
    if (!account) return;
    const parsedCount = Number(plannedRoundCount);
    if (!Number.isInteger(parsedCount) || parsedCount < 0) {
      toast.error("Planned rounds must be zero or a positive whole number.");
      return;
    }

    setSavingRoundPlan(true);
    try {
      await updateOrganizerLeagueSeason(account, {
        leagueId: season.leagueId,
        seasonId: season.seasonId,
        description: buildLeaguePlanningDescription({
          ...seasonPlanning,
          plannedRoundCount: String(parsedCount),
        }),
      });
      setSelectedRoundNumber(null);
      await onSaved();
      toast.success("Round plan saved.");
    } catch (error) {
      toast.error(formatOrganizerLeagueApiError(error));
    } finally {
      setSavingRoundPlan(false);
    }
  }

  function handleEventSelection(eventEditionId: string) {
    const event = selectableEvents.find((candidate) => candidate.id === eventEditionId) ?? null;
    setSelectedEventId(eventEditionId);
    setMappingConfirmed(false);
    setExcludedCourseIds([]);
    setSelectedRaceIds(event
      ? autoMapLeagueEventRaces(scoredCompetitions, event.compatibleRaces)
      : {});
  }

  async function handleAttach() {
    if (!account || !selectedEvent || !canAttachRound) return;
    const mappings = scoredCompetitions.flatMap((competition) => {
      const eventCategoryId = selectedRaceIds[competition.id];
      return eventCategoryId ? [{ competitionId: competition.id, eventCategoryId }] : [];
    });
    setSaving(true);
    try {
      await attachOrganizerLeagueRound(account, season.seasonId, {
        eventEditionId: selectedEvent.id,
        roundNumber: targetRoundNumber,
        excludedCourseIds,
        mappings,
      });
      setSelectedEventId("");
      setSelectedRaceIds({});
      setMappingConfirmed(false);
      setExcludedCourseIds([]);
      setSelectedRoundNumber(null);
      await onSaved();
      toast.success(t(mappings.length === 1 ? "organizer.league.roundAddedMapping" : "organizer.league.roundAddedMappings", { count: mappings.length }));
    } catch (error) {
      toast.error(formatOrganizerLeagueApiError(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleDetach(roundId: string) {
    if (!account) return;
    setRemovingRoundId(roundId);
    try {
      await detachOrganizerLeagueRound(account, season.seasonId, roundId);
      window.dispatchEvent(new CustomEvent("sitrail:league-rounds-changed", {
        detail: { seasonId: season.seasonId },
      }));
      await onSaved();
      toast.success("League round removed.");
    } catch (error) {
      toast.error(formatOrganizerLeagueApiError(error));
    } finally {
      setRemovingRoundId(null);
    }
  }

  async function handleDeleteAllRounds() {
    if (!account || season.rounds.length === 0) return;
    setDeletingAllRounds(true);
    try {
      await detachAllOrganizerLeagueRounds(account, season.seasonId);
      setSelectedEventId("");
      setSelectedRaceIds({});
      setSelectedRoundNumber(null);
      setEditingRoundId(null);
      setDeleteAllRoundsOpen(false);
      window.dispatchEvent(new CustomEvent("sitrail:league-rounds-changed", {
        detail: { seasonId: season.seasonId },
      }));
      await onSaved();
      toast.success("All league rounds removed. Recurring rules were kept for later regeneration.");
    } catch (error) {
      toast.error(formatOrganizerLeagueApiError(error));
    } finally {
      setDeletingAllRounds(false);
    }
  }

  async function handlePublishAllRaces() {
    if (!account || !hasPendingLinkedPublication) return;
    setPublishingAllRaces(true);
    try {
      const result = await publishOrganizerLeagueSeasonRaces(account, season.seasonId);
      setPublishAllRacesOpen(false);
      await onSaved();
      toast.success(t("organizer.league.publishAllRacesSuccess", {
        races: result.publishedEventCount,
        courses: result.publishedRaceCount,
      }));
    } catch (error) {
      toast.error(formatOrganizerLeagueApiError(error));
    } finally {
      setPublishingAllRaces(false);
    }
  }

  function handleStartRoundEdit(round: OrganizerManagedLeagueSeason["rounds"][number]) {
    const savedMappings = Object.fromEntries(
      (round.mappings ?? [])
        .filter((mapping) => mapping.status === "mapped" && scoredCompetitions.some((competition) => competition.id === mapping.competitionId))
        .map((mapping) => [mapping.competitionId, mapping.eventCategoryId]),
    );
    setEditingRoundId(round.id);
    setEditingRaceIds(savedMappings);
    setEditingExcludedCourseIds(round.excludedCourseIds ?? []);
    setEditingMappingConfirmed(false);
  }

  async function handleSaveRoundMappings(round: OrganizerManagedLeagueSeason["rounds"][number]) {
    if (!account) return;
    const event = events.find((candidate) => candidate.id === round.eventEditionId);
    const races = (event?.categories ?? []).filter((category) => category.categoryType === "competitive");
    const issue = getLeagueCourseCoverageIssue({
      competitionIds: scoredCompetitions.map((competition) => competition.id),
      courseIds: races.map((race) => race.id),
      mappings: scoredCompetitions.flatMap((competition) => editingRaceIds[competition.id]
        ? [{ competitionId: competition.id, eventCategoryId: editingRaceIds[competition.id] }] : []),
      excludedCourseIds: editingExcludedCourseIds,
    });
    if (issue || !editingMappingConfirmed) return;
    const mappings = scoredCompetitions.flatMap((competition) => {
      const eventCategoryId = editingRaceIds[competition.id];
      return eventCategoryId ? [{ competitionId: competition.id, eventCategoryId }] : [];
    });

    setSavingRoundId(round.id);
    try {
      await attachOrganizerLeagueRound(account, season.seasonId, {
        eventEditionId: round.eventEditionId,
        excludedCourseIds: editingExcludedCourseIds,
        mappings,
      });
      await onSaved();
      setEditingRoundId(null);
      setEditingRaceIds({});
      setEditingMappingConfirmed(false);
      toast.success("Round race mappings updated.");
    } catch (error) {
      toast.error(formatOrganizerLeagueApiError(error));
    } finally {
      setSavingRoundId(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft" aria-labelledby="round-calendar-manager-title">
      <div className="border-b border-border/70 px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="min-w-0">
            <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Rounds setup</div>
            <h2 id="round-calendar-manager-title" className="mt-0.5 font-display text-base font-bold">Season calendar and race mappings</h2>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <div className="flex flex-wrap gap-1.5" aria-label="Round setup summary">
              <div className="inline-flex items-baseline gap-1.5 rounded-lg border border-primary/15 bg-primary/[0.055] px-2.5 py-1.5">
                <span className="text-sm font-bold text-primary">{season.rounds.length} / {roundSlots.length}</span>
                <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">linked</span>
              </div>
              <div className="inline-flex items-baseline gap-1.5 rounded-lg border border-border/70 bg-background/55 px-2.5 py-1.5">
                <span className="text-sm font-bold">{getLeagueUniqueEventCount(season)}</span>
                <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">races</span>
              </div>
              <div className="inline-flex items-baseline gap-1.5 rounded-lg border border-border/70 bg-background/55 px-2.5 py-1.5">
                <span className="text-sm font-bold">{scoredCompetitions.length}</span>
                <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">categories</span>
              </div>
            </div>
            <Dialog open={publishAllRacesOpen} onOpenChange={(open) => {
              if (!publishingAllRaces) setPublishAllRacesOpen(open);
            }}>
              <DialogTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 rounded-full px-3 text-[10px]"
                  disabled={!hasPendingLinkedPublication || publishingAllRaces}
                >
                  {publishingAllRaces
                    ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    : <Globe className="mr-1.5 h-3.5 w-3.5" />}
                  {t("organizer.league.publishAllRaces")}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{t("organizer.league.publishAllRacesTitle")}</DialogTitle>
                  <DialogDescription>
                    {t("organizer.league.publishAllRacesDescription", {
                      courses: draftLinkedRaceCount,
                      races: privateLinkedEventCount,
                    })}
                  </DialogDescription>
                </DialogHeader>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setPublishAllRacesOpen(false)}
                    disabled={publishingAllRaces}
                  >
                    {t("organizer.league.publishAllRacesCancel")}
                  </Button>
                  <Button
                    type="button"
                    onClick={handlePublishAllRaces}
                    disabled={publishingAllRaces}
                  >
                    {publishingAllRaces
                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      : <Globe className="mr-2 h-4 w-4" />}
                    {t("organizer.league.publishAllRacesConfirm")}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {eventsErrorMessage ? (
          <div className="mt-2.5 rounded-xl border border-dashed border-border bg-background/45 px-3 py-3 text-sm text-muted-foreground">
            {eventsErrorMessage}
          </div>
        ) : (
          <div className="mt-2.5 grid gap-2 rounded-xl border border-border/70 bg-background/45 p-2.5 lg:grid-cols-[minmax(210px,0.55fr)_minmax(360px,1fr)]">
            <div className="min-w-0 space-y-1">
              <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Round plan</div>
              <div className="flex flex-wrap gap-1.5">
                <Input
                  aria-label="Number of rounds"
                  type="number"
                  min="0"
                  value={plannedRoundCount}
                  onChange={(event) => setPlannedRoundCount(event.target.value)}
                  className="h-9 min-w-0 flex-1"
                />
                <Button
                  type="button"
                  variant={roundPlanDirty ? "default" : "secondary"}
                  size="sm"
                  className={`h-9 shrink-0 px-2.5 transition-[box-shadow,transform] ${roundPlanDirty ? "ring-2 ring-primary/30 ring-offset-2 ring-offset-background shadow-md hover:-translate-y-0.5" : ""}`}
                  aria-label="Save round plan"
                  onClick={handleSaveRoundPlan}
                  disabled={savingRoundPlan || !roundPlanDirty}
                >
                  {savingRoundPlan ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                  {roundPlanDirty ? "Save changes" : "Save plan"}
                </Button>
                <Dialog open={deleteAllRoundsOpen} onOpenChange={(open) => {
                  if (!deletingAllRounds) setDeleteAllRoundsOpen(open);
                }}>
                  <DialogTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 shrink-0 px-2.5 text-muted-foreground hover:text-destructive"
                      aria-label="Delete all rounds"
                      disabled={season.rounds.length === 0 || deletingAllRounds}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      Delete all
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>Delete all league rounds?</DialogTitle>
                      <DialogDescription>
                        This removes all {season.rounds.length} linked rounds and their race mappings. Unused generated draft races are deleted. The original Round 1 race and recurring rule stay available.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setDeleteAllRoundsOpen(false)}
                        disabled={deletingAllRounds}
                      >
                        Keep rounds
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={handleDeleteAllRounds}
                        disabled={deletingAllRounds}
                      >
                        {deletingAllRounds
                          ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          : <Trash2 className="mr-2 h-4 w-4" />}
                        Delete all {season.rounds.length} rounds
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
              {roundPlanDirty ? (
                <p role="status" className="text-[10px] font-semibold text-primary">
                  Save the new count before assigning races.
                </p>
              ) : null}
            </div>
            <div className="min-w-0 space-y-1.5">
              <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {locale === "hr" ? "Dodijeli utrku" : "Assign race"}
              </div>
              {selectableEvents.length === 0 ? (
                <div className="rounded-xl border border-primary/20 bg-primary/[0.045] p-3" role="note">
                  <div className="font-display text-sm font-bold text-foreground">
                    {locale === "hr"
                      ? `Nijedna utrka nije spremna za ${targetRoundNumber}. kolo`
                      : `No races are ready for Round ${targetRoundNumber}`}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {locale === "hr"
                      ? "Kolo lige treba spremljenu utrku s barem jednom natjecateljskom rutom u sportu ove lige."
                      : "A league round needs a saved race with at least one competitive route in this league’s sport."}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      to={createRaceHref}
                      className="inline-flex h-9 items-center gap-2 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      {locale === "hr" ? `Izradi utrku za ${targetRoundNumber}. kolo` : `Create race for Round ${targetRoundNumber}`}
                    </Link>
                    <Link
                      to="/organizer/events"
                      className="inline-flex h-9 items-center rounded-xl border border-border bg-card px-3 text-xs font-semibold text-foreground transition-colors hover:bg-secondary"
                    >
                      {locale === "hr" ? "Pregledaj postojeće utrke" : "Review existing races"}
                    </Link>
                  </div>
                  <details className="mt-3 text-xs text-muted-foreground">
                    <summary className="cursor-pointer font-semibold text-foreground">
                      {locale === "hr" ? "Zašto ne mogu odabrati utrku?" : "Why can’t I select a race?"}
                    </summary>
                    <ul className="mt-2 space-y-1 pl-4">
                      <li>{eventsWithoutCompetitiveCourses} {locale === "hr" ? "bez natjecateljske rute" : "without a competitive route"}</li>
                      <li>{alreadyLinkedEvents} {locale === "hr" ? "već povezano s ovom ligom" : "already linked to this league"}</li>
                      <li>{incompatibleSportEvents} {locale === "hr" ? "s nekompatibilnim sportom" : "with an incompatible sport"}</li>
                    </ul>
                  </details>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-col gap-1.5 sm:flex-row">
                    <select
                      ref={roundPickerRef}
                      aria-label="Round race"
                      aria-describedby="round-race-help"
                      disabled={roundPlanDirty}
                      value={selectedEventId}
                      onChange={(event) => handleEventSelection(event.target.value)}
                      className="h-9 min-w-0 flex-1 rounded-xl border border-border bg-card px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="">{locale === "hr" ? "Odaberi utrku" : "Choose race"}</option>
                      {selectableEvents.map((event) => (
                        <option key={event.id} value={event.id}>
                          {event.name} · {new Date(`${event.startDate}T00:00:00`).toLocaleDateString()}
                        </option>
                      ))}
                    </select>
                    <Button
                      onClick={handleAttach}
                      disabled={saving || roundPlanDirty || !selectedEvent || !canAttachRound}
                      className="h-9 shrink-0 sm:min-w-40"
                    >
                      {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                      Add to Round {targetRoundNumber}
                    </Button>
                  </div>
                  <div id="round-race-help" className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span>{locale === "hr" ? "Prikazuju se samo spremne, kompatibilne utrke." : "Only ready, compatible races are shown."}</span>
                    <Link to={createRaceHref} className="font-semibold text-primary hover:underline">
                      {locale === "hr" ? "Izradi novu utrku" : "Create new race"}
                    </Link>
                  </div>
                </div>
              )}
            </div>

            {selectedEvent ? (
              <div className="space-y-3 lg:col-span-2">
                <div className="rounded-xl border border-primary/15 bg-primary/[0.045] px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">Round {targetRoundNumber}: {selectedEvent.name}</span>
                  {" · "}{selectedEvent.races.length} competitive {selectedEvent.races.length === 1 ? "race" : "races"}
                </div>
                <LeagueRoundCourseMapping
                  competitions={scoredCompetitions}
                  races={selectedEvent.races}
                  sportCodes={season.sportCodes}
                  selectedRaceIds={selectedRaceIds}
                  suggestedRaceIds={autoMapLeagueEventRaces(scoredCompetitions, selectedEvent.compatibleRaces)}
                  excludedCourseIds={excludedCourseIds}
                  confirmed={mappingConfirmed}
                  onChange={(mappings, exclusions) => {
                    setSelectedRaceIds(mappings);
                    setExcludedCourseIds(exclusions);
                    setMappingConfirmed(false);
                  }}
                  onConfirm={setMappingConfirmed}
                />
                <Link className="inline-block text-sm font-semibold text-primary underline underline-offset-4" to={`${location.pathname}?tab=categories&sourceEvent=${selectedEvent.id}`}>
                  {t("organizer.league.competition.createAllLink")}
                </Link>
              </div>
            ) : null}
            {scoredCompetitions.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-3 py-3 text-xs text-muted-foreground lg:col-span-2">
                Add an individual competition and scoring policy before creating rounds.
              </p>
            ) : null}
          </div>
        )}
      </div>

      {roundSlots.length === 0 ? (
        <div className="m-3 rounded-xl border border-dashed border-border bg-background/45 px-4 py-8 text-center text-sm text-muted-foreground">
          Enter the number of rounds above to build the season calendar.
        </div>
      ) : (
        <div className="px-3 pb-1">
          {roundSlots.map((slot, index) => {
            const round = slot.round;
            const dateValue = round?.eventDate
              ? new Date(`${round.eventDate}T00:00:00`)
              : null;
            const accent = pickCalendarTimelineAccent(dateValue, round?.status === "completed");
            if (!round) {
              const selected = targetRoundNumber === slot.roundNumber;
              return (
                <article
                  key={`planned-round-${slot.roundNumber}`}
                  className={`relative my-3 grid grid-cols-[62px_minmax(0,1fr)] gap-3 rounded-xl border border-dashed px-2.5 py-2.5 transition-colors sm:grid-cols-[62px_minmax(0,1fr)_auto] sm:items-center ${
                    selected
                      ? "border-primary/45 bg-primary/[0.045]"
                      : "border-border bg-background/35"
                  }`}
                >
                  <span className={`absolute inset-y-4 left-0 w-1 rounded-r-full ${accent.stripe}`} aria-hidden="true" />
                  <CalendarTimelineDateBadge dateValue={null} accent={accent} isLast={index === roundSlots.length - 1} size="sm" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Round {slot.roundNumber}</span>
                      <span className="rounded-full border border-border px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider text-muted-foreground">Race TBA</span>
                    </div>
                    <h3 className="mt-1 font-display text-sm font-bold">Planned round</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{t("organizer.league.competition.coverageRequired")}</p>
                  </div>
                  <div className="col-start-2 sm:col-start-auto">
                    <Button
                      type="button"
                      variant={selected ? "default" : "secondary"}
                      size="sm"
                      disabled={roundPlanDirty}
                      onClick={() => {
                        setSelectedRoundNumber(slot.roundNumber);
                        roundPickerRef.current?.focus();
                        roundPickerRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
                      }}
                    >
                      {selected ? "Selected" : "Assign race"}
                    </Button>
                  </div>
                </article>
              );
            }
            const statusMeta = getLeagueRoundStatusMeta(round.status, locale);
            const roundEvent = events.find((event) => event.id === round.eventEditionId);
            const roundRaces = (roundEvent?.categories ?? []).filter(
              (category) => category.categoryType === "competitive",
            );
            const savedCoverageIssue = roundEvent ? getLeagueCourseCoverageIssue({
              competitionIds: scoredCompetitions.map((competition) => competition.id),
              courseIds: roundRaces.map((race) => race.id),
              mappings: round.mappings.filter((mapping) => mapping.status === "mapped"),
              excludedCourseIds: round.excludedCourseIds ?? [],
            }) : null;
            const editCoverageIssue = getLeagueCourseCoverageIssue({
              competitionIds: scoredCompetitions.map((competition) => competition.id),
              courseIds: roundRaces.map((race) => race.id),
              mappings: scoredCompetitions.flatMap((competition) => editingRaceIds[competition.id]
                ? [{ competitionId: competition.id, eventCategoryId: editingRaceIds[competition.id] }] : []),
              excludedCourseIds: editingExcludedCourseIds,
            });
            const canSaveEditedMappings = Boolean(roundEvent) && !editCoverageIssue && editingMappingConfirmed;
            return (
              <article
                key={round.id}
                className="relative my-3 grid grid-cols-[62px_minmax(0,1fr)] gap-3 rounded-xl border border-border/70 bg-background/55 px-2.5 py-2.5 shadow-soft sm:grid-cols-[62px_minmax(0,1fr)_auto] sm:items-center"
              >
                <span className={`absolute inset-y-4 left-0 w-1 rounded-r-full ${accent.stripe}`} aria-hidden="true" />
                <CalendarTimelineDateBadge dateValue={dateValue} accent={accent} isLast={index === roundSlots.length - 1} size="sm" />
                <div className="min-w-0 sm:flex sm:items-center sm:gap-3">
                  {roundEvent?.coverImageUrl ? (
                    <img src={roundEvent.coverImageUrl} alt="" aria-hidden="true" className="mb-2 h-16 w-full shrink-0 rounded-lg border border-border/70 object-cover sm:mb-0 sm:w-24" />
                  ) : null}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Round {round.roundNumber}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider ${statusMeta.className}`}>
                        {statusMeta.label}
                      </span>
                    </div>
                    <Link to={`/organizer/events/${round.eventEditionId}?tab=races`} className="mt-1 block truncate font-display text-sm font-bold hover:text-primary">
                      {round.eventName}
                    </Link>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/45 px-2 py-1 text-[9px] text-muted-foreground">
                        <MapPin className="h-2.5 w-2.5 text-primary" />
                        {roundEvent?.locationName || "Location TBD"}
                      </span>
                      {(round.mappings?.length
                        ? round.mappings
                        : [{
                            id: round.id,
                            competitionId: season.seasonId,
                            competitionName: "Overall",
                            eventCategoryId: round.eventCategoryId,
                            categoryName: round.categoryName,
                            status: "mapped",
                          }]
                      ).map((mapping) => (
                        <span
                          key={mapping.id}
                          className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/45 px-2 py-1 text-[9px] text-muted-foreground"
                        >
                          <Flag className="h-2.5 w-2.5 text-primary" />
                          {mapping.competitionName} → {mapping.categoryName}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                  <div className="col-start-2 flex flex-wrap items-center gap-1.5 sm:col-start-auto">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-8 rounded-full px-2.5 text-[10px]"
                      onClick={() => handleStartRoundEdit(round)}
                    >
                      Edit races
                    </Button>
                    <Link
                      to={`/organizer/events/${round.eventEditionId}?tab=races`}
                      className="inline-flex h-8 items-center rounded-full bg-primary/10 px-2.5 text-[10px] font-semibold text-primary transition-colors hover:bg-primary/15"
                    >
                      Open Race
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove round ${round.roundNumber}`}
                      className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive"
                      onClick={() => handleDetach(round.id)}
                      disabled={removingRoundId === round.id}
                    >
                      {removingRoundId === round.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>

                {savedCoverageIssue ? <p className="col-span-2 text-xs font-semibold text-trail-amber sm:col-span-3">{t("organizer.league.competition.reviewCoverage")}</p> : null}
                {(round.excludedCourseIds ?? []).map((courseId) => <p key={courseId} className="col-span-2 text-xs text-muted-foreground sm:col-span-3">{roundRaces.find((race) => race.id === courseId)?.name ?? courseId} — {t("organizer.league.competition.excluded")}</p>)}
                {editingRoundId === round.id ? (
                  <div className="col-span-2 border-t border-border/70 pt-3 sm:col-span-3">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Round race mappings</div>
                        <div className="mt-1 text-sm font-semibold">{round.eventName}</div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingRoundId(null);
                          setEditingRaceIds({});
                          setEditingMappingConfirmed(false);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                    <LeagueRoundCourseMapping
                      competitions={scoredCompetitions}
                      races={roundRaces}
                      sportCodes={season.sportCodes}
                      selectedRaceIds={editingRaceIds}
                      excludedCourseIds={editingExcludedCourseIds}
                      confirmed={editingMappingConfirmed}
                      onChange={(mappings, exclusions) => {
                        setEditingRaceIds(mappings);
                        setEditingExcludedCourseIds(exclusions);
                        setEditingMappingConfirmed(false);
                      }}
                      onConfirm={setEditingMappingConfirmed}
                    />
                    <div className="mt-3 flex justify-end">
                      <Button
                        type="button"
                        onClick={() => handleSaveRoundMappings(round)}
                        disabled={!canSaveEditedMappings || savingRoundId === round.id}
                      >
                        {savingRoundId === round.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Save mappings
                      </Button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function LeagueVisibilityBadge({ isPublic }: { isPublic: boolean }) {
  const { t } = useI18n();
  return (
    <span
      data-locale-fit="pill"
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
        isPublic ? "bg-primary/10 text-primary" : "bg-trail-amber/15 text-trail-amber"
      }`}
    >
      {isPublic ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
      {t(isPublic ? "common.public" : "common.private")}
    </span>
  );
}
