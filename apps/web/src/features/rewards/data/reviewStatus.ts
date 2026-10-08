import {z} from 'zod';
import {apiRequest} from '@/lib/api';
const schema=z.object({setupId:z.string().uuid(),revision:z.number().int().positive(),launchId:z.string().uuid(),
 fundingState:z.enum(['awaiting_contract','awaiting_funding','funded','cancelled','unverified']),
 claimState:z.enum(['open','partially_open','paused','closed','not_open','unverified']),
 reviewState:z.enum(['approved','partially_approved','held','pending']),blockNumber:z.string().regex(/^[0-9]+$/).nullable()}).strict();
export type ReviewStatus=z.infer<typeof schema>;
export async function readReviewStatus(id:string,revision:number){
 const status=schema.parse(await apiRequest({path:`/v1/rewards/demo-copy/reviews/${id}/status`,cache:'no-store'}));
 if(status.setupId!==id||status.revision!==revision)throw Error('review_status_changed');
 return status;
}
export const REVIEW_STATUS_CHANGED='podium-review-status-changed';
export function notifyReviewStatus(id:string){window.dispatchEvent(new CustomEvent(REVIEW_STATUS_CHANGED,{detail:id}));}
