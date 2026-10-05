export const DEFAULT_LEAGUE_IMAGE_URL = "/league-media/sibenska-trail-liga/window-valley.jpeg";

const leagueImageLinePattern = /^League Image:\s*(.+)$/im;

export function getLeagueImageUrlFromDescription(description: string | null | undefined) {
  const match = description?.match(leagueImageLinePattern)?.[1]?.trim();
  return match || null;
}

export function resolveLeagueImageUrl(description: string | null | undefined, explicitImageUrl?: string | null) {
  return explicitImageUrl?.trim() || getLeagueImageUrlFromDescription(description) || DEFAULT_LEAGUE_IMAGE_URL;
}
