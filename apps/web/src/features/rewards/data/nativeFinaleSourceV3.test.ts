import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { requestNativeFinaleSourceV3 } from "./nativeFinaleSourceV3";
import { nativeFinaleFixture } from "./nativeFinaleSourceV3.fixture";
const mocks = vi.hoisted(() => ({ request: vi.fn(), env: { rewardDemo: true, rewardPortalEnabled: true } }));
vi.mock("@/lib/api", () => ({ apiRequest: (...args: unknown[]) => mocks.request(...args) }));
vi.mock("@/lib/public-env", () => ({ publicEnv: mocks.env }));
beforeEach(() => { mocks.request.mockReset(); mocks.env.rewardDemo = true; vi.stubGlobal("crypto", webcrypto); });
afterEach(() => vi.unstubAllGlobals());
it("verifies the source hash and diagnostics against the saved private finale scope", async () => {
  const f = nativeFinaleFixture(); mocks.request.mockResolvedValue(f.data);
  expect(await requestNativeFinaleSourceV3(f.record, f.bindingId)).toEqual(f.data);
  expect(mocks.request).toHaveBeenCalledWith({ path: `/v1/organizer/rewards/drafts/${f.record.draftId}/native-finale`, cache: "no-store" });
});
it("refuses changed hashes, binding, chain, revision, diagnostics and private extra fields", async () => {
  type Data = ReturnType<typeof nativeFinaleFixture>["data"];
  for (const mutate of [(v: Data) => v.sourceHash = "a".repeat(64), (v: Data) => v.document.recordRevision++,
    (v: Data) => v.document.chainId = 10143, (v: Data) => v.inspection.finishedCount++,
    (v: Data) => v.document.races[0].rows[0].finishTimeMs = "1",
    (v: Data) => Object.assign(v, { privateKey: "never" })]) {
    const f = nativeFinaleFixture(); mutate(f.data); mocks.request.mockResolvedValue(f.data);
    await expect(requestNativeFinaleSourceV3(f.record, f.bindingId)).rejects.toThrow();
  }
  const f = nativeFinaleFixture(); mocks.request.mockResolvedValue(f.data);
  await expect(requestNativeFinaleSourceV3(f.record, f.record.draftId)).rejects.toThrow();
  mocks.env.rewardDemo = false; mocks.request.mockClear();
  await expect(requestNativeFinaleSourceV3(f.record, f.bindingId)).rejects.toThrow(); expect(mocks.request).not.toHaveBeenCalled();
});
