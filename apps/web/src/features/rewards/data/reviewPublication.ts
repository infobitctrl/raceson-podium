import {z} from 'zod';
import {apiRequest} from '@/lib/api';
import type {HostedUploadScope} from './hostedAwardUpload';
const uuid=z.string().uuid(),hash=z.string().regex(/^[0-9a-f]{64}$/),address=z.string().regex(/^0x[0-9a-f]{40}$/);
const view=z.object({schema:z.literal('podium-review-publication-v1'),approvalId:uuid,slot:z.number().int().min(0).max(5),documentHash:hash,operator:address,campaignAddress:address,state:z.number().int().min(0).max(5),claimsOpen:z.boolean(),next:z.enum(['upload','stage','activate']).nullable(),ownership:z.enum(['owned','transfer_required','connect_required']),pending:z.object({hash:z.string().regex(/^0x[0-9a-f]{64}$/).nullable(),confirmed:z.boolean(),action:z.enum(['upload','stage','activate'])}).strict().nullable()}).strict();
export type ReviewPublication= z.infer<typeof view>;
export async function readReviewPublication(scope:HostedUploadScope,documentHash:string,advance=false){
 const value=view.parse(await apiRequest({path:`/v1/rewards/demo-copy/reviews/${uuid.parse(scope.id)}/allocations/${scope.slot}/${uuid.parse(scope.approvalId)}/publish`,method:advance?'POST':'GET',...(advance?{body:{expectedDocumentHash:hash.parse(documentHash)}}:{}),cache:'no-store'}));
 if(value.approvalId!==scope.approvalId||value.slot!==scope.slot||value.documentHash!==documentHash||value.claimsOpen!==(value.state===3))throw Error('invalid_review_publication');
 return value;
}
