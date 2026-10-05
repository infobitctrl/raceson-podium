/** Half-open periods: the first starts at publication, the last has no end. */
export type RaceFeePeriod = { until: string | null; amountCents: number };

export function validateRaceFeePeriods(periods: readonly RaceFeePeriod[], startAt?: string | null): string | null {
  if (!periods.length) return null;
  if (periods.length < 2 || periods.length > 20) return "Use between 2 and 20 price periods.";
  let previous = -Infinity;
  for (const [index, period] of periods.entries()) {
    if (!Number.isInteger(period.amountCents) || period.amountCents < 0 || period.amountCents > 2147483647) return "Enter a valid non-negative price.";
    if (index === periods.length - 1) {
      if (period.until !== null) return "The final price must apply until the race.";
    } else {
      const end = period.until ? Date.parse(period.until) : NaN;
      if (!Number.isFinite(end) || end <= previous) return "Price period dates must be in increasing order.";
      if (startAt && end >= Date.parse(startAt)) return "Price changes must be before the race start.";
      previous = end;
    }
  }
  return null;
}

export function raceFeeAt(base: number | null | undefined, periods: readonly RaceFeePeriod[] | null | undefined, at = new Date()): number {
  if (!periods?.length) return Math.max(0, base ?? 0);
  return (periods.find((period) => period.until === null || at.getTime() < Date.parse(period.until)) ?? periods[periods.length - 1]).amountCents;
}
