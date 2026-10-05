export type LeagueRankingClassificationInput = {
  name: string;
  eligibility?: Record<string, unknown> | null;
};

export type RaceRankingConfigInput = {
  sex?: {
    enabled?: boolean;
    buckets?: Array<{
      label?: string;
      gender?: string;
    }>;
  };
  age?: {
    enabled?: boolean;
    buckets?: Array<{
      label?: string;
      minAge?: number;
      maxAge?: number | null;
    }>;
  };
};

export type RankingCategoryScope = {
  label: string;
  gender: "F" | "M" | null;
  minimumAge: number | null;
  maximumAge: number | null;
};

export type LeagueRaceRankingComparison = {
  matches: boolean;
  missingFromLeague: RankingCategoryScope[];
  missingFromRace: RankingCategoryScope[];
};

function finiteNumber(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeGender(value: unknown): "F" | "M" | null {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (normalized === "F" || normalized === "FEMALE" || normalized === "W") return "F";
  if (normalized === "M" || normalized === "MALE") return "M";
  return null;
}

function normalizeMinimumAge(value: unknown) {
  const parsed = finiteNumber(value);
  if (parsed == null) return null;
  const normalized = Math.max(0, Math.ceil(parsed));
  return normalized === 0 ? null : normalized;
}

function normalizeMaximumAge(value: unknown) {
  const parsed = finiteNumber(value);
  return parsed == null ? null : Math.max(0, Math.floor(parsed));
}

function scopeKey(scope: RankingCategoryScope) {
  return `${scope.gender ?? "any"}:${scope.minimumAge ?? ""}:${scope.maximumAge ?? ""}`;
}

function leagueRankingScopes(classifications: LeagueRankingClassificationInput[]) {
  return classifications.map((classification) => ({
    label: classification.name.trim() || "Unnamed league category",
    gender: normalizeGender(classification.eligibility?.gender),
    minimumAge: normalizeMinimumAge(classification.eligibility?.minimumAge),
    maximumAge: normalizeMaximumAge(classification.eligibility?.maximumAge),
  }));
}

function raceRankingScopes(config: RaceRankingConfigInput) {
  const sexScopes = config.sex?.enabled
    ? (config.sex.buckets ?? []).flatMap((bucket) => {
        const gender = normalizeGender(bucket.gender);
        if (!gender) return [];
        return [{
          label: bucket.label?.trim() || (gender === "F" ? "Female" : "Male"),
          gender,
          minimumAge: null,
          maximumAge: null,
        } satisfies RankingCategoryScope];
      })
    : [];
  const ageScopes = config.age?.enabled
    ? (config.age.buckets ?? []).map((bucket, index) => ({
        label: bucket.label?.trim() || `Age category ${index + 1}`,
        gender: null,
        minimumAge: normalizeMinimumAge(bucket.minAge),
        maximumAge: normalizeMaximumAge(bucket.maxAge),
      } satisfies RankingCategoryScope))
    : [];
  return [...sexScopes, ...ageScopes];
}

function scopesMissingFromTarget(
  source: RankingCategoryScope[],
  target: RankingCategoryScope[],
) {
  const remainingTargetKeys = target.map(scopeKey);
  return source.filter((scope) => {
    const matchingIndex = remainingTargetKeys.indexOf(scopeKey(scope));
    if (matchingIndex < 0) return true;
    remainingTargetKeys.splice(matchingIndex, 1);
    return false;
  });
}

export function compareLeagueAndRaceRankingCategories(
  classifications: LeagueRankingClassificationInput[],
  rankingConfig: RaceRankingConfigInput,
): LeagueRaceRankingComparison {
  const leagueScopes = leagueRankingScopes(classifications);
  const raceScopes = raceRankingScopes(rankingConfig);

  // A legacy Overall group represents the only table when a race has no child
  // ranking buckets. Overall itself is otherwise implicit on both sides.
  if (
    raceScopes.length === 0
    && leagueScopes.length === 1
    && scopeKey(leagueScopes[0]) === "any::"
  ) {
    return { matches: true, missingFromLeague: [], missingFromRace: [] };
  }

  const missingFromLeague = scopesMissingFromTarget(raceScopes, leagueScopes);
  const missingFromRace = scopesMissingFromTarget(leagueScopes, raceScopes);
  return {
    matches: missingFromLeague.length === 0 && missingFromRace.length === 0,
    missingFromLeague,
    missingFromRace,
  };
}

export function describeRankingCategoryScope(scope: RankingCategoryScope) {
  const participant = scope.gender === "F" ? "female" : scope.gender === "M" ? "male" : "all participants";
  const age = scope.minimumAge != null && scope.maximumAge != null
    ? `ages ${scope.minimumAge}–${scope.maximumAge}`
    : scope.minimumAge != null
      ? `age ${scope.minimumAge}+`
      : scope.maximumAge != null
        ? `through age ${scope.maximumAge}`
        : "any age";
  return `${scope.label} (${participant}, ${age})`;
}

export function getLeagueRaceRankingCompatibilityIssue(
  _competitionName: string,
  classifications: LeagueRankingClassificationInput[],
  _raceName: string,
  rankingConfig: RaceRankingConfigInput,
) {
  // League classifications are evaluated from the athlete's gender and age,
  // not from the race's precomputed rank buckets. A mismatch therefore means
  // "league override", not "incompatible mapping". Keep the exact comparison
  // above for organizer diagnostics, but never let a lower-level race policy
  // veto the league's category policy.
  void classifications;
  void rankingConfig;
  return null;
}
