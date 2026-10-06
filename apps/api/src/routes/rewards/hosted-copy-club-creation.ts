import type {IncomingMessage,ServerResponse} from 'node:http';
import {z} from 'zod';
import {createAdminSupabaseClient,loadServerEnv} from '@raceson/db';
import {hostedCopyClubCreationStore} from '@raceson/db/rewards';
import type {RewardClubSafeCreationReader,RewardClubSafeDeploymentReader} from '@raceson/rewards-chain';
import {hostedCopyOperationsEnabled} from '../../features/rewards/hosted-copy-preview.js';
import {hostedClubCreation,type HostedClubCreationCommand} from '../../features/rewards/hosted-club-creation-service.js';
import type {OrganizerRewardRouteDependencies} from './organizer.js';
const uuid=z.string().uuid(),address=z.string().regex(/^0x[0-9a-f]{40}$/),hex=z.string().regex(/^0x[0-9a-f]{64}$/);
export const hostedClubCreationCommand=z.discriminatedUnion('action',[
 z.object({action:z.literal('request'),requestId:uuid,clubId:uuid,proofId:uuid,owners:z.array(address).length(3)}).strict(),
 z.object({action:z.literal('prepare'),proofId:uuid}).strict(),
 z.object({action:z.literal('submitted'),transactionHash:hex}).strict(),
 z.object({action:z.literal('verify'),transactionHash:hex}).strict(),
]);
export async function dispatchHostedCopyClubCreation(req:IncomingMessage,res:ServerResponse,url:URL,deps:OrganizerRewardRouteDependencies&{
 creationReader?:RewardClubSafeCreationReader&RewardClubSafeDeploymentReader;
}){
 const list=url.pathname==='/api/v1/rewards/demo-copy/club-creations',m=/^\/api\/v1\/rewards\/demo-copy\/club-creations\/([^/]+)$/.exec(url.pathname);
 if(!list&&!m)return false;deps.applyPrivateSessionHeaders(res);
 try{
  const env=loadServerEnv();if(!hostedCopyOperationsEnabled(process.env,env)||deps.config()?.chainId!==10143)throw Error('hosted_copy_unavailable');
  if(req.method!=='GET'&&!(m&&req.method==='POST'))throw Error('invalid_reward_club_creation');
  const actor=await deps.requireIdentity(req),rpc=deps.rpc??((name,args)=>createAdminSupabaseClient(env).rpc(name,args)),store=hostedCopyClubCreationStore(actor,rpc);
  if(list){const q=z.object({after:uuid.optional()}).strict().parse(Object.fromEntries(url.searchParams));if([...url.searchParams].length!==Object.keys(q).length)throw Error('invalid_reward_club_creation');
   deps.sendSuccess(res,await store.history(q.after??null));return true;}
  if([...url.searchParams].length)throw Error('invalid_reward_club_creation');const id=uuid.parse(m![1]);
  const command=req.method==='POST'?hostedClubCreationCommand.parse(await deps.readJsonBody(req)):undefined;
  if(!deps.creationReader)throw Error('hosted_copy_unavailable');
  deps.sendSuccess(res,await hostedClubCreation(id,command as HostedClubCreationCommand|undefined,{store,reader:deps.creationReader}));
 }catch(error){const code=error&&typeof error==='object'&&'code'in error?String(error.code):error instanceof Error?error.message:'';
  if(['Unauthorized','Missing bearer token','reward_account_session_required'].includes(code))deps.sendError(res,401,'reward_auth_required','Sign in to the isolated demo.');
  else if(['Untrusted browser origin','reward_demo_account_required','reward_club_owner_required'].includes(code))deps.sendError(res,403,'reward_club_owner_required','Current club ownership is required to create a treasury.');
  else if(code==='reward_club_creation_not_found')deps.sendError(res,404,code,'Treasury creation request not found.');
  else if(error instanceof z.ZodError||code==='invalid_reward_club_creation')deps.sendError(res,400,'invalid_reward_club_creation','Check the three owners and creation request.');
  else if(['reward_destination_proof_required','reward_wallet_challenge_expired','reward_ledger_idempotency_conflict','reward_club_creation_limit','reward_club_creation_recovery_required','reward_club_creation_gas_required','reward_club_creation_already_deployed'].includes(code))deps.sendError(res,409,code,'Refresh the saved request and wallet before continuing.');
  else deps.sendError(res,503,'reward_club_creation_unavailable','Treasury creation could not be verified. Refresh the saved request.');
 }return true;
}
