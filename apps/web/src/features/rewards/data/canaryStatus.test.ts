import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { getCanaryStatus, getFinalResultsCanaryStatus } from "./canaryStatus";
const mock = vi.hoisted(() => ({ origin: vi.fn(), chainId: 10143, fetch: vi.fn() }));
vi.mock("@/lib/public-env", () => ({ publicEnv: { get rewardDemo() { return { chainId: mock.chainId, apiBaseUrl: "https://isolated.invalid/api" }; } },
  assertPublicEnvironmentOrigin: () => mock.origin() }));
beforeEach(() => { mock.chainId = 10143; mock.origin.mockReset(); mock.fetch.mockReset(); vi.stubGlobal("fetch", mock.fetch); });
afterEach(() => vi.unstubAllGlobals());
it("uses the separate V3 endpoint and refuses a V2 response", async () => {
  mock.fetch.mockResolvedValue(new Response(JSON.stringify({ data: { schema: "raceson-canary-status-v1" } }), { status: 200 }));
  await expect(getFinalResultsCanaryStatus(new AbortController().signal)).rejects.toThrow("invalid_final_results_canary_status");
  expect(mock.fetch.mock.calls[0][0]).toBe("https://isolated.invalid/api/v1/rewards/canary/final-results");
  expect(mock.fetch.mock.calls[0][1]).toMatchObject({ credentials: "omit", cache: "no-store", redirect: "error" });
});
it("uses only the isolated public endpoint with no credentials, redirects or request parameters", async () => {
  mock.fetch.mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
  const signal = new AbortController().signal;
  await expect(getCanaryStatus(signal)).rejects.toThrow("invalid_canary_status");
  expect(mock.origin).toHaveBeenCalledOnce();
  expect(mock.fetch).toHaveBeenCalledWith("https://isolated.invalid/api/v1/rewards/canary", {
    method: "GET", credentials: "omit", cache: "no-store", redirect: "error", signal, headers: { Accept: "application/json" },
  });
});
it("stops before network on foreign origin or local chain, and sanitizes HTTP errors", async () => {
  const signal = new AbortController().signal;
  mock.chainId = 31337; await expect(getCanaryStatus(signal)).rejects.toThrow("canary_testnet_required");
  mock.chainId = 10143; mock.origin.mockImplementationOnce(() => { throw Error("wrong_origin"); });
  await expect(getCanaryStatus(signal)).rejects.toThrow("wrong_origin"); expect(mock.fetch).not.toHaveBeenCalled();
  mock.fetch.mockResolvedValue(new Response("private error", { status: 503 }));
  await expect(getCanaryStatus(signal)).rejects.toThrow("canary_observation_unavailable");
});
