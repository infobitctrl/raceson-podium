import type { CompetitiveRankingConfig } from "@/lib/ranking-config";
import type {
  PublicResultStandingClassification,
  PublicResultsRow,
} from "@/lib/portal-read-models";
import { getClassificationLabels } from "@/shared/domain/competitiveClassification";

type ResultStandingRow = Pick<
  PublicResultsRow,
  "ageGroupLabel" | "ageOnEventDate" | "ageRank" | "finishTimeMs" | "gender" | "genderRank" | "overall" | "status"
>;

const numericAgePattern = "(\\d{1,3}(?:\\.\\d{1,2})?)";

export type ResultStandingScope =
  | { id: "overall"; kind: "overall"; label: string; shortLabel: string; count: number }
  | { id: `sex:${string}`; kind: "sex"; label: string; shortLabel: string; count: number; gender: "F" | "M" }
  | { id: `age:${string}`; kind: "age"; label: string; shortLabel: string; count: number; ageGroupLabel: string }
  | ({
      id: `classification:${string}`;
      kind: "classification";
      shortLabel: string;
      count: number;
    } & PublicResultStandingClassification);

function isIntrinsicOverallClassification(
  classification: PublicResultStandingClassification,
) {
  return classification.id.trim().toLowerCase() === "overall"
    || (
      classification.label.trim().toLowerCase() === "overall"
      && classification.gender == null
      && classification.minimumAge == null
      && classification.maximumAge == null
    );
}

export function rowMatchesResultStandingClassification(
  row: ResultStandingRow,
  classification: PublicResultStandingClassification,
) {
  if (classification.gender && row.gender !== classification.gender) return false;
  if (classification.minimumAge == null && classification.maximumAge == null) return true;
  const ageLabel = row.ageGroupLabel?.trim() ?? "";
  const rangeMatch = ageLabel.match(new RegExp(`^${numericAgePattern}\\s*[-–—]\\s*${numericAgePattern}$`));
  const plusMatch = ageLabel.match(new RegExp(`^${numericAgePattern}\\s*\\+$`));
  const underMatch = ageLabel.match(new RegExp(`^U(?:nder\\s*)?${numericAgePattern}$`, "i"));
  const categoryMinimum = rangeMatch
    ? Number(rangeMatch[1])
    : plusMatch
      ? Number(plusMatch[1])
      : underMatch
        ? 0
        : null;
  const categoryMaximum = rangeMatch
    ? Number(rangeMatch[2])
    : plusMatch
      ? null
      : underMatch
        ? Math.max(0, Number(underMatch[1]) - 1)
        : null;

  if (classification.minimumAge != null) {
    if (row.ageOnEventDate != null) {
      if (row.ageOnEventDate < classification.minimumAge) return false;
    } else if (categoryMinimum == null || categoryMinimum < classification.minimumAge) {
      return false;
    }
  }
  if (classification.maximumAge != null) {
    if (row.ageOnEventDate != null) {
      if (row.ageOnEventDate > classification.maximumAge) return false;
    } else if (categoryMaximum == null || categoryMaximum > classification.maximumAge) {
      return false;
    }
  }
  return true;
}

export function buildResultStandingScopes(
  rankingConfig: CompetitiveRankingConfig,
  rows: ResultStandingRow[],
  standingClassifications: PublicResultStandingClassification[] = [],
): ResultStandingScope[] {
  const overallScope: ResultStandingScope = {
    id: "overall",
    kind: "overall",
    label: "Overall",
    shortLabel: "OVR",
    count: rows.length,
  };
  const configuredClassifications = standingClassifications.length
    ? standingClassifications
    : rankingConfig.classifications.map((classification) => ({
        id: classification.key,
        label: classification.label,
        gender: classification.gender,
        minimumAge: classification.minimumAge,
        maximumAge: classification.maximumAge,
      }));

  return [
    overallScope,
    ...configuredClassifications
      .filter((classification) => !isIntrinsicOverallClassification(classification))
      .map((classification) => ({
        ...classification,
        ...getClassificationLabels(classification.label),
        id: `classification:${classification.id}` as const,
        kind: "classification" as const,
        count: rows.filter((row) => rowMatchesResultStandingClassification(row, classification)).length,
      })),
  ];
}

export function resultRowsForStandingScope<T extends ResultStandingRow>(
  rows: T[],
  scope: ResultStandingScope,
) {
  if (scope.kind === "sex") return rows.filter((row) => row.gender === scope.gender);
  if (scope.kind === "age") return rows.filter((row) => row.ageGroupLabel === scope.ageGroupLabel);
  if (scope.kind === "classification") {
    return rows.filter((row) => rowMatchesResultStandingClassification(row, scope));
  }
  return rows;
}

export function getResultStandingRank(
  row: ResultStandingRow,
  scope: ResultStandingScope,
  scopedRows: ResultStandingRow[] = [],
) {
  if (scope.kind === "sex") return row.genderRank;
  if (scope.kind === "age") return row.ageRank;
  if (scope.kind === "classification") {
    if (row.status && row.status !== "finished") return 0;
    const rowIndex = scopedRows.indexOf(row);
    if (rowIndex < 0) return 0;
    if (row.finishTimeMs == null) return rowIndex + 1;
    const firstMatchingTimeIndex = scopedRows.findIndex(
      (candidate) => candidate.finishTimeMs === row.finishTimeMs,
    );
    return firstMatchingTimeIndex + 1;
  }
  return row.overall;
}

export type ResultStandingPlacement = {
  scope: Exclude<ResultStandingScope, { kind: "overall" }>;
  rank: number;
};

export function getResultStandingPlacements(
  row: ResultStandingRow,
  scopes: ResultStandingScope[],
  rows: ResultStandingRow[],
): ResultStandingPlacement[] {
  return scopes.flatMap((scope) => {
    if (scope.kind === "overall") return [];
    const scopedRows = resultRowsForStandingScope(rows, scope);
    if (!scopedRows.includes(row)) return [];
    const rank = getResultStandingRank(row, scope, scopedRows);
    return rank > 0 ? [{ scope, rank }] : [];
  });
}
