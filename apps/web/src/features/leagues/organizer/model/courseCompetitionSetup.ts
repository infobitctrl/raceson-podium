import type { LeagueCompetitionDraft, LeagueRaceMappingOption } from "./leagueCompetitionPlanning";

export function courseCompetitionName(course: LeagueRaceMappingOption) {
  if (!course.distanceKm || course.distanceKm <= 0) return course.name;
  return course.distanceKm < 2
    ? `${Math.round(course.distanceKm * 1000)} m`
    : `${Number(course.distanceKm.toFixed(3))} km`;
}

export function copyCompetitionRules(source: LeagueCompetitionDraft, target: LeagueCompetitionDraft): LeagueCompetitionDraft {
  return {
    ...source,
    key: target.key,
    slug: target.slug,
    name: target.name,
    isDefault: target.isDefault,
    classifications: source.classifications.map((group, index) => ({
      ...group,
      key: `${target.key}-group-${index}`,
    })),
  };
}

export function createCourseCompetitions(
  courses: LeagueRaceMappingOption[],
  existing: LeagueCompetitionDraft[],
  template: LeagueCompetitionDraft,
  replaceUnused: boolean,
) {
  const drafts = replaceUnused ? [] : [...existing];
  const names = courses.map(courseCompetitionName);
  const generatedNames = new Set<string>();
  for (const [index, course] of courses.entries()) {
    const baseName = (names.filter((name) => name === names[index]).length > 1
      ? `${course.name} · ${names[index]}`
      : names[index]).slice(0, 110);
    let name = baseName;
    let suffix = 2;
    while (generatedNames.has(name.toLowerCase())) name = `${baseName} (${suffix++})`;
    generatedNames.add(name.toLowerCase());
    if (drafts.some((draft) => draft.slug === `course-${course.id}` || draft.name.toLowerCase() === name.toLowerCase())) continue;
    const preserved = replaceUnused ? existing[index] : undefined;
    const identity = {
      ...template,
      key: preserved?.key ?? `course-${course.id}`,
      slug: preserved?.slug ?? `course-${course.id}`,
      name,
      isDefault: drafts.length === 0,
    };
    drafts.push(copyCompetitionRules(template, identity));
  }
  return drafts;
}
