import {notifyReviewStatus} from './reviewStatus';
import {z} from 'zod';
import {apiRequest} from '@/lib/api';
import {decodeSponsorLifecycleView} from './sponsorLifecycleCodec';
const uuid=z.string().uuid(),hash=z.string().regex(/^[0-9a-f]{64}$/),wei=z.string().regex(/^(0|[1-9][0-9]{0,24})$/);
const upload=z.object({protocolVersion:z.literal(5).optional(),schema:z.literal('raceson-sponsor-upload-view-v4'),approvalId:uuid,slot:z.number().int().min(0).max(5),contextHash:hash,documentHash:hash,current:z.boolean(),sourceKind:z.literal('historical_copy'),
 budgetWei:wei,allocatedWei:wei,unallocatedWei:wei,recipientCount:z.number().int().min(0).max(10000),campaignAddress:z.string().regex(/^0x[0-9a-f]{40}$/).nullable(),
 prepared:z.object({id:uuid,packageHash:hash,preparedAt:z.string().datetime()}).strict().nullable(),executionStatus:z.literal('not_observed'),stageReady:z.literal(false),payableWei:z.literal('0')}).strict();
export type HostedUploadScope={id:string;slot:number;approvalId:string};
function path(s:HostedUploadScope,kind:'upload'|'handoff'){return `/v1/rewards/demo-copy/reviews/${uuid.parse(s.id)}/allocations/${z.number().int().min(0).max(5).parse(s.slot)}/${uuid.parse(s.approvalId)}/${kind}`;}
export async function readHostedAwardUpload(scope:HostedUploadScope,change?:{requestId:string;contextHash:string;documentHash:string}){
 const value=upload.parse(await apiRequest({path:path(scope,'upload'),method:change?'POST':'GET',...(change?{body:change}:{}),cache:'no-store'}));
 if(value.approvalId!==scope.approvalId||value.slot!==scope.slot||BigInt(value.budgetWei)!==BigInt(value.allocatedWei)+BigInt(value.unallocatedWei)
  ||change&&(value.contextHash!==change.contextHash||value.documentHash!==change.documentHash||value.prepared?.id!==change.requestId))throw Error('invalid_sponsor_upload');
 if(change)notifyReviewStatus(scope.id);
 return value;
}
export async function readHostedAwardHandoff(scope:HostedUploadScope,change?:{action:'publication';requestId:string;documentHash:string}){
 const value=decodeSponsorLifecycleView(await apiRequest({path:path(scope,'handoff'),method:change?'POST':'GET',...(change?{body:change}:{}),cache:'no-store'}));
 if(value.approvalId!==scope.approvalId||value.slot!==scope.slot||value.transaction!==null||value.pot!==null||change&&(value.publication?.id!==change.requestId||value.publicationHash!==change.documentHash))throw Error('invalid_sponsor_lifecycle');
 if(change)notifyReviewStatus(scope.id);
 return value;
}
