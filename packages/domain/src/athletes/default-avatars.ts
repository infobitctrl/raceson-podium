import type { AthleteGender } from "../auth/types.js";

export type DefaultAthleteAvatar = {
  id: string;
  gender: Extract<AthleteGender, "F" | "M">;
  label: string;
  path: string;
};

function buildAvatarSet(
  gender: DefaultAthleteAvatar["gender"],
  folder: "female" | "male",
  label: "Female" | "Male",
): DefaultAthleteAvatar[] {
  return Array.from({ length: 10 }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return {
      id: `${folder}-${number}`,
      gender,
      label: `${label} trail avatar ${index + 1}`,
      path: `/athlete-avatars/${folder}/${folder}-avatar-${number}.webp`,
    };
  });
}

export const DEFAULT_ATHLETE_AVATARS = Object.freeze([
  ...buildAvatarSet("F", "female", "Female"),
  ...buildAvatarSet("M", "male", "Male"),
]);

const DEFAULT_ATHLETE_AVATAR_PATHS = new Set(
  DEFAULT_ATHLETE_AVATARS.map((avatar) => avatar.path),
);

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function defaultAthleteAvatarFor(
  athleteKey: string,
  gender: AthleteGender | string | null | undefined,
) {
  const matchingAvatars = gender === "F" || gender === "M"
    ? DEFAULT_ATHLETE_AVATARS.filter((avatar) => avatar.gender === gender)
    : DEFAULT_ATHLETE_AVATARS;
  return matchingAvatars[stableHash(athleteKey) % matchingAvatars.length];
}

export function isDefaultAthleteAvatarPath(value: unknown): value is string {
  return typeof value === "string" && DEFAULT_ATHLETE_AVATAR_PATHS.has(value);
}

export function isAllowedProfileAvatarUrl(value: string) {
  if (isDefaultAthleteAvatarPath(value)) return true;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
