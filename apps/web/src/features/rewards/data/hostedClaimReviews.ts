import {z} from 'zod';
import {apiRequest} from '@/lib/api';
import {publicEnv} from '@/lib/public-env';
import {sponsorClaimSchema,type SponsorClaim} from './sponsorProgramme';
const uuid=z.string().uuid(),hex=z.string().regex(/^0x[0-9a-f]{64}$/);
const row=z.object({id:uuid,approvalId:uuid,slot:z.number().int().min(0).max(5),entitlementId:hex,amountWei:z.string().regex(/^[1-9][0-9]*$/),
 address:z.string().regex(/^0x[0-9a-f]{40}$/),prepared:z.boolean(),consented:z.boolean(),approved:z.boolean(),paid:z.boolean()}).strict();
const page=z.object({items:z.array(row).max(50),nextCursor:uuid.nullable()}).strict();
export type HostedClaimQueue=z.infer<typeof page>;
export function decodeHostedClaimQueue(value:unknown,approvalId:string,after:string|null){
 const v=page.parse(value);let previous=after;
 for(const item of v.items){if(item.approvalId!==approvalId||previous!==null&&item.id<=previous||item.consented&&!item.prepared||item.approved&&!item.consented||item.paid&&!item.approved)throw Error('invalid_claim');previous=item.id;}
 if(v.nextCursor!==null&&(v.items.length!==50||v.nextCursor!==previous))throw Error('invalid_claim');
 return v;
}
function enabled(){if(!publicEnv.hostedOperations||!publicEnv.rewardPortalEnabled)throw Error('rewards_disabled');}
export async function getHostedClaimReviews(approvalId:string,after:string|null=null){
 enabled();uuid.parse(approvalId);if(after!==null)uuid.parse(after);
 return decodeHostedClaimQueue(await apiRequest({path:`/v1/rewards/demo-copy/claim-reviews?approvalId=${approvalId}${after?`&after=${after}`:''}`,cache:'no-store'}),approvalId,after);
}
export async function requestHostedClaimReview(id:string,body?:unknown):Promise<SponsorClaim>{
 enabled();uuid.parse(id);
 const v=sponsorClaimSchema.parse(await apiRequest({path:`/v1/rewards/demo-copy/claim-reviews/${id}`,cache:'no-store',...(body?{method:'POST' as const,body}:{})}));
 if(v.claimId!==id||v.role!=='operator'||v.chainId!==10143||v.signing!==null||v.transaction!==null)throw Error('invalid_claim');
 return v;
}
