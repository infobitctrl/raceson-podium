import {encodeFunctionData, parseAbi, type Hex} from "viem";
import {observeSponsorProgrammePot, type SponsorChainReader} from "./sponsor-v4.js";
import {sponsorAllocationCommitmentV4} from "./sponsor-claims-v4.js";
import {rewardUploadDigest, type RewardPublicAward} from "./allocation.js";
import type {SponsorExecutionPlan} from "@raceson/domain/rewards/sponsor-execution";

export const sponsorLifecycleAbi = parseAbi([
 "function uploadAwards((bytes32 entitlementId,bytes32 beneficiaryId,uint8 pot,uint256 amount,bytes32 explanationHash,uint8 beneficiaryKind)[] awards)",
 "function stageAllocation(bytes32 snapshotDigest,bytes32 uploadDigest,uint256 count,uint64 reviewStartedAt,uint64 officialPublishedAt,bytes32 publicationEvidenceHash)",
 "function activate(bytes32 allocationDigest,bytes32 snapshotDigest)",
 "function uploadDigest() view returns(bytes32)", "function allocationDigest() view returns(bytes32)",
 "function snapshotDigest() view returns(bytes32)",
]);
export type SponsorPublicationV4 = {reviewPeriod: string; reviewStartedAt: string; officialPublishedAt: string; publicationEvidenceHash: Hex};
export type SponsorLifecycleInputV4 = {plan: SponsorExecutionPlan; slot: number; deploymentHash: Hex; fundingHash: Hex;
 campaignAddress: Hex; snapshotDigest: Hex; awards: RewardPublicAward[]; publication: SponsorPublicationV4};
// Keep normal uploads below the controller gas ceiling at testnet fees.
// The deployed V4 contract accepts at most 64; older valid batches remain decodable.
const uploadBatchSize = 32;
export type SponsorLifecycleActionV4 = "upload" | "stage" | "activate";
function check(v: unknown): asserts v {if (!v) throw Error("reward_sponsor_lifecycle_not_ready");}
export function sponsorLifecycleCommitmentV4(i: SponsorLifecycleInputV4) {
 return sponsorAllocationCommitmentV4(i.plan,i.slot,{...i.publication,reviewPeriod:BigInt(i.publication.reviewPeriod),
  reviewStartedAt:BigInt(i.publication.reviewStartedAt),officialPublishedAt:BigInt(i.publication.officialPublishedAt),snapshotDigest:i.snapshotDigest,awards:i.awards});
}
export function sponsorLifecycleDataV4(i: SponsorLifecycleInputV4, action: SponsorLifecycleActionV4, start = 0, end = i.awards.length): Hex {
 const c=sponsorLifecycleCommitmentV4(i);
 if(action==="upload") {check(Number.isInteger(start)&&Number.isInteger(end)&&start>=0&&end>start&&end<=i.awards.length&&end-start<=64);
  return encodeFunctionData({abi:sponsorLifecycleAbi,functionName:"uploadAwards",args:[i.awards.slice(start,end)]});}
 if(action==="stage") return encodeFunctionData({abi:sponsorLifecycleAbi,functionName:"stageAllocation",args:[c.snapshotDigest,c.uploadDigest,c.entitlementCount,c.reviewStartedAt,c.officialPublishedAt,c.publicationEvidenceHash]});
 check(action==="activate");return encodeFunctionData({abi:sponsorLifecycleAbi,functionName:"activate",args:[c.allocationDigest,c.snapshotDigest]});
}
/** Current finalized state is authoritative, including recovery after a lost receipt. */
export async function observeSponsorLifecycleV4(reader:SponsorChainReader,input:SponsorLifecycleInputV4) {
 const i={...input,plan:{...input.plan},awards:input.awards.map(a=>({...a})),publication:{...input.publication}},c=sponsorLifecycleCommitmentV4(i);
 const o=await observeSponsorProgrammePot(reader,i.plan,i.deploymentHash,i.fundingHash,i.slot),pot=o.pots.find(p=>p.slot===i.slot);
 check(o.funded&&!o.cancelled&&pot&&pot.address===i.campaignAddress.toLowerCase());
 const args={address:i.campaignAddress,abi:sponsorLifecycleAbi,blockNumber:BigInt(o.blockNumber)};
 const [upload,digest,snapshot]=await Promise.all([reader.readContract({...args,functionName:"uploadDigest"}),reader.readContract({...args,functionName:"allocationDigest"}),reader.readContract({...args,functionName:"snapshotDigest"})]);
 const count=Number(pot.entitlementCount);check(Number.isSafeInteger(count)&&count>=0&&count<=i.awards.length);
 // An empty upload starts at zero, whereas nonempty prefixes use the contract rolling hash.
 const prefix=count?rewardUploadDigest(i.awards.slice(0,count),i.slot===0?1:0,BigInt(i.plan.caps[i.slot]!)):null;
 check(upload===(prefix?.digest??`0x${"0".repeat(64)}`)&&BigInt(pot.allocatedWei)===(prefix?.total??0n));
 if(pot.state>=2&&pot.state<=4)check(count===i.awards.length&&digest===c.allocationDigest&&snapshot===c.snapshotDigest);
 const block=await reader.getBlock({blockNumber:BigInt(o.blockNumber)});
 check(block.hash===o.blockHash&&block.timestamp.toString()===o.blockTimestamp&&await reader.getChainId()===i.plan.chainId);
 const next: SponsorLifecycleActionV4|null=pot.paused?null:pot.state===1?(count<i.awards.length?"upload":"stage"):pot.state===2?"activate":null;
 check(!next||BigInt(o.blockTimestamp)>=c.officialPublishedAt);
 return{observation:o,pot,allocationDigest:c.allocationDigest,next,start:count,end:Math.min(count+uploadBatchSize,i.awards.length)};
}
/** Verify exact wallet transaction at a canonical finalized receipt, not a browser assertion. */
export async function verifySponsorActionReceiptV4(reader:SponsorChainReader,i:SponsorLifecycleInputV4,
 expected:{action:SponsorLifecycleActionV4;start:number;end:number},hash:Hex) {
 const state=await observeSponsorLifecycleV4(reader,i);
 const [tx,r]=await Promise.all([reader.getTransaction({hash}),reader.getTransactionReceipt({hash})]);
 const data=sponsorLifecycleDataV4(i,expected.action,expected.start,expected.end);
 check(tx.hash===hash&&r.transactionHash===hash&&tx.chainId===i.plan.chainId&&tx.from.toLowerCase()===i.plan.operator
  &&r.from.toLowerCase()===i.plan.operator&&tx.to?.toLowerCase()===i.campaignAddress&&r.to?.toLowerCase()===i.campaignAddress
  &&tx.value===0n&&tx.input===data&&r.status==="success"&&tx.blockHash===r.blockHash&&tx.blockNumber===r.blockNumber
  &&tx.transactionIndex===r.transactionIndex&&r.blockNumber<=BigInt(state.observation.blockNumber));
 const b=await reader.getBlock({blockNumber:r.blockNumber});check(b.hash===r.blockHash);
 check(expected.action==="upload"?Number(state.pot.entitlementCount)>=expected.end:expected.action==="stage"?[2,3,4].includes(state.pot.state):[3,4].includes(state.pot.state));
 const again=await reader.getBlock({blockNumber:BigInt(state.observation.blockNumber)});check(again.hash===state.observation.blockHash);
 return{action:expected.action,start:expected.start,end:expected.end,transactionHash:hash,blockNumber:r.blockNumber.toString(),blockHash:r.blockHash,
  blockTimestamp:b.timestamp.toString(),allocationDigest:state.allocationDigest,campaignAddress:i.campaignAddress};
}
