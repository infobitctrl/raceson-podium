export type RaceCourse = {
  categoryId: string;
  format: "standard" | "laps" | null;
  lapCount: number | null;
  distanceKm: number | null;
};

export function mapRaceCourse(row: {
  id: string;
  course_format?: unknown;
  lap_count?: unknown;
  distance_km?: unknown;
}): RaceCourse {
  const format = row.course_format === "standard" || row.course_format === "laps" ? row.course_format : null;
  const count = typeof row.lap_count === "number" ? row.lap_count : NaN;
  const distance = typeof row.distance_km === "number" || typeof row.distance_km === "string"
    ? Number(row.distance_km) : NaN;
  return {
    categoryId: row.id,
    format,
    lapCount: format === "standard" ? 1 : format === "laps" && Number.isInteger(count) && count >= 2 && count <= 100 ? count : null,
    distanceKm: Number.isFinite(distance) && distance > 0 ? distance : null,
  };
}

export function raceCourseLaps(course: RaceCourse) {
  if (course.format !== "laps" || course.lapCount == null) return [];
  const lapDistanceKm = course.distanceKm == null ? null : course.distanceKm / course.lapCount;
  return Array.from({ length: course.lapCount }, (_, index) => ({
    number: index + 1,
    distanceKm: lapDistanceKm,
    cumulativeDistanceKm: lapDistanceKm == null ? null : lapDistanceKm * (index + 1),
    isFinish: index + 1 === course.lapCount,
  }));
}
