export type LeagueRoundChronologyCandidate = {
  id: string;
  eventEditionId: string;
  eventDate: string | null;
  roundNumber: number;
};

export function orderLeagueRoundsChronologically<TRound extends LeagueRoundChronologyCandidate>(
  rounds: TRound[],
): Array<TRound & { roundNumber: number }> {
  return [...rounds]
    .sort((left, right) => {
      const dateComparison = (left.eventDate ?? "9999-12-31")
        .localeCompare(right.eventDate ?? "9999-12-31");
      if (dateComparison !== 0) return dateComparison;

      const editionComparison = left.eventEditionId.localeCompare(right.eventEditionId);
      if (editionComparison !== 0) return editionComparison;

      return left.id.localeCompare(right.id);
    })
    .map((round, index) => ({
      ...round,
      roundNumber: index + 1,
    }));
}
