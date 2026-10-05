import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { createAdminSupabaseClient, loadServerEnv } from '@raceson/db';
import { readHostedCopyAllocation, readHostedCopyAllocationHandoff } from '@raceson/db/rewards';
import { hostedCopyPin, hostedCopyPreviewEnabled } from '../../features/rewards/hosted-copy-preview.js';
import { hostedCopyCombinedReview, hostedCopySelections, hostedCopyUnaffiliatedReview, hostedCopyReviewNote } from '../../features/rewards/hosted-copy-review.js';
import type { OrganizerRewardRouteDependencies } from './organizer.js';
export async function dispatchHostedCopyAllocation(req:IncomingMessage,res:ServerResponse,url:URL,deps:OrganizerRewardRouteDependencies,read=readHostedCopyAllocation,readHandoff=readHostedCopyAllocationHandoff) {
 const match=/^\/api\/v1\/rewards\/demo-copy\/sponsor-setups\/([^/]+)\/allocation\/([^/]+)(\/handoff)?$/.exec(url.pathname);
 if(!match)return false;deps.applyPrivateSessionHeaders(res);
 try {
  const env=loadServerEnv();
  if(!hostedCopyPreviewEnabled(process.env,env)||process.env.RACESON_REWARD_HOSTED_COPY_MODE!=='sponsor-drafts-v1'||deps.config()?.chainId!==10143)throw Error('hosted_copy_unavailable');
  const identity=await deps.requireIdentity(req);
  if(req.method!=='GET'||[...url.searchParams].length||!/^[1-9][0-9]{0,9}$/.test(match[2]!))throw Error('invalid_reward_setup');
  const id=z.string().uuid().parse(match[1]),revision=Number(match[2]);
  const rpc=deps.rpc??((name:string,args:Record<string,unknown>)=>createAdminSupabaseClient(env).rpc(name,args));
  if(match[3]) {
   const result=await readHandoff(identity,id,revision,hostedCopyPin,rpc,hostedCopySelections(hostedCopyPin),hostedCopyUnaffiliatedReview(hostedCopyPin),
    {combined:hostedCopyCombinedReview.version,unaffiliated:hostedCopyUnaffiliatedReview(hostedCopyPin)?.version??null});
   deps.sendSuccess(res,result);return true;
  }
  const result=await read(identity,id,revision,hostedCopyPin,rpc,hostedCopySelections(hostedCopyPin),hostedCopyUnaffiliatedReview(hostedCopyPin));
  deps.sendSuccess(res,JSON.parse(JSON.stringify({...result,reviewVersion:hostedCopyCombinedReview.version,clubReviewVersion:hostedCopyUnaffiliatedReview(hostedCopyPin)?.version,reviewNote:hostedCopyReviewNote(hostedCopyPin)},(_key,v)=>typeof v==='bigint'?v.toString():v)));
 }catch(error){
  const code=error instanceof Error?error.message:'';
  if(['Unauthorized','Missing bearer token','reward_account_session_required'].includes(code))deps.sendError(res,401,'reward_auth_required','Sign in to the demo.');
  else if(['Untrusted browser origin','reward_demo_account_required','reward_demo_sponsor_required'].includes(code))deps.sendError(res,403,'reward_demo_sponsor_required','Use the provisioned sponsor account.');
  else if(code==='reward_setup_not_found')deps.sendError(res,404,code,'Campaign not found.');
  else if(code==='reward_setup_conflict')deps.sendError(res,409,code,'This campaign changed. Reopen the saved version before calculating.');
  else if(code==='reward_setup_overallocated')deps.sendError(res,400,code,'A reward split exceeds 100%. Adjust it and save before calculating.');
  else if(code==='invalid_reward_setup'||error instanceof z.ZodError)deps.sendError(res,400,'invalid_reward_setup','Select a saved campaign revision.');
  else deps.sendError(res,503,'hosted_copy_unavailable','The verified allocation preview is temporarily unavailable.');
 }
 return true;
}
