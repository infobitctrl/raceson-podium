import { hashTypedData, verifyTypedData } from "viem";
import { RewardPortalError, requirePortal, walletAddress } from "../model/athleteRewards";
import { decodeAthleteRewardClaim, type AthleteRewardClaim } from "../model/athleteClaims";
import { athleteConsentSigningJson, type AthleteClaimReview } from "../model/athleteClaimConsent";
import { getAthleteClaimReview, submitAthleteClaimConsent } from "./athleteClaimConsent";
import type { RewardWalletProvider } from "./browserWallet";

type Dependencies = { read: typeof getAthleteClaimReview; submit: typeof submitAthleteClaimConsent };
export type ClaimConsentResult = { recipientConsentRecordedAt: string; operatorApprovalRecordedAt: string | null };
export type BrowserClaimConsent = { confirm: () => Promise<ClaimConsentResult>; dispose: () => void };

/** No transactions, key export, chain switching, eth_sign, personal_sign or
 * spending approvals. Only the explicitly reviewed ReceiveReward v2 message. */
export async function prepareBrowserClaimConsent(provider: RewardWalletProvider, history: AthleteRewardClaim,
  review: AthleteClaimReview, signal: AbortSignal, isCurrent: () => boolean, onChanged: () => void,
  deps: Dependencies = { read: getAthleteClaimReview, submit: submitAthleteClaimConsent }): Promise<BrowserClaimConsent> {
  const fixed = Object.freeze(decodeAthleteRewardClaim(history));
  requirePortal(review.state === "awaiting_consent" && review.intentId === fixed.intentId);
  // Only local immutable bytes survive an asynchronous wallet prompt.
  const signingJson = athleteConsentSigningJson(review.signing), digest = hashTypedData(review.signing);
  const request = provider.request.bind(provider), address = fixed.recipientAddress;
  let changed = false, disposed = false, busy = false, signature: `0x${string}` | null = null;
  const idempotencyKey = crypto.randomUUID();
  const active = () => { if (signal.aborted || changed || disposed || !isCurrent()) throw new RewardPortalError("wallet_changed"); };
  const changedWallet = () => { if (!disposed && !changed) { changed = true; onChanged(); } };
  const accountsChanged = (accounts: unknown) => {
    if (!Array.isArray(accounts) || !walletAddress(accounts[0]) || accounts[0].toLowerCase() !== address) changedWallet();
  };
  const attached: [string, (...args: unknown[]) => void][] = [];
  const dispose = () => {
    if (disposed) return;
    disposed = true; signature = null; signal.removeEventListener("abort", dispose);
    for (const [event, listener] of attached) { try { provider.removeListener(event, listener); } catch { /* Untrusted provider. */ } }
  };
  async function check() {
    active(); const accounts = await request({ method: "eth_accounts" }); active();
    if (!Array.isArray(accounts) || !walletAddress(accounts[0]) || accounts[0].toLowerCase() !== address)
      throw new RewardPortalError("claim_wrong_wallet");
    const chain = await request({ method: "eth_chainId" }); active();
    if (typeof chain !== "string" || !/^0x[0-9a-f]{1,16}$/i.test(chain) || BigInt(chain) !== BigInt(fixed.chainId))
      throw new RewardPortalError(fixed.chainId === 31337 ? "wrong_local_network" : "wrong_network");
  }
  function live(fresh: AthleteClaimReview) {
    requirePortal(fresh.state === "awaiting_consent" && hashTypedData(fresh.signing) === digest);
    if (fixed.chainId === 10143) {
      const now = BigInt(Math.floor(Date.now() / 1000)), observed = BigInt(fresh.observation.timestamp);
      if (now < BigInt(fixed.issuedAt) || now >= BigInt(fixed.expiresAt)) throw new RewardPortalError("claim_expired");
      if (observed < now - 120n || observed > now + 5n) throw new RewardPortalError("claim_refresh_required");
    }
  }
  try {
    active(); signal.addEventListener("abort", dispose, { once: true });
    for (const [event, listener] of [["accountsChanged", accountsChanged], ["chainChanged", changedWallet], ["disconnect", changedWallet]] as const) {
      provider.on(event, listener); attached.push([event, listener]);
    }
    const accounts = await request({ method: "eth_requestAccounts" }); active();
    if (!Array.isArray(accounts) || !walletAddress(accounts[0]) || accounts[0].toLowerCase() !== address)
      throw new RewardPortalError("claim_wrong_wallet");
    await check();
    return { dispose, confirm: async () => {
      active(); if (busy) throw new RewardPortalError("request_pending"); busy = true;
      try {
        await check();
        const fresh = await deps.read(fixed); active();
        if (fresh.state === "consent_recorded") {
          requirePortal(fresh.recipientConsentRecordedAt !== null);
          return { recipientConsentRecordedAt: fresh.recipientConsentRecordedAt, operatorApprovalRecordedAt: fresh.operatorApprovalRecordedAt };
        }
        live(fresh); await check();
        if (signature === null) {
          const result = await request({ method: "eth_signTypedData_v4", params: [address, signingJson] }); active();
          requirePortal(typeof result === "string" && /^0x[0-9a-f]{130}$/i.test(result));
          const signed = result as `0x${string}`;
          const valid = await verifyTypedData({ ...fresh.signing, address, signature: signed }); active();
          if (!valid) throw new RewardPortalError("claim_wrong_wallet");
          signature = signed;
        }
        await check(); live(fresh); active();
        // A lost response retains the exact key/signature only in this closure.
        // Reload starts with the server's recorded history, never persisted keys.
        const receipt = await deps.submit(fresh, signature, idempotencyKey); active();
        return { recipientConsentRecordedAt: receipt.recordedAt, operatorApprovalRecordedAt: null };
      } finally { busy = false; }
    } };
  } catch (error) { dispose(); throw error; }
}
