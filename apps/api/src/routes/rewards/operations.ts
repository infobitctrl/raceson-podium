import type {IncomingMessage,ServerResponse} from 'node:http';
import {z} from 'zod';
import {rewardReviewIssues} from '@raceson/db/rewards';
import {readSupportSettings,changeSupportSettings} from '../../features/rewards/operations.js';
import type {OrganizerRewardRouteDependencies} from './organizer.js';

export async function dispatchRewardOperations(req:IncomingMessage,res:ServerResponse,url:URL,deps:OrganizerRewardRouteDependencies&{readGas?:()=>Promise<{address:string;balanceWei:string}|null>}){
 const admin=url.pathname==='/api/v1/rewards/admin/support';
 const match=/^\/api\/v1\/organizer\/rewards\/sponsor-setups\/([^/]+)\/allocations\/([0-5])\/issues$/.exec(url.pathname);
 if(!admin&&!match)return false;
 deps.applyPrivateSessionHeaders(res);
 try{
  const config=deps.config();if(!config||admin&&config.chainId!==10143)throw Error('reward_operations_unavailable');
  if(!['GET','POST'].includes(req.method??'')){res.setHeader('Allow','GET, POST');deps.sendError(res,405,'method_not_allowed','Unsupported method.');return true;}
  if(req.headers.origin&&req.headers.origin!==config.origin)throw Error('Untrusted browser origin');
  if([...url.searchParams].length)throw Error('invalid_reward_operations');
  const identity=await deps.requireIdentity(req),body=req.method==='POST'?await deps.readJsonBody(req):undefined;
  const result=admin?(req.method==='POST'?await changeSupportSettings(identity,body,deps.rpc):await readSupportSettings(identity,deps.rpc,deps.readGas)):
   await rewardReviewIssues(identity,{chainId:config.chainId,setupId:match![1]!,slot:Number(match![2])},body,deps.rpc);
  deps.sendSuccess(res,result);
 }catch(error){
  const code=error instanceof Error?error.message:'';
  if(['Unauthorized','Missing bearer token','reward_account_session_required'].includes(code))deps.sendError(res,401,'reward_auth_required','Sign in to the isolated demo.');
  else if(['Untrusted browser origin','reward_master_admin_required','reward_review_issue_not_owned'].includes(code))deps.sendError(res,403,code==='Untrusted browser origin'?'forbidden':code,'Your account cannot make this change.');
  else if(['reward_setup_not_found','reward_planning_not_found'].includes(code))deps.sendError(res,404,'reward_setup_not_found','No campaign review is available for this account.');
  else if(['reward_support_settings_conflict','reward_review_issue_conflict','reward_review_issue_open','reward_review_issue_limit','reward_sponsor_source_not_ready','reward_final_allocation_source_not_ready','reward_league_publication_not_ready'].includes(code))deps.sendError(res,409,code,'Reload and review the current state before continuing.');
  else if(error instanceof z.ZodError||['invalid_reward_operations','invalid_reward_support_settings','invalid_reward_review_issue','reward_support_review_required'].includes(code))deps.sendError(res,400,'invalid_reward_operations','Check the review details.');
  else deps.sendError(res,503,'reward_operations_unavailable','The current state could not be verified. Reload before retrying.');
 }
 return true;
}
