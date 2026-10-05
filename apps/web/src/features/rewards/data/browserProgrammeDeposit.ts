import { decodeProgrammeDepositQuoteV3, sameProgrammeDepositV3, type ProgrammeDepositQuoteV3, type ProgrammeDepositReviewV3 } from "@raceson/domain/rewards/programme-deposit-v3";
import type { RewardWalletProvider } from "./browserWallet";

export class ProgrammeDepositError extends Error { constructor(public readonly code: string) { super(code); } }
function demand(value: unknown, code = "deposit_changed"): asserts value { if (!value) throw new ProgrammeDepositError(code); }
export type PendingProgrammeDeposit = { version: 1; attemptId: string; quote: ProgrammeDepositQuoteV3; transactionHash: string | null };
export const programmeDepositStorageKey = (chainId: number, draftId: string) => `raceson.programme-deposit.v1:${chainId}:${draftId}`;
export function readPendingProgrammeDeposit(storage: Storage, chainId: number, draftId: string): PendingProgrammeDeposit | null {
  const raw = storage.getItem(programmeDepositStorageKey(chainId, draftId));
  if (raw === null) return null;
  demand(raw.length <= 8192, "deposit_storage");
  let p; try { p = JSON.parse(raw); } catch { throw new ProgrammeDepositError("deposit_storage"); }
  demand(p && Object.keys(p).sort().join(",") === "attemptId,quote,transactionHash,version" && p.version === 1
    && typeof p.attemptId === "string" && /^[0-9a-f-]{36}$/.test(p.attemptId)
    && (p.transactionHash === null || typeof p.transactionHash === "string" && /^0x[0-9a-f]{64}$/.test(p.transactionHash)), "deposit_storage");
  const quote = decodeProgrammeDepositQuoteV3(p.quote);
  demand(quote.chainId === chainId && quote.draftId === draftId, "deposit_storage");
  return { version: 1, attemptId: p.attemptId, quote, transactionHash: p.transactionHash };
}
type Dependencies = { storage: Storage; locks: Pick<LockManager, "request">; current: () => boolean; signal: AbortSignal;
  pending: (value: PendingProgrammeDeposit | null) => void };
function writePending(storage: Storage, p: PendingProgrammeDeposit) {
  const key = programmeDepositStorageKey(p.quote.chainId, p.quote.draftId), encoded = JSON.stringify(p);
  storage.setItem(key, encoded); demand(storage.getItem(key) === encoded, "deposit_storage");
}
/** A public-metadata browser journal is an accident-prevention fence, NOT an
 * authorization ledger. No keys, tokens, signatures or personal profiles enter
 * storage. Contract expectedDeposited and cap checks remain authoritative. */
export async function sendBrowserProgrammeDeposit(provider: RewardWalletProvider, value: ProgrammeDepositQuoteV3,
  freshQuote: () => Promise<ProgrammeDepositReviewV3>, d: Dependencies) {
  const quote = decodeProgrammeDepositQuoteV3(value), request = provider.request.bind(provider);
  demand(d.locks?.request, "deposit_storage");
  return d.locks.request(programmeDepositStorageKey(quote.chainId, quote.draftId), { ifAvailable: true }, async lock => {
    demand(lock, "deposit_pending"); demand(!readPendingProgrammeDeposit(d.storage, quote.chainId, quote.draftId), "deposit_pending");
    let changed = false, released = false, attempt: PendingProgrammeDeposit | null = null;
    const change = () => { changed = true; };
    const accountChange = (accounts: unknown) => {
      if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || accounts[0].toLowerCase() !== quote.funderAddress) change();
    };
    const events: [string, (...args: unknown[]) => void][] = [["accountsChanged", accountChange], ["chainChanged", change], ["disconnect", change]], attached: typeof events = [];
    const active = () => demand(!changed && !d.signal.aborted && d.current() && Date.now() < Date.parse(quote.expiresAt));
    async function wallet() {
      active(); const accounts = await request({ method: "eth_accounts" }); active();
      demand(Array.isArray(accounts) && typeof accounts[0] === "string" && accounts[0].toLowerCase() === quote.funderAddress, "deposit_wrong_funder");
      const chain = await request({ method: "eth_chainId" }); active();
      demand(typeof chain === "string" && /^0x[0-9a-f]+$/i.test(chain) && BigInt(chain) === BigInt(quote.chainId), "deposit_wrong_network");
    }
    try {
      active(); for (const [event, listener] of events) { provider.on(event, listener); attached.push([event, listener]); }
      await request({ method: "eth_requestAccounts" }); await wallet();
      const fresh = await freshQuote(); active();
      demand(fresh.status === "ready" && sameProgrammeDepositV3(quote, fresh.quote) && Date.now() < Date.parse(fresh.quote.expiresAt));
      const { encodeFunctionData } = await import("viem"), { rewardProgrammeV3Abi } = await import("@raceson/rewards-chain/programme-v3");
      active(); const data = encodeFunctionData({ abi: rewardProgrammeV3Abi, functionName: "deposit", args: [BigInt(quote.expectedDepositedWei)] });
      await wallet();
      attempt = { version: 1, attemptId: crypto.randomUUID(), quote, transactionHash: null };
      writePending(d.storage, attempt); d.pending(attempt); active();
      // No awaits between the final current-state fence and wallet byte release.
      released = true;
      const hash = await request({ method: "eth_sendTransaction", params: [{ chainId: `0x${quote.chainId.toString(16)}`,
        from: quote.funderAddress, to: quote.address, data, value: `0x${BigInt(quote.amountWei).toString(16)}` }] });
      demand(typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash) && BigInt(hash) !== 0n, "deposit_unknown");
      attempt = { ...attempt, transactionHash: hash.toLowerCase() }; d.pending(attempt); writePending(d.storage, attempt);
      return attempt;
    } catch (error) {
      const rejected = !!error && typeof error === "object" && "code" in error && error.code === 4001;
      if (attempt && (!released || rejected)) {
        if (readPendingProgrammeDeposit(d.storage, quote.chainId, quote.draftId)?.attemptId === attempt.attemptId)
          d.storage.removeItem(programmeDepositStorageKey(quote.chainId, quote.draftId));
        d.pending(null);
      }
      if (released && !rejected) throw new ProgrammeDepositError("deposit_unknown");
      if (rejected) throw new ProgrammeDepositError("deposit_rejected");
      throw error;
    } finally { for (const [event, listener] of attached) { try { provider.removeListener(event, listener); } catch { /* No retries or raw provider errors. */ } } }
  });
}
export async function reconcileBrowserProgrammeDeposit(p: PendingProgrammeDeposit, hash: string,
  inspect: () => Promise<{ status: "pending" | "confirmed" | "reverted"; transactionHash: string }>, d: Dependencies) {
  demand(d.locks?.request && /^0x[0-9a-f]{64}$/.test(hash), "deposit_storage");
  demand(p.transactionHash === null || p.transactionHash === hash);
  return d.locks.request(programmeDepositStorageKey(p.quote.chainId, p.quote.draftId), { ifAvailable: true }, async lock => {
    demand(lock, "deposit_pending");
    demand(readPendingProgrammeDeposit(d.storage, p.quote.chainId, p.quote.draftId)?.attemptId === p.attemptId, "deposit_changed");
    const result = await inspect(); demand(["pending", "confirmed", "reverted"].includes(result.status)
      && result.transactionHash === hash && d.current() && !d.signal.aborted);
    demand(readPendingProgrammeDeposit(d.storage, p.quote.chainId, p.quote.draftId)?.attemptId === p.attemptId, "deposit_changed");
    if (result.status === "confirmed" || result.status === "reverted") {
      d.storage.removeItem(programmeDepositStorageKey(p.quote.chainId, p.quote.draftId)); d.pending(null);
    } else { const next = { ...p, transactionHash: hash }; writePending(d.storage, next); d.pending(next); }
    return result;
  });
}
