import type { PublicLeagueDetailReadModel } from "@/lib/league-read-models";

export type LeagueRegistrationCourse = {
  id: string;
  label: string;
  order: number;
  registrations: number;
};

export type LeagueRegistrationRound = {
  roundNumber: number;
  label: string;
  registrations: number;
  cumulativeRegistrations: number;
  courses: LeagueRegistrationCourse[];
};

export type LeagueCompetitionParticipation = {
  id: string;
  label: string;
  order: number;
  registrations: number;
  athletes: number;
};

type CourseIdentity = Omit<LeagueRegistrationCourse, "registrations">;

function competitionByCategoryId(league: PublicLeagueDetailReadModel) {
  const courseByCategoryId = new Map<string, CourseIdentity>();
  [...(league.competitions ?? [])]
    .filter((competition) => competition.scoringTarget === "individual")
    .sort((left, right) => left.displayOrder - right.displayOrder || left.name.localeCompare(right.name))
    .forEach((competition) => {
      competition.roundMappings.forEach((mapping) => {
        if (courseByCategoryId.has(mapping.eventCategoryId)) return;
        courseByCategoryId.set(mapping.eventCategoryId, {
          id: competition.id || competition.slug || competition.name,
          label: competition.name,
          order: competition.displayOrder,
        });
      });
    });
  return courseByCategoryId;
}

export function buildLeagueRegistrationRounds(
  league: PublicLeagueDetailReadModel,
): LeagueRegistrationRound[] {
  const courseByCategoryId = competitionByCategoryId(league);

  const roundLabels = new Map<number, string>();
  (league.rounds ?? [])
    .slice()
    .sort((left, right) => left.roundNumber - right.roundNumber)
    .forEach((round) => {
      if (!roundLabels.has(round.roundNumber)) {
        roundLabels.set(round.roundNumber, round.stageLabel || round.name || `Round ${round.roundNumber}`);
      }
    });

  const coursesByRound = new Map<number, Map<string, LeagueRegistrationCourse>>();
  const seenRegistrations = new Set<string>();
  for (const entry of league.entries ?? []) {
    const registrationKey = `${entry.roundNumber}:${entry.registrationId}`;
    if (seenRegistrations.has(registrationKey)) continue;
    seenRegistrations.add(registrationKey);

    if (!roundLabels.has(entry.roundNumber)) {
      roundLabels.set(entry.roundNumber, entry.stageLabel || `Round ${entry.roundNumber}`);
    }
    const configuredCourse = courseByCategoryId.get(entry.eventCategoryId);
    const fallbackLabel = entry.categoryName.trim() || entry.categorySlug.trim() || "Other";
    const course = configuredCourse ?? {
      id: entry.eventCategoryId || entry.categorySlug || fallbackLabel,
      label: fallbackLabel,
      order: Number.MAX_SAFE_INTEGER,
    };
    const roundCourses = coursesByRound.get(entry.roundNumber) ?? new Map<string, LeagueRegistrationCourse>();
    const current = roundCourses.get(course.id) ?? { ...course, registrations: 0 };
    current.registrations += 1;
    roundCourses.set(course.id, current);
    coursesByRound.set(entry.roundNumber, roundCourses);
  }

  let cumulativeRegistrations = 0;
  return Array.from(roundLabels.entries())
    .sort(([left], [right]) => left - right)
    .map(([roundNumber, label]) => {
      const courses = Array.from(coursesByRound.get(roundNumber)?.values() ?? [])
        .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label));
      const registrations = courses.reduce((sum, course) => sum + course.registrations, 0);
      cumulativeRegistrations += registrations;
      return {
        roundNumber,
        label,
        registrations,
        cumulativeRegistrations,
        courses,
      };
    });
}

export function buildLeagueCompetitionParticipation(
  league: PublicLeagueDetailReadModel,
): LeagueCompetitionParticipation[] {
  const courseByCategoryId = competitionByCategoryId(league);
  const groups = new Map<string, {
    id: string;
    label: string;
    order: number;
    registrationIds: Set<string>;
    athleteIds: Set<string>;
  }>();

  for (const entry of league.entries ?? []) {
    const configuredCourse = courseByCategoryId.get(entry.eventCategoryId);
    const fallbackLabel = entry.categoryName.trim() || entry.categorySlug.trim() || "Other";
    const course = configuredCourse ?? {
      id: entry.eventCategoryId || entry.categorySlug || fallbackLabel,
      label: fallbackLabel,
      order: Number.MAX_SAFE_INTEGER,
    };
    const current = groups.get(course.id) ?? {
      ...course,
      registrationIds: new Set<string>(),
      athleteIds: new Set<string>(),
    };
    current.registrationIds.add(`${entry.roundNumber}:${entry.registrationId}`);
    current.athleteIds.add(entry.athleteId || entry.athleteSlug);
    groups.set(course.id, current);
  }

  return Array.from(groups.values())
    .map((group) => ({
      id: group.id,
      label: group.label,
      order: group.order,
      registrations: group.registrationIds.size,
      athletes: group.athleteIds.size,
    }))
    .filter((group) => group.registrations > 0)
    .sort((left, right) => left.order - right.order || right.registrations - left.registrations || left.label.localeCompare(right.label));
}
