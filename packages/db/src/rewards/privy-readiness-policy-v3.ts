import { decodeRewardReadinessAttestation } from "./athlete-readiness.js";
import { RewardLedgerStoreError } from "./programme-ledger.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid } from "./stored-documents.js";

export const privyTestnetReadinessPolicy = "operator-observed-privy-testnet-no-mfa-v1" as const;
export const privyTestnetReadinessAppId = "cmtx921we00fu0cifaab7exez" as const;
export const privySyntheticReadinessPolicy = "operator-observed-privy-synthetic-test-v1" as const;
export const privySyntheticDraftId = "9a000000-0000-4000-8000-000000000052" as const;
export const privySyntheticProfileId = "9a000000-0000-4000-8000-000000001060" as const;
export const privySecondSyntheticReadinessPolicy = "operator-observed-privy-synthetic-test-v2" as const;
export const privySecondSyntheticProfileId = "9a000000-0000-4000-8000-000000001061" as const;

/** Owner-approved isolated V3 exception. Evidence references are private operator
 * attestations, never generated proof or a claim that MFA is enabled. V1 stays
 * on its original strict decoder. This policy has no mainnet/local-chain form. */
export function decodeRewardReadinessAttestationV3(value: unknown) {
  const policy = value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, "policy")?.value : null;
  if (policy === privySyntheticReadinessPolicy || policy === privySecondSyntheticReadinessPolicy) {
    const profileId = policy === privySyntheticReadinessPolicy ? privySyntheticProfileId : privySecondSyntheticProfileId;
    const a = object(value, ["schemaVersion", "policy", "chainId", "privyAppId", "draftId", "athleteProfileId",
      "syntheticIdentityEvidenceRef", "walletProviderEvidenceRef", "walletRecoveryEvidenceRef"]);
    if (a.schemaVersion !== 3 || a.chainId !== 10143 || a.privyAppId !== privyTestnetReadinessAppId
      || a.draftId !== privySyntheticDraftId || a.athleteProfileId !== profileId)
      throw new RewardLedgerStoreError("invalid_reward_readiness_review");
    // Deliberately has no DOB/adult/MFA attestation. This is a synthetic test
    // identity, not a verification exception for real athletes or unclaimed IDs.
    return { schemaVersion: 3 as const, policy, chainId: 10143 as const,
      privyAppId: privyTestnetReadinessAppId, draftId: privySyntheticDraftId, athleteProfileId: profileId,
      syntheticIdentityEvidenceRef: uuid(a.syntheticIdentityEvidenceRef),
      walletProviderEvidenceRef: uuid(a.walletProviderEvidenceRef), walletRecoveryEvidenceRef: uuid(a.walletRecoveryEvidenceRef) };
  }
  if (policy !== privyTestnetReadinessPolicy) return decodeRewardReadinessAttestation(value);
  const a = object(value, ["schemaVersion", "policy", "chainId", "privyAppId", "verifiedDateOfBirth",
    "identityEvidenceRef", "adultEvidenceRef", "walletProviderEvidenceRef", "walletRecoveryEvidenceRef"]);
  if (a.schemaVersion !== 2 || a.chainId !== 10143 || a.privyAppId !== privyTestnetReadinessAppId
    || typeof a.verifiedDateOfBirth !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(a.verifiedDateOfBirth))
    throw new RewardLedgerStoreError("invalid_reward_readiness_review");
  const date = new Date(`${a.verifiedDateOfBirth}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== a.verifiedDateOfBirth)
    throw new RewardLedgerStoreError("invalid_reward_readiness_review");
  return { schemaVersion: 2 as const, policy: privyTestnetReadinessPolicy, chainId: 10143 as const,
    privyAppId: privyTestnetReadinessAppId, verifiedDateOfBirth: a.verifiedDateOfBirth,
    identityEvidenceRef: uuid(a.identityEvidenceRef), adultEvidenceRef: uuid(a.adultEvidenceRef),
    walletProviderEvidenceRef: uuid(a.walletProviderEvidenceRef), walletRecoveryEvidenceRef: uuid(a.walletRecoveryEvidenceRef) };
}

export function requireReadinessPolicyChainV3(attestation: ReturnType<typeof decodeRewardReadinessAttestationV3>, chainId: number) {
  if (attestation.schemaVersion !== 1 && chainId !== 10143) throw new RewardLedgerStoreError("invalid_reward_readiness_review");
}
