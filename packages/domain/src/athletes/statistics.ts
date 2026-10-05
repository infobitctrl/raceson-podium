export type AthleteStatisticsCoverage = {
  from: string | null;
  to: string | null;
  completeness: "complete" | "partial" | "pending";
};

export type AthleteStatisticsMeta = {
  asOf: string;
  timezone: string;
  coverage: AthleteStatisticsCoverage;
  source: {
    kind: "recorded_activity" | "official_result";
  };
};

export type AthleteStatisticsTotals = {
  distanceKm: number;
  activities: number;
  activeDays: number;
  activeWeeks: number;
  elevationGainM: number | null;
  movingSeconds: number | null;
};

export type AthleteStatisticsComparison = {
  priorYear: number;
  throughLocalDate: string;
  distanceKm: number | null;
  deltaPercent: number | null;
};

export type AthleteCumulativeDistancePoint = {
  date: string;
  currentKm: number | null;
  priorYearDate: string;
  priorYearKm: number | null;
};

export type AthleteMonthlyStatistics = {
  month: string;
  distanceKm: number | null;
  activities: number | null;
  elevationGainM: number | null;
  observed: boolean;
};

export type AthleteDailyStatistics = {
  date: string;
  activityCount: number | null;
  distanceKm: number | null;
  observed: boolean;
};

export type AthleteStatisticsHighlight = {
  kind: "longest" | "biggest_climb";
  activityId: string;
  title: string;
  value: number;
  unit: "km" | "m";
};

export type AthleteStatisticsRecentActivity = {
  id: string;
  title: string;
  performedAt: string;
  source: string;
  trackName: string | null;
  distanceKm: number | null;
  elevationGainM: number | null;
  movingSeconds: number | null;
};

export type AthleteOfficialRaceResult = {
  resultRowId: string;
  eventSlug: string;
  eventName: string;
  eventImageUrl: string | null;
  categoryName: string;
  eventDate: string;
  distanceKm: number | null;
  elevationGainM: number | null;
  finishTimeMs: number | null;
  rankOverall: number | null;
  totalFinishers: number;
  outcome: string;
};

export type AthleteOfficialRaceMonth = {
  month: string;
  finishes: number;
  distanceKm: number;
};

export type AthleteOfficialRaceStatistics = {
  meta: AthleteStatisticsMeta;
  totals: {
    participations: number;
    finishes: number;
    distanceKm: number;
    distanceKnownFinishes: number;
    elevationGainM: number | null;
    elevationKnownFinishes: number;
    podiums: number;
    wins: number;
    bestOverallRank: number | null;
  };
  months: AthleteOfficialRaceMonth[];
  results: AthleteOfficialRaceResult[];
};

export type AthleteYearStatistics = {
  meta: AthleteStatisticsMeta;
  year: number;
  availableYears: number[];
  totals: AthleteStatisticsTotals;
  comparison: AthleteStatisticsComparison;
  cumulativeDistance: AthleteCumulativeDistancePoint[];
  months: AthleteMonthlyStatistics[];
  days: AthleteDailyStatistics[];
  highlights: AthleteStatisticsHighlight[];
  recentActivities: AthleteStatisticsRecentActivity[];
  officialRaces: AthleteOfficialRaceStatistics;
};
