import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { safeRewardConsentMessageV3 } from "@raceson/rewards-chain/campaign-v3";
import { combineClubOwnerSignaturesV3, type ClubConsentSelectionV3 } from "@raceson/rewards-chain/club-consent-v3";
import { createBrowserClubConsentV3 } from "./browserClubConsentV3";
import { getClubConsentReviewV3, submitClubConsentV3 } from "./clubConsentV3";
import type { RewardWalletProvider } from "./browserWallet";

const mock = vi.hoisted(() => ({ api: vi.fn(), env: { rewardPortalEnabled: true, rewardDemo: { mode: "local" } as { mode: string } | null } }));
vi.mock("@/lib/api", () => ({ apiRequest: mock.api }));
vi.mock("@/lib/public-env", () => ({ publicEnv: mock.env }));
const hex = (n: number) => toHex(BigInt(n), { size: 32 }), address = (n: number) => toHex(BigInt(n), { size: 20 });
const id = (n: number) => `8fd00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// Explicit synthetic test signers only; never portal-created athlete wallets.
const owners = [1, 2, 3].map(n => privateKeyToAccount(hex(0xFD000 + n)));
function harness(chainId: 31337 | 10143 = 31337) {
  mock.env.rewardDemo = { mode: chainId === 31337 ? "local" : "local-testnet" };
  const selection: ClubConsentSelectionV3 = { chainId, uploadId: id(1), requestId: id(2), claimId: id(3), entitlementId: hex(1),
    campaignAddress: address(2), recipientAddress: address(3), amountWei: "1000000000000000001", pot: "league" };
  const now = Math.floor(Date.now() / 1000);
  const record = { schema: "raceson-club-claim-record-v3", chainId, uploadId: id(1), requestId: id(2), claimId: id(3), entitlementId: hex(1),
    recipientAddress: address(3), amountWei: selection.amountWei, issuedAt: String(now - 1), expiresAt: String(now + 1000), recipientConsented: false, operatorApproved: false };
  const typedData = safeRewardConsentMessageV3({ chainId, environment: chainId === 31337 ? "local-simulation" : "monad-testnet", verifyingContract: selection.campaignAddress },
    { entitlementId: selection.entitlementId, recipient: selection.recipientAddress, amount: BigInt(selection.amountWei), pot: "league", nonce: 0n,
      issuedAt: BigInt(record.issuedAt), expiresAt: BigInt(record.expiresAt), allocationDigest: hex(4) });
  const raw = { ...record, status: "signature_required", role: "recipient", typedData, binding: { schema: "raceson-club-consent-binding-v3",
    campaignAddress: selection.campaignAddress, pot: "league", nonce: "0", allocationDigest: hex(4) }, observation: { blockNumber: "200", blockHash: hex(5), timestamp: String(now) } };
  const read = vi.fn(async (): Promise<unknown> => structuredClone(raw)), receipt = { ...record, recipientConsented: true };
  const submit = vi.fn(async (_s: ClubConsentSelectionV3, _signature: string): Promise<unknown> => ({ ...receipt }));
  const controller = new AbortController(), changed = vi.fn(), context = { current: true };
  const create = (initial: unknown = raw) => createBrowserClubConsentV3(selection, initial, controller.signal, () => context.current, changed, { read, submit });
  function wallet(n: number) {
    const signer = owners[n], listeners = new Map<string, (...args: unknown[]) => void>();
    const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> => {
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [signer.address];
      if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
      if (method === "eth_signTypedData_v4") {
        expect(params?.[0]).toBe(signer.address.toLowerCase());
        const parsed = JSON.parse(params?.[1] as string); expect(parsed.primaryType).toBe("SafeMessage");
        expect(parsed.message.message).toBe(typedData.message.message);
        return signer.signTypedData(parsed);
      }
      throw new Error(`Unexpected wallet method ${method}`);
    });
    const provider: RewardWalletProvider = { request, on: (e, cb) => { listeners.set(e, cb); }, removeListener: (e, cb) => { if (listeners.get(e) === cb) listeners.delete(e); } };
    return { signer, request, provider, listeners };
  }
  return { selection, record, raw, typedData, read, submit, receipt, controller, changed, context, create, wallet };
}
beforeEach(() => { mock.api.mockReset(); mock.env.rewardPortalEnabled = true; mock.env.rewardDemo = { mode: "local" }; });
afterEach(() => vi.restoreAllMocks());

describe("V3 club consent adapter, no rendered UI or payment execution", () => {
  it("starts without IO, collects two acknowledged wallets and submits only an exact sorted proof", async () => {
    const h = harness(), flow = h.create(), first = h.wallet(1), second = h.wallet(0);
    expect(h.read).not.toHaveBeenCalled(); expect(h.submit).not.toHaveBeenCalled();
    expect((await flow.collect(first.provider, first.signer.address)).signaturesCollected).toBe(1);
    expect(first.listeners.size).toBe(0); expect(h.submit).not.toHaveBeenCalled();
    await expect(flow.submit()).rejects.toMatchObject({ code: "club_quorum_required" });
    await expect(flow.collect(first.provider, first.signer.address)).rejects.toMatchObject({ code: "club_duplicate_signer" });
    expect((await flow.collect(second.provider, second.signer.address)).signaturesCollected).toBe(2);
    const result = await flow.submit(); expect(result.recipientConsented).toBe(true); expect(result.operatorApproved).toBe(false);
    const expected = await combineClubOwnerSignaturesV3(h.typedData, await Promise.all([first, second].map(async w => ({ signer: w.signer.address, signature: await w.signer.signTypedData(h.typedData) }))));
    expect(h.submit).toHaveBeenCalledWith(h.selection, expected);
    expect(new Set(first.request.mock.calls.map(([r]) => r.method))).toEqual(new Set(["eth_requestAccounts", "eth_accounts", "eth_chainId", "eth_signTypedData_v4"]));
    expect(result).not.toHaveProperty("paid"); expect(JSON.stringify(result)).not.toContain(expected); flow.dispose();
  });
  it("preserves exact in-memory proof bytes for explicit retry after a lost response", async () => {
    const h = harness(), flow = h.create();
    for (const n of [0, 1]) { const w = h.wallet(n); await flow.collect(w.provider, w.signer.address); }
    h.submit.mockRejectedValueOnce(new Error("lost response")); await expect(flow.submit()).rejects.toThrow("lost response");
    expect(flow.progress().signaturesCollected).toBe(2); await flow.submit();
    expect(h.submit.mock.calls[0]).toEqual(h.submit.mock.calls[1]); flow.dispose();
  });
  it("recovers already-recorded consent after uncertain storage without another wallet prompt or POST", async () => {
    const h = harness(), flow = h.create();
    for (const n of [0, 1]) { const w = h.wallet(n); await flow.collect(w.provider, w.signer.address); }
    h.submit.mockImplementationOnce(async () => { h.read.mockResolvedValue({ ...h.receipt, status: "already_recorded" }); throw Error("lost response"); });
    await expect(flow.submit()).rejects.toThrow(); expect((await flow.submit()).recipientConsented).toBe(true); expect(h.submit).toHaveBeenCalledTimes(1);
    const recorded = h.create({ ...h.receipt, status: "already_recorded" }), w = h.wallet(0);
    expect((await recorded.collect(w.provider, w.signer.address)).recipientConsented).toBe(true); expect(w.request).not.toHaveBeenCalled();
    flow.dispose(); recorded.dispose();
  });
  it("does not sign with a wrong wallet/network, rejected prompt, bad signature or other signer", async () => {
    for (const kind of ["account", "chain", "reject", "malformed", "foreign"]) {
      const h = harness(), flow = h.create(), w = h.wallet(0), original = w.request.getMockImplementation()!;
      w.request.mockImplementation(async r => {
        if (kind === "account" && r.method === "eth_requestAccounts") return [owners[2].address];
        if (kind === "chain" && r.method === "eth_chainId") return "0x1";
        if (r.method === "eth_signTypedData_v4") {
          if (kind === "reject") throw { code: 4001 };
          if (kind === "malformed") return "0x";
          if (kind === "foreign") return owners[2].signTypedData(h.typedData);
        }
        return original(r);
      });
      await expect(flow.collect(w.provider, w.signer.address)).rejects.toBeDefined(); expect(h.submit).not.toHaveBeenCalled();
      expect(flow.progress().signaturesCollected).toBe(0); expect(w.listeners.size).toBe(0); flow.dispose();
    }
  });
  it("drops late responses and all partial signatures after wallet events, abort or account context change", async () => {
    for (const event of ["accountsChanged", "chainChanged", "disconnect", "abort", "context"]) {
      const h = harness(), flow = h.create(), first = h.wallet(0), second = h.wallet(1);
      await flow.collect(first.provider, first.signer.address);
      const original = second.request.getMockImplementation()!; let finish!: (value: unknown) => void;
      second.request.mockImplementation(r => r.method === "eth_signTypedData_v4" ? new Promise(resolve => { finish = resolve; }) : original(r));
      const pending = flow.collect(second.provider, second.signer.address); await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
      if (event === "abort") h.controller.abort(); else if (event === "context") h.context.current = false;
      else { second.listeners.get(event)?.([]); second.listeners.get("accountsChanged")?.([second.signer.address]); }
      finish(await second.signer.signTypedData(h.typedData)); await expect(pending).rejects.toMatchObject({ code: "wallet_changed" });
      expect(h.submit).not.toHaveBeenCalled(); expect(second.listeners.size).toBe(0); expect(() => flow.progress()).toThrow(); flow.dispose();
    }
  });
  it("refuses concurrent prompts and cleans a provider that throws while registering its listeners", async () => {
    const h = harness(), flow = h.create(), w = h.wallet(0), other = h.wallet(1), original = w.request.getMockImplementation()!;
    let finish!: (value: unknown) => void;
    w.request.mockImplementation(r => r.method === "eth_signTypedData_v4" ? new Promise(resolve => { finish = resolve; }) : original(r));
    const pending = flow.collect(w.provider, w.signer.address); await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await expect(flow.collect(other.provider, other.signer.address)).rejects.toMatchObject({ code: "request_pending" });
    finish(await w.signer.signTypedData(h.typedData)); await pending;
    other.provider.on = (e, cb) => { other.listeners.set(e, cb); throw Error("provider setup"); };
    await expect(flow.collect(other.provider, other.signer.address)).rejects.toThrow("provider setup"); expect(other.listeners.size).toBe(0); flow.dispose();
  });
  it("rejects source holds and changed exact messages before prompting, and detects post-prompt expiry", async () => {
    for (const kind of ["hold", "changed", "stale"]) {
      const h = harness(10143), flow = h.create(), w = h.wallet(0);
      if (kind === "hold") h.read.mockRejectedValue({ status: 409 });
      else if (kind === "changed") { const changed = structuredClone(h.raw); changed.binding.nonce = "1"; h.read.mockResolvedValue(changed); }
      else { const old = structuredClone(h.raw); old.observation.timestamp = String(Number(old.issuedAt) - 1); h.read.mockResolvedValue(old); }
      await expect(flow.collect(w.provider, w.signer.address)).rejects.toBeDefined(); expect(w.request).not.toHaveBeenCalled(); flow.dispose();
    }
    const h = harness(10143), flow = h.create(), w = h.wallet(0), original = w.request.getMockImplementation()!;
    w.request.mockImplementation(async r => { const result = await original(r); if (r.method === "eth_signTypedData_v4") vi.spyOn(Date, "now").mockReturnValue(Number(h.record.expiresAt) * 1000); return result; });
    await expect(flow.collect(w.provider, w.signer.address)).rejects.toMatchObject({ code: "claim_expired" }); expect(h.submit).not.toHaveBeenCalled(); flow.dispose();
  });
  it("captures immutable selection/message and refuses regressed observations before submission", async () => {
    const h = harness(), flow = h.create(), w = h.wallet(0), saved = structuredClone(h.raw);
    const original = w.request.getMockImplementation()!;
    w.request.mockImplementation(r => {
      if (r.method !== "eth_signTypedData_v4") return original(r);
      const typed = JSON.parse(r.params?.[1] as string); expect(typed.message.message).toBe(saved.typedData.message.message);
      return w.signer.signTypedData(typed);
    });
    h.raw.typedData.message.message = hex(9); h.selection.amountWei = "1"; h.read.mockResolvedValue(saved);
    expect((await flow.collect(w.provider, w.signer.address)).signaturesCollected).toBe(1);
    const regressed = structuredClone(saved); regressed.observation.blockNumber = "199"; h.read.mockResolvedValue(regressed);
    const second = h.wallet(1); await expect(flow.collect(second.provider, second.signer.address)).rejects.toMatchObject({ code: "claim_refresh_required" });
    expect(second.request).not.toHaveBeenCalled(); expect(h.submit).not.toHaveBeenCalled();
    flow.dispose();
  });
  it("uses only private demo GET/proof endpoints with exact scope and checks mode again after IO", async () => {
    const h = harness(); mock.api.mockResolvedValueOnce(h.raw).mockResolvedValueOnce(h.receipt);
    await getClubConsentReviewV3(h.selection); await submitClubConsentV3(h.selection, `0x${"ab".repeat(130)}`);
    expect(mock.api.mock.calls[0][0]).toEqual({ path: `/v1/club/rewards/uploads/${id(1)}/club-treasuries/${id(2)}/awards/${hex(1)}/claims/${id(3)}/signing`, cache: "no-store" });
    expect(mock.api.mock.calls[1][0]).toMatchObject({ method: "POST", cache: "no-store", body: { signature: `0x${"ab".repeat(130)}` } });
    mock.api.mockImplementationOnce(async () => { mock.env.rewardDemo = { mode: "testnet" }; return h.raw; });
    await expect(getClubConsentReviewV3(h.selection)).rejects.toThrow(); mock.env.rewardDemo = null;
    await expect(getClubConsentReviewV3(h.selection)).rejects.toThrow();
    expect(mock.api).toHaveBeenCalledTimes(3);
  });
  it("clears an expired account's partial consent and discards a late proof response after context loss", async () => {
    for (const phase of ["read", "submit"]) {
      const h = harness(), flow = h.create();
      for (const n of [0, 1]) { const w = h.wallet(n); await flow.collect(w.provider, w.signer.address); }
      if (phase === "read") h.read.mockRejectedValue({ status: 401 });
      else h.submit.mockImplementation(async () => { h.context.current = false; return h.receipt; });
      await expect(flow.submit()).rejects.toBeDefined(); expect(() => flow.progress()).toThrow();
      expect(h.submit).toHaveBeenCalledTimes(phase === "read" ? 0 : 1); flow.dispose();
    }
  });
  it("rejects a third signer and malformed confirmation without exposing any signing material", async () => {
    const h = harness(), flow = h.create();
    for (const n of [0, 1]) { const w = h.wallet(n); await flow.collect(w.provider, w.signer.address); }
    const third = h.wallet(2); await expect(flow.collect(third.provider, third.signer.address)).rejects.toMatchObject({ code: "club_quorum_collected" });
    expect(third.request).not.toHaveBeenCalled();
    h.submit.mockResolvedValue({ ...h.receipt, paid: true }); await expect(flow.submit()).rejects.toBeDefined();
    expect(() => flow.progress()).toThrow(); flow.dispose();
  });
});
