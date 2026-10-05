import { describe, expect, it, vi } from "vitest";
import { prepareBrowserClaimConsent } from "./browserClaimConsent";
import { decodeAthleteClaimReview } from "../model/athleteClaimConsent";
import { claimFixture, claimSigner } from "../model/claimFixtures.test-helper";
import type { RewardWalletProvider } from "./browserWallet";
vi.mock("@/lib/api", () => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/public-env", () => ({ publicEnv: { rewardPortalEnabled: true, rewardDemo: { mode: "local" } } }));

function harness(chainId: 31337 | 10143 = 31337) {
  const f = claimFixture(chainId), review = decodeAthleteClaimReview(f.raw, f.history);
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> => {
    if (method === "eth_accounts" || method === "eth_requestAccounts") return [claimSigner.address];
    if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
    if (method === "eth_signTypedData_v4") {
      const parsed = JSON.parse(params?.[1] as string);
      expect(parsed.message.amount).toBe(f.history.amountWei); expect(parsed.primaryType).toBe("ReceiveReward");
      return claimSigner.signTypedData({ ...parsed, message: { ...parsed.message, amount: BigInt(parsed.message.amount),
        nonce: BigInt(parsed.message.nonce), issuedAt: BigInt(parsed.message.issuedAt), expiresAt: BigInt(parsed.message.expiresAt) } });
    }
    throw new Error(`Unexpected method ${method}`);
  });
  const provider: RewardWalletProvider = { request, on: (event, listener) => { listeners.set(event, listener); },
    removeListener: (event, listener) => { if (listeners.get(event) === listener) listeners.delete(event); } };
  const read = vi.fn(async () => decodeAthleteClaimReview(f.raw, f.history));
  const submit = vi.fn(async () => f.receipt), changed = vi.fn(), controller = new AbortController();
  return { ...f, review, request, provider, listeners, read, submit, changed, controller };
}
const ready = (h: ReturnType<typeof harness>) => prepareBrowserClaimConsent(h.provider, h.history, h.review, h.controller.signal, () => true, h.changed, h);
describe("browser recipient consent only", () => {
  it("connects without signing, then checks fresh state, signs exact typed data and only stores consent", async () => {
    const h = harness(), flow = await ready(h);
    expect(h.read).not.toHaveBeenCalled(); expect(h.submit).not.toHaveBeenCalled();
    expect(h.request.mock.calls.some(([r]) => r.method === "eth_signTypedData_v4")).toBe(false);
    expect(await flow.confirm()).toEqual({ recipientConsentRecordedAt: h.receipt.recordedAt, operatorApprovalRecordedAt: null });
    expect(h.submit).toHaveBeenCalledWith(expect.objectContaining({ intentId: h.history.intentId }), expect.stringMatching(/^0x[0-9a-f]{130}$/), expect.any(String));
    expect(new Set(h.request.mock.calls.map(([r]) => r.method))).toEqual(new Set(["eth_requestAccounts", "eth_accounts", "eth_chainId", "eth_signTypedData_v4"]));
    flow.dispose(); expect(h.listeners.size).toBe(0);
  });
  it("retains one exact signature and retry key after a lost response; recorded reload never signs", async () => {
    const h = harness(), flow = await ready(h); h.submit.mockRejectedValueOnce(new Error("lost response"));
    await expect(flow.confirm()).rejects.toThrow("lost response"); await flow.confirm();
    expect(h.submit.mock.calls[0]).toEqual(h.submit.mock.calls[1]);
    expect(h.request.mock.calls.filter(([r]) => r.method === "eth_signTypedData_v4")).toHaveLength(1);
    h.read.mockResolvedValue(decodeAthleteClaimReview(h.recorded, h.history));
    await flow.confirm(); expect(h.submit).toHaveBeenCalledTimes(2); flow.dispose();
  });
  it("rejects foreign accounts and chains before any signing, with no automatic network changes", async () => {
    for (const method of ["eth_requestAccounts", "eth_chainId"]) {
      const h = harness(), original = h.request.getMockImplementation()!;
      h.request.mockImplementation(args => args.method === method ? Promise.resolve(method === "eth_chainId" ? "0x1" : [`0x${"11".repeat(20)}`]) : original(args));
      await expect(ready(h)).rejects.toMatchObject({ code: method === "eth_chainId" ? "wrong_local_network" : "claim_wrong_wallet" });
      expect(h.submit).not.toHaveBeenCalled(); expect(h.listeners.size).toBe(0);
    }
  });
  it("refuses a changed contract payload or server hold before the wallet prompt", async () => {
    for (const hold of [true, false]) {
      const h = harness(), flow = await ready(h);
      if (hold) h.read.mockRejectedValue({ status: 409, code: "reward_claim_readiness_required" });
      else { h.raw.signing.message.nonce = "3"; h.read.mockResolvedValue(decodeAthleteClaimReview(h.raw, h.history)); }
      await expect(flow.confirm()).rejects.toBeDefined();
      expect(h.request.mock.calls.some(([r]) => r.method === "eth_signTypedData_v4")).toBe(false); flow.dispose();
    }
  });
  it("stops late signatures after account/network/disconnect or unmount, even if the provider switches back", async () => {
    for (const event of ["accountsChanged", "chainChanged", "disconnect", "unmount"]) {
      const h = harness(), original = h.request.getMockImplementation()!, flow = await ready(h);
      let finish!: (value: unknown) => void;
      h.request.mockImplementation(args => args.method === "eth_signTypedData_v4" ? new Promise(resolve => { finish = resolve; }) : original(args));
      const pending = flow.confirm(); await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
      if (event === "unmount") h.controller.abort(); else { h.listeners.get(event)?.([]); h.listeners.get("accountsChanged")?.([claimSigner.address]); }
      finish(await claimSigner.signTypedData(h.signing));
      await expect(pending).rejects.toMatchObject({ code: "wallet_changed" }); expect(h.submit).not.toHaveBeenCalled(); flow.dispose();
      expect(h.listeners.size).toBe(0);
    }
  });
  it("checks testnet expiry after a long prompt and does not submit stale signatures", async () => {
    const h = harness(10143), original = h.request.getMockImplementation()!, flow = await ready(h);
    h.request.mockImplementation(async args => {
      const result = await original(args);
      if (args.method === "eth_signTypedData_v4") vi.spyOn(Date, "now").mockReturnValue(Number(h.history.expiresAt) * 1000);
      return result;
    });
    try { await expect(flow.confirm()).rejects.toMatchObject({ code: "claim_expired" }); expect(h.submit).not.toHaveBeenCalled(); }
    finally { vi.restoreAllMocks(); flow.dispose(); }
  });
  it("does not send rejected, malformed or wrong-signer signatures to the API", async () => {
    for (const rejected of [true, false]) {
      const h = harness(), original = h.request.getMockImplementation()!, flow = await ready(h);
      h.request.mockImplementation(args => args.method === "eth_signTypedData_v4"
        ? rejected ? Promise.reject({ code: 4001 }) : Promise.resolve(`0x${"00".repeat(65)}`) : original(args));
      await expect(flow.confirm()).rejects.toBeDefined(); expect(h.submit).not.toHaveBeenCalled(); flow.dispose();
    }
  });
});
