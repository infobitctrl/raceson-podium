import type { PortalEventCategory } from "@/lib/portal-data";
import type { PublicEventParticipantRow } from "@/lib/portal-read-models";

const startedStatuses = new Set(["started", "finished", "dnf", "dsq", "stopped", "evacuated", "missing"]);

export type EventDistributionItem = {
  label: string;
  count: number;
  percent: number;
};

export type EventFinishTime = {
  registrationId: string;
  athleteName: string;
  finishTimeMs: number;
  overall: number;
};

export type EventClubEntry = {
  name: string;
  slug: string | null;
  entries: number;
};

export type EventCategoryStatistics = {
  slug: string;
  name: string;
  entries: number;
  capacity: number | null;
  starters: number;
  finishers: number;
  didNotFinish: number;
  didNotStart: number;
  finishRate: number | null;
  startAtIso: string | null;
  classificationGroups: EventDistributionItem[];
  finishTimes: EventFinishTime[];
};

function normalizedStatus(value: string) {
  return value.trim().toLowerCase();
}

function hasStarted(row: PublicEventParticipantRow) {
  return startedStatuses.has(normalizedStatus(row.participationStatus));
}

function hasFinished(row: PublicEventParticipantRow) {
  return normalizedStatus(row.participationStatus) === "finished"
    && ((row.finishTimeMs ?? 0) > 0 || row.overall > 0);
}

function athleteKey(row: PublicEventParticipantRow) {
  return row.athleteId || row.athleteSlug || row.name;
}

function publishedGenderLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "f" || normalized === "female" || normalized === "ž" || normalized === "z") return "Female";
  if (normalized === "m" || normalized === "male") return "Male";
  return "Not specified";
}

function distribution(values: string[], preferredOrder: string[] = []) {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  const order = new Map(preferredOrder.map((label, index) => [label, index]));
  return Array.from(counts.entries())
    .map(([label, count]): EventDistributionItem => ({
      label,
      count,
      percent: values.length ? Math.round((count / values.length) * 100) : 0,
    }))
    .sort((left, right) => (
      (order.get(left.label) ?? preferredOrder.length)
      - (order.get(right.label) ?? preferredOrder.length)
      || left.label.localeCompare(right.label)
    ));
}

function publishedClassificationDistribution(rows: PublicEventParticipantRow[]) {
  return distribution(
    rows.map((row) => row.classificationLabel.trim() || "Not specified"),
    ["Female", "Male", "Not specified"],
  );
}

function buildClubEntries(rows: PublicEventParticipantRow[]) {
  const clubs = new Map<string, EventClubEntry>();
  let independentEntries = 0;

  rows.forEach((row) => {
    const name = row.club.trim();
    if (!name || name.toLowerCase() === "independent") {
      independentEntries += 1;
      return;
    }
    const key = row.clubSlug || name.toLocaleLowerCase("en");
    const club = clubs.get(key);
    if (club) {
      club.entries += 1;
    } else {
      clubs.set(key, { name, slug: row.clubSlug, entries: 1 });
    }
  });

  return {
    clubEntries: Array.from(clubs.values()).sort((left, right) => right.entries - left.entries || left.name.localeCompare(right.name)),
    independentEntries,
  };
}

function categoryRowsFor(category: PortalEventCategory, rows: PublicEventParticipantRow[]) {
  return rows.filter((row) => row.categorySlug === category.slug || (category.id && row.categoryId === category.id));
}

export function buildEventStatistics(categories: PortalEventCategory[], rows: PublicEventParticipantRow[]) {
  const starters = rows.filter(hasStarted);
  const finishers = rows.filter(hasFinished);
  const athleteCategories = new Map<string, Set<string>>();
  rows.forEach((row) => {
    const key = athleteKey(row);
    const athleteRaceSet = athleteCategories.get(key) ?? new Set<string>();
    athleteRaceSet.add(row.categorySlug || row.categoryId || row.categoryLabel);
    athleteCategories.set(key, athleteRaceSet);
  });
  const { clubEntries, independentEntries } = buildClubEntries(rows);

  const categoryStatistics = categories.map((category): EventCategoryStatistics => {
    const categoryRows = categoryRowsFor(category, rows);
    const categoryStarters = categoryRows.filter(hasStarted);
    const categoryFinishers = categoryRows.filter(hasFinished);
    return {
      slug: category.slug,
      name: category.name,
      entries: categoryRows.length,
      capacity: category.maxParticipants > 0 ? category.maxParticipants : null,
      starters: categoryStarters.length,
      finishers: categoryFinishers.length,
      didNotFinish: Math.max(0, categoryStarters.length - categoryFinishers.length),
      didNotStart: Math.max(0, categoryRows.length - categoryStarters.length),
      finishRate: categoryStarters.length ? Math.round(categoryFinishers.length / categoryStarters.length * 100) : null,
      startAtIso: category.startAtIso ?? null,
      classificationGroups: publishedClassificationDistribution(categoryRows),
      finishTimes: categoryFinishers
        .flatMap((row): EventFinishTime[] => row.finishTimeMs && row.finishTimeMs > 0 ? [{
          registrationId: row.registrationId,
          athleteName: row.name,
          finishTimeMs: row.finishTimeMs,
          overall: row.overall,
        }] : [])
        .sort((left, right) => left.finishTimeMs - right.finishTimeMs || left.overall - right.overall),
    };
  });

  return {
    entries: rows.length,
    uniqueAthletes: athleteCategories.size,
    multiCourseAthletes: Array.from(athleteCategories.values()).filter((raceSet) => raceSet.size > 1).length,
    starters: starters.length,
    finishers: finishers.length,
    didNotFinish: Math.max(0, starters.length - finishers.length),
    didNotStart: Math.max(0, rows.length - starters.length),
    clubs: clubEntries.length,
    clubAttributedEntries: rows.length - independentEntries,
    independentEntries,
    clubEntries,
    finishRate: starters.length ? Math.round(finishers.length / starters.length * 100) : null,
    genderDistribution: distribution(
      rows.map((row) => publishedGenderLabel(row.gender)),
      ["Female", "Male", "Not specified"],
    ),
    categories: categoryStatistics,
    latestPublishedAt: rows.flatMap((row) => row.publishedAt ? [row.publishedAt] : []).sort().at(-1) ?? null,
  };
}
