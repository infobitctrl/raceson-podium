export type CompetitionCategoryLevel = "portal" | "track" | "race" | "league";

export type CompetitionCategoryEligibility = {
  gender?: "F" | "M";
  minimumAge?: number;
  maximumAge?: number;
};

export type CompetitionCategoryRule = {
  key: string;
  label: string;
  eligibility: CompetitionCategoryEligibility;
};

export type CompetitionCategoryPolicyInput = {
  portal?: CompetitionCategoryRule[];
  track?: CompetitionCategoryRule[];
  race?: CompetitionCategoryRule[];
  league?: CompetitionCategoryRule[];
};

export type ResolvedCompetitionCategoryPolicy = {
  source: CompetitionCategoryLevel;
  rules: CompetitionCategoryRule[];
};

/**
 * Overall is always a result board, while Female and Male are the default
 * participant classifications used by standalone track and race views.
 * Age awards are opt-in because organizers may use event- or league-specific
 * brackets. Platform age bands remain profile metadata and the final fallback
 * for an age label; they are not silently promoted into award categories.
 */
export const PORTAL_DEFAULT_COMPETITION_CATEGORY_POLICY = {
  overall: {
    key: "overall",
    label: "Overall",
  },
  classifications: [
    { key: "female", label: "Female", eligibility: { gender: "F" as const } },
    { key: "male", label: "Male", eligibility: { gender: "M" as const } },
  ],
} as const;

/** Highest context wins. An explicitly supplied empty list means Overall only. */
export const COMPETITION_CATEGORY_PRECEDENCE = [
  "league",
  "race",
  "track",
  "portal",
] as const satisfies readonly CompetitionCategoryLevel[];

function copyRules(rules: readonly CompetitionCategoryRule[]) {
  return rules.map((rule) => ({
    ...rule,
    eligibility: { ...rule.eligibility },
  }));
}

/**
 * Resolves definitions for the page context without merging levels. Merging
 * creates ambiguous labels and is the source of the previous cross-page drift.
 */
export function resolveCompetitionCategoryPolicy(
  input: CompetitionCategoryPolicyInput,
): ResolvedCompetitionCategoryPolicy {
  for (const source of COMPETITION_CATEGORY_PRECEDENCE) {
    const rules = input[source];
    if (rules !== undefined) {
      return { source, rules: copyRules(rules) };
    }
  }

  return {
    source: "portal",
    rules: copyRules(PORTAL_DEFAULT_COMPETITION_CATEGORY_POLICY.classifications),
  };
}
