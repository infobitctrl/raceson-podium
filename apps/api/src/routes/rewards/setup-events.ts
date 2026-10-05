import type {IncomingMessage,ServerResponse} from 'node:http';
import {rewardSetupEvents} from '@raceson/db/rewards';
import {setupId} from '@raceson/domain/rewards/distribution-setup';
import type {OrganizerRewardRouteDependencies} from './organizer.js';
export async function dispatchSetupEvents(req:IncomingMessage,res:ServerResponse,url:URL,deps:OrganizerRewardRouteDependencies){
 const match=/^\/api\/v1\/rewards\/setup-events(?:\/([^/]+)(?:\/results\/([^/]+))?)?$/.exec(url.pathname);if(!match)return false;
 deps.applyPrivateSessionHeaders(res);if(req.method!=='GET'){res.setHeader('Allow','GET');deps.sendError(res,405,'method_not_allowed','Use GET.');return true;}
 try{if(!deps.config())return false;const identity=await deps.requireIdentity(req);if([...url.searchParams].length||match[1]&&!setupId(match[1])||match[2]&&!setupId(match[2]))throw Error('invalid_reward_setup');
  const result=await rewardSetupEvents(identity,match[1]??null,match[2]??null,deps.rpc);deps.sendSuccess(res,match[1]?result:{items:result});
 }catch(e){const code=e&&typeof e==='object'&&'code' in e?String(e.code):e instanceof Error?e.message:'';
  const status=['reward_account_session_required','Unauthorized','Missing bearer token'].includes(code)?401:code==='Untrusted browser origin'?403:code==='reward_setup_not_found'?404:code==='invalid_reward_setup'?400:503;
  deps.sendError(res,status,status===401?'reward_auth_required':code==='reward_event_limit'?code:'reward_events_unavailable','Event information could not be loaded.');}
 return true;
}
