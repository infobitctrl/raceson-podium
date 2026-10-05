import { getAddress, type Address, type Hex } from "viem";
import { clubConsentDigestV3, clubConsentSigningJsonV3, combineClubOwnerSignaturesV3,
  decodeClubConsentRecordV3, decodeClubConsentReviewV3, decodeClubConsentSelectionV3, verifyClubOwnerSignatureV3,
  type ClubConsentRecordV3, type ClubConsentReviewV3, type ClubConsentSelectionV3 } from "@raceson/rewards-chain/club-consent-v3";
import { RewardPortalError } from "../model/athleteRewards";
import { requireClaimNetwork } from "./athleteClaims";
import type { RewardWalletProvider } from "./browserWallet";
import { getClubConsentReviewV3, submitClubConsentV3 } from "./clubConsentV3";

type Dependencies = {
  read: (selection: ClubConsentSelectionV3) => Promise<unknown>;
  submit: (selection: ClubConsentSelectionV3, signature: Hex) => Promise<unknown>;
};
export type ClubConsentProgressV3 = { recipientConsented: boolean; operatorApproved: boolean; signaturesCollected: number; required: 2; signedBy: Address[] };

/** In-memory, explicit two-wallet consent. This factory makes no wallet/API
 * request. UI must show the selected award and acknowledged signer address
 * before calling collect(). submit() records consent, never sends MON. */
export function createBrowserClubConsentV3(selection: ClubConsentSelectionV3, initial: unknown,
  signal: AbortSignal, isCurrent: () => boolean, onChanged: () => void,
  deps: Dependencies = { read: getClubConsentReviewV3, submit: submitClubConsentV3 }) {
  const fixed = Object.freeze(decodeClubConsentSelectionV3(selection));
  const original = decodeClubConsentReviewV3(initial, fixed);
  const digest = original.status === "signature_required" ? clubConsentDigestV3(original) : null;
  const signingJson = original.status === "signature_required" ? clubConsentSigningJsonV3(original) : null;
  const signatures = new Map<Address, Hex>();
  let recorded: ClubConsentRecordV3 | null = original.status === "already_recorded" ? original : null;
  let observed = original.status === "signature_required" ? original.observation : null;
  let busy = false, disposed = false, detach: (() => void) | null = null;
  function dispose() {
    if (disposed) return;
    disposed = true; signatures.clear(); detach?.(); detach = null;
    signal.removeEventListener("abort", dispose);
  }
  function invalidate() { if (!disposed) { dispose(); try { onChanged(); } catch { /* State is already closed. */ } } }
  function active() {
    if (disposed || signal.aborted || !isCurrent()) { invalidate(); throw new RewardPortalError("wallet_changed"); }
    try { requireClaimNetwork(fixed.chainId); } catch (e) { invalidate(); throw e; }
  }
  function progress(): ClubConsentProgressV3 {
    active(); return { recipientConsented: recorded !== null, operatorApproved: recorded?.operatorApproved ?? false,
      signaturesCollected: signatures.size, required: 2, signedBy: [...signatures.keys()] };
  }
  function sameRecord(r: ClubConsentRecordV3) {
    if (r.issuedAt !== original.issuedAt || r.expiresAt !== original.expiresAt) {
      invalidate(); throw new RewardPortalError("claim_refresh_required");
    }
  }
  function timely(review: Extract<ClubConsentReviewV3, { status: "signature_required" }>) {
    if (fixed.chainId !== 10143) return;
    const now = BigInt(Math.floor(Date.now() / 1000)), timestamp = BigInt(review.observation.timestamp);
    if (now < BigInt(original.issuedAt) || now >= BigInt(original.expiresAt)) throw new RewardPortalError("claim_expired");
    if (timestamp < now - 120n || timestamp > now + 5n) throw new RewardPortalError("claim_refresh_required");
  }
  async function refresh() {
    active(); const raw = await deps.read(fixed); active();
    let fresh: ClubConsentReviewV3;
    try { fresh = decodeClubConsentReviewV3(raw, fixed); } catch (e) { invalidate(); throw e; }
    sameRecord(fresh);
    if (fresh.status === "already_recorded") { recorded = fresh; signatures.clear(); return fresh; }
    if (recorded || clubConsentDigestV3(fresh) !== digest || observed && (BigInt(fresh.observation.blockNumber) < BigInt(observed.blockNumber)
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
      if (e && typeof e === "object" && "status" in e && [401, 403, 404].includes(Number(e.status))) invalidate();
      throw e;
    } finally { busy = false; }
  }
  active(); signal.addEventListener("abort", dispose, { once: true });
  return {
    dispose, progress,
    collect: (provider: RewardWalletProvider, acknowledgedSigner: Address) => exclusively(async () => {
      const fresh = await refresh(); if (fresh.status === "already_recorded") return progress();
      const signer = getAddress(acknowledgedSigner).toLowerCase() as Address;
      if (signatures.has(signer)) throw new RewardPortalError("club_duplicate_signer");
      if (signatures.size >= 2) throw new RewardPortalError("club_quorum_collected");
      const request = provider.request.bind(provider), attached: [string, (...args: unknown[]) => void][] = [];
      const accountsMatch = (value: unknown) => Array.isArray(value) && typeof value[0] === "string" && value[0].toLowerCase() === signer;
      const changedAccounts = (value: unknown) => { if (!accountsMatch(value)) invalidate(); };
      const cleanup = () => { for (const [event, callback] of attached) { try { provider.removeListener(event, callback); } catch { /* Untrusted provider. */ } } attached.length = 0; };
      detach = cleanup;
      async function checkWallet() {
        active(); const accounts = await request({ method: "eth_accounts" }); active();
        if (!accountsMatch(accounts)) { invalidate(); throw new RewardPortalError("claim_wrong_wallet"); }
        const chain = await request({ method: "eth_chainId" }); active();
        if (typeof chain !== "string" || !/^0x[0-9a-f]{1,16}$/i.test(chain) || BigInt(chain) !== BigInt(fixed.chainId))
          throw new RewardPortalError(fixed.chainId === 31337 ? "wrong_local_network" : "wrong_network");
      }
      try {
        for (const [event, callback] of [["accountsChanged", changedAccounts], ["chainChanged", invalidate], ["disconnect", invalidate]] as const) {
          attached.push([event, callback]); provider.on(event, callback); active();
        }
        const accounts = await request({ method: "eth_requestAccounts" }); active();
        if (!accountsMatch(accounts)) throw new RewardPortalError("claim_wrong_wallet");
        await checkWallet();
        const beforePrompt = await refresh(); if (beforePrompt.status === "already_recorded") return progress();
        await checkWallet(); timely(beforePrompt); active();
        const result = await request({ method: "eth_signTypedData_v4", params: [signer, signingJson] }); active();
        const signature = await verifyClubOwnerSignatureV3(fresh.typedData, signer, result); active();
        await checkWallet();
        const latest = await refresh(); if (latest.status === "already_recorded") return progress();
        signatures.set(signer, signature); return progress();
      } finally { cleanup(); if (detach === cleanup) detach = null; }
    }),
    submit: () => exclusively(async () => {
      const fresh = await refresh(); if (fresh.status === "already_recorded") return progress();
      if (signatures.size !== 2) throw new RewardPortalError("club_quorum_required");
      const signature = await combineClubOwnerSignaturesV3(fresh.typedData, [...signatures].map(([signer, proof]) => ({ signer, signature: proof }))); active();
      const latest = await refresh(); if (latest.status === "already_recorded") return progress();
      // A lost response retains exactly these bytes only in memory. Explicit
      // retry first reads persisted consent; no third wallet prompt or send.
      const raw = await deps.submit(fixed, signature); active();
      let receipt: ClubConsentRecordV3;
      try { receipt = decodeClubConsentRecordV3(raw, fixed); } catch (e) { invalidate(); throw e; }
      sameRecord(receipt);
      if (!receipt.recipientConsented) throw new RewardPortalError("invalid_response");
      recorded = receipt; signatures.clear(); return progress();
    }),
  };
}
