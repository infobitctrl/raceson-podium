import { RewardPortalError, walletAddress } from "../model/athleteRewards";
import type { RewardWalletProvider } from "./browserWallet";

/** A narrow, session-bound view of a client-owned Privy EOA. It cannot send,
 * export keys, grant delegated access, switch networks or sign raw hashes.
 * Existing wallet-control and V3 codecs still validate the full message. */
export function bindEmbeddedRewardWallet(
  provider: RewardWalletProvider, address: string, isCurrent: () => boolean,
): { provider: RewardWalletProvider; dispose: () => void } {
  if (!walletAddress(address)) throw new RewardPortalError("wallet_changed");
  const expected = address.toLowerCase();
  let disposed = false;
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const active = () => {
    if (disposed || !isCurrent()) throw new RewardPortalError("wallet_changed");
  };
  const invalidate = () => {
    if (disposed) return;
    const callbacks = [...(listeners.get("disconnect") ?? [])];
    dispose();
    for (const callback of callbacks) callback();
  };
  const events = ["accountsChanged", "chainChanged", "disconnect"];
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const event of events) provider.removeListener(event, invalidate);
    listeners.clear();
  }
  const accountsMatch = (value: unknown) => Array.isArray(value) && value.length === 1
    && typeof value[0] === "string" && value[0].toLowerCase() === expected;
  const chainMatches = (value: unknown) => typeof value === "string" && /^0x[0-9a-f]+$/i.test(value)
    && BigInt(value) === 10143n;
  async function checkWallet() {
    active();
    const accounts = await provider.request({ method: "eth_accounts" }); active();
    const chain = await provider.request({ method: "eth_chainId" }); active();
    if (!accountsMatch(accounts)) throw new RewardPortalError("wallet_changed");
    if (!chainMatches(chain)) throw new RewardPortalError("wrong_network");
  }
  try { for (const event of events) provider.on(event, invalidate); }
  catch { dispose(); throw new RewardPortalError("wallet_changed"); }
  return {
    dispose,
    provider: {
      on: (event, listener) => {
        active();
        if (!events.includes(event)) throw new RewardPortalError("wallet_changed");
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(listener);
      },
      removeListener: (event, listener) => { listeners.get(event)?.delete(listener); },
      request: async ({ method, params }) => {
        active();
        if (!["eth_accounts", "eth_requestAccounts", "eth_chainId", "eth_getBalance", "personal_sign", "eth_signTypedData_v4"].includes(method))
          throw new RewardPortalError("invalid_response");
        const balanceRead = method === "eth_getBalance";
        const signing = method === "personal_sign" || method === "eth_signTypedData_v4";
        if (signing) {
          if (!Array.isArray(params) || params.length !== 2 || !params.every(p => typeof p === "string"))
            throw new RewardPortalError("invalid_response");
          const signer = method === "personal_sign" ? params[1] : params[0];
          if ((signer as string).toLowerCase() !== expected) throw new RewardPortalError("wallet_changed");
          if (method === "eth_signTypedData_v4") {
            try {
              const message = JSON.parse(params[1] as string);
              if (![10143, "10143", "0x279f"].includes(message?.domain?.chainId)) throw new Error();
            } catch { throw new RewardPortalError("wrong_network"); }
          }
          await checkWallet();
        } else if (balanceRead) {
          if (!Array.isArray(params) || params.length !== 2 || typeof params[0] !== "string"
            || params[0].toLowerCase() !== expected || params[1] !== "latest") throw new RewardPortalError("invalid_response");
          await checkWallet();
        } else if (params !== undefined && params.length !== 0) throw new RewardPortalError("invalid_response");
        active();
        const result = await provider.request({ method, ...(params === undefined ? {} : { params }) }); active();
        if ((method === "eth_accounts" || method === "eth_requestAccounts") && !accountsMatch(result))
          throw new RewardPortalError("wallet_changed");
        if (method === "eth_chainId" && !chainMatches(result)) throw new RewardPortalError("wrong_network");
        if (balanceRead && (typeof result !== "string" || !/^0x[0-9a-f]+$/i.test(result))) throw new RewardPortalError("invalid_response");
        if (signing || balanceRead) await checkWallet();
        return result;
      },
    },
  };
}
