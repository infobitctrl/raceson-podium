import { rewardDocumentInteger as uint, type ClaimContextV3 } from "@raceson/db/rewards";
import { requireReward } from "@raceson/domain/rewards";
import { hashPublicRewardRules } from "@raceson/rewards-chain";
import { normalizeRewardProgrammeV3 } from "@raceson/rewards-chain/programme-v3";
import { decodeRewardProgrammeUploadV3 } from "@raceson/rewards-chain/programme-lifecycle-v3";
import { rewardAllocationCommitmentV3 } from "@raceson/rewards-chain/campaign-v3";
import type { Hex } from "viem";
type ProgrammeClaimSourceV3 = Pick<ClaimContextV3,"package"|"deployment"|"stage"|"activation"> & {
  readiness:{source:ClaimContextV3["readiness"]["source"]} };
/** Pure private-source reconstruction. No organizer session or browser-selected
 * constructor/amount/domain; all inputs come from immutable authenticated SQL. */
export function programmeClaimBindingV3(c:ProgrammeClaimSourceV3,entitlementId:string,recipient:Hex) {
  requireReward(c.stage && c.activation && c.stage.body.action==="stage_allocation","reward_claim_campaign_not_ready");
  const raw=c.package as Record<string,unknown>,terms=c.deployment.terms,chainId=c.readiness.source.chainId,slot=c.readiness.source.slot-1;
  const programmeId=raw.programmeId as Hex;
  const programme=normalizeRewardProgrammeV3({context:{environment:chainId===31337?"local-simulation":"monad-testnet",chainId,verifyingContract:raw.programmeAddress as Hex},
    funderAddress:terms.funderAddress as Hex,operatorAddress:terms.operatorAddress as Hex,budgetWei:uint(raw.budgetWei)*(slot===5?2n:10n),
    deploymentNonce:c.deployment.nonce,programmeId,programmeManifestHash:raw.programmeManifestHash as Hex,
    campaignIds:Array.from({length:6},(_,slot)=>hashPublicRewardRules({kind:"raceson-programme-campaign-v3",programmeId,slot})),
    reviewPeriods:terms.reviewPeriods.map(BigInt),deploymentTransactionHash:raw.deploymentTransactionHash as Hex});
  const upload=decodeRewardProgrammeUploadV3(programme,slot,raw),publication=c.stage.body.publication;
  const commitment=rewardAllocationCommitmentV3({...upload,...publication,budget:BigInt(upload.budgetWei),awards:upload.awards.map(r=>({...r,amount:BigInt(r.amount)}))});
  const stage=c.stage.receipt,activation=c.activation.receipt;
  requireReward(stage.campaignAddress===upload.campaignAddress && activation.campaignAddress===upload.campaignAddress
    && stage.provenance.programmeAddress===upload.programmeAddress && stage.provenance.deploymentTransactionHash===upload.deploymentTransactionHash
    && stage.accountingAtReceiptBlock.allocationDigest===commitment.allocationDigest
    && activation.accountingAtReceiptBlock.allocationDigest===commitment.allocationDigest
    && stage.publicationAtReceiptBlock.reviewStartedAt===publication.reviewStartedAt
    && stage.publicationAtReceiptBlock.officialPublishedAt===publication.officialPublishedAt
    && stage.publicationAtReceiptBlock.reviewPeriod===publication.reviewPeriod
    && stage.publicationAtReceiptBlock.publicationEvidenceHash===publication.publicationEvidenceHash,"invalid_reward_claim_v3");
  return {protocolVersion:3 as const,programme,slot,upload:commitment,
    stageTransactionHash:stage.transactionHash,entitlementId:entitlementId as Hex,recipient};
}
