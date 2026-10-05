import {afterEach, expect, it, vi} from "vitest";
import {readSponsorWalletBalance} from "./sponsorWalletBalance";
const address = "0x" + "ab".repeat(20);
function provider() {
  const listeners = new Map<string, () => void>();
  return {listeners, on: vi.fn((event: string, callback: () => void) => listeners.set(event, callback)), removeListener: vi.fn((event: string) => listeners.delete(event)),
    request: vi.fn(async ({method}: {method: string}): Promise<unknown> => method === "eth_accounts" ? [address] : method === "eth_chainId" ? "0x279f" : "0x1bc16d674ec80000")};
}
afterEach(() => vi.useRealTimers());
it("reads the connected funding wallet in wei without permission, estimate, signature or send", async () => {
  const p = provider();
  expect(await readSponsorWalletBalance(p, address.toUpperCase().replace("0X", "0x"), 10143, () => true)).toBe("2000000000000000000");
  expect(p.request.mock.calls.map(([request]) => request.method)).toEqual(["eth_accounts", "eth_chainId", "eth_getBalance", "eth_accounts", "eth_chainId"]);
  expect(p.request).toHaveBeenCalledWith({method: "eth_getBalance", params: [address, "latest"]});
  expect(p.removeListener).toHaveBeenCalledTimes(3);
});
it.each(["wrong-account", "wrong-chain", "changed", "invalid-balance", "stale"])("rejects %s without returning invented funds", async reason => {
  const p = provider();
  p.request.mockImplementation(async ({method}) => {
    if (method === "eth_accounts") return [reason === "wrong-account" ? "0x" + "cd".repeat(20) : address];
    if (method === "eth_chainId") return reason === "wrong-chain" ? "0x1" : "0x279f";
    if (reason === "changed") p.listeners.get("chainChanged")?.();
    return reason === "invalid-balance" ? "0" : "0x0";
  });
  await expect(readSponsorWalletBalance(p, address, 10143, () => reason !== "stale")).rejects.toThrow();
  expect(p.removeListener).toHaveBeenCalledTimes(3);
});
it("times out a stalled provider and removes listeners", async () => {
  vi.useFakeTimers(); const p = provider(); p.request.mockImplementation(() => new Promise(() => {}));
  const check = expect(readSponsorWalletBalance(p, address, 10143, () => true)).rejects.toThrow("sponsor_balance_unavailable");
  await vi.advanceTimersByTimeAsync(15000); await check;
  expect(p.removeListener).toHaveBeenCalledTimes(3);
});
it("rejects an account that changes silently during the balance read", async () => {
 const p=provider();let reads=0;
 p.request.mockImplementation(async({method})=>method==='eth_accounts'?[++reads===1?address:'0x'+'cd'.repeat(20)]:method==='eth_chainId'?'0x279f':'0x0');
 await expect(readSponsorWalletBalance(p,address,10143,()=>true)).rejects.toThrow('sponsor_wallet_changed');
});
