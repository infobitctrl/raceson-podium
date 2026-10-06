import {sponsorAwardSchema} from './sponsorAwardCodec';
export {sponsorAwardSchema} from './sponsorAwardCodec';
import {resultDisplaySchema} from "./resultDisplay";
import {lifecycleSchema as lifecycle,sponsorTransactionSchema as tx} from "./sponsorLifecycleCodec";
export {decodeSponsorLifecycleView} from "./sponsorLifecycleCodec";
import {apiRequest} from "@/lib/api";
import {publicEnv} from "@/lib/public-env";
import {z} from "zod";
const uuid=z.string().uuid(),hash=z.string().regex(/^[0-9a-f]{64}$/),hex=z.string().regex(/^0x[0-9a-f]+$/),wei=z.string().regex(/^(0|[1-9][0-9]*)$/);
const approval=z.object({id:uuid,documentHash:hash,contextHash:hash,decision:z.enum(["approved","held"]),current:z.boolean()});
const review=z.object({schema:z.literal("raceson-sponsor-allocation-review-v4"),setupId:uuid,slot:z.number().int().min(0).max(5),contextHash:hash,documentHash:hash,
 results:resultDisplaySchema.optional(),
 sourceReview:z.object({draftId:uuid,contextHash:hash.optional(),name:z.string(),status:z.enum(["unreviewed","stale","held","confirmed"])}).nullable().optional(),
 reasons:z.array(z.string()),budgetWei:wei,proposedWei:wei,retainedWei:wei,recipients:z.array(z.object({position:z.number().int().positive(),beneficiaryKind:z.enum(["athlete","club"]),amountWei:wei})),recipientCounts:z.object({athletes:z.number(),clubs:z.number()}),approval:approval.nullable()});
const upload=z.object({schema:z.literal("raceson-sponsor-upload-view-v4"),approvalId:uuid,slot:z.number(),contextHash:hash,documentHash:hash,current:z.boolean(),prepared:z.object({id:uuid,packageHash:hash,preparedAt:z.string()}).nullable()});
export type SponsorReview= z.infer<typeof review>;export type SponsorUpload=z.infer<typeof upload>;export type SponsorLifecycle=z.infer<typeof lifecycle>;
function enabled(){if(!publicEnv.rewardDemo||!publicEnv.rewardPortalEnabled)throw Error("rewards_disabled");}
export async function programmeRequest(setupId:string,slot:number,step:"review"|"upload"|"lifecycle"|"handoff",approvalId?:string,body?:unknown){
 enabled();uuid.parse(setupId);if(!Number.isInteger(slot)||slot<0||slot>5)throw Error("invalid_slot");
 const path=`/v1/organizer/rewards/sponsor-setups/${setupId}/allocations/${slot}${step==="review"?"":`/${uuid.parse(approvalId)}/${step}`}`;
 const v=await apiRequest({path,cache:"no-store",...(body?{method:"POST" as const,body}:{})});
 return step==="review"?review.parse(v):step==="upload"?upload.parse(v):lifecycle.parse(v);
}
export const sponsorClaimSchema=z.object({schema:z.literal("raceson-sponsor-claim-view-v4"),claimId:uuid,approvalId:uuid,chainId:z.union([z.literal(31337),z.literal(10143)]),role:z.enum(["recipient","operator"]),current:z.boolean(),status:z.enum(["awaiting_review","held","paid","ready_to_pay","awaiting_operator","awaiting_consent"]),sourceStamp:hash,profileFingerprint:hash,operatorAddress:z.string().regex(/^0x[0-9a-f]{40}$/),address:z.string(),
 claim:z.object({entitlementId:hex,recipient:z.string(),amount:wei,pot:z.enum(["race","league"]),nonce:wei,issuedAt:wei,expiresAt:wei,allocationDigest:hex}).nullable(),
 context:z.object({environment:z.enum(["local-simulation","monad-testnet"]),chainId:z.union([z.literal(31337),z.literal(10143)]),verifyingContract:z.string()}).nullable(),
 signing:z.unknown().nullable(),transaction:tx.nullable(),receipt:z.object({transactionHash:hex,amountWei:wei,recipient:z.string(),blockNumber:wei,blockHash:hex}).nullable()});
export type SponsorClaim=z.infer<typeof sponsorClaimSchema>;

const awards=z.array(sponsorAwardSchema);
export type SponsorAward=z.infer<typeof awards>[number];
export async function sponsorAwards(role:"recipient"|"operator",approvalId?:string){enabled();return awards.parse(await apiRequest({path:`/v1/${role==="recipient"?"athlete":"organizer"}/rewards/sponsor-claims${approvalId?`?approvalId=${uuid.parse(approvalId)}`:""}`,cache:"no-store"}));}
export async function sponsorClaim(role:"recipient"|"operator",id:string,body?:unknown){enabled();const v=sponsorClaimSchema.parse(await apiRequest({path:`/v1/${role==="recipient"?"athlete":"organizer"}/rewards/sponsor-claims/${uuid.parse(id)}`,cache:"no-store",...(body?{method:"POST" as const,body}:{})}));if(v.claimId!==id||v.role!==role||v.chainId!==publicEnv.rewardDemo?.chainId)throw Error("invalid_claim");return v;}
