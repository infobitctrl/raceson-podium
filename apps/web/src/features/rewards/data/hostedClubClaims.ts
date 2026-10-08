import {z} from 'zod';
import {apiRequest} from '@/lib/api';
import {publicEnv} from '@/lib/public-env';
import {sponsorClubAwardSchema,sponsorClubClaimSchema,type SponsorClubClaim} from './sponsorClubClaims';
import {decodeHostedClaimQueue} from './hostedClaimReviews';
const uuid=z.string().uuid(),cursor=z.string().regex(/^0x[0-9a-f]{64}$/);
const page=z.object({items:z.array(sponsorClubAwardSchema.extend({clubId:uuid}).strict()).max(50),nextCursor:cursor.nullable()}).strict();
function enabled(){if(!publicEnv.rewardPortalEnabled||!publicEnv.hostedOperations)throw Error('rewards_disabled');}
export async function getHostedClubAwards(after:string|null=null){
 enabled();if(after!==null)cursor.parse(after);
 const v=page.parse(await apiRequest({path:`/v1/rewards/demo-copy/club-awards${after?`?after=${after}`:''}`,cache:'no-store'}));let previous=after;
 for(const item of v.items){if(([5,6].includes(item.protocolVersion??4) ? !item.directClaim||item.claims.length!==0 : item.directClaim!==undefined)||previous!==null&&item.entitlementId<=previous||item.claims.some(c=>c.consented&&!c.prepared||c.approved&&!c.consented||c.paid&&!c.approved))throw Error('invalid_claim');previous=item.entitlementId;}
 if(v.nextCursor!==null&&(v.items.length!==50||v.nextCursor!==previous))throw Error('invalid_claim');return v;
}
export async function getHostedClubClaimReviews(approvalId:string,after:string|null=null){
 enabled();uuid.parse(approvalId);if(after!==null)uuid.parse(after);
 return decodeHostedClaimQueue(await apiRequest({path:`/v1/rewards/demo-copy/club-claim-reviews?approvalId=${approvalId}${after?`&after=${after}`:''}`,cache:'no-store'}),approvalId,after);
}
export async function requestHostedClubClaimReview(id:string,body?:unknown):Promise<SponsorClubClaim>{
 enabled();uuid.parse(id);
 const v=sponsorClubClaimSchema.parse(await apiRequest({path:`/v1/rewards/demo-copy/club-claim-reviews/${id}`,cache:'no-store',...(body?{method:'POST' as const,body}:{})}));
 if(v.claimId!==id||v.role!=='operator'||v.chainId!==10143||v.signing!==null||v.transaction!==null||v.address!==v.candidate.safeAddress||v.owners.join()!==v.candidate.owners.join())throw Error('invalid_claim');return v;
}
