import { PLATFORM_AGE_CATEGORIES } from "@/shared/domain/ageCategories";
import { PORTAL_DEFAULT_COMPETITION_CATEGORY_POLICY } from "@raceson/domain/categories";

export type CompetitiveSexBucket = {
  key: string;
  label: string;
  gender: "F" | "M";
};

export type CompetitiveAgeBucket = {
  key: string;
  label: string;
  minAge: number;
  maxAge: number | null;
};

export type CompetitiveTeamConfig = {
  enabled: boolean;
  mode: "club";
  label: string;
  scoringMethod: "best_three_by_place";
  scoringCount: number;
};

export type CompetitiveRankingClassification = {
  key: string;
  label: string;
  gender: "F" | "M" | null;
  minimumAge: number | null;
  maximumAge: number | null;
};

export type CompetitiveRankingClassificationPreset =
  | "custom"
  | "female"
  | "male"
  | "girls_u16"
  | "boys_u16"
  | "senior";

export type CompetitiveRankingConfig = {
  overall: {
    enabled: true;
  };
  sex: {
    enabled: boolean;
    buckets: CompetitiveSexBucket[];
  };
  age: {
    enabled: boolean;
    buckets: CompetitiveAgeBucket[];
  };
  classifications: CompetitiveRankingClassification[];
  team: CompetitiveTeamConfig;
};

export type CompetitiveTeamStanding = {
  rank: number;
  clubId: string;
  clubName: string;
  score: number;
  scorerCount: number;
  scorerRanks: number[];
  scorerNames: string[];
};

function roundAgeBoundary(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeClosedAgeBucketMaxAge(value: number | null) {
  if (value == null) return null;
  const rounded = roundAgeBoundary(Math.max(0, value));
  return Number.isInteger(rounded) ? rounded + 0.99 : rounded;
}

function slugifyKey(value: string, fallback: string) {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .replace(/-{2,}/g, "-")
      .slice(0, 48) || fallback
  );
}

function defaultSexBuckets(): CompetitiveSexBucket[] {
  return PORTAL_DEFAULT_COMPETITION_CATEGORY_POLICY.classifications.map((category) => ({
    key: category.key,
    label: category.label,
    gender: category.eligibility.gender,
  }));
}

function defaultRankingClassifications(): CompetitiveRankingClassification[] {
  return [
    { key: "female", label: "Female", gender: "F", minimumAge: 16, maximumAge: 64.99 },
    { key: "male", label: "Male", gender: "M", minimumAge: 16, maximumAge: 64.99 },
    { key: "girls-u16", label: "Female U16", gender: "F", minimumAge: null, maximumAge: 15.99 },
    { key: "boys-u16", label: "Male U16", gender: "M", minimumAge: null, maximumAge: 15.99 },
    { key: "senior-65-plus", label: "Senior 65+", gender: null, minimumAge: 65, maximumAge: null },
  ];
}

export function defaultAgeBuckets(): CompetitiveAgeBucket[] {
  return PLATFORM_AGE_CATEGORIES.map((category) => ({
    key: category.key,
    label: category.label,
    minAge: category.minAge,
    maxAge: category.maxAge == null ? null : category.maxAge + 0.99,
  }));
}

export function defaultCompetitiveRankingConfig(): CompetitiveRankingConfig {
  const classifications = defaultRankingClassifications();
  return {
    overall: { enabled: true },
    sex: {
      enabled: true,
      buckets: defaultSexBuckets(),
    },
    age: {
      enabled: false,
      buckets: defaultAgeBuckets(),
    },
    classifications,
    team: {
      enabled: false,
      mode: "club",
      label: "Club / Team",
      scoringMethod: "best_three_by_place",
      scoringCount: 3,
    },
  };
}

export function alignCompetitiveRankingConfigWithMinimumAge(
  config: CompetitiveRankingConfig,
  minimumAge: number | null,
): CompetitiveRankingConfig {
  if (minimumAge == null || !Number.isFinite(minimumAge)) return config;
  const normalizedMinimumAge = Math.max(0, minimumAge);
  const classifications = config.classifications
    .filter((classification) => (
      classification.maximumAge == null || classification.maximumAge >= normalizedMinimumAge
    ))
    .map((classification) => (
      classification.minimumAge == null || classification.minimumAge < normalizedMinimumAge
        ? { ...classification, minimumAge: normalizedMinimumAge }
        : classification
    ));
  const unchanged = classifications.length === config.classifications.length
    && classifications.every((classification, index) => classification === config.classifications[index]);
  return unchanged ? config : { ...config, classifications };
}

export function ageAwardsRankingConfigPreset(): CompetitiveRankingConfig {
  return {
    ...defaultCompetitiveRankingConfig(),
    age: {
      enabled: true,
      buckets: defaultAgeBuckets(),
    },
  };
}

export function clubTrophyRankingConfigPreset(): CompetitiveRankingConfig {
  return {
    ...defaultCompetitiveRankingConfig(),
    team: {
      enabled: true,
      mode: "club",
      label: "Club / Team",
      scoringMethod: "best_three_by_place",
      scoringCount: 3,
    },
  };
}

const rankingClassificationPresetDefinitions: Record<
  CompetitiveRankingClassificationPreset,
  Omit<CompetitiveRankingClassification, "key">
> = {
  custom: { label: "Race category", gender: null, minimumAge: null, maximumAge: null },
  female: { label: "Female", gender: "F", minimumAge: 16, maximumAge: 64.99 },
  male: { label: "Male", gender: "M", minimumAge: 16, maximumAge: 64.99 },
  girls_u16: { label: "Female U16", gender: "F", minimumAge: null, maximumAge: 15.99 },
  boys_u16: { label: "Male U16", gender: "M", minimumAge: null, maximumAge: 15.99 },
  senior: { label: "Senior 65+", gender: null, minimumAge: 65, maximumAge: null },
};

function uniqueClassificationLabel(
  label: string,
  classifications: CompetitiveRankingClassification[],
) {
  const used = new Set(classifications.map((classification) => classification.label.trim().toLowerCase()));
  if (!used.has(label.toLowerCase())) return label;
  let suffix = 2;
  while (used.has(`${label} ${suffix}`.toLowerCase())) suffix += 1;
  return `${label} ${suffix}`;
}

export function createCompetitiveRankingClassificationPreset(
  preset: CompetitiveRankingClassificationPreset,
  classifications: CompetitiveRankingClassification[],
): CompetitiveRankingClassification {
  const definition = rankingClassificationPresetDefinitions[preset];
  const label = uniqueClassificationLabel(definition.label, classifications);
  return {
    ...definition,
    key: `${slugifyKey(label, "race-category")}-${Date.now()}`,
    label,
  };
}

export function describeCompetitiveRankingClassification(
  classification: CompetitiveRankingClassification,
) {
  const parts = [classification.gender === "F" ? "Female" : classification.gender === "M" ? "Male" : "Everyone"];
  if (classification.minimumAge != null && classification.maximumAge != null) {
    parts.push(`ages ${classification.minimumAge}–${classification.maximumAge}`);
  } else if (classification.minimumAge != null) {
    parts.push(`age ${classification.minimumAge}+`);
  } else if (classification.maximumAge != null) {
    parts.push(`age through ${classification.maximumAge}`);
  } else {
    parts.push("any age");
  }
  return parts.join(" · ");
}

function legacyClassifications(
  sex: CompetitiveRankingConfig["sex"],
  age: CompetitiveRankingConfig["age"],
) {
  const classifications: CompetitiveRankingClassification[] = [];
  if (sex.enabled) {
    classifications.push(...sex.buckets.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      gender: bucket.gender,
      minimumAge: null,
      maximumAge: null,
    })));
  }
  if (age.enabled) {
    classifications.push(...age.buckets.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      gender: null,
      minimumAge: bucket.minAge,
      maximumAge: bucket.maxAge,
    })));
  }
  return classifications;
}

export function withCompetitiveRankingClassifications(
  config: CompetitiveRankingConfig,
  classifications: CompetitiveRankingClassification[],
): CompetitiveRankingConfig {
  const sexBuckets = defaultSexBuckets().map((bucket) => ({
    ...bucket,
    label: classifications.find((classification) => (
      classification.gender === bucket.gender
      && classification.minimumAge == null
      && classification.maximumAge == null
    ))?.label ?? bucket.label,
  }));
  const ageBuckets = Array.from(new Map(
    classifications
      .filter((classification) => classification.minimumAge != null || classification.maximumAge != null)
      .map((classification) => {
        const minAge = classification.minimumAge ?? 0;
        const maxAge = classification.maximumAge;
        const rangeKey = `${minAge}:${maxAge ?? ""}`;
        return [rangeKey, {
          key: `age-${rangeKey.replace(":", "-") || "open"}`,
          label: maxAge == null ? `${minAge}+` : `${minAge}–${maxAge}`,
          minAge,
          maxAge,
        } satisfies CompetitiveAgeBucket] as const;
      }),
  ).values()).sort((left, right) => left.minAge - right.minAge);

  return {
    ...config,
    classifications,
    sex: {
      enabled: classifications.some((classification) => classification.gender != null),
      buckets: sexBuckets,
    },
    age: {
      enabled: ageBuckets.length > 0,
      buckets: ageBuckets.length ? ageBuckets : defaultAgeBuckets(),
    },
  };
}

function numberOrNull(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function normalizeRankingGender(value: string | null | undefined): "F" | "M" | null {
  const normalized = (value ?? "").trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === "F" || normalized === "FEMALE" || normalized === "W") return "F";
  if (normalized === "M" || normalized === "MALE") return "M";
  return null;
}

export function ageOnRaceDay(dateOfBirth: string | null | undefined, eventDate: string | null | undefined) {
  if (!dateOfBirth || !eventDate) return null;
  const birthDate = new Date(`${dateOfBirth}T00:00:00`);
  const raceDate = new Date(`${eventDate}T00:00:00`);
  if (Number.isNaN(birthDate.getTime()) || Number.isNaN(raceDate.getTime())) return null;

  let age = raceDate.getFullYear() - birthDate.getFullYear();
  const monthDelta = raceDate.getMonth() - birthDate.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && raceDate.getDate() < birthDate.getDate())) {
    age -= 1;
  }

  return age >= 0 ? age : null;
}

export function findCompetitiveAgeBucket(
  config: CompetitiveRankingConfig,
  dateOfBirth: string | null | undefined,
  eventDate: string | null | undefined,
) {
  if (!config.age.enabled) return null;
  const age = ageOnRaceDay(dateOfBirth, eventDate);
  if (age == null) return null;
  return (
    config.age.buckets.find((bucket) => age >= bucket.minAge && (bucket.maxAge == null || age <= bucket.maxAge)) ??
    null
  );
}

export function ageGroupLabelForConfig(
  config: CompetitiveRankingConfig,
  dateOfBirth: string | null | undefined,
  eventDate: string | null | undefined,
) {
  return findCompetitiveAgeBucket(config, dateOfBirth, eventDate)?.label ?? null;
}

export function normalizeCompetitiveRankingConfig(value: unknown): CompetitiveRankingConfig {
  const defaults = defaultCompetitiveRankingConfig();
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const sexRecord = record.sex && typeof record.sex === "object" ? (record.sex as Record<string, unknown>) : {};
  const ageRecord = record.age && typeof record.age === "object" ? (record.age as Record<string, unknown>) : {};
  const teamRecord = record.team && typeof record.team === "object" ? (record.team as Record<string, unknown>) : {};

  const rawSexBuckets = Array.isArray(sexRecord.buckets) ? sexRecord.buckets : defaults.sex.buckets;
  const sexBuckets = rawSexBuckets
    .flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const bucket = item as Record<string, unknown>;
      const gender = normalizeRankingGender(typeof bucket.gender === "string" ? bucket.gender : null);
      if (!gender) return [];
      const label =
        typeof bucket.label === "string" && bucket.label.trim()
          ? bucket.label.trim()
          : gender === "F"
          ? "Female"
          : "Male";
      return [
        {
          key:
            typeof bucket.key === "string" && bucket.key.trim()
              ? bucket.key.trim()
              : slugifyKey(label, `${gender.toLowerCase()}-${index + 1}`),
          label,
          gender,
        } satisfies CompetitiveSexBucket,
      ];
    })
    .filter((bucket, index, items) => items.findIndex((entry) => entry.gender === bucket.gender) === index);

  const rawAgeBuckets = Array.isArray(ageRecord.buckets) ? ageRecord.buckets : defaults.age.buckets;
  const ageBuckets = rawAgeBuckets
    .flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const bucket = item as Record<string, unknown>;
      const minAge = numberOrNull(bucket.minAge);
      const maxAge = bucket.maxAge == null ? null : normalizeClosedAgeBucketMaxAge(numberOrNull(bucket.maxAge));
      if (minAge == null || minAge < 0) return [];
      if (maxAge != null && maxAge < minAge) return [];
      const label =
        typeof bucket.label === "string" && bucket.label.trim()
          ? bucket.label.trim()
          : maxAge == null
          ? `${minAge}+`
          : `${minAge}-${maxAge}`;
      return [
        {
          key:
            typeof bucket.key === "string" && bucket.key.trim()
              ? bucket.key.trim()
              : slugifyKey(label, `age-${index + 1}`),
          label,
          minAge,
          maxAge,
        } satisfies CompetitiveAgeBucket,
      ];
    })
    .sort((left, right) => left.minAge - right.minAge);

  const sex = {
    enabled: sexRecord.enabled === undefined ? defaults.sex.enabled : Boolean(sexRecord.enabled),
    buckets:
      sexBuckets.some((bucket) => bucket.gender === "F") && sexBuckets.some((bucket) => bucket.gender === "M")
        ? [
            sexBuckets.find((bucket) => bucket.gender === "F")!,
            sexBuckets.find((bucket) => bucket.gender === "M")!,
          ]
        : defaultSexBuckets(),
  };
  const age = {
    enabled: ageRecord.enabled === undefined ? defaults.age.enabled : Boolean(ageRecord.enabled),
    buckets: ageBuckets.length ? ageBuckets : defaultAgeBuckets(),
  };
  const rawClassifications = Array.isArray(record.classifications) ? record.classifications : null;
  const classifications = rawClassifications
    ? rawClassifications.flatMap((item, index) => {
        if (!item || typeof item !== "object") return [];
        const classification = item as Record<string, unknown>;
        const label = typeof classification.label === "string" ? classification.label.trim() : "";
        if (!label) return [];
        const gender = normalizeRankingGender(typeof classification.gender === "string" ? classification.gender : null);
        const minimumAge = numberOrNull(classification.minimumAge);
        const rawMaximumAge = numberOrNull(classification.maximumAge);
        const maximumAge = rawMaximumAge == null ? null : roundAgeBoundary(rawMaximumAge);
        if (minimumAge != null && (minimumAge < 0 || minimumAge > 120)) return [];
        if (maximumAge != null && (maximumAge < 0 || maximumAge > 120)) return [];
        if (minimumAge != null && maximumAge != null && minimumAge > maximumAge) return [];
        return [{
          key: typeof classification.key === "string" && classification.key.trim()
            ? classification.key.trim()
            : slugifyKey(label, `race-category-${index + 1}`),
          label,
          gender,
          minimumAge,
          maximumAge,
        } satisfies CompetitiveRankingClassification];
      })
    : Object.keys(record).length
      ? legacyClassifications(sex, age)
      : defaults.classifications;

  return {
    overall: { enabled: true },
    sex,
    age,
    classifications,
    team: {
      enabled: teamRecord.enabled === undefined ? defaults.team.enabled : Boolean(teamRecord.enabled),
      mode: "club",
      label:
        typeof teamRecord.label === "string" && teamRecord.label.trim()
          ? teamRecord.label.trim()
          : defaults.team.label,
      scoringMethod: "best_three_by_place",
      scoringCount: Math.max(1, Math.round(numberOrNull(teamRecord.scoringCount) ?? defaults.team.scoringCount)),
    },
  };
}
