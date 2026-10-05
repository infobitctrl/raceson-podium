import type {IncomingMessage,ServerResponse} from 'node:http';
import {z} from 'zod';
import {createAdminSupabaseClient,loadServerEnv} from '@raceson/db';
import {hostedCopySponsor,hostedCopySponsorExecutionRpc} from '@raceson/db/rewards';
import {decodeSponsorLaunchView,sponsorLaunchPlan} from '@raceson/domain/rewards/sponsor-launch';
import {decodeCopySponsorLaunchBinding} from '@raceson/domain/rewards/copy-sponsor-launch';
import {hostedCopyPin,hostedCopyOperationsEnabled} from '../../features/rewards/hosted-copy-preview.js';
import type {OrganizerRewardRouteDependencies} from './organizer.js';
const uuid=z.string().uuid().refine(v=>v===v.toLowerCase()&&!/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(v));
const command=z.object({requestId:uuid,expectedRevision:z.number().int().min(1).max(2147483645)}).strict();
export async function dispatchHostedCopyLaunch(req:IncomingMessage,res:ServerResponse,url:URL,deps:OrganizerRewardRouteDependencies){
 const match=/^\/api\/v1\/rewards\/demo-copy\/sponsor-setups\/([^/]+)\/launch$/.exec(url.pathname);if(!match)return false;
 deps.applyPrivateSessionHeaders(res);
 try{
  const env=loadServerEnv();if(!hostedCopyOperationsEnabled(process.env,env)||deps.config()?.chainId!==10143)throw Error('hosted_copy_unavailable');
  if(!['GET','POST'].includes(req.method??'')||[...url.searchParams].length)throw Error('invalid_sponsor_launch');
  const identity=await deps.requireIdentity(req),id=uuid.parse(match[1]);
  const change=req.method==='POST'?command.parse(await deps.readJsonBody(req)):undefined;
  const rpc=deps.rpc??((name,args)=>createAdminSupabaseClient(env).rpc(name,args));
  const preflight=await hostedCopySponsor(identity,'read',id,undefined,hostedCopyPin,rpc);
  const response=await hostedCopySponsorExecutionRpc(identity,id,rpc,preflight.sourceFingerprint)('service_reward_sponsor_launch',{
   p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_chain_id:10143,p_setup_id:id,
   p_request_id:change?.requestId??null,p_expected_revision:change?.expectedRevision??null,
  });
  if(response.error)throw Error((response.error as {message?:string}).message??'hosted_copy_unavailable');
  const view=decodeSponsorLaunchView(response.data,10143,id);
  if(change&&(!view.launch||view.launch.setup.revision!==change.expectedRevision||!sponsorLaunchPlan(view.launch.setup).complete))throw Error('invalid_sponsor_launch');
  const binding=view.launch?decodeCopySponsorLaunchBinding({version:'copy-launch-v1',setupId:id,launchId:view.launch.id,
   revision:view.launch.setup.revision,configurationHash:view.launch.configurationHash,sourceFingerprint:preflight.sourceFingerprint},view.launch):null;
  deps.sendSuccess(res,{view,binding});
 }catch(error){
  const code=error instanceof Error?error.message:'';
  if(['Unauthorized','Missing bearer token','reward_account_session_required'].includes(code))deps.sendError(res,401,'reward_auth_required','Sign in to the demo.');
  else if(['Untrusted browser origin','reward_demo_account_required','reward_demo_sponsor_required'].includes(code))deps.sendError(res,403,'reward_demo_sponsor_required','Use the sponsor account.');
  else if(code==='reward_setup_not_found')deps.sendError(res,404,code,'Campaign not found.');
  else if(['reward_setup_conflict','reward_launch_incomplete','copy_scope_changed','copy_projection_changed'].includes(code))deps.sendError(res,409,code,'Reload and review the saved campaign and its source before continuing.');
  else if(code==='invalid_sponsor_launch'||error instanceof z.ZodError)deps.sendError(res,400,'invalid_sponsor_launch','Check the launch request.');
  else deps.sendError(res,503,'hosted_copy_unavailable','The source-bound launch could not be verified.');
 }
 return true;
}
