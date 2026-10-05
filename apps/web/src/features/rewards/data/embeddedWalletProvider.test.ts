import { describe, expect, it, vi } from "vitest";
import { bindEmbeddedRewardWallet } from "./embeddedWalletProvider";
import type { RewardWalletProvider } from "./browserWallet";

const address = `0x${"12".repeat(20)}`;
function fixture() {
  let active = true;
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const raw: RewardWalletProvider = {
    request: vi.fn(async ({ method }) => method === "eth_chainId" ? "0x279f"
      : method === "eth_accounts" || method === "eth_requestAccounts" ? [address] : `0x${"ab".repeat(65)}`),
    on: (event, fn) => { handlers.set(event, fn); },
    removeListener: (event) => { handlers.delete(event); },
  };
  const binding = bindEmbeddedRewardWallet(raw, address, () => active);
  return { raw, handlers, ...binding, stop: () => { active = false; } };
}

describe("client-owned embedded wallet boundary", () => {
  it("allows account proof and exact-chain consent without transaction methods", async () => {
    const f = fixture();
    expect(await f.provider.request({ method: "eth_requestAccounts" })).toEqual([address]);
    await f.provider.request({ method: "personal_sign", params: ["0x1234", address] });
    await f.provider.request({ method: "eth_signTypedData_v4", params: [address, JSON.stringify({ domain: { chainId: 10143 } })] });
    expect(vi.mocked(f.raw.request).mock.calls.map(([r]) => r.method)).not.toContain("eth_sendTransaction");
    f.dispose(); expect(f.handlers.size).toBe(0);
  });
  it.each(["eth_sendTransaction", "eth_sendRawTransaction", "eth_sign", "eth_signTransaction", "wallet_switchEthereumChain", "wallet_addEthereumChain", "wallet_grantPermissions", "wallet_export"])("rejects %s before provider IO", async method => {
    const f = fixture();
    await expect(f.provider.request({ method })).rejects.toMatchObject({ code: "invalid_response" });
    expect(f.raw.request).not.toHaveBeenCalled(); f.dispose();
  });
  it("rejects a changed signer or typed-data network before a prompt", async () => {
    const f = fixture();
    await expect(f.provider.request({ method: "personal_sign", params: ["0x1234", `0x${"34".repeat(20)}`] })).rejects.toMatchObject({ code: "wallet_changed" });
    await expect(f.provider.request({ method: "eth_signTypedData_v4", params: [address, '{"domain":{"chainId":143}}'] })).rejects.toMatchObject({ code: "wrong_network" });
    expect(f.raw.request).not.toHaveBeenCalled(); f.dispose();
  });
  it("does not fake a provider network and rejects before signing", async () => {
    const f = fixture();
    vi.mocked(f.raw.request).mockImplementation(async ({ method }) => method === "eth_chainId" ? "0x7a69" : [address]);
    await expect(f.provider.request({ method: "personal_sign", params: ["0x1234", address] })).rejects.toMatchObject({ code: "wrong_network" });
    expect(vi.mocked(f.raw.request).mock.calls.map(([r]) => r.method)).toEqual(["eth_accounts", "eth_chainId"]); f.dispose();
  });
  it("rejects stale sessions before and after signing", async () => {
    const f = fixture();
    vi.mocked(f.raw.request).mockImplementation(async ({ method }) => {
      if (method === "eth_accounts") return [address];
      if (method === "eth_chainId") return "0x279f";
      f.stop(); return `0x${"ab".repeat(65)}`;
    });
    await expect(f.provider.request({ method: "personal_sign", params: ["0x1234", address] })).rejects.toMatchObject({ code: "wallet_changed" });
    await expect(f.provider.request({ method: "eth_accounts" })).rejects.toMatchObject({ code: "wallet_changed" }); f.dispose();
  });
  it.each(["accountsChanged", "chainChanged", "disconnect"])("invalidates on %s, notifying and detaching listeners", async event => {
    const f = fixture(), stop = vi.fn(); f.provider.on("disconnect", stop);
    f.handlers.get(event)!();
    expect(stop).toHaveBeenCalledOnce(); expect(f.handlers.size).toBe(0);
    await expect(f.provider.request({ method: "eth_accounts" })).rejects.toMatchObject({ code: "wallet_changed" });
  });
});

it('reads only the bound account balance with network/session checks and no signing', async () => {
 const f=fixture();
 vi.mocked(f.raw.request).mockImplementation(async({method})=>method==='eth_accounts'?[address]:method==='eth_chainId'?'0x279f':'0xde0b6b3a7640000');
 const {readSponsorWalletBalance}=await import('./sponsorWalletBalance');
 await expect(readSponsorWalletBalance(f.provider,address,10143,()=>true)).resolves.toBe('1000000000000000000');
 expect(f.raw.request).toHaveBeenCalledWith({method:'eth_getBalance',params:[address,'latest']});
 expect(vi.mocked(f.raw.request).mock.calls.every(([r])=>['eth_accounts','eth_chainId','eth_getBalance'].includes(r.method))).toBe(true);
 f.dispose();
});
it.each([[`0x${'34'.repeat(20)}`,'latest'],[address,'pending'],[address,'0x1'],[address,'latest','extra']])('rejects an out-of-scope balance request %j before provider IO', async (...params) => {
 const f=fixture();await expect(f.provider.request({method:'eth_getBalance',params})).rejects.toMatchObject({code:'invalid_response'});expect(f.raw.request).not.toHaveBeenCalled();f.dispose();
});
it('rejects changed network, invalid data and a late session change during balance reading', async()=>{
 for(const reason of ['network','invalid','stale']){
  const f=fixture();vi.mocked(f.raw.request).mockImplementation(async({method})=>{
   if(method==='eth_accounts')return[address];if(method==='eth_chainId')return reason==='network'?'0x1':'0x279f';
   if(reason==='stale')f.stop();return reason==='invalid'?'not-a-balance':'0x1';
  });
  await expect(f.provider.request({method:'eth_getBalance',params:[address,'latest']})).rejects.toBeTruthy();f.dispose();
 }
});
