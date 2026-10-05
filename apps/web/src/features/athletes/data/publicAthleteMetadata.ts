import { apiRequest } from "@/lib/api";

export type PublicAthleteMetadata = {
  athleteProfileId: string;
  ageCategoryLabel: string | null;
  avatarUrl: string | null;
  coverImageUrl: string | null;
};

export function getPublicAthleteMetadata() {
  return apiRequest<PublicAthleteMetadata[]>({
    path: "/v1/public/athletes/age-categories",
    accessToken: null,
    cache: "no-store",
  });
}
