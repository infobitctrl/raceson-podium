import { apiRequest } from "@/lib/api";

export type PublicLeagueClubStandingDetails = {
  clubs: Array<{
    clubId: string;
    points: number;
    scoredRounds: number;
    rank: number | null;
    contributions: Array<{
      leagueRoundId: string;
      roundNumber: number;
      points: number;
      members: Array<{
        athleteProfileId: string;
        rank: number;
        points: number;
      }>;
    }>;
  }>;
};

export function getPublicLeagueClubStandingDetails(leagueSeasonId: string) {
  return apiRequest<PublicLeagueClubStandingDetails>({
    path: "/v1/public/leagues/club-standings",
    method: "POST",
    accessToken: null,
    body: { leagueSeasonId },
  });
}
