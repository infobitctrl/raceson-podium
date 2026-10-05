import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { expandRecreationalSchedule } from "@raceson/domain/leagues";
import {
  filterRecurringLeagueBaseEvents,
  getDayAfterIsoDate,
  getRecurringLeagueCopyDateIssue,
} from "@/features/leagues/organizer/model/recreationalLeagueSchedulePresentation";
import {
  createRecreationalLeagueSchedule,
  getOrganizerEvents,
  getOrganizerTracks,
  getRecreationalLeagueSchedules,
  materializeRecreationalLeagueSchedule,
  type OrganizerManagedLeagueSeason,
} from "@/lib/organizer-management";
import { useOrganizerAuth } from "@/lib/organizer-workspace";
import { useI18n } from "@/shared/i18n/I18nContext";

const weekdays = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
] as const;

type ScheduleExceptionDraft = {
  sourceDate: string;
  action: "skip" | "cancel" | "reschedule";
  replacementDate: string;
  replacementLocalStartTime: string;
  reason: string;
};

type SchedulePreviewOccurrence = ReturnType<typeof expandRecreationalSchedule>[number];

const previewDateFormatters = {
  en: new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }),
  hr: new Intl.DateTimeFormat("hr-HR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }),
} as const;

function formatPreviewDate(date: string, locale: "en" | "hr") {
  return previewDateFormatters[locale].format(new Date(`${date}T00:00:00Z`));
}

function SchedulePreviewDates({
  occurrences,
  locale,
  label,
  startingRoundNumber = 2,
}: {
  occurrences: SchedulePreviewOccurrence[];
  locale: "en" | "hr";
  label: string;
  startingRoundNumber?: number;
}) {
  if (!occurrences.length) {
    return <p className="mt-3 text-xs text-muted-foreground">
      {locale === "hr" ? "Odaberite valjani raspon datuma i dane u tjednu." : "Choose a valid date range and weekdays."}
    </p>;
  }

  return <ol aria-label={label} className="mt-3 grid max-h-64 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
    {occurrences.map((occurrence, index) => <li key={`${occurrence.sourceDate}-${occurrence.scheduledDate}-${occurrence.localStartTime}`} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-card/75 px-3 py-2">
      <div className="min-w-0">
        <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {locale === "hr" ? `Kolo ${startingRoundNumber + index}` : `Round ${startingRoundNumber + index}`}
        </div>
        <time dateTime={occurrence.scheduledDate} className="block truncate text-xs font-semibold capitalize">
          {formatPreviewDate(occurrence.scheduledDate, locale)}
        </time>
      </div>
      <time dateTime={occurrence.localStartTime} className="shrink-0 rounded-full bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary">
        {occurrence.localStartTime.slice(0, 5)}
      </time>
    </li>)}
  </ol>;
}

export function RecreationalLeagueSchedulePanel({
  season,
  onSaved,
}: {
  season: OrganizerManagedLeagueSeason;
  onSaved: () => Promise<void>;
}) {
  return (
    <RecreationalLeagueScheduleWorkspace
      key={season.seasonId}
      season={season}
      onSaved={onSaved}
    />
  );
}

function RecreationalLeagueScheduleWorkspace({
  season,
  onSaved,
}: {
  season: OrganizerManagedLeagueSeason;
  onSaved: () => Promise<void>;
}) {
  const { locale, t } = useI18n();
  const { account } = useOrganizerAuth();
  const schedulesQuery = useQuery({
    queryKey: ["league-recurrence-rules", season.seasonId],
    queryFn: () => getRecreationalLeagueSchedules(account, season.seasonId),
    enabled: Boolean(account?.hasOrganizerAccess),
  });
  const refetchSchedules = schedulesQuery.refetch;
  const tracksQuery = useQuery({
    queryKey: ["organizer-tracks", account?.organizationIds[0] ?? "no-org"],
    queryFn: () => getOrganizerTracks(account),
    enabled: Boolean(account?.hasOrganizerAccess),
  });
  const eventsQuery = useQuery({
    queryKey: ["organizer-events", account?.organizationIds.join(",") ?? "no-org"],
    queryFn: () => getOrganizerEvents(account),
    enabled: Boolean(account?.hasOrganizerAccess),
  });
  const competitions = (season.competitions ?? []).filter(
    (competition) => competition.scoringTarget === "individual" && competition.status !== "archived",
  );
  const [name, setName] = useState(locale === "hr" ? "Redoviti raspored" : "Regular schedule");
  const [validFrom, setValidFrom] = useState(season.startsOn ?? "");
  const [validUntil, setValidUntil] = useState(season.endsOn ?? "");
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([1, 3, 5]);
  const [localStartTime, setLocalStartTime] = useState("07:15");
  const [sourceEventEditionId, setSourceEventEditionId] = useState("");
  const [locationName, setLocationName] = useState("");
  const [registrationOpenDaysBefore, setRegistrationOpenDaysBefore] = useState("7");
  const [registrationCloseMinutesBefore, setRegistrationCloseMinutesBefore] = useState("0");
  const [exceptions, setExceptions] = useState<ScheduleExceptionDraft[]>([]);
  const [exceptionDraft, setExceptionDraft] = useState<ScheduleExceptionDraft>({
    sourceDate: "",
    action: "reschedule",
    replacementDate: "",
    replacementLocalStartTime: "",
    reason: "",
  });
  const [isGeneratingSchedule, setIsGeneratingSchedule] = useState(false);
  const [materializingRuleId, setMaterializingRuleId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isExceptionEditorExpanded, setIsExceptionEditorExpanded] = useState(false);
  const roundOneEventId = (season.rounds ?? [])
    .find((round) => round.roundNumber === 1)?.eventEditionId ?? null;
  const selectableBaseEvents = filterRecurringLeagueBaseEvents(
    eventsQuery.data ?? [],
    season.sportCodes,
    competitions.length,
    {
      roundOneEventId,
      seasonStartsOn: season.startsOn,
      seasonEndsOn: season.endsOn,
    },
  );
  const selectedBaseEvent = selectableBaseEvents.find((event) => event.id === sourceEventEditionId) ?? null;
  const latestExistingRoundDate = (season.rounds ?? []).reduce<string | null>(
    (latest, round) => !latest || round.eventDate > latest ? round.eventDate : latest,
    null,
  );
  const nextRoundNumber = Math.max(0, ...(season.rounds ?? []).map((round) => round.roundNumber)) + 1;
  const copyStartDate = selectedBaseEvent
    ? getDayAfterIsoDate(
        latestExistingRoundDate && latestExistingRoundDate > selectedBaseEvent.startDate
          ? latestExistingRoundDate
          : selectedBaseEvent.startDate,
      )
    : null;
  const rangeDateIssue = selectedBaseEvent
    ? getRecurringLeagueCopyDateIssue(
        selectedBaseEvent.startDate,
        validFrom,
        validUntil,
        latestExistingRoundDate,
      )
    : null;
  const trackNameById = useMemo(
    () => new Map((tracksQuery.data ?? []).map((track) => [track.templateId, track.name])),
    [tracksQuery.data],
  );
  const previewOccurrences = useMemo(() => {
    if (
      !selectedBaseEvent
      || !validFrom
      || !validUntil
      || !selectedWeekdays.length
      || !localStartTime
      || getRecurringLeagueCopyDateIssue(
        selectedBaseEvent.startDate,
        validFrom,
        validUntil,
        latestExistingRoundDate,
      )
    ) return [];
    try {
      return expandRecreationalSchedule({
        validFrom,
        validUntil,
        weekdays: selectedWeekdays,
        localStartTime,
        overrides: exceptions,
      }).filter((occurrence) => (
        occurrence.state === "planned"
        && occurrence.scheduledDate > selectedBaseEvent.startDate
      ));
    } catch {
      return [];
    }
  }, [exceptions, latestExistingRoundDate, localStartTime, selectedBaseEvent, selectedWeekdays, validFrom, validUntil]);
  const previewCount = previewOccurrences.length;
  const copyDateIssue = rangeDateIssue ?? (
    latestExistingRoundDate
    && previewOccurrences.some((occurrence) => occurrence.scheduledDate <= latestExistingRoundDate)
      ? `New recurring rounds must be scheduled after the latest existing league round (${latestExistingRoundDate}).`
      : null
  );
  const activeSchedule = schedulesQuery.data?.[0] ?? null;
  const activeSchedulePreviewCount = activeSchedule?.previewCount ?? 0;
  const activeMaterializedCount = activeSchedule?.occurrences.filter(
    (occurrence) => occurrence.state === "materialized",
  ).length ?? 0;
  const preferredBaseEventId = roundOneEventId ?? activeSchedule?.sourceEventEditionId ?? null;
  const summaryPreviewCount = selectedBaseEvent ? previewCount : activeSchedulePreviewCount;

  useEffect(() => {
    setName((current) => ["Regular schedule", "Redoviti raspored"].includes(current)
      ? (locale === "hr" ? "Redoviti raspored" : "Regular schedule")
      : current);
  }, [locale]);

  useEffect(() => {
    const handleLeagueRoundsChanged = (event: Event) => {
      const changedSeasonId = (event as CustomEvent<{ seasonId?: string }>).detail?.seasonId;
      if (changedSeasonId === season.seasonId) void refetchSchedules();
    };
    window.addEventListener("sitrail:league-rounds-changed", handleLeagueRoundsChanged);
    return () => window.removeEventListener("sitrail:league-rounds-changed", handleLeagueRoundsChanged);
  }, [refetchSchedules, season.seasonId]);

  useEffect(() => {
    if (sourceEventEditionId || !preferredBaseEventId) return;
    const roundOneEvent = selectableBaseEvents.find((event) => event.id === preferredBaseEventId);
    if (!roundOneEvent) return;
    setSourceEventEditionId(roundOneEvent.id);
    setValidFrom(getDayAfterIsoDate(
      latestExistingRoundDate && latestExistingRoundDate > roundOneEvent.startDate
        ? latestExistingRoundDate
        : roundOneEvent.startDate,
    ));
    if (roundOneEvent.locationName) setLocationName(roundOneEvent.locationName);
  }, [latestExistingRoundDate, preferredBaseEventId, selectableBaseEvents, sourceEventEditionId]);

  useEffect(() => {
    if (!copyStartDate) return;
    setValidFrom((current) => !current || current < copyStartDate ? copyStartDate : current);
  }, [copyStartDate]);

  function toggleWeekday(weekday: number) {
    setSelectedWeekdays((current) => current.includes(weekday)
      ? current.filter((value) => value !== weekday)
      : [...current, weekday].sort((left, right) => left - right));
  }

  function addException() {
    if (!exceptionDraft.sourceDate) {
      toast.error("Choose the original race date.");
      return;
    }
    if (exceptionDraft.action === "reschedule" && !exceptionDraft.replacementDate) {
      toast.error("Choose the replacement date.");
      return;
    }
    setExceptions((current) => [
      ...current.filter((item) => item.sourceDate !== exceptionDraft.sourceDate),
      exceptionDraft,
    ].sort((left, right) => left.sourceDate.localeCompare(right.sourceDate)));
    setExceptionDraft({
      sourceDate: "",
      action: "reschedule",
      replacementDate: "",
      replacementLocalStartTime: "",
      reason: "",
    });
  }

  function handleBaseEventSelection(eventEditionId: string) {
    setSourceEventEditionId(eventEditionId);
    const baseEvent = selectableBaseEvents.find((candidate) => candidate.id === eventEditionId) ?? null;
    if (!baseEvent) return;
    const firstCopyDate = getDayAfterIsoDate(
      latestExistingRoundDate && latestExistingRoundDate > baseEvent.startDate
        ? latestExistingRoundDate
        : baseEvent.startDate,
    );
    setValidFrom(firstCopyDate);
    if (validUntil < firstCopyDate && season.endsOn && season.endsOn >= firstCopyDate) {
      setValidUntil(season.endsOn);
    }
    if (baseEvent.locationName) setLocationName(baseEvent.locationName);
  }

  async function handleGenerateSchedule() {
    if (!account || !selectedBaseEvent) return;
    if (!validFrom || !validUntil || validUntil < validFrom) {
      toast.error("Choose a valid schedule date range.");
      return;
    }
    if (copyDateIssue) {
      toast.error(copyDateIssue);
      return;
    }
    if (!selectedWeekdays.length) {
      toast.error("Select at least one weekday.");
      return;
    }
    if (!previewCount) {
      toast.error("Choose at least one generated round date after Round 1.");
      return;
    }
    if (!competitions.length) {
      toast.error("Create at least one league race category first.");
      return;
    }
    const mappings = competitions.map((competition, index) => ({
      competitionId: competition.id,
      sourceEventCategoryId: selectedBaseEvent.categories[index]!.id,
    }));

    setIsGeneratingSchedule(true);
    try {
      await createRecreationalLeagueSchedule(account, season.seasonId, {
        generateNow: true,
        sourceEventEditionId: selectedBaseEvent.id,
        name: name.trim(),
        validFrom,
        validUntil,
        weekdays: selectedWeekdays,
        localStartTime,
        timezone: season.timezone,
        registrationOpenDaysBefore: registrationOpenDaysBefore
          ? Number(registrationOpenDaysBefore)
          : null,
        registrationCloseMinutesBefore: Number(registrationCloseMinutesBefore) || 0,
        locationName: locationName.trim() || selectedBaseEvent.locationName,
        mappings,
        overrides: exceptions.map((item) => ({
          sourceDate: item.sourceDate,
          action: item.action,
          replacementDate: item.action === "reschedule" ? item.replacementDate : null,
          replacementLocalStartTime: item.action === "reschedule"
            ? item.replacementLocalStartTime || null
            : null,
          reason: item.reason.trim() || null,
        })),
      });
      await Promise.all([schedulesQuery.refetch(), eventsQuery.refetch(), onSaved()]);
      setExceptions([]);
      toast.success("Round 1 kept as the base race. Later rounds were generated and linked.");
    } catch (error) {
      await Promise.allSettled([schedulesQuery.refetch(), eventsQuery.refetch(), onSaved()]);
      toast.error(error instanceof Error ? error.message : "Unable to generate the recurring schedule.");
    } finally {
      setIsGeneratingSchedule(false);
    }
  }

  async function handleMaterialize(ruleId: string) {
    if (!account) return;
    setMaterializingRuleId(ruleId);
    try {
      await materializeRecreationalLeagueSchedule(account, season.seasonId, ruleId);
      await Promise.all([schedulesQuery.refetch(), eventsQuery.refetch(), onSaved()]);
      toast.success(t("organizer.league.schedule.generatedOpen"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to generate the schedule.");
    } finally {
      setMaterializingRuleId(null);
    }
  }

  return (
    <section className="mb-4 overflow-hidden rounded-2xl border border-border bg-card shadow-soft" aria-labelledby="recurring-schedule-title">
      <button
        type="button"
        className={`flex w-full flex-wrap items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/25 ${isExpanded ? "border-b border-border/70" : ""}`}
        aria-expanded={isExpanded}
        aria-controls="recurring-schedule-content"
        onClick={() => setIsExpanded((current) => !current)}
      >
        <div className="min-w-0">
            <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Recurring races</div>
            <h2 id="recurring-schedule-title" className="mt-0.5 font-display text-base font-bold">
              {locale === "hr" ? "Generiranje kola iz 1. kola" : "Generate rounds from Round 1"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {locale === "hr"
                ? "Prvo izradite potpuni utrka za 1. kolo. On ostaje izvoran, a sustav kopira samo kola 2 i dalje."
                : "Create the complete Round 1 race first. It stays original; the system only copies Round 2 onward."}
            </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full border border-primary/20 bg-primary/[0.055] px-3 py-1 text-xs font-semibold text-primary">
            {activeMaterializedCount > 0
              ? (locale === "hr"
                  ? `${activeMaterializedCount} ${activeMaterializedCount === 1 ? "generirano kolo" : "generiranih kola"}`
                  : `${activeMaterializedCount} generated round${activeMaterializedCount === 1 ? "" : "s"}`)
              : (locale === "hr"
                  ? `${summaryPreviewCount} ${summaryPreviewCount === 1 ? "novo kolo" : "novih kola"}`
                  : `${summaryPreviewCount} new round${summaryPreviewCount === 1 ? "" : "s"}`)}
          </span>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} aria-hidden="true" />
        </div>
      </button>

      {isExpanded ? <div id="recurring-schedule-content" className="space-y-4 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Rule name</span><Input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="space-y-1 md:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{locale === "hr" ? "Utrka 1. kola" : "Round 1 race"}</span><select aria-label="Round 1 race" value={sourceEventEditionId} onChange={(event) => handleBaseEventSelection(event.target.value)} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"><option value="">{locale === "hr" ? "Odaberi utrku 1. kola" : "Choose the Round 1 race"}</option>{selectableBaseEvents.map((event) => <option key={event.id} value={event.id}>{event.name} · {locale === "hr" ? `${event.categories.length} ${event.categories.length === 1 ? "utrka" : "utrke"}` : `${event.categories.length} race${event.categories.length === 1 ? "" : "s"}`} · {event.startDate}</option>)}</select></label>
          <label className="space-y-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{locale === "hr" ? "Kopiraj od" : "Generate from"}</span><Input type="date" min={copyStartDate ?? undefined} disabled={!selectedBaseEvent} value={validFrom} onChange={(event) => setValidFrom(event.target.value)} /></label>
          <label className="space-y-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Until</span><Input type="date" min={validFrom || undefined} value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></label>
          <label className="space-y-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Start time</span><Input type="time" value={localStartTime} onChange={(event) => setLocalStartTime(event.target.value)} /></label>
          <label className="space-y-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Location</span><Input value={locationName} onChange={(event) => setLocationName(event.target.value)} placeholder={selectedBaseEvent?.locationName ?? "Pirovac"} /></label>
          <label className="space-y-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Registration opens (days before)</span><Input type="number" min="0" value={registrationOpenDaysBefore} onChange={(event) => setRegistrationOpenDaysBefore(event.target.value)} /></label>
          <label className="space-y-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("organizer.league.schedule.registrationCloses")}</span><Input type="number" min="0" value={registrationCloseMinutesBefore} onChange={(event) => setRegistrationCloseMinutesBefore(event.target.value)} /></label>
        </div>

        <div className="rounded-xl border border-primary/25 bg-primary/[0.055] px-3 py-2.5 text-xs text-muted-foreground" role="note">
          <strong className="text-foreground">{locale === "hr" ? "Obvezno pravilo:" : "Required workflow:"}</strong>{" "}
          {t("organizer.league.schedule.openWorkflow")}
        </div>

        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Days of week</div>
          <div className="mt-2 flex flex-wrap gap-2">{weekdays.map((weekday) => <button key={weekday.value} type="button" aria-pressed={selectedWeekdays.includes(weekday.value)} onClick={() => toggleWeekday(weekday.value)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${selectedWeekdays.includes(weekday.value) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{weekday.label}</button>)}</div>
        </div>

        <div className="rounded-xl border border-primary/20 bg-primary/[0.035] p-3" aria-label="Round generation workflow">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {locale === "hr" ? "Jedna radnja · fiksni redoslijed" : "One action · fixed order"}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {locale === "hr" ? "Sustav nikada ne kopira ni zamjenjuje utrka 1. kola." : "The system never copies or replaces the Round 1 race."}
              </p>
            </div>
          </div>
          <ol className="mt-3 grid gap-2 md:grid-cols-3">
            <li className="flex gap-3 rounded-lg border border-border/70 bg-card/75 p-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">1</span>
              <div>
                <div className="text-xs font-semibold">{locale === "hr" ? "Zadrži izvorno 1. kolo" : "Keep the original Round 1"}</div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {locale === "hr" ? "Odabrani događaj povezuje se kao 1. kolo bez stvaranja kopije." : "The selected event is linked as Round 1 without creating a copy."}
                </p>
              </div>
            </li>
            <li className="flex gap-3 rounded-lg border border-border/70 bg-card/75 p-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">2</span>
              <div>
                <div className="text-xs font-semibold">{locale === "hr" ? "Izradi kola 2 i dalje" : "Create Round 2 onward"}</div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {t("organizer.league.schedule.laterOpenEvent")}
                </p>
              </div>
            </li>
            <li className="flex gap-3 rounded-lg border border-border/70 bg-card/75 p-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">3</span>
              <div>
                <div className="text-xs font-semibold">{locale === "hr" ? "Kopiraj cijeli događaj" : "Copy the complete event"}</div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {locale === "hr" ? "Kopiraju se utrke, redoslijed, rute, kontrolne točke, naslovna slika i postavke prijava." : "Races, order, routes, checkpoints, banner, and registration settings are copied."}
                </p>
              </div>
            </li>
          </ol>
        </div>

        <div className="rounded-xl border border-primary/20 bg-primary/[0.035] p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Schedule preview</div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("organizer.league.schedule.unpublishedPreview")}
              </p>
            </div>
            <span className="rounded-full border border-primary/20 bg-card px-2.5 py-1 text-xs font-semibold text-primary">
              {locale === "hr" ? `${previewCount} novih kola` : `${previewCount} new round${previewCount === 1 ? "" : "s"}`}
            </span>
          </div>
          <SchedulePreviewDates occurrences={previewOccurrences} locale={locale} label="Schedule preview dates" startingRoundNumber={nextRoundNumber} />
        </div>

        <div className="rounded-xl border border-border/70 bg-background/45 p-3">
          <div><div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{locale === "hr" ? "Utrke utrke 1. kola" : "Round 1 races"}</div><p className="mt-1 text-xs text-muted-foreground">{locale === "hr" ? "Svako kasnije kolo kopira ove utrke, njihov redoslijed, rute i kontrolne točke." : "Every later round copies these races, their order, routes, and checkpoints."}</p></div>
          {selectedBaseEvent ? <div className="mt-3 grid gap-2 md:grid-cols-2">{selectedBaseEvent.categories.map((sourceRace, index) => {
            const competition = competitions[index] ?? null;
            const trackName = sourceRace.trackTemplateId ? trackNameById.get(sourceRace.trackTemplateId) : null;
            return <div key={sourceRace.id} className="rounded-lg border border-border/70 bg-card/70 px-3 py-2"><div className="text-xs font-semibold">{sourceRace.name}{competition ? ` → ${competition.name}` : " · copied event race"}</div><div className="mt-1 text-[10px] text-muted-foreground">{trackName ?? "Assigned track"}{sourceRace.distanceKm != null ? ` · ${sourceRace.distanceKm} km` : ""} · {sourceRace.sportCode.replace(/_/g, " ")}</div></div>;
          })}</div> : <p className="mt-3 text-xs text-muted-foreground">{locale === "hr" ? `Odaberite osnovni događaj s najmanje ${competitions.length} ${competitions.length === 1 ? "postavljenom utrkom" : "postavljene utrke"}. Sve utrke iz događaja bit će kopirane i svaka mora već imati dodijeljenu stazu.` : `Choose a base event with at least ${competitions.length} configured race${competitions.length === 1 ? "" : "s"}. Every event race will be copied and must already have its track assigned.`}</p>}
        </div>

        <div className="overflow-hidden rounded-xl border border-border/70 bg-background/45">
          <button
            type="button"
            className="flex w-full items-start justify-between gap-3 p-3 text-left transition-colors hover:bg-muted/25"
            aria-expanded={isExceptionEditorExpanded}
            aria-controls="schedule-exception-editor"
            onClick={() => setIsExceptionEditorExpanded((current) => !current)}
          >
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{locale === "hr" ? "Promjena termina ili iznimka" : "Schedule change or exception"}</span>
                <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[9px] font-semibold text-muted-foreground">
                  {exceptions.length > 0
                    ? (locale === "hr" ? `${exceptions.length} dodano` : `${exceptions.length} added`)
                    : (locale === "hr" ? "Neobvezno" : "Optional")}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{locale === "hr" ? "Premjestite, preskočite ili otkažite samo pojedinačni generirani termin." : "Move, skip, or cancel a single generated date only when the regular schedule changes."}</p>
            </div>
            <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isExceptionEditorExpanded ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
          {isExceptionEditorExpanded ? (
            <div id="schedule-exception-editor" className="border-t border-border/70 p-3">
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6">
                <Input aria-label="Exception source date" type="date" value={exceptionDraft.sourceDate} onChange={(event) => setExceptionDraft((current) => ({ ...current, sourceDate: event.target.value }))} />
                <select aria-label="Exception action" value={exceptionDraft.action} onChange={(event) => setExceptionDraft((current) => ({ ...current, action: event.target.value as ScheduleExceptionDraft["action"] }))} className="h-10 rounded-xl border border-border bg-background px-3 text-sm"><option value="reschedule">Reschedule</option><option value="skip">Skip</option><option value="cancel">Cancel</option></select>
                <Input aria-label="Replacement date" type="date" disabled={exceptionDraft.action !== "reschedule"} value={exceptionDraft.replacementDate} onChange={(event) => setExceptionDraft((current) => ({ ...current, replacementDate: event.target.value }))} />
                <Input aria-label="Replacement time" type="time" disabled={exceptionDraft.action !== "reschedule"} value={exceptionDraft.replacementLocalStartTime} onChange={(event) => setExceptionDraft((current) => ({ ...current, replacementLocalStartTime: event.target.value }))} />
                <Input aria-label="Exception reason" value={exceptionDraft.reason} onChange={(event) => setExceptionDraft((current) => ({ ...current, reason: event.target.value }))} placeholder="Reason" />
                <Button type="button" variant="secondary" onClick={addException}><Plus className="mr-1.5 h-4 w-4" />Add exception</Button>
              </div>
              {exceptions.length > 0 ? <div className="mt-2 flex flex-wrap gap-2">{exceptions.map((item) => <button key={item.sourceDate} type="button" onClick={() => setExceptions((current) => current.filter((candidate) => candidate.sourceDate !== item.sourceDate))} className="rounded-full border border-border px-2.5 py-1 text-[10px] text-muted-foreground" title="Remove exception">{item.sourceDate} · {locale === "hr" ? (item.action === "reschedule" ? "novi termin" : item.action === "skip" ? "preskočeno" : "otkazano") : item.action}{item.replacementDate ? ` → ${item.replacementDate}` : ""} ×</button>)}</div> : null}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/[0.055] p-3">
          <p className="text-xs text-muted-foreground">{activeMaterializedCount > 0
            ? (locale === "hr"
                ? `Postojeća kola ostaju nepromijenjena. Ovaj raspored stvara novi skup od ${nextRoundNumber}. kola nadalje, nakon ${latestExistingRoundDate}.`
                : `Existing rounds stay unchanged. This schedule creates another set from Round ${nextRoundNumber}, after ${latestExistingRoundDate}.`)
            : t("organizer.league.schedule.openGenerationHelp")}</p>
          <Button type="button" disabled={isGeneratingSchedule || !selectedBaseEvent || Boolean(copyDateIssue) || previewCount === 0} onClick={handleGenerateSchedule}>{isGeneratingSchedule ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}{activeMaterializedCount > 0 ? (locale === "hr" ? "Generiraj novi skup" : "Generate another set") : (locale === "hr" ? "Generiraj kola 2 nadalje" : "Generate Round 2 onward")}</Button>
        </div>

        {(schedulesQuery.data ?? []).length > 0 ? <div className="space-y-2 border-t border-border/70 pt-4">{(schedulesQuery.data ?? []).map((rule) => {
          const materializedCount = rule.occurrences.filter((occurrence) => occurrence.state === "materialized").length;
          const rulePreviewOccurrences = expandRecreationalSchedule({
            validFrom: rule.validFrom,
            validUntil: rule.validUntil,
            weekdays: rule.weekdays,
            localStartTime: rule.localStartTime,
            overrides: rule.overrides,
          }).filter((occurrence) => occurrence.state === "planned");
          return <article key={rule.id} className="rounded-xl border border-border/70 bg-background/55 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><div className="font-display text-sm font-bold">{rule.name}</div><p className="mt-1 text-xs text-muted-foreground">{rule.validFrom}–{rule.validUntil} · {rule.localStartTime} · {locale === "hr" ? `${rule.previewCount} planirano · ${materializedCount} generirano` : `${rule.previewCount} planned · ${materializedCount} generated`}</p></div>
              <Button type="button" variant="secondary" disabled={materializingRuleId === rule.id || materializedCount === rule.previewCount} onClick={() => handleMaterialize(rule.id)}>{materializingRuleId === rule.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}{materializedCount ? (locale === "hr" ? "Generiraj nedostajuća kola" : "Generate missing rounds") : (locale === "hr" ? "Generiraj kola 2 nadalje" : "Generate Round 2 onward")}</Button>
            </div>
            <SchedulePreviewDates occurrences={rulePreviewOccurrences} locale={locale} label={`${rule.name} preview dates`} />
          </article>;
        })}</div> : null}
      </div> : null}
    </section>
  );
}
