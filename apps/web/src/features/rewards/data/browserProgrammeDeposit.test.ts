import { beforeEach, expect, it, vi } from "vitest";
import { decodeFunctionData } from "viem";
import { rewardProgrammeV3Abi } from "@raceson/rewards-chain/programme-v3";
import { decodeProgrammeDepositQuoteV3, programmeDepositAmountV3 } from "@raceson/domain/rewards/programme-deposit-v3";
import { readPendingProgrammeDeposit, programmeDepositStorageKey, sendBrowserProgrammeDeposit, reconcileBrowserProgrammeDeposit } from "./browserProgrammeDeposit";
import type { RewardWalletProvider } from "./browserWallet";
const id = "89000000-0000-4000-8000-000000000001", tx = `0x${"d".repeat(64)}`;
const quote = () => decodeProgrammeDepositQuoteV3({ schema: "raceson-programme-deposit-v3", chainId: 31337, draftId: id, rulesRevision: 1,
  address: `0x${"a".repeat(40)}`, funderAddress: `0x${"b".repeat(40)}`, approvalId: id, contextHash: "c".repeat(64), policyHash: `0x${"e".repeat(64)}`,
  expectedDepositedWei: "0", amountWei: "1000000000000000000", budgetWei: "100000000000000000000000", expiresAt: new Date(Date.now() + 120000).toISOString() });
function fixture() {
  const q = quote(), listeners = new Map<string, (...a: unknown[]) => void>();
  const provider: RewardWalletProvider = { request: vi.fn(async ({ method }) => method === "eth_chainId" ? "0x7a69" : method === "eth_sendTransaction" ? tx : [q.funderAddress]),
    on: vi.fn((name, fn) => { listeners.set(name, fn); }), removeListener: vi.fn(name => { listeners.delete(name); }) };
  const d = { storage: localStorage, locks: { request: vi.fn(async (_name, _options, callback) => callback({ name: "test", mode: "exclusive" })) } as unknown as Pick<LockManager, "request">,
    current: () => true, signal: new AbortController().signal, pending: vi.fn() };
  const fresh = vi.fn(async () => ({ status: "ready" as const, quote: q }));
  return { q, provider, d, fresh, listeners, send: () => sendBrowserProgrammeDeposit(provider, q, fresh, d) };
}
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
it("uses integer MON only and rejects ambiguous, overprecise, zero or mainnet requests", () => {
  expect(programmeDepositAmountV3("0.000000000000000001")).toBe(1n);
  for (const n of ["0", 1, "1e3", "1,5", " 1", "01", "-1", "1.0000000000000000001"]) expect(() => programmeDepositAmountV3(n)).toThrow();
  for (const patch of [{ chainId: 10143 }, { chainId: 143 }, { amountWei: (1n << 256n).toString() }, { privateKey: "forbidden" }])
    expect(() => decodeProgrammeDepositQuoteV3({ ...quote(), ...patch })).toThrow();
});
it("requests exactly one bounded contract deposit, persists public pending metadata and never calls signing/key/network-change methods", async () => {
  const f = fixture(), p = await f.send();
  const requests = vi.mocked(f.provider.request).mock.calls.map(([r]) => r);
  expect(requests.map(r => r.method)).toEqual(["eth_requestAccounts", "eth_accounts", "eth_chainId", "eth_accounts", "eth_chainId", "eth_sendTransaction"]);
  const sent = requests.at(-1)!.params![0] as Record<string, string>;
  expect(sent).toMatchObject({ chainId: "0x7a69", from: f.q.funderAddress, to: f.q.address, value: "0xde0b6b3a7640000" });
  expect(decodeFunctionData({ abi: rewardProgrammeV3Abi, data: sent.data as `0x${string}` })).toEqual({ functionName: "deposit", args: [0n] });
  expect(readPendingProgrammeDeposit(localStorage, 31337, id)).toEqual(p);
  expect(p.transactionHash).toBe(tx); expect(f.listeners.size).toBe(0);
  await expect(f.send()).rejects.toMatchObject({ code: "deposit_pending" });
  expect(vi.mocked(f.provider.request).mock.calls.filter(([r]) => r.method === "eth_sendTransaction")).toHaveLength(1);
});
it.each(["network", "funder", "expired", "stale", "event", "abort", "current", "lock", "storage"])("%s failure refuses any transaction", async kind => {
  const f = fixture();
  const original = f.provider.request;
  if (kind === "network" || kind === "funder") f.provider.request = vi.fn(async r => r.method === (kind === "network" ? "eth_chainId" : "eth_accounts")
    ? kind === "network" ? "0x279f" : [`0x${"f".repeat(40)}`] : original(r));
  if (kind === "expired") f.q.expiresAt = new Date(0).toISOString();
  if (kind === "stale") f.fresh.mockImplementation(async () => ({ status: "ready", quote: { ...f.q, expectedDepositedWei: "1" } }));
  if (kind === "event") f.fresh.mockImplementation(async () => { f.listeners.get("chainChanged")?.(); return { status: "ready", quote: f.q }; });
  if (kind === "abort") { const c = new AbortController(); c.abort(); f.d.signal = c.signal; }
  if (kind === "current") f.d.current = () => false;
  if (kind === "lock") vi.mocked(f.d.locks.request).mockImplementation(async (_n, _o, fn) => (fn as (l: null) => Promise<unknown>)(null));
  if (kind === "storage") vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("storage disabled"); });
  await expect(f.send()).rejects.toThrow();
  expect(vi.mocked(f.provider.request).mock.calls.some(([r]) => r.method === "eth_sendTransaction")).toBe(false);
});
it("lost wallet responses remain unresolved across reload; an exact receipt is required to clear", async () => {
  const f = fixture(), original = f.provider.request;
  f.provider.request = vi.fn(async r => { if (r.method === "eth_sendTransaction") throw Error("response lost"); return original(r); });
  await expect(f.send()).rejects.toMatchObject({ code: "deposit_unknown" });
  const pending = readPendingProgrammeDeposit(localStorage, 31337, id)!; expect(pending.transactionHash).toBeNull();
  await expect(f.send()).rejects.toMatchObject({ code: "deposit_pending" });
  await expect(reconcileBrowserProgrammeDeposit(pending, tx, async () => { throw Error("not verified"); }, f.d)).rejects.toThrow();
  expect(readPendingProgrammeDeposit(localStorage, 31337, id)).not.toBeNull();
  await reconcileBrowserProgrammeDeposit(pending, tx, async () => ({ status: "pending", transactionHash: tx }), f.d);
  expect(readPendingProgrammeDeposit(localStorage, 31337, id)?.transactionHash).toBe(tx);
  await reconcileBrowserProgrammeDeposit(pending, tx, async () => ({ status: "confirmed", transactionHash: tx }), f.d);
  expect(readPendingProgrammeDeposit(localStorage, 31337, id)).toBeNull();
});
it("wallet rejection clears this attempt, but an untrusted receipt or changed session cannot clear history", async () => {
  const f = fixture(), original = f.provider.request;
  f.provider.request = vi.fn(async r => { if (r.method === "eth_sendTransaction") throw { code: 4001 }; return original(r); });
  await expect(f.send()).rejects.toMatchObject({ code: "deposit_rejected" }); expect(readPendingProgrammeDeposit(localStorage, 31337, id)).toBeNull();
  f.provider.request = original; const p = await f.send();
  await expect(reconcileBrowserProgrammeDeposit(p, `0x${"a".repeat(64)}`, async () => ({ status: "reverted", transactionHash: `0x${"a".repeat(64)}` }), f.d)).rejects.toThrow();
  await expect(reconcileBrowserProgrammeDeposit(p, tx, async () => ({ status: "confirmed", transactionHash: `0x${"a".repeat(64)}` }), f.d)).rejects.toThrow();
  await expect(reconcileBrowserProgrammeDeposit(p, tx, async () => { f.d.current = () => false; return { status: "confirmed", transactionHash: tx }; }, f.d)).rejects.toThrow();
  expect(readPendingProgrammeDeposit(localStorage, 31337, id)).not.toBeNull();
});
it("malformed journal fails closed without deleting it", async () => {
  const f = fixture(), key = programmeDepositStorageKey(31337, id); localStorage.setItem(key, "not-json");
  await expect(f.send()).rejects.toMatchObject({ code: "deposit_storage" }); expect(localStorage.getItem(key)).toBe("not-json");
  expect(f.provider.request).not.toHaveBeenCalled();
});
it("initial permission may announce the nominated account; switching away and back still invalidates review", async () => {
  const f = fixture(), original = f.provider.request;
  f.provider.request = vi.fn(async r => {
    if (r.method === "eth_requestAccounts") f.listeners.get("accountsChanged")?.([f.q.funderAddress]);
    return original(r);
  });
  await f.send(); expect(readPendingProgrammeDeposit(localStorage, 31337, id)?.transactionHash).toBe(tx);
  localStorage.clear(); const other = fixture();
  other.fresh.mockImplementation(async () => {
    other.listeners.get("accountsChanged")?.([`0x${"f".repeat(40)}`]); other.listeners.get("accountsChanged")?.([other.q.funderAddress]);
    return { status: "ready", quote: other.q };
  });
  await expect(other.send()).rejects.toThrow(); expect(vi.mocked(other.provider.request).mock.calls.some(([r]) => r.method === "eth_sendTransaction")).toBe(false);
});
