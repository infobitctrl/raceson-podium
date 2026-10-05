import type {IncomingMessage,ServerResponse} from 'node:http';
import {createAdminSupabaseClient,loadServerEnv} from '@raceson/db';
import {hostedCopyReviewSources,composeHostedCopyAllocation} from '@raceson/db/rewards';
import {setupId} from '@raceson/domain/rewards/distribution-setup';
import {hostedCopyOperationsEnabled,hostedCopyPin} from '../../features/rewards/hosted-copy-preview.js';
import {hostedCopySelections,hostedCopyUnaffiliatedReview,hostedCopyReviewNote} from '../../features/rewards/hosted-copy-review.js';
import type {OrganizerRewardRouteDependencies} from './organizer.js';
import {z} from 'zod';
import {hostedCopyAwardReview} from '../../features/rewards/hosted-copy-approval-service.js';
const uuid=z.string().uuid().refine(v=>!!setupId(v)),hash=z.string().regex(/^[0-9a-f]{64}$/);
const decision=z.object({requestId:uuid,expectedApprovalId:uuid.nullable(),contextHash:hash,documentHash:hash,decision:z.enum(['approved','held'])}).strict();
export async function dispatchHostedCopyReviews(req:IncomingMessage,res:ServerResponse,url:URL,deps:OrganizerRewardRouteDependencies){
 const match=/^\/api\/v1\/rewards\/demo-copy\/reviews(?:\/([^/]+)(?:\/allocations\/([0-5]))?)?$/.exec(url.pathname);
 if(!match)return false;deps.applyPrivateSessionHeaders(res);
 try{
  const env=loadServerEnv();
  if(!hostedCopyOperationsEnabled(process.env,env)||deps.config()?.chainId!==10143)throw Error('hosted_copy_unavailable');
  if(req.method!=='GET'&&!(match[2]&&req.method==='POST')){res.setHeader('Allow',match[2]?'GET, POST':'GET');deps.sendError(res,405,'method_not_allowed','Unsupported method.');return true;}
  if([...url.searchParams].length||match[1]&&!setupId(match[1]))throw Error('invalid_reward_setup');
  const actor=await deps.requireIdentity(req),id=match[1]??null;
  const rpc=deps.rpc??((name:string,args:Record<string,unknown>)=>createAdminSupabaseClient(env).rpc(name,args));
  if(match[2]){deps.sendSuccess(res,await hostedCopyAwardReview(actor,id!,Number(match[2]),rpc,req.method==='POST'?decision.parse(await deps.readJsonBody(req)):undefined));return true;}
  const records=await hostedCopyReviewSources(actor,id,hostedCopyPin,rpc);
  if(id===null){deps.sendSuccess(res,{version:'podium-copy-review-queue-v1',items:records.map(r=>r.summary)});return true;}
  const record=records[0]!;
  const result=composeHostedCopyAllocation(record.launch.setup,record.source!,hostedCopyPin,hostedCopySelections(hostedCopyPin),hostedCopyUnaffiliatedReview(hostedCopyPin));
  // Recheck live source authority after calculation before returning private rows.
  const fresh=await hostedCopyReviewSources(actor,id,hostedCopyPin,rpc);
  if(fresh[0]!.launch.id!==record.launch.id)throw Error('reward_setup_conflict');
  deps.sendSuccess(res,JSON.parse(JSON.stringify({...result.allocation,reviewNote:hostedCopyReviewNote(hostedCopyPin)},(_key,v)=>typeof v==='bigint'?v.toString():v)));
 }catch(error){
  const code=error&&typeof error==='object'&&'code' in error?String(error.code):error instanceof Error?error.message:'';
  if(['Unauthorized','Missing bearer token','reward_account_session_required'].includes(code))deps.sendError(res,401,'reward_auth_required','Sign in to the isolated demo.');
  else if(code==='Untrusted browser origin')deps.sendError(res,403,'forbidden','This browser request is not allowed.');
  else if(['reward_demo_account_required','reward_demo_reviewer_required'].includes(code))deps.sendError(res,403,'reward_demo_reviewer_required','An active results-team or master-administrator account is required.');
  else if(code==='reward_setup_not_found')deps.sendError(res,404,code,'No source-bound campaign is available.');
  else if(code==='reward_setup_conflict')deps.sendError(res,409,code,'Reload the current contract version before reviewing.');
  else if(['reward_planning_revision_changed','reward_sponsor_approval_conflict','reward_sponsor_source_not_ready'].includes(code))deps.sendError(res,409,code,'Reload the exact saved awards before recording a decision.');
  else if(code==='invalid_sponsor_allocation'||error instanceof z.ZodError)deps.sendError(res,400,'invalid_sponsor_allocation','Check the award review request.');
  else if(code==='invalid_reward_setup')deps.sendError(res,400,code,'Select a source-bound campaign.');
  else deps.sendError(res,503,'hosted_copy_unavailable','The verified review sources could not be loaded.');
 }
 return true;
}
