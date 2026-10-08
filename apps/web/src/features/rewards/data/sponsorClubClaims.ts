import {z} from "zod";
import {apiRequest} from "@/lib/api";
import {publicEnv} from "@/lib/public-env";
import {sponsorClaimSchema} from "./sponsorProgramme";
const uuid=z.string().uuid(),address=z.string().regex(/^0x[0-9a-f]{40}$/),hex=z.string().regex(/^0x[0-9a-f]{64}$/),wei=z.string().regex(/^(0|[1-9][0-9]*)$/);
const candidate=z.object({safeAddress:address,singletonAddress:address,fallbackHandlerAddress:address,owners:z.array(address).length(3)});
export const sponsorClubClaimSchema=sponsorClaimSchema.extend({schema:z.literal("raceson-sponsor-club-claim-view-v4"),owners:z.array(address).length(3),candidate});
export const sponsorClubAwardSchema=z.object({approvalId:uuid,slot:z.number().int().min(0).max(5),entitlementId:hex,amountWei:wei,clubId:uuid.nullable(),protocolVersion:z.union([z.literal(5),z.literal(6)]).optional(),directClaim:z.object({paid:z.boolean()}).strict().optional(),claims:z.array(z.object({id:uuid,prepared:z.boolean(),consented:z.boolean(),approved:z.boolean(),paid:z.boolean()}))});
const awards=z.array(sponsorClubAwardSchema);
export type SponsorClubClaim=z.infer<typeof sponsorClubClaimSchema>;
export type SponsorClubAward=z.infer<typeof awards>[number];
function enabled(){if(!publicEnv.rewardDemo||!publicEnv.rewardPortalEnabled)throw Error("rewards_disabled");}
export async function sponsorClubAwards(role:"recipient"|"operator",approvalId?:string){enabled();return awards.parse(await apiRequest({path:`/v1/${role==="recipient"?"athlete":"organizer"}/rewards/sponsor-club-claims${approvalId?`?approvalId=${uuid.parse(approvalId)}`:""}`,cache:"no-store"}));}
export async function sponsorClubClaim(role:"recipient"|"operator",id:string,body?:unknown){enabled();const v=sponsorClubClaimSchema.parse(await apiRequest({path:`/v1/${role==="recipient"?"athlete":"organizer"}/rewards/sponsor-club-claims/${uuid.parse(id)}`,cache:"no-store",...(body?{method:"POST" as const,body}:{})}));
 if(v.claimId!==id||v.role!==role||v.chainId!==publicEnv.rewardDemo?.chainId||v.address!==v.candidate.safeAddress||v.owners.join()!==v.candidate.owners.join())throw Error("invalid_claim");return v;}
