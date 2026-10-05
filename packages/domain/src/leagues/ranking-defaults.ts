export type LeagueRankingDefinition = {
  id: string;
  slug: string;
  displayOrder?: number | null;
  isDefault?: boolean | null;
};

function byConfiguredOrder<T extends LeagueRankingDefinition>(left: T, right: T) {
  return Number(left.displayOrder ?? 0) - Number(right.displayOrder ?? 0)
    || left.slug.localeCompare(right.slug)
    || left.id.localeCompare(right.id);
}

/**
 * Resolve a league competition from an explicit persisted default. Display
 * order is used only as a compatibility fallback for seasons created before
 * canonical defaults existed.
 */
export function resolveDefaultLeagueCompetition<T extends LeagueRankingDefinition>(
  competitions: readonly T[],
): T | null {
  return competitions.find((competition) => competition.isDefault === true)
    ?? [...competitions].sort(byConfiguredOrder)[0]
    ?? null;
}

/**
 * Overall is an intrinsic board. A configured classification becomes the
 * default only when it is explicitly marked; an existing Overall definition
 * is accepted for backwards compatibility.
 */
export function resolveDefaultLeagueClassification<T extends LeagueRankingDefinition>(
  classifications: readonly T[],
): T | null {
  return classifications.find((classification) => classification.isDefault === true)
    ?? classifications.find((classification) => classification.slug === "overall")
    ?? null;
}
