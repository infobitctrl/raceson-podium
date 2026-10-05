import type { LeagueSeasonPlanningDraft } from "@/components/organizer/league/leaguePlanning";
import type {
  LeagueClassificationDraft,
  LeagueCompetitionDraft,
} from "@/features/leagues/organizer/model/leagueCompetitionPlanning";
import type { LeagueHybridEmphasis, LeagueScoringMethod } from "@/features/leagues/organizer/model/leagueScoringCurve";
import { normalizeLeagueClubScoringScope } from "@raceson/domain/leagues";
import { isSportCode, normalizeSportSelection, type SportCode } from "@raceson/domain/sports";

export type LeagueSeasonEditorDraftData = {
  step: number;
  name: string;
  year: string;
  startsOn: string;
  endsOn: string;
  organizerRules: string;
  status: string;
  sportCodes: SportCode[];
  primarySportCode: SportCode;
  planning: LeagueSeasonPlanningDraft;
  competitionDrafts: LeagueCompetitionDraft[];
  activeCompetitionKey: string;
};

export type StoredLeagueSeasonEditorDraft = LeagueSeasonEditorDraftData & {
  version: 1;
  updatedAt: string;
};

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function parseScoringMethod(value: unknown, fallback: LeagueScoringMethod): LeagueScoringMethod {
  return value === "geometric" || value === "hybrid" || value === "custom" ? value : fallback;
}

function parseHybridEmphasis(value: unknown, fallback: LeagueHybridEmphasis): LeagueHybridEmphasis {
  return value === "inclusive" || value === "balanced" || value === "competitive" ? value : fallback;
}

function parseClassification(value: unknown): LeagueClassificationDraft | null {
  if (!isRecord(value)) return null;
  const key = stringValue(value.key);
  const name = stringValue(value.name);
  if (!key || !name) return null;
  return {
    key,
    slug: stringValue(value.slug),
    name,
    isDefault: value.isDefault === true,
    gender: value.gender === "F" || value.gender === "M" ? value.gender : "any",
    anyAge: value.anyAge !== false,
    minimumAge: stringValue(value.minimumAge),
    maximumAge: stringValue(value.maximumAge),
  };
}

function parseCompetition(value: unknown, fallback: LeagueCompetitionDraft): LeagueCompetitionDraft | null {
  if (!isRecord(value)) return null;
  const key = stringValue(value.key);
  const name = stringValue(value.name);
  if (!key || !name) return null;
  const classifications = Array.isArray(value.classifications)
    ? value.classifications.flatMap((entry) => {
        const parsed = parseClassification(entry);
        return parsed ? [parsed] : [];
      })
    : fallback.classifications;
  return {
    key,
    slug: stringValue(value.slug, fallback.slug),
    name,
    isDefault: value.isDefault === true,
    standingsMode:
      value.standingsMode === "best_time"
      || value.standingsMode === "participation"
      || value.standingsMode === "none"
        ? value.standingsMode
        : "points",
    scoringMethod: parseScoringMethod(value.scoringMethod, fallback.scoringMethod),
    maximumPoints: stringValue(value.maximumPoints, fallback.maximumPoints),
    expectedFinishers: stringValue(value.expectedFinishers, fallback.expectedFinishers),
    hybridEmphasis: parseHybridEmphasis(value.hybridEmphasis, fallback.hybridEmphasis),
    pointsTablePreset: stringValue(value.pointsTablePreset, fallback.pointsTablePreset),
    customPoints: stringValue(value.customPoints, fallback.customPoints),
    participationPoints: stringValue(value.participationPoints, fallback.participationPoints),
    countingMode: value.countingMode === "all_rounds" ? "all_rounds" : "best_n",
    bestN: stringValue(value.bestN, fallback.bestN),
    minimumRounds: stringValue(value.minimumRounds, fallback.minimumRounds),
    tieBreakMethod: stringValue(value.tieBreakMethod, fallback.tieBreakMethod),
    classifications,
  };
}

function parsePlanning(value: unknown, fallback: LeagueSeasonPlanningDraft): LeagueSeasonPlanningDraft {
  if (!isRecord(value)) return fallback;
  return {
    seasonBrief: stringValue(value.seasonBrief, fallback.seasonBrief),
    aboutLeague: stringValue(value.aboutLeague, fallback.aboutLeague),
    imageUrl: stringValue(value.imageUrl, fallback.imageUrl),
    plannedRoundCount: stringValue(value.plannedRoundCount, fallback.plannedRoundCount),
    roundMappingStrategy: stringValue(value.roundMappingStrategy, fallback.roundMappingStrategy),
    scoringMethod: parseScoringMethod(value.scoringMethod, fallback.scoringMethod),
    maximumPoints: stringValue(value.maximumPoints, fallback.maximumPoints),
    expectedFinishers: stringValue(value.expectedFinishers, fallback.expectedFinishers),
    hybridEmphasis: parseHybridEmphasis(value.hybridEmphasis, fallback.hybridEmphasis),
    pointsTablePreset: stringValue(value.pointsTablePreset, fallback.pointsTablePreset),
    customPoints: stringValue(value.customPoints, fallback.customPoints),
    participationPoints: stringValue(value.participationPoints, fallback.participationPoints),
    countingMode: value.countingMode === "all_rounds" ? "all_rounds" : "best_n",
    bestN: stringValue(value.bestN, fallback.bestN),
    minimumRounds: stringValue(value.minimumRounds, fallback.minimumRounds),
    tieBreakMethod: stringValue(value.tieBreakMethod, fallback.tieBreakMethod),
    standingsScope: stringValue(value.standingsScope, fallback.standingsScope),
    clubScoringMode: stringValue(value.clubScoringMode, fallback.clubScoringMode),
    clubScoringScope: normalizeLeagueClubScoringScope(
      stringValue(value.clubScoringScope, fallback.clubScoringScope),
    ),
    resultsCadence: stringValue(value.resultsCadence, fallback.resultsCadence),
    protestWindow: stringValue(value.protestWindow, fallback.protestWindow),
    closeoutPlan: stringValue(value.closeoutPlan, fallback.closeoutPlan),
    organizerNotes: stringValue(value.organizerNotes, fallback.organizerNotes),
  };
}

export function leagueSeasonEditorDraftStorageKey(
  userId: string,
  organizationId: string,
  editorScope: string,
) {
  return [
    "sitrail.league-editor-draft.v1",
    encodeURIComponent(userId),
    encodeURIComponent(organizationId || "unscoped"),
    encodeURIComponent(editorScope),
  ].join(".");
}

export function hasMeaningfulLeagueSeasonEditorDraft(
  draft: LeagueSeasonEditorDraftData,
  baseline: LeagueSeasonEditorDraftData,
) {
  return JSON.stringify(draft) !== JSON.stringify(baseline);
}

export function saveLeagueSeasonEditorDraft(
  storage: DraftStorage,
  key: string,
  draft: LeagueSeasonEditorDraftData,
  now = new Date(),
) {
  const storedDraft: StoredLeagueSeasonEditorDraft = {
    ...draft,
    version: 1,
    updatedAt: now.toISOString(),
  };
  storage.setItem(key, JSON.stringify(storedDraft));
  return storedDraft;
}

export function loadLeagueSeasonEditorDraft(
  storage: DraftStorage,
  key: string,
  fallback: LeagueSeasonEditorDraftData,
): StoredLeagueSeasonEditorDraft | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1 || typeof value.updatedAt !== "string") return null;
    const sportSelection = normalizeSportSelection({
      sportCodes: Array.isArray(value.sportCodes) ? value.sportCodes.filter(isSportCode) : fallback.sportCodes,
      primarySportCode: value.primarySportCode,
    });
    const fallbackCompetitionByKey = new Map(
      fallback.competitionDrafts.map((competition) => [competition.key, competition]),
    );
    const competitionDrafts = Array.isArray(value.competitionDrafts)
      ? value.competitionDrafts.flatMap((entry, index) => {
          const entryKey = isRecord(entry) ? stringValue(entry.key) : "";
          const parsed = parseCompetition(
            entry,
            fallbackCompetitionByKey.get(entryKey) ?? fallback.competitionDrafts[index] ?? fallback.competitionDrafts[0],
          );
          return parsed ? [parsed] : [];
        })
      : fallback.competitionDrafts;
    if (!competitionDrafts.length) return null;

    return {
      version: 1,
      updatedAt: value.updatedAt,
      step: value.step === 2 || value.step === 3 ? value.step : fallback.step,
      name: stringValue(value.name, fallback.name),
      year: stringValue(value.year, fallback.year),
      startsOn: stringValue(value.startsOn, fallback.startsOn),
      endsOn: stringValue(value.endsOn, fallback.endsOn),
      organizerRules: stringValue(value.organizerRules, fallback.organizerRules),
      status: stringValue(value.status, fallback.status),
      sportCodes: sportSelection.sportCodes,
      primarySportCode: sportSelection.primarySportCode,
      planning: parsePlanning(value.planning, fallback.planning),
      competitionDrafts,
      activeCompetitionKey: stringValue(value.activeCompetitionKey, competitionDrafts[0]?.key),
    };
  } catch {
    return null;
  }
}

export function removeLeagueSeasonEditorDraft(storage: DraftStorage, key: string) {
  storage.removeItem(key);
}
