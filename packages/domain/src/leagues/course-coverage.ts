/** Every competitive course must have one explicit decision for this round. */
export function getLeagueCourseCoverageIssue(input: {
  competitionIds: string[];
  courseIds: string[];
  mappings: Array<{ competitionId: string; eventCategoryId: string }>;
  excludedCourseIds: string[];
}): string | null {
  const competitions = new Set(input.competitionIds);
  const courses = new Set(input.courseIds);
  const mappedCompetitions = new Set<string>();
  const decidedCourses = new Set<string>();
  if (!input.mappings.length) return "Map at least one race route to a league competition.";
  for (const mapping of input.mappings) {
    if (!competitions.has(mapping.competitionId)) return "Every mapped competition must be active in this league season.";
    if (!courses.has(mapping.eventCategoryId)) return "Every mapped route must be competitive and belong to this race.";
    if (mappedCompetitions.has(mapping.competitionId)) return "Each competition can use only one route per round.";
    if (decidedCourses.has(mapping.eventCategoryId)) return "Each route can count toward only one competition per round.";
    mappedCompetitions.add(mapping.competitionId);
    decidedCourses.add(mapping.eventCategoryId);
  }
  for (const courseId of input.excludedCourseIds) {
    if (!courses.has(courseId)) return "Every excluded route must be competitive and belong to this race.";
    if (decidedCourses.has(courseId)) return "A route cannot be both mapped and excluded, or excluded twice.";
    decidedCourses.add(courseId);
  }
  if (decidedCourses.size !== courses.size) return "Assign every competitive route to a league competition or explicitly exclude it.";
  return null;
}
