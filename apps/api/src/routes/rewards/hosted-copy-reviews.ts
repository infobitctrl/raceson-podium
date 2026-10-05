import type {IncomingMessage,ServerResponse} from 'node:http';
import {createAdminSupabaseClient,loadServerEnv} from '@raceson/db';
import {hostedCopyReviewSources,composeHostedCopyAllocation} from '@raceson/db/rewards';
import {setupId} from '@raceson/domain/rewards/distribution-setup';
import {hostedCopyOperationsEnabled,hostedCopyPin} from '../../features/rewards/hosted-copy-preview.js';
import {hostedCopySelections,hostedCopyUnaffiliatedReview,hostedCopyReviewNote} from '../../features/rewards/hosted-copy-review.js';
import type {OrganizerRewardRouteDependencies} from './organizer.js';
export async function dispatchHostedCopyReviews(req:IncomingMessage,res:ServerResponse,url:URL,deps:OrganizerRewardRouteDependencies){
 const match=/^\/api\/v1\/rewards\/demo-copy\/reviews(?:\/([^/]+))?$/.exec(url.pathname);
 if(!match)return false;deps.applyPrivateSessionHeaders(res);
 try{
  const env=loadServerEnv();
  if(!hostedCopyOperationsEnabled(process.env,env)||deps.config()?.chainId!==10143)throw Error('hosted_copy_unavailable');
  if(req.method!=='GET'){res.setHeader('Allow','GET');deps.sendError(res,405,'method_not_allowed','Unsupported method.');return true;}
  if([...url.searchParams].length||match[1]&&!setupId(match[1]))throw Error('invalid_reward_setup');
  const actor=await deps.requireIdentity(req),id=match[1]??null;
  const rpc=deps.rpc??((name:string,args:Record<string,unknown>)=>createAdminSupabaseClient(env).rpc(name,args));
  const records=await hostedCopyReviewSources(actor,id,hostedCopyPin,rpc);
  if(id===null){deps.sendSuccess(res,{version:'podium-copy-review-queue-v1',items:records.map(r=>r.summary)});return true;}
  const record=records[0]!;
  const result=composeHostedCopyAllocation(record.launch.setup,record.source!,hostedCopyPin,hostedCopySelections(hostedCopyPin),hostedCopyUnaffiliatedReview(hostedCopyPin));
  // Recheck live source authority after calculation before returning private rows.
  const fresh=await hostedCopyReviewSources(actor,id,hostedCopyPin,rpc);
  if(fresh[0]!.launch.id!==record.launch.id)throw Error('reward_setup_conflict');
  deps.sendSuccess(res,JSON.parse(JSON.stringify({...result.allocation,reviewNote:hostedCopyReviewNote(hostedCopyPin)},(_key,v)=>typeof v==='bigint'?v.toString():v)));
 }catch(error){
  const code=error instanceof Error?error.message:'';
  if(['Unauthorized','Missing bearer token','reward_account_session_required'].includes(code))deps.sendError(res,401,'reward_auth_required','Sign in to the isolated demo.');
  else if(['reward_demo_account_required','reward_demo_reviewer_required'].includes(code))deps.sendError(res,403,'reward_demo_reviewer_required','An active results-team or master-administrator account is required.');
  else if(code==='reward_setup_not_found')deps.sendError(res,404,code,'No source-bound campaign is available.');
  else if(code==='reward_setup_conflict')deps.sendError(res,409,code,'Reload the current contract version before reviewing.');
  else if(code==='invalid_reward_setup')deps.sendError(res,400,code,'Select a source-bound campaign.');
  else deps.sendError(res,503,'hosted_copy_unavailable','The verified review sources could not be loaded.');
 }
 return true;
}
