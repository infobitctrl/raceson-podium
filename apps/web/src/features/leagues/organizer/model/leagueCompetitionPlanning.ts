import {
  getLeagueParticipationPoints,
  getLeaguePointsTableFromPreset,
  inferLeaguePointsTablePreset,
  type LeagueSeasonPlanningDraft,
} from "@/components/organizer/league/leaguePlanning";
import {
  getLeagueRaceRankingCompatibilityIssue,
  type RaceRankingConfigInput,
} from "@raceson/domain/leagues";
import type {
  OrganizerLeagueCompetition,
  OrganizerLeagueCompetitionInput,
  OrganizerLeagueScoringRulesInput,
} from "@/lib/organizer-management";
import {
  buildLeagueScoringCurve,
  defaultLeagueScoringParameters,
  normalizeLeagueScoringParameters,
  parseLeagueScoringMethod,
  type LeagueHybridEmphasis,
  type LeagueScoringMethod,
} from "@/features/leagues/organizer/model/leagueScoringCurve";
import { formatSexClassificationLabel } from "@/shared/domain/competitiveClassification";

export type LeagueCompetitionDraft = {
  key: string;
  slug: string;
  name: string;
  isDefault: boolean;
  standingsMode: "points" | "best_time" | "participation" | "none";
  scoringMethod: LeagueScoringMethod;
  maximumPoints: string;
  expectedFinishers: string;
  hybridEmphasis: LeagueHybridEmphasis;
  pointsTablePreset: string;
  customPoints: string;
  participationPoints: string;
  countingMode: "all_rounds" | "best_n";
  bestN: string;
  minimumRounds: string;
  tieBreakMethod: string;
  classifications: LeagueClassificationDraft[];
};

export type LeagueClassificationGender = "any" | "F" | "M";

export type LeagueClassificationDraft = {
  key: string;
  slug: string;
  name: string;
  isDefault: boolean;
  gender: LeagueClassificationGender;
  anyAge: boolean;
  minimumAge: string;
  maximumAge: string;
};

export type LeagueClassificationConflict = {
  classificationKey: string;
  conflictingClassificationKey: string;
  conflictingClassificationName: string;
};

export type LeagueClassificationPreset =
  | "custom"
  | "female"
  | "male"
  | "girls_u16"
  | "boys_u16"
  | "senior";

export type LeagueRaceMappingCompetition = {
  id: string;
  slug?: string;
  name: string;
  classifications?: Array<{
    name: string;
    eligibility?: Record<string, unknown> | null;
  }>;
};

export type LeagueRaceMappingOption = {
  id: string;
  name: string;
  distanceKm?: number | null;
  rankingConfig?: RaceRankingConfigInput | null;
};

function toLeagueCompetitionSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "competition";
}

function positiveInteger(value: number | null | undefined, fallback: string) {
  return Number.isFinite(value) && (value ?? 0) > 0 ? String(value) : fallback;
}

function optionalNonNegativeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : "";
}

function createClassificationDraft(
  input: {
    id?: string;
    slug?: string;
    name: string;
    isDefault?: boolean;
    eligibility?: Record<string, unknown>;
  },
  index: number,
): LeagueClassificationDraft {
  const slug = toLeagueCompetitionSlug(input.slug ?? input.name) || `classification-${index + 1}`;
  const gender = input.eligibility?.gender === "F" || input.eligibility?.gender === "M"
    ? input.eligibility.gender
    : "any";
  const minimumAge = optionalNonNegativeNumber(input.eligibility?.minimumAge);
  const maximumAge = optionalNonNegativeNumber(input.eligibility?.maximumAge);
  return {
    key: input.id ?? `${slug}-${index + 1}`,
    slug,
    name: formatSexClassificationLabel(input.name),
    isDefault: input.isDefault === true,
    gender,
    anyAge: !minimumAge && !maximumAge,
    minimumAge,
    maximumAge,
  };
}

function classificationEligibilityKey(classification: LeagueClassificationDraft) {
  const minimumAge = classification.anyAge || classification.minimumAge === ""
    ? null
    : Number(classification.minimumAge);
  const maximumAge = classification.anyAge || classification.maximumAge === ""
    ? null
    : Number(classification.maximumAge);
  return `${classification.gender}:${minimumAge ?? ""}:${maximumAge ?? ""}`;
}

export function getLeagueClassificationConflicts(
  classifications: LeagueClassificationDraft[],
) {
  const conflicts: LeagueClassificationConflict[] = [];
  const firstClassificationByEligibility = new Map<string, LeagueClassificationDraft>();
  for (const classification of classifications) {
    const eligibilityKey = classificationEligibilityKey(classification);
    const existing = firstClassificationByEligibility.get(eligibilityKey);
    if (existing) {
      conflicts.push({
        classificationKey: classification.key,
        conflictingClassificationKey: existing.key,
        conflictingClassificationName: existing.name.trim() || "the earlier group",
      });
      continue;
    }
    firstClassificationByEligibility.set(eligibilityKey, classification);
  }
  return conflicts;
}

const leagueClassificationPresetDefinitions = {
  custom: { name: "Scoring group", slug: "scoring-group", eligibility: {} },
  female: { name: "Female", slug: "female", eligibility: { gender: "F", minimumAge: 16, maximumAge: 64.99 } },
  male: { name: "Male", slug: "male", eligibility: { gender: "M", minimumAge: 16, maximumAge: 64.99 } },
  girls_u16: { name: "Female U16", slug: "girls-u16", eligibility: { gender: "F", maximumAge: 15.99 } },
  boys_u16: { name: "Male U16", slug: "boys-u16", eligibility: { gender: "M", maximumAge: 15.99 } },
  senior: { name: "Senior 65+", slug: "senior-65-plus", eligibility: { minimumAge: 65 } },
} as const;

function uniqueClassificationName(name: string, classifications: LeagueClassificationDraft[]) {
  const usedNames = new Set(classifications.map((classification) => classification.name.trim().toLowerCase()));
  if (!usedNames.has(name.toLowerCase())) return name;
  let suffix = 2;
  while (usedNames.has(`${name} ${suffix}`.toLowerCase())) suffix += 1;
  return `${name} ${suffix}`;
}

export function createAdditionalLeagueClassificationDraft(
  classifications: LeagueClassificationDraft[],
) {
  return createLeagueClassificationPresetDraft("custom", classifications);
}

export function createLeagueClassificationPresetDraft(
  preset: LeagueClassificationPreset,
  classifications: LeagueClassificationDraft[],
) {
  const index = classifications.length;
  const draft = createClassificationDraft(leagueClassificationPresetDefinitions[preset], index);
  const name = uniqueClassificationName(draft.name, classifications);
  return {
    ...draft,
    key: `new-classification-${index + 1}-${Date.now()}`,
    name,
    slug: toLeagueCompetitionSlug(name),
  };
}

export function describeLeagueClassification(classification: LeagueClassificationDraft) {
  const parts = [classification.gender === "F" ? "Female" : classification.gender === "M" ? "Male" : "Any sex"];
  if (classification.anyAge) {
    parts.push("Any age");
  } else if (classification.minimumAge && classification.maximumAge) {
    parts.push(`ages ${classification.minimumAge}–${classification.maximumAge}`);
  } else if (classification.minimumAge) {
    parts.push(`age ${classification.minimumAge}+`);
  } else if (classification.maximumAge) {
    parts.push(`age through ${classification.maximumAge}`);
  }
  return parts.join(" · ");
}

function createCompetitionDraft(
  input: {
    key: string;
    slug: string;
    name: string;
    isDefault?: boolean;
    standingsMode?: OrganizerLeagueCompetition["standingsMode"];
    scoringRules?: OrganizerLeagueCompetition["scoringRules"];
    classifications?: OrganizerLeagueCompetition["classifications"];
  },
  planning: LeagueSeasonPlanningDraft,
): LeagueCompetitionDraft {
  const scoringRules = input.scoringRules;
  const scoringMethod = scoringRules
    ? parseLeagueScoringMethod(scoringRules.scoringMethod)
    : "hybrid";
  const pointsTablePreset = scoringRules
    ? (scoringRules.fieldSizeProfile || inferLeaguePointsTablePreset(scoringRules.pointsTable))
    : planning.pointsTablePreset;
  const plannedRounds = Number.parseInt(planning.plannedRoundCount, 10) || 1;
  const bestN = scoringRules?.bestN ?? (Number.parseInt(planning.bestN, 10) || plannedRounds);
  const scoringParameters = normalizeLeagueScoringParameters(
    scoringRules?.scoringParameters,
    scoringRules?.pointsTable,
  );
  const inheritedParticipationPoints = scoringRules?.participationPoints
    ?? getLeagueParticipationPoints(planning.pointsTablePreset, planning.participationPoints);
  const defaultParticipationPoints = scoringMethod === "custom"
    ? inheritedParticipationPoints
    : Math.max(1, inheritedParticipationPoints);
  const defaultCurve = buildLeagueScoringCurve({
    method: scoringMethod === "geometric" ? "geometric" : "hybrid",
    maximumPoints: scoringParameters.maximumPoints,
    expectedFinishers: scoringParameters.expectedFinishers,
    finisherPoints: Math.max(1, defaultParticipationPoints),
    hybridEmphasis: scoringParameters.hybridEmphasis,
  }).points;

  return {
    key: input.key,
    slug: input.slug,
    name: input.name,
    isDefault: input.isDefault === true,
    standingsMode: input.standingsMode ?? "points",
    scoringMethod,
    maximumPoints: String(scoringParameters.maximumPoints),
    expectedFinishers: String(scoringParameters.expectedFinishers),
    hybridEmphasis: scoringParameters.hybridEmphasis,
    pointsTablePreset,
    customPoints: (scoringRules?.pointsTable?.length
      ? scoringRules.pointsTable
      : scoringMethod === "custom"
        ? getLeaguePointsTableFromPreset(planning.pointsTablePreset, planning.customPoints)
        : defaultCurve
    ).join(", "),
    participationPoints: String(defaultParticipationPoints),
    countingMode: bestN >= plannedRounds ? "all_rounds" : "best_n",
    bestN: positiveInteger(bestN, planning.bestN),
    minimumRounds: positiveInteger(scoringRules?.minimumRounds, planning.minimumRounds),
    tieBreakMethod: scoringRules?.tieBreakMethod ?? planning.tieBreakMethod,
    classifications: input.classifications === undefined
      ? []
      : input.classifications.map(createClassificationDraft),
  };
}

export function getLeagueCompetitionPointsTable(competition: LeagueCompetitionDraft) {
  if (competition.scoringMethod === "custom") {
    return getLeaguePointsTableFromPreset(competition.pointsTablePreset, competition.customPoints);
  }
  return buildLeagueScoringCurve({
    method: competition.scoringMethod,
    maximumPoints: Number(competition.maximumPoints),
    expectedFinishers: Number(competition.expectedFinishers),
    finisherPoints: Number(competition.participationPoints),
    hybridEmphasis: competition.hybridEmphasis,
  }).points;
}

export function createDefaultLeagueCompetitionDrafts(
  planning: LeagueSeasonPlanningDraft,
): LeagueCompetitionDraft[] {
  return [
    createCompetitionDraft({ key: "short", slug: "short", name: "Short", isDefault: true }, planning),
    createCompetitionDraft({ key: "long", slug: "long", name: "Long", isDefault: false }, planning),
  ];
}

export function buildLeagueCompetitionDrafts(
  competitions: OrganizerLeagueCompetition[] | null | undefined,
  planning: LeagueSeasonPlanningDraft,
) {
  const activeCompetitions = (competitions ?? []).filter(
    (competition) => competition.scoringTarget === "individual" && competition.status !== "archived",
  );
  if (!activeCompetitions.length) return createDefaultLeagueCompetitionDrafts(planning);

  const drafts = activeCompetitions.map((competition) => createCompetitionDraft({
    key: competition.id,
    slug: competition.slug,
    name: competition.name,
    isDefault: competition.isDefault,
    standingsMode: competition.standingsMode,
    scoringRules: competition.scoringRules,
    classifications: competition.classifications,
  }, planning));
  if (!drafts.some((competition) => competition.isDefault) && drafts[0]) {
    drafts[0].isDefault = true;
  }
  return drafts;
}

export function createAdditionalLeagueCompetitionDraft(
  planning: LeagueSeasonPlanningDraft,
  index: number,
) {
  const name = `Race category ${index + 1}`;
  return createCompetitionDraft({
    key: `new-${index + 1}-${Date.now()}`,
    slug: `${toLeagueCompetitionSlug(name)}-${index + 1}`,
    name,
    isDefault: false,
  }, planning);
}

function buildCompetitionScoringRules(
  competition: LeagueCompetitionDraft,
  planning: LeagueSeasonPlanningDraft,
): OrganizerLeagueScoringRulesInput {
  const plannedRounds = Math.max(1, Number.parseInt(planning.plannedRoundCount, 10) || 1);
  const pointsTable = getLeagueCompetitionPointsTable(competition);
  return {
    name: `${competition.name.trim()} scoring`,
    pointsTable,
    fieldSizeProfile: competition.scoringMethod === "custom" ? competition.pointsTablePreset : "custom",
    participationPoints: competition.scoringMethod === "custom"
      ? getLeagueParticipationPoints(competition.pointsTablePreset, competition.participationPoints)
      : Math.max(1, Number.parseInt(competition.participationPoints, 10) || 1),
    scoringMethod: competition.scoringMethod,
    scoringParameters: competition.scoringMethod === "custom" ? null : {
      maximumPoints: Math.max(1, Number.parseInt(competition.maximumPoints, 10) || defaultLeagueScoringParameters.maximumPoints),
      expectedFinishers: Math.max(2, Number.parseInt(competition.expectedFinishers, 10) || defaultLeagueScoringParameters.expectedFinishers),
      hybridEmphasis: competition.hybridEmphasis,
    },
    bestN: competition.countingMode === "all_rounds"
      ? plannedRounds
      : Math.max(1, Number.parseInt(competition.bestN, 10) || 1),
    minimumRounds: Math.max(1, Number.parseInt(competition.minimumRounds, 10) || 1),
    tieBreakMethod: competition.tieBreakMethod,
    clubScoringMode: planning.clubScoringMode,
  };
}

function buildCompetitionClassifications(competition: LeagueCompetitionDraft) {
  return competition.classifications.map((classification) => ({
    name: classification.name.trim(),
    slug: toLeagueCompetitionSlug(classification.slug || classification.name),
    isDefault: classification.isDefault,
    eligibility: {
      ...(classification.gender === "F" || classification.gender === "M"
        ? { gender: classification.gender }
        : {}),
      ...(!classification.anyAge && classification.minimumAge
        ? { minimumAge: Number(classification.minimumAge) }
        : {}),
      ...(!classification.anyAge && classification.maximumAge
        ? { maximumAge: Number(classification.maximumAge) }
        : {}),
    },
  }));
}

export function buildLeagueCompetitionInputs(
  competitions: LeagueCompetitionDraft[],
  planning: LeagueSeasonPlanningDraft,
): OrganizerLeagueCompetitionInput[] {
  return competitions.map((competition) => ({
    slug: competition.slug,
    name: competition.name.trim(),
    isDefault: competition.isDefault,
    description: `${competition.name.trim()} race category and standings.`,
    scoringTarget: "individual",
    resultBasis: competition.standingsMode === "best_time" ? "elapsed_time" : "finish_place",
    standingsMode: competition.standingsMode,
    scoringRules: competition.standingsMode === "points"
      ? buildCompetitionScoringRules(competition, planning)
      : null,
    classifications: buildCompetitionClassifications(competition),
  }));
}

export function validateLeagueCompetitionDrafts(
  competitions: LeagueCompetitionDraft[],
  planning: LeagueSeasonPlanningDraft,
) {
  if (!competitions.length) return "Add at least one league race category.";
  const normalizedNames = competitions.map((competition) => competition.name.trim().toLowerCase());
  if (competitions.some((competition) => competition.name.trim().length < 2)) {
    return "Every league race category needs a name.";
  }
  if (new Set(normalizedNames).size !== normalizedNames.length) {
    return "League race category names must be unique.";
  }

  for (const competition of competitions) {
    const competitionError = validateLeagueCompetitionDraft(competition, planning);
    if (competitionError) return competitionError;
  }
  return null;
}

export function validateLeagueCompetitionDraft(
  competition: LeagueCompetitionDraft,
  planning: LeagueSeasonPlanningDraft,
) {
    const plannedRounds = Math.max(1, Number.parseInt(planning.plannedRoundCount, 10) || 1);
    const classificationNames = competition.classifications.map((classification) => classification.name.trim().toLowerCase());
    if (competition.classifications.some((classification) => classification.name.trim().length < 2)) {
      return `${competition.name}: every scoring group needs a name.`;
    }
    if (new Set(classificationNames).size !== classificationNames.length) {
      return `${competition.name}: scoring group names must be unique.`;
    }
    for (const classification of competition.classifications) {
      const minimumAge = classification.anyAge || classification.minimumAge === ""
        ? null
        : Number(classification.minimumAge);
      const maximumAge = classification.anyAge || classification.maximumAge === ""
        ? null
        : Number(classification.maximumAge);
      if (!classification.anyAge && minimumAge == null && maximumAge == null) {
        return `${competition.name} · ${classification.name}: enter an age limit or leave both age fields blank for any age.`;
      }
      if (minimumAge != null && (!Number.isFinite(minimumAge) || minimumAge < 0 || minimumAge > 120)) {
        return `${competition.name} · ${classification.name}: age from must be between 0 and 120.`;
      }
      if (maximumAge != null && (!Number.isFinite(maximumAge) || maximumAge < 0 || maximumAge > 120)) {
        return `${competition.name} · ${classification.name}: age through must be between 0 and 120.`;
      }
      if (minimumAge != null && maximumAge != null && minimumAge > maximumAge) {
        return `${competition.name} · ${classification.name}: age from cannot exceed age through.`;
      }
    }
    const firstConflict = getLeagueClassificationConflicts(competition.classifications)[0];
    if (firstConflict) {
      const classification = competition.classifications.find(
        (candidate) => candidate.key === firstConflict.classificationKey,
      );
      return `${competition.name} · ${classification?.name || "Scoring group"} selects the same runners as ${firstConflict.conflictingClassificationName}. Change Participants or Age from/through.`;
    }
    if (competition.standingsMode !== "points") return null;
    const points = getLeagueCompetitionPointsTable(competition);
    const participationPoints = competition.scoringMethod === "custom"
      ? getLeagueParticipationPoints(competition.pointsTablePreset, competition.participationPoints)
      : Number(competition.participationPoints);
    if (!points.length) return `${competition.name}: add at least one graded points value.`;
    if (points.some((pointsValue) => !Number.isFinite(pointsValue) || pointsValue < 0)) {
      return `${competition.name}: points must be zero or greater.`;
    }
    if (participationPoints > (points.at(-1) ?? 0)) {
      return `${competition.name}: participation points cannot exceed the last graded score.`;
    }
    if (competition.scoringMethod !== "custom") {
      const maximumPoints = Number(competition.maximumPoints);
      const expectedFinishers = Number(competition.expectedFinishers);
      if (!Number.isInteger(maximumPoints) || maximumPoints < 2 || maximumPoints > 10_000) {
        return `${competition.name}: winner points must be between 2 and 10,000.`;
      }
      if (!Number.isInteger(expectedFinishers) || expectedFinishers < 2 || expectedFinishers > 500) {
        return `${competition.name}: expected finishers must be between 2 and 500.`;
      }
      if (!Number.isInteger(participationPoints) || participationPoints < 1 || participationPoints >= maximumPoints) {
        return `${competition.name}: finisher minimum must be at least 1 and lower than winner points.`;
      }
    }
    const bestN = competition.countingMode === "all_rounds"
      ? plannedRounds
      : Number.parseInt(competition.bestN, 10);
    const minimumRounds = Number.parseInt(competition.minimumRounds, 10);
    if (!Number.isFinite(bestN) || bestN < 1 || bestN > plannedRounds) {
      return `${competition.name}: counted results must be between 1 and ${plannedRounds}.`;
    }
    if (!Number.isFinite(minimumRounds) || minimumRounds < 1 || minimumRounds > plannedRounds) {
      return `${competition.name}: minimum finishes must be between 1 and ${plannedRounds}.`;
    }
  return null;
}

function normalizeMappingName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function mappingIntent(competition: LeagueRaceMappingCompetition) {
  // Slugs are stable identifiers, not instructions: a renamed "Long" competition
  // must not keep selecting the longest course because of its old slug.
  const value = normalizeMappingName(competition.name);
  if (/\b(short|kratka|mini|sprint)\b/.test(value)) return "short";
  if (/\b(long|duga|ultra|marathon)\b/.test(value)) return "long";
  return "neutral";
}

export function getLeagueRaceCompatibilityIssue(
  competition: LeagueRaceMappingCompetition,
  race: LeagueRaceMappingOption,
) {
  if (!competition.classifications || !race.rankingConfig) return null;
  return getLeagueRaceRankingCompatibilityIssue(
    competition.name,
    competition.classifications,
    race.name,
    race.rankingConfig,
  );
}

export function autoMapLeagueEventRaces(
  competitions: LeagueRaceMappingCompetition[],
  races: LeagueRaceMappingOption[],
) {
  const sortedRaces = [...races].sort((left, right) => {
    const leftDistance = left.distanceKm ?? Number.POSITIVE_INFINITY;
    const rightDistance = right.distanceKm ?? Number.POSITIVE_INFINITY;
    return leftDistance - rightDistance || left.name.localeCompare(right.name);
  });
  const remaining = new Map(sortedRaces.map((race) => [race.id, race]));
  const mappings: Record<string, string> = {};

  function selectRace(
    competition: LeagueRaceMappingCompetition,
    candidates: LeagueRaceMappingOption[],
  ) {
    const exactName = candidates.find((race) => normalizeMappingName(race.name) === normalizeMappingName(competition.name));
    if (exactName) return exactName;
    const distance = competition.name.match(/\b(\d+(?:[.,]\d+)?)\s*(km|k|m)\b/i);
    if (distance) {
      const kilometers = Number(distance[1].replace(",", ".")) / (distance[2].toLowerCase() === "m" ? 1000 : 1);
      return candidates.find((race) => race.distanceKm != null && Math.abs(race.distanceKm - kilometers) < 0.0001);
    }
    const intent = mappingIntent(competition);
    const intentMatch = candidates.find((race) => {
      const raceName = normalizeMappingName(race.name);
      return intent === "short"
        ? /\b(short|kratka|mini|sprint)\b/.test(raceName)
        : intent === "long"
          ? /\b(long|duga|ultra|marathon)\b/.test(raceName)
          : false;
    });
    return intentMatch ?? (intent === "long" ? candidates.at(-1) : candidates[0]);
  }

  // Reserve exact ranking matches first so one incompatible fallback cannot
  // take the only valid race from a later league competition.
  for (const competition of competitions) {
    const compatibleCandidates = Array.from(remaining.values()).filter(
      (race) => !getLeagueRaceCompatibilityIssue(competition, race),
    );
    const match = selectRace(competition, compatibleCandidates);
    if (!match) continue;
    mappings[competition.id] = match.id;
    remaining.delete(match.id);
  }

  for (const competition of competitions) {
    if (mappings[competition.id]) continue;
    const match = selectRace(competition, Array.from(remaining.values()));
    if (!match) continue;
    mappings[competition.id] = match.id;
    remaining.delete(match.id);
  }
  return mappings;
}

export function getLeagueEventRaceCountWarning(
  competitionCount: number,
  raceCount: number,
) {
  if (competitionCount === raceCount) return null;
  if (raceCount < competitionCount) {
    const unmappedCount = competitionCount - raceCount;
    return `This league has ${competitionCount} race ${competitionCount === 1 ? "category" : "categories"}, but the race has ${raceCount} competitive ${raceCount === 1 ? "race" : "races"}. You can still add the round, but ${unmappedCount} league ${unmappedCount === 1 ? "category" : "categories"} will not score in it.`;
  }

  const unusedCount = raceCount - competitionCount;
  return `This league has ${competitionCount} route ${competitionCount === 1 ? "category" : "categories"}, but the race has ${raceCount} competitive ${raceCount === 1 ? "route" : "routes"}. You can still add the round, but ${unusedCount} ${unusedCount === 1 ? "route" : "routes"} will not count toward league standings.`;
}

export function getLeagueRoundRankingCompatibilityIssue(
  competitions: LeagueRaceMappingCompetition[],
  races: LeagueRaceMappingOption[],
  selectedRaceIds: Record<string, string>,
) {
  const racesById = new Map(races.map((race) => [race.id, race]));
  for (const competition of competitions) {
    const race = racesById.get(selectedRaceIds[competition.id]);
    if (!race) continue;
    const issue = getLeagueRaceCompatibilityIssue(competition, race);
    if (issue) return issue;
  }
  return null;
}
