import {z} from 'zod';
import {apiRequest} from '@/lib/api';
import {decodeReviewIssues,decodeSupportSnapshot,decodeSupportSettings,type SupportSettings,type IssueChange} from '@raceson/domain/rewards/operations';
export type {ReviewIssues,SupportSnapshot,SupportSettings} from '@raceson/domain/rewards/operations';
export async function reviewIssues(setupId:string,slot:number,change?:IssueChange){return decodeReviewIssues(await apiRequest({path:`/v1/organizer/rewards/sponsor-setups/${setupId}/allocations/${slot}/issues`,cache:'no-store',...(change?{method:'POST' as const,body:change}:{})}));}
export async function hostedReviewIssues(setupId:string,slot:number,change?:IssueChange){return decodeReviewIssues(await apiRequest({path:`/v1/rewards/demo-copy/reviews/${setupId}/allocations/${slot}/issues`,cache:'no-store',...(change?{method:'POST' as const,body:change}:{})}));}
const gasSchema=z.object({address:z.string().regex(/^0x[0-9a-f]{40}$/),balanceWei:z.string().regex(/^\d+$/),low:z.boolean().nullable()}).strict().nullable();
export async function readSupportSettings(){
 const raw=await apiRequest<Record<string,unknown>>({path:'/v1/rewards/admin/support',cache:'no-store'});
 const {gas,...rest}=raw;return {...decodeSupportSnapshot(rest),gas:gasSchema.parse(gas)};
}
export async function reviewSupportSettings(expectedRevision:number,settings:SupportSettings){
 const raw=await apiRequest<Record<string,unknown>>({path:'/v1/rewards/admin/support',method:'POST',body:{action:'review',expectedRevision,settings}});
 return {revision:z.number().int().nonnegative().parse(raw.revision),settings:decodeSupportSettings(raw.settings),fingerprint:z.string().regex(/^[0-9a-f]{64}$/).parse(raw.fingerprint)};
}
export async function saveSupportSettings(review:Awaited<ReturnType<typeof reviewSupportSettings>>,reason:string,requestId:string){return decodeSupportSnapshot(await apiRequest({path:'/v1/rewards/admin/support',method:'POST',body:{action:'save',expectedRevision:review.revision,settings:review.settings,reviewFingerprint:review.fingerprint,reason,requestId}}));}
