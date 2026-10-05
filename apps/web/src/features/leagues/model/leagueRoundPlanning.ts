export type LeagueRoundNumbered = {
  roundNumber: number;
};

export type LeagueRoundSlot<TRound extends LeagueRoundNumbered> = {
  roundNumber: number;
  round: TRound | null;
};

export function parsePlannedLeagueRoundCount(description: string | null | undefined) {
  const match = (description ?? "").match(/(?:^|\n)\s*Round Plan:\s*(\d+)\s+planned rounds?/i);
  if (!match) return 0;
  const count = Number.parseInt(match[1], 10);
  return Number.isInteger(count)
    ? Math.max(0, count)
    : 0;
}

export function buildLeagueRoundSlots<TRound extends LeagueRoundNumbered>(
  rounds: TRound[],
  description: string | null | undefined,
): LeagueRoundSlot<TRound>[] {
  const roundByNumber = new Map(rounds.map((round) => [round.roundNumber, round]));
  const largestAttachedRoundNumber = rounds.reduce(
    (largest, round) => Math.max(largest, round.roundNumber),
    0,
  );
  const slotCount = Math.max(
    rounds.length,
    largestAttachedRoundNumber,
    parsePlannedLeagueRoundCount(description),
  );

  return Array.from({ length: slotCount }, (_, index) => {
    const roundNumber = index + 1;
    return {
      roundNumber,
      round: roundByNumber.get(roundNumber) ?? null,
    };
  });
}
