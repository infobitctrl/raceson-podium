import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { rewardClaimMessagesV3 } from "@raceson/rewards-chain/campaign-v3";
import type { AthleteConsentSelectionV3 } from "@raceson/rewards-chain/athlete-consent-v3";
import { createBrowserAthleteConsentV3 } from "./browserAthleteConsentV3";
import { getAthleteConsentReviewV3, submitAthleteConsentV3, getOwnAthleteClaimsV3, getOwnAthleteAllocationsV3 } from "./athleteConsentV3";
import type { RewardWalletProvider } from "./browserWallet";

const mock = vi.hoisted(() => ({ api: vi.fn(), env: { rewardPortalEnabled: true, rewardDemo: { mode: "local" } as { mode: string } | null } }));
vi.mock("@/lib/api", () => ({ apiRequest: mock.api }));
vi.mock("@/lib/public-env", () => ({ publicEnv: mock.env }));
const hex = (n: number) => toHex(BigInt(n), { size: 32 }), address = (n: number) => toHex(BigInt(n), { size: 20 });
const id = (n: number) => `8fe00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// Explicit synthetic test signers only; never portal-created athlete wallets.
const signer = privateKeyToAccount(hex(0xFE001)), other = privateKeyToAccount(hex(0xFE002));
function harness(chainId: 31337 | 10143 = 31337) {
  mock.env.rewardDemo = { mode: chainId === 31337 ? "local" : "local-testnet" };
  const selection: AthleteConsentSelectionV3 = { chainId, uploadId: id(1), destinationId: id(2), claimId: id(3), entitlementId: hex(1),
    campaignAddress: address(2), recipientAddress: signer.address.toLowerCase() as `0x${string}`, amountWei: "1000000000000000001", pot: "league" };
  const now = Math.floor(Date.now() / 1000);
  const record = { schema: "raceson-athlete-claim-record-v3", chainId, uploadId: id(1), destinationId: id(2), claimId: id(3), entitlementId: hex(1),
    recipientAddress: selection.recipientAddress, amountWei: selection.amountWei, issuedAt: String(now - 1), expiresAt: String(now + 1000), recipientConsented: false, operatorApproved: false };
  const typedData = rewardClaimMessagesV3({ chainId, environment: chainId === 31337 ? "local-simulation" : "monad-testnet", verifyingContract: selection.campaignAddress },
    { entitlementId: selection.entitlementId, recipient: selection.recipientAddress, amount: BigInt(selection.amountWei), pot: "league", nonce: 0n,
      issuedAt: BigInt(record.issuedAt), expiresAt: BigInt(record.expiresAt), allocationDigest: hex(4) }).consent;
  const raw = { ...record, status: "signature_required", role: "recipient", typedData, observation: { blockNumber: "200", blockHash: hex(5), timestamp: String(now) } };
  const read = vi.fn(async (): Promise<unknown> => structuredClone(raw)), receipt = { ...record, recipientConsented: true };
  const submit = vi.fn(async (_s: AthleteConsentSelectionV3, _signature: string): Promise<unknown> => ({ ...receipt }));
  const controller = new AbortController(), changed = vi.fn(), context = { current: true };
  const create = (initial: unknown = raw) => createBrowserAthleteConsentV3(selection, initial, controller.signal, () => context.current, changed, { read, submit });
  function wallet() {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> => {
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [signer.address];
      if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
      if (method === "eth_signTypedData_v4") {
        expect(params?.[0]).toBe(signer.address.toLowerCase());
        const parsed = JSON.parse(params?.[1] as string); expect(parsed.primaryType).toBe("ReceiveReward");
        expect(parsed.domain.version).toBe("4"); expect(parsed.message.amount).toBe("1000000000000000001");
        return signer.signTypedData(parsed);
      }
      throw new Error(`Unexpected wallet method ${method}`);
    });
    const provider: RewardWalletProvider = { request, on: (e, cb) => { listeners.set(e, cb); }, removeListener: (e, cb) => { if (listeners.get(e) === cb) listeners.delete(e); } };
    return { request, provider, listeners };
  }
  return { selection, record, raw, typedData, read, submit, receipt, controller, changed, context, create, wallet };
}
beforeEach(() => { mock.api.mockReset(); mock.env.rewardPortalEnabled = true; mock.env.rewardDemo = { mode: "local" }; });
afterEach(() => vi.restoreAllMocks());

describe("V3 athlete browser consent, separate from legacy and payout", () => {
  it("starts without IO, signs only exact recipient consent and requires separate submission", async () => {
    const h = harness(), flow = h.create(), w = h.wallet();
    expect(h.read).not.toHaveBeenCalled(); expect(h.submit).not.toHaveBeenCalled();
    await expect(flow.submit()).rejects.toMatchObject({ code: "claim_recipient_consent_required" });
    expect((await flow.collect(w.provider)).signatureCollected).toBe(true); expect(w.listeners.size).toBe(0);
    expect(h.submit).not.toHaveBeenCalled(); await flow.collect(w.provider);
    expect(w.request.mock.calls.filter(([r]) => r.method === "eth_signTypedData_v4")).toHaveLength(1);
    const result = await flow.submit();
    expect(result).toEqual({ recipientConsented: true, operatorApproved: false, signatureCollected: false });
    const signature = await signer.signTypedData(h.typedData); expect(h.submit).toHaveBeenCalledWith(h.selection, signature);
    expect(new Set(w.request.mock.calls.map(([r]) => r.method))).toEqual(new Set(["eth_requestAccounts", "eth_accounts", "eth_chainId", "eth_signTypedData_v4"]));
    expect(result).not.toHaveProperty("paid"); expect(JSON.stringify(result)).not.toContain(signature); flow.dispose();
  });
  it("retains only exact in-memory proof bytes for explicit retry after a lost response", async () => {
    const h = harness(), flow = h.create(), w = h.wallet(); await flow.collect(w.provider);
    h.submit.mockRejectedValueOnce(new Error("lost response")); await expect(flow.submit()).rejects.toThrow("lost response");
    expect(flow.progress().signatureCollected).toBe(true); await flow.submit();
    expect(h.submit.mock.calls[0]).toEqual(h.submit.mock.calls[1]); flow.dispose();
  });
  it("recovers recorded consent without another wallet prompt or POST", async () => {
    const h = harness(), flow = h.create(), w = h.wallet(); await flow.collect(w.provider);
    h.submit.mockImplementationOnce(async () => { h.read.mockResolvedValue({ ...h.receipt, status: "already_recorded" }); throw Error("lost response"); });
    await expect(flow.submit()).rejects.toThrow(); expect((await flow.submit()).recipientConsented).toBe(true); expect(h.submit).toHaveBeenCalledTimes(1);
    const recorded = h.create({ ...h.receipt, status: "already_recorded" }), second = h.wallet();
    expect((await recorded.collect(second.provider)).recipientConsented).toBe(true); expect(second.request).not.toHaveBeenCalled();
    flow.dispose(); recorded.dispose();
  });
  it("refuses wrong accounts/networks, rejected prompts and malformed/foreign signatures", async () => {
    for (const kind of ["account", "chain", "reject", "malformed", "foreign"]) {
      const h = harness(), flow = h.create(), w = h.wallet(), original = w.request.getMockImplementation()!;
      w.request.mockImplementation(async r => {
        if (kind === "account" && r.method === "eth_requestAccounts") return [other.address];
        if (kind === "chain" && r.method === "eth_chainId") return "0x1";
        if (r.method === "eth_signTypedData_v4") {
          if (kind === "reject") throw { code: 4001 };
          if (kind === "malformed") return "0x";
          if (kind === "foreign") return other.signTypedData(h.typedData);
        }
        return original(r);
      });
      await expect(flow.collect(w.provider)).rejects.toBeDefined(); expect(h.submit).not.toHaveBeenCalled();
      if (["account", "chain"].includes(kind)) expect(() => flow.progress()).toThrow();
      else expect(flow.progress().signatureCollected).toBe(false);
      expect(w.listeners.size).toBe(0); flow.dispose();
    }
  });
  it("discards late signatures after provider events, abort, logout or demo change", async () => {
    for (const event of ["accountsChanged", "chainChanged", "disconnect", "abort", "context", "demo"]) {
      const h = harness(), flow = h.create(), w = h.wallet(), original = w.request.getMockImplementation()!;
      let finish!: (value: unknown) => void;
      w.request.mockImplementation(r => r.method === "eth_signTypedData_v4" ? new Promise(resolve => { finish = resolve; }) : original(r));
      const pending = flow.collect(w.provider); await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
      if (event === "abort") h.controller.abort(); else if (event === "context") h.context.current = false;
      else if (event === "demo") mock.env.rewardDemo = null;
      else { w.listeners.get(event)?.([]); w.listeners.get("accountsChanged")?.([signer.address]); }
      finish(await signer.signTypedData(h.typedData)); await expect(pending).rejects.toBeDefined();
      expect(h.submit).not.toHaveBeenCalled(); expect(w.listeners.size).toBe(0); expect(() => flow.progress()).toThrow(); flow.dispose();
    }
  });
  it("refuses concurrent actions and removes listeners after partial provider setup failure", async () => {
    const h = harness(), flow = h.create(), w = h.wallet(), original = w.request.getMockImplementation()!;
    let finish!: (value: unknown) => void;
    w.request.mockImplementation(r => r.method === "eth_signTypedData_v4" ? new Promise(resolve => { finish = resolve; }) : original(r));
    const pending = flow.collect(w.provider); await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await expect(flow.submit()).rejects.toMatchObject({ code: "request_pending" });
    await expect(flow.collect(w.provider)).rejects.toMatchObject({ code: "request_pending" });
    finish(await signer.signTypedData(h.typedData)); await pending; flow.dispose();
    const h2 = harness(), f2 = h2.create(), bad = h2.wallet();
    bad.provider.on = (e, cb) => { bad.listeners.set(e, cb); throw Error("provider setup"); };
    await expect(f2.collect(bad.provider)).rejects.toThrow("provider setup"); expect(bad.listeners.size).toBe(0); f2.dispose();
  });
  it("detects source holds or changed messages before prompting and expiry after a long prompt", async () => {
    for (const kind of ["hold", "changed", "stale"]) {
      const h = harness(10143), flow = h.create(), w = h.wallet();
      if (kind === "hold") h.read.mockRejectedValue({ status: 409 });
      else if (kind === "changed") { const changed = structuredClone(h.raw); changed.typedData.message.nonce = 1n; h.read.mockResolvedValue(changed); }
      else { const stale = structuredClone(h.raw); stale.observation.timestamp = String(Number(stale.issuedAt) - 1); h.read.mockResolvedValue(stale); }
      await expect(flow.collect(w.provider)).rejects.toBeDefined(); expect(w.request).not.toHaveBeenCalled(); flow.dispose();
    }
    const h = harness(10143), flow = h.create(), w = h.wallet(), original = w.request.getMockImplementation()!;
    w.request.mockImplementation(async r => { const result = await original(r); if (r.method === "eth_signTypedData_v4") vi.spyOn(Date, "now").mockReturnValue(Number(h.record.expiresAt) * 1000); return result; });
    await expect(flow.collect(w.provider)).rejects.toMatchObject({ code: "claim_expired" }); expect(h.submit).not.toHaveBeenCalled(); expect(() => flow.progress()).toThrow(); flow.dispose();
  });
  it("captures selection/message and rejects regressed block, timestamp or same-block hash", async () => {
    for (const kind of ["height", "time", "hash"]) {
      const h = harness(), flow = h.create(), w = h.wallet(), saved = structuredClone(h.raw);
      h.selection.amountWei = "1"; h.raw.typedData.message.amount = 1n; h.read.mockResolvedValue(saved);
      await flow.collect(w.provider);
      const regressed = structuredClone(saved);
      if (kind === "height") regressed.observation.blockNumber = "199";
      if (kind === "time") regressed.observation.timestamp = regressed.issuedAt;
      if (kind === "hash") regressed.observation.blockHash = hex(9);
      h.read.mockResolvedValue(regressed); await expect(flow.submit()).rejects.toMatchObject({ code: "claim_refresh_required" });
      expect(h.submit).not.toHaveBeenCalled(); expect(() => flow.progress()).toThrow(); flow.dispose();
    }
  });
  it("rejects expired/old/future testnet observations before prompting", async () => {
    for (const skew of [-121, 6]) {
      const h = harness(10143), w = h.wallet();
      h.raw.issuedAt = String(Number(h.raw.issuedAt) - 500); h.raw.typedData.message.issuedAt = BigInt(h.raw.issuedAt);
      h.raw.observation.timestamp = String(Number(h.raw.observation.timestamp) + skew);
      const flow = h.create(); await expect(flow.collect(w.provider)).rejects.toMatchObject({ code: "claim_refresh_required" });
      expect(w.request).not.toHaveBeenCalled(); flow.dispose();
    }
  });
  it("drops account-denied and late POST responses without treating consent as payment", async () => {
    for (const phase of ["read", "submit", "malformed"]) {
      const h = harness(), flow = h.create(), w = h.wallet(); await flow.collect(w.provider);
      if (phase === "read") h.read.mockRejectedValue({ status: 401 });
      else if (phase === "submit") h.submit.mockImplementation(async () => { h.context.current = false; return h.receipt; });
      else h.submit.mockResolvedValue({ ...h.receipt, paid: true });
      await expect(flow.submit()).rejects.toBeDefined(); expect(() => flow.progress()).toThrow();
      expect(h.submit).toHaveBeenCalledTimes(phase === "read" ? 0 : 1); flow.dispose();
    }
  });
  it("does not post after a returned-record window changes", async () => {
    const h = harness(), flow = h.create(), w = h.wallet(); await flow.collect(w.provider);
    h.read.mockResolvedValue({ ...h.receipt, status: "already_recorded", expiresAt: String(Number(h.receipt.expiresAt) + 1) });
    await expect(flow.submit()).rejects.toMatchObject({ code: "claim_refresh_required" }); expect(h.submit).not.toHaveBeenCalled(); flow.dispose();
  });
  it("uses private exact-scope consent endpoints with network checks after IO", async () => {
    const h = harness(); mock.api.mockResolvedValueOnce(h.raw).mockResolvedValueOnce(h.receipt);
    const signature = await signer.signTypedData(h.typedData);
    await getAthleteConsentReviewV3(h.selection); await submitAthleteConsentV3(h.selection, signature);
    expect(mock.api.mock.calls[0][0]).toEqual({ path: `/v1/athlete/rewards/uploads/${id(1)}/destinations/${id(2)}/awards/${hex(1)}/claims/${id(3)}/signing`, cache: "no-store" });
    expect(mock.api.mock.calls[1][0]).toEqual({ path: `/v1/athlete/rewards/uploads/${id(1)}/destinations/${id(2)}/awards/${hex(1)}/claims/${id(3)}/proof`, method: "POST", cache: "no-store", body: { signature } });
    mock.api.mockImplementationOnce(async () => { mock.env.rewardDemo = { mode: "testnet" }; return h.raw; });
    await expect(getAthleteConsentReviewV3(h.selection)).rejects.toThrow(); mock.env.rewardDemo = null;
    await expect(getAthleteConsentReviewV3(h.selection)).rejects.toThrow(); expect(mock.api).toHaveBeenCalledTimes(3);
  });
  it("keeps allocation and claim cursors separate and rejects mainnet, wrong-chain pages and private extras", async () => {
    const h = harness();
    mock.api.mockResolvedValueOnce({ schema: "raceson-own-claims-v3", chainId: 31337, items: [h.record], nextCursor: null });
    expect((await getOwnAthleteClaimsV3(31337)).items).toHaveLength(1);
    mock.api.mockResolvedValueOnce({ schema: "raceson-own-allocations-v3", chainId: 31337, items: [], nextCursor: null });
    await getOwnAthleteAllocationsV3(31337, hex(5));
    expect(mock.api.mock.calls[1][0]).toEqual({ path: `/v1/athlete/rewards/programme-allocations-v3?after=${hex(5)}`, cache: "no-store" });
    await expect(getOwnAthleteClaimsV3(31337, hex(1))).rejects.toThrow();
    await expect(getOwnAthleteAllocationsV3(31337, id(1))).rejects.toThrow();
    await expect(getOwnAthleteClaimsV3(143 as 31337)).rejects.toThrow(); expect(mock.api).toHaveBeenCalledTimes(2);
    mock.api.mockResolvedValueOnce({ schema: "raceson-own-claims-v3", chainId: 10143, items: [], nextCursor: null });
    await expect(getOwnAthleteClaimsV3(31337)).rejects.toThrow();
  });
});
