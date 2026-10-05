import { describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { rewardWalletControlMessage, validateRewardWalletControlMessage, verifyRewardWalletControl } from "@raceson/rewards-chain/wallet-control";
import { discoverRewardWallets, prepareBrowserWalletProof, type RewardWalletProvider } from "./browserWallet";
import type { WalletChallenge } from "../model/athleteRewards";

vi.mock("@/lib/api", () => ({ apiRequest: vi.fn() }));
const origin = "http://127.0.0.1:5173";
// Explicitly synthetic test signer. No imported real wallet or user identity.
const signer = privateKeyToAccount(`0x${991n.toString(16).padStart(64, "0")}`);
function harness(chainId: 31337 | 10143 = 31337, siteOrigin = origin) {
  const issuedAt = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
  const control = { challengeId: "00000000-0000-4000-8000-000000000001", address: signer.address, chainId,
    origin: siteOrigin, nonce: "ab".repeat(32), issuedAt, expiresAt: new Date(Date.parse(issuedAt) + 600_000).toISOString() };
  const challenge: WalletChallenge = { challengeId: control.challengeId, address: signer.address.toLowerCase() as `0x${string}`,
    chainId, message: rewardWalletControlMessage(control), expiresAt: control.expiresAt, alreadyVerified: false };
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const provider: RewardWalletProvider = {
    request: vi.fn(async ({ method, params }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [signer.address];
      if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
      if (method === "personal_sign") return signer.signMessage({ message: { raw: params?.[0] as `0x${string}` } });
      throw new Error(`Unexpected wallet method: ${method}`);
    }),
    on: (event, listener) => { listeners.set(event, listener); },
    removeListener: (event, listener) => { if (listeners.get(event) === listener) listeners.delete(event); },
  };
  const prepare = vi.fn(async () => challenge);
  const confirm = vi.fn(async (c: WalletChallenge, signature: string) => {
    await verifyRewardWalletControl(validateRewardWalletControlMessage(c, siteOrigin), signature as `0x${string}`);
    return { proofId: "00000000-0000-4000-8000-000000000002", address: c.address, chainId: c.chainId,
      verifiedAt: new Date().toISOString(), proofKind: "eip191_address_control" as const };
  });
  const controller = new AbortController();
  return { provider, prepare, confirm, challenge, listeners, controller, siteOrigin, changed: vi.fn() };
}
const ready = (h: ReturnType<typeof harness>) => prepareBrowserWalletProof(h.provider, h.siteOrigin, () => true, h.changed, h.controller.signal, h);

describe("external reward wallet control", () => {
  it.each(["http://127.0.0.1:3102", "https://reward-demo.invalid"])("links Monad testnet control at %s with no fund-spending methods", async site => {
    const h = harness(10143, site), flow = await ready(h);
    expect((await flow.confirm()).chainId).toBe(10143);
    expect(h.challenge.message).toContain(`URI: ${site}/athlete/rewards`);
    expect(new Set(vi.mocked(h.provider.request).mock.calls.map(([args]) => args.method)))
      .toEqual(new Set(["eth_requestAccounts", "eth_accounts", "eth_chainId", "personal_sign"]));
    flow.dispose();
  });
  it("does not sign a legacy production challenge or a challenge issued for another demo port", async () => {
    for (const site of ["https://www.raceson.com", "http://127.0.0.1:3102"]) {
      const h = harness(10143, site);
      await expect(prepareBrowserWalletProof(h.provider, "http://127.0.0.1:3101", () => true, h.changed, h.controller.signal, h)).rejects.toThrow();
      expect(h.confirm).not.toHaveBeenCalled();
      expect(vi.mocked(h.provider.request).mock.calls.some(([args]) => args.method === "personal_sign")).toBe(false);
    }
    const legacy = harness(10143, "https://www.raceson.com");
    await expect(ready(legacy)).rejects.toThrow();
  });
  it("prepares without signing; explicit confirmation signs the exact protocol and creates no transaction", async () => {
    const h = harness(); const flow = await ready(h);
    expect(h.confirm).not.toHaveBeenCalled();
    expect(vi.mocked(h.provider.request).mock.calls.some(([args]) => args.method === "personal_sign")).toBe(false);
    expect((await flow.confirm()).proofKind).toBe("eip191_address_control");
    expect(h.prepare).toHaveBeenCalledWith(signer.address.toLowerCase(), expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(new Set(vi.mocked(h.provider.request).mock.calls.map(([args]) => args.method)))
      .toEqual(new Set(["eth_requestAccounts", "eth_accounts", "eth_chainId", "personal_sign"]));
    flow.dispose(); expect(h.listeners.size).toBe(0);
  });
  it("reuses the exact proof after an uncertain confirmation response, without a second signature", async () => {
    const h = harness(); const flow = await ready(h);
    h.confirm.mockRejectedValueOnce(new Error("response lost"));
    await expect(flow.confirm()).rejects.toThrow("response lost");
    await flow.confirm();
    expect(h.confirm.mock.calls[0][1]).toBe(h.confirm.mock.calls[1][1]);
    expect(vi.mocked(h.provider.request).mock.calls.filter(([args]) => args.method === "personal_sign")).toHaveLength(1);
    flow.dispose();
  });
  it("rejects modified domains, statements, resources and expiry before a signing prompt", async () => {
    for (const mutation of [
      (c: WalletChallenge) => ({ ...c, message: c.message.replace("127.0.0.1:5173", "attacker.invalid") }),
      (c: WalletChallenge) => ({ ...c, message: c.message.replace("does not authorize", "does authorize") }),
      (c: WalletChallenge) => ({ ...c, message: `${c.message}\nResources:\n- https://attacker.invalid` }),
      (c: WalletChallenge) => ({ ...c, expiresAt: new Date(Date.parse(c.expiresAt) + 1000).toISOString() }),
    ]) {
      const h = harness(); h.prepare.mockResolvedValue(mutation(h.challenge));
      await expect(ready(h)).rejects.toThrow();
      expect(vi.mocked(h.provider.request).mock.calls.some(([args]) => args.method === "personal_sign")).toBe(false);
      expect(h.listeners.size).toBe(0);
    }
  });
  it("invalidates a prepared proof after a wallet or chain change, even if the wallet switches back", async () => {
    for (const event of ["accountsChanged", "chainChanged", "disconnect"]) {
      const h = harness(); const flow = await ready(h);
      h.listeners.get(event)?.([]);
      await expect(flow.confirm()).rejects.toMatchObject({ code: "wallet_changed" });
      expect(h.confirm).not.toHaveBeenCalled(); expect(h.changed).toHaveBeenCalledOnce(); flow.dispose();
    }
  });
  it("removes pending listeners immediately on unmount and never confirms a late signature", async () => {
    const h = harness(); const flow = await ready(h);
    let release!: (value: unknown) => void;
    const original = h.provider.request;
    h.provider.request = vi.fn(original); // The flow already captured the original provider method.
    vi.mocked(original).mockImplementation(async ({ method }) => {
      if (method === "personal_sign") return new Promise(resolve => { release = resolve; });
      return method === "eth_chainId" ? "0x7a69" : [signer.address];
    });
    const pending = flow.confirm();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    h.controller.abort(); expect(h.listeners.size).toBe(0);
    release(`0x${"11".repeat(65)}`);
    await expect(pending).rejects.toMatchObject({ code: "wallet_changed" }); expect(h.confirm).not.toHaveBeenCalled();
  });
  it("rejects a wrong selected chain without automatically switching it", async () => {
    const h = harness(); vi.mocked(h.provider.request).mockImplementation(async ({ method }) => method === "eth_chainId" ? "0x1" : [signer.address]);
    await expect(ready(h)).rejects.toMatchObject({ code: "wrong_local_network" });
    expect(h.confirm).not.toHaveBeenCalled(); expect(h.listeners.size).toBe(0);
  });
  it("discovers multiple providers without reading accounts or rendering supplied icons", () => {
    const h = harness(); const update = vi.fn(); const stop = discoverRewardWallets(window, update);
    const announce = (name: string, uuid = "00000000-0000-4000-8000-000000000001") => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
      detail: { info: { uuid, name, icon: "javascript:alert(1)", rdns: "pretend.trusted" }, provider: h.provider },
    }));
    announce("Test wallet"); announce("Impersonated wallet");
    expect(update.mock.lastCall?.[0]).toEqual([{ id: "00000000-0000-4000-8000-000000000001", name: "Test wallet", provider: h.provider }]);
    expect(h.provider.request).not.toHaveBeenCalled();
    const count = update.mock.calls.length; stop(); announce("Another", "00000000-0000-4000-8000-000000000002");
    expect(update).toHaveBeenCalledTimes(count);
  });
});
