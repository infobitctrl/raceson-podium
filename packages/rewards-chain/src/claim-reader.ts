import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import type { RewardCampaignReader } from "./campaign-checkpoint.js";
import { normalizeRewardClaimExpectation, readRewardClaimAward, type RewardClaimExpectation } from "./claim-observation.js";
import { rewardClaimDigests, rewardClaimMessages, type RewardClaim } from "./claims.js";
import { demand, RewardProtocolError, walletAddress, type RewardChainContext } from "./validation.js";

export type RewardAthleteClaimExpectation = RewardClaimExpectation;

/** Stored award/package only. Recompute the complete commitment before trusting
 * its one selected athlete row; never construct this from browser amounts. */
export function normalizeRewardAthleteClaimExpectation(input: RewardAthleteClaimExpectation) {
  return normalizeRewardClaimExpectation(input, 0);
}

/** Read-only trusted-worker observation. Exact deployed code, full active package,
 * one unpaid athlete award/nonce and both EOA code checks use the SAME finalized
 * block. This is not identity approval, consent, a lease or permission to send. */
export async function readVerifiedRewardAthleteClaim(reader: RewardCampaignReader, input: RewardAthleteClaimExpectation, creationCode: Hex) {
  const expected = normalizeRewardAthleteClaimExpectation(input);
  return readRewardClaimAward(reader, expected, creationCode);
}

/** EOA-only cryptographic check. Exact messages, no provider/identity inference.
 * Fresh code/state/session/source checks still belong to approval and execution. */
export async function verifyRewardClaimEoaProof(context: RewardChainContext, claim: RewardClaim,
  role: "operator" | "recipient", operator: Address, signature: Hex) {
  demand(role === "operator" || role === "recipient", "invalid_reward_claim_proof_role");
  const messages = rewardClaimMessages(context, claim); const digests = rewardClaimDigests(context, claim);
  const signer = walletAddress(role === "operator" ? operator : claim.recipient);
  demand(typeof signature === "string" && /^0x[0-9a-fA-F]{130}$/.test(signature), "invalid_reward_claim_signature");
  const normalized = signature.toLowerCase() as Hex;
  const s = BigInt(`0x${normalized.slice(66,130)}`);
  demand(s > 0n && s <= 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n
    && ["1b","1c"].includes(normalized.slice(130)), "invalid_reward_claim_signature");
  let recovered: Address;
  try { recovered = role === "operator"
    ? await recoverTypedDataAddress({ ...messages.authorization, signature: normalized })
    : await recoverTypedDataAddress({ ...messages.consent, signature: normalized }); }
  catch { throw new RewardProtocolError("invalid_reward_claim_signature"); }
  demand(recovered.toLowerCase() === signer.toLowerCase(), "reward_claim_signature_mismatch");
  return { role, signer: signer.toLowerCase() as Address, digest: role === "operator" ? digests.authorization : digests.consent,
    signature: normalized };
}
