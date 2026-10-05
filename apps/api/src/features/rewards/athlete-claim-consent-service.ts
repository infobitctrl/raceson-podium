import { requireReward } from "@raceson/domain/rewards";
import { readRewardAthleteConsentContext, rewardDocumentUuid as uuid, type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import { readRewardCreationBytecode, readVerifiedRewardAthleteClaim, requireLiveRewardClaim, rewardClaimDigests,
  type RewardCampaignReader } from "@raceson/rewards-chain";
import { submitAthleteRewardClaimProof, verifyStoredAthleteRewardClaimProofs } from "./athlete-claim-proof-service.js";
import type { RewardPortalConfig } from "./request-identity.js";

type Dependencies = RewardPortalConfig & { rpc?: RewardLedgerRpc; reader: RewardCampaignReader; creationCode?: `0x${string}` };
type Loaded = Awaited<ReturnType<typeof verifyStoredAthleteRewardClaimProofs>>;
function summary(loaded: Loaded) {
  const { context, claim, expected } = loaded;
  return { intentId: context.intent.intentId, entitlementId: context.entitlement.id, campaignId: context.intent.campaignId,
    chainId: expected.deployment.context.chainId, verifyingContract: expected.deployment.context.verifyingContract,
    amountWei: claim.amount.toString(), pot: claim.pot, recipientAddress: claim.recipient,
    issuedAt: claim.issuedAt.toString(), expiresAt: claim.expiresAt.toString(),
    recipientConsentRecordedAt: context.proofs.find(p => p.role === "recipient")?.recordedAt ?? null,
    operatorApprovalRecordedAt: context.proofs.find(p => p.role === "operator")?.recordedAt ?? null };
}
function recorded(loaded: Loaded) {
  return { ...summary(loaded), state: "consent_recorded" as const, signing: null, observation: null };
}

/** A review of one immutable claim, not new intent preparation or send authority.
 * Recheck SQL eligibility after chain IO and never expose the private loader. */
export async function getAthleteRewardClaimConsent(identity: RewardAccountIdentity, intentId: string, deps: Dependencies) {
  const actor = { userId: uuid(identity.userId), sessionId: uuid(identity.sessionId) }, id = uuid(intentId);
  const { rpc, reader, creationCode, chainId, origin } = deps;
  const load = async () => verifyStoredAthleteRewardClaimProofs(await readRewardAthleteConsentContext(actor, id, rpc), { chainId, origin });
  let loaded = await load();
  if (loaded.context.proofs.some(p => p.role === "recipient")) return recorded(loaded);
  const digest = rewardClaimDigests(loaded.expected.deployment.context, loaded.claim).consent;
  const code = creationCode ?? await readRewardCreationBytecode(reader, loaded.expected.deployment);
  const witness = await readVerifiedRewardAthleteClaim(reader, loaded.expected, code);
  requireReward(witness.award.nonce === loaded.claim.nonce, "reward_claim_not_live");
  requireLiveRewardClaim(loaded.expected.deployment.context, loaded.claim, witness.observation.finalizedBlock.timestamp, witness.observation.accounting.claimDeadline);
  loaded = await load();
  if (loaded.context.proofs.some(p => p.role === "recipient")) return recorded(loaded);
  requireReward(rewardClaimDigests(loaded.expected.deployment.context, loaded.claim).consent === digest, "invalid_reward_claim_proof_document");
  const finalized = witness.observation.finalizedBlock;
  const original = loaded.context.intent.chainWitness.observation.finalizedBlock;
  requireReward(finalized.number >= original.number && finalized.timestamp >= original.timestamp
    && (finalized.number !== original.number || (finalized.hash === original.hash && finalized.timestamp === original.timestamp)), "reward_claim_observation_regressed");
  if (chainId === 10143) {
    const now = BigInt(Math.floor(Date.now() / 1000));
    requireReward(finalized.timestamp <= now + 5n && finalized.timestamp >= now - 120n && loaded.claim.expiresAt > now, "reward_claim_observation_stale");
  }
  const { domain, primaryType, types, message } = loaded.messages.consent;
  return { ...summary(loaded), state: "awaiting_consent" as const,
    signing: { domain: { name: domain.name, version: domain.version, chainId: domain.chainId, verifyingContract: domain.verifyingContract },
      primaryType, types: { ReceiveReward: types.ReceiveReward.map(field => ({ name: field.name, type: field.type })) },
      message: { entitlementId: message.entitlementId, recipient: message.recipient, amount: message.amount.toString(), pot: message.pot,
        nonce: message.nonce.toString(), issuedAt: message.issuedAt.toString(), expiresAt: message.expiresAt.toString(), allocationDigest: message.allocationDigest } },
    observation: { blockNumber: finalized.number.toString(), blockHash: finalized.hash, timestamp: finalized.timestamp.toString() } };
}

/** HTTP supplies only recipient signature + retry key. Never accepts an operator
 * role, amount, destination, calldata, witness or a payment instruction. */
export async function consentToAthleteRewardClaim(identity: RewardAccountIdentity, input: {
  intentId: string; signature: `0x${string}`; idempotencyKey: string;
}, deps: Dependencies) {
  return submitAthleteRewardClaimProof(identity, { intentId: input.intentId, signature: input.signature,
    idempotencyKey: input.idempotencyKey, role: "recipient" }, deps);
}
