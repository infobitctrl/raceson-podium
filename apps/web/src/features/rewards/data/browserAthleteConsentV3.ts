import type { Hex } from "viem";
import { athleteConsentDigestV3, athleteConsentSigningJsonV3, decodeAthleteConsentRecordV3,
  decodeAthleteConsentReviewV3, decodeAthleteConsentSelectionV3, verifyAthleteConsentSignatureV3,
  type AthleteConsentRecordV3, type AthleteConsentReviewV3, type AthleteConsentSelectionV3 } from "@raceson/rewards-chain/athlete-consent-v3";
import { RewardPortalError } from "../model/athleteRewards";
import { requireClaimNetwork } from "./athleteClaims";
import type { RewardWalletProvider } from "./browserWallet";
import { getAthleteConsentReviewV3, submitAthleteConsentV3 } from "./athleteConsentV3";

type Dependencies = {
  read: (selection: AthleteConsentSelectionV3) => Promise<unknown>;
  submit: (selection: AthleteConsentSelectionV3, signature: Hex) => Promise<unknown>;
};
export type AthleteConsentProgressV3 = { recipientConsented: boolean; operatorApproved: boolean; signatureCollected: boolean };

/** No IO at construction. UI displays the exact selected award/destination
 * before explicit collect(), then submit() records consent, never sends MON.
 * isCurrent binds the demo, Auth session, selection and mounted-flow epoch. */
export function createBrowserAthleteConsentV3(selection: AthleteConsentSelectionV3, initial: unknown,
  signal: AbortSignal, isCurrent: () => boolean, onChanged: () => void,
  deps: Dependencies = { read: getAthleteConsentReviewV3, submit: submitAthleteConsentV3 }) {
  const fixed = Object.freeze(decodeAthleteConsentSelectionV3(selection));
  const original = decodeAthleteConsentReviewV3(initial, fixed);
  const digest = original.status === "signature_required" ? athleteConsentDigestV3(original) : null;
  const signingJson = original.status === "signature_required" ? athleteConsentSigningJsonV3(original) : null;
  let signature: Hex | null = null;
  let recorded: AthleteConsentRecordV3 | null = original.status === "already_recorded" ? original : null;
  let observed = original.status === "signature_required" ? original.observation : null;
  let busy = false, disposed = false, detach: (() => void) | null = null;
  function dispose() {
    if (disposed) return;
    disposed = true; signature = null; detach?.(); detach = null;
    signal.removeEventListener("abort", dispose);
  }
  function invalidate() { if (!disposed) { dispose(); try { onChanged(); } catch { /* Already closed. */ } } }
  function active() {
    if (disposed || signal.aborted || !isCurrent()) { invalidate(); throw new RewardPortalError("wallet_changed"); }
    try { requireClaimNetwork(fixed.chainId); } catch (e) { invalidate(); throw e; }
  }
  function progress(): AthleteConsentProgressV3 {
    active(); return { recipientConsented: recorded !== null, operatorApproved: recorded?.operatorApproved ?? false, signatureCollected: signature !== null };
  }
  function sameRecord(r: AthleteConsentRecordV3) {
    if (r.issuedAt !== original.issuedAt || r.expiresAt !== original.expiresAt) {
      invalidate(); throw new RewardPortalError("claim_refresh_required");
    }
  }
  function timely(review: Extract<AthleteConsentReviewV3, { status: "signature_required" }>) {
    if (fixed.chainId !== 10143) return;
    const now = BigInt(Math.floor(Date.now() / 1000)), timestamp = BigInt(review.observation.timestamp);
    if (now < BigInt(original.issuedAt) || now >= BigInt(original.expiresAt)) {
      invalidate(); throw new RewardPortalError("claim_expired");
    }
    if (timestamp < now - 120n || timestamp > now + 5n) {
      invalidate(); throw new RewardPortalError("claim_refresh_required");
    }
  }
  async function refresh() {
    active(); const raw = await deps.read(fixed); active();
    let fresh: AthleteConsentReviewV3;
    try { fresh = decodeAthleteConsentReviewV3(raw, fixed); } catch (e) { invalidate(); throw e; }
    sameRecord(fresh);
    if (fresh.status === "already_recorded") { recorded = fresh; signature = null; return fresh; }
    if (recorded || athleteConsentDigestV3(fresh) !== digest || observed && (BigInt(fresh.observation.blockNumber) < BigInt(observed.blockNumber)
      || BigInt(fresh.observation.timestamp) < BigInt(observed.timestamp)
      || fresh.observation.blockNumber === observed.blockNumber && fresh.observation.blockHash !== observed.blockHash)) {
      invalidate(); throw new RewardPortalError("claim_refresh_required");
    }
    timely(fresh); observed = fresh.observation; return fresh;
  }
  async function exclusively<T>(work: () => Promise<T>): Promise<T> {
    active(); if (busy) throw new RewardPortalError("request_pending"); busy = true;
    try { return await work(); }
    catch (e) {
      // A scope/session denial or claim hold retires this flow. An uncertain
      // network response may be retried explicitly using the same signed bytes.
      if (e && typeof e === "object" && "status" in e && [401, 403, 404, 409].includes(Number(e.status))) invalidate();
      throw e;
    } finally { busy = false; }
  }
  active(); signal.addEventListener("abort", dispose, { once: true });
  return {
    dispose, progress,
    collect: (provider: RewardWalletProvider) => exclusively(async () => {
      const fresh = await refresh(); if (fresh.status === "already_recorded" || signature) return progress();
      const request = provider.request.bind(provider), attached: [string, (...args: unknown[]) => void][] = [];
      const accountsMatch = (value: unknown) => Array.isArray(value) && typeof value[0] === "string" && value[0].toLowerCase() === fixed.recipientAddress;
      const changedAccounts = (value: unknown) => { if (!accountsMatch(value)) invalidate(); };
      const cleanup = () => { for (const [event, callback] of attached) { try { provider.removeListener(event, callback); } catch { /* Untrusted provider. */ } } attached.length = 0; };
      detach = cleanup;
      async function checkWallet() {
        active(); const accounts = await request({ method: "eth_accounts" }); active();
        if (!accountsMatch(accounts)) { invalidate(); throw new RewardPortalError("claim_wrong_wallet"); }
        const chain = await request({ method: "eth_chainId" }); active();
        if (typeof chain !== "string" || !/^0x[0-9a-f]{1,16}$/i.test(chain) || BigInt(chain) !== BigInt(fixed.chainId)) {
          invalidate(); throw new RewardPortalError(fixed.chainId === 31337 ? "wrong_local_network" : "wrong_network");
        }
      }
      try {
        for (const [event, callback] of [["accountsChanged", changedAccounts], ["chainChanged", invalidate], ["disconnect", invalidate]] as const) {
          attached.push([event, callback]); provider.on(event, callback); active();
        }
        const accounts = await request({ method: "eth_requestAccounts" }); active();
        if (!accountsMatch(accounts)) { invalidate(); throw new RewardPortalError("claim_wrong_wallet"); }
        await checkWallet();
        const beforePrompt = await refresh(); if (beforePrompt.status === "already_recorded") return progress();
        await checkWallet(); timely(beforePrompt); active();
        const result = await request({ method: "eth_signTypedData_v4", params: [fixed.recipientAddress, signingJson] }); active();
        if (typeof result !== "string") throw new RewardPortalError("invalid_response");
        const proof = await verifyAthleteConsentSignatureV3(fresh, result as Hex); active();
        await checkWallet();
        const latest = await refresh(); if (latest.status === "already_recorded") return progress();
        signature = proof; return progress();
      } finally { cleanup(); if (detach === cleanup) detach = null; }
    }),
    submit: () => exclusively(async () => {
      const fresh = await refresh(); if (fresh.status === "already_recorded") return progress();
      if (!signature) throw new RewardPortalError("claim_recipient_consent_required");
      // Explicit retry reads persisted consent first. Never a second automatic
      // wallet prompt, localStorage write or transaction submission.
      const raw = await deps.submit(fixed, signature); active();
      let receipt: AthleteConsentRecordV3;
      try { receipt = decodeAthleteConsentRecordV3(raw, fixed); } catch (e) { invalidate(); throw e; }
      sameRecord(receipt);
      if (!receipt.recipientConsented) { invalidate(); throw new RewardPortalError("invalid_response"); }
      recorded = receipt; signature = null; return progress();
    }),
  };
}
