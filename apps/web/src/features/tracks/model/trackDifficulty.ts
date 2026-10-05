export type TrackDifficultyLevel = 1 | 2 | 3 | 4 | 5;

export type TrackDifficultyOption = {
  level: TrackDifficultyLevel;
  label: "Beginner" | "Intermediate" | "Advanced" | "Expert" | "Ultra";
  toneClassName: string;
};

export const TRACK_DIFFICULTY_OPTIONS: readonly TrackDifficultyOption[] = [
  { level: 1, label: "Beginner", toneClassName: "timing-lime-pill" },
  { level: 2, label: "Intermediate", toneClassName: "border-trail-blue/20 bg-trail-blue/10 text-trail-blue" },
  { level: 3, label: "Advanced", toneClassName: "border-warning/20 bg-warning/10 text-warning" },
  { level: 4, label: "Expert", toneClassName: "border-primary/20 bg-primary/10 text-primary" },
  { level: 5, label: "Ultra", toneClassName: "border-destructive/20 bg-destructive/10 text-destructive" },
];

export function normalizeTrackDifficultyLevel(value: unknown): TrackDifficultyLevel | null {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 5
    ? numeric as TrackDifficultyLevel
    : null;
}

export function inferTrackDifficultyLevel(
  distanceKm: number | null | undefined,
  elevationGainM: number | null | undefined,
): TrackDifficultyLevel {
  const distance = Number(distanceKm ?? 0);
  const elevation = Number(elevationGainM ?? 0);
  if (distance >= 50 || elevation >= 3200) return 5;
  if (distance >= 35 || elevation >= 2200) return 4;
  if (distance >= 25 || elevation >= 1400) return 3;
  if (distance >= 15 || elevation >= 800) return 2;
  return 1;
}

export function resolveTrackDifficultyLevel(
  value: unknown,
  distanceKm?: number | null,
  elevationGainM?: number | null,
) {
  return normalizeTrackDifficultyLevel(value) ?? inferTrackDifficultyLevel(distanceKm, elevationGainM);
}

export function getTrackDifficultyOption(level: TrackDifficultyLevel) {
  return TRACK_DIFFICULTY_OPTIONS[level - 1];
}

export function getTrackDifficultyLabel(level: TrackDifficultyLevel) {
  return getTrackDifficultyOption(level).label;
}
