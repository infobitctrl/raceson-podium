import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPublicAthleteResultsReadModel } from "@/lib/portal-read-models";

const mocks = vi.hoisted(() => ({
  publicEnv: { rewardDemo: {} as object | null, hostedCopy: true },
  client: { from: vi.fn() },
  getClient: vi.fn(),
  api: vi.fn(),
  media: vi.fn(),
}));
vi.mock("@/lib/public-env", () => ({ publicEnv: mocks.publicEnv }));
vi.mock("@/lib/supabase", () => ({
  getSupabasePublicClient: mocks.getClient,
  getSupabaseBrowserClient: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ apiRequest: mocks.api }));
vi.mock("@/features/events/public/data/publicEventPreviewMedia", () => ({
  loadPublicEventPreviewMedia: vi.fn(),
  loadPublicEventPreviewMediaBySlug: mocks.media,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.publicEnv.rewardDemo = {};
  mocks.publicEnv.hostedCopy = true;
  mocks.getClient.mockReturnValue(mocks.client);
  mocks.api.mockResolvedValue([]);
  mocks.media.mockResolvedValue(new Map());
});

describe("hosted demo athlete history", () => {
  it("preserves the empty model without starting unsupported API or database reads", async () => {
    expect(await getPublicAthleteResultsReadModel("demo-athlete")).toEqual({
      seasonStats: { totalParticipations: 0, totalRaces: 0, totalFinishes: 0, podiums: 0, wins: 0, avgFinish: "TBA" },
      results: [],
    });
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.client.from).not.toHaveBeenCalled();
  });

  it.each(["", "   "])("does not start reads for an empty slug %j", async slug => {
    mocks.publicEnv.hostedCopy = false;
    expect((await getPublicAthleteResultsReadModel(slug)).results).toEqual([]);
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it.each(["local demo", "ordinary platform"])("retains the history API for %s", async mode => {
    if (mode === "local demo") mocks.publicEnv.hostedCopy = false;
    else mocks.publicEnv.rewardDemo = null;
    await getPublicAthleteResultsReadModel("athlete/name");
    expect(mocks.api).toHaveBeenCalledWith({
      path: "/v1/public/athletes/athlete%2Fname/results", accessToken: null,
    });
    expect(mocks.media).toHaveBeenCalledWith(mocks.client, []);
    expect(mocks.client.from).not.toHaveBeenCalled();
  });
});
