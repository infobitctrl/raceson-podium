import { expect, it } from "vitest";
import { getFallbackPublicLeagueDetail, getFallbackPublicLeaguesCatalog, getFallbackPublicRankings } from "./league-read-models";

it("does not supply historical runner identities when the sporting service is unavailable", () => {
  const catalogue = getFallbackPublicLeaguesCatalog();
  expect(catalogue.length).toBeGreaterThan(0);
  for (const league of catalogue) {
    expect(league.leader).toBe("—");
    const detail = getFallbackPublicLeagueDetail(league.id);
    expect(detail.individualStandings).toEqual([]);
    expect(detail.clubStandings).toEqual([]);
    expect(detail.entries).toEqual([]);
  }
  expect(getFallbackPublicRankings()).toEqual([]);
});
