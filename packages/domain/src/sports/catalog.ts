export const SPORT_CODES = [
  "trail_running",
  "road_running",
  "swimming",
  "road_cycling",
  "mountain_biking",
  "duathlon",
  "triathlon",
  "aquathlon",
] as const;

export type SportCode = (typeof SPORT_CODES)[number];
export type SportFamily = "running" | "swimming" | "cycling" | "multisport";

export type SportDefinition = {
  code: SportCode;
  label: string;
  shortLabel: string;
  family: SportFamily;
  isMultisport: boolean;
};

export const DEFAULT_SPORT_CODE: SportCode = "trail_running";

export const SPORT_DEFINITIONS: readonly SportDefinition[] = [
  { code: "trail_running", label: "Trail running", shortLabel: "Trail", family: "running", isMultisport: false },
  { code: "road_running", label: "Road running", shortLabel: "Road", family: "running", isMultisport: false },
  { code: "swimming", label: "Swimming", shortLabel: "Swim", family: "swimming", isMultisport: false },
  { code: "road_cycling", label: "Road cycling", shortLabel: "Road bike", family: "cycling", isMultisport: false },
  { code: "mountain_biking", label: "Mountain biking", shortLabel: "MTB", family: "cycling", isMultisport: false },
  { code: "duathlon", label: "Duathlon", shortLabel: "Duathlon", family: "multisport", isMultisport: true },
  { code: "triathlon", label: "Triathlon", shortLabel: "Triathlon", family: "multisport", isMultisport: true },
  { code: "aquathlon", label: "Aquathlon", shortLabel: "Aquathlon", family: "multisport", isMultisport: true },
] as const;

const sportCodeSet = new Set<string>(SPORT_CODES);
const sportDefinitionByCode = new Map(
  SPORT_DEFINITIONS.map((definition) => [definition.code, definition]),
);

export function isSportCode(value: unknown): value is SportCode {
  return typeof value === "string" && sportCodeSet.has(value);
}

export function getSportDefinition(code: SportCode): SportDefinition {
  return sportDefinitionByCode.get(code) ?? SPORT_DEFINITIONS[0];
}

export function normalizeSportCodes(
  values: readonly unknown[] | null | undefined,
  fallback: SportCode = DEFAULT_SPORT_CODE,
): SportCode[] {
  const normalized = Array.from(new Set((values ?? []).filter(isSportCode)));
  return normalized.length ? normalized : [fallback];
}

export function normalizeSportSelection(input: {
  sportCodes?: readonly unknown[] | null;
  primarySportCode?: unknown;
}) {
  const sportCodes = normalizeSportCodes(input.sportCodes);
  const primarySportCode = isSportCode(input.primarySportCode)
    ? input.primarySportCode
    : sportCodes[0];

  return {
    sportCodes: sportCodes.includes(primarySportCode)
      ? sportCodes
      : [primarySportCode, ...sportCodes],
    primarySportCode,
  };
}
