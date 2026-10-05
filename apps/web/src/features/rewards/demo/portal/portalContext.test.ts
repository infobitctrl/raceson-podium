import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPortalContexts } from "./portalContext";
const f = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn(), mapping: vi.fn(), finale: vi.fn(), event: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiRequest: f.event }));
vi.mock("../../data/planningDrafts", () => ({ listPlanningDrafts: f.list, readPlanningDraft: f.read }));
vi.mock("../../data/sourceMapping", () => ({ readSourceMapping: f.mapping }));
vi.mock("../../data/finaleBindingV3", () => ({ requestFinaleBindingV3: f.finale }));
const scope = { draft: null, event: null, season: null };
beforeEach(() => {
  vi.resetAllMocks();
  f.list.mockResolvedValue([{ draftId: "draft", organizationId: "demo-org", seasonId: "season", revision: 3 },
    { draftId: "foreign", organizationId: "other-org", seasonId: "other", revision: 1 }]);
  f.read.mockImplementation(async r => r);
  f.event.mockImplementation(async ({ path }) => ({ id: decodeURIComponent(path.split('/events/')[1].split('?')[0]), organizationId: "demo-org" }));
  f.mapping.mockResolvedValue({ catalogue: { rounds: [{ editionId: "historical-reference" }] }, revision: 2 });
  f.finale.mockResolvedValue({ binding: { editionId: "practice-event" } });
});
describe("classic demo server-backed source context", () => {
  it("resolves a canonical event slug using the scoped host API", async () => {
    f.event.mockResolvedValue({ id: "practice-event", organizationId: "demo-org" });
    expect(await loadPortalContexts("demo-org", { ...scope, event: "practice-finale-2026" })).toHaveLength(1);
    expect(f.event).toHaveBeenCalledWith({ path: "/v1/organizer/events/practice-finale-2026?organization=demo-org", cache: "no-store" });
  });
  it("matches the actual practice finale binding as well as historical references", async () => {
    for (const event of ["practice-event", "historical-reference"]) {
      expect(await loadPortalContexts("demo-org", { ...scope, event })).toHaveLength(1);
    }
    expect(f.read).not.toHaveBeenCalledWith(expect.objectContaining({ draftId: "foreign" }));
  });
  it("never substitutes another programme for an unmatched event, draft or league", async () => {
    for (const key of ["draft", "event", "season"]) expect(await loadPortalContexts("demo-org", { ...scope, [key]: "unknown" })).toEqual([]);
  });
  it("rejects a changed organization during an asynchronous read", async () => {
    f.read.mockResolvedValue({ organizationId: "other-org", seasonId: "season" });
    await expect(loadPortalContexts("demo-org", scope)).rejects.toThrow("reward_host_scope_changed");
    expect(f.mapping).not.toHaveBeenCalled();
  });
  it("keeps missing/revoked/failed reads unknown rather than claiming no programme or unpaid", async () => {
    for (const status of [401, 403, 503]) {
      f.finale.mockRejectedValue({ status });
      await expect(loadPortalContexts("demo-org", scope)).rejects.toEqual({ status });
    }
  });
});
