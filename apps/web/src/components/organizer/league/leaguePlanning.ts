import {
  buildLeagueScoringCurve,
  defaultLeagueScoringParameters,
  leagueScoringMethodOptions,
  normalizeLeagueScoringParameters,
  parseLeagueScoringMethod,
  type LeagueHybridEmphasis,
  type LeagueScoringMethod,
} from "@/features/leagues/organizer/model/leagueScoringCurve";
import { DEFAULT_LEAGUE_IMAGE_URL } from "@/features/leagues/model/leagueMedia";
import {
  normalizeLeagueClubScoringScope,
  type LeagueClubScoringScope,
} from "@raceson/domain/leagues";

export type LeaguePlanningOption = {
  value: string;
  label: string;
  detail: string;
};

export type LeaguePlanningScoringSeed = {
  pointsTable?: number[] | null;
  fieldSizeProfile?: string | null;
  participationPoints?: number | null;
  scoringMethod?: LeagueScoringMethod | null;
  scoringParameters?: {
    maximumPoints?: number;
    expectedFinishers?: number;
    hybridEmphasis?: LeagueHybridEmphasis;
  } | null;
  bestN?: number | null;
  minimumRounds?: number | null;
  tieBreakMethod?: string | null;
  clubScoringMode?: string | null;
};

export type LeagueSeasonPlanningDraft = {
  seasonBrief: string;
  aboutLeague: string;
  imageUrl: string;
  plannedRoundCount: string;
  roundMappingStrategy: string;
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
  standingsScope: string;
  clubScoringMode: string;
  clubScoringScope: LeagueClubScoringScope;
  resultsCadence: string;
  protestWindow: string;
  closeoutPlan: string;
  organizerNotes: string;
};

export const leagueCreationWorkflowSteps = [
  {
    step: 1,
    title: "Season",
    detail: "Name the season, set the year, and enter the planned number of rounds.",
  },
  {
    step: 2,
    title: "Race categories",
    detail: "Define each race, its point curve, and its gender or age classifications.",
  },
  {
    step: 3,
    title: "Operations & review",
    detail: "Set operations and check the complete league setup before saving.",
  },
] as const;

export const leagueRoundMappingOptions: LeaguePlanningOption[] = [
  {
    value: "race_categories",
    label: "League race categories",
    detail: "Every round is one race edition. Matching race counts are recommended, and organizers can acknowledge exceptions when adding a round.",
  },
  {
    value: "single_host_race",
    label: "One Overall competition",
    detail: "Start with one season table. Race editions become rounds first, then one scored race from each race feeds the Overall competition.",
  },
  {
    value: "equivalent_categories",
    label: "Overall + classifications",
    detail: "Use one competition with rule-driven Female, Male, and age-group classifications. Athletes are classified from profile data rather than placed manually.",
  },
  {
    value: "mixed_distance_cups",
    label: "Short + Long cups",
    detail: "Plan two competition ladders under one league identity. Each round race can later map one short and one long race into the matching cup.",
  },
] as const;

export const leaguePointsTablePresetOptions: LeaguePlanningOption[] = [
  {
    value: "small_up_to_50",
    label: "Smaller field · up to 50 runners",
    detail: "Places 1–20 receive graded points. Every official finisher from 21st onward receives 10 participation points.",
  },
  {
    value: "medium_50_200",
    label: "Regional field · 50–200 runners",
    detail: "Places 1–50 receive graded points. Every official finisher from 51st onward receives 5 participation points.",
  },
  {
    value: "large_200_plus",
    label: "Large field · 200+ runners",
    detail: "Places 1–100 receive graded points. Every official finisher from 101st onward receives 2 participation points.",
  },
  {
    value: "custom",
    label: "Custom points table",
    detail: "Enter the exact graded points and choose the flat points awarded to every later official finisher.",
  },
] as const;

export const leagueTieBreakOptions: LeaguePlanningOption[] = [
  {
    value: "best_finish",
    label: "Best finish",
    detail: "The athlete with the best single finish wins the tie.",
  },
  {
    value: "most_wins",
    label: "Most wins",
    detail: "Rewards repeated round victories before looking at other tie-breaks.",
  },
  {
    value: "last_round_better",
    label: "Better final round",
    detail: "The athlete with the better final-round result wins the tie.",
  },
  {
    value: "head_to_head",
    label: "Head-to-head",
    detail: "Break ties using direct results between tied athletes where possible.",
  },
] as const;

export const leagueStandingsScopeOptions: LeaguePlanningOption[] = [
  {
    value: "overall_only",
    label: "Overall standings only",
    detail: "Publishes one overall table without age-group or club standings.",
  },
  {
    value: "overall_and_age",
    label: "Overall + age-group standings",
    detail: "Publishes overall and age-group standings.",
  },
  {
    value: "overall_age_clubs",
    label: "Overall + age-group + club views",
    detail: "Publishes overall, age-group, and club standings.",
  },
  {
    value: "multiple_championships",
    label: "Multiple championship ladders",
    detail: "Publishes separate cups, distance ladders, or special classifications.",
  },
] as const;

export const leagueClubScoringOptions: LeaguePlanningOption[] = [
  {
    value: "none",
    label: "No club scoring",
    detail: "The league tracks only individual standings and leaves clubs outside the scoring model.",
  },
  {
    value: "best_two",
    label: "Combined races · best 2",
    detail: "Combine club scores from every mapped race and count the two highest scores.",
  },
  {
    value: "best_three",
    label: "Combined races · best 3",
    detail: "Pool the club's Short and Long results into one overall round score, then sum its strongest three performances. Clubs do not compete in separate race or age categories.",
  },
  {
    value: "best_four",
    label: "Combined races · best 4",
    detail: "Pool club scores from every mapped race in the round and count four, rewarding deeper rosters.",
  },
] as const;

export function getLeagueClubScorerCount(scoringMode: string) {
  if (scoringMode === "best_two") return 2;
  if (scoringMode === "best_three") return 3;
  if (scoringMode === "best_four") return 4;
  const customMatch = scoringMode.match(/^best_(\d+)$/);
  return customMatch ? Math.min(10, Math.max(1, Number(customMatch[1]))) : 3;
}

export function buildLeagueClubScoringMode(count: number) {
  const normalized = Math.min(10, Math.max(1, Math.round(count)));
  if (normalized === 2) return "best_two";
  if (normalized === 3) return "best_three";
  if (normalized === 4) return "best_four";
  return `best_${normalized}`;
}

export function getLeagueClubScoringLabel(scoringMode: string) {
  return scoringMode === "none"
    ? "No club scoring"
    : `Combined races · best ${getLeagueClubScorerCount(scoringMode)}`;
}

export function getLeagueClubScoringStructureLabel(
  scoringMode: string,
  scoringScope: LeagueClubScoringScope,
) {
  if (scoringMode === "none") return "No club scoring";
  const scorerCount = getLeagueClubScorerCount(scoringMode);
  return scoringScope === "combined"
    ? `One combined club table · best ${scorerCount}`
    : `Separate club tables by race category · best ${scorerCount}`;
}

function parseLeagueClubScoringMode(source: string, fallback: string) {
  const known = parseMatchingOption(leagueClubScoringOptions, source, "");
  if (known) return known;
  const countMatch = source.match(/Combined races · best (\d+)/i);
  return countMatch ? buildLeagueClubScoringMode(Number(countMatch[1])) : fallback;
}

export const leagueResultsCadenceOptions: LeaguePlanningOption[] = [
  {
    value: "every_round",
    label: "Publish after every round",
    detail: "Publish updated standings after each completed round.",
  },
  {
    value: "review_then_publish",
    label: "Manual review before publish",
    detail: "Organizer confirms results and any penalties before standings become official.",
  },
  {
    value: "weekly_batch",
    label: "Weekly batch standings update",
    detail: "Publish standings once a week when immediate updates are not practical.",
  },
] as const;

export const leagueProtestWindowOptions: LeaguePlanningOption[] = [
  {
    value: "24h",
    label: "24 hours",
    detail: "Accept protests for 24 hours after results are published.",
  },
  {
    value: "48h",
    label: "48 hours",
    detail: "Accept protests for 48 hours after results are published.",
  },
  {
    value: "72h",
    label: "72 hours",
    detail: "Accept protests for 72 hours after results are published.",
  },
  {
    value: "7d",
    label: "7 days",
    detail: "Accept protests for seven days after results are published.",
  },
] as const;

export const leagueCloseoutOptions: LeaguePlanningOption[] = [
  {
    value: "awards_only",
    label: "Final awards pack",
    detail: "Prepare champions, podiums, and prize lists without a broader season recap package.",
  },
  {
    value: "awards_and_recap",
    label: "Awards + sponsor recap",
    detail: "Prepare awards and a sponsor recap.",
  },
  {
    value: "full_closeout",
    label: "Awards + sponsor recap + archived season report",
    detail: "Prepare awards, sponsor reporting, and an archived season report.",
  },
] as const;

export type LeaguePointsProfile = {
  rankedPlaces: number;
  participationPoints: number;
  expectedFieldLabel: string;
};

export const leaguePointsProfiles: Record<string, LeaguePointsProfile> = {
  small_up_to_50: {
    rankedPlaces: 20,
    participationPoints: 10,
    expectedFieldLabel: "Up to 50 runners",
  },
  medium_50_200: {
    rankedPlaces: 50,
    participationPoints: 5,
    expectedFieldLabel: "50–200 runners",
  },
  large_200_plus: {
    rankedPlaces: 100,
    participationPoints: 2,
    expectedFieldLabel: "200+ runners",
  },
};

function buildCurvedLeaguePointsTable({ rankedPlaces, participationPoints }: LeaguePointsProfile) {
  return Array.from({ length: rankedPlaces }, (_, index) => {
    const place = index + 1;
    const remainingShare = (rankedPlaces - place + 1) / rankedPlaces;
    const curvedScore = participationPoints
      + Math.round((100 - participationPoints) * Math.pow(remainingShare, 1.18));
    return Math.max(participationPoints + 1, curvedScore);
  });
}

const pointsTablePresets: Record<string, number[]> = Object.fromEntries(
  Object.entries(leaguePointsProfiles).map(([key, profile]) => [key, buildCurvedLeaguePointsTable(profile)]),
);

const legacyPointsTablePresets: Record<string, number[]> = {
  standard_10: [100, 90, 82, 75, 70, 66, 62, 58, 55, 52],
  winner_heavy_10: [120, 102, 90, 80, 72, 65, 59, 54, 50, 46],
  balanced_15: [100, 94, 89, 84, 80, 76, 72, 68, 64, 60, 56, 52, 48, 44, 40],
};

const defaultLeagueSeasonPlanningDraft: LeagueSeasonPlanningDraft = {
  seasonBrief: "",
  aboutLeague: "",
  imageUrl: DEFAULT_LEAGUE_IMAGE_URL,
  plannedRoundCount: "6",
  roundMappingStrategy: "race_categories",
  scoringMethod: "hybrid",
  maximumPoints: String(defaultLeagueScoringParameters.maximumPoints),
  expectedFinishers: String(defaultLeagueScoringParameters.expectedFinishers),
  hybridEmphasis: defaultLeagueScoringParameters.hybridEmphasis,
  pointsTablePreset: "medium_50_200",
  customPoints: pointsTablePresets.medium_50_200.join(", "),
  participationPoints: String(leaguePointsProfiles.medium_50_200.participationPoints),
  countingMode: "best_n",
  bestN: "5",
  minimumRounds: "3",
  tieBreakMethod: "best_finish",
  standingsScope: "overall_age_clubs",
  clubScoringMode: "best_three",
  clubScoringScope: "combined",
  resultsCadence: "every_round",
  protestWindow: "72h",
  closeoutPlan: "full_closeout",
  organizerNotes: "",
};

function safePositiveInteger(value: string, fallback: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return String(parsed);
}

function safeNonNegativeInteger(value: string, fallback: string) {
  if (!value.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return String(parsed);
}

function parseMetadataLine(lines: string[], prefix: string) {
  const target = `${prefix}:`;
  const line = lines.find((entry) => entry.startsWith(target));
  return line ? line.slice(target.length).trim() : "";
}

function parseMatchingOption(options: readonly LeaguePlanningOption[], source: string, fallback: string) {
  const match = [...options]
    .sort((left, right) => right.label.length - left.label.length)
    .find((option) => source.includes(option.label));
  return match?.value ?? fallback;
}

export function getLeaguePlanningOptionLabel(
  options: readonly LeaguePlanningOption[],
  value: string,
  fallback = "Not defined",
) {
  return options.find((option) => option.value === value)?.label ?? fallback;
}

export function getLeaguePlanningOptionDetail(
  options: readonly LeaguePlanningOption[],
  value: string,
) {
  return options.find((option) => option.value === value)?.detail ?? "";
}

export function parseLeagueCustomPoints(value: string) {
  return value
    .split(/[\s,;]+/)
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry));
}

export function getLeaguePointsTableFromPreset(preset: string, customPoints = "") {
  if (preset === "custom") {
    return parseLeagueCustomPoints(customPoints);
  }
  return [...(pointsTablePresets[preset] ?? pointsTablePresets.medium_50_200)];
}

export function getLeagueParticipationPoints(
  preset: string,
  customParticipationPoints = "0",
) {
  if (preset !== "custom") {
    return leaguePointsProfiles[preset]?.participationPoints
      ?? leaguePointsProfiles.medium_50_200.participationPoints;
  }
  const parsed = Number(customParticipationPoints);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function getLeaguePointsForPlace(
  pointsTable: number[],
  participationPoints: number,
  finishPlace: number | null | undefined,
) {
  if (!Number.isInteger(finishPlace) || (finishPlace ?? 0) < 1) return 0;
  return pointsTable[(finishPlace as number) - 1] ?? Math.max(0, participationPoints);
}

export function getLeaguePlanningPointsTable(draft: LeagueSeasonPlanningDraft) {
  if (draft.scoringMethod === "custom") {
    return getLeaguePointsTableFromPreset(draft.pointsTablePreset, draft.customPoints);
  }
  return buildLeagueScoringCurve({
    method: draft.scoringMethod,
    maximumPoints: Number(draft.maximumPoints),
    expectedFinishers: Number(draft.expectedFinishers),
    finisherPoints: Number(draft.participationPoints),
    hybridEmphasis: draft.hybridEmphasis,
  }).points;
}

export function inferLeaguePointsTablePreset(pointsTable?: number[] | null) {
  const normalized = Array.isArray(pointsTable) ? pointsTable.map((entry) => Number(entry ?? 0)) : [];
  for (const [preset, values] of Object.entries(pointsTablePresets)) {
    if (normalized.length === values.length && normalized.every((entry, index) => entry === values[index])) {
      return preset;
    }
  }
  for (const values of Object.values(legacyPointsTablePresets)) {
    if (normalized.length === values.length && normalized.every((entry, index) => entry === values[index])) {
      return "custom";
    }
  }
  return normalized.length ? "custom" : defaultLeagueSeasonPlanningDraft.pointsTablePreset;
}

export function buildLeaguePlanningFromSource(input?: {
  description?: string | null;
  scoringRules?: LeaguePlanningScoringSeed | null;
  clubScoringScope?: LeagueClubScoringScope | null;
  organizerNotes?: string | null;
}) {
  const lines = (input?.description ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const roundPlan = parseMetadataLine(lines, "Round Plan");
  const scoring = parseMetadataLine(lines, "Scoring");
  const operations = parseMetadataLine(lines, "Operations");
  const pointsTable = Array.isArray(input?.scoringRules?.pointsTable)
    ? input.scoringRules.pointsTable.map((entry) => Number(entry ?? 0))
    : [];
  const pointsTablePreset = inferLeaguePointsTablePreset(pointsTable);
  const scoringMethod = input?.scoringRules
    ? parseLeagueScoringMethod(input.scoringRules.scoringMethod)
    : defaultLeagueSeasonPlanningDraft.scoringMethod;
  const scoringParameters = normalizeLeagueScoringParameters(
    input?.scoringRules?.scoringParameters,
    pointsTable,
  );
  const configuredProfile = input?.scoringRules?.fieldSizeProfile;
  const resolvedPointsTablePreset = configuredProfile === "custom" || Boolean(leaguePointsProfiles[configuredProfile ?? ""])
    ? configuredProfile ?? pointsTablePreset
    : pointsTablePreset;
  const countingMode = scoring.includes("All rounds count") ? "all_rounds" : "best_n";

  return {
    ...defaultLeagueSeasonPlanningDraft,
    seasonBrief: parseMetadataLine(lines, "Season Brief") || (input?.description?.trim() ?? ""),
    aboutLeague: parseMetadataLine(lines, "About the League"),
    imageUrl: parseMetadataLine(lines, "League Image") || defaultLeagueSeasonPlanningDraft.imageUrl,
    plannedRoundCount: safeNonNegativeInteger(roundPlan.match(/\d+/)?.[0] ?? "", defaultLeagueSeasonPlanningDraft.plannedRoundCount),
    roundMappingStrategy: parseMatchingOption(
      leagueRoundMappingOptions,
      roundPlan,
      defaultLeagueSeasonPlanningDraft.roundMappingStrategy,
    ),
    scoringMethod,
    maximumPoints: String(scoringParameters.maximumPoints),
    expectedFinishers: String(scoringParameters.expectedFinishers),
    hybridEmphasis: scoringParameters.hybridEmphasis,
    pointsTablePreset: resolvedPointsTablePreset,
    customPoints: (pointsTable.length ? pointsTable : pointsTablePresets.medium_50_200).join(", "),
    participationPoints: String(
      input?.scoringRules?.participationPoints
      ?? getLeagueParticipationPoints(resolvedPointsTablePreset, defaultLeagueSeasonPlanningDraft.participationPoints)
    ),
    countingMode,
    bestN: safePositiveInteger(
      String(input?.scoringRules?.bestN ?? scoring.match(/Best (\d+)/i)?.[1] ?? ""),
      defaultLeagueSeasonPlanningDraft.bestN,
    ),
    minimumRounds: safePositiveInteger(
      String(input?.scoringRules?.minimumRounds ?? scoring.match(/Minimum (\d+)/i)?.[1] ?? ""),
      defaultLeagueSeasonPlanningDraft.minimumRounds,
    ),
    tieBreakMethod: input?.scoringRules?.tieBreakMethod
      ?? parseMatchingOption(leagueTieBreakOptions, scoring, defaultLeagueSeasonPlanningDraft.tieBreakMethod),
    standingsScope: parseMatchingOption(
      leagueStandingsScopeOptions,
      parseMetadataLine(lines, "Standings"),
      defaultLeagueSeasonPlanningDraft.standingsScope,
    ),
    clubScoringMode: input?.scoringRules?.clubScoringMode
      ?? parseLeagueClubScoringMode(scoring, defaultLeagueSeasonPlanningDraft.clubScoringMode),
    clubScoringScope: normalizeLeagueClubScoringScope(
      input?.clubScoringScope ?? defaultLeagueSeasonPlanningDraft.clubScoringScope,
    ),
    resultsCadence: parseMatchingOption(
      leagueResultsCadenceOptions,
      operations,
      defaultLeagueSeasonPlanningDraft.resultsCadence,
    ),
    protestWindow: parseMatchingOption(
      leagueProtestWindowOptions,
      operations,
      defaultLeagueSeasonPlanningDraft.protestWindow,
    ),
    closeoutPlan: parseMatchingOption(
      leagueCloseoutOptions,
      parseMetadataLine(lines, "Closeout"),
      defaultLeagueSeasonPlanningDraft.closeoutPlan,
    ),
    // Read the legacy metadata line only long enough to migrate an existing
    // league. New writes persist this value in server-only season settings.
    organizerNotes: input?.organizerNotes ?? parseMetadataLine(lines, "Organizer Notes"),
  } satisfies LeagueSeasonPlanningDraft;
}

export function buildLeaguePlanningDescription(draft: LeagueSeasonPlanningDraft) {
  const pointsTableLabel = draft.scoringMethod === "custom"
    ? getLeaguePlanningOptionLabel(
        leaguePointsTablePresetOptions,
        draft.pointsTablePreset,
        defaultLeagueSeasonPlanningDraft.pointsTablePreset,
      )
    : getLeaguePlanningOptionLabel(leagueScoringMethodOptions, draft.scoringMethod);
  const pointsTable = getLeaguePlanningPointsTable(draft);
  const aboutLeague = draft.aboutLeague.trim().replace(/\s+/g, " ");
  const lines = [
    `Season Brief: ${draft.seasonBrief.trim()}`,
    aboutLeague ? `About the League: ${aboutLeague}` : null,
    `League Image: ${draft.imageUrl.trim() || DEFAULT_LEAGUE_IMAGE_URL}`,
    `Round Plan: ${safeNonNegativeInteger(draft.plannedRoundCount, defaultLeagueSeasonPlanningDraft.plannedRoundCount)} planned rounds · ${getLeaguePlanningOptionLabel(leagueRoundMappingOptions, draft.roundMappingStrategy)}`,
    `Scoring: ${pointsTableLabel} · Winner ${pointsTable[0] ?? 0} points · ${pointsTable.length} expected finishers · Every later official finisher earns ${getLeagueParticipationPoints("custom", draft.participationPoints)} points · ${draft.countingMode === "all_rounds" ? "All rounds count" : `Best ${safePositiveInteger(draft.bestN, defaultLeagueSeasonPlanningDraft.bestN)} results count`} · Minimum ${safePositiveInteger(draft.minimumRounds, defaultLeagueSeasonPlanningDraft.minimumRounds)} rounds to classify · Tie-break ${getLeaguePlanningOptionLabel(leagueTieBreakOptions, draft.tieBreakMethod)} · Club mode ${getLeagueClubScoringLabel(draft.clubScoringMode)} · Club structure ${getLeagueClubScoringStructureLabel(draft.clubScoringMode, draft.clubScoringScope)}`,
    `Standings: ${getLeaguePlanningOptionLabel(leagueStandingsScopeOptions, draft.standingsScope)}`,
    `Operations: ${getLeaguePlanningOptionLabel(leagueResultsCadenceOptions, draft.resultsCadence)} · Protest window ${getLeaguePlanningOptionLabel(leagueProtestWindowOptions, draft.protestWindow)}`,
    `Closeout: ${getLeaguePlanningOptionLabel(leagueCloseoutOptions, draft.closeoutPlan)}`,
  ].filter(Boolean);
  return lines.join("\n");
}

export function buildLeagueScoringRulesFromDraft(name: string, draft: LeagueSeasonPlanningDraft) {
  const plannedRoundCount = Number.parseInt(
    safePositiveInteger(draft.plannedRoundCount, defaultLeagueSeasonPlanningDraft.plannedRoundCount),
    10,
  );
  return {
    name: `${name} scoring`,
    pointsTable: getLeaguePlanningPointsTable(draft),
    fieldSizeProfile: draft.scoringMethod === "custom" ? draft.pointsTablePreset : "custom",
    participationPoints: getLeagueParticipationPoints("custom", draft.participationPoints),
    scoringMethod: draft.scoringMethod,
    scoringParameters: draft.scoringMethod === "custom" ? null : {
      maximumPoints: Number(draft.maximumPoints),
      expectedFinishers: Number(draft.expectedFinishers),
      hybridEmphasis: draft.hybridEmphasis,
    },
    bestN: draft.countingMode === "all_rounds"
      ? plannedRoundCount
      : Number.parseInt(safePositiveInteger(draft.bestN, defaultLeagueSeasonPlanningDraft.bestN), 10),
    minimumRounds: Number.parseInt(
      safePositiveInteger(draft.minimumRounds, defaultLeagueSeasonPlanningDraft.minimumRounds),
      10,
    ),
    tieBreakMethod: draft.tieBreakMethod,
    clubScoringMode: draft.clubScoringMode,
  };
}

export function getLeaguePlanningHighlights(draft: LeagueSeasonPlanningDraft) {
  return [
    `${safeNonNegativeInteger(draft.plannedRoundCount, defaultLeagueSeasonPlanningDraft.plannedRoundCount)} planned rounds`,
    draft.countingMode === "all_rounds"
      ? "All rounds count"
      : `Best ${safePositiveInteger(draft.bestN, defaultLeagueSeasonPlanningDraft.bestN)} count`,
    getLeaguePlanningOptionLabel(leagueStandingsScopeOptions, draft.standingsScope),
    getLeagueClubScoringStructureLabel(draft.clubScoringMode, draft.clubScoringScope),
  ];
}

export function getLeaguePlanningSummaryRows(draft: LeagueSeasonPlanningDraft) {
  return [
    {
      label: "Round Plan",
      value: `${safeNonNegativeInteger(draft.plannedRoundCount, defaultLeagueSeasonPlanningDraft.plannedRoundCount)} planned rounds · ${getLeaguePlanningOptionLabel(leagueRoundMappingOptions, draft.roundMappingStrategy)}`,
    },
    {
      label: "Scoring",
      value: `${draft.scoringMethod === "custom" ? getLeaguePlanningOptionLabel(leaguePointsTablePresetOptions, draft.pointsTablePreset) : getLeaguePlanningOptionLabel(leagueScoringMethodOptions, draft.scoringMethod)} · ${getLeaguePlanningPointsTable(draft).length} expected finishers + ${getLeagueParticipationPoints("custom", draft.participationPoints)} finisher minimum · ${draft.countingMode === "all_rounds" ? "All rounds count" : `Best ${safePositiveInteger(draft.bestN, defaultLeagueSeasonPlanningDraft.bestN)} count`}`,
    },
    {
      label: "Standings",
      value: getLeaguePlanningOptionLabel(leagueStandingsScopeOptions, draft.standingsScope),
    },
    {
      label: "Operations",
      value: `${getLeaguePlanningOptionLabel(leagueResultsCadenceOptions, draft.resultsCadence)} · Protest window ${getLeaguePlanningOptionLabel(leagueProtestWindowOptions, draft.protestWindow)}`,
    },
    {
      label: "Closeout",
      value: getLeaguePlanningOptionLabel(leagueCloseoutOptions, draft.closeoutPlan),
    },
  ];
}

export function getLeaguePointsTablePreview(draft: LeagueSeasonPlanningDraft) {
  return getLeaguePlanningPointsTable(draft).slice(0, 6).join(", ");
}

export function validateLeaguePlanningDraft(draft: LeagueSeasonPlanningDraft) {
  if (!draft.seasonBrief.trim()) {
    return "Add a short season brief before saving the league.";
  }

  const plannedRoundCount = Number.parseInt(draft.plannedRoundCount, 10);
  if (!Number.isFinite(plannedRoundCount) || plannedRoundCount < 1) {
    return "Planned rounds must be at least 1.";
  }

  if (draft.scoringMethod !== "custom") {
    const maximumPoints = Number(draft.maximumPoints);
    const expectedFinishers = Number(draft.expectedFinishers);
    const finisherPoints = Number(draft.participationPoints);
    if (!Number.isInteger(maximumPoints) || maximumPoints < 2 || maximumPoints > 10_000) {
      return "Winner points must be between 2 and 10,000.";
    }
    if (!Number.isInteger(expectedFinishers) || expectedFinishers < 2 || expectedFinishers > 500) {
      return "Expected finishers must be between 2 and 500.";
    }
    if (!Number.isInteger(finisherPoints) || finisherPoints < 1 || finisherPoints >= maximumPoints) {
      return "Finisher minimum must be at least 1 and lower than winner points.";
    }
  }

  const bestN = Number.parseInt(draft.bestN, 10);
  if (draft.countingMode === "best_n" && (!Number.isFinite(bestN) || bestN < 1 || bestN > plannedRoundCount)) {
    return "Best-N scoring must be between 1 and the planned round count.";
  }

  const countedRoundTarget = draft.countingMode === "all_rounds" ? plannedRoundCount : bestN;

  const minimumRounds = Number.parseInt(draft.minimumRounds, 10);
  if (!Number.isFinite(minimumRounds) || minimumRounds < 1 || minimumRounds > countedRoundTarget) {
    return "Minimum rounds must be at least 1 and cannot exceed the number of counted rounds.";
  }

  if (draft.pointsTablePreset === "custom") {
    const points = parseLeagueCustomPoints(draft.customPoints);
    if (!points.length) {
      return "Add at least one value to the custom points table.";
    }
    if (points.some((pointsValue) => pointsValue < 0 || pointsValue > 10000)) {
      return "Custom points must be between 0 and 10,000.";
    }
    const participationPoints = Number(draft.participationPoints);
    if (!Number.isFinite(participationPoints) || participationPoints < 0 || participationPoints > 10000) {
      return "Participation points must be between 0 and 10,000.";
    }
    if (participationPoints > points[points.length - 1]) {
      return "Participation points cannot exceed the final graded-place score.";
    }
  }

  return null;
}
