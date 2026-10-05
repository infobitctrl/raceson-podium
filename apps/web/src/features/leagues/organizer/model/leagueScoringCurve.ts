export type LeagueScoringMethod = "geometric" | "hybrid" | "custom";

export type LeagueHybridEmphasis = "inclusive" | "balanced" | "competitive";

export type LeagueScoringCurveInput = {
  method: Exclude<LeagueScoringMethod, "custom">;
  maximumPoints: number;
  expectedFinishers: number;
  finisherPoints: number;
  hybridEmphasis: LeagueHybridEmphasis;
};

export type LeagueScoringParameters = {
  maximumPoints: number;
  expectedFinishers: number;
  hybridEmphasis: LeagueHybridEmphasis;
};

export const leagueScoringMethodOptions = [
  {
    value: "geometric",
    label: "Geometric",
    detail: "Each place loses the same percentage of points, producing a predictable curve from the winner to the finisher minimum.",
  },
  {
    value: "hybrid",
    label: "Hybrid",
    detail: "Starts from the geometric curve, then adds more weight to absolute front-of-field places and the podium.",
  },
  {
    value: "custom",
    label: "Manual table",
    detail: "Keep an exact place-by-place table for an existing or exceptional league rule.",
  },
] as const;

export const leagueHybridEmphasisOptions = [
  {
    value: "inclusive",
    label: "Inclusive",
    detail: "Keeps more of the geometric distribution so mid-pack finishers retain more points.",
  },
  {
    value: "balanced",
    label: "Balanced",
    detail: "Splits the weight evenly between the geometric baseline and front-of-field placing.",
  },
  {
    value: "competitive",
    label: "Competitive",
    detail: "Moves more weight toward absolute place and creates stronger separation near the front.",
  },
] as const;

export const defaultLeagueScoringParameters: LeagueScoringParameters = {
  maximumPoints: 100,
  expectedFinishers: 100,
  hybridEmphasis: "balanced",
};

function clampInteger(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

export function normalizeLeagueScoringParameters(
  value: Partial<LeagueScoringParameters> | null | undefined,
  pointsTable?: number[] | null,
): LeagueScoringParameters {
  const table = pointsTable ?? [];
  const maximumPoints = clampInteger(
    Number(value?.maximumPoints ?? table[0] ?? defaultLeagueScoringParameters.maximumPoints),
    1,
    10_000,
  );
  const expectedFinishers = clampInteger(
    Number(
      value?.expectedFinishers
      ?? (table.length || defaultLeagueScoringParameters.expectedFinishers),
    ),
    2,
    500,
  );
  const hybridEmphasis = leagueHybridEmphasisOptions.some(
    (option) => option.value === value?.hybridEmphasis,
  )
    ? value?.hybridEmphasis ?? defaultLeagueScoringParameters.hybridEmphasis
    : defaultLeagueScoringParameters.hybridEmphasis;

  return { maximumPoints, expectedFinishers, hybridEmphasis };
}

function buildGeometricLeaguePointsTable(input: LeagueScoringCurveInput) {
  const maximumPoints = clampInteger(input.maximumPoints, 1, 10_000);
  const expectedFinishers = clampInteger(input.expectedFinishers, 2, 500);
  const finisherPoints = clampInteger(input.finisherPoints, 1, maximumPoints);
  const ratio = Math.pow(finisherPoints / maximumPoints, 1 / (expectedFinishers - 1));

  return Array.from({ length: expectedFinishers }, (_, index) => {
    if (index === 0) return maximumPoints;
    if (index === expectedFinishers - 1) return finisherPoints;
    return Math.max(finisherPoints, Math.round(maximumPoints * Math.pow(ratio, index)));
  });
}

const hybridWeights: Record<LeagueHybridEmphasis, { geometric: number; absolute: number }> = {
  inclusive: { geometric: 0.65, absolute: 0.25 },
  balanced: { geometric: 0.45, absolute: 0.45 },
  competitive: { geometric: 0.25, absolute: 0.65 },
};

function buildHybridLeaguePointsTable(input: LeagueScoringCurveInput, geometricPoints: number[]) {
  const maximumPoints = clampInteger(input.maximumPoints, 1, 10_000);
  const expectedFinishers = clampInteger(input.expectedFinishers, 2, 500);
  const finisherPoints = clampInteger(input.finisherPoints, 1, maximumPoints);
  const pointsRange = maximumPoints - finisherPoints;
  const topPlaceDepth = Math.min(50, Math.max(10, Math.round(expectedFinishers / 2)));
  const weights = hybridWeights[input.hybridEmphasis];
  const podiumBonus = [0.1, 0.06, 0.03];

  return geometricPoints.map((geometricPointsValue, index) => {
    if (index === expectedFinishers - 1) return finisherPoints;
    const place = index + 1;
    const geometricShare = pointsRange > 0
      ? (geometricPointsValue - finisherPoints) / pointsRange
      : 1;
    const absoluteShare = place <= topPlaceDepth
      ? Math.pow((topPlaceDepth - place + 1) / topPlaceDepth, 1.25)
      : 0;
    const combinedShare = (
      (weights.geometric * geometricShare)
      + (weights.absolute * absoluteShare)
      + (podiumBonus[index] ?? 0)
    );
    return Math.min(
      maximumPoints,
      Math.max(finisherPoints, Math.round(finisherPoints + (pointsRange * combinedShare))),
    );
  });
}

export function buildLeagueScoringCurve(input: LeagueScoringCurveInput) {
  const geometricPoints = buildGeometricLeaguePointsTable(input);
  return {
    points: input.method === "geometric"
      ? geometricPoints
      : buildHybridLeaguePointsTable(input, geometricPoints),
    geometricPoints,
  };
}

export function parseLeagueScoringMethod(value: string | null | undefined): LeagueScoringMethod {
  return leagueScoringMethodOptions.some((option) => option.value === value)
    ? value as LeagueScoringMethod
    : "custom";
}
