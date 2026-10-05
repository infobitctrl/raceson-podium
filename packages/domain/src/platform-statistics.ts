/** Aggregate-only platform statistics contract. No account or athlete identifiers. */
export const PLATFORM_STATISTICS_PERIODS = ["30d", "90d", "12m", "all"] as const;
export type PlatformStatisticsPeriod = typeof PLATFORM_STATISTICS_PERIODS[number];
export const PLATFORM_STATISTICS_METRICS = [
  "registrations", "athletes", "accounts", "events", "races", "organizers", "clubs", "leagues", "routes",
] as const;
export type PlatformStatisticsMetric = typeof PLATFORM_STATISTICS_METRICS[number];
export type PlatformStatisticsPoint = {
  date: string;
  total: number;
  added: number;
  changePercent: number | null;
  partial: boolean;
};
export type PlatformStatisticsSeries = {
  key: PlatformStatisticsMetric;
  total: number;
  added: number;
  changePercent: number | null;
  undated: number;
  points: PlatformStatisticsPoint[];
};
export type PlatformStatistics = {
  period: PlatformStatisticsPeriod;
  interval: "day" | "week" | "month" | "year";
  timezone: "Europe/Zagreb";
  asOf: string;
  startDate: string;
  endDate: string;
  series: PlatformStatisticsSeries[];
  participation: Array<{ date: string; firstObserved: number; returning: number; partial: boolean }>;
  organizers: Array<{ name: string; registrations: number; athletes: number }>;
  excludedRegistrations: number;
  cancelledRegistrations: number;
};

/** Zero-to-anything has no percentage denominator, including zero-to-zero. */
export function platformGrowthPercent(current: number, previous: number): number | null {
  return previous > 0 ? Math.round((current - previous) / previous * 10_000) / 100 : null;
}

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Zagreb", year: "numeric", month: "2-digit", day: "2-digit",
});
export function platformStatisticsDate(value: string | Date): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = dateFormatter.formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shiftDay(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function shiftMonth(date: string, months: number) {
  const value = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + months);
  return value.toISOString().slice(0, 10);
}

export function platformStatisticsWindow(period: PlatformStatisticsPeriod, asOf: Date, earliest?: string) {
  const today = platformStatisticsDate(asOf);
  if (!today) throw new Error("Invalid statistics date");
  const interval: PlatformStatistics["interval"] = period === "30d" ? "day" : period === "90d" ? "week"
    : period === "all" && earliest && Number(today.slice(0, 4)) - Number(earliest.slice(0, 4)) >= 10 ? "year" : "month";
  const startDate = period === "30d" ? shiftDay(today, -29)
    : period === "90d" ? shiftDay(today, -89)
    : period === "12m" ? shiftMonth(today, -11)
    : interval === "year" ? `${(earliest ?? today).slice(0, 4)}-01-01` : `${(earliest ?? today).slice(0, 7)}-01`;
  const endDate = shiftDay(today, 1);
  const buckets: Array<{ start: string; end: string; partial: boolean }> = [];
  let cursor = startDate;
  while (cursor < endDate) {
    const end = interval === "day" ? shiftDay(cursor, 1) : interval === "week" ? shiftDay(cursor, 7)
      : shiftMonth(cursor, interval === "year" ? 12 : 1);
    buckets.push({ start: cursor, end, partial: end > today });
    cursor = end;
  }
  return { startDate, endDate: today, interval, buckets };
}

/** Counts are reconstructed from retained records, not historical active snapshots. */
export function buildPlatformStatisticsSeries(
  key: PlatformStatisticsMetric,
  dates: Array<string | null>,
  window: ReturnType<typeof platformStatisticsWindow>,
): PlatformStatisticsSeries {
  const knownDates = dates.filter((value): value is string => value !== null && value <= window.endDate).sort();
  let position = 0;
  while (position < knownDates.length && knownDates[position]! < window.startDate) position++;
  const baseline = position;
  const points = window.buckets.map((bucket) => {
    const previous = position;
    while (position < knownDates.length && knownDates[position]! < bucket.end) position++;
    return { date: bucket.start, total: position, added: position - previous,
      changePercent: bucket.partial ? null : platformGrowthPercent(position, previous), partial: bucket.partial };
  });
  return { key, total: knownDates.length, added: knownDates.length - baseline,
    changePercent: platformGrowthPercent(knownDates.length, baseline), undated: dates.filter((date) => date === null).length, points };
}
