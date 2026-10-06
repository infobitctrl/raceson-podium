import type {IncomingMessage,ServerResponse} from 'node:http';
import {rewardCampaignBranding,type RewardLedgerRpc,type RewardAccountIdentity} from '@raceson/db/rewards';
import type {OrganizerRewardRouteDependencies} from './organizer.js';
export async function dispatchCampaignBranding(req:IncomingMessage,res:ServerResponse,url:URL,deps:OrganizerRewardRouteDependencies&{resolveRpc?:(identity?:RewardAccountIdentity)=>RewardLedgerRpc}){
 const match=/^\/api\/v1\/rewards\/campaign-branding(?:\/([^/]+))?$/.exec(url.pathname);
 if(!match)return false;
 deps.applyPrivateSessionHeaders(res);
 const write=req.method==='PATCH',mine=match[1]==='mine';
 if(req.method!=='GET'&&!write||write&&(!match[1]||mine)){deps.sendError(res,405,'method_not_allowed','Unsupported method.');return true;}
 try{
  const config=deps.config();if(!config)throw Error('unavailable');
  if([...url.searchParams].length)throw Error('invalid_campaign_branding');
  const identity=write||mine?await deps.requireIdentity(req):undefined;
  const change=write?await deps.readJsonBody(req):undefined;
  deps.sendSuccess(res,await rewardCampaignBranding(config.chainId,identity,mine?undefined:match[1],change,deps.resolveRpc?.(identity)??deps.rpc));
 }catch(e){
  const code=e instanceof Error?e.message:'';
  if(['Unauthorized','Missing bearer token','reward_account_session_required'].includes(code))deps.sendError(res,401,'reward_auth_required','Sign in to edit sponsor details.');
  else if(code==='Untrusted browser origin')deps.sendError(res,403,'forbidden','This browser request is not allowed.');
  else if(['reward_demo_account_required','reward_demo_sponsor_required'].includes(code))deps.sendError(res,403,'reward_demo_sponsor_required','Use the provisioned sponsor account to edit sponsor details.');
  else if(code==='reward_setup_not_found')deps.sendError(res,404,code,'Campaign not found.');
  else if(code==='campaign_branding_conflict')deps.sendError(res,409,code,'Sponsor details changed. Reload before saving.');
  else if(code==='invalid_campaign_branding')deps.sendError(res,400,code,'Check the sponsor name and logo.');
  else deps.sendError(res,503,'campaign_branding_unavailable','Sponsor details are temporarily unavailable.');
 }
 return true;
}
