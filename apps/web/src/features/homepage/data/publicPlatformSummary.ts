import { apiRequest } from "@/lib/api";

export type PublicPlatformStats = {
  events: number;
  tracks: number;
  leagues: number;
  athletes: number;
  registrations: number;
  clubs: number;
  completedDistanceKm: number;
  finishes: number;
  countries: number;
  countryCodes: string[];
};

export type PublicPlatformSummary = {
  version: 2;
  generatedAt: string;
  scope: "platform";
  stats: PublicPlatformStats;
};

export function getPublicPlatformSummary() {
  return apiRequest<PublicPlatformSummary>({
    path: "/v1/public/platform-summary",
    accessToken: null,
  });
}
