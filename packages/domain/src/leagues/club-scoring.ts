export const leagueClubScoringScopes = ["combined", "per_competition"] as const;

export type LeagueClubScoringScope = (typeof leagueClubScoringScopes)[number];

export function normalizeLeagueClubScoringScope(
  value: string | null | undefined,
): LeagueClubScoringScope {
  return value === "combined" ? "combined" : "per_competition";
}
